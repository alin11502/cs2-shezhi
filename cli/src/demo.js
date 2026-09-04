"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dp = require("@laihoe/demoparser2");
const log = require("./log");

// CS2 demo 后缀。PBDEMS2 是 CS2 的 demo stamp，.dem.bz2 是 HLTV 等站点的压缩分发格式。
const DEMO_EXT = [".dem"];

function findDemos(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
        walk(full);
      } else if (DEMO_EXT.includes(path.extname(ent.name).toLowerCase())) {
        out.push(full);
      }
    }
  };
  const st = fs.statSync(dir);
  if (st.isFile()) return [path.resolve(dir)];
  walk(dir);
  return out.sort();
}

// 流式 sha256：demo 动辄数百 MB，不能整块读进内存。
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

// demo 旁边的 <name>.meta.json，用来补 parseHeader 拿不到的信息
// （赛事名、比赛日期、队名、来源链接）。header 里只有 map_name / server_name。
function readSidecar(demoPath) {
  const side = demoPath.replace(/\.dem$/i, "") + ".meta.json";
  if (!fs.existsSync(side)) return {};
  try {
    return JSON.parse(fs.readFileSync(side, "utf8"));
  } catch (e) {
    log.warn(`sidecar 解析失败，已忽略：${side}（${e.message}）`);
    return {};
  }
}

// demoparser2 的属性清单在未打包的 Rust 子模块里，无法静态确认。
// 所以运行时探测：只请求这个 demo 里真实存在的属性，缺的就是 null。
const VIEWMODEL_RE = /^viewmodel/i;
const INTERESTING = ["team_name", "team_number", "is_bot"];

function discoverProps(demoPath) {
  try {
    const fields = dp.listUpdatedFields(demoPath);
    const names = Array.isArray(fields) ? fields : Object.keys(fields || {});
    return {
      all: names,
      viewmodel: names.filter((n) => VIEWMODEL_RE.test(n)),
      interesting: names.filter((n) => INTERESTING.includes(n)),
    };
  } catch (e) {
    log.debug(`listUpdatedFields 失败（${e.message}），退回仅取 crosshair_code`);
    return { all: [], viewmodel: [], interesting: [] };
  }
}

function lastRoundEndTick(demoPath) {
  try {
    const ticks = dp.parseEvent(demoPath, "round_end").map((x) => x.tick);
    return ticks.length ? Math.max(...ticks) : null;
  } catch (e) {
    log.debug(`round_end 事件不可用：${e.message}`);
    return null;
  }
}

// 采样点：最后一个 round_end（终局准星）+ 每轮结束点。
// 多采几轮才能发现选手中途换准星，schema 里用 sampled_ticks 记录证据链。
function sampleTicks(demoPath, maxTicks) {
  let roundEnds = [];
  try {
    roundEnds = dp.parseEvent(demoPath, "round_end").map((x) => x.tick);
  } catch (e) {
    log.debug(`round_end 解析失败：${e.message}`);
  }
  if (!roundEnds.length) return [];

  const uniq = [...new Set(roundEnds)].sort((a, b) => a - b);
  const last = uniq[uniq.length - 1];
  if (uniq.length <= maxTicks) return uniq;

  // 超限时均匀抽样，但永远保留最后一轮（终局准星是权威值）
  const stride = Math.ceil(uniq.length / (maxTicks - 1));
  const picked = uniq.filter((_, i) => i % stride === 0);
  if (picked[picked.length - 1] !== last) picked.push(last);
  return picked;
}

// steamid 为 "BOT" 或非 76561 开头的一律视为机器人，不入库
function isBot(steamid) {
  if (!steamid) return true;
  const s = String(steamid);
  return s.toUpperCase() === "BOT" || !/^765611\d{11}$/.test(s);
}

async function parseDemo(demoPath, opts = {}) {
  const { maxSampleTicks = 40 } = opts;
  const abs = path.resolve(demoPath);
  if (!fs.existsSync(abs)) throw new Error(`demo 不存在：${abs}`);

  const stat = fs.statSync(abs);
  const header = safe(() => dp.parseHeader(abs), {});
  const playerInfo = safe(() => dp.parsePlayerInfo(abs), []);
  const props = opts.skipPropDiscovery ? { all: [], viewmodel: [], interesting: [] } : discoverProps(abs);

  const ticks = sampleTicks(abs, maxSampleTicks);
  if (!ticks.length) {
    throw new Error(`${path.basename(abs)}：取不到任何 round_end tick，可能不是完整的比赛 demo`);
  }

  const wanted = ["crosshair_code", ...props.viewmodel, ...props.interesting];
  const rows = dp.parseTicks(abs, [...new Set(wanted)], ticks);
  log.debug(`${path.basename(abs)}：采样 ${ticks.length} 个 tick，得到 ${rows.length} 行`);

  return {
    path: abs,
    filename: path.basename(abs),
    size_bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    header,
    playerInfo,
    props,
    ticks,
    rows,
    sidecar: readSidecar(abs),
  };
}

function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    log.debug(`解析失败，用默认值：${e.message}`);
    return fallback;
  }
}

// 从采样行里归并出每个选手的准星轨迹。
// 同一选手在同一 demo 里可能换过准星：保留最后一次作为当前值，
// 并把所有观测到的 (tick, code) 放进 sampled_ticks 作为证据。
function groupByPlayer(parsed) {
  const byId = new Map();

  for (const row of parsed.rows) {
    const steamid = row.steamid || row.steamid64 || null;
    const code = row.crosshair_code || null;
    if (!code) continue;
    if (isBot(steamid)) continue;

    const key = String(steamid);
    if (!byId.has(key)) {
      byId.set(key, {
        steamid64: key,
        name: row.name || null,
        team_number: row.team_number ?? null,
        team_name: row.team_name || null,
        observations: [],
        viewmodel: null,
      });
    }
    const p = byId.get(key);
    if (!p.name && row.name) p.name = row.name;
    if (p.team_number == null && row.team_number != null) p.team_number = row.team_number;
    if (!p.team_name && row.team_name) p.team_name = row.team_name;

    p.observations.push({ tick: row.tick, code });

    // viewmodel 属性名因 demo 而异，取第一次出现的非空值
    if (!p.viewmodel) {
      const vm = {};
      let any = false;
      for (const prop of parsed.props.viewmodel) {
        if (row[prop] !== undefined && row[prop] !== null) {
          vm[prop] = row[prop];
          any = true;
        }
      }
      if (any) p.viewmodel = vm;
    }
  }

  // 补上 parsePlayerInfo 里有、但采样 tick 上没出现的选手（比如中途掉线）
  for (const info of parsed.playerInfo || []) {
    const key = String(info.steamid || "");
    if (!key || isBot(key) || byId.has(key)) continue;
    byId.set(key, {
      steamid64: key,
      name: info.name || null,
      team_number: info.team_number ?? null,
      team_name: null,
      observations: [],
      viewmodel: null,
    });
  }

  for (const p of byId.values()) {
    p.observations.sort((a, b) => a.tick - b.tick);
    p.final_code = p.observations.length ? p.observations[p.observations.length - 1].code : null;
    p.changed_mid_demo = new Set(p.observations.map((o) => o.code)).size > 1;
  }

  return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

module.exports = {
  findDemos,
  sha256File,
  readSidecar,
  discoverProps,
  lastRoundEndTick,
  sampleTicks,
  parseDemo,
  groupByPlayer,
  isBot,
};
