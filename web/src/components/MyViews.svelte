<script>
  // 종목 상세 · 내 의견 (SPEC §4.3): 의견 이력 타임라인 = 주가 위에 목표가 계단선 + 행 목록.
  // 판정 기록(tech_calls)은 M6에서 여기에 붙는다.
  import ViewRow from "./ViewRow.svelte";
  import { api } from "../lib/api.js";
  import { ui } from "../lib/ui.svelte.js";

  let { id, fmt } = $props();

  let views = $state([]);
  let rows = $state([]);
  let loaded = $state(false);
  const chartModule = import("./PriceChart.svelte");

  async function fetchAll() {
    try {
      const [v, p] = await Promise.all([api("/views?security_id=" + id), api("/prices/" + id + "?range=10y")]);
      views = v.views;
      rows = p.rows;
    } catch {
      views = [];
    }
    loaded = true;
  }
  $effect(() => { id; fetchAll(); });
  $effect(() => {
    const f = () => fetchAll();
    window.addEventListener("views-changed", f);
    return () => window.removeEventListener("views-changed", f);
  });

  const targets = $derived(views.map((v) => ({ date: v.created_at.slice(0, 10), value: v.target_price })));
</script>

{#if !loaded}
  <p class="note">불러오는 중…</p>
{:else if !views.length}
  <div class="empty">
    <p class="note">이 종목에 기록한 의견이 없습니다.</p>
    <button class="btn primary" onclick={() => (ui.viewForm = { securityId: id })}>새 의견 기록</button>
  </div>
{:else}
  {#if rows.length}
    {#await chartModule then { default: PriceChart }}
      <PriceChart {rows} {fmt} {targets} stampText="점선 = 내 목표가 변화" />
    {/await}
  {/if}
  <ul class="list">{#each views as v (v.id)}<ViewRow {v} showName={false} />{/each}</ul>
{/if}

<style>
  .note{font-size:14px;color:var(--sub2);padding:8px 0}
  .empty{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .list{list-style:none;margin-top:10px}
</style>
