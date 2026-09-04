"use strict";

const fs = require("fs");
const path = require("path");
const log = require("./log");

// 记录哪些 demo 已经提取/导入过，避免重复处理数百 MB 的文件。
// 键是 demo 的 sha256，值记录处理时间与产物路径。
function load(file) {
  if (!fs.existsSync(file)) return { version: 1, demos: {} };
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!doc || typeof doc !== "object" || !doc.demos) return { version: 1, demos: {} };
    return doc;
  } catch (e) {
    log.warn(`状态文件损坏，将从空状态开始：${file}（${e.message}）`);
    return { version: 1, demos: {} };
  }
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function markExtracted(state, sha256, info) {
  const prev = state.demos[sha256] || {};
  state.demos[sha256] = {
    ...prev,
    sha256,
    extracted_at: new Date().toISOString(),
    ...info,
  };
}

function markPushed(state, sha256, info) {
  const prev = state.demos[sha256] || { sha256 };
  state.demos[sha256] = {
    ...prev,
    pushed_at: new Date().toISOString(),
    ...info,
  };
}

module.exports = { load, save, markExtracted, markPushed };
