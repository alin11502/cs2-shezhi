/**
 * 推荐器的类型定义。
 *
 * 设计原则：推荐结果必须**可解释** —— 每个被改动的参数都带一条 why，
 * 前台逐条展示"为什么推荐这个"。黑盒推荐对一个设置站没有价值，
 * 用户需要知道依据才能判断该不该信。
 */

export interface Answers {
  /** 打法：跟枪为主 / 甩枪为主 */
  aimStyle: "steady" | "flick";
  /** 发力：手臂流 / 手腕流 */
  grip: "arm" | "wrist";
  /** 主武器 */
  weapon: "rifle" | "awp" | "mixed";
  /** 分辨率，如 1920x1080 */
  resolution: string;
  /** 屏幕比例 */
  aspect: "4:3" | "16:9" | "16:10" | "5:4" | "21:9";
  /** 屏幕尺寸（英寸），影响"同样的 cm/360 在不同屏幕上转多少视角"的体感 */
  screenSizeInch: number;
  /** 鼠标 DPI */
  dpi: number;
  /** 当前游戏内灵敏度，可选；给了就作为 PSA 的锚点 */
  currentSens: number | null;
  /** 准星偏好 */
  crosshairPref: "dot" | "cross" | "dynamic" | "auto";
  /** 颜色偏好，null 表示交给推荐 */
  colorPref: number | null;
  /** 常打地图类型 */
  mapPref: "open" | "close" | "mixed";
  /** 经验 */
  experience: "new" | "mid" | "vet";
}

export interface SensRecommendation {
  /** 建议的 eDPI 区间 */
  edpiRange: [number, number];
  /** 起点 eDPI（区间中点） */
  startEdpi: number;
  /** 起点游戏内灵敏度 = startEdpi / dpi */
  startSens: number;
  /** 对应的 cm/360 区间（数值越小灵敏度越高，所以是反的） */
  cm360Range: [number, number];
  /** 开镜灵敏度系数建议 */
  zoomSens: number;
  reasons: string[];
}

export interface CrosshairRecommendation {
  params: Record<string, number | boolean>;
  reasons: string[];
}

export interface Recommendation {
  crosshair: CrosshairRecommendation;
  sens: SensRecommendation;
}

/** 选手匹配结果 */
export interface PlayerMatch {
  slug: string;
  name: string;
  teamName: string | null;
  /** 0–1 的总相似度 */
  score: number;
  /** 实际参与计分的维度数（缺数据的维度被剔除） */
  dimensionsUsed: number;
  /** 各维度得分，用于前台画小条形图 */
  breakdown: { label: string; score: number; weight: number }[];
  /** 该选手的当前准星码，用于展示小预览 */
  code: string | null;
  edpi: number | null;
}

/** PSA 二分逼近的状态。纯数据，可序列化进 URL fragment 与 localStorage。 */
export interface PsaState {
  v: 1;
  dpi: number;
  round: number;
  /** 当前灵敏度区间（游戏内灵敏度值） */
  low: number;
  high: number;
  /** 本轮要试的两个值 */
  pair: [number, number];
  history: { round: number; pair: [number, number]; kept: number }[];
  status: "testing" | "converged";
  /** 收敛后的最终灵敏度 */
  finalSens: number | null;
}
