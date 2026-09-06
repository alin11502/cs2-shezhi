/**
 * 表驱动的规则引擎。
 *
 * 不用 if/else 面条：每条规则是 { id, when, apply, why }，按顺序应用，
 * why 累积进 reasons 列表，前台逐条展示"为什么推荐这个"。
 * 这样加一条新规则只加一个对象，不会碰其他逻辑。
 *
 * 锚定的事实（都在指南里有出处）：
 * - 职业 eDPI 大致 800–1600，中位数约 1100
 * - CS2 与 CS:GO 灵敏度 1:1，无换算系数
 * - zoom_sensitivity_ratio 默认 1.0，职业常用 0.8–1.0，0.8189 是 16:9 monitor-distance match
 * - 准星码携带 21 项参数；split_* 四项仅 style=4 时影响外观
 */
import type { Answers, Recommendation } from "./types.ts";
import { clampParams } from "../crosshair/clamp.ts";

interface Rule {
  id: string;
  when: (a: Answers, draft: Draft) => boolean;
  apply: (a: Answers, draft: Draft) => void;
  why: (a: Answers, draft: Draft) => string;
}

interface Draft {
  crosshair: Record<string, number | boolean>;
  sens: {
    edpiLo: number;
    edpiHi: number;
    zoom: number;
    reasons: string[];
  };
  crosshairReasons: string[];
}

function baseDraft(): Draft {
  return {
    crosshair: {
      style: 2, length: 4, thickness: 1, gap: -2, color: 1,
      red: 0, green: 255, blue: 0,
      alpha_enabled: true, alpha: 255,
      outline_enabled: true, outline: 1,
      center_dot_enabled: false, follow_recoil: false,
      fixed_crosshair_gap: 0, t_style_enabled: false, deployed_weapon_gap_enabled: true,
      split_distance: 2, inner_split_alpha: 0.8, outer_split_alpha: 0.4, split_size_ratio: 1.5,
    },
    sens: { edpiLo: 900, edpiHi: 1300, zoom: 1, reasons: [] },
    crosshairReasons: [],
  };
}

