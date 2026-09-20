<script>
  // 가져오기 대기 (SPEC §7.9): MCP(Claude·ChatGPT)가 넣은 제안을 여기서 확인하고 반영한다.
  // 실제 보유·현금·의견은 이 블록에서 승인할 때만 바뀐다.
  import { api } from "../lib/api.js";
  import { data, loadDrafts, loadViews } from "../lib/data.svelte.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { won, usd, pctSigned } from "../lib/format.js";

  let busy = $state(0);

  const when = (iso) =>
    new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const money = (n, ccy) => (ccy === "USD" ? usd(n) : won(n));

  const upside = (p) => (p.snapshot?.price > 0 ? (p.target_price / p.snapshot.price - 1) * 100 : null);

  function openPortfolio(d) {
    // 기존 스크린샷 가져오기 시트를 그대로 쓴다. 행별로 확인·수정한 뒤 반영한다.
    ui.importOpen = { draftId: d.id, rows: d.payload.rows, cash: d.payload.cash || [], from: d.client_name };
  }

  async function applyView(d) {
    busy = d.id;
    try {
      const r = await api("/drafts/" + d.id + "/apply", { method: "POST", body: {} });
      toast(r.view.name + " 의견을 기록했습니다 (" + when(r.view.created_at) + " 시점)");
      await Promise.all([loadDrafts(), loadViews()]);
    } catch (e) {
      toast("실패: " + e.message);
    } finally {
      busy = 0;
    }
  }

  async function discard(d) {
    busy = d.id;
    try {
      await api("/drafts/" + d.id + "/discard", { method: "POST", body: {} });
      await loadDrafts();
    } catch (e) {
      toast("실패: " + e.message);
    } finally {
      busy = 0;
    }
  }
</script>

<ul class="list">
  {#each data.drafts as d (d.id)}
    <li class="row">
      <div class="meta">
        <span class="from">{d.client_name || "MCP"}</span>
        <span class="at">{when(d.proposed_at)}</span>
      </div>

      {#if d.kind === "portfolio"}
        <p class="title">보유 {d.payload.rows.length}줄{d.payload.cash?.length ? " · 현금 " + d.payload.cash.length + "건" : ""}</p>
        <p class="sub">{d.payload.rows.slice(0, 4).map((r) => r.name).join(", ")}{d.payload.rows.length > 4 ? " 외" : ""}</p>
        {#if d.note}<p class="note">{d.note}</p>{/if}
        <div class="acts">
          <button class="btn sm" onclick={() => discard(d)} disabled={busy === d.id}>버리기</button>
          <button class="btn sm primary" onclick={() => openPortfolio(d)}>확인하고 반영</button>
        </div>
      {:else}
        <p class="title">{d.payload.name} · {d.payload.rating}</p>
        <p class="sub">
          목표 {money(d.payload.target_price, d.payload.currency)} · {d.payload.horizon_months}개월
          {#if upside(d.payload) != null}
            <span class="up" class:down={upside(d.payload) < 0}>{pctSigned(upside(d.payload))}</span>
          {/if}
        </p>
        {#if d.payload.thesis}<p class="note">{d.payload.thesis}</p>{/if}
        <p class="basis">기록 시점 {when(d.proposed_at)} · 그때 가격 {money(d.payload.snapshot.price, d.payload.currency)} ({d.payload.snapshot.source})</p>
        <div class="acts">
          <button class="btn sm" onclick={() => discard(d)} disabled={busy === d.id}>버리기</button>
          <button class="btn sm primary" onclick={() => applyView(d)} disabled={busy === d.id}>그대로 기록</button>
        </div>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
  .row{border:1px solid var(--line-soft);border-radius:12px;padding:12px 14px;background:var(--card)}
  .meta{display:flex;gap:8px;align-items:baseline;font-size:12px;color:var(--sub2)}
  .from{font-weight:600;color:var(--sub)}
  .title{margin:6px 0 2px;font-size:15px;font-weight:600}
  .sub{margin:0;font-size:13.5px;color:var(--sub)}
  .note{margin:6px 0 0;font-size:13px;color:var(--sub2);white-space:pre-wrap}
  .basis{margin:6px 0 0;font-size:12px;color:var(--sub2)}
  .up{color:var(--up)}
  .up.down{color:var(--down)}
  .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
</style>
