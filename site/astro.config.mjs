// @ts-check
import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";

// 还没有域名。用保留 TLD .invalid 占位 —— 它按 RFC 2606 永远不会被解析或索引，
// 比填一个假域名安全。src/config.ts 会读 import.meta.env.SITE 并据此判断
// "是否已有真实域名"：未有时 Seo.astro 不输出 canonical/og:url，
// robots.txt 不输出 Sitemap 行，也不启用 sitemap 集成。
const SITE_URL = process.env.SITE_URL || "https://cs2-shezhi.invalid";

export default defineConfig({
  site: SITE_URL,

  integrations: [svelte()],

  // Tailwind v4 走 Vite 插件，不是 @astrojs/tailwind —— 后者最新 6.0.2 的 peer
  // 上限是 astro ^5 + tailwindcss ^3，在 Astro 7 下不可用。
  vite: {
    plugins: [tailwindcss()],
  },

  build: {
    // 必须是 'directory'（产出 /foo/index.html）。deploy/Caddyfile 里是
    // try_files {path} {path}/ /404.html，改成 'file'（产出 /foo.html）会让
    // 所有无扩展名路径匹配不到而掉进 404。
    format: "directory",
  },

  // 统一无尾斜杠，避免 /foo 与 /foo/ 产生双份 URL 稀释权重
  trailingSlash: "never",
  compressHTML: true,

  // 静态站，不需要 Astro 的开发工具条注入脚本
  devToolbar: { enabled: false },
});
