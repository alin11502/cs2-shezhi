import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  CODE_PATTERN,
  codeToParams,
  isRoundTripStable,
  isValidCode,
  paramsToCode,
  paramsToDecoderShape,
} from "../src/lib/crosshair/codec.ts";
import { PARAM_KEYS, SPLIT_DEFAULTS } from "../src/lib/crosshair/fields.ts";

const require_ = createRequire(import.meta.url);
const cli = require_("../../cli/src/crosshair.js");

/**
 * 一组合法的基准参数（21 项齐全）。
 *
 * 那 4 项动态参数刻意用**非默认值** 3/0.1/1/1 —— 取自真实码
 * CSGO-UseJt-3oTvn-47wPX-hEyER-WZfiK 的实测解码结果。若用默认值 2/0.8/0.4/1.5，
 * "encode 无条件覆盖成默认值"这个 bug 就永远测不出来（覆盖前后一样）。
 */
const BASE: Record<string, number | boolean> = {
  style: 4,
  length: 5,
  thickness: 1,
  gap: -2,
  color: 1,
  red: 0,
  green: 255,
  blue: 0,
  alpha_enabled: true,
  alpha: 255,
  outline_enabled: true,
  outline: 1,
  center_dot_enabled: false,
  follow_recoil: false,
  fixed_crosshair_gap: 0,
  t_style_enabled: false,
  deployed_weapon_gap_enabled: true,
  split_distance: 3,
  inner_split_alpha: 0.1,
  outer_split_alpha: 1,
  split_size_ratio: 1,
};

/** 抓到的真实第三方码，用作字节级还原的基准 */
const REAL_CODE = "CSGO-UseJt-3oTvn-47wPX-hEyER-WZfiK";
const REAL_CODE_2 = "CSGO-iCxok-KTVNX-shCzf-Evoek-weaAB";

describe("码格式校验", () => {
  it("接受合法的 34 字符定长码", () => {
    assert.ok(isValidCode(REAL_CODE));
    assert.equal(REAL_CODE.length, 34);
  });

  it("拒绝畸形码", () => {
    for (const bad of ["", "CSGO-", "CSGO-INVALID-CODE-HERE-XXXXX", "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX", "CSGO-abc", "null", `${REAL_CODE}-extra`]) {
      assert.equal(isValidCode(bad), false, `应拒绝: ${bad}`);
    }
  });

  it("码字符集是 URL 安全的（支撑 /crosshair/[code]/ 静态页）", () => {
    const code = paramsToCode(BASE).code!;
    assert.ok(CODE_PATTERN.test(code));
    assert.equal(encodeURIComponent(code), code, "码里有需要转义的字符，不能直接当路径段");
  });
});

describe("paramsToDecoderShape：21 项全部透传", () => {
  it("输出恰好 21 个 camelCase 字段", () => {
    const shape = paramsToDecoderShape(BASE) as unknown as Record<string, unknown>;
    assert.equal(Object.keys(shape).length, 21);
  });

  // 这条曾经是反向断言（"那 4 项被填成引擎默认值"），基于"它们不在码里、
  // 填什么都不影响解码"的错误前提。实测证明填什么**直接决定** bytes[8]/[10]/[11]，
  // 无条件覆盖就是数据丢失。断言方向反转。
  it("那 4 项**原样透传**，绝不被默认值覆盖（这是数据丢失 bug 的防线）", () => {
    const shape = paramsToDecoderShape(BASE) as unknown as Record<string, number>;
    assert.equal(shape.splitDistance, 3, "不得被覆盖成默认值 2");
    assert.equal(shape.innerSplitAlpha, 0.1, "不得被覆盖成默认值 0.8");
    assert.equal(shape.outerSplitAlpha, 1, "不得被覆盖成默认值 0.4");
    assert.equal(shape.splitSizeRatio, 1, "不得被覆盖成默认值 1.5");
    // 反证：确认这组值确实不同于默认值，否则本用例是空转
    assert.notEqual(shape.splitDistance, SPLIT_DEFAULTS.split_distance);
    assert.notEqual(shape.innerSplitAlpha, SPLIT_DEFAULTS.inner_split_alpha);
    assert.notEqual(shape.outerSplitAlpha, SPLIT_DEFAULTS.outer_split_alpha);
    assert.notEqual(shape.splitSizeRatio, SPLIT_DEFAULTS.split_size_ratio);
  });

  it("仅在字段缺失时才回填默认值（兼容旧版导出 JSON）", () => {
    const partial = { ...BASE };
    delete partial.split_distance;
    delete partial.inner_split_alpha;
    const shape = paramsToDecoderShape(partial) as unknown as Record<string, number>;
    assert.equal(shape.splitDistance, SPLIT_DEFAULTS.split_distance, "缺失时应回填");
    assert.equal(shape.innerSplitAlpha, SPLIT_DEFAULTS.inner_split_alpha);
    // 提供了的仍原样透传
    assert.equal(shape.outerSplitAlpha, 1);
    assert.equal(shape.splitSizeRatio, 1);
  });

  it("其余 17 项原样透传", () => {
    const shape = paramsToDecoderShape(BASE) as unknown as Record<string, unknown>;
    assert.equal(shape.style, 4);
    assert.equal(shape.length, 5);
    assert.equal(shape.gap, -2);
    assert.equal(shape.deployedWeaponGapEnabled, true);
  });
});

