"use strict";

// 导入端点集成测试。需要一个跑着的 PocketBase（server/dev.sh start）。
//
// 用 CLI 自己的 pb.js 客户端和 crosshair.encode() 生成真准星码，
// 所以这个测试同时覆盖了「导出格式契约」和「PocketBase 客户端」。
//
// 不需要真实 demo 文件——demo 解析那一步由 extract 命令负责，
// 这里直接构造 extract 的产物，验证从产物到入库的完整链路。

const fs = require("fs");
const path = require("path");
const os = require("os");

const cfg = require("../src/config");
const pb = require("../src/pb");
const crosshair = require("../src/crosshair");
const { envelope } = require("../src/export-format");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

function section(t) {
  console.log(`\n\x1b[36m${t}\x1b[0m`);
}

// 测试专用 steamid：765611 + 11 位，符合 SteamID64 形状，且用 999 前缀便于清理
const SID = (n) => `76561199900000${String(n).padStart(3, "0")}`;
const TEST_BATCH = "selftest-batch";

// 造一个合法的准星码。参数可变，便于模拟"选手换了准星"。
async function makeCode(over = {}) {
  return crosshair.encode({
    style: 4, length: 5, thickness: 1, gap: -2, color: 1,
    red: 0, green: 255, blue: 0, alpha_enabled: true, alpha: 255,
    outline_enabled: true, outline: 1, center_dot_enabled: false,
    follow_recoil: false, fixed_crosshair_gap: 0, t_style_enabled: false,
    deployed_weapon_gap_enabled: true,
    ...over,
  });
}

function sha(n) {
  // 64 位十六进制的假 sha256，仅测试用
  return String(n).padStart(64, "0").replace(/[^a-f0-9]/g, "a");
}

function player(n, name, code, extra = {}) {
  return {
    steamid64: SID(n),
    name,
    team_number: n <= 5 ? 2 : 3,
    crosshair: {
      code,
      captured_at: extra.captured_at || "2026-02-14T18:30:00.000Z",
      params: extra.params || null,
      not_in_code: { split_distance: 2, inner_split_alpha: 0.8, outer_split_alpha: 0.4, split_size_ratio: 1.5 },
      raw: extra.raw || {},
    },
    observations: extra.observations || [{ tick: 100, code }],
  };
}

function demoDoc(n, players, over = {}) {
  return {
    sha256: sha(n),
    filename: `test-match-${n}.dem`,
    size_bytes: 1000000 + n,
    sharecode: null,
    match_date: over.match_date || "2026-02-14T18:30:00.000Z",
    event: over.event || "Selftest Major",
    map: over.map || "de_mirage",
    team_a: "Alpha",
    team_b: "Beta",
    source_url: null,
    batch: TEST_BATCH,
    tick_rate: 64,
    parser_version: "0.42.0",
    sampled_ticks: [100, 200],
    players,
    ...over,
  };
}

async function listRecords(collection, filter) {
  const token = await pb.getToken();
  const q = filter ? `&filter=${encodeURIComponent(filter)}` : "";
  return pb.request("GET", `/api/collections/${collection}/records?perPage=200${q}`, { token });
}

async function cleanup() {
  const token = await pb.getToken();
  // 先删测试选手（cascadeDelete 会带走他们的 snapshot 和 keybinds）
  for (let n = 1; n <= 10; n++) {
    try {
      const rs = await listRecords("players", `steamid64="${SID(n)}"`);
      for (const r of rs.items || []) {
        await pb.request("DELETE", `/api/collections/players/records/${r.id}`, { token });
      }
    } catch (_) {}
  }
  // 再删测试 demo
  for (let n = 1; n <= 10; n++) {
    try {
      const rs = await listRecords("demos", `sha256="${sha(n)}"`);
      for (const r of rs.items || []) {
        await pb.request("DELETE", `/api/collections/demos/records/${r.id}`, { token });
      }
    } catch (_) {}
  }
  // 兜底：残留的 snapshot（player 已删但 cascade 没生效的情况）
  try {
    const rs = await listRecords("crosshair_snapshots", `batch="${TEST_BATCH}"`);
    for (const r of rs.items || []) {
      await pb.request("DELETE", `/api/collections/crosshair_snapshots/records/${r.id}`, { token });
    }
  } catch (_) {}
}

