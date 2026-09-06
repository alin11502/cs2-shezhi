import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { paramsToCode, codeToParams, isRoundTripStable } from "../src/lib/crosshair/codec.ts";
import { PARAM_KEYS, BOOL_PARAMS } from "../src/lib/crosshair/fields.ts";
import { RANGES, UI_MAX } from "../src/lib/crosshair/clamp.ts";
import { buildShapes, DEFAULT_SCALE, effectiveGap } from "../src/lib/crosshair/geometry.ts";

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

describe("模糊测试：几何渲染不产 NaN、溢出有界", () => {
  // scale 提到 DEFAULT_SCALE 后，极端参数（length 25.5 + gap 12.7 → 半宽 38.2 单位）
  // 乘缩放再叠加描边外扩，坐标会到 ±500 左右，远超 200 的 viewBox。
  // 这是设计内已文档化的裁切行为（geometry.ts 的注释），不是 bug。
  // 所以这里断言的是"溢出有界"而不是"落在 viewBox 内"。
  const MAX_HALF_UNITS = Math.max(RANGES.gap[1], RANGES.gap[1] + RANGES.length[1]);
  const MAX_OUTLINE_UNITS = UI_MAX.outline;
  const bound = 100 + (MAX_HALF_UNITS + MAX_OUTLINE_UNITS) * DEFAULT_SCALE + 1e-6;

  it("随机参数下坐标有限、尺寸非负、opacity 合法、溢出有界", () => {
    const rng = makeRng(20260905);
    for (let i = 0; i < 1000; i++) {
      const r = paramsToCode(randomParams(rng, { wild: true }));
      const shapes = buildShapes(r.params);
      for (const s of shapes) {
        if (s.kind === "rect") {
          for (const v of [s.x, s.y, s.w, s.h]) {
            assert.ok(Number.isFinite(v), `第 ${i} 组出现非有限坐标: ${JSON.stringify(s)}`);
          }
          assert.ok(s.w >= 0 && s.h >= 0, `第 ${i} 组出现负尺寸: ${JSON.stringify(s)}`);
          assert.ok(Math.abs(s.x + s.w / 2 - 100) <= bound, `第 ${i} 组横向溢出失控: ${JSON.stringify(s)}`);
          assert.ok(Math.abs(s.y + s.h / 2 - 100) <= bound, `第 ${i} 组纵向溢出失控: ${JSON.stringify(s)}`);
          assert.ok(s.opacity >= 0 && s.opacity <= 1, `第 ${i} 组 opacity 越界: ${s.opacity}`);
        }
      }
    }
  });

  it("不超出画布的准星不应被裁切（裁切只发生在溢出时）", () => {
    const rng = makeRng(777);
    let checked = 0;
    // scale=12 下"装得进画布"的条件较严（半宽 + 描边 ≤ 8.33 单位），
    // 随机样本里约 7% 合格，所以迭代次数要给足，门槛才有区分度。
    for (let i = 0; i < 20000; i++) {
      const p = randomParams(rng, { wild: false });
      // 必须用 effectiveGap 而不是原始 gap：buildShapes 内部用的就是 effectiveGap
      // （deployed_weapon_gap_enabled 为假且 fixed_crosshair_gap 非零时取后者），
      // 用原始 gap 会算出不同的半宽，把本该跳过的溢出样本误判为"装得进画布"。
      const gap = effectiveGap(p);
      // 包围盒半宽要同时考虑三个方向：
      //   沿轴方向 = max(|gap|, |gap+length|)（臂从 gap 延伸到 gap+length）
      //   垂直方向 = thickness/2（竖臂的宽度是 thickness，向两侧各伸一半）
      // 漏掉 thickness 会误判：thickness 17 的准星臂宽 17×SCALE=204，比画布还宽。
      const half = Math.max(
        Math.abs(gap),
        Math.abs(gap + Number(p.length)),
        Number(p.thickness) / 2
      );
      const pad = (p.outline_enabled ? Number(p.outline) : 0) * DEFAULT_SCALE;
      // 只有"半宽 + 描边外扩"确实装得进画布半宽时，才要求图元完整不裁切。
      if (half * DEFAULT_SCALE + pad > 100) continue;
      checked++;
      for (const s of buildShapes(p)) {
        if (s.kind !== "rect") continue;
        assert.ok(s.x >= 0 && s.y >= 0, `装得进画布却被裁切（起点越界）: ${JSON.stringify(s)}`);
        assert.ok(s.x + s.w <= 200 && s.y + s.h <= 200, `装得进画布却被裁切（终点越界）: ${JSON.stringify(s)}`);
      }
    }
    assert.ok(checked > 200, `可容纳样本太少（${checked}），这条断言没有区分度`);
  });
});
