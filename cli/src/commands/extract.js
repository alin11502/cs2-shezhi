"use strict";

const fs = require("fs");
const path = require("path");

const cfg = require("../config");
const log = require("../log");
const demo = require("../demo");
const crosshair = require("../crosshair");
const { envelope, validate } = require("../export-format");
const state = require("../state");

// demoparser2 暴露的 viewmodel 属性名因 demo 版本而异，这里按语义归一到
// crosshair_snapshots 的列名。认不出来的属性原样保留在 viewmodel_raw 里。
const VIEWMODEL_MAP = [
  [/fov/i, "viewmodel_fov"],
  [/offset[_-]?x$|offsetx/i, "viewmodel_offset_x"],
  [/offset[_-]?y$|offsety/i, "viewmodel_offset_y"],
  [/offset[_-]?z$|offsetz/i, "viewmodel_offset_z"],
  [/preset[_-]?pos/i, "viewmodel_presetpos"],
];

function mapViewmodel(raw) {
  if (!raw) return { mapped: {}, unmapped: {} };
  const mapped = {};
  const unmapped = {};
  for (const [prop, value] of Object.entries(raw)) {
    const key = String(prop).replace(/^m_[a-zA-Z]*Viewmodel/i, "viewmodel");
    const hit = VIEWMODEL_MAP.find(([re]) => re.test(prop) || re.test(key));
    if (hit) mapped[hit[1]] = value;
    else unmapped[prop] = value;
  }
  return { mapped, unmapped };
}

// captured_at 决定前台准星历史的排序，优先用真实比赛日期。
// parseHeader 拿不到日期，所以顺序是：sidecar/CLI 指定 > demo 文件 mtime。
function resolveCapturedAt(overrides, sidecar, parsed) {
  const raw = overrides.match_date || sidecar.match_date || parsed.mtime;
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    log.warn(`无法解析日期 "${raw}"，退回 demo 文件 mtime`);
    return new Date(parsed.mtime).toISOString();
  }
  return d.toISOString();
}

async function extractOne(demoPath, overrides, opts) {
  const parsed = await demo.parseDemo(demoPath, {
    maxSampleTicks: opts.maxSampleTicks,
    skipPropDiscovery: opts.skipPropDiscovery,
  });

  log.info(`${parsed.filename}：map=${parsed.header.map_name || "?"}，采样 ${parsed.ticks.length} tick`);

  const sha256 = await demo.sha256File(parsed.path);
  const players = demo.groupByPlayer(parsed);
  if (!players.length) {
    log.warn(`${parsed.filename}：没有解析到任何人类选手，跳过`);
    return null;
  }

  const captured_at = resolveCapturedAt(overrides, parsed.sidecar, parsed);
  const unknownSeen = new Set();
  const outPlayers = [];

  for (const p of players) {
    if (!p.final_code) {
      log.debug(`${p.name}：所有采样 tick 上都没有 crosshair_code，跳过`);
      continue;
    }

    let decoded;
    try {
      decoded = await crosshair.decode(p.final_code);
    } catch (e) {
      // 库对畸形码抛 InvalidCrosshairShareCode。记下来继续，不让一个坏码毁掉整场
      log.warn(`${p.name}：准星码解码失败（${e.constructor.name}），已跳过：${p.final_code}`);
      continue;
    }
    for (const u of crosshair.unknownFields(decoded)) unknownSeen.add(u);

    const vm = mapViewmodel(p.viewmodel);

    outPlayers.push({
      steamid64: p.steamid64,
      name: p.name,
      team_number: p.team_number,
      team_name: p.team_name,
      crosshair: {
        code: p.final_code,
        captured_at,
        params: crosshair.pickEncoded(decoded),
        // 显式标注这四个是引擎默认值、不是选手配置，前台不得当作设置展示
        not_in_code: crosshair.pickNotInCode(decoded),
        raw: decoded,
      },
      viewmodel: Object.keys(vm.mapped).length ? vm.mapped : null,
      viewmodel_raw: Object.keys(vm.unmapped).length ? vm.unmapped : null,
      changed_mid_demo: p.changed_mid_demo,
      observations: p.observations,
    });
  }

  if (unknownSeen.size) {
    log.warn(
      `${parsed.filename}：解码器返回了 schema 未覆盖的字段 [${[...unknownSeen].join(", ")}]。` +
        `这些字段目前只存在 raw 里，若要展示需更新 server/pb_migrations。`
    );
  }

  const sc = parsed.sidecar;
  return {
    sha256,
    filename: parsed.filename,
    size_bytes: parsed.size_bytes,
    source_path: parsed.path,
    sharecode: overrides.sharecode || sc.sharecode || null,
    match_date: captured_at,
    event: overrides.event || sc.event || null,
    map: parsed.header.map_name || sc.map || null,
    team_a: overrides.team_a || sc.team_a || null,
    team_b: overrides.team_b || sc.team_b || null,
    source_url: overrides.source_url || sc.source_url || null,
    batch: overrides.batch || sc.batch || null,
    tick_rate: Number(parsed.header.tick_rate) || null,
    server_name: parsed.header.server_name || null,
    network_protocol: parsed.header.network_protocol || null,
    parser_version: require("@laihoe/demoparser2/package.json").version,
    sampled_ticks: parsed.ticks,
    props_discovered: parsed.props.all.length ? parsed.props.all : undefined,
    players: outPlayers,
  };
}

