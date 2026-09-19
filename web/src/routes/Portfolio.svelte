<script>
  // 포트폴리오 탭 (SPEC §4.4). 보기 모드(실제 보유) / 시뮬 모드(연습장, 기존 시뮬레이터 이식).
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import Section from "../components/Section.svelte";
  import AssetSummary from "../components/AssetSummary.svelte";
  import QuoteStamp from "../components/QuoteStamp.svelte";
  import StatsBlock from "../components/StatsBlock.svelte";
  import SimRow from "../components/SimRow.svelte";
  import Donut from "../components/Donut.svelte";
  import Sheet from "../components/Sheet.svelte";
  import RiskSummary from "../components/RiskSummary.svelte";
  import { data, holdings, cash, load } from "../lib/data.svelte.js";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import * as S from "../lib/sim.svelte.js";
  import { computed, stats, orders, slices, riskMetrics, constraintWarnings } from "../lib/calc/portfolio.js";
  import { store } from "../lib/storage.js";
  import { assignColors } from "../lib/calc/colors.js";
  import { won, wonSigned, pctSigned, qtyStr, tone, parseNum, stamp } from "../lib/format.js";

  // ── 보기 모드 ──
  const real = $derived(holdings());
  const realCash = $derived(cash());
  const realState = $derived({ holdings: real, removed: [], deposit: realCash.total });
  const realStats = $derived(stats(realState, computed(realState)));
  let histories = $state({});
  let riskLoading = $state(false);
  let riskError = $state("");
  const riskKey = $derived(data.positions.map((p) => p.security_id).sort((a, b) => a - b).join(","));

  function readLimits() {
    try { return { singlePct: 25, sectorPct: 40, ...JSON.parse(store.get("invest.constraints", "{}")) }; }
    catch { return { singlePct: 25, sectorPct: 40 }; }
  }
  let limits = $state(readLimits());
  function saveLimits(next) {
    limits = next;
    store.set("invest.constraints", JSON.stringify(next));
  }

  async function loadRiskData() {
    riskLoading = true;
    riskError = "";
    try {
      const pairs = await Promise.all(real.map(async (h) => [h.id, (await api("/prices/" + h.id + "?range=1y")).rows]));
      histories = Object.fromEntries(pairs);
    } catch (e) {
      riskError = e.message;
    } finally { riskLoading = false; }
  }
  $effect(() => { if (data.loaded) { riskKey; loadRiskData(); } });

  async function saveExpected(id, value) {
    try {
      const out = await api("/securities/" + id, { method: "PATCH", body: { expected_return_pct: value } });
      const p = data.positions.find((x) => x.security_id === id);
      if (p) p.security = out.security;
      toast("기대수익률 가정을 저장했습니다");
    } catch (e) { toast("실패: " + e.message); }
  }

  const realRisk = $derived(riskMetrics(real, histories, realCash.total));
  const realWarnings = $derived(constraintWarnings(realState, computed(realState), limits));

  let cashKrw = $state("");
  let cashUsd = $state("");
  $effect(() => {
    const k = data.cash.find((c) => c.currency === "KRW");
    const u = data.cash.find((c) => c.currency === "USD");
    cashKrw = k ? Math.round(k.amount).toLocaleString("ko-KR") : "0";
    cashUsd = u ? String(u.amount) : "0";
  });
  async function saveCash(ccy, v) {
    try {
      await api("/cash/" + ccy, { method: "PUT", body: { amount: parseNum(v) } });
      await load();
      toast((ccy === "USD" ? "달러" : "원화") + " 현금을 저장했습니다");
    } catch (e) {
      toast("실패: " + e.message);
    }
  }

  // 저장한 시뮬
  let scenarios = $state([]);
  async function loadScenarios() {
    try { scenarios = (await api("/portfolio/scenarios")).scenarios; } catch { scenarios = []; }
  }
  $effect(() => { if (data.loaded) loadScenarios(); });
  async function delScenario(sc) {
    if (!confirm("'" + sc.name + "' 시뮬을 지울까요?")) return;
    await api("/portfolio/scenarios/" + sc.id, { method: "DELETE" });
    loadScenarios();
  }

  // ── 시뮬 모드 ──
  const st = $derived(S.sim.active ? S.resolvedState() : null);
  const c = $derived(st ? computed(st) : null);
  // 시작 평가액 순으로 고정한다. 지금 평가액 순이면 슬라이더를 끄는 중에 행이 손가락 밑에서 자리를 바꾼다.
  // 새로 담은 종목(baseQty 0)은 담은 순서대로 끝에.
  const simList = $derived(st ? st.holdings
    .map((h, i) => ({ h, i }))
    .sort((a, b) => b.h.baseQty * b.h.price - a.h.baseQty * a.h.price || a.i - b.i)
    .map((x) => x.h) : []);
  const simColors = $derived(assignColors(simList));
  const simSlices = $derived(st ? slices(st.holdings, simColors, c.cash > 0.5 ? [{ key: "cash", label: "현금", value: c.cash, color: "var(--cash-krw)" }] : []) : []);
  const ords = $derived(st ? orders(st) : null);
  const simStats = $derived(st ? stats(st, c) : null);
  const simRisk = $derived(st ? riskMetrics(st.holdings, histories, c.cash) : null);
  const simWarnings = $derived(st ? constraintWarnings(st, c, limits) : []);
  let hoverId = $state(null);

  function startSim() {
    S.start(real, realCash.total);
  }
  function cancelSim() {
    if (ords && ords.list.length && !confirm("시뮬을 버리고 보기 모드로 돌아갈까요? 저장하지 않은 변경은 사라집니다.")) return;
    S.stop();
  }
  function resetSim() {
    if (!confirm("지금 실제 보유에서 다시 시작합니다.")) return;
    S.start(real, realCash.total);
  }
  let saveOpen = $state(false);
  let saveName = $state("");
  let saving = $state(false);
  function askSave() {
    saveName = S.sim.name || stamp(new Date().toISOString()) + " 시뮬";
    saveOpen = true;
  }
  async function saveSim() {
    const name = saveName.trim();
    if (!name) return;
    saving = true;
    try {
      await S.saveScenario(name);
      S.sim.name = name;
      saveOpen = false;
      toast("'" + name + "' 저장했습니다");
      loadScenarios();
    } catch (e) {
      toast("실패: " + e.message);
    } finally {
      saving = false;
    }
  }
  function openSc(sc) {
    if (S.sim.active && !confirm("진행 중인 시뮬을 덮어씁니다.")) return;
    S.openScenario(sc);
    window.scrollTo(0, 0);
  }
