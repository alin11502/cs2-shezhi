/**
 * 选手相似度匹配。
 *
 * 加权距离，各维度归一化到 0–1。**缺数据的维度直接剔除并把剩余权重归一化**，
 * 而不是给 0 分 —— 给 0 分会惩罚"数据不全"的选手，而不是"不相似"的选手，
 * 那是两回事。前台会显示"基于 N/5 个维度匹配"，让用户知道置信度。
 */
import type { Answers, PlayerMatch } from "./types.ts";
import type { Player, PlayerSettings, Snapshot } from "../types.ts";

const WEIGHTS = {
  edpi: 0.35,
  role: 0.2,
  crosshair: 0.2,
  resolution: 0.15,
  cm360: 0.1,
} as const;

const ROLE_BY_WEAPON: Record<Answers["weapon"], string[]> = {
  awp: ["awper"],
  rifle: ["rifler", "entry", "lurker"],
  mixed: ["rifler", "entry", "lurker", "awper", "support", "igl"],
};

export interface MatchInput {
  player: Player;
  settings: PlayerSettings | null;
  crosshair: Snapshot | null;
}

/** 单个维度得分 0–1，null 表示该选手缺这项数据（剔除该维度） */
function scoreEdpi(a: Answers, s: PlayerSettings | null): number | null {
  if (!s?.sensitivity || !s.dpi) return null;
  const edpi = s.sensitivity * s.dpi;
  // 以用户起点 eDPI 为中心，差 3 倍 eDPI 视为完全不像（log 尺度）
  const target = a.dpi * (a.currentSens ?? 1.5);
  const ratio = Math.log(edpi / target) / Math.log(3);
  return Math.max(0, 1 - Math.abs(ratio));
}

function scoreRole(a: Answers, p: Player): number | null {
  if (!p.role) return null;
  const wanted = ROLE_BY_WEAPON[a.weapon];
  if (wanted.includes(p.role)) return 1;
  // 指挥/辅助与步枪手的准星习惯差异较小，给部分分
  return 0.4;
}

function scoreCrosshair(a: Answers, s: Snapshot | null): number | null {
  if (!s) return null;
  let score = 0;
  const wantDynamic = a.crosshairPref === "dynamic" || (a.crosshairPref === "auto" && a.aimStyle === "flick");
  const isDynamic = s.style === 4;
  if (a.crosshairPref !== "auto") {
    score += isDynamic === wantDynamic ? 0.5 : 0;
  } else {
    score += 0.5; // 没偏好时不因样式扣分
  }
  if (a.colorPref !== null) {
    score += s.color === a.colorPref ? 0.5 : 0;
  } else {
    score += 0.5;
  }
  return score;
}

function scoreResolution(a: Answers, s: PlayerSettings | null): number | null {
  if (!s?.aspect_ratio) return null;
  if (s.aspect_ratio === a.aspect) return 1;
  // 同为大屏或同为拉伸系给部分分
  const stretched = (x: string) => x === "4:3" || x === "5:4";
  return stretched(s.aspect_ratio) === stretched(a.aspect) ? 0.5 : 0;
}

function scoreCm360(a: Answers, s: PlayerSettings | null): number | null {
  if (!s?.sensitivity || !s.dpi) return null;
  const theirs = 41563.64 / (s.sensitivity * s.dpi);
  const mine = 41563.64 / (a.dpi * (a.currentSens ?? 41563.64 / 1000 / a.dpi));
  // 没给当前灵敏度时无法比较，剔除
  if (!a.currentSens) return null;
  const ratio = Math.log(theirs / mine) / Math.log(2);
  return Math.max(0, 1 - Math.abs(ratio));
}

export function matchPlayers(a: Answers, inputs: MatchInput[], limit = 5): PlayerMatch[] {
  const scored: PlayerMatch[] = [];

  for (const { player, settings, crosshair } of inputs) {
    const dims: { key: keyof typeof WEIGHTS; label: string; score: number }[] = [];
    const edpi = scoreEdpi(a, settings);
    if (edpi !== null) dims.push({ key: "edpi", label: "eDPI 接近度", score: edpi });
    const role = scoreRole(a, player);
    if (role !== null) dims.push({ key: "role", label: "位置/武器", score: role });
    const xh = scoreCrosshair(a, crosshair);
    if (xh !== null) dims.push({ key: "crosshair", label: "准星风格", score: xh });
    const res = scoreResolution(a, settings);
    if (res !== null) dims.push({ key: "resolution", label: "屏幕比例", score: res });
    const cm = scoreCm360(a, settings);
    if (cm !== null) dims.push({ key: "cm360", label: "cm/360 接近度", score: cm });

    if (dims.length === 0) continue;

    // 缺数据的维度剔除后，剩余权重归一化
    const weightSum = dims.reduce((n, d) => n + WEIGHTS[d.key], 0);
    const total = dims.reduce((n, d) => n + d.score * (WEIGHTS[d.key] / weightSum), 0);

    scored.push({
      slug: player.slug,
      name: player.name,
      teamName: player.team?.name ?? null,
      score: Math.round(total * 100) / 100,
      dimensionsUsed: dims.length,
      // 存归一化后的权重：前台每个维度的实际贡献 = score × 这个权重，
      // 存原始权重会让展示与总分对不上（缺维度时原始权重和 < 1）
      breakdown: dims.map((d) => ({
        label: d.label,
        score: Math.round(d.score * 100) / 100,
        weight: Math.round((WEIGHTS[d.key] / weightSum) * 1000) / 1000,
      })),
      code: crosshair?.code ?? null,
      edpi: settings?.sensitivity && settings.dpi ? Math.round(settings.sensitivity * settings.dpi) : (settings?.edpi ?? null),
    });
  }

  return scored.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, "zh-Hans-CN")).slice(0, limit);
}
