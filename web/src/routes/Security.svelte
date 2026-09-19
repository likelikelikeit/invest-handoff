<script>
  // 종목 상세: 헤더, 개요, 재무(M5a), 내 의견, 내 보유, 종목 정보.
  // 밸류에이션은 M5b에서 붙는다 (SPEC §4.3).
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import Section from "../components/Section.svelte";
  import Logo from "../components/Logo.svelte";
  import Overview from "../components/Overview.svelte";
  import Fundamentals from "../components/Fundamentals.svelte";
  import MyViews from "../components/MyViews.svelte";
  import RatingChip from "../components/RatingChip.svelte";
  import { upsideNow } from "../lib/calc/views.js";
  import { data, load, refreshQuotes } from "../lib/data.svelte.js";
  import { api } from "../lib/api.js";
  import { ui, askChanges, toast } from "../lib/ui.svelte.js";
  import { holdingFromPosition } from "../lib/calc/portfolio.js";
  import { assignColors, SECTOR_NAMES } from "../lib/calc/colors.js";
  import { won, wonSigned, pctSigned, qtyStr, tone, parseNum, stamp, valueFmt } from "../lib/format.js";

  let { id } = $props();

  let sec = $state(null);
  let err = $state("");
  let qty = $state("");
  let avg = $state("");
  let busy = $state(false);
  let fundamentals = $state(null);
  let fundErr = $state("");

  const pos = $derived(data.positions.find((p) => p.security_id === id));
  const q = $derived(sec ? data.quotes[sec.ysym] : null);
  const h = $derived(pos ? holdingFromPosition(pos, q, data.fx) : null);
  const color = $derived.by(() => {
    if (!h) return sec?.brand_color || "var(--sub2)";
    const all = data.positions.map((p) => holdingFromPosition(p, data.quotes[p.security.ysym], data.fx))
      .sort((a, b) => b.qty * b.price - a.qty * a.price);
    return assignColors(all).get(id);
  });
  const day = $derived(q && q.prevClose ? (q.price / q.prevClose - 1) * 100 : null);
  // 현재 의견 = 최신 행 (SPEC §4.3 헤더: 내 목표가 · 상승여력 · 현재 등급)
  const view = $derived(data.views.find((v) => v.security_id === id));
  const up = $derived(view && q ? upsideNow(view, q.price) : null);

  async function fetchSec() {
    err = "";
    try {
      sec = (await api("/securities/" + id)).security;
      if (!data.quotes[sec.ysym]) refreshQuotes([sec.ysym]);
    } catch (e) {
      err = e.message;
    }
  }
  async function fetchFundamentals() {
    fundErr = "";
    try { fundamentals = await api("/fundamentals/" + id); }
    catch (e) { fundErr = e.message; fundamentals = null; }
  }
  $effect(() => { if (data.loaded && id) { fetchSec(); fetchFundamentals(); } });
  $effect(() => {
    if (h) {
      qty = qtyStr(h.qty);
      avg = Math.round(h.avg).toLocaleString("ko-KR");
    }
  });

  async function savePos() {
    busy = true;
    try {
      const r = await api("/portfolio/positions/" + id, { method: "PUT", body: { qty: parseNum(qty), avg_price: parseNum(avg), avg_ccy: "KRW", source: "manual" } });
      await load();
      toast("보유를 수정했습니다");
      askChanges(r.changes);
    } catch (e) {
      toast("실패: " + e.message);
    } finally {
      busy = false;
    }
  }

  async function clearPos() {
    if (!confirm(sec.name + " 보유를 정리할까요? (전량 매도 등) 종목과 기록은 남습니다.")) return;
    try {
      const r = await api("/portfolio/positions/" + id, { method: "DELETE" });
      await load();
      askChanges(r.changes);
    } catch (e) {
      toast("실패: " + e.message);
    }
  }

  async function patch(body) {
    try {
      sec = (await api("/securities/" + id, { method: "PATCH", body })).security;
      await load();
    } catch (e) {
      toast("실패: " + e.message);
    }
  }
</script>

<PageHead title="">
  <button class="btn sm" onclick={() => history.length > 1 ? history.back() : (location.hash = "#/securities")}>‹ 뒤로</button>
</PageHead>

