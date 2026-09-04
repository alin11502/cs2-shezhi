"use strict";

const fs = require("fs");
const path = require("path");

const cfg = require("../config");
const log = require("../log");
const demo = require("../demo");
const state = require("../state");

function humanSize(n) {
  if (n == null) return "?";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)}${u[i]}`;
}

// scan 只列清单和已处理状态，不解析 demo 内容（解析一个数百 MB 的 demo 要几秒到几十秒）。
// 需要 sha256 才能对上状态文件，所以 --hash 时才计算。
async function run(args, opts) {
  const dir = args[0] ? path.resolve(args[0]) : opts.demoDir || cfg.demoDir;
  if (!dir) throw new Error("没有指定目录。请传入路径，或在 cli/.env 里设置 DEMO_DIR。");
  if (!fs.existsSync(dir)) throw new Error(`目录不存在：${dir}`);

  const files = demo.findDemos(dir);
  if (!files.length) {
    log.warn(`${dir} 下没有 .dem 文件`);
    return { ok: true, found: 0 };
  }

  const st = state.load(cfg.stateFile);
  const rows = [];

  for (const f of files) {
    const stat = fs.statSync(f);
    let sha = null;
    let status = "未处理";
    if (opts.hash) {
      sha = await demo.sha256File(f);
      const rec = st.demos[sha];
      if (rec && rec.pushed_at) status = `已导入 ${rec.pushed_at.slice(0, 10)}`;
      else if (rec && rec.extracted_at) status = `已提取 ${rec.extracted_at.slice(0, 10)}`;
    }
    rows.push({
      file: path.relative(dir, f) || path.basename(f),
      size: humanSize(stat.size),
      mtime: stat.mtime.toISOString().slice(0, 10),
      sha256: sha,
      status,
    });
  }

  if (opts.json) {
    log.out({ ok: true, dir, found: rows.length, demos: rows });
    return { ok: true, found: rows.length };
  }

  const nameW = Math.min(60, Math.max(...rows.map((r) => r.file.length)));
  log.plain(`${dir} 下找到 ${rows.length} 个 demo：\n`);
  for (const r of rows) {
    log.plain(`  ${r.file.padEnd(nameW)}  ${r.size.padStart(8)}  ${r.mtime}  ${r.status}`);
  }
  if (!opts.hash) log.plain(`\n  加 --hash 可计算 sha256 并显示是否已提取/导入（较慢，需读完整文件）`);
  return { ok: true, found: rows.length };
}

module.exports = { run, humanSize };
