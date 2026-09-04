"use strict";

// 导出格式的唯一定义处。CLI 写、pb_hooks 读，两边都以这里为准。
// 改动 FORMAT_VERSION 时必须同步 server/pb_hooks 的校验逻辑。
const FORMAT_VERSION = 1;

const pkg = require("../package.json");

function generatorInfo(extra = {}) {
  return {
    name: "cs2cx",
    version: pkg.version,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    ...extra,
  };
}

function envelope(demos, extra = {}) {
  return {
    format_version: FORMAT_VERSION,
    generated_at: new Date().toISOString(),
    generator: generatorInfo(extra.generator),
    demos,
  };
}

// 导入端点会拒绝不合规的载荷，所以在本地就先校验一遍，给出可定位的错误。
function validate(doc) {
  const errors = [];
  const require_ = (cond, msg) => {
    if (!cond) errors.push(msg);
  };

  require_(doc && typeof doc === "object", "根节点必须是对象");
  if (!doc || typeof doc !== "object") return errors;

  require_(doc.format_version === FORMAT_VERSION, `format_version 必须是 ${FORMAT_VERSION}，实际为 ${JSON.stringify(doc.format_version)}`);
  require_(Array.isArray(doc.demos), "demos 必须是数组");
  if (!Array.isArray(doc.demos)) return errors;

  doc.demos.forEach((d, i) => {
    const at = `demos[${i}]`;
    require_(d && typeof d === "object", `${at} 必须是对象`);
    if (!d || typeof d !== "object") return;
    require_(typeof d.sha256 === "string" && /^[a-f0-9]{64}$/.test(d.sha256), `${at}.sha256 必须是 64 位十六进制`);
    require_(Array.isArray(d.players), `${at}.players 必须是数组`);
    if (!Array.isArray(d.players)) return;

    d.players.forEach((p, j) => {
      const pat = `${at}.players[${j}]`;
      require_(p && typeof p === "object", `${pat} 必须是对象`);
      if (!p || typeof p !== "object") return;
      require_(typeof p.name === "string" && p.name.length > 0, `${pat}.name 不能为空`);
      require_(p.crosshair && typeof p.crosshair === "object", `${pat}.crosshair 缺失`);
      if (!p.crosshair) return;
      require_(typeof p.crosshair.code === "string" && /^CSGO-/.test(p.crosshair.code), `${pat}.crosshair.code 不是合法的准星分享码`);
      require_(p.crosshair.params && typeof p.crosshair.params === "object", `${pat}.crosshair.params 缺失`);
    });
  });

  return errors;
}

module.exports = { FORMAT_VERSION, envelope, validate, generatorInfo };
