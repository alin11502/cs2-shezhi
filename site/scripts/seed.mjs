#!/usr/bin/env node
/**
 * 一次性人工 seed：把 scripts/seed/players.seed.json 写进 PocketBase。
 *
 * 为什么走标准 REST 而不是 /api/cs2cx/import：
 * 那个端点的契约以 demo 为中心（每条选手记录都要挂 demo 的 sha256），
 * 而人工/第三方来源的数据没有 demo。schema 已为此留了口子 ——
 * crosshair_snapshots.demo 非必填，source 有 manual / third_party / player_published 档位。
 *
 * ⚠ 两个必须注意的点：
 * 1. **写 snapshot 前要手动降级该选手其余的 is_current**。这段事务逻辑在
 *    server/pb_hooks/cs2cx-import.pb.js 里，REST 直写不会触发；不镜像实现
 *    就会撞部分唯一索引 idx_snap_one_current。
 * 2. **准星参数必须先过范围校验 + encode→decode 回读断言**。
 *    encodeCrosshair 对超范围输入不报错而是静默回绕（length 30 会解码回 4.4、
 *    style 9 会污染 centerDot 位），不拦住就会把错误参数写进库。
 *
 * 用法：
 *   node scripts/seed.mjs --dry-run   # 只打印将执行的动作
 *   node scripts/seed.mjs             # 实际写入（幂等，可重复跑）
 *   node scripts/seed.mjs --reset     # 先删掉本 seed 定义过的选手与战队再重建
 *
 * 什么时候必须用 --reset：改动 seed JSON 里的任何准星参数之后。
 * 准星码是参数编码出来的，参数一变码就变，而快照按 (player, code) upsert，
 * 旧码的行会残留成"历史版本"，样本数据凭空多出一堆重复历史。
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { SITE_ROOT, REPO_ROOT, pbUrl, loadEnv } from "./lib/env.mjs";

const require_ = createRequire(import.meta.url);
// 复用 CLI 的编解码封装，保证站点与 CLI 对同一组参数产出同一个码。
// 它是 CommonJS，所以用 createRequire 加载。
const crosshair = require_(path.join(REPO_ROOT, "cli", "src", "crosshair.js"));

// 默认种子；--file 可指定待审草稿（如 fetch-prosettings.mjs 的产出），
// 人工审过之后再入库，避免未审核的第三方数据直接进库。
const fileArgIdx = process.argv.indexOf("--file");
const SEED_FILE =
  fileArgIdx > 0 && process.argv[fileArgIdx + 1]
    ? path.resolve(SITE_ROOT, process.argv[fileArgIdx + 1])
    : path.join(SITE_ROOT, "scripts", "seed", "players.seed.json");
const PB_URL = pbUrl(loadEnv());
const ENV = loadEnv();
const DRY_RUN = process.argv.includes("--dry-run");
const RESET = process.argv.includes("--reset");

const log = (...a) => process.stderr.write(`[seed] ${a.join(" ")}\n`);
const warn = (...a) => process.stderr.write(`[seed] ! ${a.join(" ")}\n`);

// ---------- 准星参数合法范围（本机实测 encodeCrosshair 的回绕行为得出）----------
const RANGES = {
  length: [0, 25.5, 0.1],
  thickness: [0, 25.5, 0.1],
  gap: [-12.8, 12.7, 0.1],
  fixed_crosshair_gap: [-12.8, 12.7, 0.1],
  alpha: [0, 255, 1],
  red: [0, 255, 1],
  green: [0, 255, 1],
  blue: [0, 255, 1],
  // 编码上能表示到 127.5，但游戏 UI 只允许到 3
  outline: [0, 127.5, 0.5],
  style: [0, 4, 1],
  color: [0, 6, 1],
  // 动态准星（style=4）的分裂参数，值域来自编码器的位运算。
  // 必须与 site/src/lib/crosshair/clamp.ts 的 RANGES 一致，
  // 否则这边放行的值到那边会被钳成别的数，seed 与站点产出的码就对不上了。
  split_distance: [0, 7, 1],
  inner_split_alpha: [0, 1.5, 0.1],
  outer_split_alpha: [0, 1.5, 0.1],
  split_size_ratio: [0, 1.5, 0.1],
};

const PARAM_FIELDS = Object.keys(crosshair.ENCODED_FIELDS).map((camel) => crosshair.ENCODED_FIELDS[camel]);

/** 校验参数范围与步进。返回错误数组，空数组表示合法。 */
function validateParams(params, where) {
  const errors = [];
  for (const field of PARAM_FIELDS) {
    if (!(field in params)) {
      errors.push(`${where}: 缺少参数 ${field}`);
      continue;
    }
    const v = params[field];
    const range = RANGES[field];
    if (!range) continue; // 布尔字段不做数值校验
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push(`${where}: ${field} 应为有限数值，实际是 ${JSON.stringify(v)}`);
      continue;
    }
    const [min, max, step] = range;
    if (v < min || v > max) {
      errors.push(`${where}: ${field}=${v} 超出合法范围 [${min}, ${max}]（超范围会被 encodeCrosshair 静默回绕成错误值）`);
      continue;
    }
    // 必须是 step 的整数倍，否则会被截断（如 2.34 → 2.3）
    const n = Math.round(v / step);
    if (Math.abs(v - n * step) > 1e-9) {
      errors.push(`${where}: ${field}=${v} 不是 ${step} 的整数倍（会被截断为 ${n * step}）`);
    }
  }
  return errors;
}

