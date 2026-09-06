#!/usr/bin/env node
/**
 * 把站长提供的「HLTV top10 战队 + ProSettings 设置」快照 JSON 转成 seed 草稿。
 *
 * 用法：node scripts/transform-top10.mjs <输入.json> <输出-draft.json>
 *
 * 来源分工：
 * - 战队排序与五人名单来自快照里的 HLTV World Ranking —— 只用于**选人选队**；
 * - 设置/视角/视频值转录自 ProSettings 页面，按 third_party / medium 入库，
 *   证据链接与核对日期直接取快照里的 prosettings_url / prosettings_last_updated；
 * - 准星段按站长 2026-09-06 的授权做展示值→21 项映射入库，confidence=low。
 *   映射约定（都写进每条 notes，前台来源徽章显示 low）：
 *     · style 用**实测约定**：与 10 名 demo 权威选手对照，10/10 显示 ProSettings 的
 *       "Classic Static" 对应码内 style 4（动态），故按该约定映射；未实测的标签不猜、跳过；
 *     · 颜色用**语义映射**（Green→1、Cyan→4、Custom→6 等，对照中 8/10 吻合）；
 *     · 其余数值字段（length/gap/固定间隙/分裂四项/描边/中心点/透明度）对照中基本吻合，直接搬。
 *   已有 demo 高置信准星的选手由 seed 护栏跳过，不会被 low 值覆盖。
 */

import fs from "node:fs";
import path from "node:path";

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error("用法：node scripts/transform-top10.mjs <输入.json> <输出-draft.json>");
  process.exit(2);
}

// 已存在战队的 slug 必须复用，否则 upsert 会按 slug 新建出重复战队
const TEAM_SLUGS = {
  Spirit: "team-spirit",
  Falcons: "falcons-esports",
  Vitality: "team-vitality",
  "Natus Vincere": "natus-vincere",
};

const slugify = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

// player_settings 的 scaling_mode / display_mode 是受限 select，词表见
// server/pb_migrations/1756900100_phase2_settings.js。快照里是 ProSettings 的
// 展示词（含大小写与 "Native" 这类说法），必须归一，否则 REST 直接 400。
const SCALING = { stretched: "stretch", "black bars": "black_bars", native: "aspect", aspect: "aspect" };
const DISPLAY = { fullscreen: "fullscreen", windowed: "windowed", borderless: "borderless", "fullscreen windowed": "borderless" };
const pick = (map, v) => map[String(v ?? "").trim().toLowerCase()] ?? "";

// style 用实测约定（10 名 demo 选手对照 10/10：ProSettings "Classic Static" = 码内 style 4）。
// 未出现在对照里的标签不猜，返回 null 让该选手的准星跳过。
const STYLE_MAP = { "classic static": 4, legacy: 0 };
// 颜色用语义映射（对照中 Cyan/Green 等 8/10 吻合；Custom 语义为索引 6）
const COLOR_MAP = { red: 0, green: 1, yellow: 2, blue: 3, cyan: 4, pink: 5, purple: 5, custom: 6 };

/** 快照 crosshair 展示值 → 21 项参数。style/颜色标签无法映射时返回 null。 */
function mapCrosshair(ch) {
  if (!ch || typeof ch !== "object") return null;
  const style = STYLE_MAP[String(ch.style ?? "").trim().toLowerCase()];
  const color = COLOR_MAP[String(ch.color ?? "").trim().toLowerCase()];
  if (style === undefined || color === undefined) return null;
  return {
    style,
    length: ch.length ?? 0,
    thickness: ch.thickness ?? 0,
    gap: ch.gap ?? 0,
    color,
    red: ch.red ?? 0,
    green: ch.green ?? 0,
    blue: ch.blue ?? 0,
    alpha_enabled: Boolean(ch.alpha_enabled),
    alpha: ch.alpha_value ?? 255,
    outline_enabled: Boolean(ch.outline),
    outline: ch.outline ? (ch.outline_thickness ?? 0) : 0,
    center_dot_enabled: Boolean(ch.dot),
    follow_recoil: Boolean(ch.follow_recoil),
    fixed_crosshair_gap: ch.fixed_gap ?? 0,
    t_style_enabled: Boolean(ch.t_style),
    deployed_weapon_gap_enabled: Boolean(ch.deployed_weapon_gap),
    split_distance: ch.split_distance ?? 0,
    inner_split_alpha: ch.inner_split_alpha ?? 0,
    outer_split_alpha: ch.outer_split_alpha ?? 0,
    split_size_ratio: ch.split_size_ratio ?? 0,
  };
}

