import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  BOOL_PARAMS,
  COLOR_LABELS,
  DECODER_TO_SITE,
  DYNAMIC_ONLY_PARAMS,
  PARAM_KEYS,
  PARAM_META,
  SITE_TO_DECODER,
  SPLIT_DEFAULTS,
  STYLE_LABELS,
} from "../src/lib/crosshair/fields.ts";

// cli/src/crosshair.js 是 CommonJS，站点是 ESM，用 createRequire 加载来做差分比对。
// 两处映射必须完全一致，否则同一组参数在 CLI 与站点会产出不同的码。
const require_ = createRequire(import.meta.url);
const cli = require_("../../cli/src/crosshair.js");

describe("与 cli/src/crosshair.js 的差分（防两处映射漂移）", () => {
  it("21 项 camel→snake 映射完全一致", () => {
    assert.deepEqual(DECODER_TO_SITE, cli.ENCODED_FIELDS);
  });

  it("两侧都是 21 项", () => {
    assert.equal(Object.keys(DECODER_TO_SITE).length, 21);
    assert.equal(Object.keys(cli.ENCODED_FIELDS).length, 21);
  });

  it("动态参数回填默认值两侧一致", () => {
    assert.deepEqual(SPLIT_DEFAULTS, cli.SPLIT_DEFAULTS);
    assert.deepEqual(SPLIT_DEFAULTS, {
      split_distance: 2,
      inner_split_alpha: 0.8,
      outer_split_alpha: 0.4,
      split_size_ratio: 1.5,
    });
  });

  it("SITE_TO_DECODER 是 DECODER_TO_SITE 的精确逆映射", () => {
    assert.equal(Object.keys(SITE_TO_DECODER).length, Object.keys(DECODER_TO_SITE).length);
    for (const [camel, snake] of Object.entries(DECODER_TO_SITE)) {
      assert.equal(SITE_TO_DECODER[snake as string], camel);
    }
  });

  it("21 个 snake_case 键互不重复", () => {
    const all = Object.values(DECODER_TO_SITE);
    assert.equal(all.length, 21);
    assert.equal(new Set(all).size, 21);
  });
});

describe("字段清单本身的正确性", () => {
  it("PARAM_KEYS 与 DECODER_TO_SITE 的值集合一致", () => {
    assert.deepEqual([...PARAM_KEYS].sort(), Object.values(DECODER_TO_SITE).sort());
  });

  it("PARAM_KEYS 恰好是 21 项", () => {
    assert.equal(PARAM_KEYS.length, 21, `实际 ${PARAM_KEYS.length}: ${PARAM_KEYS.join(", ")}`);
  });

  // 这条曾经是反向断言（"PARAM_KEYS 不含这 4 项"），基于一个已被证伪的前提：
  // 声称准星码不携带它们。源码证据（bytes[8]/[10]/[11]）与真实码实测
  // （CSGO-UseJt-… 解出 3/0.1/1/1）都证明它们在码里，所以断言方向反转。
  it("PARAM_KEYS **必须包含**那 4 项动态准星参数", () => {
    for (const key of ["split_distance", "inner_split_alpha", "outer_split_alpha", "split_size_ratio"]) {
      assert.ok(PARAM_KEYS.includes(key), `${key} 必须在 PARAM_KEYS 里，否则会被 encode 用默认值覆盖`);
    }
  });

  it("DYNAMIC_ONLY_PARAMS 恰好是那 4 项", () => {
    assert.deepEqual([...DYNAMIC_ONLY_PARAMS].sort(), [
      "inner_split_alpha",
      "outer_split_alpha",
      "split_distance",
      "split_size_ratio",
    ]);
  });

  it("布尔参数都是 21 项的子集", () => {
    for (const key of BOOL_PARAMS) {
      assert.ok(PARAM_KEYS.includes(key), `${key} 不在 PARAM_KEYS 里`);
    }
  });

  it("布尔参数恰好 6 个，数值参数恰好 15 个", () => {
    assert.equal(BOOL_PARAMS.size, 6);
    assert.equal(PARAM_KEYS.filter((k) => !BOOL_PARAMS.has(k)).length, 15);
  });

  it("style 与 color 的中文标签覆盖全部合法取值", () => {
    for (let i = 0; i <= 4; i++) assert.ok(STYLE_LABELS[i], `style ${i} 缺标签`);
    for (let i = 0; i <= 6; i++) assert.ok(COLOR_LABELS[i], `color ${i} 缺标签`);
  });

  it("color 索引 7 有兜底标签（编码是 3 位，游戏 UI 只到 6，但真实码可能解出 7）", () => {
    assert.ok(COLOR_LABELS[7], "color=7 缺兜底标签，前台会显示 undefined");
  });
});

describe("PARAM_META：参数表的展示元数据", () => {
  it("21 项每一项都有中文标签与 convar 名", () => {
    for (const key of PARAM_KEYS) {
      const meta = PARAM_META[key];
      assert.ok(meta, `${key} 缺 PARAM_META`);
      assert.ok(meta!.label, `${key} 缺中文标签`);
      assert.ok(meta!.convar, `${key} 缺 convar 名`);
      assert.ok(meta!.convar.startsWith("cl_"), `${key} 的 convar 名不像 CS2 convar: ${meta!.convar}`);
    }
  });

  it("恰好那 4 项被标记为 dynamicOnly", () => {
    const flagged = PARAM_KEYS.filter((k) => PARAM_META[k]?.dynamicOnly);
    assert.deepEqual(flagged.sort(), [...DYNAMIC_ONLY_PARAMS].sort());
  });

  it("convar 名互不重复（否则参数表会出现两行同名）", () => {
    const convars = PARAM_KEYS.map((k) => PARAM_META[k].convar);
    assert.equal(new Set(convars).size, convars.length);
  });
});
