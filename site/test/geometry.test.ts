import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildShapes, effectiveGap, shapesToSvg, styleNote, type Shape } from "../src/lib/crosshair/geometry.ts";
import { PRESET_RGB, resolveRgb, CUSTOM_COLOR_INDEX } from "../src/lib/crosshair/color.ts";

const BASE = {
  style: 4, length: 5, thickness: 1, gap: -2, color: 1,
  red: 0, green: 255, blue: 0, alpha_enabled: true, alpha: 255,
  outline_enabled: true, outline: 1, center_dot_enabled: false,
  follow_recoil: false, fixed_crosshair_gap: 0, t_style_enabled: false,
  deployed_weapon_gap_enabled: true,
};

const SIZE = 200;
const SCALE = 4;
const CENTER = SIZE / 2;
const rects = (shapes: Shape[]) => shapes.filter((s) => s.kind === "rect");

/**
 * 取"下臂"：竖臂里 y 最大的那条。
 * 不能用 y > CENTER 过滤 —— 真实准星的 gap 通常是负数（BASE 就是 −2），
 * 负 gap 时下臂的 y 反而小于中心，那样过滤会返回 undefined。
 */
function downArm(shapes: Shape[]): Extract<Shape, { kind: "rect" }> {
  const vertical = shapes
    .filter((s): s is Extract<Shape, { kind: "rect" }> => s.kind === "rect" && s.h > s.w)
    .sort((a, b) => b.y - a.y);
  assert.ok(vertical.length >= 1, "找不到竖臂");
  return vertical[0];
}

describe("buildShapes：四臂结构", () => {
  it("无描边时恰好 4 个矩形（四臂）", () => {
    const shapes = buildShapes({ ...BASE, outline_enabled: false });
    assert.equal(shapes.length, 4);
    assert.ok(shapes.every((s) => s.kind === "rect"));
  });

  it("开描边时是 8 个矩形，且描边全部排在彩色之前", () => {
    const shapes = buildShapes(BASE);
    assert.equal(shapes.length, 8);
    // 前 4 个是描边（黑、不透明），后 4 个是彩色
    for (const s of shapes.slice(0, 4)) assert.equal(s.fill, "#000000", "描边应为黑色");
    for (const s of shapes.slice(0, 4)) assert.equal(s.opacity, 1, "描边不受 alpha 影响");
    for (const s of shapes.slice(4)) assert.notEqual(s.fill, "#000000", "彩色层不应是黑色");
  });

  it("描边图元比对应彩色图元四周各大 outline*scale", () => {
    const shapes = buildShapes(BASE);
    const o = BASE.outline * SCALE;
    const [outlineShape, coloredShape] = [shapes[0], shapes[4]] as Shape[];
    assert.equal(outlineShape.kind, "rect");
    assert.equal(coloredShape.kind, "rect");
    if (outlineShape.kind === "rect" && coloredShape.kind === "rect") {
      assert.equal(outlineShape.x, coloredShape.x - o);
      assert.equal(outlineShape.y, coloredShape.y - o);
      assert.equal(outlineShape.w, coloredShape.w + o * 2);
      assert.equal(outlineShape.h, coloredShape.h + o * 2);
    }
  });

  it("T 型准星跳过上臂，只剩 3 臂", () => {
    const shapes = buildShapes({ ...BASE, t_style_enabled: true, outline_enabled: false });
    assert.equal(shapes.length, 3);
    // 上臂的特征是 y + h 恰好等于 center - gap*scale；没有它说明跳过了
    const gapPx = effectiveGap(BASE) * SCALE;
    const upArmY = CENTER - gapPx - BASE.length * SCALE;
    assert.ok(
      !rects(shapes).some((s) => s.kind === "rect" && Math.abs(s.y - upArmY) < 1e-6),
      "T 型准星不应画上臂"
    );
  });

  it("length 为 0 时不画任何臂", () => {
    assert.equal(buildShapes({ ...BASE, length: 0, outline_enabled: false }).length, 0);
  });

  it("thickness 为 0 时不画任何臂", () => {
    assert.equal(buildShapes({ ...BASE, thickness: 0, outline_enabled: false }).length, 0);
  });

  it("中心点单独成图元，且开描边时也带描边", () => {
    const noDot = buildShapes({ ...BASE, center_dot_enabled: false });
    const withDot = buildShapes({ ...BASE, center_dot_enabled: true });
    assert.equal(withDot.length, noDot.length + 2, "中心点应同时增加 1 个彩色 + 1 个描边");
  });

  it("中心点在 thickness 极小时仍可见（不小于最小边长）", () => {
    const shapes = buildShapes({ ...BASE, thickness: 0.1, center_dot_enabled: true, outline_enabled: false });
    const dot = rects(shapes).find((s) => s.kind === "rect" && Math.abs(s.w - s.h) < 1e-6 && s.w < 4);
    assert.ok(dot, "应存在中心点图元");
    if (dot && dot.kind === "rect") assert.ok(dot.w >= 1.5, `中心点边长 ${dot.w} 太小会看不见`);
  });
});

