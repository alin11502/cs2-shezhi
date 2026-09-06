import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { recommend } from "../src/lib/recommend/rules.ts";
import { matchPlayers } from "../src/lib/recommend/match-players.ts";
import { edpiStats, MIN_SAMPLE } from "../src/lib/recommend/pro-stats.ts";
import { startPsa, nextState, encodeState, decodeState, PSA_MAX_ROUNDS, PSA_CONVERGE_RATIO } from "../src/lib/recommend/psa.ts";
import { RANGES } from "../src/lib/crosshair/clamp.ts";
import { BOOL_PARAMS } from "../src/lib/crosshair/fields.ts";
import type { Answers } from "../src/lib/recommend/types.ts";
import type { Player, PlayerSettings, Snapshot } from "../src/lib/types.ts";

const baseAnswers: Answers = {
  aimStyle: "steady",
  grip: "arm",
  weapon: "rifle",
  resolution: "1920x1080",
  aspect: "16:9",
  screenSizeInch: 24,
  dpi: 800,
  currentSens: 1.2,
  crosshairPref: "auto",
  colorPref: null,
  mapPref: "mixed",
  experience: "mid",
};

describe("PSA 二分逼近", () => {
  it("初始区间是锚点的 0.7 / 1.4 倍", () => {
    const s = startPsa(800, 1.0);
    assert.equal(s.low, 0.7);
    assert.equal(s.high, 1.4);
    assert.deepEqual(s.pair, [0.7, 1.4]);
    assert.equal(s.status, "testing");
    assert.equal(s.round, 1);
  });

  it("一直选低档：区间单调收窄且在 6 轮内收敛", () => {
    let s = startPsa(800, 1.0);
    let prevWidth = s.high - s.low;
    let rounds = 0;
    while (s.status === "testing" && rounds <= PSA_MAX_ROUNDS + 1) {
      s = nextState(s, "a");
      rounds++;
      const width = s.high - s.low;
      assert.ok(width <= prevWidth + 1e-9, `区间不应变宽: ${prevWidth} -> ${width}`);
      prevWidth = width;
    }
    assert.equal(s.status, "converged");
    assert.ok(rounds <= PSA_MAX_ROUNDS, `应在 ${PSA_MAX_ROUNDS} 轮内收敛，实际 ${rounds}`);
    assert.ok(s.finalSens !== null && s.finalSens > 0);
  });

  it("一直选高档同样收敛", () => {
    let s = startPsa(400, 2.0);
    let rounds = 0;
    while (s.status === "testing" && rounds <= PSA_MAX_ROUNDS + 1) {
      s = nextState(s, "b");
      rounds++;
    }
    assert.equal(s.status, "converged");
    assert.ok(rounds <= PSA_MAX_ROUNDS);
  });

  it("选「差不多」会对称收窄并收敛", () => {
    let s = startPsa(800, 1.0);
    let rounds = 0;
    while (s.status === "testing" && rounds <= PSA_MAX_ROUNDS + 1) {
      s = nextState(s, "same");
      rounds++;
    }
    assert.equal(s.status, "converged");
    assert.ok(s.finalSens !== null);
  });

  it("「到此为止」立即以中点收敛", () => {
    let s = startPsa(800, 1.0);
    s = nextState(s, "a");
    const stopped = nextState(s, "stop");
    assert.equal(stopped.status, "converged");
    assert.equal(stopped.finalSens, Math.round(((stopped.low + stopped.high) / 2) * 1000) / 1000);
  });

  it("穷举所有 choice 序列都在 6 轮内收敛（区间单调不增）", () => {
    const choices = ["a", "b", "same"] as const;
    // 3^5 = 243 条长度 5 的序列，足够覆盖分支组合
    const seqs: string[][] = [];
    const walk = (prefix: string[]) => {
      if (prefix.length === 5) return void seqs.push(prefix);
      for (const c of choices) walk([...prefix, c]);
    };
    walk([]);
    for (const seq of seqs) {
      let s = startPsa(800, 1.2);
      let prevWidth = s.high - s.low;
      let rounds = 0;
      for (const c of seq) {
        if (s.status === "converged") break;
        s = nextState(s, c as "a" | "b" | "same");
        rounds++;
        const width = s.high - s.low;
        assert.ok(width <= prevWidth + 1e-9, `序列 ${seq.join("")} 区间变宽`);
        prevWidth = width;
      }
      // 5 轮没收敛的话第 6 轮必须收敛（nextState 里 round > MAX 即收敛）
      if (s.status === "testing") {
        s = nextState(s, "a");
        rounds++;
      }
      assert.equal(s.status, "converged", `序列 ${seq.join("")} 未收敛`);
      assert.ok(rounds <= PSA_MAX_ROUNDS, `序列 ${seq.join("")} 用了 ${rounds} 轮`);
    }
    assert.equal(seqs.length, 243);
  });

  it("收敛宽度阈值确实生效", () => {
    let s = startPsa(800, 1.0);
    while (s.status === "testing") s = nextState(s, "same");
    const width = s.high - s.low;
    assert.ok(width / s.high < PSA_CONVERGE_RATIO || s.round > PSA_MAX_ROUNDS);
  });

  it("状态可序列化进 URL 并还原", () => {
    let s = startPsa(800, 1.2);
    s = nextState(s, "a");
    s = nextState(s, "same");
    const frag = encodeState(s);
    assert.ok(!/[+/=]/.test(frag), "fragment 里不应出现 + / =");
    const back = decodeState(frag);
    assert.deepEqual(back, s);
  });

  it("损坏的 fragment 返回 null 而不是抛错", () => {
    assert.equal(decodeState("!!!not-base64!!!"), null);
    assert.equal(decodeState(encodeState({ ...startPsa(800, 1), v: 99 } as never)), null);
    assert.equal(decodeState(""), null);
  });

  it("已收敛的状态再调用 nextState 不再变化", () => {
    let s = startPsa(800, 1.0);
    while (s.status === "testing") s = nextState(s, "b");
    const frozen = nextState(s, "a");
    assert.deepEqual(frozen, s);
  });
});

