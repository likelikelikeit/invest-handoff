<script>
  // 가격 차트 (SPEC §4.3 개요, §6.7): Lightweight Charts 영역 차트 + 거래량, 기간 토글, 스크러빙.
  // 스크러빙하면 위 숫자가 그 날짜의 종가·기간 대비 변화로 바뀐다. 손을 떼면 최신값으로 돌아간다.
  // 선 색은 기간 수익률 부호를 따른다 (상승 빨강 · 하락 파랑).
  import { onMount } from "svelte";
  import { createChart, AreaSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, LineStyle, LineType } from "lightweight-charts";
  import { RANGES, sliceRange, availableRanges, periodChange, targetLine } from "../lib/calc/chart.js";
  import { store } from "../lib/storage.js";
  import { pctSigned, tone } from "../lib/format.js";

  /** rows: [[date, o, h, l, c, v]], fmt: 가격 문자열 함수, targets: [{date, value}] 내 목표가 이력(계단선, 선택) */
  let { rows, fmt, stampText = "", targets = null } = $props();

  const KEY = "invest.chartRange";
  let range = $state(store.get(KEY, "1y"));
  let el = $state();
  let chart, area, vol, tgt;
  let hover = $state(null); // { date, close, idx }

  const avail = $derived(availableRanges(rows));
  // 기억한 기간이 이 종목엔 없으면(막 상장 등) 가능한 가장 긴 기간으로
  const eff = $derived(avail.has(range) ? range : ([...RANGES].reverse().find((r) => avail.has(r.key))?.key ?? "1m"));
  const shown = $derived(sliceRange(rows, eff));
  const chg = $derived(periodChange(shown));
  const last = $derived(shown.length ? shown[shown.length - 1] : null);
  const hChg = $derived(hover && shown.length ? { abs: hover.close - shown[0][4], pct: shown[0][4] ? (hover.close / shown[0][4] - 1) * 100 : 0 } : null);

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function paint() {
    if (!chart) return;
    const up = chg.abs >= 0;
    const line = css(up ? "--up" : "--down");
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: css("--sub2"), fontFamily: css("--font") },
      crosshair: { vertLine: { color: css("--line") } },
    });
    area.applyOptions({ lineColor: line, topColor: line + "38", bottomColor: line + "00" });
    vol.applyOptions({ color: css("--line") });
    if (tgt) tgt.applyOptions({ color: css("--ink") });
  }

  function load() {
    if (!chart) return;
    area.setData(shown.map((r) => ({ time: r[0], value: r[4] })));
    vol.setData(shown.filter((r) => r[5] != null).map((r) => ({ time: r[0], value: r[5] })));
    if (tgt) tgt.setData(targetLine(targets, shown));
    chart.timeScale().fitContent();
    paint();
  }

  onMount(() => {
    chart = createChart(el, {
      autoSize: true,
      handleScroll: false,
      handleScale: false,
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { width: 1, style: LineStyle.Solid, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      localization: { locale: "ko-KR" },
    });
    area = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 4 });
    vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    if (targets) {
      tgt = chart.addSeries(LineSeries, {
        lineWidth: 1.5, lineStyle: LineStyle.Dashed, lineType: LineType.WithSteps,
        // 현재 목표가는 차트 전체를 가로지르는 점선(의견이 하나뿐이어도 보이게), 변화는 계단선
        priceLineVisible: true, priceLineStyle: LineStyle.Dotted, priceLineWidth: 1,
        lastValueVisible: true, crosshairMarkerVisible: false, title: "목표",
      });
    }

    let lastTime = null;
    chart.subscribeCrosshairMove((p) => {
      const d = p.time && p.seriesData.get(area);
      if (!d) {
        hover = null;
        lastTime = null;
        return;
      }
      if (lastTime === null && navigator.vibrate) navigator.vibrate(4); // 햅틱: 있으면 (iOS Safari는 없음)
      lastTime = p.time;
      hover = { date: p.time, close: d.value };
    });

    // 터치 스크러빙: 라이브러리는 터치에서 길게 눌러야 십자선이 켜진다. 토스처럼 바로 훑이게
    // 가로 드래그를 직접 받아 십자선을 옮긴다. 세로 스크롤은 touch-action: pan-y로 페이지에 남긴다.
    function scrubAt(clientX) {
      const x = clientX - el.getBoundingClientRect().left;
      const logical = chart.timeScale().coordinateToLogical(x);
      if (logical == null || !shown.length) return;
      const i = Math.max(0, Math.min(shown.length - 1, Math.round(logical)));
      const r = shown[i];
      chart.setCrosshairPosition(r[4], r[0], area);
      if (!hover && navigator.vibrate) navigator.vibrate(4);
      hover = { date: r[0], close: r[4] };
    }
    const onDown = (e) => { if (e.pointerType === "touch") scrubAt(e.clientX); };
    const onMove = (e) => { if (e.pointerType === "touch") scrubAt(e.clientX); };
    const onUp = (e) => {
      if (e.pointerType !== "touch") return;
      chart.clearCrosshairPosition();
      hover = null;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    // 테마가 바뀌면 색을 다시 칠한다 (시스템 설정·토글 둘 다)
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => paint();
    mq.addEventListener("change", onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    load();
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      mq.removeEventListener("change", onTheme);
      mo.disconnect();
      chart.remove();
      chart = null;
    };
  });

  // 기간이나 데이터가 바뀌면 다시 그린다
  $effect(() => {
    shown;
    targets;
    load();
  });

  function pick(k) {
    range = k;
    store.set(KEY, k);
  }
</script>

<div class="pc">
  <div class="readout num" aria-live="polite">
    {#if hover}
      <span class="v">{fmt(hover.close)}</span>
      <span class="c {tone(hChg.abs * 1e6)}">{pctSigned(hChg.pct)}</span>
      <span class="d">{hover.date}</span>
    {:else if last}
      <span class="c {tone(chg.abs * 1e6)}">{RANGES.find((r) => r.key === eff).label} {pctSigned(chg.pct)}</span>
      <span class="d">{stampText}</span>
    {/if}
  </div>

  <div class="box" bind:this={el} role="img" aria-label="가격 차트. 가로로 훑으면 날짜별 종가가 위에 나옵니다"></div>

  <div class="ranges" role="radiogroup" aria-label="차트 기간">
    {#each RANGES as r (r.key)}
      <button role="radio" aria-checked={eff === r.key} class:on={eff === r.key}
        disabled={!avail.has(r.key)} onclick={() => pick(r.key)}>{r.label}</button>
    {/each}
  </div>
</div>

<style>
  .readout{display:flex;align-items:baseline;gap:10px;min-height:24px;font-size:14px}
  .v{font-size:16px;font-weight:650}
  .c{font-weight:600}
  .d{color:var(--sub2);font-size:12.5px}
  .box{height:260px;margin:6px -4px 0;touch-action:pan-y}
  .ranges{display:flex;justify-content:space-between;gap:4px;margin-top:8px}
  .ranges button{flex:1;min-height:36px;border-radius:9px;font-size:13px;font-weight:600;color:var(--sub)}
  .ranges button.on{background:var(--bg2);color:var(--ink)}
  .ranges button:disabled{color:var(--line);cursor:default}
  .ranges button:focus-visible{outline:2px solid var(--accent)}
  @media (min-width:900px){ .box{height:340px} .ranges{justify-content:flex-start} .ranges button{flex:none;padding:0 16px} }
</style>
