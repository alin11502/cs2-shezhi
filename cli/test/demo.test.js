"use strict";

/**
 * demo 解析的归并逻辑单测。
 *
 * 原生解析器（@laihoe/demoparser2）需要真实 .dem 才能验证，这里用假行覆盖
 * groupByPlayer 的归并逻辑：按 steamid 分组、忽略机器人、终局码取最后一个
 * tick、中途换准星标记 changed_mid_demo、viewmodel 从探测到的属性里取、
 * playerInfo 里没采样到的选手也要进结果。
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { groupByPlayer } = require("../src/demo.js");

const mkRow = (steamid, tick, code, extra = {}) => ({ steamid, tick, crosshair_code: code, name: extra.name ?? "p", ...extra });

test.describe("groupByPlayer", () => {
  test("按 steamid 分组并取最后一个 tick 的码作为当前码", () => {
    const parsed = {
      rows: [
        mkRow("76561199000000001", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"),
        mkRow("76561199000000001", 500, "CSGO-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ"),
      ],
      props: { viewmodel: [] },
      playerInfo: [],
    };
    const groups = groupByPlayer(parsed);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].final_code, "CSGO-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ");
    assert.equal(groups[0].changed_mid_demo, true);
    assert.equal(groups[0].observations.length, 2);
  });

  test("observations 按 tick 升序，与输入顺序无关", () => {
    const parsed = {
      rows: [
        mkRow("76561199000000001", 900, "CSGO-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ"),
        mkRow("76561199000000001", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"),
      ],
      props: { viewmodel: [] },
      playerInfo: [],
    };
    const g = groupByPlayer(parsed)[0];
    assert.deepEqual(g.observations.map((o) => o.tick), [100, 900]);
    assert.equal(g.final_code, "CSGO-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ");
  });

  test("单一码不算中途换准星", () => {
    const parsed = {
      rows: [
        mkRow("76561199000000001", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"),
        mkRow("76561199000000001", 500, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"),
      ],
      props: { viewmodel: [] },
      playerInfo: [],
    };
    assert.equal(groupByPlayer(parsed)[0].changed_mid_demo, false);
  });

  test("机器人被忽略", () => {
    const parsed = {
      rows: [
        mkRow("BOT", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"),
        mkRow("", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"),
        mkRow("76561199000000001", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"),
      ],
      props: { viewmodel: [] },
      playerInfo: [],
    };
    const groups = groupByPlayer(parsed);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].steamid64, "76561199000000001");
  });

  test("viewmodel 只取探测到的属性", () => {
    const parsed = {
      rows: [
        {
          ...mkRow("76561199000000001", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"),
          viewmodel_fov: 68,
          viewmodel_offset_x: 2.5,
          viewmodel_fov_unused: 999, // 不在探测列表里，不应进结果
        },
      ],
      props: { viewmodel: ["viewmodel_fov", "viewmodel_offset_x"] },
      playerInfo: [],
    };
    const g = groupByPlayer(parsed)[0];
    assert.deepEqual(g.viewmodel, { viewmodel_fov: 68, viewmodel_offset_x: 2.5 });
  });

  test("没探测到 viewmodel 属性时为 null", () => {
    const parsed = {
      rows: [
        { ...mkRow("76561199000000001", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"), viewmodel_fov: 68 },
      ],
      props: { viewmodel: [] },
      playerInfo: [],
    };
    assert.equal(groupByPlayer(parsed)[0].viewmodel, null);
  });

  test("playerInfo 里没采样到的选手也进结果（final_code 为 null）", () => {
    const parsed = {
      rows: [mkRow("76561199000000001", 100, "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE")],
      props: { viewmodel: [] },
      playerInfo: [{ steamid: "76561199000000002", name: "disconnect-early", team_number: 2 }],
    };
    const groups = groupByPlayer(parsed);
    assert.equal(groups.length, 2);
    const early = groups.find((g) => g.steamid64 === "76561199000000002");
    assert.equal(early.final_code, null);
    assert.equal(early.name, "disconnect-early");
  });

  test("没有 crosshair_code 的行被跳过", () => {
    const parsed = {
      rows: [{ steamid: "76561199000000001", tick: 100, name: "p" }],
      props: { viewmodel: [] },
      playerInfo: [],
    };
    assert.equal(groupByPlayer(parsed).length, 0);
  });
});
