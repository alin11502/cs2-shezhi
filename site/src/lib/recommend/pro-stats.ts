/**
 * 从站内选手设置里算统计量，供推荐器与统计页共用。
 *
 * 样本量门槛：少于 MIN_SAMPLE 时调用方应明确说"样本不足"，
 * 而不是拿三五个人的数据假装是"职业分布"。
 */
import type { PlayerSettings } from "../types.ts";

export const MIN_SAMPLE = 8;

export interface EdpiStats {
  n: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  sufficient: boolean;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export function edpiStats(settings: PlayerSettings[]): EdpiStats {
  const values = settings
    .map((s) => (s.sensitivity && s.dpi ? Math.round(s.sensitivity * s.dpi) : s.edpi))
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);

  return {
    n: values.length,
    min: values[0] ?? null,
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    max: values[values.length - 1] ?? null,
    sufficient: values.length >= MIN_SAMPLE,
  };
}
