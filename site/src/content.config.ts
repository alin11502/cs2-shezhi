import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
// ⚠ 不要从 'astro:content' 导入 z —— 那条路径在 Astro 7 已标记 deprecated，
// Astro 8 会移除（见 node_modules/astro/types/content.d.ts 的注释）。
import { z } from "astro/zod";

/**
 * guides 集合：Markdown 长文，走 Astro 7 的 Content Layer API。
 *
 * 与旧版的差别（都是实测 node_modules 确认的）：
 * - 配置文件是 src/content.config.ts，不是 src/content/config.ts
 * - loader 从 'astro/loaders' 导入 glob，不再靠目录约定自动发现
 * - entry.id 由文件路径派生，getStaticPaths 里用它当 slug
 */
const guides = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string().max(60, "title 会进 <title> 与搜索结果，控制在 60 字符内"),
    description: z.string().min(20).max(160),
    /** 发布日期。z.coerce 让 frontmatter 里写 2026-09-04 也能解析成 Date */
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { guides };
