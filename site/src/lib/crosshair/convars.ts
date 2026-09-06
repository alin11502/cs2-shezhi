/**
 * 生成可放进 autoexec.cfg 的配置文本，21 项一行不少。
 *
 * ⚠ 这里曾经会剔除 4 行 cl_crosshair_dynamic_*，理由是"准星码不携带它们、
 * 解码器返回的是引擎默认值、用户拿到会误以为是选手设置"。**该理由已证伪**：
 * 这 4 项编码在 bytes[8]/[10]/[11]，是选手的真实配置（动态准星的分裂行为），
 * 剔除等于让用户下载的 CFG 缺 4 行、与选手实际设置不符。
 */

import { crosshairToConVars } from "csgo-sharecode";

import { paramsToDecoderShape } from "./codec.ts";
import { DYNAMIC_ONLY_PARAMS, PARAM_META } from "./fields.ts";

export interface ConVarOptions {
  /** 是否在开头加注释说明来源 */
  withHeader?: boolean;
  /** 头部注释里标注的选手名 */
  playerName?: string;
}

/** 从 21 项参数生成 CFG 文本 */
export function paramsToConVars(
  params: Record<string, number | boolean>,
  options: ConVarOptions = {}
): string {
  const body = crosshairToConVars(paramsToDecoderShape(params));
  if (!options.withHeader) return body;

  const header = [
    "// CS2 准星配置",
    options.playerName ? `// 选手：${options.playerName}` : null,
    DYNAMIC_ONLY_PARAMS.length && Number(params.style) !== 4
      ? "// 注意：cl_crosshair_dynamic_* 四项仅在动态准星（cl_crosshairstyle 4）下影响外观，"
      : null,
    Number(params.style) !== 4 ? "//       此处仍按选手的实际设置原样保留。" : null,
    "",
  ].filter((line): line is string => line !== null && line !== 0);

  return [...header, body].join("\n");
}

/**
 * 这 4 行 convar 对应的参数键。
 * 参数表用它在非动态样式下标注"仅动态准星生效"，但**不会**因此隐藏或剔除它们。
 */
export function dynamicOnlyConVars(): string[] {
  return DYNAMIC_ONLY_PARAMS.map((key) => PARAM_META[key]?.convar).filter((c): c is string => Boolean(c));
}
