"use strict";

const cfg = require("./config");
const log = require("./log");

// 导入端点由 server/pb_hooks 注册，仅 superuser 可调用。
const IMPORT_PATH = "/api/cs2cx/import";

class PbError extends Error {
  constructor(status, body) {
    super(`PocketBase 返回 ${status}：${summarize(body)}`);
    this.status = status;
    this.body = body;
  }
}

function summarize(body) {
  if (!body) return "(空响应)";
  if (typeof body === "string") return body.slice(0, 500);
  // PocketBase 的字段级错误藏在 data.<field>.message，直接抛出来最好定位
  if (body.data && typeof body.data === "object") {
    const parts = Object.entries(body.data).map(([k, v]) => `${k}: ${v && v.message ? v.message : JSON.stringify(v)}`);
    if (parts.length) return `${body.message || ""} | ${parts.join("; ")}`.trim();
  }
  return JSON.stringify(body).slice(0, 500);
}

async function request(method, urlPath, { token, body } = {}) {
  const res = await fetch(cfg.pbUrl + urlPath, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) throw new PbError(res.status, parsed);
  return parsed;
}

async function health() {
  return request("GET", "/api/health");
}

// PB_TOKEN 优先（CI/脚本场景，不落明文密码）；否则用邮箱密码换 token。
async function getToken() {
  if (cfg.pbToken) return cfg.pbToken;
  if (!cfg.pbAdminEmail || !cfg.pbAdminPassword) {
    throw new Error(
      "缺少 PocketBase 凭证。请在 cli/.env 里填 PB_TOKEN，或同时填 PB_ADMIN_EMAIL 和 PB_ADMIN_PASSWORD。"
    );
  }
  const r = await request("POST", "/api/collections/_superusers/auth-with-password", {
    body: { identity: cfg.pbAdminEmail, password: cfg.pbAdminPassword },
  });
  if (!r || !r.token) throw new Error("认证成功但响应里没有 token");
  log.debug("已用邮箱密码换取 superuser token");
  return r.token;
}

async function importDoc(doc, { dryRun = false } = {}) {
  const token = await getToken();
  return request("POST", IMPORT_PATH + (dryRun ? "?dryRun=1" : ""), { token, body: doc });
}

// 探测导入端点是否已注册。pb_hooks 没加载时 PocketBase 会返回 404，
// 这时给出明确指引比让用户猜"为什么导入失败"要好。
async function importEndpointReady() {
  try {
    const token = await getToken();
    await request("POST", IMPORT_PATH, { token, body: { format_version: 0, demos: [] } });
    return { ready: true };
  } catch (e) {
    if (e instanceof PbError && e.status === 404) {
      return {
        ready: false,
        reason: "导入端点未注册。确认 server/pb_hooks 下有导入脚本，且 PocketBase 启动时带了 --hooksDir 指向它。",
      };
    }
    // 400 说明端点在、只是拒绝了我们的探针载荷 —— 那就是可用的
    if (e instanceof PbError && e.status === 400) return { ready: true };
    return { ready: false, reason: e.message };
  }
}

module.exports = { PbError, request, health, getToken, importDoc, importEndpointReady, IMPORT_PATH };
