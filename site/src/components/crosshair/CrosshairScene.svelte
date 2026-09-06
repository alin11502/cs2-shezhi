<script lang="ts">
  /**
   * 准星预览场景：地图背景 + 比例/缩放模式切换。
   *
   * 为什么需要比例切换：4:3 拉伸模式下游戏把 4:3 画面拉到 16:9，
   * 准星会跟着横向拉宽约 1.33 倍；黑边模式则不变形但可视区变窄。
   * 同一个准星码在不同比例下观感差别很大，必须能切换着看。
   *
   * 背景：photo 标记的地图加载 public/maps/<slug>.jpg 的 CS2 游戏内真实截图（© Valve，站长提供）；
   * 未提供或图片加载失败（onerror）时回落到按地图色调渲染的 SVG 示意场景（天空+地面+斜墙）。不使用 AI 生成图。
   */
  import { MAPS, ASPECT_MODES, stretchFor, boxAspectFor, BLACK_BAR_RATIO, type AspectMode } from "../../lib/maps.ts";
  import CrosshairPreview from "./CrosshairPreview.svelte";

  interface Props {
    params: Record<string, number | boolean>;
    /** 预览边长（px）。默认 320，比早期的 180/220 大，准星看得清 */
    size?: number;
  }

  let { params, size = 320 }: Props = $props();

  let mapSlug = $state(MAPS[0].slug);
  let mode = $state<AspectMode>("16:9");

  const map = $derived(MAPS.find((m) => m.slug === mapSlug) ?? MAPS[0]);
  const stretch = $derived(stretchFor(mode));
  const boxAspect = $derived(boxAspectFor(mode));
  const modeNote = $derived(ASPECT_MODES.find((m) => m.id === mode)?.note ?? "");
  const imgSrc = $derived(`/maps/${map.slug}.jpg`);
  // 场景几何：地平线高度与墙宽。{@const} 不能作为 svg 的子节点，所以放这里
  const hy = $derived(map.scene.horizon * 90);
  const wl = $derived(30 + map.scene.wall * 0.4);
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-2">
    <select class="select select-bordered select-sm" bind:value={mapSlug} aria-label="选择地图">
      {#each MAPS as m}
        <option value={m.slug}>{m.name}</option>
      {/each}
    </select>

    <select class="select select-bordered select-sm" bind:value={mode} aria-label="选择比例与缩放模式">
      {#each ASPECT_MODES as m}
        <option value={m.id}>{m.label}</option>
      {/each}
    </select>
  </div>

  <!-- 画面盒子：比例由模式决定 -->
  <div
    class="relative w-full overflow-hidden rounded-box border border-base-300"
    style="aspect-ratio:{boxAspect}"
  >
    <!-- 场景底层（回落用）：天空+地面+两侧斜墙，按地图色调参数化。
         public/maps/<slug>.jpg 存在时 img 会盖住它 -->
    <svg class="absolute inset-0 h-full w-full" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="0" width="160" height={hy} fill={map.from} />
      <rect x="0" y={hy} width="160" height={90 - hy} fill={map.to} />
      <polygon points={`0,90 0,${hy - 8} ${wl},${hy + 6} 34,90`} fill={map.scene.mid} />
      <polygon points={`160,90 160,${hy - 8} ${160 - wl},${hy + 6} 126,90`} fill={map.scene.mid} />
      <rect x="0" y={hy - 1} width="160" height="1.5" fill="#000" opacity="0.25" />
    </svg>

    <img
      src={imgSrc}
      alt=""
      class="absolute inset-0 h-full w-full object-cover"
      onerror={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />

    {#if mode === "4:3-blackbars"}
      <div class="absolute inset-y-0 left-0 bg-black" style="width:{BLACK_BAR_RATIO * 100}%"></div>
      <div class="absolute inset-y-0 right-0 bg-black" style="width:{BLACK_BAR_RATIO * 100}%"></div>
    {/if}

    <!-- 准星居中；拉伸模式下整体横向缩放（游戏里拉伸会连描边一起拉宽） -->
    <div class="absolute inset-0 flex items-center justify-center">
      <div style="transform:scaleX({stretch})">
        <CrosshairPreview params={params} size={size} title={`${map.name} 上的准星预览`} background="none" />
      </div>
    </div>

    <span class="absolute bottom-1.5 right-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80">
      {map.name} · {map.photo ? "游戏画面（© Valve）" : "示意场景"}
    </span>
  </div>

  <p class="text-xs text-base-content/60">{modeNote}</p>
</div>