describe("buildShapes：几何位置", () => {
  it("四臂关于中心对称", () => {
    const shapes = rects(buildShapes({ ...BASE, outline_enabled: false }));
    assert.equal(shapes.length, 4);
    // 按面积排序后两两配对：竖臂两个、横臂两个
    const vertical = shapes.filter((s) => s.kind === "rect" && s.h > s.w);
    const horizontal = shapes.filter((s) => s.kind === "rect" && s.w > s.h);
    assert.equal(vertical.length, 2, "应有上下两臂");
    assert.equal(horizontal.length, 2, "应有左右两臂");

    const [up, down] = vertical as Extract<Shape, { kind: "rect" }>[];
    assert.ok(up.y < down.y);
    // 上臂底边与下臂顶边到中心的距离应相等
    const gapPx = effectiveGap(BASE) * SCALE;
    assert.ok(Math.abs(up.y + up.h - (CENTER - gapPx)) < 1e-6, "上臂应止于 gap 处");
    assert.ok(Math.abs(down.y - (CENTER + gapPx)) < 1e-6, "下臂应起于 gap 处");
  });

  it("臂宽等于 thickness*scale，臂长等于 length*scale", () => {
    const shapes = rects(buildShapes({ ...BASE, outline_enabled: false })) as Extract<Shape, { kind: "rect" }>[];
    const vertical = shapes.find((s) => s.h > s.w)!;
    assert.equal(vertical.w, BASE.thickness * SCALE);
    assert.equal(vertical.h, BASE.length * SCALE);
  });

  it("负 gap 让四臂越过中心（内收效果）", () => {
    // 用 |gap| < length 的区间，此时上下臂不会翻转，能稳定按 y 区分
    const shapes = rects(buildShapes({ ...BASE, gap: -2, outline_enabled: false, t_style_enabled: false }));
    const down = downArm(shapes);
    assert.ok(down.y < CENTER, `gap=-2 时下臂应越过中心，实际 y=${down.y}`);
    assert.equal(down.y, CENTER + -2 * SCALE);
  });

  it("|gap| > length 时上臂翻转到中心另一侧（真实几何，不是 bug）", () => {
    // gap=-5、length=5：上臂内缘落在 center+20，整条臂翻到中心下方。
    // 游戏里负 gap 收得比臂长还多时就是这个效果，所以不做"修正"。
    const shapes = rects(buildShapes({ ...BASE, gap: -5, length: 5, outline_enabled: false, t_style_enabled: false })) as Extract<Shape, { kind: "rect" }>[];
    const vertical = shapes.filter((s) => s.h > s.w).sort((a, b) => a.y - b.y);
    assert.equal(vertical.length, 2);
    // 上臂（先 push 的那条）的 y 应当已经越过中心
    const upArm = vertical[1];
    assert.equal(upArm.y, CENTER - (-5 * SCALE) - 5 * SCALE, "上臂 y = center - gapPx - length");
    assert.ok(upArm.y >= CENTER, `|gap|>length 时上臂应翻到中心下方，实际 y=${upArm.y}`);
  });

  it("常见参数范围内图元完整落在 viewBox 内", () => {
    // 职业选手的实际取值区间：length 2–6、gap −4–0、outline ≤3
    for (const p of [
      { ...BASE, length: 2, gap: -1, outline: 1 },
      { ...BASE, length: 5, gap: -2, outline: 1 },
      { ...BASE, length: 6, gap: -4, outline: 3, center_dot_enabled: true },
      { ...BASE, length: 3.5, gap: 0, outline: 0.5, t_style_enabled: true },
    ]) {
      for (const s of buildShapes(p)) {
        if (s.kind !== "rect") continue;
        assert.ok(s.x >= 0 && s.y >= 0, `图元起点越界: ${JSON.stringify(s)}`);
        assert.ok(s.x + s.w <= SIZE && s.y + s.h <= SIZE, `图元终点越界: ${JSON.stringify(s)}`);
      }
    }
  });

  it("极限参数下坐标仍有限、尺寸非负、量级不失控", () => {
    // 固定 scale 是有意为之（保证跨选手按真实比例对比），所以极端参数会被 SVG 裁切，
    // 这里只断言不出现 NaN / 负尺寸 / 描边失控（描边已钳到 UI_MAX*scale）。
    const extreme = { ...BASE, length: 25.5, thickness: 25.5, gap: 12.7, outline: 127.5, center_dot_enabled: true };
    const shapes = buildShapes(extreme);
    assert.ok(shapes.length > 0);
    for (const s of shapes) {
      if (s.kind !== "rect") continue;
      for (const v of [s.x, s.y, s.w, s.h]) {
        assert.ok(Number.isFinite(v), `出现非有限坐标: ${JSON.stringify(s)}`);
      }
      assert.ok(s.w >= 0 && s.h >= 0, `出现负尺寸: ${JSON.stringify(s)}`);
      // 描边钳制前 outline=127.5 会外扩 510 单位、把图元撑到 1050；
      // 钳到 UI_MAX(3)*scale(4)=12 之后，最大边长不应超过臂长 + 2*12
      const maxSide = Math.max(s.w, s.h);
      assert.ok(maxSide <= 25.5 * SCALE + 2 * 12 + 1e-6, `图元尺寸失控: ${maxSide}`);
    }
  });

  it("gapOverride 能逐帧改变间隙（动态预览用）", () => {
    const rest = rects(buildShapes({ ...BASE, outline_enabled: false }));
    const spread = rects(buildShapes({ ...BASE, outline_enabled: false }, { gapOverride: 8 }));
    assert.equal(rest.length, spread.length);
    const restDown = downArm(rest);
    const spreadDown = downArm(spread);
    assert.ok(spreadDown.y > restDown.y, `扩张后下臂应更远离中心：rest=${restDown.y} spread=${spreadDown.y}`);
    assert.equal(restDown.y, CENTER + BASE.gap * SCALE);
    assert.equal(spreadDown.y, CENTER + 8 * SCALE);
  });

  it("alpha 只作用于彩色层", () => {
    const shapes = buildShapes({ ...BASE, alpha_enabled: true, alpha: 128 });
    const colored = shapes.slice(4);
    const outlines = shapes.slice(0, 4);
    for (const s of colored) assert.ok(Math.abs(s.opacity - 128 / 255) < 1e-6);
    for (const s of outlines) assert.equal(s.opacity, 1);
  });

  it("alpha_enabled 为假时彩色层完全不透明", () => {
    const shapes = buildShapes({ ...BASE, alpha_enabled: false, alpha: 10 });
    for (const s of shapes.slice(4)) assert.equal(s.opacity, 1);
  });
});

