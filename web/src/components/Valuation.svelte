<script>
  import ValuationChart from "./ValuationChart.svelte";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { valueFmt, pctSigned, tone } from "../lib/format.js";
  import {
    VALUATION_METRICS, ttmSeries, baseValue, dailyMultiples, suggestedMultiples,
    valueFromGrowth, growthFromValue, scenarioTarget, latestConsensusValue, roundValue,
  } from "../lib/calc/valuation.js";

  let {
    id, sec, payload, quote = null, initialPrices = null, initialScenarios = null,
    metric = $bindable("per"),
  } = $props();
  let prices = $state([]);
  let scenarios = $state([]);
  let mode = $state("bands");
  let range = $state("3y");
  let bands = $state({});
  let activeScenario = $state("base");
  let drafts = $state({});
  let busy = $state(false);
  let error = $state("");
  let seeded = false;

  const valuationBlock = $derived.by(() => {
    const readiness = payload?.security?.valuation_ready ?? sec?.valuation_ready;
    if (readiness === true) return null;
    const sourceCurrency = payload?.security?.financial_currency || sec?.financial_currency;
    const quoteCurrency = sec?.currency;
    const adrRatio = Number(payload?.security?.adr_ratio ?? sec?.adr_ratio ?? 1);
    if (readiness === false || (sourceCurrency && quoteCurrency && sourceCurrency !== quoteCurrency) || adrRatio !== 1) {
      return {
        sourceCurrency: sourceCurrency || "원천 통화",
        quoteCurrency: quoteCurrency || "표시 통화",
        adrRatio,
      };
    }
    return null;
  });
  const normalizedFinancials = $derived((payload?.financials || []).filter((row) => row.currency === sec?.currency));
  const ttm = $derived(ttmSeries(valuationBlock ? [] : normalizedFinancials));
  const latest = $derived(ttm.at(-1) || null);
  const allSeries = $derived(dailyMultiples(prices, ttm, metric));
  const availableMetrics = $derived(new Set(VALUATION_METRICS.filter((m) => baseValue(latest, m.key) > 0 && dailyMultiples(prices, ttm, m.key).length).map((m) => m.key)));
  const defaultBands = $derived(suggestedMultiples(allSeries).length === 5 ? suggestedMultiples(allSeries) : fallbackMultiples(allSeries));
  const multiples = $derived(normalizeMultiples(bands[metric] || defaultBands));
  // 선택 기간만큼 이력이 없으면 비활성 3년을 선택한 것처럼 보이지 않게 가용 이력 전체를 쓴다.
  const effectiveRange = $derived(hasYears(Number(range.slice(0, -1))) ? range : null);
  const shown = $derived(sliceYears(allSeries, effectiveRange));
  const consensusValue = $derived(latestConsensusValue(payload?.estimates || [], metric, latest));
  const currentDraft = $derived(draft(activeScenario));
  const baseDraft = $derived(draft("base"));
  const ownTarget = $derived(scenarioTarget(baseDraft));
  const priceFmt = $derived(valueFmt(sec));

  function cloneBands(value) {
    return Object.fromEntries(Object.entries(value || {}).map(([key, multiples]) => [
      key, Array.isArray(multiples) ? [...multiples] : multiples,
    ]));
  }

  function normalizeMultiples(a) {
    const out = (a || []).map(Number).filter((n) => n > 0).sort((x, y) => x - y).slice(0, 5);
    return out.length === 5 ? out : [5, 10, 15, 20, 25];
  }
  function fallbackMultiples(series) {
    const cur = series.at(-1)?.multiple;
    if (!(cur > 0)) return [5, 10, 15, 20, 25];
    const step = cur < 5 ? .5 : Math.max(1, Math.round(cur / 5));
    return [-2, -1, 0, 1, 2].map((x) => Math.max(step / 2, Math.round((cur + x * step) / step) * step));
  }
  function sliceYears(rows, key) {
    if (!rows.length) return [];
    if (!key) return rows;
    const years = Number(key.slice(0, -1));
    const end = Date.parse(rows.at(-1).date);
    const start = end - years * 365.25 * 86400000;
    return rows.filter((r) => Date.parse(r.date) >= start);
  }
  function hasYears(years) {
    if (allSeries.length < 2) return false;
    return Date.parse(allSeries.at(-1).date) - Date.parse(allSeries[0].date) >= years * 365.25 * .9 * 86400000;
  }
  function metricInfo(key = metric) { return VALUATION_METRICS.find((m) => m.key === key); }
  function saved(name) { return scenarios.find((s) => s.name === name && s.assumptions.metric === metric); }
  function initialDraft(name) {
    const existing = saved(name)?.assumptions;
    if (existing) return { ...existing };
    const current = baseValue(latest, metric);
    const growth = name === "bear" ? -10 : name === "bull" ? 25 : 10;
    const value = roundValue(name === "base" && consensusValue > 0 ? consensusValue : valueFromGrowth(current, growth, 1) || current || 0, metric);
    const multiple = multiples[name === "bear" ? 1 : name === "bull" ? 3 : 2] || 10;
    return {
      metric, value, multiple,
      growth_pct: growthFromValue(current, value, 1) ?? growth,
      horizon_years: 1,
      net_debt: latest?.net_debt ?? 0,
      shares: latest?.shares ?? null,
      fiscal_year: new Date().getFullYear() + 1,
    };
  }
  function draft(name) {
    const key = metric + ":" + name;
    return drafts[key] || initialDraft(name);
  }
  function setDraft(name, patch) {
    const key = metric + ":" + name;
    drafts[key] = { ...draft(name), ...patch };
  }
  function changeGrowth(v) {
    const growth = Number(v);
    setDraft(activeScenario, { growth_pct: growth, value: roundValue(valueFromGrowth(baseValue(latest, metric), growth, currentDraft.horizon_years), metric) });
  }
  function changeValue(v) {
    const value = Number(v);
    setDraft(activeScenario, { value, growth_pct: growthFromValue(baseValue(latest, metric), value, currentDraft.horizon_years) });
  }
  function changeYears(v) {
    const years = Number(v);
    setDraft(activeScenario, { horizon_years: years, value: roundValue(valueFromGrowth(baseValue(latest, metric), currentDraft.growth_pct, years), metric) });
  }
  function money(n) {
    if (!Number.isFinite(n)) return "—";
    if (metric === "ev_ebitda") return sec.currency === "USD"
      ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : Math.round(n).toLocaleString("ko-KR") + "원";
    return priceFmt(n);
  }

  async function loadValuation() {
    error = "";
    try {
      const [p, s] = await Promise.all([api("/prices/" + id + "?range=10y"), api("/scenarios?security_id=" + id)]);
      prices = p.rows || [];
      scenarios = s.scenarios || [];
    } catch (e) { error = e.message; }
  }
  $effect(() => {
    if (seeded || !sec) return;
    seeded = true;
    prices = initialPrices || [];
    scenarios = initialScenarios || [];
    metric = sec.band_default || "per";
    // sec는 Svelte의 deep proxy일 수 있어 structuredClone이 DataCloneError를 낸다.
    bands = cloneBands(sec.band_multiples);
    if (initialPrices == null && id) loadValuation();
  });
  $effect(() => {
    if (latest && !availableMetrics.has(metric)) {
      const first = VALUATION_METRICS.find((m) => availableMetrics.has(m.key));
      if (first) metric = first.key;
    }
  });

  async function saveBandSettings(next = bands) {
    try {
      const r = await api("/securities/" + id, { method: "PATCH", body: { band_default: metric, band_multiples: next } });
      bands = cloneBands(r.security.band_multiples || next);
      toast("밴드 설정을 저장했습니다");
    } catch (e) { toast("저장 실패: " + e.message); }
  }
  function recommend() {
    const rec = suggestedMultiples(allSeries);
    if (rec.length !== 5) return toast("추천할 멀티플 이력이 부족합니다");
    bands = { ...bands, [metric]: rec };
  }
  function editMultiple(i, value) {
    const next = [...multiples];
    next[i] = Number(value);
    bands = { ...bands, [metric]: next };
  }
  async function saveScenario() {
    const a = currentDraft;
    if (!(a.value > 0) || !(a.multiple > 0)) return toast("가정 값과 목표 배수를 확인하세요");
    busy = true;
    try {
      const r = await api("/scenarios", { method: "POST", body: { security_id: id, name: activeScenario, assumptions: a } });
      scenarios = [...scenarios.filter((s) => s.name !== activeScenario), r.scenario];
      toast(label(activeScenario) + " 시나리오를 저장했습니다");
    } catch (e) { toast("저장 실패: " + e.message); }
    finally { busy = false; }
  }
  async function removeScenario() {
    const s = saved(activeScenario);
    if (!s) return;
    try {
      await api("/scenarios/" + s.id, { method: "DELETE" });
      scenarios = scenarios.filter((x) => x.id !== s.id);
      const next = { ...drafts };
      delete next[metric + ":" + activeScenario];
      drafts = next;
      toast(label(activeScenario) + " 시나리오를 비웠습니다");
    } catch (e) { toast("삭제 실패: " + e.message); }
  }
  function openView() {
    const target = scenarioTarget(baseDraft);
    if (!(target > 0)) return toast("base 가정을 먼저 확인하세요");
    const scenario = saved("base");
    ui.viewForm = {
      securityId: id,
      prefill: { target: String(Math.round(target * (sec.currency === "KRW" ? 1 : 100)) / (sec.currency === "KRW" ? 1 : 100)) },
      valuation: {
        metric, multiple: baseDraft.multiple, value: baseDraft.value,
        growth_pct: baseDraft.growth_pct, horizon_years: baseDraft.horizon_years,
        scenario_id: scenario?.id || null,
      },
    };
  }
  const label = (name) => ({ bear: "약세", base: "기준", bull: "강세" })[name];
