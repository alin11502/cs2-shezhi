/**
 * 准星码编解码封装（站点侧）。
 *
 * 直接用 `csgo-sharecode`：实测它是零依赖、6.4KB 的纯 ESM，不含任何 Node API
 * （无 require / Buffer / process / node: 引用），MIT 许可，因此可以原样打进
 * 浏览器 bundle，不需要自研 codec。它内部用 BigInt，不支持上古浏览器，可接受。
 *
 * 站点是 ESM（package.json 里 "type": "module"），所以这里可以静态 import；
 * cli 那边是 CommonJS，只能用动态 import —— 两侧最终调的是同一个库。
 */

import { decodeCrosshairShareCode, encodeCrosshair, type Crosshair } from "csgo-sharecode";

import { clampParams, findOffStep, findOutOfRange } from "./clamp.ts";
import { DECODER_TO_SITE, SPLIT_DEFAULTS } from "./fields.ts";

/** 准星码的格式：CSGO- + 5 组 5 字符，共 34 字符定长 */
export const CODE_PATTERN = /^CSGO(-?[\w]{5}){5}$/;

export function isValidCode(code: string): boolean {
  return typeof code === "string" && CODE_PATTERN.test(code.trim());
}

/** 把解码器的 camelCase 输出映射成站点的 snake_case，共 21 项 */
export function decoderToParams(decoded: Crosshair): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [camel, snake] of Object.entries(DECODER_TO_SITE)) {
    out[snake] = (decoded as unknown as Record<string, number | boolean>)[camel];
  }
  return out;
}

/**
 * 把站点的 21 项 snake_case 参数转成库需要的 camelCase 对象。
 *
 * ⚠ 这里曾经是数据丢失的源头：旧实现无条件把 split_distance /
 * inner_split_alpha / outer_split_alpha / split_size_ratio 覆盖成引擎默认值
 * （2/0.8/0.4/1.5），理由是"它们不在码里、填什么都不影响解码结果"。
 * 这个理由是错的 —— 它们编码在 bytes[8]/[10]/[11]，填什么**直接决定**产出的码。
 * 结果是重编码真实选手的码会销毁他实际的动态准星设置，并产出另一个码字符串。
 *
 * 现在这 4 项与其他 17 项走完全相同的路径：有值就用值，只有缺失时才回填。
 */
export function paramsToDecoderShape(params: Record<string, number | boolean>): Crosshair {
  const full: Record<string, number | boolean> = {};

  for (const [camel, snake] of Object.entries(DECODER_TO_SITE)) {
    const v = params[snake];
    if (v !== undefined && v !== null) {
      full[camel] = v;
    } else if (snake in SPLIT_DEFAULTS) {
      // 仅在调用方确实没提供时回填（例如消费旧版导出 JSON）
      full[camel] = SPLIT_DEFAULTS[snake as keyof typeof SPLIT_DEFAULTS];
    } else {
      full[camel] = 0;
    }
  }

  return full as unknown as Crosshair;
}

/** 码 → 21 项参数。非法码抛错，调用方负责给出友好提示。 */
export function codeToParams(code: string): Record<string, number | boolean> {
  return decoderToParams(decodeCrosshairShareCode(code.trim()));
}

export interface EncodeResult {
  /** 成功时为准星码，失败为 null */
  code: string | null;
  /** 钳制之后真正被编码的参数（UI 应回显这一份，而不是用户的原始输入） */
  params: Record<string, number | boolean>;
  /** 用户的原始输入里有哪些越界 / 非步进倍数，用于提示 */
  clamped: { key: string; value: number; min: number; max: number }[];
  offStep: { key: string; value: number; expected: number }[];
  /** 回读断言失败的字段。非空表示绝不可把 code 交给用户 */
  mismatch: { key: string; expected: number | boolean; actual: number | boolean }[];
}

/**
 * 参数 → 码，带完整防线。
 *
 * 这是防"静默回绕"的关键路径，三步：
 * 1. 先记录哪些输入越界 / 不是步进倍数（用于提示用户，而不是悄悄改值）
 * 2. clamp + 向零截断到合法域
 * 3. encode 之后立刻 decode 回读，逐项断言与钳制后的输入一致；
 *    不一致就**不返回码**，只返回 mismatch —— 宁可不出码，也不出错误的码。
 */
export function paramsToCode(rawParams: Record<string, number | boolean>): EncodeResult {
  const clamped = findOutOfRange(rawParams);
  const offStep = findOffStep(rawParams);
  const params = clampParams(rawParams) as Record<string, number | boolean>;

  const code = encodeCrosshair(paramsToDecoderShape(params));
  const back = codeToParams(code);

  const mismatch: EncodeResult["mismatch"] = [];
  for (const [key, expected] of Object.entries(params)) {
    const actual = back[key];
    if (actual === undefined) continue;
    const same =
      typeof expected === "boolean" || typeof actual === "boolean"
        ? Boolean(expected) === Boolean(actual)
        : Math.abs(Number(expected) - Number(actual)) < 1e-9;
    if (!same) mismatch.push({ key, expected, actual });
  }

  return { code: mismatch.length ? null : code, params, clamped, offStep, mismatch };
}

/**
 * 往返一致性：encode(decode(code)) 应当还原出**同一个码字符串**。
 *
 * 这条现在是真的成立的 —— 21 项全部透传后，解码再编码是字节级可逆的。
 * 旧实现下它对真实第三方码必然失败，因为那 4 项被默认值覆盖掉了，
 * 这也正是暴露本次数据丢失 bug 的信号。
 */
export function isRoundTripStable(code: string): boolean {
  if (!isValidCode(code)) return false;
  try {
    const params = codeToParams(code);
    return encodeCrosshair(paramsToDecoderShape(params)) === code.trim();
  } catch {
    return false;
  }
}