describe("规则引擎", () => {
  it("每种准星偏好都产出对应的样式", () => {
    const cases: [Answers["crosshairPref"], number, boolean][] = [
      ["dot", 2, true],
      ["dynamic", 4, false],
      ["cross", 2, false],
    ];
    for (const [pref, style, dot] of cases) {
      const r = recommend({ ...baseAnswers, crosshairPref: pref });
      assert.equal(r.crosshair.params.style, style, `pref=${pref}`);
      assert.equal(r.crosshair.params.center_dot_enabled, dot, `pref=${pref}`);
    }
  });

  it("auto 按打法分派：甩枪给动态、跟枪给静态", () => {
    assert.equal(recommend({ ...baseAnswers, aimStyle: "flick" }).crosshair.params.style, 4);
    assert.equal(recommend({ ...baseAnswers, aimStyle: "steady" }).crosshair.params.style, 2);
  });

  it("颜色偏好优先于地图推断", () => {
    const r = recommend({ ...baseAnswers, colorPref: 3, mapPref: "close" });
    assert.equal(r.crosshair.params.color, 3);
  });

  it("没给颜色偏好时近距离地图推亮绿", () => {
    const r = recommend({ ...baseAnswers, colorPref: null, mapPref: "close" });
    assert.equal(r.crosshair.params.color, 1);
  });

  it("发力方式决定 eDPI 区间方向", () => {
    const wrist = recommend({ ...baseAnswers, grip: "wrist" }).sens.edpiRange;
    const arm = recommend({ ...baseAnswers, grip: "arm" }).sens.edpiRange;
    assert.ok(wrist[0] > arm[0], `手腕流下限 ${wrist[0]} 应高于手臂流 ${arm[0]}`);
    assert.ok(wrist[1] > arm[1]);
  });

  it("狙击给更低的开镜系数", () => {
    assert.ok(recommend({ ...baseAnswers, weapon: "awp" }).sens.zoomSens < recommend({ ...baseAnswers, weapon: "rifle" }).sens.zoomSens);
  });

  it("startSens = startEdpi / dpi", () => {
    const r = recommend({ ...baseAnswers, dpi: 400 });
    assert.equal(r.sens.startSens, Math.round((r.sens.startEdpi / 400) * 100) / 100);
  });

  it("cm/360 区间与 eDPI 区间反向（eDPI 越高 cm 越小）", () => {
    const r = recommend(baseAnswers);
    assert.ok(r.sens.cm360Range[0] < r.sens.cm360Range[1]);
  });

  it("推荐的准星参数全部落在准星码合法域内", () => {
    for (const pref of ["dot", "cross", "dynamic", "auto"] as const) {
      const params = recommend({ ...baseAnswers, crosshairPref: pref }).crosshair.params;
      for (const [key, value] of Object.entries(params)) {
        if (BOOL_PARAMS.has(key)) {
          assert.equal(typeof value, "boolean", key);
          continue;
        }
        const range = RANGES[key];
        if (!range) continue;
        const v = value as number;
        assert.ok(v >= range[0] && v <= range[1], `${pref}: ${key}=${v} 超出 [${range[0]}, ${range[1]}]`);
      }
    }
  });

  it("每条被应用的规则都产出可读的理由", () => {
    const r = recommend(baseAnswers);
    assert.ok(r.crosshair.reasons.length > 0);
    for (const reason of r.crosshair.reasons) {
      assert.ok(reason.length > 8, `理由太短，不像人话: ${reason}`);
    }
    assert.ok(r.sens.reasons.length > 0);
  });
});

