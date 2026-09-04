"use strict";

// 极简日志。默认只输出到 stderr，stdout 留给 JSON，便于管道使用。
const USE_COLOR = process.stderr.isTTY && !process.env.NO_COLOR;

const C = {
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};

const paint = (color, s) => (USE_COLOR ? `${C[color]}${s}${C.reset}` : s);

let verbose = !!process.env.CS2CX_VERBOSE;
const setVerbose = (v) => {
  verbose = v;
};

const write = (tag, color, args) => {
  process.stderr.write(`${paint(color, tag)} ${args.map(fmt).join(" ")}\n`);
};

function fmt(v) {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || v.message;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

module.exports = {
  setVerbose,
  isVerbose: () => verbose,
  info: (...a) => write("·", "cyan", a),
  ok: (...a) => write("✓", "green", a),
  warn: (...a) => write("!", "yellow", a),
  error: (...a) => write("✗", "red", a),
  debug: (...a) => verbose && write("…", "dim", a),
  plain: (...a) => process.stderr.write(a.map(fmt).join(" ") + "\n"),
  // stdout 专用：命令的结构化结果
  out: (v) => process.stdout.write(typeof v === "string" ? v + "\n" : JSON.stringify(v, null, 2) + "\n"),
};
