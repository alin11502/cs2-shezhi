<script lang="ts">
  /**
   * 推荐器：问卷 → 规则引擎推荐 → 选手匹配 → PSA 精调。
   *
   * 三个设计约束：
   * 1. 推荐必须可解释 —— 每条理由逐条展示，黑盒推荐对设置站没有价值
   * 2. 匹配要诚实标注覆盖率 —— 缺数据的维度被剔除，显示"基于 N/5 个维度"
   * 3. PSA 状态进 URL fragment + localStorage —— 刷新、换设备都能续上
   */
  import { onMount } from "svelte";
  import { recommend } from "../../lib/recommend/rules.ts";
  import { matchPlayers, type MatchInput } from "../../lib/recommend/match-players.ts";
  import { startPsa, nextState, encodeState, decodeState, PSA_MAX_ROUNDS, type PsaChoice } from "../../lib/recommend/psa.ts";
  import { edpiStats } from "../../lib/recommend/pro-stats.ts";
  import { cm360 } from "../../lib/format.ts";
  import CrosshairPreview from "../crosshair/CrosshairPreview.svelte";
  import type { Answers, Recommendation, PlayerMatch, PsaState } from "../../lib/recommend/types.ts";
  import type { PlayerSettings } from "../../lib/types.ts";

  interface Props {
    inputs: MatchInput[];
    settings: PlayerSettings[];
  }

  let { inputs, settings }: Props = $props();

  const stats = $derived(edpiStats(settings));

  let answers = $state<Answers>({
    aimStyle: "steady",
    grip: "arm",
    weapon: "rifle",
    resolution: "1920x1080",
    aspect: "16:9",
    screenSizeInch: 24,
    dpi: 800,
    currentSens: null,
    crosshairPref: "auto",
    colorPref: null,
    mapPref: "mixed",
    experience: "mid",
  });

  let submitted = $state(false);
  let rec = $state<Recommendation | null>(null);
  let matches = $state<PlayerMatch[]>([]);
  let psa = $state<PsaState | null>(null);

  onMount(() => {
    // fragment 优先于 localStorage：链接里带的状态代表"别人分享给我的进度"
    const frag = location.hash.replace(/^#psa=/, "");
    const fromUrl = location.hash.startsWith("#psa=") ? decodeState(frag) : null;
    const fromStorage = (() => {
      try {
        const raw = localStorage.getItem("cs2cx.psa.v1");
        return raw ? decodeState(raw) : null;
      } catch {
        return null;
      }
    })();
    const restored = fromUrl ?? fromStorage;
    if (restored) {
      psa = restored;
      submitted = true;
      // 恢复 PSA 时也需要推荐结果来展示准星；用默认问卷重算一次
      rec = recommend(answers);
      matches = matchPlayers(answers, inputs);
    }
  });

  function persist(next: PsaState) {
    psa = next;
    try {
      localStorage.setItem("cs2cx.psa.v1", encodeState(next));
    } catch {
      // 隐私模式下 localStorage 可能不可用，忽略
    }
    history.replaceState(null, "", `#psa=${encodeState(next)}`);
  }

  function submit() {
    rec = recommend(answers);
    matches = matchPlayers(answers, inputs);
    submitted = true;
    persist(startPsa(answers.dpi, rec.sens.startSens));
  }

  function choose(c: PsaChoice) {
    if (!psa) return;
    persist(nextState(psa, c));
  }

  function restartPsa() {
    if (!rec) return;
    persist(startPsa(answers.dpi, rec.sens.startSens));
  }

  const psaCm360 = $derived(psa?.finalSens ? cm360(psa.finalSens, answers.dpi) : null);
</script>

<div class="space-y-8">
  <!-- 问卷 -->
  <form
    class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <label class="form-control">
      <span class="label-text mb-1 text-sm">打法</span>
      <select class="select select-bordered select-sm" bind:value={answers.aimStyle}>
        <option value="steady">跟枪为主</option>
        <option value="flick">甩枪为主</option>
      </select>
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">发力方式</span>
      <select class="select select-bordered select-sm" bind:value={answers.grip}>
        <option value="arm">手臂流</option>
        <option value="wrist">手腕流</option>
      </select>
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">主武器</span>
      <select class="select select-bordered select-sm" bind:value={answers.weapon}>
        <option value="rifle">步枪</option>
        <option value="awp">狙击</option>
        <option value="mixed">混用</option>
      </select>
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">屏幕比例</span>
      <select class="select select-bordered select-sm" bind:value={answers.aspect}>
        <option value="16:9">16:9</option>
        <option value="4:3">4:3</option>
        <option value="16:10">16:10</option>
        <option value="5:4">5:4</option>
        <option value="21:9">21:9</option>
      </select>
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">鼠标 DPI</span>
      <input type="number" min="100" max="32000" step="50" class="input input-bordered input-sm font-mono" bind:value={answers.dpi} />
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">当前游戏内灵敏度（可留空）</span>
      <input type="number" min="0.1" max="10" step="0.01" placeholder="留空则用推荐起点" class="input input-bordered input-sm font-mono" bind:value={answers.currentSens} />
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">准星偏好</span>
      <select class="select select-bordered select-sm" bind:value={answers.crosshairPref}>
        <option value="auto">交给推荐</option>
        <option value="dot">中心点</option>
        <option value="cross">十字</option>
        <option value="dynamic">动态</option>
      </select>
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">颜色偏好</span>
      <select class="select select-bordered select-sm" bind:value={answers.colorPref}>
        <option value={null}>交给推荐</option>
        <option value={0}>红</option>
        <option value={1}>绿</option>
        <option value={2}>黄</option>
        <option value={3}>蓝</option>
        <option value={4}>青</option>
        <option value={5}>粉</option>
        <option value={6}>自定义</option>
      </select>
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">常打地图</span>
      <select class="select select-bordered select-sm" bind:value={answers.mapPref}>
        <option value="mixed">混合</option>
        <option value="close">近距离多（炼狱、古堡）</option>
        <option value="open">开阔多（沙二、荒漠）</option>
      </select>
    </label>

    <label class="form-control">
      <span class="label-text mb-1 text-sm">经验</span>
      <select class="select select-bordered select-sm" bind:value={answers.experience}>
        <option value="new">新手</option>
        <option value="mid">进阶</option>
        <option value="vet">老手</option>
      </select>
    </label>

    <div class="sm:col-span-2 lg:col-span-3">
      <button type="submit" class="btn btn-primary btn-sm">给出推荐</button>
    </div>
  </form>

  {#if submitted && rec}
    <!-- 推荐结果 -->
    <section class="grid gap-6 lg:grid-cols-[auto_1fr]" aria-labelledby="rec-result">
      <div class="space-y-3">
        <h2 id="rec-result" class="text-lg font-bold">推荐准星</h2>
        <CrosshairPreview params={rec.crosshair.params} size={180} title="推荐准星预览" />
        <p class="text-xs text-base-content/60">
          想微调或拿分享码？把它复制到
          <a href="/crosshair" class="link link-hover">准星编辑器</a>里继续调。
        </p>
      </div>

      <div class="min-w-0 space-y-4">
        <div>
          <h3 class="mb-2 text-sm font-semibold">为什么推荐这套准星</h3>
          <ul class="list-disc space-y-1 pl-5 text-sm text-base-content/80">
            {#each rec.crosshair.reasons as reason}
              <li>{reason}</li>
            {/each}
          </ul>
        </div>

        <div class="rounded-box border border-base-300 bg-base-200 p-4">
          <h3 class="mb-2 text-sm font-semibold">灵敏度建议</h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div><dt class="text-xs text-base-content/60">eDPI 区间</dt><dd class="font-mono tabular-nums">{rec.sens.edpiRange[0]}–{rec.sens.edpiRange[1]}</dd></div>
            <div><dt class="text-xs text-base-content/60">起点灵敏度</dt><dd class="font-mono tabular-nums">{rec.sens.startSens} @ {answers.dpi}</dd></div>
            <div><dt class="text-xs text-base-content/60">cm/360</dt><dd class="font-mono tabular-nums">{rec.sens.cm360Range[0]}–{rec.sens.cm360Range[1]}</dd></div>
            <div><dt class="text-xs text-base-content/60">开镜系数</dt><dd class="font-mono tabular-nums">{rec.sens.zoomSens}</dd></div>
          </dl>
          <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-base-content/70">
            {#each rec.sens.reasons as reason}
              <li>{reason}</li>
            {/each}
          </ul>
          {#if stats.sufficient && stats.median}
            <p class="mt-2 text-xs text-base-content/60">
              参考：本站 {stats.n} 名选手的 eDPI 中位数 {stats.median}（25–75 分位 {stats.p25}–{stats.p75}）。
            </p>
          {:else}
            <p class="mt-2 text-xs text-base-content/60">
              本站当前只有 {stats.n} 名选手的灵敏度数据，少于 {8} 人的样本门槛，
              所以区间来自社区公认的职业范围而非本站统计。
            </p>
          {/if}
        </div>

        <!-- 选手匹配 -->
        <div>
          <h3 class="mb-2 text-sm font-semibold">和你最像的选手</h3>
          {#if matches.length === 0}
            <p class="text-sm text-base-content/60">数据库建设中，暂无可匹配的选手。</p>
          {:else}
            <ul class="space-y-2">
              {#each matches as m}
                <li class="rounded-box border border-base-300 bg-base-100 p-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <a href="/players/{m.slug}" class="link link-hover text-sm font-semibold">{m.name}</a>
                    <span class="text-xs text-base-content/60">
                      相似度 {Math.round(m.score * 100)}% · 基于 {m.dimensionsUsed}/5 个维度
                      {m.edpi ? ` · eDPI ${m.edpi}` : ""}
                    </span>
                  </div>
                  <div class="mt-2 grid gap-1 sm:grid-cols-2">
                    {#each m.breakdown as b}
                      <div class="flex items-center gap-2 text-xs">
                        <span class="w-24 shrink-0 text-base-content/60">{b.label}</span>
                        <span class="h-1.5 flex-1 rounded-full bg-base-300">
                          <span class="block h-1.5 rounded-full bg-primary" style="width:{Math.round(b.score * 100)}%"></span>
                        </span>
                        <span class="w-10 text-right font-mono tabular-nums text-base-content/60">{Math.round(b.score * 100)}%</span>
                      </div>
                    {/each}
                  </div>
                </li>
              {/each}
            </ul>
            <p class="mt-2 text-xs text-base-content/60">
              缺数据的维度会被剔除并把剩余权重归一化，所以"基于 N/5 个维度"越少，相似度越不可靠。
            </p>
          {/if}
        </div>
      </div>
    </section>

    <!-- PSA 精调 -->
    <section class="rounded-box border border-base-300 bg-base-100 p-5" aria-labelledby="psa-title">
      <h2 id="psa-title" class="mb-1 text-lg font-bold">PSA 灵敏度精调</h2>
      <p class="mb-4 text-sm text-base-content/70">
        每轮给两个灵敏度，各练 10–15 分钟同样的内容，选更好的那个。
        区间收到 5% 以内或满 {PSA_MAX_ROUNDS} 轮即收敛。倍数与阈值是社区经验值，不是权威标准。
      </p>

      {#if psa}
        {#if psa.status === "testing"}
          <p class="mb-3 text-sm">
            第 {psa.round} / {PSA_MAX_ROUNDS} 轮 · 当前区间
            <span class="font-mono tabular-nums">{psa.low} – {psa.high}</span>
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <button type="button" class="btn btn-outline btn-sm" onclick={() => choose("a")}>
              低档 {psa.pair[0]} 更好
            </button>
            <button type="button" class="btn btn-outline btn-sm" onclick={() => choose("b")}>
              高档 {psa.pair[1]} 更好
            </button>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => choose("same")}>两个差不多</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => choose("stop")}>到此为止</button>
          </div>
          {#if psa.history.length > 0}
            <details class="mt-4">
              <summary class="cursor-pointer text-xs text-base-content/60">历史（{psa.history.length} 轮）</summary>
              <ul class="mt-2 space-y-1 text-xs font-mono text-base-content/60">
                {#each psa.history as h}
                  <li>第 {h.round} 轮：试 {h.pair[0]} / {h.pair[1]} → 保留 {h.kept}</li>
                {/each}
              </ul>
            </details>
          {/if}
        {:else}
          <div class="rounded-box bg-base-200 p-4">
            <p class="text-sm">
              收敛结果：游戏内灵敏度
              <strong class="font-mono text-lg tabular-nums">{psa.finalSens}</strong>
              @ {psa.dpi} DPI
              {#if psaCm360}
                （约 {psaCm360} cm/360）
              {/if}
            </p>
            <p class="mt-2 text-xs text-base-content/60">
              用这个灵敏度正常打几天再微调 ±5%。PSA 找到的是静态练习下的最优值，
              实战有压力时体感会略有不同，属正常。
            </p>
            <button type="button" class="btn btn-ghost btn-xs mt-3" onclick={restartPsa}>重新精调</button>
          </div>
        {/if}
        <p class="mt-3 text-xs text-base-content/50">
          进度已存到浏览器并写进网址，刷新或换设备打开链接都能续上。
        </p>
      {/if}
    </section>
  {/if}
</div>
