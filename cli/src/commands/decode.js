"use strict";

const log = require("../log");
const crosshair = require("../crosshair");

const STYLE_NAMES = {
  0: "默认",
  1: "静态(经典)",
  2: "经典",
  3: "内缩(准)",
  4: "动态",
};

const COLOR_NAMES = {
  0: "红",
  1: "绿",
  2: "黄",
  3: "蓝",
  4: "青",
  5: "粉",
  6: "自定义(RGB)",
};

// decode 不碰 demo，只解一个分享码。适合快速核对选手发的码。
async function run(args, opts) {
  const codes = args.length ? args : [opts.code].filter(Boolean);
  if (!codes.length) throw new Error("请提供准星分享码，例如：cs2cx decode CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX");

  const results = [];
  for (const code of codes) {
    try {
      const decoded = await crosshair.decode(code);
      const params = crosshair.pickEncoded(decoded);
      results.push({ code, ok: true, params, not_in_code: crosshair.pickNotInCode(decoded), raw: decoded });
    } catch (e) {
      results.push({ code, ok: false, error: `${e.constructor.name}: ${e.message}` });
    }
  }

  if (opts.json) {
    log.out(results.length === 1 ? results[0] : results);
    return { ok: results.every((r) => r.ok), results };
  }

  for (const r of results) {
    log.plain(`\n${r.code}`);
    if (!r.ok) {
      log.plain(`  ✗ ${r.error}`);
      continue;
    }
    const p = r.params;
    log.plain(`  样式     ${p.style} (${STYLE_NAMES[p.style] || "?"})`);
    log.plain(
      `  颜色     ${p.color} (${COLOR_NAMES[p.color] || "?"})` +
        (p.color === 6 ? `  rgb(${p.red},${p.green},${p.blue})` : "")
    );
    log.plain(`  长度     ${p.length}      粗细 ${p.thickness}      间隙 ${p.gap}`);
    log.plain(`  透明度   ${p.alpha_enabled ? p.alpha : "未启用"}`);
    log.plain(`  描边     ${p.outline_enabled ? p.outline : "未启用"}`);
    log.plain(
      `  中心点   ${p.center_dot_enabled ? "开" : "关"}   跟随后坐力 ${p.follow_recoil ? "开" : "关"}` +
        `   T 型 ${p.t_style_enabled ? "开" : "关"}`
    );
    log.plain(`  固定间隙 ${p.fixed_crosshair_gap}   随武器调整间隙 ${p.deployed_weapon_gap_enabled ? "开" : "关"}`);

    if (opts.convars) {
      log.plain(`\n  CFG（已剔除准星码不携带的 cl_crosshair_dynamic_* 伪配置）:`);
      const text = await crosshair.toConVars(r.code);
      log.plain(text.split("\n").map((l) => "    " + l).join("\n"));
    }

    log.plain(
      `\n  注意：split_distance / inner_split_alpha / outer_split_alpha / split_size_ratio` +
        `\n        不在准星码里，解码器对任何码都返回引擎默认值 ${JSON.stringify(r.not_in_code)}，` +
        `\n        不是该选手的配置。`
    );
  }

  return { ok: results.every((r) => r.ok), results };
}

module.exports = { run, STYLE_NAMES, COLOR_NAMES };
