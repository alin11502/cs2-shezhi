<script lang="ts">
  /**
   * 动态准星扩张示意动画。
   *
   * 用准星码里真实的 4 项分裂参数驱动：split_distance 决定扩张幅度、
   * split_size_ratio 决定最大分裂比、inner/outer_split_alpha 调制透明度。
   *
   * ⚠ 这是**示意动画，不是引擎精确模拟**。CS2 里动态准星的扩张还取决于
   * 移动速度、武器后坐力曲线、FOV 等码里不携带的因素，这里只用一条
   * "快速升起 + 指数回落"的曲线近似一次连射。页面上必须保留这个标注。
   */
  import { onMount } from "svelte";
  import { effectiveGap } from "../../lib/crosshair/geometry.ts";
  import CrosshairPreview from "./CrosshairPreview.svelte";

  interface Props {
    params: Record<string, number | boolean>;
  }

  let { params }: Props = $props();

  let playing = $state(true);
  let spread = $state(0); // 当前额外扩张量（游戏单位）

  const baseGap = $derived(effectiveGap(params));
  const amp = $derived(Number(params.split_distance ?? 0) * Math.max(0.2, Number(params.split_size_ratio ?? 1)));
  const animatedParams = $derived({ ...params, gap: baseGap + spread });

  onMount(() => {
    let raf = 0;
    let start = performance.now();
    const PERIOD = 1400; // 一次"连射 + 回落"的周期（ms）

    const tick = (now: number) => {
      if (playing) {
        const t = ((now - start) % PERIOD) / PERIOD; // 0..1
        // 快速升起（前 15%）+ 指数回落：模拟一次连射后准星收回
        const rise = t < 0.15 ? t / 0.15 : 1;
        const decay = t < 0.15 ? 1 : Math.exp(-(t - 0.15) * 5);
        spread = amp * rise * decay;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="space-y-3">
  <CrosshairPreview params={animatedParams} size={180} title="动态准星扩张示意" />

  <div class="flex flex-wrap items-center gap-3 text-sm">
    <button type="button" class="btn btn-ghost btn-sm" onclick={() => (playing = !playing)}>
      {playing ? "暂停" : "播放"}
    </button>
    <span class="font-mono text-xs tabular-nums text-base-content/70">
      当前间隙 {(baseGap + spread).toFixed(2)}（静止 {baseGap}）
    </span>
  </div>

  <p class="text-xs text-base-content/60">
    示意动画，非引擎精确模拟：扩张幅度取自码里的 split_distance（{params.split_distance}）
    与 split_size_ratio（{params.split_size_ratio}），但真实游戏里的扩张还受移动速度、
    武器后坐力与 FOV 影响，这些因素并不编码在准星码中。内外段透明度系数
    （{params.inner_split_alpha} / {params.outer_split_alpha}）同理只作方向参考。
  </p>
</div>