function resolveTargets(args, opts) {
  if (args.length) return args.map((a) => path.resolve(a));
  const dir = opts.demoDir || cfg.demoDir;
  if (!dir) {
    throw new Error("没有指定 demo。请传入路径，或在 cli/.env 里设置 DEMO_DIR。");
  }
  if (!fs.existsSync(dir)) throw new Error(`DEMO_DIR 不存在：${dir}`);
  const found = demo.findDemos(dir);
  if (!found.length) throw new Error(`${dir} 下没有找到 .dem 文件`);
  return found;
}

async function run(args, opts) {
  const targets = resolveTargets(args, opts);
  log.info(`待处理 ${targets.length} 个 demo`);

  const st = state.load(cfg.stateFile);
  const demos = [];
  const failed = [];

  for (const t of targets) {
    try {
      const doc = await extractOne(t, opts.meta || {}, opts);
      if (doc) demos.push(doc);
    } catch (e) {
      log.error(`${path.basename(t)}：${e.message}`);
      failed.push({ path: t, error: e.message });
    }
  }

  if (!demos.length) {
    log.error("没有任何 demo 提取成功");
    return { ok: false, demos: 0, failed };
  }

  const extra = {
    generator: {
      demoparser2: require("@laihoe/demoparser2/package.json").version,
      csgo_sharecode: require("csgo-sharecode/package.json").version,
    },
  };
  const doc = envelope(demos, extra);

  const errors = validate(doc);
  if (errors.length) {
    log.error("导出的文档未通过自校验，拒绝写出：");
    errors.forEach((e) => log.error("  - " + e));
    return { ok: false, demos: demos.length, failed, validation: errors };
  }

  fs.mkdirSync(cfg.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(cfg.outDir, `crosshairs-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2));

  for (const d of demos) {
    state.markExtracted(st, d.sha256, {
      filename: d.filename,
      map: d.map,
      players: d.players.length,
      export_file: outFile,
    });
  }
  state.save(cfg.stateFile, st);

  const totalPlayers = demos.reduce((n, d) => n + d.players.length, 0);
  log.ok(`已导出 ${demos.length} 个 demo、${totalPlayers} 名选手 → ${outFile}`);
  if (failed.length) log.warn(`${failed.length} 个 demo 失败`);

  if (opts.json) log.out({ ok: true, file: outFile, demos: demos.length, players: totalPlayers, failed });
  return { ok: true, file: outFile, demos: demos.length, players: totalPlayers, failed };
}

module.exports = { run, mapViewmodel, resolveCapturedAt };
