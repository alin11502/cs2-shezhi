/// <reference path="../pb_data/types.d.ts" />

// 给 crosshair_snapshots 补上动态准星的 4 个分裂参数列。
//
// ## 这是对 1756900000_phase1_core.js 里一段错误结论的更正
//
// 那个迁移的注释块（"字段划分依据实测…"）声称：准星分享码的载荷**只携带** 17 个
// 参数，splitDistance / innerSplitAlpha / outerSplitAlpha / splitSizeRatio
// "不在码里，解码器永远返回 CS2 默认值（2 / 0.8 / 0.4 / 1.5）"，因此**不建列**，
// 以免把引擎默认值当成选手设置展示。
//
// **该结论是错的**，源码证据（csgo-sharecode/src/index.ts）：
//
//   splitDistance    = bytes[8] & 7              域 0–7，  步进 1
//   innerSplitAlpha  = (bytes[10] >> 4) / 10     域 0–1.5，步进 0.1
//   outerSplitAlpha  = (bytes[11] & 0xf) / 10    域 0–1.5，步进 0.1
//   splitSizeRatio   = (bytes[11] >> 4) / 10     域 0–1.5，步进 0.1
//
// 编码器把它们写回同样的位（L203 / L205-206）。本机实测双重确认：
//   - 真实第三方码 CSGO-UseJt-3oTvn-47wPX-hEyER-WZfiK 解出 3 / 0.1 / 1 / 1，
//     不是默认值；用完整 21 字段原样重编码可**字节级还原**。
//   - 喂入 4 组值（默认值、真实码值、7/1.5/0/0.5、0/0/1.5/1.5）全部完整存活往返。
//
// 原结论错在样本太窄：只测了自己生成的、恰好都用默认值的码。
//
// ## 造成的实际损害
//
// - encode 路径无条件用默认值覆盖这 4 项 → 重编码真实选手的码会**销毁**他实际的
//   动态准星设置，并产出另一个码字符串
// - CFG 生成剔除 4 行 cl_crosshair_dynamic_* → 用户下载的配置缺 4 行
// - schema 没有列 → 真值只落在 raw_json，而 fetch-data 又故意不拉 raw_json，
//   站点侧完全拿不到
//
// 这 4 项是**动态准星（style=4）的分裂行为参数**：静态样式下不影响外观，
// 但仍是选手的真实设置，必须原样存储、展示、导出。
//
// ## 为什么不改 1756900000
//
// PocketBase 按文件名记录已应用的迁移，改内容不会重跑，反而会让全新库与
// 既有库走不同路径、最终状态分叉。所以用新迁移修正，并在旧迁移的注释块里
// 补一行指向此处。
//
// ## 存量数据
//
// 已有的 14 行样本数据这 4 列会是空值，由重跑 site/scripts/seed.mjs 修正
// （seed 按 (player, code) upsert）。不做 raw_json 回填：样本数据的 raw_json
// 本来就是空的，回填无事可做，白增迁移风险。
migrate((app) => {
  const c = app.findCollectionByNameOrId("crosshair_snapshots")

  // 值域与步进直接来自编码器的位运算，与 site/src/lib/crosshair/clamp.ts 的
  // RANGES 保持一致 —— 两侧不一致就会有一边放行非法值。
  //
  // 注意：fields.add() **不接受普通对象**，会报
  //   could not convert [object Object] to core.Field
  // 必须传 Field 实例。（1756900000 里能用普通对象，是因为
  // new Collection({ fields: [...] }) 的构造函数会自动转换，add() 不会。）
  const newFields = [
    new NumberField({ name: "split_distance", min: 0, max: 7 }),
    new NumberField({ name: "inner_split_alpha", min: 0, max: 1.5 }),
    new NumberField({ name: "outer_split_alpha", min: 0, max: 1.5 }),
    new NumberField({ name: "split_size_ratio", min: 0, max: 1.5 }),
  ]

  for (const f of newFields) {
    // 幂等：已存在就跳过，便于迁移在部分应用过的库上重跑
    if (!c.fields.getByName(f.name)) c.fields.add(f)
  }

  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId("crosshair_snapshots")
  for (const name of ["split_distance", "inner_split_alpha", "outer_split_alpha", "split_size_ratio"]) {
    const f = c.fields.getByName(name)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
