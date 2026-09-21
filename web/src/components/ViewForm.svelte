<script>
  // 투자의견 기록·편집 시트 (SPEC §5.2.1). 필수: 목표가, 등급. 선택: 핵심 논리, 리스크, 목표 시점(기본 12개월).
  // 저장하면 서버가 지금 가격·상승여력을 얼린다. 편집은 스냅샷을 바꾸지 않고 '수정됨'이 붙는다.
  import { untrack } from "svelte";
  import Sheet from "./Sheet.svelte";
  import InfoTip from "./InfoTip.svelte";
  import SelectField from "./SelectField.svelte";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { data, loadViews, nativePrice, refreshQuotes } from "../lib/data.svelte.js";
  import { RATINGS, HORIZONS, ratingTone } from "../lib/ratings.js";
  import { VALUATION_METRICS, ttmSeries, baseValue, roundValue } from "../lib/calc/valuation.js";
  import { valueFmt, pctSigned, tone, parseNum, stamp } from "../lib/format.js";
  import { store } from "../lib/storage.js";
  import { todayKst } from "../lib/today.js";

  let open = $state(false);
  let edit = $state(null); // 편집 중인 view
  let sid = $state(null);
  let sec = $state(null);
  let f = $state(fresh());
  let busy = $state(false);
  let err = $state("");

  function fresh() {
    return { rating: "", target: "", horizon: 12, conclusion: "", thesis: "", risks: "", asOf: "" };
  }

  // 임시 저장 (기기에만). 시트를 실수로 닫아도 쓰던 내용이 남는다. 저장에 성공하면 지운다.
  const DRAFT_KEY = "invest.viewdraft";
  let restored = $state(false);

  const hasContent = () => Boolean(f.conclusion?.trim() || f.thesis?.trim() || f.risks?.trim() || f.target || f.rating);

  function saveDraft() {
    if (edit || !open) return;
    if (!hasContent()) return store.remove(DRAFT_KEY);
    try {
      store.set(DRAFT_KEY, JSON.stringify({ sid, f, useVal, val, backdate, at: new Date().toISOString() }));
    } catch { /* 저장 실패는 무시 */ }
  }

  function readDraft() {
    try {
      return JSON.parse(store.get(DRAFT_KEY, "") || "null");
    } catch {
      return null;
    }
  }

  function dropDraft() {
    store.remove(DRAFT_KEY);
    restored = false;
    f = fresh();
    useVal = false;
    backdate = false;
    val = { metric: "per", value: "", multiple: "" };
  }

  // 밸류에이션으로 목표가 만들기 (SPEC §5.2.7): 기준값 × 배수. 계산은 코드가 한다.
  // 폼에서는 주당 지표(PER·PBR·PSR)만 받는다. EV/EBITDA는 주식수·순부채가 필요해 밴드 화면 경로를 쓴다.
  const FORM_METRICS = VALUATION_METRICS.filter((m) => m.key !== "ev_ebitda");
  let useVal = $state(false);
  let val = $state({ metric: "per", value: "", multiple: "" });
  let fund = $state(null);
  let fundFor = $state(null);

  // 소급 기록 (SPEC §5.2.6): 앱을 쓰기 전에 했던 판단을 넣는다.
  // 그날 종가로 스냅샷을 복원한다. 성과 평가에도 같이 들어간다 (사용자 결정 2026-09-22).
  let backdate = $state(false);
  const maxDate = todayKst();

  // 고를 수 있는 종목: 보유 + 이미 의견이 있는 종목
  const choices = $derived.by(() => {
    const m = new Map();
    for (const p of data.positions) m.set(p.security_id, p.security);
    for (const v of data.views) if (!m.has(v.security_id)) m.set(v.security_id, { id: v.security_id, name: v.name, ticker: v.ticker, ysym: v.ysym, currency: v.currency, asset_class: "equity" });
    return [...m.entries()].map(([id, s]) => ({ id, ...s })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  });

  $effect(() => {
    const req = ui.viewForm;
    if (!req) return;
    untrack(() => {
      err = "";
      backdate = false;
      useVal = false;
      val = { metric: "per", value: "", multiple: "" };
      edit = req.edit || null;
      if (edit) {
        sid = edit.security_id;
        f = { rating: edit.rating, target: String(edit.target_price), horizon: edit.horizon_months, conclusion: edit.conclusion || "", thesis: edit.thesis || "", risks: edit.risks || "", asOf: "" };
        // 목표가 산출 방식이 남아 있으면 그대로 열어 둔다 (목표가만 고치고 근거가 어긋나는 걸 막는다)
        const a = edit.valuation;
        if (a && a.value > 0 && a.multiple > 0 && FORM_METRICS.some((m) => m.key === a.metric)) {
          val = { metric: a.metric, value: String(a.value), multiple: String(a.multiple) };
          useVal = true;
        }
      } else {
        sid = req.securityId ?? null;
        // 최신 의견이 있으면 그 내용을 출발점으로 (업데이트는 새 행)
        const prev = sid != null ? data.views.find((v) => v.security_id === sid) : null;
        f = prev
          ? { rating: prev.rating, target: String(prev.target_price), horizon: prev.horizon_months, conclusion: "", thesis: prev.thesis || "", risks: prev.risks || "", asOf: "" }
          : fresh();
        if (req.prefill) f = { ...f, ...req.prefill };
        // 쓰다 만 게 남아 있으면 되살린다 (같은 종목이거나, 종목을 안 고르고 쓰던 것)
        const d = readDraft();
        restored = false;
        if (d && d.f && (d.sid == null || sid == null || d.sid === sid)) {
          f = { ...fresh(), ...d.f };
          sid = d.sid ?? sid;
          useVal = Boolean(d.useVal);
          val = d.val || val;
          backdate = Boolean(d.backdate);
          restored = true;
        }
      }
      open = true;
    });
  });

  // 고른 종목 정보와 지금 가격
  $effect(() => {
    const id = sid;
    if (id == null) { sec = null; return; }
    untrack(async () => {
      const c = choices.find((x) => x.id === id);
      sec = c || (await api("/securities/" + id)).security;
      if (sec && !data.quotes[sec.ysym]) refreshQuotes([sec.ysym]);
    });
  });

  // 블록을 열면 재무를 한 번 받아 TTM 기준값을 제안한다 (있을 때만).
  $effect(() => {
    const id = sid;
    if (!useVal || id == null || fundFor === id) return;
    untrack(async () => {
      fundFor = id;
      fund = null;
      try {
        fund = await api("/fundamentals/" + id);
      } catch {
        fund = null;
      }
      const def = sec?.band_default;
      if (def && FORM_METRICS.some((m) => m.key === def)) val = { ...val, metric: def };
    });
  });

  const metric = $derived(FORM_METRICS.find((m) => m.key === val.metric) || FORM_METRICS[0]);

  /** 앱이 아는 TTM 기준값. 재무 통화가 다르거나 ADR이면 제안하지 않는다(밴드 화면과 같은 기준). */
  const ttmValue = $derived.by(() => {
    if (!fund || !sec) return null;
    const ready = fund.security?.valuation_ready ?? sec.valuation_ready;
    const srcCcy = fund.security?.financial_currency || sec.financial_currency;
    const adr = Number(fund.security?.adr_ratio ?? sec.adr_ratio ?? 1);
    if (ready === false || (srcCcy && sec.currency && srcCcy !== sec.currency) || adr !== 1) return null;
    const rows = (fund.financials || []).filter((r) => r.currency === sec.currency);
    const latest = ttmSeries(rows).at(-1);
    const v = latest ? baseValue(latest, val.metric) : null;
    return v > 0 ? { value: roundValue(v, val.metric), date: latest.date } : null;
  });

  const implied = $derived.by(() => {
    const v = parseNum(val.value);
    const m = parseNum(val.multiple);
    return useVal && v > 0 && m > 0 ? v * m : null;
  });

  // 기준값·배수를 만지면 목표가 칸을 채운다. 그 뒤 목표가를 직접 고치면 그 값이 남는다.
  $effect(() => {
    const t = implied;
    if (t == null) return;
    const rounded = sec?.currency === "KRW" ? Math.round(t) : Math.round(t * 100) / 100;
    untrack(() => { f.target = String(rounded); });
  });

  // 내용이 바뀔 때마다 임시 저장 (기기에만 남는다)
  $effect(() => {
    const snapshot = [f.rating, f.target, f.horizon, f.conclusion, f.thesis, f.risks, f.asOf, useVal, val.metric, val.value, val.multiple, sid, backdate];
    void snapshot;
    untrack(() => saveDraft());
  });

  const price = $derived(edit ? edit.price_at : sec ? nativePrice(sec.ysym) : null);
  const fmt = $derived(sec ? valueFmt({ ...sec, asset_class: sec.asset_class || "equity" }) : (v) => String(v));
  const target = $derived(parseNum(f.target));
  const upside = $derived(price > 0 && target > 0 ? (target / price - 1) * 100 : null);
  const previous = $derived(!edit && sid != null ? data.views.find((v) => v.security_id === sid) : null);
  const formTitle = $derived(edit ? "기록 편집" : previous ? "투자의견 업데이트" : "커버리지 개시");

  async function save() {
    if (sid == null) return (err = "종목을 고르세요");
    if (!f.rating) return (err = "등급을 고르세요");
    if (!(target > 0)) return (err = "목표가를 넣으세요");
    if (backdate && !f.asOf) return (err = "기록할 과거 날짜를 고르세요");
    busy = true;
    err = "";
    const body = { rating: f.rating, target_price: target, horizon_months: f.horizon, conclusion: f.conclusion, thesis: f.thesis, risks: f.risks };
    try {
      if (edit) {
        const valEdit = implied != null
          ? { valuation: { metric: val.metric, value: parseNum(val.value), multiple: parseNum(val.multiple), implied_target: implied } }
          : useVal ? { valuation: null } : {};
        await api("/views/" + edit.id, { method: "PATCH", body: { ...body, ...valEdit } });
        toast("의견을 수정했습니다");
      } else {
        const asOf = backdate && f.asOf ? { as_of: f.asOf } : {};
        const valuation = implied != null
          ? { valuation: { metric: val.metric, value: parseNum(val.value), multiple: parseNum(val.multiple), implied_target: implied } }
          : ui.viewForm?.valuation ? { valuation: ui.viewForm.valuation } : {};
        const r = await api("/views", { method: "POST", body: { security_id: sid, ...body, ...asOf, ...valuation } });
        toast(r.view.backdated
          ? (sec?.name || "") + " " + f.asOf + " 시점으로 기록했습니다 (그날 주가 " + fmt(r.view.price_at) + ")"
          : (sec?.name || "") + (previous ? " 투자의견을 업데이트했습니다" : " 커버리지를 개시했습니다"));
      }
      open = false;
      store.remove(DRAFT_KEY);
      restored = false;
      await loadViews();
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={formTitle} onclose={() => (ui.viewForm = null)} guardClose={() => !edit && hasContent()}>
  <div class="form">
    {#if restored}
      <p class="draft full">쓰다 만 내용을 불러왔습니다.
        <button class="btn sm" onclick={dropDraft}>지우고 새로 쓰기</button>
      </p>
    {/if}
    {#if edit}
      <p class="lead">{edit.name} · {stamp(edit.created_at)} 기록 · 분석 당시 주가 {fmt(edit.price_at)}는 그대로 두고 '수정됨'이 붙습니다.</p>
    {:else if ui.viewForm && ui.viewForm.securityId == null}
      <label class="full"><span>종목</span>
        <SelectField bind:value={sid} placeholder="종목을 선택해 주세요" ariaLabel="투자의견 종목"
          options={choices.map((c) => ({ value: c.id, label: c.name + " · " + c.ticker }))} />
        <em>다른 종목은 종목 화면에서 커버리지를 개시할 수 있습니다.</em>
      </label>
    {:else if sec}
      <p class="lead">{sec.name} · 현재가 {price != null ? fmt(price) : "시세 없음"}
        <InfoTip label="가격 기록 방식" text="저장하는 순간 앱이 확인한 지연 현재가를 '분석 당시 주가'로 고정합니다. 이후 가격이 바뀌어도 이 값은 바뀌지 않습니다." />
      </p>
    {/if}

    <fieldset class="full">
      <legend>등급</legend>
      <div class="ratings" role="radiogroup" aria-label="등급">
        {#each RATINGS as r (r.label)}
          <button role="radio" aria-checked={f.rating === r.label} class="rt {ratingTone(r.score)}" class:on={f.rating === r.label}
            onclick={() => (f.rating = r.label)}>{r.label}</button>
        {/each}
      </div>
    </fieldset>

    <label><span>목표가 ({sec?.currency === "USD" ? "달러" : "원"})</span>
      <input class="num" bind:value={f.target} inputmode="decimal" placeholder={price != null ? String(price) : ""} />
      {#if backdate}<em>상승여력은 저장할 때 그날 종가 기준으로 계산됩니다</em>
      {:else if upside != null}<em class="num {tone(upside * 1e6)}">{edit ? "분석 당시 대비" : "지금 대비"} {pctSigned(upside)}</em>{/if}
    </label>

    <fieldset>
      <legend>목표 시점</legend>
      <div class="seg" role="radiogroup" aria-label="목표 시점">
        {#each HORIZONS as h (h)}
          <button role="radio" aria-checked={f.horizon === h} class:on={f.horizon === h} onclick={() => (f.horizon = h)}>{h}개월</button>
        {/each}
      </div>
    </fieldset>

    <div class="full vblock">
        <label class="chk">
          <input type="checkbox" bind:checked={useVal} />
          <span>밸류에이션으로 목표가 계산</span>
          <InfoTip label="밸류에이션 계산" text="기준값 × 배수로 목표가를 만듭니다. 예: EPS 8.20 × PER 32 = 262.40. 계산한 값은 목표가 칸에 들어가고 직접 고칠 수도 있습니다. 어떤 가정이었는지는 기록에 남습니다." />
        </label>
        {#if useVal}
          <div class="vrow">
            <SelectField compact bind:value={val.metric} ariaLabel="밸류에이션 지표"
              options={FORM_METRICS.map((m) => ({ value: m.key, label: m.label }))} />
            <input class="num" bind:value={val.value} inputmode="decimal" aria-label={metric.valueLabel} placeholder={metric.valueLabel} />
            <span class="x" aria-hidden="true">×</span>
            <input class="num" bind:value={val.multiple} inputmode="decimal" aria-label="배수" placeholder="배수" />
          </div>
          <div class="vnote">
            {#if ttmValue}
              <button class="btn sm" onclick={() => (val = { ...val, value: String(ttmValue.value) })}>
                TTM {metric.valueLabel} {ttmValue.value.toLocaleString("ko-KR")} 쓰기
              </button>
              <em>{ttmValue.date} 기준 · 미래 추정치를 쓰려면 직접 넣으세요</em>
            {:else if fund}
              <em>이 종목은 TTM {metric.valueLabel}를 만들 수 없어 직접 넣어야 합니다.</em>
            {/if}
          </div>
          {#if implied != null}
            <p class="vres num">= {fmt(sec?.currency === "KRW" ? Math.round(implied) : Math.round(implied * 100) / 100)}</p>
          {/if}
        {/if}
    </div>

    {#if !edit}
      <div class="full back">
        <label class="chk">
          <input type="checkbox" bind:checked={backdate} />
          <span>과거 날짜로 기록</span>
          <InfoTip label="과거 날짜로 기록" text="앱을 쓰기 전에 했던 판단을 넣을 때 씁니다. 그날 종가·그 시점 컨센서스·PER로 스냅샷을 복원하며, 성과 평가에도 같이 들어갑니다." />
        </label>
        {#if backdate}
          <input type="date" bind:value={f.asOf} max={maxDate} aria-label="기록 날짜" />
          <em>그 종목의 시세가 있는 날짜만 됩니다.</em>
        {/if}
      </div>
    {/if}

    <label class="full"><span>결론</span>
      <textarea bind:value={f.conclusion} rows="5"
        placeholder="예: 2027E EPS 8.2달러에 PER 32배(과거 5년 중간값 28배 + 추론 수요 성장 프리미엄)를 적용해 목표주가 262달러, 현재가 대비 +25%로 매수 의견."></textarea>
    </label>

    <label class="full"><span>핵심 논리</span>
      <textarea bind:value={f.thesis} rows="6" placeholder="줄바꿈으로 나누면 불릿, 빈 줄로 나누면 문단으로 보입니다. 길게 써도 됩니다."></textarea>
    </label>
    <label class="full"><span>리스크</span>
      <textarea bind:value={f.risks} rows="4" placeholder="예: 고객사 자체 칩 전환"></textarea>
    </label>
  </div>
  {#if err}<p class="msg bad">{err}</p>{/if}

  {#snippet footer()}
    <div class="acts">
      <button class="btn" onclick={() => (open = false)}>취소</button>
      <button class="btn primary" onclick={save} disabled={busy}>{busy ? "저장 중…" : edit ? "수정" : previous ? "업데이트" : "커버리지 개시"}</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
  .full{grid-column:1/-1}
  .lead{grid-column:1/-1;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:14px;color:var(--sub);word-break:keep-all}
  label,fieldset{display:flex;flex-direction:column;gap:6px;min-width:0;border:none}
  label > span,legend{font-size:12.5px;color:var(--sub);margin-bottom:2px}
  em{font-style:normal;font-size:12.5px;color:var(--sub2)}
  em.up{color:var(--up)} em.down{color:var(--down)}
  input,textarea{border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px;width:100%;font-family:inherit;color:inherit}
  input{min-height:44px}
  textarea{resize:vertical;line-height:1.5}
  input:focus,textarea:focus{outline:none;border-color:var(--accent)}
  .ratings{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .rt{min-height:44px;border:1px solid var(--line);border-radius:12px;font-size:14px;font-weight:560}
  .rt.on.up{background:var(--up);border-color:var(--up);color:#fff}
  .rt.on.down{background:var(--down);border-color:var(--down);color:#fff}
  .rt.on.flat{background:var(--ink);border-color:var(--ink);color:var(--bg)}
  .rt:focus-visible,.seg button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .seg{display:flex;gap:4px;padding:3px;border-radius:12px;background:var(--bg2)}
  .seg button{flex:1;min-height:38px;border-radius:9px;font-size:13.5px;color:var(--sub)}
  .seg button.on{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .vblock,.back{display:flex;flex-direction:column;gap:8px}
  .vrow{display:grid;grid-template-columns:minmax(92px,1fr) minmax(0,1.2fr) auto minmax(0,1fr);gap:8px;align-items:center}
  .vrow .x{font-size:14px;color:var(--sub2);text-align:center}
  .vnote{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .vres{margin:0;font-size:15px;font-weight:620}
  .vblock .chk{flex-direction:row;align-items:center;gap:8px}
  .vblock .chk input{width:18px;height:18px;min-height:0;accent-color:var(--accent)}
  .vblock .chk span{font-size:13.5px;color:var(--sub)}
  .back .chk{flex-direction:row;align-items:center;gap:8px}
  .back .chk input{width:18px;height:18px;min-height:0;accent-color:var(--accent)}
  .back .chk span{font-size:13.5px;color:var(--sub)}
  .draft{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;font-size:13px;color:var(--sub2)}
  .msg{margin-top:10px}
  .acts{display:flex;justify-content:flex-end;gap:8px}
  @media (max-width:420px){ .form{grid-template-columns:minmax(0,1fr)} }
</style>