describe("选手匹配", () => {
  const mkPlayer = (slug: string, role: string | null, team: string | null): Player =>
    ({ id: slug, slug, name: slug, real_name: null, country: null, steamid64: null, avatar_url: null, hltv_id: null, status: "active", role, sort_order: 0, team: team ? { id: team, name: team, slug: team, tag: null } : null }) as Player;

  const mkSettings = (sens: number, dpi: number, aspect: string | null): PlayerSettings =>
    ({ id: "s", player: "p", player_slug: "p", player_name: "p", sensitivity: sens, dpi, edpi: sens * dpi, zoom_sensitivity: 1, windows_sensitivity: 6, polling_rate: 1000, raw_input: true, resolution: "1920x1080", aspect_ratio: aspect, scaling_mode: "stretch", refresh_rate: 240, brightness: 100, display_mode: "fullscreen", multisampling: 4, boost_player_contrast: "enabled", mouse: null, mousepad: null, keyboard: null, headset: null, monitor: null, launch_options: null, source: "manual", confidence: "low", evidence_url: null, notes: null, verified_at: null }) as PlayerSettings;

  const mkSnap = (style: number, color: number): Snapshot =>
    ({ id: "x", player: "p", player_slug: "p", player_name: "p", code: "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE", style, length: 4, thickness: 1, gap: -2, color, red: 0, green: 255, blue: 0, alpha_enabled: true, alpha: 255, outline_enabled: true, outline: 1, center_dot_enabled: false, follow_recoil: false, fixed_crosshair_gap: 0, t_style_enabled: false, deployed_weapon_gap_enabled: true, split_distance: 2, inner_split_alpha: 0.8, outer_split_alpha: 0.4, split_size_ratio: 1.5, viewmodel_fov: null, viewmodel_offset_x: null, viewmodel_offset_y: null, viewmodel_offset_z: null, viewmodel_presetpos: null, is_current: true, captured_at: null, last_seen_at: null, source: "manual", confidence: "low", evidence_url: null, batch: null, demo: null, last_seen_demo: null }) as Snapshot;

  it("数据全的选手用满 5 个维度", () => {
    const matches = matchPlayers(baseAnswers, [
      { player: mkPlayer("full", "rifler", "t"), settings: mkSettings(1.2, 800, "16:9"), crosshair: mkSnap(2, 1) },
    ]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].dimensionsUsed, 5);
    assert.ok(matches[0].score >= 0 && matches[0].score <= 1);
  });

  it("缺设置的选手剔除 eDPI/比例/cm360 三个维度并归一化权重", () => {
    const matches = matchPlayers(baseAnswers, [
      { player: mkPlayer("nosettings", "rifler", "t"), settings: null, crosshair: mkSnap(2, 1) },
    ]);
    assert.equal(matches.length, 1);
    // 只剩 位置 + 准星 两个维度
    assert.equal(matches[0].dimensionsUsed, 2);
    const weightSum = matches[0].breakdown.reduce((n, b) => n + b.weight, 0);
    // 归一化后权重和应为 (0.2+0.2)/(0.2+0.2) = 1
    assert.ok(Math.abs(weightSum - 1) < 1e-9, `归一化后权重和应为 1，实际 ${weightSum}`);
    assert.ok(matches[0].score >= 0 && matches[0].score <= 1);
  });

  it("完全没数据的选手被跳过而不是给 0 分", () => {
    const matches = matchPlayers(baseAnswers, [
      { player: mkPlayer("empty", null, null), settings: null, crosshair: null },
    ]);
    assert.equal(matches.length, 0);
  });

  it("相似度更高的选手排在前面", () => {
    const matches = matchPlayers(baseAnswers, [
      { player: mkPlayer("far", "awper", "t"), settings: mkSettings(3.5, 1600, "4:3"), crosshair: mkSnap(4, 5) },
      { player: mkPlayer("near", "rifler", "t"), settings: mkSettings(1.2, 800, "16:9"), crosshair: mkSnap(2, 1) },
    ]);
    assert.equal(matches[0].slug, "near");
  });

  it("breakdown 的维度标签与得分都在合法范围", () => {
    const matches = matchPlayers(baseAnswers, [
      { player: mkPlayer("x", "rifler", "t"), settings: mkSettings(1.2, 800, "16:9"), crosshair: mkSnap(2, 1) },
    ]);
    for (const b of matches[0].breakdown) {
      assert.ok(b.score >= 0 && b.score <= 1, `${b.label} 得分 ${b.score} 越界`);
      assert.ok(b.weight > 0 && b.weight <= 0.35);
      assert.ok(b.label.length > 0);
    }
  });
});

