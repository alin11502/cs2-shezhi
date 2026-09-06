import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { dynamicOnlyConVars, paramsToConVars } from "../src/lib/crosshair/convars.ts";
import { DYNAMIC_ONLY_PARAMS, PARAM_KEYS, PARAM_META } from "../src/lib/crosshair/fields.ts";
import { paramsToCode, codeToParams } from "../src/lib/crosshair/codec.ts";

const require_ = createRequire(import.meta.url);
const cli = require_("../../cli/src/crosshair.js");

const BASE: Record<string, number | boolean> = {
  style: 4, length: 5, thickness: 1, gap: -2, color: 1,
  red: 0, green: 255, blue: 0, alpha_enabled: true, alpha: 255,
  outline_enabled: true, outline: 1, center_dot_enabled: false,
  follow_recoil: false, fixed_crosshair_gap: 0, t_style_enabled: false,
  deployed_weapon_gap_enabled: true,
  // 非默认值，取自真实码 CSGO-UseJt-… 的实测解码结果
  split_distance: 3, inner_split_alpha: 0.1, outer_split_alpha: 1, split_size_ratio: 1,
};

const DYNAMIC_CONVARS = [
  "cl_crosshair_dynamic_splitdist",
  "cl_crosshair_dynamic_splitalpha_innermod",
  "cl_crosshair_dynamic_splitalpha_outermod",
  "cl_crosshair_dynamic_maxdist_splitratio",
];

// 从 CFG 文本里取出某个 convar 的值
function conValue(text: string, convar: string): string | null {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith(`${convar} `)) return t.slice(convar.length).trim().replace(/^"|"$/g, "");
  }
  return null;
}

describe("CFG 必须完整包含 21 项（旧红线已反转）", () => {
  // 这里曾经断言"CFG 里绝不能出现 cl_crosshair_dynamic_* 四行"，
  // 理由是它们"不在码里、是引擎默认值、用户会误以为是选手设置"。
  // 该理由已证伪 —— 剔除等于让用户下载的 CFG 缺 4 行、与选手实际设置不符。
  it("默认输出包含全部 4 行 cl_crosshair_dynamic_*", () => {
    const text = paramsToConVars(BASE);
    for (const convar of DYNAMIC_CONVARS) {
      assert.ok(text.includes(`${convar} `), `${convar} 被错误地剔除了`);
    }
  });

  it("那 4 行的值与输入参数一致，不是引擎默认值", () => {
    const text = paramsToConVars(BASE);
    assert.equal(conValue(text, "cl_crosshair_dynamic_splitdist"), "3");
    assert.equal(conValue(text, "cl_crosshair_dynamic_splitalpha_innermod"), "0.1");
    assert.equal(conValue(text, "cl_crosshair_dynamic_splitalpha_outermod"), "1");
    assert.equal(conValue(text, "cl_crosshair_dynamic_maxdist_splitratio"), "1");
    // 反证：确认不是默认值，否则本用例没有区分度
    assert.notEqual(conValue(text, "cl_crosshair_dynamic_splitdist"), "2");
    assert.notEqual(conValue(text, "cl_crosshair_dynamic_splitalpha_innermod"), "0.8");
  });

  it("convar 行数等于 21（一项不多一项不少）", () => {
    const text = paramsToConVars(BASE);
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("cl_"));
    assert.equal(lines.length, 21, `实际 ${lines.length} 行:\n${lines.join("\n")}`);
    assert.equal(PARAM_KEYS.length, 21);
  });

  it("21 项参数对应的 convar 一个都不少", () => {
    const text = paramsToConVars(BASE);
    for (const key of PARAM_KEYS) {
      const convar = PARAM_META[key]?.convar;
      assert.ok(convar, `${key} 缺 convar 名`);
      assert.ok(text.includes(`${convar} `), `CFG 缺少 ${convar}（对应 ${key}）`);
    }
  });

  it("dynamicOnlyConVars 恰好是那 4 个", () => {
    assert.deepEqual([...dynamicOnlyConVars()].sort(), [...DYNAMIC_CONVARS].sort());
    assert.equal(DYNAMIC_ONLY_PARAMS.length, 4);
  });
});

describe("与 cli 的差分：两侧 CFG 输出必须逐字一致", () => {
  it("基准参数一致", async () => {
    const code = paramsToCode(BASE).code!;
    assert.equal(paramsToConVars(BASE), await cli.toConVars(code));
  });

  it("多组参数一致", async () => {
    const variants = [
      { ...BASE, style: 1, color: 6, red: 12, green: 34, blue: 56 },
      { ...BASE, outline_enabled: false, alpha_enabled: false },
      { ...BASE, center_dot_enabled: true, t_style_enabled: true, follow_recoil: true },
      { ...BASE, length: 0, thickness: 0, gap: 0 },
      { ...BASE, split_distance: 7, inner_split_alpha: 1.5, outer_split_alpha: 0, split_size_ratio: 0.5 },
    ];
    for (const v of variants) {
      const code = paramsToCode(v).code!;
      assert.equal(paramsToConVars(v), await cli.toConVars(code), `不一致: ${JSON.stringify(v)}`);
    }
  });

  it("从真实码出发也一致", async () => {
    const real = "CSGO-UseJt-3oTvn-47wPX-hEyER-WZfiK";
    const params = codeToParams(real);
    assert.equal(paramsToConVars(params), await cli.toConVars(real));
  });

  it("两侧都不再剔除任何 convar 行", async () => {
    const code = paramsToCode(BASE).code!;
    const siteLines = paramsToConVars(BASE).split("\n").filter((l) => l.trim().startsWith("cl_")).length;
    const cliLines = (await cli.toConVars(code)).split("\n").filter((l: string) => l.trim().startsWith("cl_")).length;
    assert.equal(siteLines, cliLines);
    assert.equal(siteLines, 21);
  });
});

describe("header 注释", () => {
  it("默认不加 header", () => {
    assert.ok(!paramsToConVars(BASE).startsWith("//"));
  });

  it("withHeader 时不再声称那 4 项被省略", () => {
    const text = paramsToConVars(BASE, { withHeader: true });
    assert.ok(text.startsWith("//"));
    // 旧 header 会写"只携带 17 项""此处已省略""引擎默认值"，全部不得再出现
    assert.ok(!text.includes("17 项"), "header 里仍有旧的 17 项说法");
    assert.ok(!text.includes("已省略"), "header 里仍声称省略了什么");
    assert.ok(!text.includes("引擎默认值"), "header 里仍有引擎默认值的错误说法");
  });

  it("动态样式下不加多余的注意事项", () => {
    const text = paramsToConVars({ ...BASE, style: 4 }, { withHeader: true });
    assert.ok(!text.includes("仅在动态准星"), "style=4 时不需要这条提示");
  });

  it("静态样式下说明那 4 项不影响外观但仍原样保留", () => {
    const text = paramsToConVars({ ...BASE, style: 2 }, { withHeader: true });
    assert.ok(text.includes("cl_crosshair_dynamic_*"), "应点名这组 convar");
    assert.ok(text.includes("原样保留"), "应说明仍按选手实际设置保留");
    // 即便静态样式，CFG 本体仍必须包含这 4 行
    for (const convar of DYNAMIC_CONVARS) {
      assert.ok(text.includes(`${convar} `), `${convar} 不应因静态样式而被省略`);
    }
  });

  it("给了选手名就写进 header", () => {
    const text = paramsToConVars(BASE, { withHeader: true, playerName: "样本选手 A" });
    assert.ok(text.includes("样本选手 A"));
  });
});
