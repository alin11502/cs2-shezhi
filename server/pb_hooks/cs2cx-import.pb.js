/// <reference path="../pb_data/types.d.ts" />

// cs2cx 导入端点。契约见 cli/src/export-format.js，两边必须同步改。
//
// 两个 PocketBase 0.40 的坑，都是实测踩出来的，改这个文件前先读：
//
// 1. **所有辅助函数必须定义在 routerAdd 回调内部。** hook 文件的顶层声明
//    （function / const）在请求时全部是 undefined，连 globalThis 也不共享——
//    因为 --hooksPool 会预热多个 goja runtime，回调在与文件加载时不同的
//    runtime 里执行，只有 $app 这类 PocketBase 注入的全局变量可用。
//
// 2. **$app.requireSuperuserAuth 是 undefined**，不能当路由中间件用，
//    必须在回调里手动检查 e.hasSuperuserAuth()，漏掉端点就是公开的。
//
// 另外：findFirstRecordByFilter 找不到记录时抛异常而非返回 null；
// 错误对象是 GoError，访问 .stack 会二次抛错并把真实原因吞成通用 400，
// 所以 catch 里只用 String(err)。
//
// 幂等性：demos 按 sha256 upsert，crosshair_snapshots 按 (demo, player) upsert，
// 同一份导出重复推送不会产生重复数据。

