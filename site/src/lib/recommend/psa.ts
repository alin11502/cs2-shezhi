/**
 * PSA（Perfect Sensitivity Approximation）二分逼近。
 *
 * 纯函数状态机：state 是可序列化的纯数据，可以塞进 URL fragment 与
 * localStorage，所以刷新、换设备都能续上。
 *
 * 流程：给两个候选灵敏度（一低一高），用户各试一段时间选更好的；
 * 保留更好的那一侧，把区间向被弃侧收一半。两个都觉得差不多时对称收窄。
 * 区间相对宽度 < 5% 或满 6 轮即收敛 —— 再往下是过度拟合，追的是噪声。
 *
 * 倍数 0.7 / 1.4 与 5% 阈值都是社区经验值，没有权威背书；
 * 它们的作用是保证每轮差异足够明显、收敛足够快。页面上要如实说明。
 */
import type { PsaState } from "./types.ts";

export const PSA_MAX_ROUNDS = 6;
export const PSA_CONVERGE_RATIO = 0.05;

/** 初始区间：锚点 ×0.7 到 ×1.4 */
export function startPsa(dpi: number, anchorSens: number): PsaState {
  const low = round3(anchorSens * 0.7);
  const high = round3(anchorSens * 1.4);
  return {
    v: 1,
    dpi,
    round: 1,
    low,
    high,
    pair: [low, high],
    history: [],
    status: "testing",
    finalSens: null,
  };
}

export type PsaChoice = "a" | "b" | "same" | "stop";

export function nextState(s: PsaState, choice: PsaChoice): PsaState {
  if (s.status === "converged") return s;

  const [a, b] = s.pair;
  const mid = round3((s.low + s.high) / 2);
  const history = [...s.history, { round: s.round, pair: s.pair, kept: choice === "a" ? a : choice === "b" ? b : mid }];

  const finish = (final: number): PsaState => ({
    ...s,
    history,
    status: "converged",
    finalSens: round3(final),
    // 收敛态的区间退化成 [final, final]：否则 low/high 还停在收敛前的宽度，
    // 与 status=converged 自相矛盾，"收敛时宽度 < 阈值"也无法从状态本身验证
    low: round3(final),
    high: round3(final),
    pair: [round3(final), round3(final)],
  });

  if (choice === "stop") return finish(mid);

  let low = s.low;
  let high = s.high;
  if (choice === "a") high = mid; // 低的更好 → 上限收到中点
  else if (choice === "b") low = mid; // 高的更好 → 下限抬到中点
  else {
    // 两个差不多：真值在中点附近，围绕中点把宽度减半。
    // 注意不能用 mid×0.85 ~ mid×1.15：当前区间已经很窄时那样反而会变宽
    // （实测序列 aaaasame 就会区间变宽），二分搜索必须单调收窄。
    const quarter = (high - low) / 4;
    low = round3(mid - quarter);
    high = round3(mid + quarter);
  }

  const round = s.round + 1;
  const converged = (high - low) / high < PSA_CONVERGE_RATIO || round > PSA_MAX_ROUNDS;
  if (converged) return finish((low + high) / 2);

  return {
    ...s,
    round,
    low,
    high,
    pair: [round3(low), round3(high)],
    history,
  };
}

/** 把状态编码进 URL fragment（base64url），用于跨设备续做 */
export function encodeState(s: PsaState): string {
  const json = JSON.stringify(s);
  // base64url：避免 + / = 出现在 fragment 里
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeState(fragment: string): PsaState | null {
  try {
    const b64 = fragment.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json);
    if (parsed?.v !== 1) return null;
    if (typeof parsed.low !== "number" || typeof parsed.high !== "number") return null;
    if (!Array.isArray(parsed.pair) || parsed.pair.length !== 2) return null;
    return parsed as PsaState;
  } catch {
    return null;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
