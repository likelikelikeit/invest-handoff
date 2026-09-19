<script>
  // 시세 기준 시각 (SPEC §6.8). 지연 시세임을 숨기지 않는다.
  import { data, refreshQuotes } from "../lib/data.svelte.js";
  import { stamp } from "../lib/format.js";

  let busy = $state(false);

  async function refresh() {
    busy = true;
    await refreshQuotes();
    busy = false;
  }
</script>

<div class="stamp">
  <span class="num">
    {#if data.offline}
      오프라인 · {data.cachedAt ? stamp(data.cachedAt) : data.quoteAt ? stamp(data.quoteAt) : "마지막 저장 데이터"} 기준
    {:else if data.quoteAt}
      시세 {stamp(data.quoteAt)} 기준 · 야후 지연{#if data.fx} · 달러 {data.fx.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원{/if}
    {:else if data.loaded}
      시세 데이터 없음 · 평단으로 표시
    {/if}
  </span>
  {#if data.loaded}
    <button class="btn sm" onclick={refresh} disabled={busy} aria-label="시세 새로고침">{busy ? "받는 중…" : "새로고침"}</button>
  {/if}
</div>
{#if data.quoteErrors.length}
  <p class="err">일부 시세를 못 받았습니다: {data.quoteErrors.join(" / ")}</p>
{/if}

<style>
  .stamp{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px;color:var(--sub2)}
  .stamp span{flex:1;min-width:0}
  .err{font-size:12.5px;color:var(--orange);margin-top:4px}
</style>
