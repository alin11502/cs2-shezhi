#!/usr/bin/env node
/**
 * 构建时从 PocketBase 拉数据，落成 src/data/*.json 供 Astro 静态生成使用。
 *
 * 设计要点：
 * - **读取无需鉴权**：所有 collection 的 listRule 都是 ""，这里只用匿名 GET。
 *   凭证只有 seed.mjs 写库时才需要。
 * - **降级而非崩溃**：PocketBase 不可达时，有缓存就复用缓存、没缓存就写空骨架，
 *   两种情况都 exit 0。因为 deploy.sh 是 set -euo pipefail，PB 短暂不可用
 *   不应该让整个部署中断。只有 --strict 才 exit 1。
 * - **头像/队标存相对路径** /api/files/...：生产环境 Caddy 把 /api/* 反代到
 *   PocketBase，同源零构建开销；本地开发由 src/lib/data.ts 加 PUBLIC_PB_ORIGIN 前缀。
 *   这样缓存的 JSON 里不会固化 PocketBase 的地址。
 */

import fs from "node:fs";
import path from "node:path";

import { SITE_ROOT, pbUrl, loadEnv } from "./lib/env.mjs";

const DATA_DIR = path.join(SITE_ROOT, "src", "data");

const STRICT = process.argv.includes("--strict");

// PB_URL 优先取本进程环境与 site/.env，其次复用 cli/.env（同一份配置，避免两处维护）。
// 读取无需鉴权：所有 collection 的 listRule 都是 ""，所以这里不涉及任何凭证。
const PB_URL = pbUrl(loadEnv());

const log = (...a) => process.stderr.write(`[fetch-data] ${a.join(" ")}\n`);

