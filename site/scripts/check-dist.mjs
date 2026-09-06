#!/usr/bin/env node
/**
 * 构建产物静态断言。跑在 astro build 之后，不启动服务器、不开浏览器。
 *
 * 存在的意义：这些检查项都是"错了也不报错、只会静默降低质量"的类型 ——
 * 少一个 canonical、title 重复、类名被 tree-shake 掉、准星 SVG 没内联进去、
 * 内部链接指向不存在的页面。人工看页面看不出这些，必须靠断言。
 *
 * 用法：node scripts/check-dist.mjs   （或 npm run check-dist）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_ROOT } from "./lib/env.mjs";

const DIST = path.join(SITE_ROOT, "dist");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

function section(t) {
  console.log(`\n\x1b[36m${t}\x1b[0m`);
}

function walk(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full, base));
    else out.push({ abs: full, rel: path.relative(base, full).split(path.sep).join("/") });
  }
  return out;
}

if (!fs.existsSync(DIST)) {
  console.error(`\x1b[31mdist/ 不存在，请先运行 npm run build\x1b[0m`);
  process.exit(2);
}

const files = walk(DIST);
const htmlFiles = files.filter((f) => f.rel.endsWith(".html"));
const cssFiles = files.filter((f) => f.rel.endsWith(".css"));
const cssText = cssFiles.map((f) => fs.readFileSync(f.abs, "utf8")).join("\n");

// ---------- 1. 结构 ----------
section("1. 目录结构（对齐 deploy/Caddyfile 的 try_files {path} {path}/ /404.html）");

const rootHtml = htmlFiles.filter((f) => !f.rel.includes("/"));
const unexpectedRoot = rootHtml
  .map((f) => f.rel)
  .filter((n) => n !== "404.html" && n !== "index.html");
check(
  "根目录只有 index.html 与 404.html",
  unexpectedRoot.length === 0,
  unexpectedRoot.length ? `多余: ${unexpectedRoot.join(", ")}（配成 build.format:'file' 会导致无扩展名路径全部 404）` : ""
);
check("404.html 存在于根目录", rootHtml.some((f) => f.rel === "404.html"));

const contentPages = htmlFiles.filter((f) => f.rel !== "404.html" && f.rel !== "index.html");
const notDirectory = contentPages.filter((f) => !f.rel.endsWith("/index.html"));
check(
  "所有内容页都是 目录/index.html 形式",
  notDirectory.length === 0,
  notDirectory.length ? `不符合: ${notDirectory.slice(0, 5).join(", ")}` : ""
);

check("robots.txt 已生成", files.some((f) => f.rel === "robots.txt"));
console.log(`  \x1b[2m共 ${htmlFiles.length} 个 HTML、${cssFiles.length} 个 CSS\x1b[0m`);

// ---------- 2. SEO ----------
section("2. SEO 标签");

const titles = new Map();
const missingDesc = [];
const longTitles = [];
const badJsonLd = [];
const unexpectedCanonical = [];

for (const f of htmlFiles) {
  const html = fs.readFileSync(f.abs, "utf8");

  const t = html.match(/<title>([\s\S]*?)<\/title>/);
  const title = t ? t[1].trim() : null;
  if (!title) {
    missingDesc.push(`${f.rel}: 缺 <title>`);
  } else {
    if (titles.has(title)) titles.get(title).push(f.rel);
    else titles.set(title, [f.rel]);
    // 60 字符是搜索结果截断的经验值；中文按字符数算
    if ([...title].length > 60) longTitles.push(`${f.rel}: ${[...title].length} 字符「${title}」`);
  }

  if (!/<meta name="description" content="[^"]+"/.test(html)) missingDesc.push(`${f.rel}: 缺 description`);

  // 没有真实域名时绝不能输出 canonical / og:url（占位 .invalid 域名不该进搜索引擎）
  if (!process.env.SITE_URL) {
    if (/rel="canonical"/.test(html)) unexpectedCanonical.push(`${f.rel}: 出现 canonical`);
    if (/property="og:url"/.test(html)) unexpectedCanonical.push(`${f.rel}: 出现 og:url`);
  }

  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(m[1]);
    } catch (e) {
      badJsonLd.push(`${f.rel}: ${e.message}`);
    }
  }
}

const dupTitles = [...titles.entries()].filter(([, pages]) => pages.length > 1);
check("每个页面都有 <title>", !missingDesc.some((m) => m.includes("缺 <title>")), missingDesc.filter((m) => m.includes("缺 <title>")).join("; "));
check("每个页面都有 meta description", !missingDesc.some((m) => m.includes("缺 description")), missingDesc.filter((m) => m.includes("缺 description")).join("; "));
check(
  "title 全站唯一",
  dupTitles.length === 0,
  dupTitles.map(([t, p]) => `「${t}」被 ${p.length} 个页面共用: ${p.slice(0, 3).join(", ")}`).join("; ")
);
check(
  "title 不超过 60 字符",
  longTitles.length === 0,
  longTitles.join("; ")
);
check(
  "未设 SITE_URL 时不输出 canonical / og:url",
  unexpectedCanonical.length === 0,
  unexpectedCanonical.join("; ")
);
check("所有 JSON-LD 可被 JSON.parse", badJsonLd.length === 0, badJsonLd.join("; "));

// robots.txt 在没有真实域名时不该有 Sitemap 行
const robots = files.find((f) => f.rel === "robots.txt");
if (robots) {
  const txt = fs.readFileSync(robots.abs, "utf8");
  check(
    "robots.txt 的 Sitemap 行与 SITE_URL 状态一致",
    process.env.SITE_URL ? /Sitemap:/.test(txt) : !/Sitemap:/.test(txt),
    process.env.SITE_URL ? "设了 SITE_URL 却没有 Sitemap 行" : "未设 SITE_URL 却输出了 Sitemap 行"
  );
}

// ---------- 3. 样式确实产出 ----------
section("3. 样式产出（防 Tailwind v4 内容源扫描漏掉 .astro/.svelte 导致类被 tree-shake）");

const usedDaisyClasses = ["hero", "card", "badge", "stats", "stat", "alert", "btn", "table", "timeline", "collapse"];
const missingClasses = usedDaisyClasses.filter((c) => !new RegExp(`\\.${c}[,{:.\\s>]`).test(cssText));
check(
  "产物 CSS 含实际用到的 daisyUI 组件类",
  missingClasses.length === 0,
  missingClasses.length ? `缺失: ${missingClasses.join(", ")}` : ""
);
check("产物 CSS 含自定义 @utility table-scroll", /\.table-scroll/.test(cssText));

const themed = htmlFiles.filter((f) => /<html[^>]*data-theme="dark"/.test(fs.readFileSync(f.abs, "utf8")));
check(
  "所有页面的 <html> 都带 data-theme=\"dark\"（零 JS 暗色）",
  themed.length === htmlFiles.length,
  `${themed.length}/${htmlFiles.length} 个页面带 data-theme`
);

const zhLang = htmlFiles.filter((f) => /<html[^>]*lang="zh-CN"/.test(fs.readFileSync(f.abs, "utf8")));
check("所有页面 lang=\"zh-CN\"", zhLang.length === htmlFiles.length, `${zhLang.length}/${htmlFiles.length}`);

// ---------- 4. 无 JS 时准星可见 ----------
section("4. 无 JS 准星可见性（内联 SVG，不靠客户端渲染）");

const playerPages = htmlFiles.filter((f) => /^players\/[^/]+\/index\.html$/.test(f.rel));
check("选手详情页已生成", playerPages.length > 0, `找到 ${playerPages.length} 个`);

const noCrosshairContent = [];
const tooFewRects = [];
for (const f of playerPages) {
  const html = fs.readFileSync(f.abs, "utf8");
  const hasSvg = /<svg[^>]*viewBox="0 0 200 200"/.test(html);
  // 没有准星的选手（如只从 prosettings 取了设置、准星待 demo 提取）
  // 页面上本来就没有准星 SVG，而是显示占位提示；两者必居其一
  const hasPlaceholder = html.includes("准星数据待补充");
  if (!hasSvg && !hasPlaceholder) {
    noCrosshairContent.push(f.rel);
    continue;
  }
  if (hasSvg) {
    // 真实职业准星存在退化参数：length=0 的点准星只有 1–2 个 rect（中心点+描边），
    // thickness=0 会渲染成 1px hairline 四臂。所以这里只断言"几何没完全空转"（≥1），
    // 臂/点的具体组合由 geometry 单测按参数覆盖。
    const rectCount = (html.match(/<rect /g) || []).length;
    if (rectCount < 1) tooFewRects.push(`${f.rel}: 只有 ${rectCount} 个 rect`);
  }
}
check(
  "每个选手详情页要么有内联准星 SVG、要么有准星待补充占位",
  noCrosshairContent.length === 0,
  noCrosshairContent.join(", ")
);
check("有准星的页面 SVG 至少渲染出 1 个图元（几何没空转）", tooFewRects.length === 0, tooFewRects.join("; "));

// 页面不应依赖 JS 才能看到内容：检查是否有 <script> 承担渲染职责
const renderScripts = [];
for (const f of htmlFiles) {
  const html = fs.readFileSync(f.abs, "utf8");
  // 允许 JSON-LD（type=application/ld+json）与复制按钮的事件委托（is:inline 且不含 innerHTML/document.write）
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1];
    const body = m[2];
    if (/application\/ld\+json/.test(attrs)) continue;
    if (/document\.write|innerHTML\s*=/.test(body)) renderScripts.push(`${f.rel}: 脚本用 innerHTML/document.write 渲染内容`);
  }
}
check("没有靠 JS 注入内容的脚本（无 JS 时内容不缺失）", renderScripts.length === 0, renderScripts.join("; "));

// ---------- 5. 文案红线 ----------
section("5. 文案红线（旧结论已证伪，产物里不得残留）");

// 曾经全站声称"准星码只携带 17 项、那 4 项是引擎默认值不是选手设置"。
// 该结论已被源码与实测证伪（见 server/pb_migrations/1756900400_add_split_fields.js），
// 所以这里断言旧文案零残留。
const STALE_PATTERNS = [
  /只携带\s*17\s*项/,
  /不在准星码里/,
  /不在码里/,
  /不随码携带/,
  /不会把它们当作选手设置/,
  /伪配置/,
];

// 白名单：这些页面**引用**旧论断是为了当场更正它（"本站曾认定……这是错的"），
// 属于有价值的内容，不能因为这条检查就被删掉 —— 抹掉更正记录反而会让下一个人
// 重新踩同一个坑。白名单刻意收窄到具体页面；新增页面进白名单必须说明理由。
const STALE_ALLOWED_PAGES = new Set([
  "about/data/index.html", // 第 4 节"关于准星参数数量的一次公开更正"
  "guides/crosshair-code-explained/index.html", // "需要澄清一个流传的说法"那一段
]);

const staleHits = [];
for (const f of htmlFiles) {
  if (STALE_ALLOWED_PAGES.has(f.rel)) continue;
  const html = fs.readFileSync(f.abs, "utf8");
  for (const re of STALE_PATTERNS) {
    if (re.test(html)) staleHits.push(`${f.rel}: 命中 ${re}`);
  }
}
check(
  `产物中无旧的错误论断（白名单 ${STALE_ALLOWED_PAGES.size} 个更正页除外）`,
  staleHits.length === 0,
  staleHits.join("; ")
);

// 白名单本身也要核验：那些页面必须**同时**包含更正措辞，
// 否则就只是把错误论断放进了白名单里，失去意义。
const CORRECTION_MARKERS = [/这是错的/, /已被证伪/, /该论断已?被?证伪/, /这个判断是错的/, /是\s*错的/];
const weakAllowlist = [];
for (const rel of STALE_ALLOWED_PAGES) {
  const abs = path.join(DIST, rel);
  if (!fs.existsSync(abs)) {
    weakAllowlist.push(`${rel}: 页面不存在，白名单条目已失效`);
    continue;
  }
  const html = fs.readFileSync(abs, "utf8");
  if (!CORRECTION_MARKERS.some((re) => re.test(html))) {
    weakAllowlist.push(`${rel}: 含旧论断但没有更正措辞，不应在白名单里`);
  }
}
check("白名单页面确实是在更正而非复述旧论断", weakAllowlist.length === 0, weakAllowlist.join("; "));

// 反向断言：CFG 里必须包含那 4 行 cl_crosshair_dynamic_*
const cfgPages = htmlFiles.filter((f) => /cl_crosshairstyle/.test(fs.readFileSync(f.abs, "utf8")));
check("有页面输出了 CFG 块", cfgPages.length > 0, `${cfgPages.length} 个页面含 convar`);

const DYNAMIC_CONVARS = [
  "cl_crosshair_dynamic_splitdist",
  "cl_crosshair_dynamic_splitalpha_innermod",
  "cl_crosshair_dynamic_splitalpha_outermod",
  "cl_crosshair_dynamic_maxdist_splitratio",
];
const missingConvars = [];
for (const f of cfgPages) {
  const html = fs.readFileSync(f.abs, "utf8");
  for (const c of DYNAMIC_CONVARS) {
    if (!html.includes(c)) missingConvars.push(`${f.rel}: 缺 ${c}`);
  }
}
check(
  "每个 CFG 块都含完整 4 行 cl_crosshair_dynamic_*（旧版本会错误剔除）",
  missingConvars.length === 0,
  missingConvars.slice(0, 6).join("; ")
);

// ---------- 6. 内部死链 ----------
section("6. 内部链接");

// URL → dist 文件路径。trailingSlash:'never' + build.format:'directory'
// 意味着 /foo/bar 对应 dist/foo/bar/index.html
function resolveInternal(href) {
  const clean = href.replace(/^\/+/, "").split("#")[0].split("?")[0];
  if (!clean) return path.join(DIST, "index.html");
  const direct = path.join(DIST, clean);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  return path.join(DIST, clean, "index.html");
}

const deadLinks = new Map();
for (const f of htmlFiles) {
  const html = fs.readFileSync(f.abs, "utf8");
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const href = m[1];
    // 静态资源与 API 路径不做文件存在性检查（/api/* 由 Caddy 反代到 PocketBase）
    if (href.startsWith("/api/")) continue;
    const target = resolveInternal(href);
    if (!fs.existsSync(target)) {
      if (!deadLinks.has(href)) deadLinks.set(href, []);
      deadLinks.get(href).push(f.rel);
    }
  }
}
check(
  "无内部死链",
  deadLinks.size === 0,
  [...deadLinks.entries()]
    .slice(0, 10)
    .map(([href, pages]) => `${href} ← ${pages.length} 处（如 ${pages[0]}）`)
    .join("; ")
);

// ---------- 7. 地图背景 ----------
section("7. 地图背景（photo 标记与 dist/maps 实际产物一致）");

// 背景截图漏进产物、或删了地图却留下旧图，都是"错了也不报错"的静默问题
const { MAPS } = await import("../src/lib/maps.ts");
const distMapsDir = path.join(DIST, "maps");
const distMapJpgs = fs.existsSync(distMapsDir)
  ? fs.readdirSync(distMapsDir).filter((f) => f.endsWith(".jpg"))
  : [];

for (const m of MAPS.filter((x) => x.photo)) {
  const f = path.join(distMapsDir, `${m.slug}.jpg`);
  const exists = fs.existsSync(f);
  const buf = exists ? fs.readFileSync(f) : null;
  const isJpeg = !!buf && buf.length > 0 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  check(
    `photo 地图 ${m.slug} 的截图已进产物且为 JPEG`,
    exists && isJpeg,
    exists ? "文件存在但不是合法 JPEG（或为空）" : "dist/maps 缺该文件"
  );
}

const declaredSlugs = new Set(MAPS.map((m) => m.slug));
const orphanJpgs = distMapJpgs.filter((f) => !declaredSlugs.has(f.replace(/\.jpg$/, "")));
check(
  "dist/maps 无 MAPS 未声明的多余截图",
  orphanJpgs.length === 0,
  orphanJpgs.join(", ")
);

// ---------- 汇总 ----------
console.log(`\n${"-".repeat(56)}`);
if (fail === 0) {
  console.log(`\x1b[32mcheck-dist 全部通过：${pass} 项断言，${htmlFiles.length} 个页面\x1b[0m\n`);
  process.exit(0);
}
console.log(`\x1b[31m${fail} 项失败\x1b[0m，${pass} 项通过：`);
failures.forEach((f) => console.log(`  - ${f}`));
console.log("");
process.exit(1);