describe("effectiveGap：唯一待实机校准的假设", () => {
  it("deployed_weapon_gap_enabled 为真时用 gap", () => {
    assert.equal(effectiveGap({ ...BASE, gap: -3, fixed_crosshair_gap: 7, deployed_weapon_gap_enabled: true }), -3);
  });

  it("为假且 fixed_crosshair_gap 非零时用后者", () => {
    assert.equal(effectiveGap({ ...BASE, gap: -3, fixed_crosshair_gap: 7, deployed_weapon_gap_enabled: false }), 7);
  });

  it("为假但 fixed_crosshair_gap 为 0 时回落到 gap", () => {
    assert.equal(effectiveGap({ ...BASE, gap: -3, fixed_crosshair_gap: 0, deployed_weapon_gap_enabled: false }), -3);
  });
});

describe("resolveRgb：预设色必须忽略码里残留的 RGB", () => {
  it("预设索引 0-5 用预设表，无视 red/green/blue", () => {
    // 真实码里常见这种残留：color=4(青) 却带着 rgb(0,255,0)(绿)
    const rgb = resolveRgb({ color: 4, red: 0, green: 255, blue: 0 });
    assert.deepEqual([...rgb], [...PRESET_RGB[4]], "预设色不能用码里的 RGB，否则会画出错误的颜色");
    assert.deepEqual([...rgb], [50, 250, 250]);
  });

  it("每个预设索引都有对应色且互不相同", () => {
    const seen = new Set<string>();
    for (let i = 0; i <= 5; i++) {
      const rgb = resolveRgb({ color: i, red: 0, green: 0, blue: 0 });
      const key = rgb.join(",");
      assert.ok(!seen.has(key), `预设 ${i} 与另一个预设颜色重复`);
      seen.add(key);
    }
    assert.equal(seen.size, 6);
  });

  it("自定义色（索引 6）才读 red/green/blue", () => {
    assert.equal(CUSTOM_COLOR_INDEX, 6);
    const rgb = resolveRgb({ color: 6, red: 200, green: 100, blue: 50 });
    assert.deepEqual([...rgb], [200, 100, 50]);
  });

  it("自定义色的字节被钳到 0-255 并取整", () => {
    const rgb = resolveRgb({ color: 6, red: 300, green: -20, blue: 128.7 });
    assert.deepEqual([...rgb], [255, 0, 129]);
  });

  it("未知索引回落到兜底色而不是崩溃", () => {
    const rgb = resolveRgb({ color: 7, red: 1, green: 2, blue: 3 });
    assert.equal(rgb.length, 3);
    assert.ok(rgb.every((v) => v >= 0 && v <= 255));
  });
});

