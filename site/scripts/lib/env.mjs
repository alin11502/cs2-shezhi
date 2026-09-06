/**
 * 最小 .env 解析，供 site/scripts 下的脚本共用。
 * 不引入 dotenv —— 少一个供应链依赖，二十行代码就能覆盖需要的语法。
 *
 * 支持：KEY=VALUE、# 注释、可选的单/双引号包裹。
 * 优先级：进程环境变量 > cli/.env（复用同一份配置，避免两处维护）> 默认值。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE_ROOT = path.resolve(HERE, "../..");
export const REPO_ROOT = path.resolve(SITE_ROOT, "..");

export function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
      (val.startsWith("'") && val.endsWith("'") && val.length > 1)
    ) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}

/** site/.env 覆盖 cli/.env，再被进程环境覆盖 */
export function loadEnv() {
  return {
    ...parseEnvFile(path.join(REPO_ROOT, "cli", ".env")),
    ...parseEnvFile(path.join(SITE_ROOT, ".env")),
    ...stripEmpty(process.env),
  };
}

// process.env 里的空字符串（Windows 上常见）不该覆盖 .env 的值
function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null) out[k] = v;
  return out;
}

export function pbUrl(env = loadEnv()) {
  return (env.PB_URL || "http://127.0.0.1:8090").replace(/\/+$/, "");
}
