/**
 * 准星参数字段定义。与 cli/src/crosshair.js 的 ENCODED_FIELDS 一一对应，
 * 有差分测试（site/test/fields.test.ts）守护，防止两处映射漂移。
 *
 * ⚠ 这里曾经只有 17 项，并声称 split_distance / inner_split_alpha /
 * outer_split_alpha / split_size_ratio "不在准星码里、解码器永远返回引擎默认值
 * 2/0.8/0.4/1.5、绝不能当作选手设置展示"。**该结论已被证伪**，源码证据
 * （csgo-sharecode/src/index.ts）：
 *
 *   splitDistance    = bytes[8] & 7              域 0–7，  步进 1
 *   innerSplitAlpha  = (bytes[10] >> 4) / 10     域 0–1.5，步进 0.1
 *   outerSplitAlpha  = (bytes[11] & 0xf) / 10    域 0–1.5，步进 0.1
 *   splitSizeRatio   = (bytes[11] >> 4) / 10     域 0–1.5，步进 0.1
 *
 * 编码器把它们写回同样的位。真实码 CSGO-UseJt-3oTvn-47wPX-hEyER-WZfiK 解出
 * 3/0.1/1/1 而非默认值，且原样重编码可字节级还原。
 *
 * 它们是**动态准星（style=4）的分裂行为参数**：静态样式下不影响外观，
 * 但仍是选手的真实设置，必须原样存储、原样展示、原样导出进 CFG。
 */

/** 解码器输出的 camelCase 键 → 数据库/站点用的 snake_case 键。共 21 项。 */
export const DECODER_TO_SITE = {
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
  splitDistance: "split_distance",
  innerSplitAlpha: "inner_split_alpha",
  outerSplitAlpha: "outer_split_alpha",
  splitSizeRatio: "split_size_ratio",
} as const;

/** 站点/数据库键 → csgo-sharecode 需要的 camelCase 键 */
export const SITE_TO_DECODER = Object.fromEntries(
  Object.entries(DECODER_TO_SITE).map(([camel, snake]) => [snake, camel])
) as Record<string, keyof typeof DECODER_TO_SITE>;

/**
 * 动态准星那 4 项的 CS2 引擎默认值。
 *
 * 语义是**回填值**：只在调用方没提供时才用（例如消费旧版导出 JSON）。
 * 任何情况下都不得用它覆盖已有真值 —— 那正是先前数据丢失 bug 的成因。
 */
export const SPLIT_DEFAULTS = Object.freeze({
  split_distance: 2,
  inner_split_alpha: 0.8,
  outer_split_alpha: 0.4,
  split_size_ratio: 1.5,
});

/** 这 4 项的 snake_case 键，UI 需要据此判断"仅动态准星下生效" */
export const DYNAMIC_ONLY_PARAMS = Object.freeze(Object.keys(SPLIT_DEFAULTS));

/** 21 项参数的 snake_case 键 */
export const PARAM_KEYS: string[] = Object.values(DECODER_TO_SITE);

/** 布尔型参数（其余为数值型），clamp 与序列化时需要区别对待 */
export const BOOL_PARAMS = new Set([
  "alpha_enabled",
  "outline_enabled",
  "center_dot_enabled",
  "follow_recoil",
  "t_style_enabled",
  "deployed_weapon_gap_enabled",
]);

export type CrosshairParams = Record<string, number | boolean>;

/** cl_crosshairstyle 的取值含义（与 CS2 convar 对齐） */
export const STYLE_LABELS: Record<number, string> = {
  0: "默认",
  1: "静态（经典）",
  2: "经典",
  3: "内缩（精准）",
  4: "动态",
};

/** 哪些 style 在游戏里会随移动/开火扩张。静态渲染只画静止形态。 */
export const DYNAMIC_STYLES = new Set([4]);

export const COLOR_LABELS: Record<number, string> = {
  0: "红",
  1: "绿",
  2: "黄",
  3: "蓝",
  4: "青",
  5: "粉",
  6: "自定义",
  // 编码是 3 位（0–7），游戏 UI 只到 6。解真实码时可能读到 7，要有兜底。
  7: "未知（索引 7）",
};

/** 21 项参数的中文标签与对应 convar，供参数表展示 */
export const PARAM_META: Record<string, { label: string; convar: string; dynamicOnly?: boolean }> = {
  style: { label: "样式", convar: "cl_crosshairstyle" },
  length: { label: "长度", convar: "cl_crosshairsize" },
  thickness: { label: "粗细", convar: "cl_crosshairthickness" },
  gap: { label: "间隙", convar: "cl_crosshairgap" },
  color: { label: "颜色索引", convar: "cl_crosshaircolor" },
  red: { label: "红", convar: "cl_crosshaircolor_r" },
  green: { label: "绿", convar: "cl_crosshaircolor_g" },
  blue: { label: "蓝", convar: "cl_crosshaircolor_b" },
  alpha_enabled: { label: "启用透明度", convar: "cl_crosshairusealpha" },
  alpha: { label: "透明度", convar: "cl_crosshairalpha" },
  outline_enabled: { label: "启用描边", convar: "cl_crosshair_drawoutline" },
  outline: { label: "描边粗细", convar: "cl_crosshair_outlinethickness" },
  center_dot_enabled: { label: "中心点", convar: "cl_crosshairdot" },
  follow_recoil: { label: "跟随后坐力", convar: "cl_crosshair_recoil" },
  fixed_crosshair_gap: { label: "固定间隙", convar: "cl_fixedcrosshairgap" },
  t_style_enabled: { label: "T 型（无上臂）", convar: "cl_crosshair_t" },
  deployed_weapon_gap_enabled: { label: "间隙随武器变化", convar: "cl_crosshairgap_useweaponvalue" },
  split_distance: { label: "分裂距离", convar: "cl_crosshair_dynamic_splitdist", dynamicOnly: true },
  inner_split_alpha: { label: "内段透明度系数", convar: "cl_crosshair_dynamic_splitalpha_innermod", dynamicOnly: true },
  outer_split_alpha: { label: "外段透明度系数", convar: "cl_crosshair_dynamic_splitalpha_outermod", dynamicOnly: true },
  split_size_ratio: { label: "最大分裂比", convar: "cl_crosshair_dynamic_maxdist_splitratio", dynamicOnly: true },
};
