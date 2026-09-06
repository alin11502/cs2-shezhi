<script lang="ts">
  /**
   * 准星编辑器：拖参数 → 实时预览 → 实时生成准星码与 CFG。
   *
   * 红线守卫（这是本组件存在的核心理由）：
   * 准星码用定长位段存参数，超范围的值不会报错而是**静默回绕**成完全不同的值
   * （length 30 → 4.4、style 9 → style 1 且中心点开关被翻转）。所以每次改动都走
   * paramsToCode()：它先 clamp + 向零截断，再 encode，然后 decode 回读断言 21 项
   * 与钳制后的输入一致；不一致就**不出码**并显示原因。
   *
   * 输入框显示的是钳制后的值，所以用户看到的永远是码里真实存着的值。
   */
  import { paramsToCode } from "../../lib/crosshair/codec.ts";
  import { paramsToConVars } from "../../lib/crosshair/convars.ts";
  import { RANGES, UI_MAX } from "../../lib/crosshair/clamp.ts";
  import { PARAM_META, STYLE_LABELS, COLOR_LABELS, DYNAMIC_ONLY_PARAMS } from "../../lib/crosshair/fields.ts";
  import CrosshairScene from "./CrosshairScene.svelte";

  const INITIAL: Record<string, number | boolean> = {
    style: 4, length: 4, thickness: 1, gap: -2, color: 1,
    red: 0, green: 255, blue: 0,
    alpha_enabled: true, alpha: 255,
    outline_enabled: true, outline: 1,
    center_dot_enabled: false, follow_recoil: false,
    fixed_crosshair_gap: 0, t_style_enabled: false, deployed_weapon_gap_enabled: true,
    split_distance: 2, inner_split_alpha: 0.8, outer_split_alpha: 0.4, split_size_ratio: 1.5,
  };

  let params = $state<Record<string, number | boolean>>({ ...INITIAL });
  let result = $derived(paramsToCode(params));
  const cfg = $derived(result.code ? paramsToConVars(result.params) : "");
  const isDynamic = $derived(Number(params.style) === 4);
  // 开了「按武器间隙」时 cl_fixedcrosshairgap 不参与静止形态，滑条置灰避免"拖了没反应"的困惑
  const fixedGapInactive = $derived(Boolean(params.deployed_weapon_gap_enabled));
  const dynamicSet = new Set(DYNAMIC_ONLY_PARAMS);

  /** 滑条上限：outline 编码能到 127.5 但游戏 UI 只允许 3，滑条按游戏上限给 */
  function sliderMax(key: string): number {
    const range = RANGES[key];
    if (!range) return 1;
    return key in UI_MAX ? UI_MAX[key] : range[1];
  }

  function setNum(key: string, raw: string) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    // paramsToCode 内部会 clamp + 回读断言，这里把钳制后的值写回 state，
    // 于是输入框显示的就是码里真实存着的值
    const next = paramsToCode({ ...params, [key]: v });
    params = { ...next.params };
  }

  function setBool(key: string, v: boolean) {
    const next = paramsToCode({ ...params, [key]: v });
    params = { ...next.params };
  }

  function reset() {
    params = { ...INITIAL };
  }

  // 数值滑条参数（style/color/布尔除外）
  const SLIDER_KEYS = [
    "length", "thickness", "gap", "outline", "alpha",
    "fixed_crosshair_gap", "split_distance", "inner_split_alpha", "outer_split_alpha", "split_size_ratio",
  ];
</script>

