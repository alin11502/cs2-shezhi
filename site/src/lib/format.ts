/**
 * 展示层的格式化与派生计算。
 *
 * 灵敏度换算的推导（别直接抄网上的常数，容易错）：
 * CS2 与 CS:GO 的 yaw 都是 0.022 度/count，且两者灵敏度 **1:1 一致，无换算系数**。
 *   转满 360° 需要的鼠标计数 = 360 / (yaw × sens × dpi) = 360 / (0.022 × eDPI)
 *   英寸 = 上式 / dpi？不 —— 上式已经是"计数"，除以 dpi 才是英寸：
 *     inches/360 = 360 / (0.022 × sens × dpi) = 16363.64 / eDPI
 *     cm/360     = inches/360 × 2.54        = 41563.64 / eDPI
 * 校验：400 DPI × 2.0 = eDPI 800 → 51.96cm，与社区公认值一致；
 *      400 DPI × 3.09 = eDPI 1236 → 33.6cm，同样对得上。
 */

/** CS2/CS:GO 的 yaw（度/count），两者相同 */
const YAW = 0.022;

/** eDPI = DPI × 游戏内灵敏度 */
export function edpi(sensitivity: number | null | undefined, dpi: number | null | undefined): number | null {
  if (!sensitivity || !dpi) return null;
  return Math.round(sensitivity * dpi);
}

/** 转满 360° 需要移动的厘米数。数值越小灵敏度越高。 */
export function cm360(sensitivity: number | null | undefined, dpi: number | null | undefined): number | null {
  const e = edpi(sensitivity, dpi);
  if (!e) return null;
  return round1((360 / (YAW * e)) * 2.54);
}

/** 转满 360° 需要移动的英寸数 */
export function inches360(sensitivity: number | null | undefined, dpi: number | null | undefined): number | null {
  const e = edpi(sensitivity, dpi);
  if (!e) return null;
  return round1(360 / (YAW * e));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * ISO 3166-1 alpha-2 → 中文国名。
 *
 * 为什么不用国旗 emoji：Windows 的 Chrome / Edge **不渲染**区域指示符旗帜，
 * 会退化成 "CN" 这样的字母对。CS2 玩家绝大多数在 Windows 上，
 * 而本站是中文站，直接给中文国名信息量更大也更稳妥。
 *
 * 只收录 CS2 职业圈常见的国家；未收录的回落到大写代码，绝不显示 undefined。
 */
const COUNTRY_NAMES: Record<string, string> = {
  CN: "中国", TW: "中国台湾", HK: "中国香港",
  US: "美国", CA: "加拿大", BR: "巴西", AR: "阿根廷", CL: "智利",
  RU: "俄罗斯", UA: "乌克兰", KZ: "哈萨克斯坦", BY: "白俄罗斯", LV: "拉脱维亚", EE: "爱沙尼亚", LT: "立陶宛",
  PL: "波兰", CZ: "捷克", SK: "斯洛伐克", HU: "匈牙利", RO: "罗马尼亚", BG: "保加利亚", HR: "克罗地亚",
  RS: "塞尔维亚", BA: "波黑", MK: "北马其顿", AL: "阿尔巴尼亚", GR: "希腊", PT: "葡萄牙", ES: "西班牙",
  DK: "丹麦", SE: "瑞典", NO: "挪威", FI: "芬兰", IS: "冰岛",
  DE: "德国", FR: "法国", NL: "荷兰", BE: "比利时", CH: "瑞士", AT: "奥地利", GB: "英国", IE: "爱尔兰",
  IT: "意大利", TR: "土耳其", IL: "以色列",
  KR: "韩国", JP: "日本", MN: "蒙古", PH: "菲律宾", TH: "泰国", VN: "越南", ID: "印度尼西亚", MY: "马来西亚", SG: "新加坡",
  AU: "澳大利亚", NZ: "新西兰",
  IN: "印度", PK: "巴基斯坦",
  SA: "沙特阿拉伯", AE: "阿联酋", EG: "埃及", MA: "摩洛哥", TN: "突尼斯", DZ: "阿尔及利亚", JO: "约旦",
  ZA: "南非", NG: "尼日利亚",
};

export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return COUNTRY_NAMES[upper] ?? upper;
}

