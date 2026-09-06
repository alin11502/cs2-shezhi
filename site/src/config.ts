// 全站可配置项。改站名、导航、标题模板都只动这一个文件。

/**
 * import.meta.env 是 Vite/Astro 注入的构造：在纯 Node 环境
 * （例如 scripts/build-og.mjs 直接 import 本文件做 OG 图）下是 undefined，
 * 所以必须可选链读取，退化为空对象而不是崩溃。
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** astro.config.mjs 里的 site 值，经 Astro 注入 */
const siteFromConfig = env.SITE;

/**
 * 是否已有真实域名。
 * 未买域名时 astro.config.mjs 用保留 TLD `.invalid` 占位（RFC 2606，永不解析），
 * 此时绝不能输出 canonical / og:url / sitemap —— 宁可缺这些 SEO 信号，
 * 也不能让搜索引擎看到一个假域名的绝对 URL。
 */
export const HAS_REAL_DOMAIN = Boolean(siteFromConfig) && !siteFromConfig!.endsWith(".invalid");

/** 站点根 URL，无尾斜杠。无真实域名时为 null，调用方必须判空。 */
export const SITE_URL: string | null = HAS_REAL_DOMAIN ? siteFromConfig!.replace(/\/+$/, "") : null;

export const SITE_NAME = "CS2 选手设置库";

export const SITE_DESCRIPTION =
  "CS2 职业选手的准星码、灵敏度、视频设置与外设数据库。每个准星都附分享码与 CFG，可直接导入游戏。";

/** 标题模板：`{页面标题} - {站名}`。详情页会带上选手名与年份做时效刷新。 */
export function pageTitle(title: string): string {
  return `${title} - ${SITE_NAME}`;
}

export interface NavItem {
  label: string;
  href: string;
}

/** 主导航。href 不带尾斜杠，与 astro.config 的 trailingSlash:'never' 一致 */
export const NAV: NavItem[] = [
  { label: "选手", href: "/players" },
  { label: "准星工具", href: "/crosshair" },
  { label: "推荐器", href: "/tools/recommender" },
  { label: "数据排行", href: "/best/crosshairs" },
  { label: "指南", href: "/guides" },
  { label: "关于", href: "/about" },
];

export const FOOTER_LINKS: { label: string; href: string }[] = [
  { label: "数据来源与准确性声明", href: "/about/data" },
  { label: "关于本站", href: "/about" },
];

/**
 * 本地开发时 PocketBase 的源。生产环境留空 —— Caddy 把 /api/* 反代到 PocketBase，
 * 同源相对路径直接可用，零构建开销。
 *
 * fetch-data.mjs 写出的 avatar_url / logo_url 已经是相对路径 `/api/files/...`，
 * 缓存的 JSON 里不固化 PocketBase 地址，所以下面这个函数只做"按需加前缀"。
 */
const PB_ORIGIN = (env.PUBLIC_PB_ORIGIN ?? "").replace(/\/+$/, "");

/**
 * 把 fetch-data 产出的相对文件路径补成可用的 URL。
 * 图片是 `<img src>`，不受同源策略限制，所以开发时直接跨源指向 PocketBase 即可
 * （PocketBase 默认 --origins 为 *，也不会有 CORS 问题）。
 *
 * @param relativeUrl fetch-data 产出的 `/api/files/...`，可为 null
 */
export function pbFileUrl(relativeUrl: string | null | undefined): string | null {
  if (!relativeUrl) return null;
  if (!relativeUrl.startsWith("/")) return relativeUrl;
  return PB_ORIGIN ? `${PB_ORIGIN}${relativeUrl}` : relativeUrl;
}