</script>

<PageHead title="포트폴리오">
  {#if data.loaded}
    {#if S.sim.active}
      <button class="btn" onclick={cancelSim}>취소</button>
      <button class="btn primary" onclick={askSave}>저장</button>
    {:else}
      <button class="btn primary" onclick={startSim}>시뮬레이션</button>
    {/if}
  {/if}
</PageHead>

<Gate>
  <QuoteStamp />

  {#if !S.sim.active}
    <Section id="pf-assets" title="보유">
      <AssetSummary holdings={real} cash={realCash} showPrice />
      <div class="rowacts">
        <button class="btn" onclick={() => (ui.add = {})}>종목 추가</button>
        <button class="btn" onclick={() => (ui.importOpen = true)}>스크린샷 가져오기</button>
      </div>
    </Section>

    <Section id="pf-cash" title="현금" note="증권사 예수금">
      <div class="cashform">
        <label><span>원화</span><input class="num" bind:value={cashKrw} inputmode="numeric" onchange={() => saveCash("KRW", cashKrw)} /></label>
        <label><span>달러($)</span><input class="num" bind:value={cashUsd} inputmode="decimal" onchange={() => saveCash("USD", cashUsd)} /></label>
      </div>
    </Section>

    <Section id="pf-stats" title="비중">
      <StatsBlock st={realStats} />
    </Section>

    <Section id="pf-risk" title="위험과 제약" note="내 가정과 계산값">
      <RiskSummary holdings={real} risk={realRisk} loading={riskLoading} error={riskError} {limits} warnings={realWarnings}
        editable onExpected={saveExpected} onLimits={saveLimits} />
    </Section>

    <Section id="pf-scenarios" title="저장한 시뮬" note={scenarios.length ? scenarios.length + "개" : ""}>
      {#if scenarios.length}
        <ul class="sclist">
          {#each scenarios as sc (sc.id)}
            <li>
              <button class="scopen" onclick={() => openSc(sc)}>
                <span class="scn">{sc.name}</span>
                <span class="scd num">{stamp(sc.created_at)} · 종목 {(sc.weights.holdings || []).length}개</span>
              </button>
              <button class="btn sm" onclick={() => delScenario(sc)} aria-label="{sc.name} 지우기">지우기</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">시뮬레이션에서 저장하면 여기 쌓입니다. 지금 시세로 다시 열립니다.</p>
      {/if}
    </Section>
  {:else}
    <!-- 시뮬 모드 -->
    <p class="simbadge">시뮬레이션 중{S.sim.name ? " · " + S.sim.name : ""} · 실제 보유는 바뀌지 않습니다</p>

    <section class="hero">
      <div class="sum">
        <div class="lbl">총자산</div>
        <div class="total num">{won(c.total)}</div>
        <dl class="kpis">
          <div><dt>주식 평가액</dt><dd class="num">{won(c.stock)}</dd></div>
          <div><dt>현금</dt><dd class="num" class:neg={c.cash < -0.5}>{won(c.cash)}</dd></div>
          <div><dt>평가손익</dt><dd class="num"><span class={tone(c.pl)}>{wonSigned(c.pl)}</span><small>{pctSigned(c.plPct)}</small></dd></div>
          <div><dt>실현손익</dt><dd class="num"><span class={tone(c.realized)}>{Math.abs(c.realized) < 1 ? "0원" : wonSigned(c.realized)}</span></dd></div>
        </dl>
      </div>
      <div class="chart">
        <Donut slices={simSlices} bind:hoverId label={c.cash < -0.5 ? "주식 평가액" : "총자산"}
          sub={c.cash < -0.5 ? "현금 " + won(c.cash) : st.holdings.length + "종목 + 현금"} />
      </div>
    </section>

    <Section id="sim-rows" title="보유 종목" note="± 한 주 단위 · 비중을 바꾸면 차액이 현금으로 오갑니다">
      {#snippet aside()}<button class="btn sm" onclick={() => (ui.add = {})}>매수 시뮬 추가</button>{/snippet}
      <div class="rows">
        {#each simList as h (h.id)}
          <SimRow {h} total={c.total} color={simColors.get(h.id)} />
        {/each}
      </div>
      <div class="cashrow">
        <div>
          <div class="cn">현금</div>
          <div class="cs">매수·매도 차액이 쌓이는 곳</div>
        </div>
        <label class="dep"><span>추가 납입금</span>
          <input class="num" value={Math.round(S.sim.extra).toLocaleString("ko-KR")} inputmode="numeric"
            onchange={(e) => S.setExtra(parseNum(e.currentTarget.value))} />
        </label>
        <div class="cv num" class:neg={c.cash < -0.5}>{won(c.cash)}</div>
      </div>
    </Section>

    <Section id="sim-orders" title="실행 주문서" note="지금 상태를 만들려면 이렇게 거래하면 됩니다">
      {#if c.cash < -0.5}
        <p class="warn">현금이 {won(Math.abs(c.cash))} 모자랍니다. 다른 종목 비중을 줄이거나 추가 납입금을 넣어야 이 조합이 성립합니다.</p>
      {/if}
      {#if ords.list.length}
        <ul class="orders">
          {#each ords.list as o (o.id)}
            <li>
              <span class="side" class:buy={o.dq > 0} class:sell={o.dq < 0}>{o.dq > 0 ? "매수" : "매도"}</span>
              <span class="on">{o.name}{#if o.isNew}<em>신규</em>{/if}{#if o.gone}<em>전량 정리</em>{/if}</span>
              <span class="oq num">{qtyStr(Math.abs(o.dq))}주</span>
              <span class="oa num">{won(o.amt)}</span>
            </li>
          {/each}
        </ul>
        <div class="ordfoot num"><span>매수 {won(ords.buy)} · 매도 {won(ords.sell)}</span><span class={tone(ords.net)}>순현금 {wonSigned(ords.net)}</span></div>
      {:else}
        <p class="empty">아직 바꾼 게 없습니다. 수량이나 비중을 움직이면 필요한 거래가 여기 쌓입니다.</p>
      {/if}
    </Section>

    <Section id="sim-stats" title="비중">
      <StatsBlock st={simStats} />
    </Section>

    <Section id="sim-risk" title="위험과 제약" note="시뮬 비중 반영">
      <RiskSummary holdings={st.holdings} risk={simRisk} loading={riskLoading} error={riskError} {limits} warnings={simWarnings}
        onLimits={saveLimits} />
    </Section>

    <div class="simfoot">
      <button class="btn" onclick={resetSim}>실제 보유에서 다시 시작</button>
    </div>
  {/if}
</Gate>

<Sheet bind:open={saveOpen} title="시뮬 저장">
  <label class="savefield">
    <span>이름</span>
    <input bind:value={saveName} onkeydown={(e) => e.key === "Enter" && saveSim()} />
  </label>
  <p class="empty">저장해도 실제 보유는 바뀌지 않습니다. 나중에 지금 시세로 다시 열 수 있습니다.</p>
  {#snippet footer()}
    <div class="saveacts">
      <button class="btn" onclick={() => (saveOpen = false)}>취소</button>
      <button class="btn primary" onclick={saveSim} disabled={saving || !saveName.trim()}>{saving ? "저장 중…" : "저장"}</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .rowacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .cashform{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:520px}
  .cashform label,.dep{display:flex;flex-direction:column;gap:5px}
  .cashform span,.dep span{font-size:12.5px;color:var(--sub)}
  .cashform input,.dep input{min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px;text-align:right;width:100%}
  .cashform input:focus,.dep input:focus{outline:none;border-color:var(--accent)}
  .sclist{list-style:none}
  .sclist li{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line-soft)}
  .sclist li:last-child{border-bottom:none}
  .scopen{flex:1;display:flex;flex-direction:column;align-items:flex-start;min-height:56px;padding:10px 0;text-align:left}
  .scn{font-size:15px;font-weight:600}
  .scd{font-size:12.5px;color:var(--sub2)}
  .empty{font-size:14px;color:var(--sub2);padding:4px 0 8px}

  .simbadge{display:inline-block;margin:10px 0 6px;padding:4px 10px;border-radius:99px;font-size:12.5px;font-weight:600;
    background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
  .hero{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;padding:12px 0 20px}
  .lbl{font-size:13px;color:var(--sub)}
  .total{font-size:clamp(32px,7vw,44px);font-weight:700;letter-spacing:-.035em;line-height:1.1}
  .kpis{display:grid;grid-template-columns:1fr 1fr;gap:4px 22px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line-soft)}
  .kpis div{padding:5px 0}
  .kpis dt{font-size:12.5px;color:var(--sub2)}
  .kpis dd{font-size:17px;font-weight:620;letter-spacing:-.02em}
  .kpis small{font-size:12.5px;font-weight:450;color:var(--sub);margin-left:4px}
  .neg{color:var(--red)}

  .cashrow{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 0}
  .cashrow > div:first-child{flex:1;min-width:140px}
  .cn{font-size:15px;font-weight:600}
  .cs{font-size:12px;color:var(--sub2)}
  .dep{width:160px}
  .cv{font-size:17px;font-weight:640;min-width:120px;text-align:right}

  .warn{margin:0 0 12px;padding:11px 14px;border-left:3px solid var(--orange);background:color-mix(in srgb,var(--orange) 8%,transparent);border-radius:0 10px 10px 0;font-size:13.5px}
  .orders{list-style:none}
  .orders li{display:flex;align-items:center;gap:12px;min-height:48px;border-bottom:1px solid var(--line-soft);font-size:14.5px}
  .side{font-size:12px;font-weight:640;padding:2px 8px;border-radius:6px;flex:none}
  .side.buy{background:color-mix(in srgb,var(--up) 13%,transparent);color:var(--up)}
  .side.sell{background:color-mix(in srgb,var(--down) 13%,transparent);color:var(--down)}
  .on{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:560}
  .on em{font-style:normal;font-weight:400;color:var(--sub2);margin-left:6px;font-size:12.5px}
  .oq{color:var(--sub);font-size:13px}
  .oa{font-weight:600;min-width:104px;text-align:right}
  .ordfoot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:14px 0 0;font-size:14px;font-weight:600}
  .simfoot{padding:20px 0;border-top:1px solid var(--line-soft)}
  .savefield{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
  .savefield span{font-size:12.5px;color:var(--sub)}
  .savefield input{min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px}
  .savefield input:focus{outline:none;border-color:var(--accent)}
  .saveacts{display:flex;justify-content:flex-end;gap:8px}

  @media (min-width:900px){
    .hero{grid-template-columns:minmax(0,1fr) 300px;gap:48px;align-items:center}
    .kpis{grid-template-columns:repeat(4,1fr)}
  }
</style>