/** 国旗 emoji。仅在明确知道渲染环境支持时才用（本站默认不用，见 countryName 的说明） */
export function flagEmoji(code: string | null | undefined): string | null {
  if (!code || code.length !== 2) return null;
  const base = 0x1f1e6;
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => base + c.charCodeAt(0) - 65));
}

/** region 代码 → 中文名 */
const REGION_NAMES: Record<string, string> = {
  eu: "欧洲", na: "北美", cis: "独联体", br: "南美",
  asia: "亚洲", oce: "大洋洲", mena: "中东北非", sa: "南美", other: "其他",
};

export function regionName(code: string | null | undefined): string | null {
  if (!code) return null;
  return REGION_NAMES[code] ?? code;
}

/** role 代码 → 中文名 */
const ROLE_NAMES: Record<string, string> = {
  awper: "狙击手", rifler: "步枪手", igl: "指挥", support: "辅助",
  entry: "突破手", lurker: "游击", coach: "教练",
};

export function roleName(code: string | null | undefined): string | null {
  if (!code) return null;
  return ROLE_NAMES[code] ?? code;
}

/** 数据来源 → 中文说明。前台必须如实标注，不能让用户以为全是自动提取的。 */
const SOURCE_LABELS: Record<string, string> = {
  demo: "比赛 demo 自动提取",
  manual: "人工录入",
  player_published: "选手本人公开",
  third_party: "第三方站点核对",
  stream: "直播/视频核对",
};

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "来源未标注";
  return SOURCE_LABELS[source] ?? source;
}

const CONFIDENCE_LABELS: Record<string, string> = { high: "高", medium: "中", low: "低" };

export function confidenceLabel(confidence: string | null | undefined): string | null {
  if (!confidence) return null;
  return CONFIDENCE_LABELS[confidence] ?? confidence;
}

/**
 * 把日期字符串格式化成中文短日期。
 * PocketBase 存的是 "2026-02-14 18:30:00.000Z"，ISO 字符串也能吃。
 */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const d = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** aspect_ratio / scaling_mode / display_mode 的中文说明 */
const SCALING_LABELS: Record<string, string> = {
  stretch: "拉伸", black_bars: "黑边", aspect: "保持比例",
};
const DISPLAY_LABELS: Record<string, string> = {
  fullscreen: "全屏", borderless: "无边框窗口", windowed: "窗口化",
};
const STYLE_LABELS_LOCAL: Record<number, string> = {
  0: "默认", 1: "静态（经典）", 2: "经典", 3: "内缩（精准）", 4: "动态",
};
const COLOR_LABELS_LOCAL: Record<number, string> = {
  0: "红", 1: "绿", 2: "黄", 3: "蓝", 4: "青", 5: "粉", 6: "自定义", 7: "未知",
};

export function scalingLabel(v: string | null | undefined): string | null {
  return v ? (SCALING_LABELS[v] ?? v) : null;
}
export function displayLabel(v: string | null | undefined): string | null {
  return v ? (DISPLAY_LABELS[v] ?? v) : null;
}
export function styleLabel(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : (STYLE_LABELS_LOCAL[v] ?? `样式 ${v}`);
}
export function colorLabel(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : (COLOR_LABELS_LOCAL[v] ?? `索引 ${v}`);
}

/** 布尔值 → 开/关，null 保持 null（前台显示 —） */
export function boolLabel(v: boolean | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v ? "开" : "关";
}

/** 数值展示：null/undefined → null，让调用方显示 —；否则去掉多余的 .0 */
export function numLabel(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return String(Number.isInteger(v) ? v : Math.round(v * 100) / 100);
}
