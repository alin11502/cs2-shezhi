"use strict";

const fs = require("fs");
const path = require("path");

const CLI_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(CLI_DIR, "..");

// 最小 .env 解析：不引入 dotenv，避免多一个供应链依赖。
// 只支持 KEY=VALUE、# 注释、可选包裹引号。已存在的环境变量优先（便于 CI 覆盖）。
function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
      (val.startsWith("'") && val.endsWith("'") && val.length > 1)
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...parseEnvFile(path.join(CLI_DIR, ".env")), ...stripEmpty(process.env) };

// process.env 里的空字符串（Windows 上常见）不该覆盖 .env 的值
function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null) out[k] = v;
  return out;
}

const resolve = (p, base) => (p ? path.resolve(base || CLI_DIR, p) : null);

module.exports = {
  CLI_DIR,
  REPO_ROOT,

  pbUrl: (env.PB_URL || "http://127.0.0.1:8090").replace(/\/+$/, ""),
  pbAdminEmail: env.PB_ADMIN_EMAIL || "",
  pbAdminPassword: env.PB_ADMIN_PASSWORD || "",
  pbToken: env.PB_TOKEN || "",

  demoDir: resolve(env.DEMO_DIR || ""),
  outDir: resolve(env.OUT_DIR || "./out"),
  stateFile: resolve(env.CS2CX_STATE || path.join(REPO_ROOT, ".cs2cx-state.json")),

  // 单次 parseTicks 采样的 tick 上限，防止超长 demo 把内存打爆
  maxSampleTicks: Number(env.CS2CX_MAX_SAMPLE_TICKS || 40),

  env,
};
