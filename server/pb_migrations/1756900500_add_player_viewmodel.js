/// <reference path="../pb_data/types.d.ts" />

// 给 player_settings 补 viewmodel 列。
//
// 为什么：viewmodel（cl_viewmodel_*）本质是**选手级**设置，不是每场比赛变化的量。
// 早期 schema 把它放在 crosshair_snapshots 上，因为 demo 提取是逐场产出；
// 但 prosettings 这类来源只提供选手当前值、且不产生 snapshot，
// 没有选手级列就没地方存。两处在语义上不冲突：snapshot 上的 viewmodel 表示
// "那场比赛时点的值"，player_settings 上的表示"当前值"。
migrate((app) => {
  const c = app.findCollectionByNameOrId("player_settings")
  const add = [
    new NumberField({ name: "viewmodel_fov" }),
    new NumberField({ name: "viewmodel_offset_x" }),
    new NumberField({ name: "viewmodel_offset_y" }),
    new NumberField({ name: "viewmodel_offset_z" }),
    new NumberField({ name: "viewmodel_presetpos" }),
  ]
  for (const f of add) {
    if (!c.fields.getByName(f.name)) c.fields.add(f)
  }
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId("player_settings")
  for (const name of ["viewmodel_fov", "viewmodel_offset_x", "viewmodel_offset_y", "viewmodel_offset_z", "viewmodel_presetpos"]) {
    const f = c.fields.getByName(name)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