async function get(url, { timeoutMs = 15000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

async function healthy() {
  try {
    await get(`${PB_URL}/api/health`, { timeoutMs: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** 分页拉全表。PocketBase 的 perPage 上限是 500。 */
async function fetchAll(collection, { filter = "", sort = "", expand = "", fields = null } = {}) {
  const perPage = 500;
  const out = [];
  for (let page = 1; page <= 200; page++) {
    const qs = new URLSearchParams({ page: String(page), perPage: String(perPage), sort });
    if (filter) qs.set("filter", filter);
    if (expand) qs.set("expand", expand);
    const res = await get(`${PB_URL}/api/collections/${collection}/records?${qs}`);
    const items = res.items || [];
    out.push(...items.map((r) => trim(r, collection, fields)));
    if (items.length < perPage) break;
  }
  return out;
}

/** expand 出来的关联记录也走同一套裁剪，避免把整张表塞进缓存 */
function expanded(rec, field, pick) {
  const e = rec.expand && rec.expand[field];
  if (!e || Array.isArray(e)) return null;
  return pick(e);
}

function fileUrl(collection, rec, field) {
  const name = rec[field];
  if (!name) return null;
  return `/api/files/${collection}/${rec.id}/${name}`;
}

const num = (v) => (typeof v === "number" ? v : v === "" || v == null ? null : Number(v) || null);
const str = (v) => (typeof v === "string" && v !== "" ? v : null);
const bool = (v) => (typeof v === "boolean" ? v : null);
const date = (v) => (typeof v === "string" && v !== "" ? v : null);

/**
 * 字段白名单裁剪 + 扁平化。
 * 丢掉 raw_json / sampled_ticks 这类大字段和 PocketBase 内部字段，
 * 把 expand 的关联记录拍平成内联对象，让 src/lib/data.ts 拿到就能直接用。
 */
function trim(r, collection) {
  switch (collection) {
    case "teams":
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        tag: str(r.tag),
        region: str(r.region),
        logo_url: fileUrl("teams", r, "logo"),
        active: bool(r.active) ?? false,
      };

    case "players":
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        real_name: str(r.real_name),
        country: str(r.country),
        steamid64: str(r.steamid64),
        avatar_url: fileUrl("players", r, "avatar"),
        hltv_id: num(r.hltv_id),
        status: str(r.status),
        role: str(r.role),
        sort_order: num(r.sort_order),
        team: expanded(r, "current_team", (t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          tag: str(t.tag),
        })),
      };

    case "player_tenures":
      return {
        id: r.id,
        player_id: r.player,
        player_name: expanded(r, "player", (p) => p.name) ?? "",
        team_id: r.team,
        team_name: expanded(r, "team", (t) => t.name) ?? "",
        team_slug: expanded(r, "team", (t) => t.slug) ?? "",
        role: str(r.role),
        start_date: date(r.start_date),
        end_date: date(r.end_date),
        source_url: str(r.source_url),
      };

    case "player_settings":
      return {
        id: r.id,
        player_id: r.player,
        player_slug: expanded(r, "player", (p) => p.slug) ?? "",
        player_name: expanded(r, "player", (p) => p.name) ?? "",
        sensitivity: num(r.sensitivity),
        dpi: num(r.dpi),
        edpi: num(r.edpi),
        zoom_sensitivity: num(r.zoom_sensitivity),
        windows_sensitivity: num(r.windows_sensitivity),
        polling_rate: num(r.polling_rate),
        raw_input: bool(r.raw_input),
        resolution: str(r.resolution),
        aspect_ratio: str(r.aspect_ratio),
        scaling_mode: str(r.scaling_mode),
        refresh_rate: num(r.refresh_rate),
        brightness: num(r.brightness),
        display_mode: str(r.display_mode),
        multisampling: num(r.multisampling),
        boost_player_contrast: str(r.boost_player_contrast),
        mouse: str(r.mouse),
        mousepad: str(r.mousepad),
        keyboard: str(r.keyboard),
        headset: str(r.headset),
        monitor: str(r.monitor),
        launch_options: str(r.launch_options),
        // viewmodel 是选手级设置（迁移 1756900500 新增列）
        viewmodel_fov: num(r.viewmodel_fov),
        viewmodel_offset_x: num(r.viewmodel_offset_x),
        viewmodel_offset_y: num(r.viewmodel_offset_y),
        viewmodel_offset_z: num(r.viewmodel_offset_z),
        viewmodel_presetpos: num(r.viewmodel_presetpos),
        source: str(r.source),
        confidence: str(r.confidence),
        evidence_url: str(r.evidence_url),
        notes: str(r.notes),
        verified_at: date(r.verified_at),
      };

    case "keybinds":
      return {
        id: r.id,
        player_id: r.player,
        player_name: expanded(r, "player", (p) => p.name) ?? "",
        action: r.action,
        key: r.key,
        raw_command: str(r.raw_command),
        source_url: str(r.source_url),
      };

    case "crosshair_snapshots": {
      // demo 只取前台要用的摘要，整张 demos 表不拉（体积大且用不上）
      const demoSummary = (d) =>
        d
          ? {
              event: str(d.event),
              map: str(d.map),
              match_date: date(d.match_date),
              sharecode: str(d.sharecode),
              team_a: str(d.team_a),
              team_b: str(d.team_b),
            }
          : null;
      return {
        id: r.id,
        player_id: r.player,
        player_slug: expanded(r, "player", (p) => p.slug) ?? "",
        player_name: expanded(r, "player", (p) => p.name) ?? "",
        code: r.code,
        // --- 准星码携带的全部 21 项 ---
        style: num(r.style),
        length: num(r.length),
        thickness: num(r.thickness),
        gap: num(r.gap),
        color: num(r.color),
        red: num(r.red),
        green: num(r.green),
        blue: num(r.blue),
        alpha_enabled: bool(r.alpha_enabled),
        alpha: num(r.alpha),
        outline_enabled: bool(r.outline_enabled),
        outline: num(r.outline),
        center_dot_enabled: bool(r.center_dot_enabled),
        follow_recoil: bool(r.follow_recoil),
        fixed_crosshair_gap: num(r.fixed_crosshair_gap),
        t_style_enabled: bool(r.t_style_enabled),
        deployed_weapon_gap_enabled: bool(r.deployed_weapon_gap_enabled),
        // 动态准星（style=4）的分裂参数。静态样式下不影响外观，
        // 但确实编码在码里、是选手的真实设置，必须拉过来。
        split_distance: num(r.split_distance),
        inner_split_alpha: num(r.inner_split_alpha),
        outer_split_alpha: num(r.outer_split_alpha),
        split_size_ratio: num(r.split_size_ratio),
        // --- viewmodel：不在准星码里，由 demo 直接提取，可能全为 null ---
        viewmodel_fov: num(r.viewmodel_fov),
        viewmodel_offset_x: num(r.viewmodel_offset_x),
        viewmodel_offset_y: num(r.viewmodel_offset_y),
        viewmodel_offset_z: num(r.viewmodel_offset_z),
        viewmodel_presetpos: num(r.viewmodel_presetpos),
        // --- 版本与溯源 ---
        is_current: bool(r.is_current) ?? false,
        captured_at: date(r.captured_at),
        last_seen_at: date(r.last_seen_at),
        source: str(r.source),
        confidence: str(r.confidence),
        evidence_url: str(r.evidence_url),
        batch: str(r.batch),
        demo: demoSummary(expanded(r, "demo", (d) => d)),
        last_seen_demo: demoSummary(expanded(r, "last_seen_demo", (d) => d)),
        // 注意：raw_json / sampled_ticks 故意不取
      };
    }

    default:
      throw new Error(`未定义的 collection 裁剪规则：${collection}`);
  }
}

// 表名 → 落盘文件名。demos 不在其中（见上）。
const TARGETS = [
  { collection: "teams", file: "teams.json", sort: "name" },
  { collection: "players", file: "players.json", sort: "sort_order,name", expand: "current_team" },
  { collection: "player_tenures", file: "tenures.json", sort: "start_date", expand: "player,team" },
  { collection: "crosshair_snapshots", file: "snapshots.json", sort: "-captured_at", expand: "player,demo,last_seen_demo" },
  { collection: "player_settings", file: "settings.json", sort: "", expand: "player" },
  { collection: "keybinds", file: "keybinds.json", sort: "action", expand: "player" },
];

/** 先写 .tmp 再 rename，避免中断留下半截 JSON 把构建带崩 */
function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function cacheAge() {
  const metaFile = path.join(DATA_DIR, "meta.json");
  if (!fs.existsSync(metaFile)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    if (!meta.fetched_at) return null;
    const hours = (Date.now() - new Date(meta.fetched_at).getTime()) / 3600000;
    return { fetched_at: meta.fetched_at, hours: Math.round(hours * 10) / 10 };
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!(await healthy())) {
    const age = cacheAge();
    if (age) {
      log(`PocketBase 不可达（${PB_URL}），复用已有缓存：取自 ${age.fetched_at}，已 ${age.hours} 小时`);
      if (STRICT) {
        log("--strict 模式，判定为失败");
        process.exit(1);
      }
      log("沿用缓存构建（数据可能过期）");
      return;
    }

    log(`PocketBase 不可达（${PB_URL}）且没有缓存`);
    if (STRICT) {
      log("--strict 模式，判定为失败");
      process.exit(1);
    }
    // 写空骨架而不是直接退出：让站点构建出"数据库建设中"的空态，
    // 而不是让 astro build 因为找不到 JSON 而崩掉。
    log("写出空数据骨架，站点将呈现空态");
    for (const t of TARGETS) atomicWrite(path.join(DATA_DIR, t.file), []);
    atomicWrite(path.join(DATA_DIR, "meta.json"), {
      fetched_at: new Date().toISOString(),
      pb_url: PB_URL,
      stale: true,
      empty: true,
      counts: Object.fromEntries(TARGETS.map((t) => [t.file, 0])),
    });
    return;
  }

  log(`PocketBase 可达：${PB_URL}`);
  const counts = {};
  for (const t of TARGETS) {
    const rows = await fetchAll(t.collection, { sort: t.sort, expand: t.expand });
    atomicWrite(path.join(DATA_DIR, t.file), rows);
    counts[t.file] = rows.length;
    log(`  ${t.collection.padEnd(22)} ${String(rows.length).padStart(5)} 条`);
  }

  atomicWrite(path.join(DATA_DIR, "meta.json"), {
    fetched_at: new Date().toISOString(),
    pb_url: PB_URL,
    stale: false,
    empty: Object.values(counts).every((n) => n === 0),
    counts,
  });

  log("完成");
}

main().catch((e) => {
  log(`失败：${e.message}`);
  process.exit(1);
});
