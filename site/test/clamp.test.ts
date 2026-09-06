import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RANGES, UI_MAX, clampParam, clampParams, findOffStep, findOutOfRange, truncateToStep } from "../src/lib/crosshair/clamp.ts";
import { BOOL_PARAMS, PARAM_KEYS } from "../src/lib/crosshair/fields.ts";

describe("clampParam：合法范围与步进对齐", () => {
  it("范围内的值原样保留", () => {
    assert.equal(clampParam("length", 5), 5);
    assert.equal(clampParam("gap", -2), -2);
    assert.equal(clampParam("alpha", 255), 255);
    assert.equal(clampParam("style", 4), 4);
  });

  it("边界值本身合法", () => {
    for (const [key, [min, max]] of Object.entries(RANGES)) {
      assert.equal(clampParam(key, min), min, `${key} 下界`);
      assert.equal(clampParam(key, max), max, `${key} 上界`);
    }
  });

  it("超上限被钳到上界（不是回绕）", () => {
    assert.equal(clampParam("length", 30), 25.5);
    assert.equal(clampParam("thickness", 999), 25.5);
    assert.equal(clampParam("alpha", 300), 255);
    assert.equal(clampParam("gap", 100), 12.7);
    assert.equal(clampParam("style", 9), 4);
    assert.equal(clampParam("color", 42), 6);
  });

  it("低于下限被钳到下界", () => {
    assert.equal(clampParam("thickness", -1), 0);
    assert.equal(clampParam("length", -50), 0);
    assert.equal(clampParam("gap", -20), -12.8);
    assert.equal(clampParam("alpha", -10), 0);
    assert.equal(clampParam("style", -3), 0);
  });

  it("非步进倍数按**向零截断**对齐（实测编码器的行为，不是四舍五入）", () => {
    assert.equal(clampParam("length", 2.34), 2.3);
    assert.equal(clampParam("length", 2.36), 2.3, "截断而非四舍五入");
    assert.equal(clampParam("length", 5.75), 5.7, "实测 5.75→5.7");
    assert.equal(clampParam("gap", -1.25), -1.2, "负数向零截断，实测 -2.75→-2.7");
    assert.equal(clampParam("gap", -2.75), -2.7, "数学 floor 会给 -2.8，编码器给的是 -2.7");
    assert.equal(clampParam("alpha", 100.9), 100, "实测 100.9→100");
    assert.equal(clampParam("red", 10.5), 10);
  });

  it("outline 的步进是 0.5（实测，不是 0.1）", () => {
    assert.equal(RANGES.outline[2], 0.5);
    assert.equal(clampParam("outline", 2.24), 2);
    assert.equal(clampParam("outline", 2.74), 2.5, "实测 2.74→2.5");
    assert.equal(clampParam("outline", 2.75), 2.5);
    assert.equal(clampParam("outline", 3.25), 3, "实测 3.25→3");
    assert.equal(clampParam("outline", 69.8), 69.5, "实测 69.8→69.5，这正是模糊测试抓到的 bug");
    assert.equal(clampParam("outline", 24.1), 24, "实测 24.1→24");
  });

  it("布尔参数转成真正的 boolean", () => {
    for (const key of BOOL_PARAMS) {
      assert.equal(clampParam(key, 1), true, key);
      assert.equal(clampParam(key, 0), false, key);
      assert.equal(clampParam(key, ""), false, key);
      assert.equal(clampParam(key, null), false, key);
      assert.equal(clampParam(key, "yes"), true, key);
    }
  });

  it("非有限数值不会污染结果", () => {
    assert.equal(clampParam("length", NaN), 0);
    assert.equal(clampParam("length", Infinity), 25.5);
    assert.equal(clampParam("length", -Infinity), 0);
    assert.equal(clampParam("length", null), 0);
    assert.equal(clampParam("length", undefined), 0);
  });

  it("truncateToStep 不产生浮点尾差", () => {
    // 0.1*3 在 IEEE754 下是 0.30000000000000004
    assert.equal(truncateToStep(0.30000000000000004, 0.1), 0.3);
    assert.equal(String(truncateToStep(12.7, 0.1)), "12.7");
  });

  it("边界值不被 IEEE754 尾差弄坏（这是必须专门防的坑）", () => {
    // 12.7/0.1 = 126.99999999999999，若无防护 trunc 会得到 126 → 12.6
    assert.equal(12.7 / 0.1, 126.99999999999999, "前提：JS 确实有这个尾差");
    assert.equal(truncateToStep(12.7, 0.1), 12.7);
    assert.equal(truncateToStep(-12.8, 0.1), -12.8);
    assert.equal(truncateToStep(25.5, 0.1), 25.5);
    assert.equal(truncateToStep(127.5, 0.5), 127.5);
    // 经过 clampParam 同样成立
    assert.equal(clampParam("gap", 12.7), 12.7);
    assert.equal(clampParam("gap", -12.8), -12.8);
    assert.equal(clampParam("length", 25.5), 25.5);
    assert.equal(clampParam("outline", 127.5), 127.5);
  });

  it("truncateToStep 是向零截断而非四舍五入或数学 floor", () => {
    assert.equal(truncateToStep(2.675, 0.1), 2.6, "四舍五入会给 2.7");
    assert.equal(truncateToStep(-2.75, 0.1), -2.7, "数学 floor 会给 -2.8");
    assert.equal(truncateToStep(5.79, 0.1), 5.7);
    assert.equal(truncateToStep(-0.09, 0.1), 0, "向零截断，-0.09 归 0");
  });

  it("clampParams 整份处理且不动非数值字段", () => {
    const out = clampParams({ length: 99, gap: -99, alpha_enabled: 1, code: "CSGO-x", style: 7 });
    assert.equal(out.length, 25.5);
    assert.equal(out.gap, -12.8);
    assert.equal(out.alpha_enabled, true);
    assert.equal(out.code, "CSGO-x");
    assert.equal(out.style, 4);
  });

  it("UI_MAX 不比编码上限更宽（否则滑条能拖出非法值）", () => {
    for (const [key, max] of Object.entries(UI_MAX)) {
      const range = RANGES[key];
      assert.ok(range, `${key} 应在 RANGES 里`);
      assert.ok(max <= range![1], `${key} 的 UI 上限 ${max} 不应超过编码上限 ${range![1]}`);
    }
  });
});

