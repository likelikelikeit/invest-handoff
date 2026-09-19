<script>
  // 종목 상세 · 개요 (SPEC §4.3): 가격 차트(스크러빙, 기간 토글), 52주 범위, 거래량.
  // 다음 어닝일·컨센 목표가 vs 내 목표가를 M5a 재무 응답에서 함께 표시한다.
  // 차트 라이브러리(~100KB)는 상세 화면에서만 필요해서 여기서 늦게 불러온다
  const chartModule = import("./PriceChart.svelte");
  import { api } from "../lib/api.js";
  import { range52w, volumeStats } from "../lib/calc/chart.js";
  import { stamp } from "../lib/format.js";
  import { latestTarget, sourceLabel } from "../lib/calc/fundamentals.js";

  let { id, fmt, quote, fundamentals = null, view = null } = $props();

  let rows = $state([]);
  let state = $state("loading"); // loading | backfilling | ok | empty | error
  let err = $state("");
  let lastDate = $state("");

  const r52 = $derived(range52w(rows, quote?.price));
  const vs = $derived(volumeStats(rows));
  const consensus = $derived(latestTarget(fundamentals?.estimates || [], fundamentals?.security?.market));

  async function fetchRows() {
    const r = await api("/prices/" + id + "?range=10y");
    rows = r.rows;
    lastDate = r.last || "";
    return r;
  }

  async function init() {
    state = "loading";
    try {
      const r = await fetchRows();
      if (r.count < 200) {
        // 새로 추가한 종목: 지금 5년치를 받는다 (Worker가 이 종목 하나만)
        state = "backfilling";
        const b = await api("/prices/" + id + "/backfill", { method: "POST" });
        if (b.ok) await fetchRows();
      }
      state = rows.length ? "ok" : "empty";
    } catch (e) {
      err = e.message;
      state = "error";
    }
  }

  $effect(() => {
    id;
    init();
  });
</script>

{#if state === "loading"}
  <p class="note">차트 불러오는 중…</p>
{:else if state === "backfilling"}
  <p class="note">처음 보는 종목이라 5년치 시세를 받는 중…</p>
{:else if state === "error"}
  <p class="note bad">차트를 불러오지 못했습니다: {err}</p>
{:else if state === "empty"}
  <p class="note">시세 데이터 없음. 야후에서 이 종목 일봉을 찾지 못했습니다.</p>
{:else}
  {#await chartModule then { default: PriceChart }}
    <PriceChart {rows} {fmt} stampText={"일봉 " + lastDate + " 종가까지 · 매일 자동 갱신"} />
  {/await}

  <dl class="facts">
    {#if r52}
      <div class="r52">
        <dt>52주 범위</dt>
        <dd>
          <div class="bar" aria-hidden="true"><span style:left="{r52.pos * 100}%"></span></div>
          <div class="ends num"><span>{fmt(r52.low)}</span><span>{fmt(r52.high)}</span></div>
        </dd>
      </div>
    {/if}
    {#if vs}
      <div>
        <dt>거래량</dt>
        <dd class="num">{Math.round(vs.last).toLocaleString("ko-KR")}{#if vs.ratio}<em>20일 평균의 {vs.ratio.toFixed(1)}배</em>{/if}</dd>
      </div>
    {/if}
    {#if quote?.time}
      <div><dt>현재가 기준</dt><dd class="num">{stamp(quote.time)} · 지연</dd></div>
    {/if}
    {#if fundamentals?.next_earnings}
      <div><dt>다음 실적 발표</dt><dd class="num">{fundamentals.next_earnings.date.replace(/-/g, ".")}</dd></div>
    {/if}
    {#if consensus}
      <div><dt>컨센서스 목표가</dt><dd class="num">{fmt(consensus.target_price)}<em>{sourceLabel(consensus.source)} · {consensus.as_of}</em></dd></div>
    {/if}
    {#if view}
      <div><dt>내 목표가</dt><dd class="num">{fmt(view.target_price)}</dd></div>
    {/if}
  </dl>
{/if}

<style>
  .note{font-size:14px;color:var(--sub2);padding:24px 0}
  .note.bad{color:var(--red)}
  .facts{display:grid;grid-template-columns:minmax(0,1fr);gap:4px 28px;margin-top:18px;padding-top:12px;border-top:1px solid var(--line-soft)}
  .facts > div{padding:8px 0}
  dt{font-size:12.5px;color:var(--sub2);margin-bottom:4px}
  dd{font-size:15px;font-weight:600}
  dd em{font-style:normal;font-weight:450;font-size:12.5px;color:var(--sub);margin-left:8px}
  .bar{position:relative;height:4px;border-radius:99px;background:var(--track);margin:8px 0 6px}
  .bar span{position:absolute;top:50%;width:12px;height:12px;border-radius:50%;background:var(--ink);transform:translate(-50%,-50%)}
  .ends{display:flex;justify-content:space-between;font-size:12.5px;font-weight:500;color:var(--sub)}
  @media (min-width:900px){ .facts{grid-template-columns:repeat(3,minmax(0,1fr))} .r52{grid-column:span 2} }
</style>