describe("styleNote：如实标注近似渲染", () => {
  it("动态样式提示只画了静止形态", () => {
    assert.ok(styleNote(4)?.includes("静止形态"));
  });
  it("默认样式与内缩样式都有提示", () => {
    assert.ok(styleNote(0));
    assert.ok(styleNote(3));
  });
  it("经典静态类样式无需提示", () => {
    assert.equal(styleNote(1), null);
    assert.equal(styleNote(2), null);
  });
});

describe("shapesToSvg", () => {
  it("产出结构合法、rect 数量与图元一致", () => {
    const shapes = buildShapes(BASE);
    const svg = shapesToSvg(shapes, { title: "样本选手 A 的准星" });
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.endsWith("</svg>"));
    assert.equal(svg.split("<rect").length - 1, shapes.length);
    assert.ok(svg.includes(`viewBox="0 0 ${SIZE} ${SIZE}"`));
    assert.ok(svg.includes('role="img"'));
  });

  it("title 里的特殊字符被转义", () => {
    const svg = shapesToSvg(buildShapes(BASE), { title: `<script>"x"&'y'` });
    assert.ok(!svg.includes("<script>"));
    assert.ok(svg.includes("&#60;"));
  });

  it("opacity 为 1 时省略该属性（减小体积）", () => {
    const svg = shapesToSvg(buildShapes({ ...BASE, alpha_enabled: false }));
    assert.ok(!svg.includes('opacity="1"'));
  });
});
