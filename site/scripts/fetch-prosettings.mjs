#!/usr/bin/env node
/**
 * 从 prosettings.net 抓取**非准星设置**，产出待审草稿（不直接入库）。
 *
 * 取数边界（可行性核查得出的结论，务必遵守）：
 * - prosettings 的准星只有**展示值**（data-field + <td> 文本），正文没有准星码，
 *   页面上的 CSGO- 码全在评论区（wpd-comment 容器），不可信。
 * - style 的显示名→数值映射无法可靠验证（"Classic Static"→1 没问题，
 *   但 3/4 的命名在各来源说法不一）。所以**本脚本不抓准星**：
 *   准星只来自 demo 提取（cs2cx extract）或选手本人发布的码，绝不从展示值猜。
 * - 数值类字段（dpi / sensitivity / resolution / 刷新率 / viewmodel）无歧义，可以抓。
 *
 * 合规：robots.txt 只封查询参数过滤器与 WP 端点，不封选手页；仍保持低频率
 * （每次请求间隔 ≥1.5s）与自定义 UA，抓到即缓存，不重复请求。
 *
 * 用法：
 *   node scripts/fetch-prosettings.mjs s1mple donk zywoo
 *   产出 site/scripts/seed/prosettings-draft.json，人工审过后再用
 *   node scripts/seed.mjs --file <draft> 入库。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "seed", "prosettings-draft.json");
const CACHE_DIR = path.join(HERE, ".prosettings-cache");
const UA = "cs2-shezhi-data-bot/0.1 (+contact: site owner; low-frequency research fetch)";
const DELAY_MS = 1500;

const log = (...a) => process.stderr.write(`[prosettings] ${a.join(" ")}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 展示值 → 入库值 的映射。只映射无歧义的字段；映射不了就 null + 警告，绝不猜。 */
const SCALING = { stretched: "stretch", "black bars": "black_bars", aspect: "aspect" };
const DISPLAY = { fullscreen: "fullscreen", windowed: "windowed", borderless: "borderless", "fullscreen windowed": "borderless" };
const CONTRAST = { enabled: "enabled", disabled: "disabled" };

