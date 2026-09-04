"use strict";

const fs = require("fs");
const path = require("path");

const cfg = require("../config");
const log = require("../log");
const pb = require("../pb");
const state = require("../state");
const { validate, FORMAT_VERSION } = require("../export-format");

function resolveTargets(args) {
  if (args.length) return args.map((a) => path.resolve(a));
  if (!fs.existsSync(cfg.outDir)) {
    throw new Error(`导出目录不存在：${cfg.outDir}。请先运行 cs2cx extract。`);
  }
  const files = fs
    .readdirSync(cfg.outDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(cfg.outDir, f))
    .sort();
  if (!files.length) throw new Error(`${cfg.outDir} 下没有 .json 导出文件。请先运行 cs2cx extract。`);
  return files;
}

async function run(args, opts) {
  const targets = resolveTargets(args);
  log.info(`目标 ${targets.length} 个文件，PocketBase: ${cfg.pbUrl}`);

  // 先确认服务和端点都在，避免解析完一堆文件才发现连不上
  try {
    await pb.health();
  } catch (e) {
    throw new Error(`连不上 PocketBase（${cfg.pbUrl}）：${e.message}`);
  }
  if (!opts.dryRun) {
    const ready = await pb.importEndpointReady();
    if (!ready.ready) throw new Error(`导入端点不可用：${ready.reason}`);
  }

  const st = state.load(cfg.stateFile);
  const summary = { files: 0, demos: 0, players: 0, skipped: [], failed: [] };

  for (const file of targets) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      log.error(`${path.basename(file)}：不是合法 JSON（${e.message}）`);
      summary.failed.push({ file, error: e.message });
      continue;
    }

    const errors = validate(doc);
    if (errors.length) {
      log.error(`${path.basename(file)}：格式校验未通过（format_version 应为 ${FORMAT_VERSION}）`);
      errors.slice(0, 10).forEach((e) => log.error("  - " + e));
      summary.failed.push({ file, error: errors[0] });
      continue;
    }

    // 已导入过的 demo 默认跳过，--force 可强制重推（导入端点本身按 sha256 幂等）
    let payload = doc;
    if (!opts.force) {
      const fresh = doc.demos.filter((d) => !(st.demos[d.sha256] && st.demos[d.sha256].pushed_at));
      const skipped = doc.demos.length - fresh.length;
      if (skipped) {
        log.info(`${path.basename(file)}：跳过 ${skipped} 个已导入的 demo`);
        summary.skipped.push(...doc.demos.filter((d) => st.demos[d.sha256] && st.demos[d.sha256].pushed_at).map((d) => d.filename));
      }
      if (!fresh.length) continue;
      payload = { ...doc, demos: fresh };
    }

    const nPlayers = payload.demos.reduce((n, d) => n + (d.players || []).length, 0);
    log.info(`${path.basename(file)}：推送 ${payload.demos.length} 个 demo / ${nPlayers} 名选手${opts.dryRun ? "（dry-run）" : ""}`);

    try {
      const res = await pb.importDoc(payload, { dryRun: opts.dryRun });
      summary.files++;
      summary.demos += payload.demos.length;
      summary.players += nPlayers;

      if (!opts.dryRun) {
        for (const d of payload.demos) {
          state.markPushed(st, d.sha256, { filename: d.filename, import_result: res && res.summary });
        }
        state.save(cfg.stateFile, st);
      }

      if (res && res.summary) {
        log.ok(`  → ${JSON.stringify(res.summary)}`);
      } else {
        log.ok(`  → 完成`);
      }
      if (res && Array.isArray(res.warnings) && res.warnings.length) {
        res.warnings.forEach((w) => log.warn(`  ! ${typeof w === "string" ? w : JSON.stringify(w)}`));
      }
    } catch (e) {
      log.error(`${path.basename(file)}：导入失败 —— ${e.message}`);
      summary.failed.push({ file, error: e.message });
    }
  }

  if (opts.json) log.out({ ok: !summary.failed.length, ...summary });
  else {
    log.plain("");
    log.ok(`导入结束：${summary.files} 个文件、${summary.demos} 个 demo、${summary.players} 名选手`);
    if (summary.skipped.length) log.info(`跳过 ${summary.skipped.length} 个已导入的 demo`);
    if (summary.failed.length) log.warn(`${summary.failed.length} 个文件失败`);
  }

  return { ok: !summary.failed.length, ...summary };
}

module.exports = { run, resolveTargets };