/**
 * params → 准星码，并做 encode→decode 回读断言。
 * 这是防"静默回绕"的最后一道闸门：即使范围校验漏了什么，
 * 回读不一致也会在这里被抓住，绝不把错误的码写进库。
 */
async function paramsToCode(params, where) {
  const errors = validateParams(params, where);
  if (errors.length) return { code: null, errors };

  const code = await crosshair.encode(params);
  const decoded = await crosshair.decode(code);
  const back = crosshair.pickEncoded(decoded);

  const mismatch = PARAM_FIELDS.filter((f) => {
    const a = params[f];
    const b = back[f];
    if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) !== Boolean(b);
    return Math.abs(Number(a) - Number(b)) > 1e-9;
  });

  if (mismatch.length) {
    return {
      code: null,
      errors: mismatch.map(
        (f) => `${where}: ${f} 回读不一致（输入 ${params[f]}，解码回 ${back[f]}），拒绝生成码`
      ),
    };
  }
  return { code, errors: [] };
}

// ---------- PocketBase REST 客户端 ----------
async function getToken() {
  if (ENV.PB_TOKEN) return ENV.PB_TOKEN;
  if (!ENV.PB_ADMIN_EMAIL || !ENV.PB_ADMIN_PASSWORD) {
    throw new Error(
      "缺少凭证：请在 site/.env 或 cli/.env 里填 PB_TOKEN，或同时填 PB_ADMIN_EMAIL 与 PB_ADMIN_PASSWORD"
    );
  }
  const r = await req("POST", "/api/collections/_superusers/auth-with-password", {
    identity: ENV.PB_ADMIN_EMAIL,
    password: ENV.PB_ADMIN_PASSWORD,
  });
  if (!r?.token) throw new Error("认证成功但响应里没有 token");
  return r.token;
}

let TOKEN = null;

