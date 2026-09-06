/**
 * 地图背景定义。
 *
 * ⚠ 为什么是本地生成的示意背景而不是真实地图截图：
 * CS2 的地图原画是 Valve 版权素材，不能合法地再分发到本站；且本机网络
 * 取不到可靠的 Valve CDN URL（steamstatic 路径 404、商店页不可达）。
 * 所以默认用按每张地图色调生成的渐变背景（明确标注"示意背景"）。
 *
 * 如果你自己有截图或有授权的素材：放进 public/maps/<slug>.jpg（或 .png/.webp），
 * CrosshairScene 会优先用它，无需改代码。
 */
export interface MapBg {
  slug: string;
  name: string;
  /** 渐变两端的颜色，模拟该地图的主色调 */
  from: string;
  to: string;
  /** 地面/墙面的大致明暗，用于决定准星描边是否必要 */
  tone: "light" | "dark" | "mixed";
}

export const MAPS: MapBg[] = [
  { slug: "de_mirage", name: " Mirage", from: "#8a7a5c", to: "#4a4132", tone: "mixed" },
  { slug: "de_dust2", name: "Dust II", from: "#a8905e", to: "#5c4c30", tone: "light" },
  { slug: "de_inferno", name: "Inferno", from: "#7a5a3a", to: "#3a2c1e", tone: "mixed" },
  { slug: "de_nuke", name: "Nuke", from: "#5a6a5a", to: "#2a322c", tone: "dark" },
  { slug: "de_overpass", name: "Overpass", from: "#4a5a4a", to: "#26302a", tone: "dark" },
  { slug: "de_ancient", name: "Ancient", from: "#4e5a48", to: "#28302a", tone: "dark" },
  { slug: "de_anubis", name: "Anubis", from: "#8a7440", to: "#3e341e", tone: "mixed" },
  { slug: "de_vertigo", name: "Vertigo", from: "#5a6470", to: "#2a3038", tone: "dark" },
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
