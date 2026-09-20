<script>
  // 종목 상세 · 판정 기록 (SPEC §4.3, §5.6.5). 투자의견과 섞지 않는 별도 목록.
  // 1주·1개월 뒤 가격은 사실만 보여준다(사용자 결정). 적중률 같은 집계는 만들지 않는다.
  import { api } from "../lib/api.js";
  import { toast } from "../lib/ui.svelte.js";
  import { INDICATOR_INFO, ACTIONS, labelTone, actionLabel, sideLabel, LABEL_TEXT, afterReturn } from "../lib/tech.js";
  import { stamp, pctSigned, tone } from "../lib/format.js";

  let { id, fmt } = $props();
  let calls = $state([]);
  let openId = $state(null);

  async function fetchCalls() {
    try { calls = (await api("/tech/calls?security_id=" + id)).calls; } catch { calls = []; }
  }
  $effect(() => { id; fetchCalls(); });
  $effect(() => {
    const f = () => fetchCalls();
    window.addEventListener("tech-changed", f);
    return () => window.removeEventListener("tech-changed", f);
  });

  async function setAction(c, a) {
    try {
      await api("/tech/calls/" + c.id, { method: "PATCH", body: { action: c.action === a ? null : a } });
      fetchCalls();
    } catch (e) {
      toast("실패: " + e.message);
    }
  }
</script>

{#if !calls.length}
  <p class="note">기술적 분석 기록이 없습니다. 위의 매매 적합도 버튼에서 지표를 확인하고 기록할 수 있습니다.</p>
{:else}
  <ul class="list">
    {#each calls as c (c.id)}
      {@const w = afterReturn(c, "price_1w")}
      {@const m = afterReturn(c, "price_1m")}
      <li>
        <button class="head" aria-expanded={openId === c.id} onclick={() => (openId = openId === c.id ? null : c.id)}>
          <span class="dot {labelTone(c.side, c.label)}" aria-hidden="true"></span>
          <span class="main">
            <span class="l1">{sideLabel(c.side)} · {LABEL_TEXT[c.side][c.label]}</span>
            <span class="l2 num">{stamp(c.called_at) + " · " + fmt(c.price_at) + (c.action ? " · " + actionLabel(c.side, c.action) : "")}</span>
          </span>
          <span class="after num">
            <span>1주 <b class={w != null ? tone(w * 1e6) : "flat"}>{w != null ? pctSigned(w) : "—"}</b></span>
            <span>1개월 <b class={m != null ? tone(m * 1e6) : "flat"}>{m != null ? pctSigned(m) : "—"}</b></span>
          </span>
        </button>
        {#if openId === c.id}
          <div class="body">
            <ul class="ind">
              {#each c.indicators as x (x.key)}
                <li><span>{INDICATOR_INFO[x.key]?.label ?? x.key}</span><span class="num">{x.value != null ? INDICATOR_INFO[x.key]?.fmt(x.value) : "—"}</span><span>{x.verdict}</span></li>
              {/each}
            </ul>
            <div class="seg" role="radiogroup" aria-label="행동">
              {#each ACTIONS[c.side] as [k, l] (k)}
                <button role="radio" aria-checked={c.action === k} class:on={c.action === k} onclick={() => setAction(c, k)}>{l}</button>
              {/each}
            </div>
            <p class="rule">규칙 버전 {c.rule_set_id}</p>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="foot">1주·1개월은 판정 뒤 실제 가격 변화입니다. 계기판을 돌아보기 위한 기록이며 성과평가에 쓰지 않습니다.</p>
{/if}

<style>
  .note{font-size:14px;color:var(--sub2);padding:6px 0}
  .list{list-style:none}
  .list > li{border-bottom:1px solid var(--line-soft)}
  .head{width:100%;display:flex;align-items:center;gap:10px;min-height:56px;padding:8px 0;text-align:left}
  .head:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
  .dot{width:10px;height:10px;border-radius:50%;flex:none}
  .dot.red{background:#ff3b30}.dot.amber{background:#ffcc00}.dot.green{background:#34c759}
  .main{flex:1;min-width:0;display:flex;flex-direction:column}
  .l1{font-size:14.5px;font-weight:600}
  .l2{font-size:12.5px;color:var(--sub2)}
  .after{display:flex;flex-direction:column;align-items:flex-end;font-size:12px;color:var(--sub2)}
  .after b{font-weight:620;margin-left:4px}
  .body{padding:0 0 12px 20px}
  .ind{list-style:none;font-size:13px}
  .ind li{display:grid;grid-template-columns:minmax(0,1fr) auto 64px;gap:8px;padding:3px 0;color:var(--sub)}
  .ind li span:nth-child(2),.ind li span:nth-child(3){text-align:right}
  .seg{display:flex;gap:4px;padding:3px;border-radius:10px;background:var(--bg2);margin-top:10px}
  .seg button{flex:1;min-height:36px;border-radius:8px;font-size:13px;color:var(--sub)}
  .seg button.on{background:var(--card);color:var(--ink);font-weight:620;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .rule{font-size:11.5px;color:var(--sub2);margin-top:6px}
  .foot{font-size:12px;color:var(--sub2);margin-top:8px;word-break:keep-all}
</style>