async function main() {
  console.log(`\ncs2cx 导入端点集成测试  →  ${cfg.pbUrl}\n`);

  try {
    await pb.health();
  } catch (e) {
    console.error(`\x1b[31m连不上 PocketBase（${cfg.pbUrl}）：${e.message}\x1b[0m`);
    console.error("先运行：cd server && ./dev.sh start");
    process.exit(2);
  }

  const ready = await pb.importEndpointReady();
  if (!ready.ready) {
    console.error(`\x1b[31m导入端点不可用：${ready.reason}\x1b[0m`);
    process.exit(2);
  }

  section("清理旧测试数据");
  await cleanup();
  console.log("  已清理");

  // ---------- 1. 首次导入 ----------
  section("1. 首次导入：1 个 demo / 3 名选手");
  const codeA = await makeCode({ length: 5 });
  const codeB = await makeCode({ length: 8, color: 6, red: 255, green: 0, blue: 128 });
  const codeC = await makeCode({ style: 2, gap: -1, center_dot_enabled: true });

  const doc1 = envelope([demoDoc(1, [
    { ...player(1, "TestAlpha", codeA), crosshair: { ...(player(1, "TestAlpha", codeA).crosshair), params: crosshair.pickEncoded(await crosshair.decode(codeA)) } },
    { ...player(2, "TestBravo", codeB), crosshair: { ...(player(2, "TestBravo", codeB).crosshair), params: crosshair.pickEncoded(await crosshair.decode(codeB)) } },
    { ...player(3, "TestCharlie", codeC), crosshair: { ...(player(3, "TestCharlie", codeC).crosshair), params: crosshair.pickEncoded(await crosshair.decode(codeC)) } },
  ])]);

  const r1 = await pb.importDoc(doc1);
  check("返回 200 且 demos_new=1", r1.summary.demos_new === 1, JSON.stringify(r1.summary));
  check("新建 3 名选手", r1.summary.players_created === 3, JSON.stringify(r1.created_players));
  check("新建 3 条 snapshot", r1.summary.snapshots_created === 3, JSON.stringify(r1.summary));
  check("无 history_advanced（首次入库）", r1.summary.history_advanced === 0);

  const snaps1 = await listRecords("crosshair_snapshots", `batch="${TEST_BATCH}"`);
  check("库里确实有 3 条 snapshot", (snaps1.items || []).length === 3, `实际 ${(snaps1.items || []).length}`);
  check("3 条都是 is_current", (snaps1.items || []).every((s) => s.is_current === true));

  // 准星参数要真的落库，而不是只存了码
  const alphaSnap = (snaps1.items || []).find((s) => s.code === codeA);
  check("准星参数已解码入库（length=5）", alphaSnap && alphaSnap.length === 5, alphaSnap ? `length=${alphaSnap.length}` : "找不到记录");
  const bravoSnap = (snaps1.items || []).find((s) => s.code === codeB);
  check("自定义颜色已入库（color=6, red=255, blue=128）",
    bravoSnap && bravoSnap.color === 6 && bravoSnap.red === 255 && bravoSnap.blue === 128,
    bravoSnap ? `color=${bravoSnap.color} red=${bravoSnap.red} blue=${bravoSnap.blue}` : "找不到记录");

  // 那四个不在码里的字段绝不能建成列
  check("not_in_code 四项未污染 snapshot",
    alphaSnap && alphaSnap.split_distance === undefined && alphaSnap.split_size_ratio === undefined);

  // ---------- 2. 幂等性 ----------
  section("2. 重复导入同一份（幂等性）");
  const r2 = await pb.importDoc(doc1);
  check("demos_already_known=1，没有新建 demo", r2.summary.demos_already_known === 1 && r2.summary.demos_new === 0, JSON.stringify(r2.summary));
  check("走的是 updated 而不是 created", r2.summary.snapshots_updated === 3 && r2.summary.snapshots_created === 0, JSON.stringify(r2.summary));
  check("没有重复建选手", r2.summary.players_created === 0, JSON.stringify(r2.created_players));

  const snaps2 = await listRecords("crosshair_snapshots", `batch="${TEST_BATCH}"`);
  check("snapshot 总数仍是 3（无重复）", (snaps2.items || []).length === 3, `实际 ${(snaps2.items || []).length}`);
  const players2 = await listRecords("players", `steamid64~"765611999"`);
  check("选手总数仍是 3（无重复）", (players2.items || []).length === 3, `实际 ${(players2.items || []).length}`);

  // ---------- 3. 同一准星在新比赛复现 ----------
  section("3. 新 demo，准星未变 → 应复现而非新建历史");
  const doc3 = envelope([demoDoc(2, [
    { ...player(1, "TestAlpha", codeA), crosshair: { ...(player(1, "TestAlpha", codeA).crosshair), captured_at: "2026-03-01T18:30:00.000Z", params: crosshair.pickEncoded(await crosshair.decode(codeA)) } },
  ], { match_date: "2026-03-01T18:30:00.000Z", event: "Selftest Major II" })]);

  const r3 = await pb.importDoc(doc3);
  check("snapshots_reconfirmed=1", r3.summary.snapshots_reconfirmed === 1, JSON.stringify(r3.summary));
  check("没有新建 snapshot", r3.summary.snapshots_created === 0, JSON.stringify(r3.summary));

  const snaps3 = await listRecords("crosshair_snapshots", `batch="${TEST_BATCH}"`);
  check("snapshot 总数仍是 3", (snaps3.items || []).length === 3, `实际 ${(snaps3.items || []).length}`);
  const alphaNow = (snaps3.items || []).find((s) => s.code === codeA);
  check("last_seen_at 已推进到 2026-03-01",
    alphaNow && String(alphaNow.last_seen_at || "").startsWith("2026-03-01"),
    alphaNow ? `last_seen_at=${alphaNow.last_seen_at}` : "找不到");
  check("captured_at 仍是最初的 2026-02-14（历史起点不变）",
    alphaNow && String(alphaNow.captured_at || "").startsWith("2026-02-14"),
    alphaNow ? `captured_at=${alphaNow.captured_at}` : "找不到");

  // ---------- 4. 选手换准星 ----------
  section("4. 选手换准星 → 旧版本降级，新版本成为 current");
  const codeA2 = await makeCode({ length: 12, thickness: 2 });
  const doc4 = envelope([demoDoc(3, [
    { ...player(1, "TestAlpha", codeA2), crosshair: { ...(player(1, "TestAlpha", codeA2).crosshair), captured_at: "2026-04-01T18:30:00.000Z", params: crosshair.pickEncoded(await crosshair.decode(codeA2)) } },
  ], { match_date: "2026-04-01T18:30:00.000Z" })]);

  const r4 = await pb.importDoc(doc4);
  check("snapshots_created=1", r4.summary.snapshots_created === 1, JSON.stringify(r4.summary));
  check("history_advanced=1（旧版本被降级）", r4.summary.history_advanced === 1, JSON.stringify(r4.summary));

  const alphaId = (await listRecords("players", `steamid64="${SID(1)}"`)).items[0].id;
  const alphaSnaps = await listRecords("crosshair_snapshots", `player="${alphaId}"`);
  check("TestAlpha 有 2 条历史", (alphaSnaps.items || []).length === 2, `实际 ${(alphaSnaps.items || []).length}`);
  const currents = (alphaSnaps.items || []).filter((s) => s.is_current === true);
  check("其中只有 1 条 is_current", currents.length === 1, `实际 ${currents.length}`);
  check("current 是新准星码", currents.length === 1 && currents[0].code === codeA2);
  const old = (alphaSnaps.items || []).find((s) => s.code === codeA);
  check("旧版本已降级为 is_current=false", old && old.is_current === false);

  // ---------- 5. dry-run 不写库 ----------
  section("5. dry-run 只校验不写库");
  const before = await listRecords("crosshair_snapshots", `batch="${TEST_BATCH}"`);
  const codeD = await makeCode({ length: 20 });
  const docDry = envelope([demoDoc(4, [
    { ...player(4, "TestDelta", codeD), crosshair: { ...(player(4, "TestDelta", codeD).crosshair), params: crosshair.pickEncoded(await crosshair.decode(codeD)) } },
  ])]);
  const rDry = await pb.importDoc(docDry, { dryRun: true });
  check("dry_run=true", rDry.summary.dry_run === true, JSON.stringify(rDry.summary));
  check("dry-run 报告了将要创建的量", rDry.summary.snapshots_created === 1 && rDry.summary.players_created === 1, JSON.stringify(rDry.summary));

  const after = await listRecords("crosshair_snapshots", `batch="${TEST_BATCH}"`);
  check("库里记录数没变（事务已回滚）", (before.items || []).length === (after.items || []).length,
    `before=${(before.items || []).length} after=${(after.items || []).length}`);
  const deltaPlayers = await listRecords("players", `steamid64="${SID(4)}"`);
  check("dry-run 没有建选手", (deltaPlayers.items || []).length === 0, `实际 ${(deltaPlayers.items || []).length}`);

  // ---------- 6. 异常输入 ----------
  section("6. 异常输入");
  let threw = null;
  try {
    await pb.importDoc({ format_version: 1, demos: [{ sha256: "tooshort", players: [] }] });
  } catch (e) { threw = e; }
  check("非法 sha256 被拒（400）", threw && threw.status === 400, threw ? `status=${threw.status}` : "没有抛错");

  threw = null;
  try {
    await pb.importDoc({ format_version: 2, demos: [] });
  } catch (e) { threw = e; }
  check("错误的 format_version 被拒（400）", threw && threw.status === 400, threw ? `status=${threw.status}` : "没有抛错");

  // 导出契约不允许没有准星码的选手记录：整个载荷被拒，而不是静默跳过。
  // （extract 命令本来就不会产出这种记录，所以这是防 CLI bug 的闸门。）
  threw = null;
  try {
    await pb.importDoc(envelope([demoDoc(5, [
      { steamid64: SID(5), name: "TestEcho", team_number: 2, crosshair: null, observations: [] },
    ])]));
  } catch (e) { threw = e; }
  check("选手缺准星码 → 整个载荷被拒（400）", threw && threw.status === 400, threw ? `status=${threw.status}` : "没有抛错");
  check("错误信息定位到具体选手下标",
    threw && JSON.stringify(threw.body || {}).includes("players[0]"),
    threw ? JSON.stringify(threw.body) : "");

  // ---------- 7. 元数据缺失告警 ----------
  section("7. 元数据缺失应告警");
  const docNoEvent = envelope([demoDoc(6, [
    { ...player(6, "TestFoxtrot", codeD), crosshair: { ...(player(6, "TestFoxtrot", codeD).crosshair), params: crosshair.pickEncoded(await crosshair.decode(codeD)) } },
  ], { event: null, match_date: null })]);
  const rNoEvent = await pb.importDoc(docNoEvent);
  check("缺 event/match_date 时给出告警",
    (rNoEvent.warnings || []).some((w) => String(w).includes("event")),
    JSON.stringify(rNoEvent.warnings));

  // ---------- 清理 ----------
  section("清理测试数据");
  await cleanup();
  const leftSnaps = await listRecords("crosshair_snapshots", `batch="${TEST_BATCH}"`);
  const leftPlayers = await listRecords("players", `steamid64~"765611999"`);
  check("测试数据已清空", (leftSnaps.items || []).length === 0 && (leftPlayers.items || []).length === 0,
    `残留 snapshot=${(leftSnaps.items || []).length} player=${(leftPlayers.items || []).length}`);

  // ---------- 汇总 ----------
  console.log(`\n${"-".repeat(50)}`);
  if (fail === 0) {
    console.log(`\x1b[32m全部通过：${pass} 项断言\x1b[0m\n`);
    process.exit(0);
  }
  console.log(`\x1b[31m${fail} 项失败\x1b[0m，${pass} 项通过：`);
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log("");
  process.exit(1);
}

main().catch((e) => {
  console.error(`\n\x1b[31m测试异常终止：${e.message}\x1b[0m`);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  cleanup().catch(() => {}).then(() => process.exit(2));
});
