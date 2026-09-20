<script>
  // 자산 요약 (SPEC §4.2 블록 2): 총자산 큰 숫자, 도넛, 해외/국내 비중, 세로 종목 목록.
  import Donut from "./Donut.svelte";
  import Logo from "./Logo.svelte";
  import { won, wonSigned, pct, pctSigned, qtyDisplay, priceStr, tone } from "../lib/format.js";
  import { assignColors } from "../lib/calc/colors.js";
  import { slices as makeSlices } from "../lib/calc/portfolio.js";
  import { appearance } from "../lib/appearance.svelte.js";

  let { holdings, cash, showPrice = false } = $props();

  let hoverId = $state(null);

  const colors = $derived(assignColors(holdings));
  const stock = $derived(holdings.reduce((a, h) => a + h.qty * h.price, 0));
  const cost = $derived(holdings.reduce((a, h) => a + h.qty * h.avg, 0));
  const total = $derived(stock + cash.total);
  const pl = $derived(stock - cost);
  const foreign = $derived(holdings.filter((h) => h.mkt !== "KR").reduce((a, h) => a + h.qty * h.price, 0));
  const domestic = $derived(stock - foreign);
  const foreignPct = $derived(total > 0 ? (foreign / total) * 100 : 0);
  const domesticPct = $derived(total > 0 ? (domestic / total) * 100 : 0);
  const cashPct = $derived(total > 0 ? (cash.total / total) * 100 : 0);
  const cashSlices = $derived(cash.parts.map((p) => ({
    key: p.currency,
    label: p.currency === "USD" ? "달러 현금" : "원화 현금",
    value: p.krw,
    color: p.currency === "USD" ? "var(--cash-usd)" : "var(--cash-krw)",
  })));
  const sl = $derived(makeSlices(holdings, colors, cashSlices));
</script>