<div class="space-y-6">
  <!-- 预览居中放大：这是编辑器的主体，参数控制放在它下面 -->
  <div class="mx-auto w-full max-w-2xl">
    <CrosshairScene params={params} size={460} />
  </div>

  <div class="mx-auto w-full max-w-2xl space-y-3">
    {#if result.code}
      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-center gap-2">
          <code class="rounded-box bg-base-300 px-2 py-1 font-mono text-xs break-all">{result.code}</code>
          <button type="button" class="btn btn-ghost btn-xs" data-copy={result.code}>复制码</button>
        </div>
        <details class="collapse collapse-arrow rounded-box border border-base-300 bg-base-100">
          <summary class="collapse-title py-2.5 text-sm font-medium">CFG（{cfg.split("\n").filter((l) => l.trim().startsWith("cl_")).length} 行）</summary>
          <div class="collapse-content">
            <div class="mb-2 flex justify-end">
              <button type="button" class="btn btn-ghost btn-xs" data-copy={cfg}>复制</button>
            </div>
            <pre class="rounded-box bg-base-300 p-3 text-xs leading-relaxed"><code class="font-mono">{cfg}</code></pre>
          </div>
        </details>
      </div>
    {:else}
      <div class="alert alert-error py-2 text-sm">
        <span>
          参数与生成的码不一致，已停止出码：
          {result.mismatch.map((m) => `${PARAM_META[m.key]?.label ?? m.key}（期望 ${m.expected}，码里 ${m.actual}）`).join("；")}
        </span>
      </div>
    {/if}

    <div class="flex justify-center">
      <button type="button" class="btn btn-ghost btn-sm" onclick={reset}>恢复默认</button>
    </div>
  </div>

  <div class="space-y-4">
    <!-- 样式与颜色 -->
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="form-control">
        <span class="label-text mb-1 text-sm">样式（cl_crosshairstyle）</span>
        <select class="select select-bordered select-sm" bind:value={params.style} onchange={() => (params = { ...paramsToCode(params).params })}>
          {#each [0, 1, 2, 3, 4] as v}
            <option value={v}>{v} · {STYLE_LABELS[v]}</option>
          {/each}
        </select>
      </label>

      <label class="form-control">
        <span class="label-text mb-1 text-sm">颜色（cl_crosshaircolor）</span>
        <select class="select select-bordered select-sm" bind:value={params.color} onchange={() => (params = { ...paramsToCode(params).params })}>
          {#each [0, 1, 2, 3, 4, 5, 6] as v}
            <option value={v}>{v} · {COLOR_LABELS[v]}</option>
          {/each}
        </select>
      </label>
    </div>

    {#if Number(params.color) === 6}
      <div class="grid grid-cols-3 gap-3">
        {#each ["red", "green", "blue"] as ch}
          <label class="form-control">
            <span class="label-text mb-1 text-xs">{PARAM_META[ch].label}（0–255）</span>
            <input
              type="number" min="0" max="255" step="1"
              class="input input-bordered input-sm w-full font-mono"
              value={params[ch]}
              onchange={(e) => setNum(ch, e.currentTarget.value)}
            />
          </label>
        {/each}
      </div>
    {/if}

    <!-- 数值滑条 -->
    <div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {#each SLIDER_KEYS as key}
        {@const range = RANGES[key]}
        {@const meta = PARAM_META[key]}
        {@const dyn = dynamicSet.has(key)}
        {@const isFixedGap = key === "fixed_crosshair_gap"}
        {@const inactive = (dyn && !isDynamic) || (isFixedGap && fixedGapInactive)}
        <label class={`form-control ${inactive ? "opacity-50" : ""}`}>
          <span class="label-text mb-1 flex items-center justify-between text-xs">
            <span>
              {meta.label}
              {#if dyn}
                <span class="badge badge-outline badge-xs ml-1" title="仅动态准星（样式 4）下影响外观">
                  {isDynamic ? "动态" : "动态·当前不生效"}
                </span>
              {/if}
              {#if isFixedGap}
                <span class="badge badge-outline badge-xs ml-1" title="cl_fixedcrosshairgap 只在关闭「间隙随武器变化」时决定间隙">
                  {fixedGapInactive ? "当前不生效（随武器开）" : "生效中（随武器关）"}
                </span>
              {/if}
            </span>
            <span class="font-mono tabular-nums">{params[key]}</span>
          </span>
          <span class="flex items-center gap-2">
            <input
              type="range"
              min={range[0]}
              max={sliderMax(key)}
              step={range[2]}
              class="range range-xs flex-1"
              bind:value={params[key]}
              oninput={(e) => setNum(key, e.currentTarget.value)}
            />
            <input
              type="number"
              min={range[0]}
              max={sliderMax(key)}
              step={range[2]}
              class="input input-bordered input-xs w-20 font-mono tabular-nums"
              value={params[key]}
              onchange={(e) => setNum(key, e.currentTarget.value)}
              aria-label={`${meta.label} 精确值`}
            />
          </span>
        </label>
      {/each}
    </div>

    <!-- 开关 -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {#each ["alpha_enabled", "outline_enabled", "center_dot_enabled", "follow_recoil", "t_style_enabled", "deployed_weapon_gap_enabled"] as key}
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            checked={Boolean(params[key])}
            onchange={(e) => setBool(key, e.currentTarget.checked)}
          />
          <span>{PARAM_META[key].label}</span>
        </label>
      {/each}
    </div>

    <p class="text-xs text-base-content/60">
      所有输入都会先钳制到合法范围并对齐步进（准星码用定长位段存参数，超范围的值不会报错
      而是静默回绕成完全不同的值）。生成码前会解码回读核对 21 项，不一致就不出码。
      标「动态·当前不生效」的 4 项只在样式为 4 时影响外观，但仍是准星码携带的真实参数。
    </p>
  </div>
</div>
