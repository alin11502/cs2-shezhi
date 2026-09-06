/**
 * 准星参数的合法范围与钳制。
 *
 * 为什么这个文件是红线：`csgo-sharecode` 的 encodeCrosshair 对超范围输入
 * **不抛错，而是静默回绕成错误参数**（本机实测确认）：
 *   length 30    → 解码回 4.4
 *   thickness -1 → 解码回 24.6
 *   alpha 300    → 解码回 44
 *   style 9      → style 变 1，且 centerDot 位被污染
 *   length 2.34  → 截断为 2.3
 * 生成的码在 CS2 里完全合法，但参数根本不是用户调的那个。
 *
 * 所以任何要生成准星码的路径都必须先过 clampParam + roundParam，
 * 再在 encode 之后 decode 回读断言一致（见 verifyRoundTrip）。
 */

import { BOOL_PARAMS } from "./fields.ts";

/**
 * [最小值, 最大值, 步进]。布尔参数不在此表内。
 *
 * 全部数值来自本机对 csgo-sharecode@5.0.0 的**实测**（逐个参数扫描可达值 +
 * 用 X.24/X.25/X.5/X.75 探针确定取整方向），不是抄来的文档值 ——
 * 先前按二手资料写的 outline 步进 0.1 与"四舍五入"都是错的。
 *
 * 实测结论：
 * - outline 的真实步进是 **0.5**（2.74→2.5、3.25→3），不是 0.1
 * - 所有数值参数的取整是**向零截断**，不是四舍五入：
 *   gap −2.75→−2.7（数学 floor 会得到 −2.8）、length 5.75→5.7、alpha 100.9→100
 * - style / color 是 3 位存储，编码域 0–7 且**到 8 回绕**（8→0、9→1）。
 *   游戏 UI 只提供 style 0–4、color 0–6，所以下面按 UI 域收紧；
 *   但**解码**真实码时可能读到 style 5–7 或 color 7，渲染侧要有兜底。
 */
export const RANGES: Record<string, readonly [number, number, number]> = {
  length: [0, 25.5, 0.1],
  thickness: [0, 25.5, 0.1],
  gap: [-12.8, 12.7, 0.1],
  fixed_crosshair_gap: [-12.8, 12.7, 0.1],
  alpha: [0, 255, 1],
  red: [0, 255, 1],
  green: [0, 255, 1],
  blue: [0, 255, 1],
  // 编码上能表示到 127.5（步进 0.5），但游戏 UI 只允许到 3
  outline: [0, 127.5, 0.5],
  style: [0, 4, 1],
  color: [0, 6, 1],
  // 动态准星（style=4）的分裂参数。值域与步进直接来自编码器的位运算：
  //   splitDistance   = bytes[8] & 7           → 3 位，0–7，步进 1
  //   innerSplitAlpha = (bytes[10] >> 4) / 10  → 4 位，0–1.5，步进 0.1
  //   outerSplitAlpha = (bytes[11] & 0xf) / 10 → 同上
  //   splitSizeRatio  = (bytes[11] >> 4) / 10  → 同上
  // 不补这 4 项，clampParam 会走"未知参数原样返回"分支，
  // 越界值就被编码器静默回绕 —— 正是本文件开头自述要防的事故。
  split_distance: [0, 7, 1],
  inner_split_alpha: [0, 1.5, 0.1],
  outer_split_alpha: [0, 1.5, 0.1],
  split_size_ratio: [0, 1.5, 0.1],
};

/**
 * 游戏 UI 实际上限比编码上限小的参数。
 * 编辑器滑条用这个，避免用户调出游戏里根本设不出的值。
 */
export const UI_MAX: Record<string, number> = {
  outline: 3,
};

/**
 * 把数值对齐到步进的整数倍，**向零截断**以匹配编码器的行为。
 *
 * 必须与编码器一致，否则会出现两种坏结果：
 * - 若这里用四舍五入而编码器截断，钳制后的值仍会被编码器再截一次，
 *   回读断言失败，合法输入被自己的防线误杀；
 * - 若放任非步进倍数的值进去，编码器悄悄截断，用户看到的值与码里的不符。
 */
export function truncateToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  const quotient = value / step;
  // 浮点误差防护：12.7/0.1 在 IEEE754 下是 126.99999999999999，直接 trunc 会
  // 得到 126 → 12.6，把合法的上界值弄坏（-12.8、25.5 同理）。
  // 若商与最近整数之差在 1e-9 内，说明它本来就落在格点上，只是有尾差，直接取整；
  // 否则才是真正的非格点值，向零截断。
  const nearest = Math.round(quotient);
  const n = Math.abs(quotient - nearest) < 1e-9 ? nearest : Math.trunc(quotient);
  const result = n * step;
  // 归一到步进的小数位数，消除 IEEE754 尾差（0.1*3 = 0.30000000000000004）
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  return Number(result.toFixed(decimals));
}

/** 钳制到 [min, max] 并向零截断对齐步进。布尔与未知参数原样返回。 */
export function clampParam(key: string, value: number | boolean | null | undefined): number | boolean {
  if (BOOL_PARAMS.has(key)) return Boolean(value);
  if (value === null || value === undefined) return 0;

  const range = RANGES[key];
  if (!range) {
    // 未知参数不做数值处理，避免把非法输入悄悄变成 0
    return typeof value === "number" ? value : Number(value) || 0;
  }

  const [min, max, step] = range;
  const n = typeof value === "number" ? value : Number(value);
  // NaN 没有方向可言，回落到下界；±Infinity 有明确方向，钳到对应的界。
  // 早先这里用 !Number.isFinite(n) 一并 return min，导致 length=Infinity
  // 被钳成 0（"无穷大"却变成"最小"），语义是反的。
  if (Number.isNaN(n)) return min;
  if (n === Infinity) return max;
  if (n === -Infinity) return min;
  const bounded = Math.min(max, Math.max(min, n));
  return truncateToStep(bounded, step);
}

/** 整份参数对象过一遍钳制 */
export function clampParams<T extends Record<string, unknown>>(params: T): T {
  const out: Record<string, unknown> = { ...params };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (typeof v === "number" || typeof v === "boolean" || v === null || v === undefined) {
      out[key] = clampParam(key, v as number | boolean | null | undefined);
    }
  }
  return out as T;
}

/** 报告哪些参数越界了，用于给用户明确提示而不是悄悄改值 */
export function findOutOfRange(
  params: Record<string, number | boolean>
): { key: string; value: number; min: number; max: number }[] {
  const out: { key: string; value: number; min: number; max: number }[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (BOOL_PARAMS.has(key) || typeof value !== "number") continue;
    const range = RANGES[key];
    if (!range) continue;
    const [min, max] = range;
    if (value < min || value > max) out.push({ key, value, min, max });
  }
  return out;
}

/** 报告哪些参数不是步进的整数倍（会被向零截断） */
export function findOffStep(params: Record<string, number | boolean>): { key: string; value: number; expected: number }[] {
  const out: { key: string; value: number; expected: number }[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (BOOL_PARAMS.has(key) || typeof value !== "number") continue;
    const range = RANGES[key];
    if (!range) continue;
    const expected = truncateToStep(value, range[2]);
    if (Math.abs(expected - value) > 1e-9) out.push({ key, value, expected });
  }
  return out;
}