<Gate>
  {#if err}
    <p class="msg bad">{err}</p>
  {:else if sec}
    <header class="sh">
      <Logo h={{ name: sec.name, tick: sec.ticker, mkt: sec.market, isin: sec.isin }} {color} size={48} />
      <div class="t">
        <h1>{sec.name}</h1>
        <p class="sub">{sec.ticker} · {sec.asset_class === "equity" ? (sec.market === "KR" ? "국내" : "해외") + " · " + (sec.sector || "기타") : sec.asset_class === "fx" ? "환율" : "지수"}</p>
      </div>
    </header>

    <div class="price">
      {#if q}
        <span class="p num">{valueFmt(sec)(q.price)}</span>
        {#if day != null}<span class="d num {tone(day * 100)}">{pctSigned(day)}</span>{/if}
        {#if sec.asset_class === "equity" && q.currency !== "KRW" && data.fx}<span class="k num">{won(q.price * data.fx)}</span>{/if}
        <span class="when num">{stamp(q.time)} 기준 · 지연</span>
      {:else}
        <span class="when">시세 데이터 없음</span>
      {/if}
    </div>

    {#if sec.asset_class === "equity"}
      <div class="mine-view">
        {#if view}
          <span class="mv num">내 목표 {valueFmt(sec)(view.target_price)}</span>
          {#if up != null}<span class="mv num {tone(up * 1e6)}">상승여력 {pctSigned(up * 100)}</span>{/if}
          <RatingChip rating={view.rating} score={view.rating_score} />
        {:else}
          <span class="mv flat">의견 없음</span>
        {/if}
        <button class="btn sm primary" onclick={() => (ui.viewForm = { securityId: id })}>새 의견 기록</button>
      </div>
    {/if}

    <Section id="sd-overview" title="개요">
      <Overview {id} fmt={valueFmt(sec)} quote={q} {fundamentals} {view} />
    </Section>

    {#if sec.asset_class === "equity"}
      <Section id="sd-financials" title="재무" note={fundamentals?.financials?.length ? "분기·연간" : "데이터 없음"}>
        {#if fundErr}<p class="msg bad">재무 데이터를 불러오지 못했습니다: {fundErr}</p>{/if}
        <Fundamentals {id} payload={fundamentals} onrefresh={fetchFundamentals} />
      </Section>

      <Section id="sd-views" title="내 의견" note={view ? "최근 " + stamp(view.created_at) : ""}>
        <MyViews {id} fmt={valueFmt(sec)} />
      </Section>
    {/if}

    {#if h}
      <Section id="sd-mine" title="내 보유">
        <dl class="mine">
          <div><dt>수량</dt><dd class="num">{qtyStr(h.qty)}주</dd></div>
          <div><dt>평단</dt><dd class="num">{won(h.avg)}</dd></div>
          <div><dt>평가액</dt><dd class="num">{won(h.qty * h.price)}</dd></div>
          <div><dt>평가손익</dt><dd class="num {tone((h.price - h.avg) * h.qty)}">{wonSigned((h.price - h.avg) * h.qty)} ({pctSigned(h.avg > 0 ? (h.price / h.avg - 1) * 100 : 0)})</dd></div>
        </dl>
        <div class="edit">
          <label><span>수량</span><input class="num" bind:value={qty} inputmode="decimal" /></label>
          <label><span>평단(원)</span><input class="num" bind:value={avg} inputmode="numeric" /></label>
          <button class="btn primary" onclick={savePos} disabled={busy}>보유 수정</button>
        </div>
        <button class="btn sm link" onclick={clearPos}>보유 정리</button>
      </Section>
    {/if}

    <Section id="sd-meta" title="종목 정보" defaultOpen={false}>
      <div class="edit">
        <label><span>분류</span>
          <select value={sec.sector || "기타"} onchange={(e) => patch({ sector: e.currentTarget.value })}>
            {#each SECTOR_NAMES as k (k)}<option value={k}>{k}</option>{/each}
          </select>
        </label>
        <label><span>브랜드색</span>
          <input type="color" value={sec.brand_color || "#0071e3"} onchange={(e) => patch({ brand_color: e.currentTarget.value })} />
        </label>
        {#if sec.market === "KR"}
          <label><span>DART 고유번호</span>
            <input inputmode="numeric" maxlength="8" placeholder="8자리" value={sec.dart_corp_code || ""} onchange={(e) => patch({ dart_corp_code: e.currentTarget.value || null })} />
          </label>
        {/if}
        {#if sec.brand_color}<button class="btn sm" onclick={() => patch({ brand_color: null })}>섹터색으로</button>{/if}
      </div>
      <p class="hint">야후 심볼 {sec.ysym}</p>
    </Section>
    <p class="later">밸류에이션은 다음 마일스톤에서 붙습니다.</p>
  {/if}
</Gate>

<style>
  .sh{display:flex;align-items:center;gap:14px;margin-top:-10px}
  h1{font-size:clamp(22px,3vw,28px);font-weight:720;letter-spacing:-.025em;line-height:1.2}
  .sub{font-size:13px;color:var(--sub2)}
  .price{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:14px 0 8px}
  .mine-view{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 0 16px}
  .mv{font-size:14px;font-weight:600}
  .mine-view .btn{margin-left:auto}
  .p{font-size:clamp(28px,6vw,36px);font-weight:700;letter-spacing:-.03em}
  .d{font-size:16px;font-weight:600}
  .k{font-size:14px;color:var(--sub)}
  .when{font-size:12.5px;color:var(--sub2);flex-basis:100%}
  .mine{display:grid;grid-template-columns:1fr 1fr;gap:6px 22px}
  .mine div{padding:6px 0}
  .mine dt{font-size:12.5px;color:var(--sub2)}
  .mine dd{font-size:16px;font-weight:620}
  .edit{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:14px}
  .edit label{display:flex;flex-direction:column;gap:5px;flex:1;min-width:120px}
  .edit span{font-size:12.5px;color:var(--sub)}
  .edit input,.edit select{min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px;width:100%}
  .edit input[type=color]{padding:4px;height:44px}
  .edit input:focus,.edit select:focus{outline:none;border-color:var(--accent)}
  .link{margin-top:12px;color:var(--red)}
  .hint{font-size:12.5px;color:var(--sub2);margin-top:10px}
  .later{font-size:13px;color:var(--sub2);padding:24px 0;border-top:1px solid var(--line-soft)}
  @media (min-width:900px){ .mine{grid-template-columns:repeat(4,1fr)} }
</style>
