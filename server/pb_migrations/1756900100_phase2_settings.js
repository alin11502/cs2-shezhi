/// <reference path="../pb_data/types.d.ts" />

// Phase 2：全套设置。Phase 1 就建好 schema，避免后期迁移重构。
//
// 与原方案的一处偏离：方案里写的是拆成 mouse_settings / video_settings /
// peripherals / launch_options 四张表。实现时合并为一张扁平的 player_settings：
// 这几组数据都与选手 1:1，拆开只会让前台每页多查四次，而"按 DPI 筛选手"这类
// 查询在扁平表上同样高效。真正 1:N 的按键绑定单独建表。
//
// 注意：这些字段 demo 里都没有，只能人工录入，所以每张表都带 source / evidence_url，
// 前台必须如实标注数据来源，不能让用户误以为是自动提取的。
migrate((app) => {
  const playersId = app.findCollectionByNameOrId("players").id

  // ---------- player_settings（1:1）----------
  const playerSettings = new Collection({
    type: "base",
    name: "player_settings",
    fields: [
      { type: "relation", name: "player", required: true,
        collectionId: playersId, maxSelect: 1, cascadeDelete: true },

      // --- 鼠标 ---
      { type: "number", name: "sensitivity", min: 0 },
      { type: "number", name: "dpi", min: 0 },
      // eDPI = sensitivity * dpi，存下来避免每次计算，也便于排序筛选
      { type: "number", name: "edpi", min: 0 },
      { type: "number", name: "zoom_sensitivity", min: 0 },
      { type: "number", name: "windows_sensitivity", min: 0, max: 11 },
      { type: "number", name: "polling_rate", min: 0 },
      { type: "bool", name: "raw_input" },

      // --- 视频 ---
      { type: "text", name: "resolution", max: 20 },
      { type: "select", name: "aspect_ratio", maxSelect: 1,
        values: ["4:3", "16:9", "16:10", "5:4", "21:9"] },
      { type: "select", name: "scaling_mode", maxSelect: 1,
        values: ["stretch", "black_bars", "aspect"] },
      { type: "number", name: "refresh_rate", min: 0 },
      { type: "number", name: "brightness", min: 0, max: 200 },
      { type: "select", name: "display_mode", maxSelect: 1,
        values: ["fullscreen", "borderless", "windowed"] },
      { type: "number", name: "multisampling", min: 0 },
      { type: "select", name: "boost_player_contrast", maxSelect: 1,
        values: ["enabled", "disabled"] },

      // --- 外设（型号文本，人工录入）---
      { type: "text", name: "mouse", max: 120 },
      { type: "text", name: "mousepad", max: 120 },
      { type: "text", name: "keyboard", max: 120 },
      { type: "text", name: "headset", max: 120 },
      { type: "text", name: "monitor", max: 120 },

      // --- 启动项 ---
      { type: "text", name: "launch_options", max: 500 },

      // --- 溯源 ---
      { type: "select", name: "source", maxSelect: 1,
        values: ["manual", "player_published", "third_party", "stream"] },
      { type: "select", name: "confidence", maxSelect: 1,
        values: ["high", "medium", "low"] },
      { type: "url", name: "evidence_url", max: 500 },
      { type: "text", name: "notes", max: 500 },
      // 人工录入的数据会过时，前台据此提示"更新于 X"
      { type: "date", name: "verified_at" },
    ],
    indexes: [
      // 一个选手只有一份设置
      "CREATE UNIQUE INDEX idx_settings_player ON player_settings (player)",
      "CREATE INDEX idx_settings_dpi ON player_settings (dpi)",
      "CREATE INDEX idx_settings_edpi ON player_settings (edpi)",
      "CREATE INDEX idx_settings_resolution ON player_settings (resolution)",
      "CREATE INDEX idx_settings_mouse ON player_settings (mouse)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  app.save(playerSettings)

  // ---------- keybinds（1:N）----------
  const keybinds = new Collection({
    type: "base",
    name: "keybinds",
    fields: [
      { type: "relation", name: "player", required: true,
        collectionId: playersId, maxSelect: 1, cascadeDelete: true },
      // 动作名，如 buy / drop / jumpthrow
      { type: "text", name: "action", required: true, max: 60 },
      { type: "text", name: "key", required: true, max: 30 },
      // 原始 bind 命令行，便于做"下载 CFG"
      { type: "text", name: "raw_command", max: 300 },
      { type: "url", name: "source_url", max: 500 },
    ],
    indexes: [
      "CREATE INDEX idx_keybinds_player ON keybinds (player)",
      "CREATE UNIQUE INDEX idx_keybinds_player_action ON keybinds (player, action)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  app.save(keybinds)
}, (app) => {
  for (const name of ["keybinds", "player_settings"]) {
    const c = app.findCollectionByNameOrId(name)
    if (c) app.delete(c)
  }
})
