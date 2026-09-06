import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { paramsToCode, codeToParams, isRoundTripStable } from "../src/lib/crosshair/codec.ts";
import { PARAM_KEYS, BOOL_PARAMS } from "../src/lib/crosshair/fields.ts";
import { RANGES } from "../src/lib/crosshair/clamp.ts";
import { buildShapes } from "../src/lib/crosshair/geometry.ts";

/**
 * 随机参数模糊测试。
 *
 * 目的是守住那条红线：任何输入经过 paramsToCode 之后，要么产出一个
 * 与"钳制后参数"完全一致的码，要么明确报 mismatch 而不出码。
 * 绝不允许出现"码合法但参数与显示值不符"的静默回绕。
 */

// 可复现的伪随机（xorshift），失败时能重放出同一组输入
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

const CASES = 3000;

function randomParams(rng: () => number, { wild = false } = {}): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const key of PARAM_KEYS) {
    if (BOOL_PARAMS.has(key)) {
      out[key] = rng() < 0.5;
      continue;
    }
    const range = RANGES[key];
    if (!range) {
      out[key] = Math.floor(rng() * 10);
      continue;
    }
    const [min, max, step] = range;
    if (wild) {
      // 故意越界：覆盖到合法域的 3 倍范围，并混入非步进倍数与特殊值
      const roll = rng();
      if (roll < 0.05) out[key] = [NaN, Infinity, -Infinity][Math.floor(rng() * 3)];
      else out[key] = min + (max - min) * 3 * (rng() - 0.5) * 2;
    } else {
      const steps = Math.round((max - min) / step);
      out[key] = min + Math.floor(rng() * (steps + 1)) * step;
      out[key] = Math.round(Number(out[key]) * 1000) / 1000;
    }
  }
  return out;
}

describe("模糊测试：合法域内的随机参数", () => {
  it(`${CASES} 组全部出码且回读一致`, () => {
    const rng = makeRng(20260904);
    let checked = 0;
    for (let i = 0; i < CASES; i++) {
      const params = randomParams(rng);
      const r = paramsToCode(params);
      assert.equal(r.mismatch.length, 0, `第 ${i} 组回读不一致: ${JSON.stringify(r.mismatch)}\n输入 ${JSON.stringify(params)}`);
      assert.ok(r.code, `第 ${i} 组未出码\n输入 ${JSON.stringify(params)}`);

      const back = codeToParams(r.code!);
      for (const key of PARAM_KEYS) {
        const expected = r.params[key];
        const actual = back[key];
        const same =
          typeof expected === "boolean" || typeof actual === "boolean"
            ? Boolean(expected) === Boolean(actual)
            : Math.abs(Number(expected) - Number(actual)) < 1e-9;
        assert.ok(same, `第 ${i} 组 ${key} 不符：期望 ${expected}，码里是 ${actual}`);
      }
      checked++;
    }
    assert.equal(checked, CASES);
  });

  it("往返稳定 encode(decode(code)) === code", () => {
    const rng = makeRng(424242);
    for (let i = 0; i < 500; i++) {
      const r = paramsToCode(randomParams(rng));
      assert.ok(r.code);
      assert.ok(isRoundTripStable(r.code!), `往返不稳定: ${r.code}`);
    }
  });
});

describe("模糊测试：故意越界的随机参数", () => {
  it(`${CASES} 组全部被钳制拦住，绝无静默回绕`, () => {
    const rng = makeRng(987654321);
    let clampedCount = 0;
    for (let i = 0; i < CASES; i++) {
      const params = randomParams(rng, { wild: true });
      const r = paramsToCode(params);

      // 关键断言：无论输入多离谱，都不允许出现"出了码但参数对不上"
      assert.equal(
        r.mismatch.length,
        0,
        `第 ${i} 组发生静默回绕: ${JSON.stringify(r.mismatch)}\n输入 ${JSON.stringify(params)}`
      );
      if (r.clamped.length || r.offStep.length) clampedCount++;
      if (!r.code) continue;

      const back = codeToParams(r.code);
      for (const key of PARAM_KEYS) {
        const expected = r.params[key];
        const actual = back[key];
        const same =
          typeof expected === "boolean" || typeof actual === "boolean"
            ? Boolean(expected) === Boolean(actual)
            : Math.abs(Number(expected) - Number(actual)) < 1e-9;
        assert.ok(same, `第 ${i} 组 ${key}：钳制后 ${expected}，码里却是 ${actual}`);
      }
    }
    // 越界样本必须真的被触发到，否则这个测试是空的
    assert.ok(clampedCount > CASES * 0.5, `只触发了 ${clampedCount}/${CASES} 次钳制，样本不够野`);
  });

  it("钳制后的值一定落在合法域内", () => {
    const rng = makeRng(13579);
    for (let i = 0; i < 1000; i++) {
      const r = paramsToCode(randomParams(rng, { wild: true }));
      for (const [key, value] of Object.entries(r.params)) {
        if (BOOL_PARAMS.has(key)) {
          assert.equal(typeof value, "boolean", `${key} 应为布尔`);
          continue;
        }
        const range = RANGES[key];
        if (!range || typeof value !== "number") continue;
        const [min, max, step] = range;
        assert.ok(value >= min && value <= max, `${key}=${value} 超出 [${min}, ${max}]`);
        const n = Math.round(value / step);
        assert.ok(Math.abs(value - n * step) < 1e-9, `${key}=${value} 不是 ${step} 的整数倍`);
      }
    }
  });
});

describe("模糊测试：几何渲染不越界、不产 NaN", () => {
  it("随机参数下所有图元坐标都是有限数且落在 viewBox 附近", () => {
    const rng = makeRng(20260905);
    const SIZE = 200;
    for (let i = 0; i < 1000; i++) {
      const r = paramsToCode(randomParams(rng, { wild: true }));
      const shapes = buildShapes(r.params);
      for (const s of shapes) {
        if (s.kind === "rect") {
          for (const v of [s.x, s.y, s.w, s.h]) {
            assert.ok(Number.isFinite(v), `第 ${i} 组出现非有限坐标: ${JSON.stringify(s)}`);
          }
          assert.ok(s.w >= 0 && s.h >= 0, `第 ${i} 组出现负尺寸: ${JSON.stringify(s)}`);
          // 极限参数下允许描边略微出血，但不该离谱
          assert.ok(s.x > -SIZE && s.y > -SIZE && s.x + s.w < SIZE * 2 && s.y + s.h < SIZE * 2,
            `第 ${i} 组图元严重越界: ${JSON.stringify(s)}`);
          assert.ok(s.opacity >= 0 && s.opacity <= 1, `第 ${i} 组 opacity 越界: ${s.opacity}`);
        }
      }
    }
  });
});
