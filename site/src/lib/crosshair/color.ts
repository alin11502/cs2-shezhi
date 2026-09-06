/**
 * 准星颜色解析。
 *
 * 关键事实（本机实测确认）：准星码里 `color` 索引与 `red/green/blue` 是
 * **两个独立存储的字段**（csgo-sharecode 源码：color = bytes[10] & 7，
 * r/g/b = bytes[4]/[5]/[6]）。选预设色时游戏**不会**改写 r/g/b，
 * 所以码里常出现"color=4(青) 却带着 rgb(0,255,0)(绿)"这种残留值。
 * 本站抓到的两个真实第三方码都是这样，佐证了这一点。
 *
 * 结论：color 0–5 必须用预设表，**忽略**码里的 r/g/b；只有 color=6
 * （自定义）才读 r/g/b。若直接用码里的 RGB 渲染，会画出与游戏内完全不同的颜色。
 *
 * ⚠ 待实机校准：下面的预设 RGB 取自一个能工作的开源 Canvas 渲染器
 * （girlglock/cs2-crosshair 的 getColor()，它用的是 250/50 而非 255/0），
 * 不是从游戏本体提取的。该渲染器的索引语义还是 CS:GO 时代的
 * （只有 0–4 五个预设、把 5 当自定义），而 CS2 是 0–5 六个预设、6 才是自定义。
 * 因此这里采用 CS2 的索引语义 + 该渲染器的 RGB 数值，并把 5(粉) 按同规律补齐。
 * 数值若与游戏有偏差，**只需改 PRESET_RGB 这一处**。
 */

import type { CrosshairParams } from "./fields.ts";

/** CS2 cl_crosshaircolor 的预设色。索引语义按 CS2（0–5 预设，6 自定义）。 */
export const PRESET_RGB: Record<number, readonly [number, number, number]> = {
  0: [250, 50, 50], // 红
  1: [50, 250, 50], // 绿
  2: [250, 250, 50], // 黄
  3: [50, 50, 250], // 蓝
  4: [50, 250, 250], // 青
  5: [250, 50, 250], // 粉（按同规律补齐，未经实机确认）
};

/** 自定义色的索引 */
export const CUSTOM_COLOR_INDEX = 6;

/** 索引越界时的兜底色（与参考实现一致，用绿） */
const FALLBACK_RGB: readonly [number, number, number] = [50, 250, 50];

export type Rgb = readonly [number, number, number];

/**
 * 从 21 项参数里解析出真正该渲染的 RGB。
 * 预设色忽略码里的 r/g/b，自定义色才读它们。
 */
export function resolveRgb(params: Partial<CrosshairParams>): Rgb {
  const index = Number(params.color ?? CUSTOM_COLOR_INDEX);

  if (index === CUSTOM_COLOR_INDEX) {
    return [
      clampByte(params.red),
      clampByte(params.green),
      clampByte(params.blue),
    ];
  }

  return PRESET_RGB[index] ?? FALLBACK_RGB;
}

function clampByte(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function rgbToCss(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** 该颜色在给定背景上是否够亮，用于自动决定描边/文字色 */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
