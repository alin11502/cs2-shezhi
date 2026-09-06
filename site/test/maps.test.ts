import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAPS } from "../src/lib/maps.ts";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_MAPS = path.join(SITE_ROOT, "public", "maps");

// 背景截图是站长提供的真实游戏画面（© Valve）。标记与文件一旦不同步就会静默出错：
// 标了 photo 却没图 → 预览回落到示意场景；有图却没标 → 图躺在 public 里永远不被用。
describe("地图背景：photo 标记与 public/maps 实际文件双向一致", () => {
  const shipped = fs.existsSync(PUBLIC_MAPS)
    ? fs
        .readdirSync(PUBLIC_MAPS)
        .filter((f) => f.endsWith(".jpg"))
        .map((f) => f.replace(/\.jpg$/, ""))
    : [];
  const flagged = MAPS.filter((m) => m.photo).map((m) => m.slug);

  it("每个 photo:true 的地图都有对应截图文件", () => {
    for (const slug of flagged) {
      assert.ok(shipped.includes(slug), `${slug} 标记了 photo 但 public/maps 缺截图`);
    }
  });

  it("public/maps 里的每张截图都被 photo 标记认领", () => {
    for (const slug of shipped) {
      assert.ok(flagged.includes(slug), `${slug} 有截图但 MAPS 未标记 photo，图不会被使用`);
    }
  });

  it("地图 slug 不重复", () => {
    const slugs = MAPS.map((m) => m.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });
});
