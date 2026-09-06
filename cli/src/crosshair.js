"use strict";

// csgo-sharecode 是纯 ESM，而本包是 CommonJS，所以用动态 import 缓存下来。
let _sc = null;
async function sharecode() {
  if (!_sc) _sc = await import("csgo-sharecode");
  return _sc;
}

/**
 * 准星分享码携带的**全部 21 项**参数。
 * camelCase 是 csgo-sharecode 的字段名，snake_case 是 crosshair_snapshots 的列名，
 * 与 server/pb_migrations 保持一致。
 *
 * ⚠ 这里曾经只有 17 项 —— 早先误判 split_distance / inner_split_alpha /
 * outer_split_alpha / split_size_ratio "不在码里、解码器永远返回引擎默认值
 * 2/0.8/0.4/1.5"。该结论已被源码与实测双重证伪：
 *
 *   splitDistance    = bytes[8] & 7              域 0–7，  步进 1
 *   innerSplitAlpha  = (bytes[10] >> 4) / 10     域 0–1.5，步进 0.1
 *   outerSplitAlpha  = (bytes[11] & 0xf) / 10    域 0–1.5，步进 0.1
 *   splitSizeRatio   = (bytes[11] >> 4) / 10     域 0–1.5，步进 0.1
 *
 * 编码器把它们写回同样的位（见 csgo-sharecode/src/index.ts L203/205-206）。
 * 真实第三方码 CSGO-UseJt-3oTvn-47wPX-hEyER-WZfiK 解出的是 3/0.1/1/1，
 * 不是默认值；用完整 21 字段原样重编码可**字节级还原**。
 *
 * 早先误判的原因是样本太窄：只测了自己生成的、恰好都用默认值的码。
 * 后果是重编码真实选手的码会销毁他实际的动态准星设置，且下载的 CFG 缺 4 行。
 */
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
  // 动态准星（style=4）的分裂行为参数。静态样式下不影响外观，但仍是选手的设置，
  // 且确实编码在码里，所以必须原样保留、原样导出。
  splitDistance: "split_distance",
  innerSplitAlpha: "inner_split_alpha",
  outerSplitAlpha: "outer_split_alpha",
  splitSizeRatio: "split_size_ratio",
};

/**
 * 上面 4 项动态参数的 CS2 引擎默认值。
 *
 * 语义已从"码外默认值"更正为**回填值**：只在调用方没提供这 4 项时才用，
 * 例如消费旧版导出 JSON（那时还没有这些字段）。任何情况下都不得用它们
 * 覆盖已有的真值 —— 那正是先前数据丢失 bug 的成因。
 */
const SPLIT_DEFAULTS = Object.freeze({
  split_distance: 2,
  inner_split_alpha: 0.8,
  outer_split_alpha: 0.4,
  split_size_ratio: 1.5,
});

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
  const known = new Set(Object.keys(ENCODED_FIELDS));
  return Object.keys(decoded).filter((k) => !known.has(k));
}

async function decode(code) {
  const sc = await sharecode();
  return sc.decodeCrosshairShareCode(code);
}

/**
 * snake_case 参数 → 准星码。
 *
 * 缺失的字段才回填：4 项动态参数用 SPLIT_DEFAULTS，其余用 0。
 * 已有的值一律原样透传，绝不覆盖。
 */
async function encode(params) {
  const sc = await sharecode();

  const full = {};
  for (const [camel, snake] of Object.entries(ENCODED_FIELDS)) {
    const v = params[snake];
    if (v !== undefined && v !== null) {
      full[camel] = v;
    } else if (snake in SPLIT_DEFAULTS) {
      full[camel] = SPLIT_DEFAULTS[snake];
    } else {
      full[camel] = 0;
    }
  }
  return sc.encodeCrosshair(full);
}

/**
 * 生成可直接放进 autoexec.cfg 的文本，21 项一行不少。
 *
 * 早先这里会剔除 4 行 cl_crosshair_dynamic_*，理由是"它们不在码里、是伪配置"。
 * 该理由已证伪，剔除等于把选手的真实配置丢掉，所以不再过滤。
 *
 * @param codeOrParams 准星码字符串，或已解码的 camelCase 对象
 */
async function toConVars(codeOrParams) {
  const sc = await sharecode();
  const decoded = typeof codeOrParams === "string" ? await decode(codeOrParams) : codeOrParams;
  return sc.crosshairToConVars(decoded);
}

module.exports = {
  ENCODED_FIELDS,
  SPLIT_DEFAULTS,
  decode,
  encode,
  toConVars,
  unknownFields,
  pickEncoded: (decoded) => pick(decoded, ENCODED_FIELDS),
};
