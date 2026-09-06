#!/usr/bin/env node
/**
 * 把站长提供的「HLTV top10 战队 + ProSettings 设置」快照 JSON 转成 seed 草稿。
 *
 * 用法：node scripts/transform-top10.mjs <输入.json> <输出-draft.json>
 *
 * 来源分工（红线）：
 * - 战队排序与五人名单来自快照里的 HLTV World Ranking —— 只用于**选人选队**；
 * - 设置/视角/视频值转录自 ProSettings 页面，按 third_party / medium 入库，
 *   证据链接与核对日期直接取快照里的 prosettings_url / prosettings_last_updated；
 * - **准星段一律丢弃**：ProSettings 的准星展示值无法可靠映射到 cl_crosshairstyle，
 *   本站准星只认 demo 提取或选手本人发布的码。快照里即使带了 crosshair 也不搬。
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
    const provenance = {
      source: "third_party",
      confidence: "medium",
      evidence_url: url,
      verified_at: String(p.prosettings_last_updated || generatedOn),
      notes: "转录自站长提供的 HLTV top10 快照；设置值取自 ProSettings 页面展示值",
    };

    players.push({
      slug,
      name: slug,
      real_name: p.nickname,
      team: teamSlug,
      // 只搬设置/视角/视频。crosshair 段刻意不搬（见文件头红线说明）
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
