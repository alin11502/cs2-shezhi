"use strict";

// csgo-sharecode 是纯 ESM，而本包是 CommonJS，所以用动态 import 缓存下来。
let _sc = null;
async function sharecode() {
  if (!_sc) _sc = await import("csgo-sharecode");
  return _sc;
}

// 准星分享码的 19 字节载荷只携带下面这 17 项。字段名映射到
// crosshair_snapshots 的列名（snake_case），与 server/pb_migrations 保持一致。
const ENCODED_FIELDS = {
  style: "style",
  length: "length",
  thickness: "thickness",
  gap: "gap",
  color: "color",
  red: "red",
  green: "green",
  blue: "blue",
  alphaEnabled: "alpha_enabled",
  alpha: "alpha",
  outlineEnabled: "outline_enabled",
  outline: "outline",
  centerDotEnabled: "center_dot_enabled",
  followRecoil: "follow_recoil",
  fixedCrosshairGap: "fixed_crosshair_gap",
  tStyleEnabled: "t_style_enabled",
  deployedWeaponGapEnabled: "deployed_weapon_gap_enabled",
};

// 这四个字段**不在**准星码里。解码器对任何码都返回 CS2 默认值
// （2 / 0.8 / 0.4 / 1.5），把它们当成"选手的设置"展示就是假数据，
// 所以单独隔离，前台必须明确标注为引擎默认值而非选手配置。
const NOT_IN_CODE_FIELDS = {
  splitDistance: "split_distance",
  innerSplitAlpha: "inner_split_alpha",
  outerSplitAlpha: "outer_split_alpha",
  splitSizeRatio: "split_size_ratio",
};

const NOT_IN_CODE_DEFAULTS = Object.freeze({
  split_distance: 2,
  inner_split_alpha: 0.8,
  outer_split_alpha: 0.4,
  split_size_ratio: 1.5,
});

// crosshairToConVars 会把这些默认值渲染成 cl_crosshair_dynamic_* 行。
// 生成"下载 CFG"时必须剔除，否则用户拿到的是一段伪配置。
const MISLEADING_CONVAR_PREFIXES = [
  "cl_crosshair_dynamic_maxdist_splitratio",
  "cl_crosshair_dynamic_splitalpha_innermod",
  "cl_crosshair_dynamic_splitalpha_outermod",
  "cl_crosshair_dynamic_splitdist",
];

function pick(decoded, mapping) {
  const out = {};
  for (const [src, dst] of Object.entries(mapping)) {
    const v = decoded[src];
    out[dst] = v === undefined ? null : v;
  }
  return out;
}

// 解码结果里凡是超出映射表的键，都算"未知字段"。库升级后新增字段会落在这里，
// 提示我们需要更新 schema，而不是被静默丢弃。
function unknownFields(decoded) {
  const known = new Set([...Object.keys(ENCODED_FIELDS), ...Object.keys(NOT_IN_CODE_FIELDS)]);
  return Object.keys(decoded).filter((k) => !known.has(k));
}

async function decode(code) {
  const sc = await sharecode();
  return sc.decodeCrosshairShareCode(code);
}

async function encode(params) {
  const sc = await sharecode();
  // encode 需要完整的 21 字段；缺失的 4 项用引擎默认值补齐。
  const inverted = {};
  for (const [src, dst] of Object.entries(ENCODED_FIELDS)) inverted[dst] = src;
  for (const [src, dst] of Object.entries(NOT_IN_CODE_FIELDS)) inverted[dst] = src;

  const full = {};
  for (const [snake, camel] of Object.entries(inverted)) {
    full[camel] = params[snake] !== undefined && params[snake] !== null ? params[snake] : NOT_IN_CODE_DEFAULTS[snake];
  }
  return sc.encodeCrosshair(full);
}

// 生成可直接放进 autoexec.cfg 的文本。默认剔除那 4 行伪配置。
async function toConVars(codeOrParams, { includeDefaults = false } = {}) {
  const sc = await sharecode();
  const decoded = typeof codeOrParams === "string" ? await decode(codeOrParams) : codeOrParams;
  const text = sc.crosshairToConVars(decoded);
  if (includeDefaults) return text;
  return text
    .split("\n")
    .filter((line) => !MISLEADING_CONVAR_PREFIXES.some((p) => line.trimStart().startsWith(p + " ")))
    .join("\n")
    .trimEnd();
}

module.exports = {
  ENCODED_FIELDS,
  NOT_IN_CODE_FIELDS,
  NOT_IN_CODE_DEFAULTS,
  MISLEADING_CONVAR_PREFIXES,
  decode,
  encode,
  toConVars,
  unknownFields,
  pickEncoded: (decoded) => pick(decoded, ENCODED_FIELDS),
  pickNotInCode: (decoded) => pick(decoded, NOT_IN_CODE_FIELDS),
};
