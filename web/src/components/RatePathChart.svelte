<script>
  // 금리 경로 그래프 (SPEC §5.8): 미국 기준금리(계단) · 2년물(시장 기대 대용치) · 한국 기준금리(계단) · Fed 점도표 중간값(점선).
  // 연방기금 선물은 무료 소스가 없어 2년물로 대신한다. 스크러빙하면 그 날짜의 값들이 위에 나온다.
  import { onMount } from "svelte";
  import { createChart, LineSeries, ColorType, CrosshairMode, LineStyle, LineType } from "lightweight-charts";
  import { ratePath } from "../lib/calc/calendar.js";

  let { macro, height = 240 } = $props();

  let el = $state();
  let chart, sFed, sTwo, sBok, sDots;
  let hover = $state(null);
  const path = $derived(ratePath(macro));

  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function paint() {
    if (!chart) return;
    chart.applyOptions({ layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: css("--sub2"), fontFamily: css("--font") } });
    sFed.applyOptions({ color: css("--ink") });
    sTwo.applyOptions({ color: css("--sub2") });
    sBok.applyOptions({ color: css("--accent") });
    sDots.applyOptions({ color: css("--orange") });
  }

  function load() {
    if (!chart) return;
    sFed.setData(path.fed);
    sTwo.setData(path.two);
    sBok.setData(path.bok);
    sDots.setData(path.dots);
    chart.timeScale().fitContent();
    paint();
  }

  onMount(() => {
    chart = createChart(el, {
      autoSize: true, handleScroll: false, handleScale: false,
      grid: { vertLines: { visible: false }, horzLines: { color: css("--line-soft") } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
      localization: { locale: "ko-KR", priceFormatter: (v) => v.toFixed(2) + "%" },
    });
    const base = { priceLineVisible: false, crosshairMarkerRadius: 3 };
    sFed = chart.addSeries(LineSeries, { ...base, lineWidth: 2, lineType: LineType.WithSteps, title: "미국" });
    sTwo = chart.addSeries(LineSeries, { ...base, lineWidth: 1, title: "2년물" });
    sBok = chart.addSeries(LineSeries, { ...base, lineWidth: 2, lineType: LineType.WithSteps, title: "한국" });
    sDots = chart.addSeries(LineSeries, { ...base, lineWidth: 2, lineStyle: LineStyle.Dashed, pointMarkersVisible: true, title: "점도표" });
    chart.subscribeCrosshairMove((p) => {
      if (!p.time) return (hover = null);
      const g = (s) => p.seriesData.get(s)?.value;
      hover = { date: p.time, fed: g(sFed), two: g(sTwo), bok: g(sBok), dots: g(sDots) };
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", paint);
    const mo = new MutationObserver(paint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    load();
    return () => { mq.removeEventListener("change", paint); mo.disconnect(); chart.remove(); chart = null; };
  });

  $effect(() => { path; load(); });
  const f = (v) => (v == null ? "—" : v.toFixed(2) + "%");
</script>

<div class="readout num">
  {#if hover}
    <b>{hover.date}</b>
    {#if hover.fed != null}<span>미국 기준 {f(hover.fed)}</span>{/if}
    {#if hover.two != null}<span>미국 2년 {f(hover.two)}</span>{/if}
    {#if hover.bok != null}<span>한국 기준 {f(hover.bok)}</span>{/if}
    {#if hover.dots != null}<span>점도표 {f(hover.dots)}</span>{/if}
  {:else}
    <span class="legend"><i class="fed"></i>미국 기준금리</span>
    <span class="legend"><i class="two"></i>미국 2년물(시장 기대 대용)</span>
    <span class="legend"><i class="bok"></i>한국 기준금리</span>
    {#if path.dots.length}<span class="legend"><i class="dots"></i>점도표 중간값</span>{/if}
  {/if}
</div>
<div class="box" style:height="{height}px" bind:this={el} role="img" aria-label="금리 경로 그래프. 가로로 훑으면 날짜별 금리가 위에 나옵니다"></div>

<style>
  .readout{display:flex;gap:4px 14px;flex-wrap:wrap;align-items:baseline;min-height:22px;font-size:12.5px;color:var(--sub)}
  .readout b{color:var(--ink)}
  .legend{display:inline-flex;align-items:center;gap:5px}
  .legend i{width:16px;border-top:2px solid}
  .fed{border-color:var(--ink)}.two{border-color:var(--sub2);border-top-width:1px!important}.bok{border-color:var(--accent)}.dots{border-color:var(--orange);border-top-style:dashed!important}
  .box{touch-action:pan-y;margin-top:4px}
</style>
