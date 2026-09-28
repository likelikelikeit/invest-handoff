<script>
  // 커버리지 중단 (SPEC §5.2.9). 현재 의견을 철회하고 목표가 제시를 멈춘다. 매도 의견이 아니다.
  // 설명은 한 줄로만. 규칙(철회·적중률 처리)은 성과 평가의 ?에 있다.
  import { untrack } from "svelte";
  import Sheet from "./Sheet.svelte";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { loadViews } from "../lib/data.svelte.js";
  import { valueFmt } from "../lib/format.js";

  const REASONS = ["밸류에이션 불확실", "사업구조 변화", "정보 부족", "투자 논리 훼손", "기타"];

  let open = $state(false);
  let v = $state(null);
  let reasons = $state([]);
  let memo = $state("");
  let busy = $state(false);
  let err = $state("");

  $effect(() => {
    const req = ui.suspend;
    if (!req) return;
    untrack(() => {
      v = req.view;
      reasons = [];
      memo = "";
      err = "";
      open = true;
    });
  });

  const fmt = $derived(v ? valueFmt({ ysym: v.ysym, currency: v.currency, asset_class: "equity" }) : String);
  const toggle = (r) => (reasons = reasons.includes(r) ? reasons.filter((x) => x !== r) : [...reasons, r]);

  async function save() {
    busy = true;
    err = "";
    try {
      await api("/coverage/suspensions", { method: "POST", body: { security_id: v.security_id, reasons, memo } });
      toast(v.name + " 커버리지를 중단했습니다");
      open = false;
      await loadViews();
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="커버리지 중단" onclose={() => (ui.suspend = null)} guardClose={() => Boolean(memo.trim() || reasons.length)}>
  {#if v}
    <div class="form">
      <p class="what">{v.name} · {v.rating} {fmt(v.target_price)} {v.hit === 1 ? "(목표 도달, 적중으로 남음)" : "의견을 철회합니다"}</p>

      <div class="chips" role="group" aria-label="사유">
        {#each REASONS as r (r)}
          <button class="chip" class:on={reasons.includes(r)} aria-pressed={reasons.includes(r)} onclick={() => toggle(r)}>{r}</button>
        {/each}
      </div>

      <textarea bind:value={memo} rows="3" placeholder="사유 (선택)"></textarea>
    </div>
    {#if err}<p class="msg bad">{err}</p>{/if}
  {/if}

  {#snippet footer()}
    <div class="acts">
      <button class="btn" onclick={() => (open = false)}>취소</button>
      <button class="btn primary" onclick={save} disabled={busy}>{busy ? "저장 중…" : "중단"}</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .form{display:flex;flex-direction:column;gap:14px}
  .what{margin:0;font-size:14px;color:var(--sub);word-break:keep-all}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:13px;min-height:34px;padding:0 12px;border:1px solid var(--line);border-radius:99px;color:var(--sub)}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  textarea{border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px;width:100%;font-family:inherit;color:inherit;resize:vertical;line-height:1.5}
  textarea:focus{outline:none;border-color:var(--accent)}
  .msg{margin-top:10px}
  .acts{display:flex;justify-content:flex-end;gap:8px}
</style>