</script>

{#if error}<p class="msg bad">밸류에이션을 불러오지 못했습니다: {error}</p>{/if}

{#if valuationBlock}
  <div class="valuation-block" role="status">
    <strong>통화·주식 단위 환산이 필요합니다</strong>
    <p>재무는 {valuationBlock.sourceCurrency}, 주가는 {valuationBlock.quoteCurrency} 기준입니다.{valuationBlock.adrRatio !== 1 ? ` ADR 1주는 보통주 ${valuationBlock.adrRatio}주를 나타냅니다.` : ""}</p>
    <p>시점별 환율과 ADR 비율을 함께 반영하기 전까지 잘못된 배수와 기본 가정을 표시하지 않습니다.</p>
  </div>
{:else}
<div class="topbar">
  <div class="metrics" role="radiogroup" aria-label="밸류에이션 지표">
    {#each VALUATION_METRICS as m (m.key)}
      <button role="radio" aria-checked={metric === m.key} class:active={metric === m.key}
        disabled={!availableMetrics.has(m.key)} onclick={() => metric = m.key}>{m.label}</button>
    {/each}
  </div>
  <div class="modes" role="radiogroup" aria-label="밴드 형태">
    <button role="radio" aria-checked={mode === "bands"} class:active={mode === "bands"} onclick={() => mode = "bands"}>주가 밴드</button>
    <button role="radio" aria-checked={mode === "multiple"} class:active={mode === "multiple"} onclick={() => mode = "multiple"}>멀티플 분위</button>
  </div>
</div>

<ValuationChart series={shown} {metric} {multiples} {mode} mine={baseDraft}
  {consensusValue} fmt={priceFmt} valueFmt={money} horizonYears={baseDraft?.horizon_years || 1} />

<div class="range-settings">
  {#if hasYears(3)}
    <div class="ranges" role="radiogroup" aria-label="밸류에이션 기간">
      {#each [[3,"3년"],[5,"5년"],[10,"10년"]] as r (r[0])}
        <button role="radio" aria-checked={effectiveRange === r[0] + "y"} class:active={effectiveRange === r[0] + "y"}
          disabled={!hasYears(r[0])} onclick={() => range = r[0] + "y"}>{r[1]}</button>
      {/each}
    </div>
  {:else if allSeries.length}
    <span class="available">가용 이력 전체</span>
  {/if}
  <span>{allSeries.length ? `${shown[0].date}부터 ${shown.length.toLocaleString("ko-KR")}일` : "계산 가능한 이력 없음"}</span>
</div>

{#if allSeries.length}
  <div class="band-editor">
    <div class="band-head"><strong>고정 배수</strong><span>10·25·50·75·90 분위 기반</span></div>
    <div class="band-inputs">
      {#each multiples as m, i (i)}
        <label><span>{i + 1}</span><input class="num" type="number" min="0.1" step="0.5" value={m} aria-label={`${i + 1}번째 배수`}
          onchange={(e) => editMultiple(i, e.currentTarget.value)} /><em>배</em></label>
      {/each}
    </div>
    <div class="band-actions">
      <button class="btn sm" onclick={recommend}>자동 추천</button>
      <button class="btn sm" onclick={() => saveBandSettings()}>배수 저장</button>
    </div>
  </div>
{/if}

<div class="scenario-head">
  <div><h3>내 가정</h3><p>값과 성장률은 서로 따라 움직입니다.</p></div>
  <div class="scenario-tabs" role="radiogroup" aria-label="시나리오">
    {#each ["bear","base","bull"] as name (name)}
      <button role="radio" aria-checked={activeScenario === name} class:active={activeScenario === name}
        onclick={() => activeScenario = name}>{label(name)}{saved(name) ? " ·" : ""}</button>
    {/each}
  </div>
</div>

{#if latest && currentDraft}
  <div class="scenario-form">
    <label><span>{metricInfo()?.valueLabel} 직접 입력</span>
      <input class="num" type="number" min="0" step="any" value={currentDraft.value || ""} oninput={(e) => changeValue(e.currentTarget.value)} />
      <em>현재 TTM {money(baseValue(latest, metric))}</em>
    </label>
    <label><span>{metricInfo()?.growthLabel}</span>
      <input class="num" type="number" step="0.1" value={Number(currentDraft.growth_pct || 0).toFixed(1)} oninput={(e) => changeGrowth(e.currentTarget.value)} />
      <input type="range" min="-50" max="100" step="1" value={currentDraft.growth_pct || 0} aria-label={metricInfo()?.growthLabel}
        oninput={(e) => changeGrowth(e.currentTarget.value)} />
    </label>
    <label><span>목표 배수</span>
      <input class="num" type="number" min="0.1" max="200" step="0.5" value={currentDraft.multiple} oninput={(e) => setDraft(activeScenario, { multiple: Number(e.currentTarget.value) })} />
      <input type="range" min="0.5" max="100" step="0.5" value={currentDraft.multiple} aria-label="목표 배수"
        oninput={(e) => setDraft(activeScenario, { multiple: Number(e.currentTarget.value) })} />
    </label>
    <fieldset><legend>목표 시점</legend><div class="years">
      {#each [1,2] as y (y)}<button class:active={currentDraft.horizon_years === y} onclick={() => changeYears(y)}>{y}년</button>{/each}
    </div></fieldset>
  </div>
  <div class="target-line">
    <span>{label(activeScenario)} 적정가</span>
    <strong class="num">{priceFmt(scenarioTarget(currentDraft))}</strong>
    {#if quote?.price && scenarioTarget(currentDraft)}{@const up = (scenarioTarget(currentDraft) / quote.price - 1) * 100}<em class="num {tone(up * 1e6)}">현재가 대비 {pctSigned(up)}</em>{/if}
  </div>
  <div class="scenario-actions">
    {#if saved(activeScenario)}<button class="btn sm" onclick={removeScenario}>비우기</button>{/if}
    <button class="btn sm" onclick={saveScenario} disabled={busy}>{busy ? "저장 중…" : label(activeScenario) + " 저장"}</button>
    {#if activeScenario === "base"}<button class="btn primary" onclick={openView}>이 가정으로 의견 기록</button>{/if}
  </div>
{:else}
  <p class="empty">시나리오를 만들 TTM 재무가 부족합니다.</p>
{/if}
{/if}

<style>
  .valuation-block{padding:18px 0 24px;border-bottom:1px solid var(--line-soft)}
  .valuation-block strong{display:block;font-size:14px;color:var(--ink)}
  .valuation-block p{margin-top:6px;font-size:12.5px;line-height:1.55;color:var(--sub);word-break:keep-all}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
  .metrics{display:flex;gap:18px;overflow-x:auto;scrollbar-width:none}.metrics::-webkit-scrollbar{display:none}
  .metrics button{position:relative;flex:none;min-height:38px;font-size:13px;color:var(--sub)}
  .metrics button.active{color:var(--ink);font-weight:680}.metrics button.active:after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--ink)}
  .metrics button:disabled{opacity:.3;cursor:default}
  .modes,.ranges,.scenario-tabs,.years{display:inline-flex;padding:3px;background:var(--bg2);border-radius:10px}
  .modes button,.ranges button,.scenario-tabs button,.years button{min-height:34px;padding:0 11px;border-radius:8px;font-size:12.5px;color:var(--sub);white-space:nowrap}
  .modes button.active,.ranges button.active,.scenario-tabs button.active,.years button.active{background:var(--bg);color:var(--ink);font-weight:650;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .ranges button:disabled{opacity:.3;cursor:default}
  .range-settings{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px}.range-settings>span{font-size:11.5px;color:var(--sub2)}
  .range-settings .available{padding:8px 11px;border-radius:8px;background:var(--bg2);color:var(--sub);font-weight:600}
  .band-editor{margin-top:20px;padding-top:16px;border-top:1px solid var(--line-soft)}
  .band-head{display:flex;align-items:baseline;gap:9px}.band-head strong{font-size:14px}.band-head span{font-size:11.5px;color:var(--sub2)}
  .band-inputs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:9px}
  .band-inputs label{display:flex;align-items:center;border-bottom:1px solid var(--line);padding:5px 0}.band-inputs span{font-size:10px;color:var(--sub2)}
  .band-inputs input{width:100%;min-width:0;border:0;background:transparent;text-align:right;font-size:15px}.band-inputs em{font-size:11px;color:var(--sub2);font-style:normal}
  .band-actions,.scenario-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
  .scenario-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-top:28px;padding-top:20px;border-top:1px solid var(--line)}
  .scenario-head h3{font-size:16px}.scenario-head p{font-size:11.5px;color:var(--sub2)}
  .scenario-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}
  .scenario-form label,.scenario-form fieldset{display:flex;flex-direction:column;gap:5px;border:0;min-width:0}
  .scenario-form label>span,.scenario-form legend{font-size:12px;color:var(--sub)}
  .scenario-form input[type=number]{width:100%;min-height:42px;border:1px solid var(--line);background:var(--bg);border-radius:11px;padding:7px 10px;font-size:15px}
  .scenario-form input[type=range]{width:100%;accent-color:var(--accent)}.scenario-form em{font-style:normal;font-size:10.5px;color:var(--sub2)}
  .target-line{display:flex;align-items:baseline;gap:10px;margin-top:18px;padding:12px 0;border-top:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft)}
  .target-line span{font-size:12.5px;color:var(--sub)}.target-line strong{font-size:22px}.target-line em{font-size:12px;color:var(--sub2);font-style:normal}.target-line em.up{color:var(--up)}.target-line em.down{color:var(--down)}
  .empty{padding:24px 0;font-size:13px;color:var(--sub2)}
  button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  @media (max-width:680px){
    .topbar{align-items:flex-start}.modes{width:100%}.modes button{flex:1}
    .range-settings{align-items:flex-start;flex-direction:column}.scenario-head{align-items:flex-start;flex-direction:column}.scenario-tabs{width:100%}.scenario-tabs button{flex:1}
    .scenario-form{grid-template-columns:1fr 1fr}.band-inputs{gap:5px}.band-inputs input{font-size:13px}.scenario-actions{flex-wrap:wrap}.scenario-actions .primary{flex-basis:100%}
  }
</style>