describe("真实码字节级还原（新红线）", () => {
  it("真实第三方码 decode→encode 必须还原出**同一个码字符串**", () => {
    const params = codeToParams(REAL_CODE);
    const reencoded = paramsToCode(params);
    assert.equal(reencoded.mismatch.length, 0, JSON.stringify(reencoded.mismatch));
    assert.equal(reencoded.code, REAL_CODE, "重编码变了码，说明有字段被覆盖或丢失");
  });

  it("第二个真实码同样字节级还原", () => {
    const params = codeToParams(REAL_CODE_2);
    assert.equal(paramsToCode(params).code, REAL_CODE_2);
  });

  it("真实码的 split 参数不是引擎默认值（这正是当初误判的根源）", () => {
    const p = codeToParams(REAL_CODE);
    assert.equal(p.split_distance, 3);
    assert.equal(p.inner_split_alpha, 0.1);
    assert.equal(p.outer_split_alpha, 1);
    assert.equal(p.split_size_ratio, 1);
    assert.notDeepEqual(
      {
        split_distance: p.split_distance,
        inner_split_alpha: p.inner_split_alpha,
        outer_split_alpha: p.outer_split_alpha,
        split_size_ratio: p.split_size_ratio,
      },
      SPLIT_DEFAULTS,
      "若这组值等于默认值，说明测试样本选得没有区分度"
    );
  });

  it("isRoundTripStable 对真实码成立", () => {
    assert.ok(isRoundTripStable(REAL_CODE));
    assert.ok(isRoundTripStable(REAL_CODE_2));
  });
});

describe("与 cli 的差分：同一组参数必须产出同一个码", () => {
  it("基准参数两侧出码一致", async () => {
    const site = paramsToCode(BASE);
    assert.equal(site.mismatch.length, 0, `回读断言失败: ${JSON.stringify(site.mismatch)}`);
    assert.equal(site.code, await cli.encode(BASE));
  });

  it("多组参数两侧出码一致（含各种非默认 split 组合）", async () => {
    const variants = [
      { ...BASE, style: 1, length: 2.5, gap: -1.5, color: 6, red: 128, green: 64, blue: 32 },
      { ...BASE, style: 2, thickness: 0.5, outline: 3, center_dot_enabled: true },
      { ...BASE, t_style_enabled: true, follow_recoil: true, alpha_enabled: false },
      { ...BASE, length: 25.5, thickness: 25.5, gap: 12.7, alpha: 255, outline: 127.5 },
      { ...BASE, length: 0, thickness: 0, gap: -12.8, style: 0 },
      { ...BASE, split_distance: 7, inner_split_alpha: 1.5, outer_split_alpha: 0, split_size_ratio: 0.5 },
      { ...BASE, split_distance: 0, inner_split_alpha: 0, outer_split_alpha: 1.5, split_size_ratio: 1.5 },
    ];
    for (const v of variants) {
      const site = paramsToCode(v);
      assert.equal(site.mismatch.length, 0, `回读断言失败: ${JSON.stringify(site.mismatch)}`);
      assert.equal(site.code, await cli.encode(v), `参数不一致: ${JSON.stringify(v)}`);
    }
  });

  it("解码方向也一致：同一个码两侧解出同样的 21 项", async () => {
    const code = paramsToCode(BASE).code!;
    assert.deepEqual(codeToParams(code), cli.pickEncoded(await cli.decode(code)));
  });

  it("两侧对真实码的解码结果一致", async () => {
    assert.deepEqual(codeToParams(REAL_CODE), cli.pickEncoded(await cli.decode(REAL_CODE)));
  });
});

