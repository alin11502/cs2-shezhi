#!/usr/bin/env node
/**
 * 生成 OG 图（社交分享卡片）。
 *
 * 用 resvg-js 把手写的 SVG 栅格化成 PNG。中文能正常渲染（已实测 loadSystemFonts
 * 能拿到系统 CJK 字体）。选手页的 OG 图直接画该选手当前的准星图形，
 * 比一张通用图更能让人在分享卡片里认出"这是谁的准星"。
 *
 * 用法：node scripts/build-og.mjs   （在 astro build 之前跑）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { buildShapes } from "../src/lib/crosshair/geometry.ts";
import { SITE_NAME } from "../src/config.ts";

const require_ = createRequire(import.meta.url);
const { Resvg } = require_("@resvg/resvg-js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(HERE, "..");
const OUT = path.join(SITE_ROOT, "public", "og");

const W = 1200;
const H = 630;
const BG = "#16181d";
const ACCENT = "#7c6cff";
const MUTED = "#9aa0ab";

/** 把 buildShapes 的图元渲染成 SVG 元素，套一个 transform 放进目标盒子 */
function shapesToElements(params, box) {
  const shapes = buildShapes(params, { size: 200 });
  const scale = box.size / 200;
  const inner = shapes
    .map((s) =>
      s.kind === "rect"
        ? `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${s.fill}"${s.opacity < 1 ? ` opacity="${s.opacity}"` : ""}/>`
        : `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill}"${s.opacity < 1 ? ` opacity="${s.opacity}"` : ""}/>`
    )
    .join("");
  return `<g transform="translate(${box.x},${box.y}) scale(${scale})">${inner}</g>`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function frame(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <g opacity="0.06">${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="${H}" stroke="#fff" stroke-width="1"/>`).join("")}</g>
  <rect x="0" y="${H - 8}" width="${W}" height="8" fill="${ACCENT}"/>
  ${body}
</svg>`;
}

function rasterize(svg, outPath) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" } });
  fs.writeFileSync(outPath, r.render().asPng());
}

function defaultOg() {
  const demo = {
    style: 2, length: 4, thickness: 1, gap: -2, color: 1,
    red: 0, green: 255, blue: 0, alpha_enabled: true, alpha: 255,
    outline_enabled: true, outline: 1, center_dot_enabled: false,
    follow_recoil: false, fixed_crosshair_gap: 0, t_style_enabled: false,
    deployed_weapon_gap_enabled: true,
    split_distance: 2, inner_split_alpha: 0.8, outer_split_alpha: 0.4, split_size_ratio: 1.5,
  };
  const body = `
    ${shapesToElements(demo, { x: 70, y: 130, size: 360 })}
    <text x="500" y="250" font-size="64" font-weight="700" fill="#fff" font-family="sans-serif">${esc(SITE_NAME)}</text>
    <text x="500" y="320" font-size="30" fill="${MUTED}" font-family="sans-serif">职业选手的准星码、灵敏度与外设设置</text>
    <text x="500" y="372" font-size="30" fill="${MUTED}" font-family="sans-serif">每条数据都标注来源与核对时间</text>
    <text x="500" y="470" font-size="26" fill="${ACCENT}" font-family="sans-serif">准星码 · 21 项参数 · 可导入 CFG</text>`;
  rasterize(frame(body), path.join(OUT, "default.png"));
}

function playerOgs() {
  const dataDir = path.join(SITE_ROOT, "src", "data");
  const read = (name) => {
    const p = path.join(dataDir, name);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
  };
  const players = read("players.json");
  const snapshots = read("snapshots.json");
  const settings = read("settings.json");

  fs.mkdirSync(path.join(OUT, "players"), { recursive: true });
  let n = 0;
  for (const p of players) {
    // fetch-data 已把关联扁平化成 player_id，不是 PocketBase 原始的 player
    const cur = snapshots.find((s) => s.player_id === p.id && s.is_current);
    if (!cur) continue;
    const st = settings.find((s) => s.player_id === p.id);
    const edpi = st?.sensitivity && st?.dpi ? Math.round(st.sensitivity * st.dpi) : st?.edpi ?? null;
    const team = p.team?.name ?? "";
    const body = `
      ${shapesToElements(cur, { x: 60, y: 120, size: 340 })}
      <text x="470" y="230" font-size="60" font-weight="700" fill="#fff" font-family="sans-serif">${esc(p.name)}</text>
      <text x="470" y="290" font-size="28" fill="${MUTED}" font-family="sans-serif">${esc(team)}</text>
      <text x="470" y="360" font-size="30" fill="${MUTED}" font-family="sans-serif">准星码 ${esc(cur.code)}</text>
      ${edpi ? `<text x="470" y="410" font-size="30" fill="${MUTED}" font-family="sans-serif">eDPI ${edpi}${st?.dpi ? `（${st.dpi} × ${st.sensitivity}）` : ""}</text>` : ""}
      <text x="470" y="480" font-size="26" fill="${ACCENT}" font-family="sans-serif">${esc(SITE_NAME)}</text>`;
    rasterize(frame(body), path.join(OUT, "players", `${p.slug}.png`));
    n++;
  }
  return n;
}

fs.mkdirSync(OUT, { recursive: true });
defaultOg();
const n = playerOgs();
console.log(`OG 图已生成：default.png + ${n} 张选手图 → public/og/`);
