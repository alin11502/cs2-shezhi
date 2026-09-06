/**
 * 地图背景定义。
 *
 * 背景来源：public/maps/<slug>.jpg 放的是 CS2 游戏内真实画面截图（版权属 Valve，
 * 由站长自行提供，仅用于预览示意）。标记 photo:true 的地图会加载该截图；
 * 未提供的地图回落到下面 scene 参数渲染的 SVG 示意场景（天空+地面+斜墙），不使用 AI 生成图。
 *
 * 若图片缺失（onerror），CrosshairScene 同样回落到 SVG 场景。
 * 要补充或替换某张地图：直接把截图覆盖为 public/maps/<slug>.jpg 并把 photo 置为 true。
 */
export interface MapBg {
  slug: string;
  name: string;
  /** 渐变两端的颜色，模拟该地图的主色调 */
  from: string;
  to: string;
  /** 地面/墙面的大致明暗，用于决定准星描边是否必要 */
  tone: "light" | "dark" | "mixed";
  /**
   * 场景几何参数，用于渲染"天空+地面+斜墙"的画面感而不是一个底色：
   * horizon 是地平线高度（0–1，越小天空越多），wall 是两侧墙的倾角（度），
   * mid 是墙体中间色。取值按各地图的视觉印象手调。
   */
  scene: { horizon: number; wall: number; mid: string };
  /** 该地图在 public/maps/<slug>.jpg 提供了 CS2 游戏内真实截图 */
  photo?: true;
}

export const MAPS: MapBg[] = [
  { slug: "de_mirage", name: " Mirage", from: "#9aa7b8", to: "#6b5c42", tone: "mixed", scene: { horizon: 0.42, wall: 18, mid: "#8a7a5c" }, photo: true },
  { slug: "de_dust2", name: "Dust II", from: "#c8b088", to: "#7a6440", tone: "light", scene: { horizon: 0.4, wall: 12, mid: "#a8905e" } },
  { slug: "de_inferno", name: "Inferno", from: "#b08858", to: "#4a3826", tone: "mixed", scene: { horizon: 0.45, wall: 22, mid: "#7a5a3a" }, photo: true },
  { slug: "de_nuke", name: "Nuke", from: "#8fa0a0", to: "#3a4444", tone: "dark", scene: { horizon: 0.5, wall: 8, mid: "#5a6a6a" }, photo: true },
  { slug: "de_overpass", name: "Overpass", from: "#8aa08a", to: "#33403a", tone: "dark", scene: { horizon: 0.46, wall: 15, mid: "#4a5a4a" }, photo: true },
  { slug: "de_ancient", name: "Ancient", from: "#7a8a70", to: "#2e382c", tone: "dark", scene: { horizon: 0.44, wall: 20, mid: "#4e5a48" }, photo: true },
  { slug: "de_anubis", name: "Anubis", from: "#c0a060", to: "#4a3c22", tone: "mixed", scene: { horizon: 0.4, wall: 25, mid: "#8a7440" } },
  { slug: "de_vertigo", name: "Vertigo", from: "#90a0b0", to: "#3a4450", tone: "dark", scene: { horizon: 0.55, wall: 6, mid: "#5a6470" } },
];

export type AspectMode = "16:9" | "4:3-stretch" | "4:3-blackbars" | "4:3-native";

export const ASPECT_MODES: { id: AspectMode; label: string; note: string }[] = [
  { id: "16:9", label: "16:9 原生", note: "宽屏原生分辨率，准星不变形" },
  { id: "4:3-stretch", label: "4:3 拉伸", note: "4:3 画面拉到 16:9，准星横向被拉宽约 1.33 倍" },
  { id: "4:3-blackbars", label: "4:3 黑边", note: "4:3 画面居中、两侧黑边，准星不变形但可视区变窄" },
  { id: "4:3-native", label: "4:3 原生", note: "4:3 显示器原生显示，准星不变形" },
];

/** 16:9 显示器上显示 4:3 拉伸画面时，横向拉伸倍数 = (16/9) ÷ (4/3) */
export const STRETCH_X_43_ON_169 = 16 / 9 / (4 / 3);

/** 16:9 显示器上 4:3 黑边模式，每侧黑边占宽度比例 */
export const BLACK_BAR_RATIO = (16 / 9 - 4 / 3) / (16 / 9) / 2;

/** 该模式下准星应施加的横向拉伸倍数（相对显示器） */
export function stretchFor(mode: AspectMode): number {
  return mode === "4:3-stretch" ? STRETCH_X_43_ON_169 : 1;
}

/** 该模式下画面盒子的宽高比（显示在 16:9 显示器上的实际盒子） */
export function boxAspectFor(mode: AspectMode): string {
  return mode === "4:3-native" ? "4 / 3" : "16 / 9";
}