describe("越界与离步检测（用于提示用户而不是悄悄改值）", () => {
  it("findOutOfRange 报告越界项", () => {
    const found = findOutOfRange({ length: 30, gap: -20, alpha: 255, style: 9, alpha_enabled: true });
    const keys = found.map((f) => f.key).sort();
    assert.deepEqual(keys, ["gap", "length", "style"]);
    const len = found.find((f) => f.key === "length")!;
    assert.deepEqual({ value: len.value, min: len.min, max: len.max }, { value: 30, min: 0, max: 25.5 });
  });

  it("findOffStep 报告会被截断的值", () => {
    const found = findOffStep({ length: 2.34, gap: -2, alpha: 100 });
    assert.equal(found.length, 1);
    assert.equal(found[0].key, "length");
    assert.equal(found[0].expected, 2.3);
  });

  it("全部合法时两个检测都为空", () => {
    const good = { length: 5, gap: -2, thickness: 1, alpha: 255, style: 4, color: 1 };
    assert.deepEqual(findOutOfRange(good), []);
    assert.deepEqual(findOffStep(good), []);
  });
});

describe("字段清单完整性", () => {
  it("PARAM_KEYS 恰好是 21 项", () => {
    assert.equal(PARAM_KEYS.length, 21, `实际 ${PARAM_KEYS.length}: ${PARAM_KEYS.join(", ")}`);
  });

  // 这条曾经是反向断言（"不含这 4 项"），基于"准星码不携带它们"的错误前提。
  // 源码证据（bytes[8]/[10]/[11]）与真实码实测已证伪该前提，断言方向反转：
  // 它们**必须**在 PARAM_KEYS 里，否则 clamp 不覆盖、encode 会用默认值抹掉真值。
  it("PARAM_KEYS **必须包含**那 4 项动态准星参数", () => {
    for (const key of ["split_distance", "inner_split_alpha", "outer_split_alpha", "split_size_ratio"]) {
      assert.ok(PARAM_KEYS.includes(key), `${key} 缺失会导致它绕过钳制并被默认值覆盖`);
    }
  });

  it("每个数值型参数都有范围定义", () => {
    for (const key of PARAM_KEYS) {
      if (BOOL_PARAMS.has(key)) continue;
      assert.ok(RANGES[key], `${key} 缺少范围定义，clamp 会放行任意值`);
    }
  });
});

describe("动态准星 4 项的范围与钳制", () => {
  it("范围来自编码器的位运算", () => {
    // splitDistance = bytes[8] & 7 → 3 位，0–7，步进 1
    assert.deepEqual([...RANGES.split_distance], [0, 7, 1]);
    // 其余三项是 4 位除以 10 → 0–1.5，步进 0.1
    for (const key of ["inner_split_alpha", "outer_split_alpha", "split_size_ratio"]) {
      assert.deepEqual([...RANGES[key]], [0, 1.5, 0.1], key);
    }
  });

  it("合法值原样保留（含真实码里那组 3/0.1/1/1）", () => {
    assert.equal(clampParam("split_distance", 3), 3);
    assert.equal(clampParam("inner_split_alpha", 0.1), 0.1);
    assert.equal(clampParam("outer_split_alpha", 1), 1);
    assert.equal(clampParam("split_size_ratio", 1), 1);
  });

  it("边界值合法", () => {
    assert.equal(clampParam("split_distance", 0), 0);
    assert.equal(clampParam("split_distance", 7), 7);
    assert.equal(clampParam("inner_split_alpha", 0), 0);
    assert.equal(clampParam("inner_split_alpha", 1.5), 1.5);
    assert.equal(clampParam("split_size_ratio", 1.5), 1.5);
  });

  it("超上限被钳住而不是回绕（回绕会产出合法但错误的码）", () => {
    assert.equal(clampParam("split_distance", 8), 7, "8 会在 3 位里回绕成 0");
    assert.equal(clampParam("split_distance", 99), 7);
    assert.equal(clampParam("inner_split_alpha", 1.6), 1.5, "1.6 会溢出 4 位污染相邻字段");
    assert.equal(clampParam("split_size_ratio", 9), 1.5);
  });

  it("低于下限被钳住", () => {
    assert.equal(clampParam("split_distance", -1), 0);
    assert.equal(clampParam("outer_split_alpha", -0.5), 0);
  });

  it("非步进倍数向零截断", () => {
    assert.equal(clampParam("inner_split_alpha", 0.14), 0.1);
    assert.equal(clampParam("inner_split_alpha", 0.19), 0.1);
    assert.equal(clampParam("split_size_ratio", 1.25), 1.2);
    // split_distance 步进是 1，小数被截断
    assert.equal(clampParam("split_distance", 3.9), 3);
  });
});
