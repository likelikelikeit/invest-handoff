<script>
  import MiniLine from "./MiniLine.svelte";
  import { api } from "../lib/api.js";
  import { toast } from "../lib/ui.svelte.js";
  import { financialPeriods, availableMetrics, metricSeries, sourceLabel } from "../lib/calc/fundamentals.js";
  import { won, usd } from "../lib/format.js";

  let { id, payload, onrefresh = () => {} } = $props();
  let period = $state("Q");
  let metric = $state("revenue");
  let busy = $state(false);

  const sec = $derived(payload?.security);
  const rows = $derived(financialPeriods(payload?.financials || [], period));
  const metrics = $derived(availableMetrics(rows));
  const selected = $derived(metrics.find((m) => m.key === metric) || metrics[0]);
  const series = $derived(selected ? metricSeries(rows, selected.key) : []);
  const estimates = $derived(payload?.estimates || []);
  const fetched = $derived(rows.map((r) => r.fetched_at).filter(Boolean).sort().at(-1));

  function money(n) {
    if (!Number.isFinite(n)) return "—";
    return sec?.currency === "USD"
      ? (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })
      : won(n);
  }
  function perShare(n) {
    if (!Number.isFinite(n)) return "—";
    return sec?.currency === "USD" ? usd(n) : won(n);
  }
  function cell(key, n) {
    if (!Number.isFinite(n)) return "—";
    if (key === "eps" || key === "bps") return perShare(n);
    if (key === "shares_out") return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "주";
    return money(n);
  }
  function periodName(row) {
    const y = row.period_end.slice(0, 4);
    if (row.period_type === "FY") return y;
    const m = Number(row.period_end.slice(5, 7));
    return y + "." + Math.ceil(m / 3) + "Q";
  }
  function estimateTitle(e) {
    return e.fiscal_year ? e.fiscal_year + "년 추정" : "목표가·의견";
  }
  function rating(e) {
    if (!Number.isFinite(e.rating_mean)) return "—";
    return e.rating_mean.toFixed(2) + " / 5" + (e.source === "yahoo" ? " · 낮을수록 매수" : " · 높을수록 매수");
  }
  function dateText(iso) {
    return iso ? iso.slice(0, 10).replace(/-/g, ".") : "";
  }

  async function refresh() {
    busy = true;
    try {
      await api("/fundamentals/" + id + "/refresh", { method: "POST" });
      await onrefresh();
      toast("재무·컨센서스를 갱신했습니다");
    } catch (e) {
      toast("갱신 실패: " + e.message);
    } finally { busy = false; }
  }
</script>

<div class="toolbar">
  <div class="period" role="group" aria-label="재무 기간">
    <button class:active={period === "Q"} onclick={() => period = "Q"}>분기</button>
    <button class:active={period === "FY"} onclick={() => period = "FY"}>연간</button>
  </div>
  <button class="refresh" onclick={refresh} disabled={busy}>{busy ? "갱신 중…" : "지금 갱신"}</button>
</div>

