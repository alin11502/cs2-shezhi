/**
 * 准星几何：把参数映射成图元数组。
 *
 * 准星码携带 21 项参数，但静态几何只由其中影响外观的那些决定
 * （length / thickness / gap / outline / center_dot / t_style / color / alpha 等）。
 * 4 项动态分裂参数（split_distance / inner_split_alpha / outer_split_alpha /
 * split_size_ratio）控制的是动态准星随移动/开火的分裂行为，不改变静止形态的图元，
 * 因此这里不消费它们 —— 它们由 DynamicPreview 组件使用。
 *
 * 这是全站准星渲染的**唯一真源**。构建端的 Astro 组件与客户端的 Svelte island
 * 都消费同一份 Shape[]，各自渲染成 SVG/DOM，从而保证两种模式像素级一致，
 * 也让"无 JS 也能看到准星"成为可能（静态 SVG 直接内联进 HTML）。
 *
 * 许可证立场：clean-room 自行实现。specs-gg/cs2-crosshair-decoder 的
 * SvgGenerator.php 与 girlglock/cs2-crosshair 均为 GPL-3.0，本文件只借鉴了
 * 由 convar 语义客观决定的做法（矩形拼四臂、描边外扩、T 型跳过上臂），
 * 未复制任何代码片段。
 *
 * ⚠ 待实机校准的假设集中在 effectiveGap() 一处，改起来只动那一个函数。
 */

import { resolveRgb, rgbToCss, type Rgb } from "./color.ts";
import { DYNAMIC_STYLES, type CrosshairParams } from "./fields.ts";
import { UI_MAX } from "./clamp.ts";

export type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; opacity: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: string; opacity: number };

export interface GeometryOptions {
  /** viewBox 边长，默认 200 */
  size?: number;
  /** 每个游戏单位对应多少 viewBox 单位，默认 DEFAULT_SCALE（12） */
  scale?: number;
  /** 覆盖 gap（动态准星逐帧动画时传当前扩张后的 gap） */
  gapOverride?: number;
  /** 描边色，默认纯黑 */
  outlineColor?: string;
}

/**
 * 默认缩放：1 个游戏单位 = 12 个 viewBox 单位。
 *
 * 不用屏幕真实比例。真实准星相对屏幕很小（length 4 / gap −2 的准星包围盒半宽
 * 只有约 4 个游戏单位，约占 1080p 屏幕宽的 2%），按屏幕比例画的话预览图上
 * 它就是一个点 —— 实测 scale=4 时选手卡片上的准星几乎不可见。
 * scale=12 让典型准星（半宽约 4 单位）占画布半宽的约一半，清晰可辨。
 */
export const DEFAULT_SCALE = 12;

const DEFAULTS = { size: 200, scale: DEFAULT_SCALE, outlineColor: "#000000" } as const;

// viewBox 与 scale 的取舍（有意为之，别"优化"成自适应）：
//
// 固定 scale 才能让不同选手的准星按**同一比例**对比 —— 这是准星站最重要的信息，
// 自适应 viewBox 会让大准星和小准星看起来一样大，直接毁掉对比价值。
//
// 代价是极端参数会溢出：length 25.5 + gap 12.7 时半宽达 38.2 单位 × 12 = 458
// 个单位，远超 size/2 = 100，多出的部分由 SVG 按 viewBox 裁掉。
// 实践中没有选手用这种参数，裁切可接受。

/** 中心点的最小边长，防止 thickness 极小时中心点看不见 */
const MIN_DOT_SIZE = 1.5;
/** thickness=0 时四臂的最细可见宽度近似（游戏引擎会把 0 钳成 1px 线） */
const HAIRLINE_PX = 1;
/** 描边的最小外扩量，防止 outline 为小数时描边消失 */
const MIN_OUTLINE = 0.5;

/**
 * 实际生效的间隙。
 *
 * ⚠ **这是本文件唯一未经实机验证的假设**，按 convar 语义推导：
 * - `cl_crosshairgap_useweaponvalue`（= deployed_weapon_gap_enabled）为真时，
 *   间隙随武器变化，静止形态取 `cl_crosshairgap`（= gap）；
 * - 为假时，间隙被固定，取 `cl_fixedcrosshairgap`（= fixed_crosshair_gap）。
 *
 * style=3（内缩/精准）在游戏里视觉更紧，但静态几何是否真的用不同的 gap
 * 无法确认，这里**不做特殊处理**，一律按上面的规则算。
 * 若与游戏有偏差，只需改这一个函数。
 */
export function effectiveGap(params: Partial<CrosshairParams>): number {
  const gap = Number(params.gap ?? 0);
  const fixed = Number(params.fixed_crosshair_gap ?? 0);
  return params.deployed_weapon_gap_enabled ? gap : fixed !== 0 ? fixed : gap;
}