async function req(method, urlPath, body) {
  const res = await fetch(PB_URL + urlPath, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(TOKEN ? { Authorization: TOKEN } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    const detail = parsed?.data
      ? Object.entries(parsed.data).map(([k, v]) => `${k}: ${v?.message ?? JSON.stringify(v)}`).join("; ")
      : "";
    throw new Error(`${method} ${urlPath} → HTTP ${res.status}${detail ? ` | ${detail}` : ""}`);
  }
  return parsed;
}

/** findFirst 语义：查不到返回 null（PocketBase 的 filter 查询天然如此） */
async function findFirst(collection, filter) {
  const qs = new URLSearchParams({ filter, page: "1", perPage: "1" });
  const r = await req("GET", `/api/collections/${collection}/records?${qs}`);
  return r?.items?.[0] ?? null;
}

async function create(collection, data) {
  if (DRY_RUN) return { id: `<dry-run:${collection}>`, ...data };
  return req("POST", `/api/collections/${collection}/records`, data);
}

async function update(collection, id, data) {
  if (DRY_RUN) return { id, ...data };
  return req("PATCH", `/api/collections/${collection}/records/${id}`, data);
}

/** 存在则更新、不存在则创建。返回记录与是否新建。 */
async function upsert(collection, filter, data) {
  const existing = DRY_RUN ? null : await findFirst(collection, filter);
  if (existing) return { record: await update(collection, existing.id, data), isNew: false };
  return { record: await create(collection, data), isNew: true };
}

const q = (s) => `'${String(s).replace(/'/g, "\\'")}'`;

// ---------- 溯源闸门 ----------
// source / confidence / verified_at 一律必填。
// evidence_url 的要求按来源区分：声称有外部出处的来源（third_party /
// player_published / stream）必须给出证据链接；manual 来源则必须写清楚
// notes 说明数据是怎么来的。这样虚构样本集不会因为"没有外部证据可引"
// 而被卡住，同时任何一条数据都仍然必须交代自己的来历。
//
// 注意 evidence_url 在 PocketBase 里是 url 类型字段，只接受合法**绝对** URL，
// 相对路径（如 /about/data）会被 400 拒掉。
const EXTERNAL_SOURCES = new Set(["third_party", "player_published", "stream"]);

function checkProvenance(obj, defaults, where) {
  const merged = { ...defaults, ...obj };

  const missing = ["source", "confidence", "verified_at"].filter((k) => !merged[k]);
  if (missing.length) {
    throw new Error(
      `${where}: 缺少溯源字段 ${missing.join(", ")}。` +
      `本站的数据准确性全靠逐条标注来源，缺溯源的记录一律拒绝入库。`
    );
  }

  if (EXTERNAL_SOURCES.has(merged.source)) {
    if (!merged.evidence_url) {
      throw new Error(
        `${where}: source=${merged.source} 声称有外部出处，必须提供 evidence_url（且须为合法绝对 URL）`
      );
    }
  } else if (!merged.notes) {
    throw new Error(
      `${where}: source=${merged.source} 没有外部证据链接，必须用 notes 说明数据的来历`
    );
  }

  return merged;
}

/** PocketBase 的 url / text 字段收到 null 会校验失败，统一归一成空字符串 */
const txt = (v) => (v == null ? "" : v);

/**
 * 把日期归一成 PocketBase date 字段的**存储格式** `YYYY-MM-DD HH:MM:SS.mmmZ`。
 *
 * 为什么必须做：用短日期 `'2023-01-15'` 去 filter 一个 date 字段永远命中 0 条
 * （实测确认），于是 upsert 退化成"每次都 create"，转会记录会被反复复制。
 * 写入时 PocketBase 会自动补全格式，但**查询比较不会**，两边必须自己对齐。
 */
function pbDate(v) {
  if (!v) return "";
  const str = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return `${str} 00:00:00.000Z`;
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toISOString().replace("T", " ").replace(/(\.\d{3})Z$/, "$1Z");
}

// ---------- 主流程 ----------
async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const defaults = seed.provenance;
  const batch = seed.batch;

  if (!defaults) throw new Error("seed 文件缺少顶层 provenance 块");
  checkProvenance({}, defaults, "seed.provenance");

  log(`目标：${PB_URL}${DRY_RUN ? "（dry-run，不写库）" : ""}`);
  log(`批次：${batch}`);
  TOKEN = await getToken();
  log("凭证已获取");

  // --reset：先清掉本 seed 定义过的选手与战队，再重建。
  //
  // 为什么需要：准星码是由参数编码出来的，所以改动 seed JSON 里的任何参数
  // 都会让码变。而快照按 (player, code) upsert，新码创建新行、旧码的行残留成
  // "历史版本"，样本数据就凭空多出一堆重复历史。改参数后必须 --reset。
  if (RESET) {
    if (DRY_RUN) {
      log("--reset 在 dry-run 下不执行删除");
    } else {
      // 顺序必须是先选手后战队：选手的快照/设置/按键都是 cascadeDelete，
      // 删选手会连带清掉；而战队被 players.current_team 引用，先删会撞关系约束。
      let removed = 0;
      for (const p of seed.players || []) {
        const existing = await findFirst("players", `slug=${q(p.slug)}`);
        if (existing) {
          await req("DELETE", `/api/collections/players/records/${existing.id}`);
          removed++;
        }
      }
      for (const t of seed.teams || []) {
        const existing = await findFirst("teams", `slug=${q(t.slug)}`);
        if (existing) {
          await req("DELETE", `/api/collections/teams/records/${existing.id}`);
          removed++;
        }
      }
      log(`--reset：已删除 ${removed} 条选手/战队记录（其快照、设置、按键随 cascade 一并清除）`);
    }
  }

  const stats = { teams: 0, players: 0, settings: 0, snapshots: 0, tenures: 0, keybinds: 0, created: 0, updated: 0 };
  const errors = [];

  // ---- teams ----
  const teamIdBySlug = new Map();
  for (const t of seed.teams || []) {
    try {
      const { record, isNew } = await upsert("teams", `slug=${q(t.slug)}`, {
        name: t.name, slug: t.slug, tag: t.tag ?? "", region: t.region ?? "", active: t.active ?? true,
      });
      teamIdBySlug.set(t.slug, record.id);
      stats.teams++;
      if (isNew) stats.created++; else stats.updated++;
      log(`  战队 ${t.slug} ${isNew ? "新建" : "更新"}`);
    } catch (e) {
      errors.push(`teams/${t.slug}: ${e.message}`);
    }
  }

  // ---- players ----
  for (const p of seed.players || []) {
    const where = `players/${p.slug}`;
    try {
      const teamSlug = p.team;
      if (teamSlug && !teamIdBySlug.has(teamSlug)) {
        throw new Error(`引用的战队 ${teamSlug} 不在 seed.teams 里`);
      }

      const playerData = {
        slug: p.slug,
        name: p.name,
        real_name: p.real_name ?? "",
        country: p.country ?? "",
        steamid64: p.steamid64 ?? "",
        hltv_id: p.hltv_id ?? 0,
        status: p.status ?? "active",
        role: p.role ?? "",
        sort_order: p.sort_order ?? 9999,
        current_team: teamSlug ? teamIdBySlug.get(teamSlug) : "",
      };

      const { record: playerRec, isNew } = await upsert("players", `slug=${q(p.slug)}`, playerData);
      const playerId = playerRec.id;
      stats.players++;
      if (isNew) stats.created++; else stats.updated++;
      log(`  选手 ${p.slug} ${isNew ? "新建" : "更新"}`);

      // ---- settings ----
      if (p.settings) {
        const s = checkProvenance(p.settings, defaults, `${where}.settings`);
        // eDPI = sensitivity × dpi。seed 里可以不给，这里算出来，
        // 与 schema 里存 edpi 列的意图一致（避免每次查询重算，也便于排序筛选）。
        const edpi =
          s.edpi ?? (s.sensitivity && s.dpi ? Math.round(s.sensitivity * s.dpi) : null);

        const settingsData = {
          player: playerId,
          sensitivity: s.sensitivity ?? null,
          dpi: s.dpi ?? null,
          edpi,
          zoom_sensitivity: s.zoom_sensitivity ?? null,
          windows_sensitivity: s.windows_sensitivity ?? null,
          polling_rate: s.polling_rate ?? null,
          raw_input: s.raw_input ?? false,
          resolution: s.resolution ?? "",
          aspect_ratio: s.aspect_ratio ?? "",
          scaling_mode: s.scaling_mode ?? "",
          refresh_rate: s.refresh_rate ?? null,
          brightness: s.brightness ?? null,
          display_mode: s.display_mode ?? "",
          multisampling: s.multisampling ?? null,
          boost_player_contrast: s.boost_player_contrast ?? "",
          mouse: s.mouse ?? "", mousepad: s.mousepad ?? "", keyboard: s.keyboard ?? "",
          headset: s.headset ?? "", monitor: s.monitor ?? "",
          launch_options: s.launch_options ?? "",
          // viewmodel 是选手级设置（迁移 1756900500 新增列）
          viewmodel_fov: s.viewmodel_fov ?? null,
          viewmodel_offset_x: s.viewmodel_offset_x ?? null,
          viewmodel_offset_y: s.viewmodel_offset_y ?? null,
          viewmodel_offset_z: s.viewmodel_offset_z ?? null,
          viewmodel_presetpos: s.viewmodel_presetpos ?? null,
          source: s.source, confidence: s.confidence,
          evidence_url: txt(s.evidence_url), notes: txt(s.notes),
          verified_at: s.verified_at,
        };

        const filter = `player=${q(playerId)}`;
        const existing = DRY_RUN ? null : await findFirst("player_settings", filter);
        if (existing) await update("player_settings", existing.id, settingsData);
        else await create("player_settings", settingsData);
        stats.settings++;
        if (edpi) log(`    设置 eDPI=${edpi}（${s.sensitivity} × ${s.dpi}）`);
      }

      // ---- crosshairs ----
      const shots = p.crosshairs || [];
      if (shots.length) {
        // 按 captured_at 排序，最新的那条才是 is_current
        const ordered = [...shots].sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
        const currentIdx = ordered.length - 1;

        // ⚠ 必须先把该选手已有的 is_current 全部降级，否则撞部分唯一索引
        if (!DRY_RUN) {
          const currents = await req(
            "GET",
            `/api/collections/crosshair_snapshots/records?${new URLSearchParams({
              filter: `player=${q(playerId)} && is_current=true`, perPage: "50",
            })}`
          );
          for (const c of currents.items || []) {
            await update("crosshair_snapshots", c.id, { is_current: false });
          }
          if ((currents.items || []).length) {
            log(`    已降级 ${currents.items.length} 条旧的 is_current`);
          }
        }

        for (let i = 0; i < ordered.length; i++) {
          const shot = ordered[i];
          const shotWhere = `${where}.crosshairs[${i}]`;
          const prov = checkProvenance(shot, defaults, shotWhere);

          // 支持两种写法：给 params（现场编码，本 seed 用的方式）或直接给 code（现场解码）
          let code = shot.code ?? null;
          let params = shot.params ?? null;

          if (params) {
            const r = await paramsToCode(params, shotWhere);
            if (r.errors.length) { errors.push(...r.errors); continue; }
            code = r.code;
          } else if (code) {
            try {
              params = crosshair.pickEncoded(await crosshair.decode(code));
            } catch (e) {
              errors.push(`${shotWhere}: 准星码 ${code} 解码失败（${e.constructor.name}）`);
              continue;
            }
          } else {
            errors.push(`${shotWhere}: 既没有 params 也没有 code`);
            continue;
          }

          const isCurrent = i === currentIdx;
          const snapshotData = {
            player: playerId,
            code,
            ...params,
            // viewmodel 不在准星码里，人工 seed 也没有，留空
            is_current: isCurrent,
            captured_at: shot.captured_at,
            last_seen_at: shot.captured_at,
            source: prov.source, confidence: prov.confidence,
            evidence_url: txt(prov.evidence_url), batch,
          };

          const filter = `player=${q(playerId)} && code=${q(code)}`;
          const existing = DRY_RUN ? null : await findFirst("crosshair_snapshots", filter);
          if (existing) await update("crosshair_snapshots", existing.id, snapshotData);
          else await create("crosshair_snapshots", snapshotData);
          stats.snapshots++;
          log(`    准星 ${code} ${isCurrent ? "（当前）" : "（历史）"}`);
        }
      }

      // ---- tenures ----
      for (const t of p.tenures || []) {
        if (!teamIdBySlug.has(t.team)) {
          errors.push(`${where}.tenures: 引用的战队 ${t.team} 不在 seed.teams 里`);
          continue;
        }
        const prov = checkProvenance(t, defaults, `${where}.tenures`);
        // start_date 必须归一成 PocketBase 的存储格式再比较，否则永远命中 0 条、
        // upsert 退化成每次 create（实测踩过：跑三次 seed 后 tenures 从 14 涨到 38）
        const startDate = pbDate(t.start_date);
        const filter =
          `player=${q(playerId)} && team=${q(teamIdBySlug.get(t.team))} && start_date=${q(startDate)}`;
        const data = {
          player: playerId,
          team: teamIdBySlug.get(t.team),
          role: t.role ?? "",
          start_date: startDate,
          end_date: pbDate(t.end_date),
          // player_tenures 表只有 source_url 一个溯源字段，用 evidence_url 填
          source_url: txt(prov.evidence_url),
        };
        const existing = DRY_RUN ? null : await findFirst("player_tenures", filter);
        if (existing) await update("player_tenures", existing.id, data);
        else await create("player_tenures", data);
        stats.tenures++;
      }

      // ---- keybinds ----
      for (const k of p.keybinds || []) {
        const filter = `player=${q(playerId)} && action=${q(k.action)}`;
        const data = {
          player: playerId, action: k.action, key: k.key,
          raw_command: txt(k.raw_command), source_url: txt(defaults.evidence_url),
        };
        const existing = DRY_RUN ? null : await findFirst("keybinds", filter);
        if (existing) await update("keybinds", existing.id, data);
        else await create("keybinds", data);
        stats.keybinds++;
      }
    } catch (e) {
      errors.push(`${where}: ${e.message}`);
    }
  }

  log("");
  log(`汇总：${JSON.stringify(stats)}`);
  if (errors.length) {
    log("");
    warn(`${errors.length} 个错误：`);
    errors.forEach((e) => warn(`  - ${e}`));
    process.exit(1);
  }
  log(DRY_RUN ? "dry-run 完成，未写库" : "seed 完成");
}

main().catch((e) => {
  log(`失败：${e.message}`);
  process.exit(1);
});
