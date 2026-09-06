<script lang="ts">
  /**
   * 准星预览场景：地图背景 + 比例/缩放模式切换。
   *
   * 为什么需要比例切换：4:3 拉伸模式下游戏把 4:3 画面拉到 16:9，
   * 准星会跟着横向拉宽约 1.33 倍；黑边模式则不变形但可视区变窄。
   * 同一个准星码在不同比例下观感差别很大，必须能切换着看。
   *
   * 背景默认是按地图色调生成的渐变（示意）；若 public/maps/<slug>.jpg 存在
   * 则优先用真实截图（img 加载失败自动回落到渐变）。
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

  <!-- 画面盒子：比例由模式决定；背景优先真实截图，失败回落渐变 -->
  <div
    class="relative w-full overflow-hidden rounded-box border border-base-300"
    style="aspect-ratio:{boxAspect};background:linear-gradient(160deg,{map.from},{map.to})"
  >
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
      {map.name} · 示意背景
    </span>
  </div>

  <p class="text-xs text-base-content/60">{modeNote}</p>
</div>
