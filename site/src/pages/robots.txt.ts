import type { APIRoute } from "astro";
import { HAS_REAL_DOMAIN, SITE_URL } from "../config";

export const prerender = true;

export const GET: APIRoute = () => {
  const lines = ["User-agent: *", "Allow: /"];

  // 没有真实域名时不输出 Sitemap 行：指向 .invalid 的 sitemap 地址毫无意义，
  // 而且 sitemap 集成本身也只在有域名时才启用。
  if (HAS_REAL_DOMAIN) {
    lines.push("", `Sitemap: ${SITE_URL}/sitemap-index.xml`);
  }

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
