/// <reference path="../pb_data/types.d.ts" />

// 给 player_tenures 加唯一索引，防止同一选手在同一天加入同一战队被重复录入。
//
// 为什么需要（实际 seed 时踩出来的）：seed.mjs 原先用短日期 '2023-01-15' 去
// filter 一个 date 字段，而 PocketBase 存的是 '2023-01-15 00:00:00.000Z'，
// 比较永远命中 0 条，于是 upsert 退化成"每次都 create"——跑三次 seed 后
// tenures 从应有的 14 条涨到 38 条。
//
// seed.mjs 已修正为用归一化后的日期比较，但**光靠调用方自律不够**：
// 任何将来的写入路径（人工后台录入、新的导入脚本）都可能重犯。
// 加数据库级唯一索引后，重复录入会被直接拒绝，而不是静默积累脏数据。
//
// 注意：本迁移必须在重复数据清理干净之后才能应用，否则 CREATE UNIQUE INDEX 会失败。
migrate((app) => {
  const c = app.findCollectionByNameOrId("player_tenures")
  const idx = "CREATE UNIQUE INDEX idx_tenures_unique ON player_tenures (player, team, start_date)"
  if (!(c.indexes || []).some((i) => i.includes("idx_tenures_unique"))) {
    c.indexes = [...(c.indexes || []), idx]
  }
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId("player_tenures")
  c.indexes = (c.indexes || []).filter((i) => !i.includes("idx_tenures_unique"))
  app.save(c)
})
