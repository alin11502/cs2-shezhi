<script lang="ts">
  /**
   * 客户端准星 SVG 渲染。与构建端的 CrosshairSvg.astro 消费同一份
   * buildShapes()，所以交互预览和静态页面上的准星逐像素一致。
   *
   * viewBox 固定 200、缩放用 geometry 的 DEFAULT_SCALE，保证跨选手可比；
   * 极端参数溢出由 SVG 裁切（geometry.ts 已文档化）。
   */
  import { buildShapes } from "../../lib/crosshair/geometry.ts";

  interface Props {
    params: Record<string, number | boolean>;
    size?: number;
    title?: string;
    background?: "game" | "dark" | "light" | "none";
    class?: string;
  }

  let { params, size = 200, title = "准星预览", background = "game", class: className = "" }: Props = $props();

  const shapes = $derived(buildShapes(params, { size: 200 }));

  const bgClass = $derived(
    background === "game"
      ? "crosshair-preview-bg"
      : background === "dark"
        ? "bg-base-300"
        : background === "light"
          ? "bg-white"
          : ""
  );
</script>

<div class="rounded-box flex items-center justify-center p-2 {bgClass} {className}">
  <svg
    viewBox="0 0 200 200"
    role="img"
    aria-label={title}
    class="block max-w-full"
    style="width:{size}px;height:{size}px"
  >
    <title>{title}</title>
    {#each shapes as s}
      {#if s.kind === "rect"}
        <rect
          x={Math.round(s.x * 100) / 100}
          y={Math.round(s.y * 100) / 100}
          width={Math.round(s.w * 100) / 100}
          height={Math.round(s.h * 100) / 100}
          fill={s.fill}
          opacity={s.opacity < 1 ? Math.round(s.opacity * 1000) / 1000 : undefined}
        />
      {:else}
        <circle
          cx={Math.round(s.cx * 100) / 100}
          cy={Math.round(s.cy * 100) / 100}
          r={Math.round(s.r * 100) / 100}
          fill={s.fill}
          opacity={s.opacity < 1 ? Math.round(s.opacity * 1000) / 1000 : undefined}
        />
      {/if}
    {/each}
  </svg>
</div>
