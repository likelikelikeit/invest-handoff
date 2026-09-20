<script>
  // 변화 감지 질문 (SPEC §5.1): 보유 수량이 바뀌면 종목별로 이유를 묻는다.
  // 기록 자체는 서버가 이미 남겼다. 여기서는 이유만 채운다. 닫으면 다음에 다시 묻는다.
  import Sheet from "./Sheet.svelte";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { qtyDisplay } from "../lib/format.js";

  const CHOICES = [
    { key: "buy", label: "매수" },
    { key: "sell", label: "매도" },
    { key: "dividend_reinvest", label: "배당 재투자" },
    { key: "split", label: "분할·병합" },
    { key: "skip", label: "모름" },
  ];

  let open = $state(false);
  let picks = $state({});
  let busy = $state(false);
  let err = $state("");

  $effect(() => {
    if (ui.changes.length) {
      // 늘면 매수, 줄면 매도를 미리 골라둔다. 사용자가 바꿀 수 있다.
      picks = Object.fromEntries(ui.changes.map((c) => [c.id, c.qty_after > c.qty_before ? "buy" : "sell"]));
      err = "";
      open = true;
    }
  });

  async function save() {
    busy = true;
    err = "";
    try {
      for (const c of ui.changes) {
        const p = picks[c.id];
        await api("/portfolio/changes/" + c.id, { method: "PATCH", body: p === "skip" ? { skipped: true } : { reason: p } });
      }
      toast("보유 변화 " + ui.changes.length + "건을 기록했습니다");
      ui.changes = [];
      open = false;
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }

  function later() {
    ui.changes = [];
  }
</script>

<Sheet bind:open title="보유가 바뀌었습니다" onclose={later}>
  <p class="lead">왜 바뀌었는지 골라주세요. 거래 이력 대신 남는 기록입니다.</p>
  <ul>
    {#each ui.changes as c (c.id)}
      <li>
        <div class="top">
          <span class="nm">{c.name}</span>
          <span class="q num">{qtyDisplay(c.qty_before)} → {qtyDisplay(c.qty_after)}주</span>
        </div>
        <div class="seg" role="radiogroup" aria-label="{c.name} 변화 이유">
          {#each CHOICES as ch (ch.key)}
            <button role="radio" aria-checked={picks[c.id] === ch.key} class:on={picks[c.id] === ch.key}
              onclick={() => (picks[c.id] = ch.key)}>{ch.label}</button>
          {/each}
        </div>
      </li>
    {/each}
  </ul>
  {#if err}<p class="msg bad">{err}</p>{/if}

  {#snippet footer()}
    <div class="acts">
      <button class="btn" onclick={() => (open = false)}>나중에</button>
      <button class="btn primary" onclick={save} disabled={busy}>{busy ? "저장 중…" : "기록"}</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .lead{font-size:14px;color:var(--sub);margin-bottom:8px}
  ul{list-style:none}
  li{padding:14px 0;border-bottom:1px solid var(--line-soft)}
  li:last-child{border-bottom:none}
  .top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px}
  .nm{font-size:15.5px;font-weight:620}
  .q{font-size:14px;color:var(--sub)}
  .seg{display:flex;flex-wrap:wrap;gap:6px}
  .seg button{min-height:40px;padding:0 14px;border:1px solid var(--line);border-radius:980px;font-size:14px}
  .seg button.on{background:var(--ink);border-color:var(--ink);color:var(--bg);font-weight:600}
  .seg button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .acts{display:flex;justify-content:flex-end;gap:8px}
</style>
