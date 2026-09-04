/// <reference path="../pb_data/types.d.ts" />

// Phase 1：准星闭环所需的全部 collection。
// 依赖顺序：teams -> players -> player_tenures -> demos -> crosshair_snapshots
//
// API 规则约定：
//   ""    = 公开（前台静态站构建时要读）
//   null  = 仅 superuser（写入只允许后台/导入端点）
migrate((app) => {
  // ---------- teams ----------
  const teams = new Collection({
    type: "base",
    name: "teams",
    fields: [
      { type: "text", name: "name", required: true, max: 100 },
      { type: "text", name: "slug", required: true, max: 60 },
      { type: "text", name: "tag", max: 12 },
      { type: "select", name: "region", maxSelect: 1,
        values: ["eu", "na", "cis", "br", "asia", "oce", "mena", "sa", "other"] },
      { type: "file", name: "logo", maxSelect: 1, maxSize: 2097152,
        mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] },
      { type: "bool", name: "active" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_teams_slug ON teams (slug)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  app.save(teams)

  // ---------- players ----------
  const players = new Collection({
    type: "base",
    name: "players",
    fields: [
      { type: "text", name: "slug", required: true, max: 60 },
      { type: "text", name: "name", required: true, max: 60 },
      { type: "text", name: "real_name", max: 120 },
      // ISO 3166-1 alpha-2，前台渲染国旗
      { type: "text", name: "country", max: 2 },
      // 导入时匹配 demo 内选手的唯一键
      { type: "text", name: "steamid64", max: 20 },
      { type: "file", name: "avatar", maxSelect: 1, maxSize: 2097152,
        mimeTypes: ["image/png", "image/jpeg", "image/webp"],
        thumbs: ["100x100", "200x200"] },
      { type: "number", name: "hltv_id", min: 0 },
      { type: "select", name: "status", maxSelect: 1,
        values: ["active", "inactive", "retired"] },
      { type: "select", name: "role", maxSelect: 1,
        values: ["awper", "rifler", "igl", "support", "entry", "lurker"] },
      { type: "relation", name: "current_team",
        collectionId: app.findCollectionByNameOrId("teams").id,
        maxSelect: 1, cascadeDelete: false },
      { type: "number", name: "sort_order", min: 0 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_players_slug ON players (slug)",
      // steamid64 允许为空（人工录入的选手可能暂时没有），所以不做 UNIQUE
      "CREATE INDEX idx_players_steamid64 ON players (steamid64)",
      "CREATE INDEX idx_players_current_team ON players (current_team)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  app.save(players)

  // ---------- player_tenures（转会史）----------
  const playerTenures = new Collection({
    type: "base",
    name: "player_tenures",
    fields: [
      { type: "relation", name: "player", required: true,
        collectionId: app.findCollectionByNameOrId("players").id,
        maxSelect: 1, cascadeDelete: true },
      { type: "relation", name: "team", required: true,
        collectionId: app.findCollectionByNameOrId("teams").id,
        maxSelect: 1, cascadeDelete: true },
      { type: "select", name: "role", maxSelect: 1,
        values: ["awper", "rifler", "igl", "support", "entry", "lurker", "coach"] },
      { type: "date", name: "start_date", required: true },
      // 为空表示当前仍在队
      { type: "date", name: "end_date" },
      { type: "url", name: "source_url", max: 500 },
    ],
    indexes: [
      "CREATE INDEX idx_tenures_player ON player_tenures (player, start_date)",
      "CREATE INDEX idx_tenures_team ON player_tenures (team, start_date)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  app.save(playerTenures)

  // ---------- demos（只存元数据，绝不存 demo 本体）----------
  const demos = new Collection({
    type: "base",
    name: "demos",
    fields: [
      // 导入幂等的基石
      { type: "text", name: "sha256", required: true, max: 64 },
      { type: "text", name: "filename", max: 300 },
      { type: "text", name: "sharecode", max: 60 },
      { type: "date", name: "match_date" },
      { type: "text", name: "event", max: 150 },
      { type: "text", name: "map", max: 40 },
      { type: "text", name: "team_a", max: 100 },
      { type: "text", name: "team_b", max: 100 },
      { type: "url", name: "source_url", max: 500 },
      { type: "text", name: "parser_version", max: 30 },
      { type: "text", name: "batch", max: 60 },
      { type: "number", name: "size_bytes", min: 0 },
      { type: "number", name: "tick_rate", min: 0 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_demos_sha256 ON demos (sha256)",
      "CREATE INDEX idx_demos_match_date ON demos (match_date)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  app.save(demos)

  // ---------- crosshair_snapshots（append-only 准星历史，核心表）----------
  //
  // 字段划分依据实测：准星分享码的 19 字节载荷**只携带**下面 listed 的 17 个参数。
  // splitDistance / innerSplitAlpha / outerSplitAlpha / splitSizeRatio 不在码里，
  // 解码器永远返回 CS2 默认值（2 / 0.8 / 0.4 / 1.5），因此**不建列**，
  // 避免把解码器默认值当成"选手的设置"展示给用户。它们只保留在 raw_json 里备查。
  // sniper_width 同理不在码里，不建列。
  const crosshairSnapshots = new Collection({
    type: "base",
    name: "crosshair_snapshots",
    fields: [
      { type: "relation", name: "player", required: true,
        collectionId: app.findCollectionByNameOrId("players").id,
        maxSelect: 1, cascadeDelete: true },
      { type: "relation", name: "demo",
        collectionId: app.findCollectionByNameOrId("demos").id,
        maxSelect: 1, cascadeDelete: false },
      // 当前准星跨多场比赛复现时不新建历史，只更新下面两个字段：
      // "这套准星自 captured_at 起沿用，最近见于 last_seen_demo"
      { type: "relation", name: "last_seen_demo",
        collectionId: app.findCollectionByNameOrId("demos").id,
        maxSelect: 1, cascadeDelete: false },
      { type: "date", name: "last_seen_at" },
      // 准星码原值，是这个版本的天然指纹
      { type: "text", name: "code", required: true, max: 40 },

      // --- 解码出的准星参数（码里确实携带的 17 项）---
      // 0=默认 1=静态(经典) 2=经典 3=内缩(准) 4=动态
      { type: "number", name: "style", min: 0, max: 4 },
      { type: "number", name: "length" },
      { type: "number", name: "thickness" },
      { type: "number", name: "gap" },
      { type: "number", name: "color", min: 0, max: 255 },
      { type: "number", name: "red", min: 0, max: 255 },
      { type: "number", name: "green", min: 0, max: 255 },
      { type: "number", name: "blue", min: 0, max: 255 },
      { type: "bool", name: "alpha_enabled" },
      { type: "number", name: "alpha", min: 0, max: 255 },
      { type: "bool", name: "outline_enabled" },
      { type: "number", name: "outline" },
      { type: "bool", name: "center_dot_enabled" },
      { type: "bool", name: "follow_recoil" },
      { type: "number", name: "fixed_crosshair_gap" },
      { type: "bool", name: "t_style_enabled" },
      { type: "bool", name: "deployed_weapon_gap_enabled" },

      // --- viewmodel：不在准星码里，由 demo 直接提取，可能为空 ---
      { type: "number", name: "viewmodel_fov" },
      { type: "number", name: "viewmodel_offset_x" },
      { type: "number", name: "viewmodel_offset_y" },
      { type: "number", name: "viewmodel_offset_z" },
      { type: "number", name: "viewmodel_presetpos" },

      // --- 版本与溯源 ---
      // 当前准星。同一选手只允许一条为 true，由导入事务保证
      { type: "bool", name: "is_current" },
      { type: "date", name: "captured_at" },
      { type: "select", name: "source", maxSelect: 1,
        values: ["demo", "manual", "player_published", "third_party"] },
      { type: "select", name: "confidence", maxSelect: 1,
        values: ["high", "medium", "low"] },
      { type: "url", name: "evidence_url", max: 500 },
      { type: "text", name: "batch", max: 60 },
      // 命中的 tick，便于追溯这个准星是在比赛哪个时点采到的
      { type: "json", name: "sampled_ticks", maxSize: 20000 },
      // 解码器完整原始输出，兜底未来新增字段
      { type: "json", name: "raw_json", maxSize: 20000 },
    ],
    indexes: [
      // 同一 demo 同一选手只留一条，重复导入天然幂等
      "CREATE UNIQUE INDEX idx_snap_demo_player ON crosshair_snapshots (demo, player)",
      // 同一选手同一准星码在同一比赛日只留一条
      "CREATE UNIQUE INDEX idx_snap_player_code_date ON crosshair_snapshots (player, code, captured_at)",
      // 每个选手最多一条 is_current=true（部分唯一索引，SQLite 支持）
      "CREATE UNIQUE INDEX idx_snap_one_current ON crosshair_snapshots (player) WHERE is_current = 1",
      "CREATE INDEX idx_snap_player_time ON crosshair_snapshots (player, captured_at)",
      "CREATE INDEX idx_snap_code ON crosshair_snapshots (code)",
      // 支持"按 style/gap 找相似准星"这类筛选
      "CREATE INDEX idx_snap_style ON crosshair_snapshots (style)",
      "CREATE INDEX idx_snap_is_current ON crosshair_snapshots (is_current)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  app.save(crosshairSnapshots)
}, (app) => {
  for (const name of ["crosshair_snapshots", "demos", "player_tenures", "players", "teams"]) {
    const c = app.findCollectionByNameOrId(name)
    if (c) app.delete(c)
  }
})
