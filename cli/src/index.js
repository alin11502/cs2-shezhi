#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");

const log = require("./log");
const cfg = require("./config");

const HELP = `cs2cx — 从 CS2 demo 提取职业选手准星码并导入 cs2-shezhi 站点

用法：
  cs2cx <命令> [参数] [选项]

命令：
  scan [目录]              列出 demo 文件及处理状态
  extract [demo...]        解析 demo，提取并解码准星码，导出 JSON
  push [文件...]           把导出的 JSON 导入 PocketBase
  decode <准星码...>       解一个准星分享码，不碰 demo
  doctor                   自检：原生模块、配置、PocketBase、导入端点

通用选项：
  --json                   结构化输出到 stdout（日志仍走 stderr）
  -v, --verbose            打印调试信息
  -h, --help               显示帮助

scan 选项：
  --hash                   计算 sha256 并显示已提取/已导入状态（需读完整文件，慢）

extract 选项：
  --event <名称>           赛事名，写入 demos.event
  --date <YYYY-MM-DD>      比赛日期，决定准星历史的 captured_at 排序
  --team-a <名称>          队伍 A
  --team-b <名称>          队伍 B
  --source-url <url>       demo 来源链接
  --sharecode <码>         比赛分享码
  --batch <标签>           批次标签，便于回溯这批数据是哪次导入的
  --max-ticks <n>          最多采样多少个 tick（默认 ${cfg.maxSampleTicks}）
  --skip-prop-discovery    跳过属性探测，只取 crosshair_code（更快，但拿不到 viewmodel）

push 选项：
  --dry-run                只校验不写库
  --force                  重推已导入过的 demo（端点按 sha256 幂等，不会产生重复）

decode 选项：
  --convars                同时输出可直接放进 autoexec.cfg 的 CFG 文本

说明：
  extract/push 不带参数时，分别使用 cli/.env 里的 DEMO_DIR 和 OUT_DIR。
  demo 旁边可放同名 <name>.meta.json 补充赛事、日期、队名等 parseHeader 拿不到的信息，
  命令行选项的优先级高于 meta.json。

  准星码携带全部 21 项参数。其中 split_distance / inner_split_alpha /
  outer_split_alpha / split_size_ratio 是动态准星（style=4）的分裂行为参数：
  静态样式下不影响外观，但始终编码在码里（bytes[8]/[10]/[11]），是选手的真实
  设置，会原样导出、原样写进 CFG。
`;

// 极简参数解析：位置参数进 args，--flag value 进 opts。
function parseArgv(argv) {
  const args = [];
  const opts = {};
  const meta = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) {
      args.push(a);
      continue;
    }
    if (a === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }
    const eq = a.indexOf("=");
    const key = (eq > 0 ? a.slice(0, eq) : a).replace(/^-+/, "");
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;

    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    // 布尔开关：没有内联值，且下一个 token 也是选项
    if (inline === undefined && (next === undefined || next.startsWith("-"))) {
      opts[camel] = true;
      continue;
    }
    const value = inline !== undefined ? inline : next;
    if (inline === undefined) i++;
    opts[camel] = value;

    // 这几个是 demo 元数据，归拢到 meta 里传给 extract
    if (["event", "date", "teamA", "teamB", "sourceUrl", "sharecode", "batch"].includes(camel)) {
      const keyMap = { date: "match_date", teamA: "team_a", teamB: "team_b", sourceUrl: "source_url" };
      meta[keyMap[camel] || camel] = value;
    }
  }

  if (opts.verbose || opts.v) log.setVerbose(true);
  if (meta && Object.keys(meta).length) opts.meta = meta;
  if (opts.maxTicks) opts.maxSampleTicks = Number(opts.maxTicks);
  if (opts.skipPropDiscovery) opts.skipPropDiscovery = true;
  if (opts.dryRun) opts.dryRun = true;

  return { args, opts };
}

