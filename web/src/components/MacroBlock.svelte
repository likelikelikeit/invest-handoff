<script>
  // 홈 블록 5 (SPEC §4.2): 한·미 기준금리와 금리 경로 그래프.
  import { api } from "../lib/api.js";
  import { data } from "../lib/data.svelte.js";
  import { latestWithChange } from "../lib/calc/calendar.js";

  let { detail = false } = $props();
  let macro = $state(null);
  let err = $state("");
  const chartModule = import("./RatePathChart.svelte");

  async function fetchMacro() {
    try {
      const from = new Date(Date.now() - (detail ? 10 : 5) * 365.25 * 86400000).toISOString().slice(0, 10);
      macro = await api("/macro?from=" + from);
    } catch (e) {
      err = e.message;
    }
  }
  $effect(() => { if (data.loaded) fetchMacro(); });
  $effect(() => {
    const f = () => fetchMacro();
    window.addEventListener("macro-changed", f);
    return () => window.removeEventListener("macro-changed", f);
  });

  const ROWS = [["FEDFUNDS", "미국 기준금리"], ["BOK_BASE", "한국 기준금리"], ["DGS2", "미국 2년물"], ["DGS10", "미국 10년물"]];
  const hasData = $derived(macro && ROWS.some(([k]) => macro.series[k]?.points.length));
</script>

{#if err}
  <p class="msg bad">거시 데이터를 불러오지 못했습니다: {err}</p>
{:else if macro && !hasData}
  <p class="note">거시 데이터 없음. FRED·ECOS 키를 넣으면 매일 08:30에 채워집니다{macro.cron?.errors?.length ? " (마지막 시도: " + macro.cron.errors[0] + ")" : ""}.</p>
{:else if macro}
  <dl class="now num">
    {#each ROWS as [k, label] (k)}
      {@const l = latestWithChange(macro.series[k]?.points)}
      <div>
        <dt>{label}</dt>
        <dd>{l ? l.value.toFixed(2) + "%" : "—"}
          {#if l?.prev}<em class={l.value > l.prev.value ? "up" : "down"}>{l.value > l.prev.value ? "▲" : "▼"} {Math.abs(l.value - l.prev.value).toFixed(2)}%p</em>{/if}
        </dd>
        {#if l}<span class="d">{l.date} 기준</span>{/if}
      </div>
    {/each}
  </dl>
  {#await chartModule then { default: RatePathChart }}
    <RatePathChart {macro} height={detail ? 340 : 220} />
  {/await}
  {#if macro.dots}
    <p class="note num">점도표 {macro.dots.sep} FOMC 중간값{macro.dots.long_run != null ? " · 장기 " + macro.dots.long_run.toFixed(3) + "%" : ""}</p>
  {:else}
    <p class="note">점도표 중간값이 없습니다. 더보기 → 거시에서 분기마다 넣을 수 있습니다.</p>
  {/if}
{/if}

<style>
  .now{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin-bottom:12px}
  .now div{padding:6px 0}
  .now dt{font-size:12.5px;color:var(--sub2)}
  .now dd{font-size:18px;font-weight:660;letter-spacing:-.01em}
  .now em{font-style:normal;font-size:12px;font-weight:560;margin-left:6px}
  .d{font-size:11.5px;color:var(--sub2)}
  .note{font-size:13px;color:var(--sub2);margin-top:8px;word-break:keep-all}
  @media (min-width:900px){ .now{grid-template-columns:repeat(4,1fr)} }
</style>