routerAdd("POST", "/api/cs2cx/import", (e) => {
  const FORMAT_VERSION = 1;

  function findFirst(app, collection, filter, params) {
    try {
      return app.findFirstRecordByFilter(collection, filter, params || {});
    } catch (err) {
      return null;
    }
  }

  function findAll(app, collection, filter, params, sort, limit) {
    try {
      return app.findRecordsByFilter(collection, filter, sort || "", limit || 500, 0, params || {});
    } catch (err) {
      return [];
    }
  }

  function slugify(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
  }

  // 选手 slug 必须唯一。同名选手（或 slug 撞车）时追加数字后缀。
  function uniqueSlug(app, base, ignoreId) {
    const fallback = base || "player";
    let candidate = fallback;
    for (let i = 2; i < 50; i++) {
      const clash = findFirst(app, "players", "slug={:s}", { s: candidate });
      if (!clash || clash.id === ignoreId) return candidate;
      candidate = fallback + "-" + i;
    }
    return fallback + "-" + Date.now();
  }

  // 解析选手：优先 steamid64（demo 导入的权威匹配键），其次已有 slug，都没有就新建。
  // 新建的选手只有名字，国籍/战队/真名需要人工补全，所以记进 warnings 提醒。
  function resolvePlayer(app, p, warnings, createdPlayers) {
    if (p.steamid64) {
      const bySteam = findFirst(app, "players", "steamid64={:s}", { s: String(p.steamid64) });
      if (bySteam) {
        // 名字变了（改名/改 ID）就跟着更新，demo 里的是最新观测值
        if (p.name && bySteam.get("name") !== p.name) {
          bySteam.set("name", p.name);
          app.save(bySteam);
        }
        return bySteam;
      }
    }

    const slugBase = slugify(p.name);
    if (slugBase) {
      const bySlug = findFirst(app, "players", "slug={:s}", { s: slugBase });
      // 只有当这条记录还没有 steamid64 时才认领它，避免把别人的档案抢过来
      if (bySlug && !bySlug.get("steamid64") && p.steamid64) {
        bySlug.set("steamid64", String(p.steamid64));
        if (p.name) bySlug.set("name", p.name);
        app.save(bySlug);
        warnings.push("选手 " + p.name + " 按 slug 匹配到已有档案并补上了 steamid64，请核对是否为同一人");
        return bySlug;
      }
    }

    const rec = new Record(app.findCollectionByNameOrId("players"));
    rec.set("name", p.name || "unknown");
    rec.set("slug", uniqueSlug(app, slugBase));
    if (p.steamid64) rec.set("steamid64", String(p.steamid64));
    rec.set("status", "active");
    app.save(rec);

    createdPlayers.push(rec.get("name"));
    return rec;
  }

  // 把 demo 元数据 upsert 进 demos 表，按 sha256 幂等。
  function upsertDemo(app, d, warnings) {
    let rec = findFirst(app, "demos", "sha256={:s}", { s: d.sha256 });
    const isNew = !rec;
    if (isNew) {
      rec = new Record(app.findCollectionByNameOrId("demos"));
      rec.set("sha256", d.sha256);
    }

    // 只覆盖导出里非空的字段，避免把人工补好的元数据冲掉
    const setIfPresent = (field, value) => {
      if (value === undefined || value === null || value === "") return;
      rec.set(field, value);
    };

    setIfPresent("filename", d.filename);
    setIfPresent("sharecode", d.sharecode);
    setIfPresent("match_date", d.match_date);
    setIfPresent("event", d.event);
    setIfPresent("map", d.map);
    setIfPresent("team_a", d.team_a);
    setIfPresent("team_b", d.team_b);
    setIfPresent("source_url", d.source_url);
    setIfPresent("parser_version", d.parser_version);
    setIfPresent("batch", d.batch);
    setIfPresent("size_bytes", d.size_bytes);
    setIfPresent("tick_rate", d.tick_rate);

    app.save(rec);

    const missing = [];
    if (!d.event) missing.push("event");
    if (!d.match_date) missing.push("match_date");
    if (missing.length) {
      warnings.push(
        "demo " + (d.filename || String(d.sha256).slice(0, 8)) + " 缺少 " + missing.join("/") +
        "，前台的历史时间线会不准。可在 demo 旁放同名 .meta.json，或 extract 时用 --event/--date 指定"
      );
    }

    return { record: rec, isNew: isNew };
  }

  // 把导出里的 21 项准星参数写进记录。
  //
  // 这里曾经只有 17 项，并声称 split_distance / inner_split_alpha /
  // outer_split_alpha / split_size_ratio "准星码根本不携带、写进去就是假数据"。
  // **该论断已被证伪**：它们编码在 bytes[8]/[10]/[11]（详见
  // 1756900400_add_split_fields.js 的更正说明），是动态准星的分裂行为参数，
  // 属于选手的真实设置，必须原样入库。
  function applyCrosshairParams(rec, params) {
    const FIELDS = [
      "style", "length", "thickness", "gap", "color", "red", "green", "blue",
      "alpha_enabled", "alpha", "outline_enabled", "outline", "center_dot_enabled",
      "follow_recoil", "fixed_crosshair_gap", "t_style_enabled", "deployed_weapon_gap_enabled",
      "split_distance", "inner_split_alpha", "outer_split_alpha", "split_size_ratio",
    ];
    if (!params) return;
    for (const f of FIELDS) {
      if (params[f] !== undefined && params[f] !== null) rec.set(f, params[f]);
    }
  }

  function applyViewmodel(rec, vm) {
    if (!vm) return;
    const FIELDS = ["viewmodel_fov", "viewmodel_offset_x", "viewmodel_offset_y", "viewmodel_offset_z", "viewmodel_presetpos"];
    for (const f of FIELDS) {
      if (vm[f] !== undefined && vm[f] !== null) rec.set(f, vm[f]);
    }
  }

  // 把该选手已有的 is_current 全部降级。必须在插入新的 current 之前做，
  // 否则撞上部分唯一索引 idx_snap_one_current。
  function demoteCurrent(app, playerId) {
    const currents = findAll(app, "crosshair_snapshots", "player={:p} && is_current=true", { p: playerId }, "", 50);
    for (const c of currents) {
      c.set("is_current", false);
      app.save(c);
    }
    return currents.length;
  }

  // 核心：把一个选手的一套准星落成 snapshot。三种情况——
  // 同 demo 重复导入 / 当前准星在新比赛里复现 / 真的换了准星。
  function upsertSnapshot(app, playerRec, demoRec, ch, opts, warnings, counters) {
    const playerId = playerRec.id;
    const code = ch.code;

    // 情况 1：这个 demo + 这个选手已经有记录 → 就地更新（重复导入幂等）
    const sameDemo = findFirst(app, "crosshair_snapshots", "demo={:d} && player={:p}", { d: demoRec.id, p: playerId });
    if (sameDemo) {
      if (sameDemo.get("code") !== code) {
        warnings.push(playerRec.get("name") + " 在 demo " + demoRec.get("filename") + " 的准星码与已入库的不同，已覆盖为新值");
      }
      applyCrosshairParams(sameDemo, ch.params);
      applyViewmodel(sameDemo, opts.viewmodel);
      sameDemo.set("code", code);
      if (ch.captured_at) sameDemo.set("captured_at", ch.captured_at);
      if (opts.sampled_ticks) sameDemo.set("sampled_ticks", opts.sampled_ticks);
      if (opts.raw) sameDemo.set("raw_json", opts.raw);
      sameDemo.set("source", "demo");
      sameDemo.set("confidence", "high");
      if (opts.batch) sameDemo.set("batch", opts.batch);
      app.save(sameDemo);
      counters.updated++;
      return sameDemo;
    }

    // 情况 2：该选手当前准星就是这个码 → 不新建历史，只记录"又见于这场比赛"
    const current = findFirst(app, "crosshair_snapshots", "player={:p} && is_current=true", { p: playerId });
    if (current && current.get("code") === code) {
      current.set("last_seen_demo", demoRec.id);
      if (ch.captured_at) current.set("last_seen_at", ch.captured_at);
      app.save(current);
      counters.reconfirmed++;
      return current;
    }

    // 情况 3：真的换了准星（或首次入库）→ 降级旧的，新建当前版本
    const demoted = demoteCurrent(app, playerId);
    if (demoted > 1) {
      warnings.push(playerRec.get("name") + " 竟然有 " + demoted + " 条 is_current 记录，已全部降级（正常应为 0 或 1）");
    }

    const rec = new Record(app.findCollectionByNameOrId("crosshair_snapshots"));
    rec.set("player", playerId);
    rec.set("demo", demoRec.id);
    rec.set("last_seen_demo", demoRec.id);
    rec.set("code", code);
    applyCrosshairParams(rec, ch.params);
    applyViewmodel(rec, opts.viewmodel);
    if (ch.captured_at) {
      rec.set("captured_at", ch.captured_at);
      rec.set("last_seen_at", ch.captured_at);
    }
    if (opts.sampled_ticks) rec.set("sampled_ticks", opts.sampled_ticks);
    if (opts.raw) rec.set("raw_json", opts.raw);
    rec.set("source", "demo");
    rec.set("confidence", "high");
    rec.set("is_current", true);
    if (opts.batch) rec.set("batch", opts.batch);
    app.save(rec);

    counters.created++;
    if (demoted === 1) counters.historyAdvanced++;
    return rec;
  }

  function validateDoc(doc) {
    const errors = [];
    if (!doc || typeof doc !== "object") return ["请求体必须是对象"];
    if (doc.format_version !== FORMAT_VERSION) {
      errors.push("format_version 必须是 " + FORMAT_VERSION + "，实际为 " + JSON.stringify(doc.format_version));
    }
    if (!Array.isArray(doc.demos)) {
      errors.push("demos 必须是数组");
      return errors;
    }
    for (let i = 0; i < doc.demos.length; i++) {
      const d = doc.demos[i];
      if (!d || typeof d !== "object") { errors.push("demos[" + i + "] 必须是对象"); continue; }
      if (!/^[a-f0-9]{64}$/.test(String(d.sha256))) errors.push("demos[" + i + "].sha256 必须是 64 位十六进制");
      if (!Array.isArray(d.players)) { errors.push("demos[" + i + "].players 必须是数组"); continue; }
      for (let j = 0; j < d.players.length; j++) {
        const p = d.players[j];
        if (!p || typeof p !== "object") { errors.push("demos[" + i + "].players[" + j + "] 必须是对象"); continue; }
        if (!p.crosshair || !/^CSGO-/.test(String(p.crosshair.code))) {
          errors.push("demos[" + i + "].players[" + j + "].crosshair.code 不是合法准星码");
        }
      }
    }
    return errors;
  }

  // ---- 主流程 ----
  const steps = [];
  const warnings = [];
  const createdPlayers = [];
  const counters = {
    created: 0, updated: 0, reconfirmed: 0, historyAdvanced: 0,
    demosNew: 0, demosSeen: 0, playersSkipped: 0,
  };

  try {
    if (!e.hasSuperuserAuth()) {
      return e.json(403, { message: "需要 superuser 权限", hint: "用 cs2cx doctor 检查 cli/.env 里的凭证" });
    }

    let doc = null;
    let query = {};
    try {
      const info = e.requestInfo();
      doc = info ? info.body : null;
      query = (info && info.query) || {};
    } catch (err) {
      return e.json(400, { message: "无法解析请求体", error: String(err) });
    }

    if (!doc) return e.json(400, { message: "请求体为空" });

    const errors = validateDoc(doc);
    if (errors.length) {
      return e.json(400, { message: "导出格式校验未通过", errors: errors.slice(0, 30) });
    }

    // dryRun：照常跑完全部逻辑，最后抛哨兵异常让事务回滚，
    // 这样既能报出所有 warning，又不会写库。
    const dryRun = String(query.dryRun || query.dry_run || "") === "1";
    const SENTINEL = "__cs2cx_dry_run__";

    try {
      $app.runInTransaction((tx) => {
        for (const d of doc.demos) {
          const up = upsertDemo(tx, d, warnings);
          const demoRec = up.record;
          if (up.isNew) counters.demosNew++;
          else counters.demosSeen++;

          const players = d.players || [];
          for (const p of players) {
            // validateDoc 已保证每个 player 都有合法准星码，这里不再重复判空

            let playerRec;
            try {
              playerRec = resolvePlayer(tx, p, warnings, createdPlayers);
            } catch (err) {
              counters.playersSkipped++;
              warnings.push("选手 " + (p.name || p.steamid64) + " 解析失败：" + String(err));
              continue;
            }

            try {
              upsertSnapshot(tx, playerRec, demoRec, p.crosshair, {
                viewmodel: p.viewmodel,
                sampled_ticks: (p.observations && p.observations.length) ? p.observations : d.sampled_ticks,
                raw: p.crosshair.raw,
                batch: d.batch,
              }, warnings, counters);
            } catch (err) {
              counters.playersSkipped++;
              warnings.push(playerRec.get("name") + " 的准星写入失败：" + String(err));
            }
          }
        }

        if (dryRun) throw new Error(SENTINEL);
      });
    } catch (err) {
      if (String(err).indexOf(SENTINEL) === -1) {
        return e.json(500, { message: "导入失败，已整体回滚", error: String(err), warnings: warnings });
      }
      steps.push("dry-run-rolled-back");
    }

    return e.json(200, {
      message: dryRun ? "dry-run 完成，未写库" : "导入完成",
      summary: {
        dry_run: dryRun,
        demos_new: counters.demosNew,
        demos_already_known: counters.demosSeen,
        snapshots_created: counters.created,
        snapshots_updated: counters.updated,
        snapshots_reconfirmed: counters.reconfirmed,
        history_advanced: counters.historyAdvanced,
        players_created: createdPlayers.length,
        players_skipped: counters.playersSkipped,
      },
      created_players: createdPlayers,
      warnings: warnings,
    });
  } catch (err) {
    return e.json(500, { message: "handler 内部异常", error: String(err), steps: steps, warnings: warnings });
  }
});
