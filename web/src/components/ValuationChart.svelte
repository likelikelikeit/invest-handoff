<script>
  import { onMount } from "svelte";
  import { bandPrice, quantile, scenarioTarget, VALUATION_METRICS } from "../lib/calc/valuation.js";

  let {
    series = [], metric = "per", multiples = [], mode = "bands", mine = null,
    consensusValue = null, fmt = (n) => String(n), valueFmt = (n) => String(n), horizonYears = 1,
  } = $props();

  let el = $state();
  let chart, mainSeries;
  let AreaSeries, LineSeries, ColorType, CrosshairMode, LineStyle;
  let extras = [];
  let hover = $state(null);
  const metricInfo = $derived(VALUATION_METRICS.find((m) => m.key === metric));
  const qs = $derived([.1, .25, .5, .75, .9].map((p) => quantile(series.map((x) => x.multiple), p)));
  const display = $derived(hover || series.at(-1));
  const near = $derived(nearestBand(display));

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function add(type, options) {
    const s = chart.addSeries(type, options);
    extras.push(s);
    return s;
  }
  function addYears(date, years) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + Math.round(years * 12));
    return d.toISOString().slice(0, 10);
  }
  function removeSeries() {
    for (const s of extras) chart.removeSeries(s);
    extras = [];
    mainSeries = null;
  }
  function forecast(multiple, kind) {
    if (!series.length) return [];
    const last = series.at(-1);
    const start = bandPrice(last.ttm, metric, multiple);
    const assumption = kind === "mine" ? mine : { metric, value: consensusValue, shares: mine?.shares, net_debt: mine?.net_debt };
    const target = assumption ? scenarioTarget({ ...assumption, multiple }) : null;
    if (!Number.isFinite(start) || !Number.isFinite(target)) return [];
    return [{ time: last.date, value: start }, { time: addYears(last.date, horizonYears), value: target }];
  }
  function paint() {
    if (!chart) return;
    chart.applyOptions({ layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: css("--sub2"), fontFamily: css("--font") }, crosshair: { vertLine: { color: css("--line") } } });
  }
  function rebuild() {
    if (!chart) return;
    removeSeries();
    hover = null;
    if (!series.length) return;
    const palette = [css("--down"), css("--sub2"), css("--ink"), css("--orange"), css("--up")];
    if (mode === "bands") {
      mainSeries = add(AreaSeries, {
        lineColor: css("--ink"), topColor: css("--ink") + "18", bottomColor: css("--ink") + "00",
        lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4,
      });
      mainSeries.setData(series.map((d) => ({ time: d.date, value: d.price })));
      multiples.forEach((m, i) => {
        const historical = add(LineSeries, { color: palette[i], lineWidth: 1, priceLineVisible: false, lastValueVisible: i === 0 || i === multiples.length - 1, crosshairMarkerVisible: false, title: (i === 0 || i === multiples.length - 1) ? m + "배" : "" });
        historical.setData(series.map((d) => ({ time: d.date, value: bandPrice(d.ttm, metric, m) })).filter((d) => Number.isFinite(d.value)));
        const mineData = forecast(m, "mine");
        if (mineData.length) {
          const own = add(LineSeries, { color: palette[i], lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          own.setData(mineData);
        }
        const consensusData = forecast(m, "consensus");
        if (consensusData.length) {
          const cons = add(LineSeries, { color: palette[i], lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          cons.setData(consensusData);
        }
      });
    } else {
      mainSeries = add(LineSeries, { color: css("--accent"), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4 });
      mainSeries.setData(series.map((d) => ({ time: d.date, value: d.multiple })));
      const labels = ["10%", "25%", "중앙", "75%", "90%"];
      qs.forEach((q, i) => {
        if (!Number.isFinite(q)) return;
        const line = add(LineSeries, {
          color: i === 2 ? css("--ink") : (i === 1 || i === 3 ? css("--accent") : css("--sub2")),
          lineWidth: i === 2 ? 1.5 : 1, lineStyle: i === 2 ? LineStyle.Dashed : LineStyle.Dotted,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: labels[i],
        });
        line.setData([{ time: series[0].date, value: q }, { time: series.at(-1).date, value: q }]);
      });
    }
    chart.timeScale().fitContent();
    paint();
  }
  function nearestBand(d) {
    if (!d || !multiples.length) return null;
    const m = multiples.reduce((a, b) => Math.abs(b - d.multiple) < Math.abs(a - d.multiple) ? b : a);
    return { multiple: m, price: bandPrice(d.ttm, metric, m) };
  }

  onMount(() => {
    let disposed = false;
    let cleanup = () => {};
    import("lightweight-charts").then((lc) => {
      if (disposed) return;
      ({ AreaSeries, LineSeries, ColorType, CrosshairMode, LineStyle } = lc);
      chart = lc.createChart(el, {
      autoSize: true, handleScroll: false, handleScale: false,
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: .08, bottom: .08 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { width: 1, style: LineStyle.Solid, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
      localization: { locale: "ko-KR" },
    });
      chart.subscribeCrosshairMove((p) => {
        if (!p.time || !mainSeries || !p.seriesData.get(mainSeries)) return (hover = null);
        hover = series.find((d) => d.date === p.time) || null;
      });
      function scrubAt(clientX) {
        if (!mainSeries || !series.length) return;
        const x = clientX - el.getBoundingClientRect().left;
        const logical = chart.timeScale().coordinateToLogical(x);
        if (logical == null) return;
        const i = Math.max(0, Math.min(series.length - 1, Math.round(logical)));
        const d = series[i];
        chart.setCrosshairPosition(mode === "bands" ? d.price : d.multiple, d.date, mainSeries);
        hover = d;
      }
      const down = (e) => { if (e.pointerType === "touch") scrubAt(e.clientX); };
      const move = (e) => { if (e.pointerType === "touch") scrubAt(e.clientX); };
      const up = (e) => { if (e.pointerType === "touch") { chart.clearCrosshairPosition(); hover = null; } };
      el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
      const theme = () => rebuild();
      const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : { addEventListener() {}, removeEventListener() {} };
      mq.addEventListener("change", theme);
      const mo = new MutationObserver(theme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      rebuild();
      cleanup = () => {
        el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
        mq.removeEventListener("change", theme); mo.disconnect(); chart.remove(); chart = null;
      };
    });
    return () => { disposed = true; cleanup(); };
  });

  $effect(() => { series; metric; multiples; mode; mine; consensusValue; horizonYears; rebuild(); });
</script>

{#if !series.length}
  <div class="empty">TTM 멀티플을 계산할 재무·가격 이력이 부족합니다. 네 분기 재무가 쌓이면 밴드가 표시됩니다.</div>
{:else}
  <div class="readout num" aria-live="polite">
    <strong>{display?.date}</strong>
    <span>주가 {fmt(display?.price)}</span>
    <span>{metricInfo?.valueLabel} {valueFmt(display?.fundamental)}</span>
    <span>{metricInfo?.label} {display?.multiple.toFixed(1)}배</span>
    {#if near}<span>인접 {near.multiple}배 · {fmt(near.price)}</span>{/if}
  </div>
  <div class="box" bind:this={el} role="img"
    aria-label={mode === "bands" ? "주가와 고정 배수 밴드. 가로로 훑으면 날짜별 값을 표시합니다" : "멀티플 시계열과 분위수 선. 가로로 훑으면 날짜별 값을 표시합니다"}></div>
  <div class="legend">
    {#if mode === "bands"}
      <span><i class="solid"></i>과거</span>
      {#if mine}<span><i class="dash"></i>내 가정</span>{/if}
      {#if consensusValue}<span><i class="dot"></i>컨센서스</span>{/if}
      <span class="multiples num">{multiples.join(" · ")}배</span>
    {:else}
      <span>10·25·50·75·90 분위선</span><span>파란 선은 실제 멀티플</span>
    {/if}
  </div>
{/if}

<style>
  .readout{display:flex;gap:7px 14px;align-items:baseline;flex-wrap:wrap;min-height:46px;font-size:12px;color:var(--sub)}
  .readout strong{font-size:13px;color:var(--ink)}
  .box{height:280px;touch-action:pan-y}
  .legend{display:flex;gap:8px 15px;align-items:center;flex-wrap:wrap;font-size:11.5px;color:var(--sub2);margin-top:4px}
  .legend span{display:flex;align-items:center;gap:5px}.legend i{width:18px;border-top:1.5px solid var(--sub)}
  .legend .dash{border-top-style:dashed}.legend .dot{border-top-style:dotted}.multiples{margin-left:auto}
  .empty{padding:28px 0;font-size:13.5px;color:var(--sub2);word-break:keep-all}
  @media (min-width:900px){.box{height:340px}}
</style>