/** 该 style 的渲染是否只是近似（用于在 UI 上如实标注） */
export function styleNote(style: number): string | null {
  if (DYNAMIC_STYLES.has(style)) {
    return "动态准星：这里画的是静止形态，移动或开火时会向外扩张";
  }
  if (style === 0) {
    return "默认样式：游戏内实际形态可能与按参数绘制的结果不同";
  }
  if (style === 3) {
    return "内缩（精准）样式：静态几何按普通十字绘制，游戏内的收紧效果未模拟";
  }
  return null;
}

/**
 * 生成准星图元。
 *
 * 渲染顺序保证描边在下、彩色在上：先推入所有描边图元，再推入所有彩色图元。
 * alpha 只作用于彩色层，描边始终不透明（与游戏表现一致）。
 */
export function buildShapes(params: Partial<CrosshairParams>, options: GeometryOptions = {}): Shape[] {
  const { size, scale, outlineColor } = { ...DEFAULTS, ...options };
  const center = size / 2;

  const gap = options.gapOverride !== undefined ? options.gapOverride : effectiveGap(params);

  const length = Number(params.length ?? 0) * scale;
  const thickness = Number(params.thickness ?? 0) * scale;
  const gapPx = gap * scale;

  // 游戏里 thickness=0 仍会画出最细可见线（引擎钳到 1px），不是"不画臂"。
  // 这里按 1px hairline 近似，精确宽度待实机截图校准。
  const armThickness = thickness > 0 ? thickness : HAIRLINE_PX;

  const rgb: Rgb = resolveRgb(params);
  const fill = rgbToCss(rgb);

  // alpha 只作用于彩色层
  const opacity = params.alpha_enabled ? clamp01(Number(params.alpha ?? 255) / 255) : 1;

  const outlines: Shape[] = [];
  const colored: Shape[] = [];

  const pushArm = (x: number, y: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    colored.push({ kind: "rect", x, y, w, h, fill, opacity });
  };

  // 四臂。length 为 0 时 pushArm 自然跳过，不需要额外判断。
  if (length > 0) {
    const half = armThickness / 2;
    const tStyle = Boolean(params.t_style_enabled);

    // 上臂（T 型准星会跳过它）
    if (!tStyle) pushArm(center - half, center - gapPx - length, armThickness, length);
    // 下臂
    pushArm(center - half, center + gapPx, armThickness, length);
    // 左臂
    pushArm(center - gapPx - length, center - half, length, armThickness);
    // 右臂
    pushArm(center + gapPx, center - half, length, armThickness);
  }

  // 中心点。边长取 thickness 与最小值中的较大者，避免极细准星看不见点。
  if (params.center_dot_enabled) {
    const dotSize = Math.max(thickness, MIN_DOT_SIZE);
    colored.push({
      kind: "rect",
      x: center - dotSize / 2,
      y: center - dotSize / 2,
      w: dotSize,
      h: dotSize,
      fill,
      opacity,
    });
  }

  // 描边：为每个彩色图元垫一个四周外扩的黑图元。
  //
  // 外扩量必须钳制：编码域允许 outline 到 127.5，乘 scale=4 就是 510 个
  // viewBox 单位，实测会把图元撑到坐标 ±425、尺寸 1050，SVG 完全失真。
  // 游戏 UI 的实际上限是 3，所以视觉外扩最多按 3 算。
  // 这只是**渲染层**的防护 —— 参数表里仍如实显示码里的原始 outline 值。
  if (params.outline_enabled) {
    const maxOutlinePx = UI_MAX.outline * scale;
    const o = Math.min(Math.max(Number(params.outline ?? 0) * scale, MIN_OUTLINE), maxOutlinePx);
    for (const shape of colored) {
      if (shape.kind === "rect") {
        outlines.push({
          kind: "rect",
          x: shape.x - o,
          y: shape.y - o,
          w: shape.w + o * 2,
          h: shape.h + o * 2,
          fill: outlineColor,
          opacity: 1,
        });
      } else {
        outlines.push({ kind: "circle", cx: shape.cx, cy: shape.cy, r: shape.r + o, fill: outlineColor, opacity: 1 });
      }
    }
  }

  return [...outlines, ...colored];
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/**
 * 把图元渲染成 SVG 字符串。
 *
 * 构建端优先用 Astro 组件直接输出图元（可被 Astro 优化、也便于加 <title>），
 * 这个函数给 Node 侧场景用：OG 图光栅化、单元测试里断言图元数量。
 */
export function shapesToSvg(shapes: Shape[], options: GeometryOptions & { title?: string } = {}): string {
  const size = options.size ?? DEFAULTS.size;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">`,
  ];
  if (options.title) parts.push(`<title>${escapeXml(options.title)}</title>`);
  for (const s of shapes) {
    if (s.kind === "rect") {
      parts.push(
        `<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" fill="${s.fill}"${s.opacity < 1 ? ` opacity="${r(s.opacity)}"` : ""}/>`
      );
    } else {
      parts.push(
        `<circle cx="${r(s.cx)}" cy="${r(s.cy)}" r="${r(s.r)}" fill="${s.fill}"${s.opacity < 1 ? ` opacity="${r(s.opacity)}"` : ""}/>`
      );
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

/** 坐标保留两位小数，去掉无意义的长尾，减小 HTML 体积 */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
