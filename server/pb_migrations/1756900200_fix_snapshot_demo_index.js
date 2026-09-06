/// <reference path="../pb_data/types.d.ts" />

// 修正 idx_snap_demo_player：从全表唯一改为部分唯一（仅 demo 非空时生效）。
//
// 为什么必须改（实际 seed 时撞出来的）：
// PocketBase 的空 relation 字段存的是**空字符串 ''，不是 NULL**。而 SQLite 的
// 唯一索引把多个 NULL 视为互不相同、把多个 '' 视为相同。于是所有
// source=manual / third_party / player_published 的快照（它们没有 demo）
// 在 (demo='', player=X) 上全部碰撞，同一选手根本无法保存第二个准星版本 ——
// 而这恰恰是 crosshair_snapshots 作为"追加式历史表"的核心用途。
//
// 原索引的意图是"同一 demo 同一选手只留一条，重复导入天然幂等"，这个意图
// 只对 demo 来源成立。加上 WHERE demo != '' 后：
//   - demo 来源：幂等性照旧保留
//   - 人工/第三方来源：不受此索引约束，改由 idx_snap_player_code_date
//     (player, code, captured_at) 保证不会重复录入同一版本
//
// 注意：不修改 1756900000_phase1_core.js。PocketBase 按文件名记录已应用的迁移，
// 改内容不会重跑，反而会让"全新库"和"已存在的库"走不同路径。全新库会依次执行
// 两个迁移，最终状态与此处一致。
migrate((app) => {
  const c = app.findCollectionByNameOrId("crosshair_snapshots")
  c.indexes = (c.indexes || []).map((idx) =>
    idx.includes("idx_snap_demo_player")
      ? "CREATE UNIQUE INDEX idx_snap_demo_player ON crosshair_snapshots (demo, player) WHERE demo != ''"
      : idx
  )
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId("crosshair_snapshots")
  c.indexes = (c.indexes || []).map((idx) =>
    idx.includes("idx_snap_demo_player")
      ? "CREATE UNIQUE INDEX idx_snap_demo_player ON crosshair_snapshots (demo, player)"
      : idx
  )
  app.save(c)
})
