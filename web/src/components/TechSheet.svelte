<script>
  // 매수·매도 판정 시트 (SPEC §5.6.5): 큰 라벨 한 줄 + 지표별 '값 — 판정' 5줄 + 참고 정보 + 행동 기록.
  // 계기판이다: 매수 여부를 판단하지 않고, 투자의견과 섞지 않고, 가격을 예측하지 않는다.
  import { untrack } from "svelte";
  import Sheet from "./Sheet.svelte";
  import SelectField from "./SelectField.svelte";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { data } from "../lib/data.svelte.js";
  import { INDICATOR_INFO, ACTIONS, labelTone, sideLabel } from "../lib/tech.js";
  import { stamp, pct } from "../lib/format.js";

  let open = $state(false);
  let sid = $state(null);
  let side = $state("buy");
  let res = $state(null);
  let err = $state("");
  let loading = $state(false);
  let action = $state(null);
  let busy = $state(false);

  const held = $derived(data.positions.map((p) => ({ id: p.security_id, name: p.security.name })));
  const name = $derived(data.positions.find((p) => p.security_id === sid)?.security.name
    ?? data.views.find((v) => v.security_id === sid)?.name ?? "");
  const canSell = $derived(data.positions.some((p) => p.security_id === sid));

  $effect(() => {
    const req = ui.tech;
    if (!req) return;
    untrack(() => {
      sid = req.securityId ?? null;
      side = req.side || "buy";
      action = null;
      res = null;
      err = "";
      open = true;
      if (sid != null) run();
    });
  });

  async function run() {
    if (sid == null) return;
    if (side === "sell" && !canSell) side = "buy";
    loading = true;
    err = "";
    res = null;
    try {
      const r = await api("/tech/" + sid + "?side=" + side);
      res = r;
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }

  function pickSide(s) {
    side = s;
    action = null;
    run();
  }

  async function save() {
    if (!res) return;
    busy = true;
    try {
      await api("/tech/" + sid + "/calls", { method: "POST", body: {
        side, rule_set_id: res.rule_set_id, price_at: res.price, label: res.label,
        indicators: res.indicators.map((x) => ({ key: x.key, value: x.value, verdict: x.verdict })), action,
      } });
      toast("기술적 분석을 기록했습니다");
      open = false;
      window.dispatchEvent(new CustomEvent("tech-changed"));
    } catch (e) {
      toast("실패: " + e.message);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={name ? name + " · " + sideLabel(side) : sideLabel(side)} onclose={() => (ui.tech = null)}>
  {#if ui.tech && ui.tech.securityId == null}
    <label class="pick"><span>종목</span>
      <SelectField bind:value={sid} onchange={run} ariaLabel="기술적 분석 종목"
        options={held.map((h) => ({ value: h.id, label: h.name }))} />
    </label>
  {/if}

  {#if sid != null}
    <div class="sides" role="radiogroup" aria-label="판정 종류">
      <button role="radio" aria-checked={side === "buy"} class:on={side === "buy"} onclick={() => pickSide("buy")}>지금 사도 될까</button>
      {#if canSell}
        <button role="radio" aria-checked={side === "sell"} class:on={side === "sell"} onclick={() => pickSide("sell")}>지금 팔아도 될까</button>
      {/if}
    </div>
  {/if}

  {#if loading}
    <p class="note">계산 중…</p>
  {:else if err}
    <p class="msg bad">{err}</p>
  {:else if res && !res.ok}
    <p class="note">{res.error}</p>
  {:else if res}
    <div class="verdict {labelTone(side, res.label)}">
      <span class="dot" aria-hidden="true"></span>
      <strong>{res.label_text}</strong>
    </div>
    <p class="basis num">
      {res.intraday ? "지연 현재가" : "종가"} 기준 · {res.as_of}{res.quote_time ? " · " + stamp(res.quote_time) : ""} · 과열 {res.overheat_sum} / 침체 {res.oversold_sum}
    </p>

    <ul class="rows">
      {#each res.indicators as x (x.key)}
        <li class:off={x.verdict === "꺼짐" || x.verdict === "데이터 없음"}>
          <span class="k">{INDICATOR_INFO[x.key].label}</span>
          <span class="v num">{x.value != null ? INDICATOR_INFO[x.key].fmt(x.value) : "—"}</span>
          <span class="j" class:hot={x.verdict === "과열"} class:cold={x.verdict === "침체"}>{x.verdict}</span>
        </li>
      {/each}
    </ul>

    {#if res.refs.length}
      <div class="refs">
        <span class="rh">참고 (판정 미반영)</span>
        {#each res.refs as r (r.key)}
          {#if r.key === "pos52"}<span class="num">52주 범위 안 위치 {pct(r.value * 100)}</span>{/if}
          {#if r.key === "down_volume_spike"}<span class="num">하락일 거래량 급증 · 평균의 {r.value.toFixed(1)}배</span>{/if}
        {/each}
      </div>
    {/if}

    <p class="disclaimer">단기 진입·청산 부담만 요약합니다. 매수·매도 결정이나 가격 전망이 아니며 투자의견·성과평가와 별개입니다.</p>

    <fieldset class="acts-pick">
      <legend>행동 기록 (선택)</legend>
      <div class="seg" role="radiogroup" aria-label="행동">
        {#each ACTIONS[side] as [k, l] (k)}
          <button role="radio" aria-checked={action === k} class:on={action === k} onclick={() => (action = action === k ? null : k)}>{l}</button>
        {/each}
      </div>
    </fieldset>
  {/if}

  {#snippet footer()}
    <div class="acts">
      <button class="btn" onclick={() => (open = false)}>닫기</button>
      <button class="btn primary" onclick={save} disabled={busy || !res || !res.ok}>{busy ? "저장 중…" : "분석 기록"}</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .pick{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
  .pick span{font-size:12.5px;color:var(--sub)}
  .sides,.seg{display:flex;gap:4px;padding:3px;border-radius:12px;background:var(--bg2)}
  .sides button,.seg button{flex:1;min-height:40px;border-radius:9px;font-size:14px;color:var(--sub)}
  .sides button.on,.seg button.on{background:var(--card);color:var(--ink);font-weight:620;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .sides button:focus-visible,.seg button:focus-visible{outline:2px solid var(--accent)}
  .note{font-size:14px;color:var(--sub2);padding:18px 0}
  .verdict{display:flex;align-items:center;gap:12px;margin-top:18px}
  .verdict strong{font-size:26px;font-weight:720;letter-spacing:-.02em}
  .dot{width:16px;height:16px;border-radius:50%;flex:none}
  .red .dot{background:#ff3b30}.amber .dot{background:#ffcc00}.green .dot{background:#34c759}
  .basis{font-size:12.5px;color:var(--sub2);margin-top:4px}
  .rows{list-style:none;margin-top:14px;border-top:1px solid var(--line-soft)}
  .rows li{display:grid;grid-template-columns:minmax(0,1fr) auto 72px;gap:10px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--line-soft)}
  .rows li.off{opacity:.45}
  .k{font-size:14px;color:var(--sub)}
  .v{font-size:15px;font-weight:620;text-align:right}
  .j{font-size:13px;font-weight:600;text-align:right;color:var(--sub2)}
  .j.hot{color:#ff3b30}.j.cold{color:#248a3d}
  .refs{display:flex;flex-direction:column;gap:2px;margin-top:12px;font-size:13px;color:var(--sub)}
  .rh{font-size:12px;color:var(--sub2)}
  .disclaimer{font-size:12px;color:var(--sub2);margin-top:14px;word-break:keep-all}
  .acts-pick{border:none;margin-top:14px}
  .acts-pick legend{font-size:12.5px;color:var(--sub);margin-bottom:6px}
  .acts{display:flex;justify-content:flex-end;gap:8px}
  @media (prefers-color-scheme: dark){ .j.cold{color:#30d158} }
</style>