describe("非默认 split 值必须存活往返", () => {
  const cases: [string, Record<string, number>][] = [
    ["引擎默认 2/0.8/0.4/1.5", { split_distance: 2, inner_split_alpha: 0.8, outer_split_alpha: 0.4, split_size_ratio: 1.5 }],
    ["真实码里的 3/0.1/1/1", { split_distance: 3, inner_split_alpha: 0.1, outer_split_alpha: 1, split_size_ratio: 1 }],
    ["极端 7/1.5/0/0.5", { split_distance: 7, inner_split_alpha: 1.5, outer_split_alpha: 0, split_size_ratio: 0.5 }],
    ["极端 0/0/1.5/1.5", { split_distance: 0, inner_split_alpha: 0, outer_split_alpha: 1.5, split_size_ratio: 1.5 }],
  ];

  for (const [label, over] of cases) {
    it(label, () => {
      const r = paramsToCode({ ...BASE, ...over });
      assert.equal(r.mismatch.length, 0, JSON.stringify(r.mismatch));
      assert.ok(r.code);
      const back = codeToParams(r.code!);
      for (const [k, v] of Object.entries(over)) {
        assert.equal(back[k], v, `${label}: ${k} 期望 ${v}，码里是 ${back[k]}`);
      }
    });
  }
});

describe("回读断言：静默回绕的防线", () => {
  it("越界输入被钳制后仍然出码，且回读一致", () => {
    const r = paramsToCode({ ...BASE, length: 30 });
    assert.ok(r.clamped.length > 0, "应报告 length 越界");
    assert.equal(r.clamped[0].key, "length");
    assert.equal(r.params.length, 25.5, "钳制后的值应回显给 UI");
    assert.equal(r.mismatch.length, 0);
    assert.ok(r.code, "钳制后应当能出码");
    // 关键：生成的码解回来必须是钳制后的值，而不是回绕值 4.4
    assert.equal(codeToParams(r.code!).length, 25.5);
  });

  it("实测过的四个回绕案例全部被拦住", () => {
    const cases: [string, number][] = [
      ["length", 30],
      ["thickness", -1],
      ["alpha", 300],
      ["style", 9],
    ];
    for (const [key, value] of cases) {
      const r = paramsToCode({ ...BASE, [key]: value });
      assert.equal(r.mismatch.length, 0, `${key}=${value} 回读不一致，说明钳制没拦住`);
      assert.ok(r.code, `${key}=${value} 应当出码`);
    }
  });

  it("style=9 不会污染 center_dot 位", () => {
    const withDot = paramsToCode({ ...BASE, style: 9, center_dot_enabled: true });
    assert.ok(withDot.code);
    const back = codeToParams(withDot.code!);
    assert.equal(back.style, 4, "style 应被钳到 4");
    assert.equal(back.center_dot_enabled, true, "center_dot 位不应被污染");

    const withoutDot = paramsToCode({ ...BASE, style: 9, center_dot_enabled: false });
    assert.equal(codeToParams(withoutDot.code!).center_dot_enabled, false);
  });

  it("split_distance=8 不会在 3 位里回绕成 0", () => {
    const r = paramsToCode({ ...BASE, split_distance: 8 });
    assert.ok(r.clamped.some((c) => c.key === "split_distance"), "应报告越界");
    assert.equal(r.params.split_distance, 7);
    assert.equal(codeToParams(r.code!).split_distance, 7, "8 & 7 = 0，必须被钳制拦住");
  });

  it("inner_split_alpha=1.6 不会溢出 4 位污染相邻字段", () => {
    const r = paramsToCode({ ...BASE, inner_split_alpha: 1.6, outer_split_alpha: 0.7, split_size_ratio: 0.9 });
    assert.equal(r.params.inner_split_alpha, 1.5);
    const back = codeToParams(r.code!);
    assert.equal(back.inner_split_alpha, 1.5);
    assert.equal(back.outer_split_alpha, 0.7, "相邻字段不应被污染");
    assert.equal(back.split_size_ratio, 0.9, "相邻字段不应被污染");
  });

  it("非步进倍数被对齐，回读一致", () => {
    const r = paramsToCode({ ...BASE, length: 2.34 });
    assert.equal(r.offStep.length, 1);
    assert.equal(r.offStep[0].expected, 2.3);
    assert.equal(r.params.length, 2.3);
    assert.equal(r.mismatch.length, 0);
    assert.equal(codeToParams(r.code!).length, 2.3);
  });

  it("decoderToParams 产出 21 项，与 PARAM_KEYS 完全一致", () => {
    const params = codeToParams(paramsToCode(BASE).code!);
    assert.equal(Object.keys(params).length, 21);
    assert.deepEqual(Object.keys(params).sort(), [...PARAM_KEYS].sort());
  });
});