<div class="summary">
  <div class="top">
    <div class="lbl">총자산</div>
    <div class="total num">{won(total)}</div>
    <div class="pl num">
      평가손익 <span class={tone(pl)}>{wonSigned(pl)} ({pctSigned(cost > 0 ? (pl / cost) * 100 : 0)})</span>
    </div>

    <div class="split" class:labels={appearance.assetSplit === "labels"} aria-label="해외·국내·현금 비중">
      <div class="bar">
        <span style:width="{foreignPct}%" class="f"></span>
        <span style:width="{domesticPct}%" class="d"></span>
        <span style:width="{cashPct}%" class="c"></span>
      </div>
      {#if appearance.assetSplit === "labels"}
        <div class="split-labels num">
          <span class="lf" style:left="0%">해외<b>{pct(foreignPct)}</b></span>
          <span class="ld" style:left="{Math.min(foreignPct, 82)}%">국내<b>{pct(domesticPct)}</b></span>
          <span class="lc" style:left="{Math.min(foreignPct + domesticPct, 100)}%">현금<b>{pct(cashPct)}</b></span>
        </div>
      {:else}
        <div class="legend num">
          <span><i class="f"></i>해외 {pct(foreignPct)}</span>
          <span><i class="d"></i>국내 {pct(domesticPct)}</span>
          <span><i class="c"></i>현금 {pct(cashPct)}</span>
        </div>
      {/if}
    </div>
  </div>

  <div class="chart">
    <Donut slices={sl} bind:hoverId label="총자산" sub={holdings.length + "종목" + (cash.total > 0 ? " + 현금" : "")} />
  </div>

  <ul class="list">
    {#each holdings as h (h.id)}
      {@const v = h.qty * h.price}
      {@const hpl = (h.price - h.avg) * h.qty}
      <li class:dim={hoverId !== null && String(hoverId) !== String(h.id)}>
        <a href={"#/security/" + h.id} onmouseenter={() => (hoverId = h.id)} onmouseleave={() => (hoverId = null)}>
          <Logo {h} color={colors.get(h.id)} />
          <span class="nm">
            <span class="n1">{h.name}</span>
            <span class="n2 num">
              {#if showPrice}{priceStr(h)} · {/if}{qtyDisplay(h.qty)}주 · {pct(total > 0 ? (v / total) * 100 : 0)}
            </span>
          </span>
          <span class="val">
            <span class="v1 num">{won(v)}</span>
            {#if h.stale}
              <span class="v2 flat">시세 없음</span>
            {:else}
              <span class="v2 num {tone(hpl)}">{wonSigned(hpl)} ({pctSigned(h.avg > 0 ? (h.price / h.avg - 1) * 100 : 0)})</span>
            {/if}
          </span>
        </a>
      </li>
    {/each}
    {#each cash.parts as p (p.currency)}
      <li class="cashrow" class:dim={hoverId !== null && String(hoverId) !== "cash-" + p.currency}>
        <div class="row">
          <span class="swatch" style:background={p.currency === "USD" ? "var(--cash-usd)" : "var(--cash-krw)"}></span>
          <span class="nm">
            <span class="n1">{p.currency === "USD" ? "달러 현금" : "원화 현금"}</span>
            <span class="n2 num">{pct(total > 0 ? (p.krw / total) * 100 : 0)}</span>
          </span>
          <span class="val">
            <span class="v1 num">{won(p.krw)}</span>
            {#if p.currency === "USD"}<span class="v2 flat num">${p.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>{/if}
          </span>
        </div>
      </li>
    {/each}
  </ul>
</div>

<style>
  .summary{display:grid;grid-template-columns:minmax(0,1fr);gap:18px}
  .lbl{font-size:13px;color:var(--sub)}
  .total{font-size:clamp(32px,7vw,44px);font-weight:700;letter-spacing:-.035em;line-height:1.1;margin-top:2px}
  .pl{font-size:14px;color:var(--sub);margin-top:6px}
  .split{margin-top:18px}
  .bar{display:flex;height:6px;border-radius:99px;overflow:hidden;background:var(--track)}
  .bar span{display:block;height:100%}
  .f{background:#ff2d55}.d{background:#0071e3}.c{background:var(--cash-krw)}
  .legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:12.5px;color:var(--sub)}
  .legend i{display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:5px;vertical-align:1px}
  .split-labels{position:relative;height:42px;margin-top:8px;font-size:12px}
  .split-labels span{position:absolute;top:0;display:flex;flex-direction:column;line-height:1.35;white-space:nowrap}
  .split-labels span:last-child{transform:translateX(-100%);text-align:right}
  .split-labels b{font-size:14px;font-weight:680}
  .lf{color:#e83050}.ld{color:#1768e8}.lc{color:var(--sub2)}
  .chart{padding:6px 0}

  .list{list-style:none;grid-column:1/-1}
  .list li{border-bottom:1px solid var(--line-soft);transition:opacity .15s}
  .list li:last-child{border-bottom:none}
  .list li.dim{opacity:.4}
  .list a,.list .row{display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 0}
  .list a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
  .swatch{width:36px;height:36px;border-radius:50%;flex:none}
  .nm{flex:1;min-width:0;display:flex;flex-direction:column}
  .n1{font-size:15.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .n2{font-size:12.5px;color:var(--sub2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .val{display:flex;flex-direction:column;align-items:flex-end;flex:none}
  .v1{font-size:15px;font-weight:600;letter-spacing:-.01em}
  .v2{font-size:12.5px}

  /* 데스크톱 2열: 왼쪽 요약+목록, 오른쪽 도넛(스크롤해도 따라옴) */
  @media (min-width:900px){
    .summary{grid-template-columns:minmax(0,1fr) 320px;grid-template-areas:"top chart" "list chart";column-gap:56px;align-items:start}
    .top{grid-area:top}
    .list{grid-area:list}
    .chart{grid-area:chart;position:sticky;top:72px;padding-top:8px}
  }
</style>