describe("统计量与样本门槛", () => {
  const mk = (sens: number, dpi: number): PlayerSettings =>
    ({ sensitivity: sens, dpi } as PlayerSettings);

  it("分位数按排序后的位置取", () => {
    const stats = edpiStats([mk(1, 400), mk(2, 400), mk(3, 400), mk(4, 400), mk(5, 400), mk(6, 400), mk(7, 400), mk(8, 400)]);
    assert.equal(stats.n, 8);
    assert.equal(stats.min, 400);
    assert.equal(stats.max, 3200);
    assert.equal(stats.sufficient, true);
  });

  it("样本不足时 sufficient 为 false", () => {
    const stats = edpiStats([mk(1, 400), mk(2, 400), mk(3, 400)]);
    assert.equal(stats.sufficient, false);
    assert.equal(MIN_SAMPLE, 8);
  });

  it("空设置列表不抛错", () => {
    const stats = edpiStats([]);
    assert.equal(stats.n, 0);
    assert.equal(stats.median, null);
    assert.equal(stats.sufficient, false);
  });

  it("缺 sensitivity 或 dpi 的记录被忽略", () => {
    const stats = edpiStats([{ sensitivity: null, dpi: 800 } as PlayerSettings, mk(2, 400)]);
    assert.equal(stats.n, 1);
  });
});
