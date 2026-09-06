<script lang="ts">
  /**
   * 准星码查询：粘贴码 → 校验 → 解码 → 参数表 + SVG + CFG。
   *
   * 解码在客户端做（csgo-sharecode 是零依赖纯 ESM，可打进 bundle），
   * 所以查一个不在库里的码也能立刻看到结果，不需要为每个码建页面。
   * 库里有这个码时给出详情页链接（那里有使用者与历史）。
   */
  import { codeToParams, isValidCode } from "../../lib/crosshair/codec.ts";
  import { paramsToConVars } from "../../lib/crosshair/convars.ts";
  import { PARAM_META, STYLE_LABELS, COLOR_LABELS, BOOL_PARAMS } from "../../lib/crosshair/fields.ts";
  import CrosshairPreview from "./CrosshairPreview.svelte";

  interface Props {
    /** 库里已有的码，用于给"详情页"链接 */
    knownCodes?: string[];
  }

  let { knownCodes = [] }: Props = $props();

  let input = $state("");
  let touched = $state(false);

  const trimmed = $derived(input.trim());
  const valid = $derived(isValidCode(trimmed));

  let decoded: Record<string, number | boolean> | null = $derived.by(() => {
    if (!valid) return null;
    try {
      return codeToParams(trimmed);
    } catch {
      return null;
    }
  });

  // 码格式对但解码抛错（理论上 isValidCode 已挡住，这里是双保险）
  const decodeFailed = $derived(valid && decoded === null);
  const known = $derived(knownCodes.includes(trimmed));
  const cfg = $derived(decoded ? paramsToConVars(decoded) : "");

  function display(key: string, value: number | boolean | undefined): string {
    if (value === undefined || value === null) return "—";
    if (BOOL_PARAMS.has(key)) return value ? "开" : "关";
    if (key === "style") return `${value}（${STYLE_LABELS[Number(value)] ?? "未知"}）`;
    if (key === "color") return `${value}（${COLOR_LABELS[Number(value)] ?? "未知"}）`;
    return String(value);
  }

  const paramKeys = $derived(Object.keys(PARAM_META));
</script>

<div class="space-y-4">
  <label class="form-control">
    <span class="label-text mb-1 text-sm">粘贴准星码</span>
    <input
      type="text"
      class="input input-bordered w-full font-mono text-sm"
      placeholder="CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
      bind:value={input}
      oninput={() => (touched = true)}
      spellcheck="false"
      autocomplete="off"
    />
  </label>

  {#if touched && trimmed && !valid}
    <div class="alert alert-error py-2 text-sm">
      <span>
        格式不对：准星码是 <code class="font-mono">CSGO-</code> 开头、5 组各 5 个字符、
        定长 34，字符集只含字母数字与连字符。
      </span>
    </div>
  {/if}

  {#if decodeFailed}
    <div class="alert alert-error py-2 text-sm">
      <span>格式看着对但解不开，这串字符可能不是有效的准星分享码。</span>
    </div>
  {/if}

  {#if decoded}
    <div class="grid gap-5 lg:grid-cols-[auto_1fr]">
      <CrosshairPreview params={decoded} size={180} title="查询结果预览" />

      <div class="min-w-0 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <code class="rounded-box bg-base-300 px-2 py-1 font-mono text-xs break-all">{trimmed}</code>
          <button type="button" class="btn btn-ghost btn-xs" data-copy={trimmed}>复制</button>
          {#if known}
            <a href="/crosshair/{trimmed}" class="btn btn-ghost btn-xs">
              库里 {knownCodes.length > 0 ? "有选手在用 →" : "详情页 →"}
            </a>
          {:else}
            <span class="badge badge-ghost badge-xs">本站暂未收录使用此码的选手</span>
          {/if}
        </div>

        <div class="table-scroll rounded-box border border-base-300">
          <table class="table table-zebra table-sm">
            <thead>
              <tr><th scope="col">参数</th><th scope="col">convar</th><th scope="col" class="text-right">值</th></tr>
            </thead>
            <tbody>
              {#each paramKeys as key}
                <tr>
                  <th scope="row" class="font-normal">{PARAM_META[key]?.label ?? key}</th>
                  <td><code class="font-mono text-xs text-base-content/70">{PARAM_META[key]?.convar ?? "—"}</code></td>
                  <td class="text-right font-mono text-sm tabular-nums">{display(key, decoded[key])}</td>
                </tr>
              {/each}
            </tbody>
          </table>
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
    </div>
  {:else if !touched}
    <p class="text-sm text-base-content/60">
      输入或粘贴一个准星码即可看到它的可视化预览、全部 21 项参数和可导入的 CFG。
      解码在浏览器本地完成，不需要联网。
    </p>
  {/if}
</div>