const doc = JSON.parse(fs.readFileSync(path.resolve(inputArg), "utf8"));
const meta = doc.metadata || {};
const generatedOn = String(meta.generated_on || "").slice(0, 10);

const teams = [];
const players = [];
const skipped = [];

for (const t of doc.teams || []) {
  const teamSlug = TEAM_SLUGS[t.team] || slugify(t.team);
  if (!teams.some((x) => x.slug === teamSlug)) {
    teams.push({ name: t.team, slug: teamSlug, tag: "", region: "", active: true });
  }
  for (const p of t.players || []) {
    const url = String(p.prosettings_url || "");
    const slug = slugify(url.split("/").filter(Boolean).pop());
    if (!slug) {
      skipped.push(`${t.team}/${p.nickname}：prosettings_url 缺失，无法定 slug`);
      continue;
    }
    if (players.some((x) => x.slug === slug)) {
      skipped.push(`${slug}：重复出现，只保留第一条`);
      continue;
    }

    const m = p.mouse || {};
    const vm = p.viewmodel || {};
    const v = p.video || {};
    const verifiedAt = String(p.prosettings_last_updated || generatedOn);
    const provenance = {
      source: "third_party",
      confidence: "medium",
      evidence_url: url,
      verified_at: verifiedAt,
      notes: "转录自站长提供的 HLTV top10 快照；设置值取自 ProSettings 页面展示值",
    };

    const chParams = mapCrosshair(p.crosshair);
    if (!chParams) {
      skipped.push(`${slug}：准星展示值的 style/颜色标签无法映射（${p.crosshair?.style} / ${p.crosshair?.color}），准星跳过`);
    }

    players.push({
      slug,
      name: slug,
      real_name: p.nickname,
      team: teamSlug,
      // 只搬设置/视角/视频 + （授权后）映射准星
      settings: {
        sensitivity: m.sensitivity ?? null,
        dpi: m.dpi ?? null,
        edpi: m.edpi ?? null,
        zoom_sensitivity: m.zoom_sensitivity ?? null,
        windows_sensitivity: m.windows_sensitivity ?? null,
        polling_rate: m.hz ?? null,
        resolution: v.resolution ?? "",
        aspect_ratio: v.aspect_ratio ?? "",
        scaling_mode: pick(SCALING, v.scaling_mode),
        brightness: v.brightness_percent ?? null,
        display_mode: pick(DISPLAY, v.display_mode),
        viewmodel_fov: vm.fov ?? null,
        viewmodel_offset_x: vm.offset_x ?? null,
        viewmodel_offset_y: vm.offset_y ?? null,
        viewmodel_offset_z: vm.offset_z ?? null,
        viewmodel_presetpos: vm.presetpos ?? null,
        ...provenance,
      },
      crosshairs: chParams
        ? [
            {
              params: chParams,
              captured_at: verifiedAt,
              source: "third_party",
              confidence: "low",
              evidence_url: url,
              verified_at: verifiedAt,
              notes:
                "由 ProSettings 展示值映射（style 按实测约定 Classic Static→4；颜色按语义映射）；" +
                "未经 demo 或本人发布的码核实。站长 2026-09-06 授权入库",
            },
          ]
        : [],
    });
  }
}

const draft = {
  batch: `top10-${generatedOn || "snapshot"}`,
  provenance: {
    source: "third_party",
    confidence: "medium",
    verified_at: generatedOn,
    evidence_url: "https://prosettings.net/",
    notes: "HLTV top10 战队快照（名单/排序）+ ProSettings 设置转录；准星不入库",
  },
  teams,
  players,
};

fs.writeFileSync(path.resolve(outputArg), JSON.stringify(draft, null, 2));
console.log(`战队 ${teams.length} 个、选手 ${players.length} 名 → ${outputArg}`);
if (skipped.length) console.log(`跳过 ${skipped.length} 条：\n  ${skipped.join("\n  ")}`);