async function doctor() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // 1. 原生模块能否加载（Windows 上最容易出问题的一环）
  try {
    const dp = require("@laihoe/demoparser2");
    const fns = ["parseTicks", "parsePlayerInfo", "parseHeader", "parseEvent", "listUpdatedFields"];
    const missing = fns.filter((f) => typeof dp[f] !== "function");
    add("demoparser2 原生模块", !missing.length, missing.length ? `缺少 ${missing.join(", ")}` : `v${require("@laihoe/demoparser2/package.json").version}，${fns.length} 个函数可用`);
  } catch (e) {
    add("demoparser2 原生模块", false, e.message);
  }

  // 2. ESM 依赖能否动态导入
  try {
    const sc = await import("csgo-sharecode");
    const need = ["decodeCrosshairShareCode", "encodeCrosshair", "crosshairToConVars"];
    const missing = need.filter((f) => typeof sc[f] !== "function");
    add("csgo-sharecode", !missing.length, missing.length ? `缺少 ${missing.join(", ")}` : `v${require("csgo-sharecode/package.json").version}`);
  } catch (e) {
    add("csgo-sharecode", false, e.message);
  }

  // 3. 编解码往返
  try {
    const crosshair = require("./crosshair");
    const probe = {
      style: 4, length: 5, thickness: 1, gap: -2, color: 1, red: 0, green: 255, blue: 0,
      alpha_enabled: true, alpha: 255, outline_enabled: true, outline: 1,
      center_dot_enabled: false, follow_recoil: false, fixed_crosshair_gap: 0,
      t_style_enabled: false, deployed_weapon_gap_enabled: true,
      // 这 4 项必须用**非默认值**，否则自检永远测不到它们、等于空转。
      // 早先 probe 里没有这 4 项，正是数据丢失 bug 能长期潜伏的原因：
      // encode 无条件用默认值覆盖它们，而 probe 恰好不提供，往返自然"一致"。
      split_distance: 3, inner_split_alpha: 0.1, outer_split_alpha: 1, split_size_ratio: 1,
    };
    const code = await crosshair.encode(probe);
    const back = await crosshair.decode(code);
    const mapped = crosshair.pickEncoded(back);
    const diffs = Object.keys(probe).filter((k) => probe[k] !== mapped[k]);
    const n = Object.keys(probe).length;
    add("准星码编解码往返", !diffs.length && n === 21,
      diffs.length ? `字段不一致: ${diffs.join(", ")}` : `${code} → ${n} 项全部一致`);
  } catch (e) {
    add("准星码编解码往返", false, e.message);
  }

  // 3b. 真实码必须能字节级还原。这条能抓住"用默认值覆盖真值"这类静默数据丢失：
  // 该码解出的 split 参数是 3/0.1/1/1，若 encode 把它们抹成默认值，重编码就会变码。
  try {
    const crosshair = require("./crosshair");
    const real = "CSGO-UseJt-3oTvn-47wPX-hEyER-WZfiK";
    const params = crosshair.pickEncoded(await crosshair.decode(real));
    const reencoded = await crosshair.encode(params);
    add("真实码字节级还原", reencoded === real,
      reencoded === real ? `${real} 重编码后完全一致` : `原码 ${real} → 重编码 ${reencoded}（说明有字段被覆盖或丢失）`);
  } catch (e) {
    add("真实码字节级还原", false, e.message);
  }

  // 4. 配置
  add("cli/.env", fs.existsSync(path.join(cfg.CLI_DIR, ".env")), fs.existsSync(path.join(cfg.CLI_DIR, ".env")) ? "已找到" : "不存在（将使用默认值与环境变量）");
  add("DEMO_DIR", !!cfg.demoDir && fs.existsSync(cfg.demoDir), cfg.demoDir || "未设置");
  add("OUT_DIR", !!cfg.outDir, cfg.outDir);

  // 5. PocketBase
  const pb = require("./pb");
  try {
    await pb.health();
    add("PocketBase 连通", true, cfg.pbUrl);
  } catch (e) {
    add("PocketBase 连通", false, `${cfg.pbUrl} — ${e.message}`);
  }

  try {
    await pb.getToken();
    add("PocketBase 凭证", true, cfg.pbToken ? "PB_TOKEN" : `PB_ADMIN_EMAIL=${cfg.pbAdminEmail}`);
  } catch (e) {
    add("PocketBase 凭证", false, e.message);
  }

  try {
    const r = await pb.importEndpointReady();
    add("导入端点 " + pb.IMPORT_PATH, r.ready, r.ready ? "已注册" : r.reason);
  } catch (e) {
    add("导入端点 " + pb.IMPORT_PATH, false, e.message);
  }

  const w = Math.max(...checks.map((c) => c.name.length));
  log.plain("cs2cx 自检\n");
  for (const c of checks) log.plain(`  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(w)}  ${c.detail}`);
  const bad = checks.filter((c) => !c.ok);
  log.plain(`\n  ${checks.length - bad.length}/${checks.length} 项通过`);
  return { ok: !bad.length, checks };
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  const { args, opts } = parseArgv(argv.slice(1));
  if (opts.help || opts.h) {
    process.stdout.write(HELP);
    return 0;
  }

  switch (cmd) {
    case "scan":
      return (await require("./commands/scan").run(args, opts)).ok ? 0 : 1;
    case "extract":
      return (await require("./commands/extract").run(args, opts)).ok ? 0 : 1;
    case "push":
      return (await require("./commands/push").run(args, opts)).ok ? 0 : 1;
    case "decode":
      return (await require("./commands/decode").run(args, opts)).ok ? 0 : 1;
    case "doctor":
      return (await doctor()).ok ? 0 : 1;
    default:
      log.error(`未知命令：${cmd}`);
      process.stdout.write(HELP);
      return 2;
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    log.error(e.message || e);
    if (log.isVerbose() && e.stack) log.plain(e.stack);
    process.exit(1);
  });