const RULES: Rule[] = [
  {
    id: "crosshair-pref-dot",
    when: (a) => a.crosshairPref === "dot",
    apply: (_a, d) => {
      d.crosshair.style = 2;
      d.crosshair.center_dot_enabled = true;
      d.crosshair.length = 2;
      d.crosshair.gap = -1;
    },
    why: () => "你偏好中心点准星：用经典样式 + 中心点、短臂小间隙，瞄准点最明确。",
  },
  {
    id: "crosshair-pref-dynamic",
    when: (a) => a.crosshairPref === "dynamic",
    apply: (_a, d) => {
      d.crosshair.style = 4;
    },
    why: () => "你偏好动态准星：样式设为 4，移动和开火时会向外扩张，能反馈移动状态。",
  },
  {
    id: "crosshair-pref-cross",
    when: (a) => a.crosshairPref === "cross",
    apply: (_a, d) => {
      d.crosshair.style = 2;
      d.crosshair.center_dot_enabled = false;
    },
    why: () => "你偏好十字准星：经典样式、不加中心点，视野干扰最小。",
  },
  {
    id: "crosshair-auto-flick",
    when: (a) => a.crosshairPref === "auto" && a.aimStyle === "flick",
    apply: (_a, d) => {
      d.crosshair.style = 4;
      d.crosshair.length = 5;
    },
    why: () => "甩枪为主且没指定准星类型：动态准星的扩张能提示你是否在移动中开枪，稍长的臂也更好定位。",
  },
  {
    id: "crosshair-auto-steady",
    when: (a) => a.crosshairPref === "auto" && a.aimStyle === "steady",
    apply: (_a, d) => {
      d.crosshair.style = 2;
      d.crosshair.length = 3;
      d.crosshair.gap = -1.5;
    },
    why: () => "跟枪为主且没指定准星类型：静态小十字更稳定，不会因为移动而改变参照。",
  },
  {
    id: "color-pref",
    when: (a) => a.colorPref !== null,
    apply: (a, d) => {
      d.crosshair.color = a.colorPref as number;
      if (a.colorPref === 6) {
        d.crosshair.red = 0;
        d.crosshair.green = 255;
        d.crosshair.blue = 128;
      }
    },
    why: (a) => `颜色按你的偏好设为索引 ${a.colorPref}${a.colorPref === 6 ? "（自定义 RGB）" : ""}。`,
  },
  {
    id: "color-close-maps",
    when: (a) => a.colorPref === null && a.mapPref === "close",
    apply: (_a, d) => {
      d.crosshair.color = 1;
    },
    why: () => "常打近距离地图（烟雾、暗角多）：亮绿色在暗背景上对比最强。",
  },
  {
    id: "outline-always",
    when: () => true,
    apply: (_a, d) => {
      d.crosshair.outline_enabled = true;
      d.crosshair.outline = 1;
    },
    why: () => "加 1 单位黑描边：在亮色地图（沙二、荒漠）上准星不会糊进背景。",
  },
  {
    id: "grip-wrist",
    when: (a) => a.grip === "wrist",
    apply: (_a, d) => {
      d.sens.edpiLo = 1100;
      d.sens.edpiHi = 1600;
    },
    why: () => "手腕流：活动范围小，需要较高灵敏度才能转身，eDPI 区间上调到 1100–1600。",
  },
  {
    id: "grip-arm",
    when: (a) => a.grip === "arm",
    apply: (_a, d) => {
      d.sens.edpiLo = 700;
      d.sens.edpiHi = 1000;
    },
    why: () => "手臂流：用整个手臂瞄准，低灵敏度更稳，eDPI 区间下调到 700–1000。",
  },
  {
    id: "weapon-awp",
    when: (a) => a.weapon === "awp",
    apply: (_a, d) => {
      d.sens.zoom = 0.85;
    },
    why: () => "主玩狙击：开镜系数给 0.85（职业常用 0.8–1.0），开镜后更稳；1.0 会显得偏滑。",
  },
  {
    id: "weapon-mixed-zoom",
    when: (a) => a.weapon === "mixed",
    apply: (_a, d) => {
      d.sens.zoom = 0.9;
    },
    why: () => "步枪狙击混用：开镜系数 0.9 是两边都不难受的折中。",
  },
  {
    id: "experience-new",
    when: (a) => a.experience === "new",
    apply: (_a, d) => {
      // 新手取区间偏高的中点：太低会转不过身，挫败感强
      d.sens.edpiLo = Math.max(d.sens.edpiLo, 1000);
    },
    why: () => "新手：区间下限抬到 1000，避免灵敏度低到转不过身、还没练出甩枪就先放弃。",
  },
  {
    id: "experience-vet",
    when: (a) => a.experience === "vet",
    apply: (_a, d) => {
      d.sens.edpiHi = Math.min(d.sens.edpiHi, 1400);
    },
    why: () => "老手：上限收到 1400，你大概率已经有稳定的肌肉记忆，不需要太宽的范围。",
  },
];

export function recommend(a: Answers): Recommendation {
  const draft = baseDraft();

  for (const rule of RULES) {
    if (rule.when(a, draft)) {
      rule.apply(a, draft);
      draft.crosshairReasons.push(rule.why(a, draft));
    }
  }

  // 灵敏度理由单独收集（baseDraft 的默认区间也算一条依据）
  const sensReasons = [
    `起点取职业常见区间（约 800–1600、中位约 1100）内、按你的发力方式调整后的中点。`,
    ...draft.sens.reasons,
  ];

  const startEdpi = Math.round((draft.sens.edpiLo + draft.sens.edpiHi) / 2);
  const cm360Of = (edpi: number) => Math.round((41563.64 / edpi) * 10) / 10;

  return {
    crosshair: {
      // 统一过 clamp：推荐值也必须落在准星码的合法域内，否则生成的码会静默回绕
      params: clampParams(draft.crosshair) as Record<string, number | boolean>,
      reasons: draft.crosshairReasons,
    },
    sens: {
      edpiRange: [draft.sens.edpiLo, draft.sens.edpiHi],
      startEdpi,
      startSens: Math.round((startEdpi / a.dpi) * 100) / 100,
      // eDPI 越高 cm/360 越小，所以区间是反的
      cm360Range: [cm360Of(draft.sens.edpiHi), cm360Of(draft.sens.edpiLo)],
      zoomSens: draft.sens.zoom,
      reasons: sensReasons,
    },
  };
}
