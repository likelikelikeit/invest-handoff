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
  import { valueFmt, pctSigned, tone, parseNum, stamp } from "../lib/format.js";

  let open = $state(false);
  let edit = $state(null); // 편집 중인 view
  let sid = $state(null);
  let sec = $state(null);
  let f = $state(fresh());
  let busy = $state(false);
  let err = $state("");

  function fresh() {
    return { rating: "", target: "", horizon: 12, thesis: "", risks: "" };
  }

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
      edit = req.edit || null;
      if (edit) {
        sid = edit.security_id;
        f = { rating: edit.rating, target: String(edit.target_price), horizon: edit.horizon_months, thesis: edit.thesis || "", risks: edit.risks || "" };
      } else {
        sid = req.securityId ?? null;
        // 최신 의견이 있으면 그 내용을 출발점으로 (업데이트는 새 행)
        const prev = sid != null ? data.views.find((v) => v.security_id === sid) : null;
        f = prev ? { rating: prev.rating, target: String(prev.target_price), horizon: prev.horizon_months, thesis: prev.thesis || "", risks: prev.risks || "" } : fresh();
        if (req.prefill) f = { ...f, ...req.prefill };
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
    busy = true;
    err = "";
    const body = { rating: f.rating, target_price: target, horizon_months: f.horizon, thesis: f.thesis, risks: f.risks };
    try {
      if (edit) {
        await api("/views/" + edit.id, { method: "PATCH", body });
        toast("의견을 수정했습니다");
      } else {
        await api("/views", { method: "POST", body: { security_id: sid, ...body, ...(ui.viewForm?.valuation ? { valuation: ui.viewForm.valuation } : {}) } });
        toast((sec?.name || "") + (previous ? " 투자의견을 업데이트했습니다" : " 커버리지를 개시했습니다"));
      }
      open = false;
      await loadViews();
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={formTitle} onclose={() => (ui.viewForm = null)}>
  <div class="form">
    {#if edit}
      <p class="lead">{edit.name} · {stamp(edit.created_at)} 기록 · 기록 시점 가격 {fmt(edit.price_at)}은 그대로 두고 '수정됨'이 붙습니다.</p>
    {:else if ui.viewForm && ui.viewForm.securityId == null}
      <label class="full"><span>종목</span>
        <SelectField bind:value={sid} options={choices.map((c) => ({ value: c.id, label: c.name + " · " + c.ticker }))} ariaLabel="투자의견 종목" />
        <em>다른 종목은 종목 화면에서 커버리지를 개시할 수 있습니다.</em>
      </label>
    {:else if sec}
      <p class="lead">{sec.name} · 현재가 {price != null ? fmt(price) : "시세 없음"}
        <InfoTip label="가격 기록 방식" text="저장하는 순간 앱이 확인한 지연 현재가를 기록 시점 가격으로 고정합니다. 이후 가격이 바뀌어도 이 값은 바뀌지 않습니다." />
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
      {#if upside != null}<em class="num {tone(upside * 1e6)}">{edit ? "기록 시점 대비" : "지금 대비"} {pctSigned(upside)}</em>{/if}
    </label>

    <fieldset>
      <legend>목표 시점</legend>
      <div class="seg" role="radiogroup" aria-label="목표 시점">
        {#each HORIZONS as h (h)}
          <button role="radio" aria-checked={f.horizon === h} class:on={f.horizon === h} onclick={() => (f.horizon = h)}>{h}개월</button>
        {/each}
      </div>
    </fieldset>

    <label class="full"><span>핵심 논리 (한 줄에 하나)</span>
      <textarea bind:value={f.thesis} rows="4" placeholder="예: 데이터센터 수요가 2027년까지 이어짐"></textarea>
    </label>
    <label class="full"><span>리스크</span>
      <textarea bind:value={f.risks} rows="3" placeholder="예: 고객사 자체 칩 전환"></textarea>
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
  .msg{margin-top:10px}
  .acts{display:flex;justify-content:flex-end;gap:8px}
  @media (max-width:420px){ .form{grid-template-columns:minmax(0,1fr)} }
</style>