{#if !payload}
  <p class="empty">재무 데이터를 불러오는 중…</p>
{:else if !rows.length && !estimates.length}
  <div class="empty">
    <p>아직 저장된 재무 데이터가 없습니다.</p>
    <p>‘지금 갱신’을 누르면 외부 소스에서 가져옵니다.</p>
  </div>
{:else}
  {#if metrics.length}
    <div class="metric-tabs" role="group" aria-label="차트 항목">
      {#each metrics.slice(0, 5) as m (m.key)}
        <button class:active={selected?.key === m.key} onclick={() => metric = m.key}>{m.label}</button>
      {/each}
    </div>
    <MiniLine points={series} label={(selected?.label || "재무") + " 추이"} color="var(--accent)" />
    <div class="axis num">{#each series as p (p.date)}<span>{periodName({ period_end: p.date, period_type: period })}</span>{/each}</div>
  {/if}

  {#if rows.length}
    <div class="table-wrap" role="region" aria-label={(period === "Q" ? "분기" : "연간") + " 재무표, 좌우로 스크롤 가능"}>
      <table>
        <thead><tr><th>항목</th>{#each rows as r (r.period_end)}<th class="num">{periodName(r)}<small>{sourceLabel(r.source)}</small></th>{/each}</tr></thead>
        <tbody>
          {#each metrics as m (m.key)}
            <tr><th>{m.label}</th>{#each rows as r (r.period_end)}<td class="num">{cell(m.key, r[m.key])}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if estimates.length}
    <div class="subhead"><h3>컨센서스</h3><span>최근 기준치</span></div>
    <div class="estimates">
      {#each estimates as e (e.id)}
        <div class="est-row">
          <div class="est-name"><strong>{estimateTitle(e)}</strong><span>{sourceLabel(e.source)} · {dateText(e.as_of)}</span></div>
          <dl>
            {#if Number.isFinite(e.target_price)}<div><dt>목표가</dt><dd class="num">{perShare(e.target_price)}</dd></div>{/if}
            {#if Number.isFinite(e.rating_mean)}<div><dt>의견 평균</dt><dd class="num">{rating(e)}</dd></div>{/if}
            {#if Number.isFinite(e.eps)}<div><dt>EPS</dt><dd class="num">{perShare(e.eps)}</dd></div>{/if}
            {#if Number.isFinite(e.revenue)}<div><dt>매출</dt><dd class="num">{money(e.revenue)}</dd></div>{/if}
            {#if Number.isFinite(e.n_analysts)}<div><dt>분석가</dt><dd class="num">{e.n_analysts}명</dd></div>{/if}
          </dl>
        </div>
      {/each}
    </div>
  {/if}

  <p class="stamp">{fetched ? "재무 " + dateText(fetched) + " 갱신" : "외부 데이터 기준"} · 비공식 소스는 제공처 사정에 따라 비어 있을 수 있습니다.</p>
{/if}

<style>
  .toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
  .period{display:inline-flex;padding:3px;background:var(--bg2);border-radius:10px}
  .period button{min-height:36px;padding:0 16px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--sub)}
  .period button.active{background:var(--bg);color:var(--ink);box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .refresh{min-height:36px;font-size:13px;color:var(--accent-ink);padding:0 4px}
  .refresh:disabled{opacity:.45}
  .metric-tabs{display:flex;gap:18px;overflow-x:auto;border-bottom:1px solid var(--line-soft);scrollbar-width:none}
  .metric-tabs::-webkit-scrollbar{display:none}
  .metric-tabs button{position:relative;flex:none;min-height:38px;font-size:13px;color:var(--sub)}
  .metric-tabs button.active{color:var(--ink);font-weight:650}
  .metric-tabs button.active:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--ink);border-radius:2px}
  .axis{display:flex;justify-content:space-between;font-size:10.5px;color:var(--sub2);margin-top:-2px}
  .table-wrap{overflow-x:auto;margin-top:18px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  table{width:100%;min-width:720px;border-collapse:collapse;font-size:12.5px;white-space:nowrap}
  th,td{text-align:right;padding:11px 14px;border-bottom:1px solid var(--line-soft)}
  thead th{color:var(--sub);font-weight:600;background:var(--bg)}
  thead th small{display:block;font-size:10px;font-weight:450;color:var(--sub2)}
  th:first-child{position:sticky;left:0;z-index:1;text-align:left;background:var(--bg);padding-left:0;box-shadow:8px 0 12px -12px rgba(0,0,0,.35)}
  tbody th{font-weight:580;color:var(--sub)}
  tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
  .subhead{display:flex;align-items:baseline;gap:9px;margin-top:26px;padding-bottom:7px;border-bottom:1px solid var(--line-soft)}
  .subhead h3{font-size:15px;font-weight:680}
  .subhead span{font-size:11.5px;color:var(--sub2)}
  .est-row{display:grid;grid-template-columns:minmax(110px,.7fr) minmax(0,2fr);gap:20px;padding:14px 0;border-bottom:1px solid var(--line-soft)}
  .est-row:last-child{border-bottom:0}
  .est-name strong{display:block;font-size:13.5px}
  .est-name span{display:block;font-size:11.5px;color:var(--sub2);margin-top:2px}
  .est-row dl{display:flex;justify-content:flex-end;gap:18px;flex-wrap:wrap}
  .est-row dl div{text-align:right}
  dt{font-size:10.5px;color:var(--sub2)}
  dd{font-size:13px;font-weight:600}
  .empty{font-size:13.5px;color:var(--sub2);padding:28px 0}
  .empty p+p{margin-top:3px}
  .stamp{font-size:11.5px;color:var(--sub2);margin-top:16px}
  @media (max-width:640px){
    .est-row{grid-template-columns:1fr;gap:8px}
    .est-row dl{justify-content:flex-start;gap:14px 22px}
    .est-row dl div{text-align:left}
    .toolbar{margin-bottom:10px}
  }
</style>