const num = (s) => {
  if (s == null) return null;
  const n = Number(String(s).replace(/[%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function mapField(field, raw) {
  const v = String(raw).trim();
  const lower = v.toLowerCase();
  switch (field) {
    case "dpi": case "sensitivity": case "edpi": case "zoomsensitivity":
    case "hz": case "windowssensitivity": case "brightness":
    case "fov": case "offsetx": case "offsety": case "offsetz": case "presetpos":
      return num(v);
    case "resolution": return v || null;
    case "aspectratio": return v || null;
    case "scalingmode": return SCALING[lower] ?? null;
    case "displaymode": return DISPLAY[lower] ?? null;
    case "boostplayercontrast": return CONTRAST[lower] ?? null;
    case "mouse": case "keyboard": case "monitor": case "headset": case "mousepad":
      return v || null;
    default:
      return undefined; // 未知字段：跳过并警告
  }
}

/** 解析设置表：field-* 的 data-field + <th>/<td> */
function parseSettingsTable(html) {
  const rows = [...html.matchAll(/<tr class="format-[a-z]+ field-([a-z0-9]+)"[^>]*>\s*<th>([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g)];
  const clean = (s) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&#8211;/g, "-").replace(/\s+/g, " ").trim();
  const out = {};
  const unmapped = [];
  for (const [, field, , td] of rows) {
    const mapped = mapField(field, clean(td));
    if (mapped === undefined) unmapped.push(field);
    else out[field] = mapped;
  }
  return { out, unmapped };
}

function parseIdentity(html) {
  const clean = (s) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const grab = (field) => {
    const m = html.match(new RegExp(`<tr class="format-[a-z]+ field-${field}"[^>]*>\\s*<th>[\\s\\S]*?</th>\\s*<td>([\\s\\S]*?)</td>`));
    return m ? clean(m[1]) : null;
  };
  return { name: grab("name"), country: grab("country"), team: grab("team") };
}

async function fetchPlayer(slug) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${slug}.html`);
  if (fs.existsSync(cacheFile)) {
    log(`${slug}: 用缓存`);
    return fs.readFileSync(cacheFile, "utf8");
  }
  const url = `https://prosettings.net/players/${slug}/`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  const html = await res.text();
  fs.writeFileSync(cacheFile, html);
  await sleep(DELAY_MS);
  return html;
}

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    log("用法: node scripts/fetch-prosettings.mjs <slug> [slug...]");
    process.exit(2);
  }

  const players = [];
  for (const slug of slugs) {
    try {
      const html = await fetchPlayer(slug);
      const id = parseIdentity(html);
      const { out, unmapped } = parseSettingsTable(html);
      if (unmapped.length) log(`${slug}: 跳过未映射字段 ${unmapped.join(", ")}`);

      const settings = {
        sensitivity: out.sensitivity ?? null,
        dpi: out.dpi ?? null,
        edpi: out.edpi ?? null,
        zoom_sensitivity: out.zoomsensitivity ?? null,
        windows_sensitivity: out.windowssensitivity ?? null,
        polling_rate: out.hz ?? null,
        raw_input: null,
        resolution: out.resolution ?? null,
        aspect_ratio: out.aspectratio ?? null,
        scaling_mode: out.scalingmode ?? null,
        refresh_rate: out.hz ?? null,
        brightness: out.brightness ?? null,
        display_mode: out.displaymode ?? null,
        multisampling: null,
        boost_player_contrast: out.boostplayercontrast ?? null,
        mouse: out.mouse ?? null,
        mousepad: out.mousepad ?? null,
        keyboard: out.keyboard ?? null,
        headset: out.headset ?? null,
        monitor: out.monitor ?? null,
        launch_options: null,
        // 每条都带证据链接与核对日期；置信度最高 medium（第三方人工维护）
        source: "third_party",
        confidence: "medium",
        evidence_url: `https://prosettings.net/players/${slug}/`,
        notes: "设置取自 prosettings.net 展示值；准星不在此来源抓取（展示值→style 映射不可靠），准星另由 demo 提取或选手本人发布的码提供。",
        verified_at: new Date().toISOString().slice(0, 10),
      };

      players.push({
        // prosettings 的 name 字段是真实姓名；站点的 name 用游戏 ID（= URL slug），
        // 真实姓名进 real_name。否则标题用真实姓名会超 60 字符，也不符合内容站习惯。
        slug,
        name: slug,
        real_name: id.name,
        country: id.country ? id.country.slice(0, 2).toUpperCase() : null,
        team: id.team,
        settings,
      });
      log(`${slug}: 解析到 ${Object.values(settings).filter((v) => v !== null && v !== undefined).length} 个非空字段`);
    } catch (e) {
      log(`${slug}: 失败 —— ${e.message}`);
    }
  }

  if (players.length === 0) {
    log("没有抓到任何选手");
    process.exit(1);
  }

  // seed.mjs 按 slug 在 teams 数组里查战队，所以草稿必须自带 teams，
  // 且 player.team 指向 slug 而不是 prosettings 的显示名
  const slugify = (s) =>
    String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const teamByName = new Map();
  for (const p of players) {
    if (!p.team) continue;
    if (!teamByName.has(p.team)) teamByName.set(p.team, slugify(p.team));
    p.team = teamByName.get(p.team);
  }
  const teams = [...teamByName.entries()].map(([name, slug]) => ({
    slug, name, tag: null, region: null, active: true,
  }));

  const draft = {
    _comment: [
      "prosettings.net 抓取草稿 —— 人工审过之前不要入库。",
      "只含非准星设置；准星由 demo 提取或选手本人发布的码另行提供。",
      "入库: node scripts/seed.mjs --file scripts/seed/prosettings-draft.json",
    ],
    provenance: {
      source: "third_party",
      confidence: "medium",
      evidence_url: "https://prosettings.net/",
      verified_at: new Date().toISOString().slice(0, 10),
      notes: "prosettings.net 展示值；准星不在此来源抓取。",
    },
    teams,
    players,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(draft, null, 2));
  log(`草稿已写出: ${OUT}（${players.length} 名选手）`);
}

main();
