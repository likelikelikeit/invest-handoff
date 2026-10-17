<script>
  // 종목 상세 · 내 의견 (SPEC §4.3): 의견 이력 타임라인 = 주가 위에 목표가 계단선 + 행 목록.
  // 판정 기록(tech_calls)은 M6에서 여기에 붙는다.
  import ViewRow from "./ViewRow.svelte";
  import RatingChip from "./RatingChip.svelte";
  import { api } from "../lib/api.js";
  import { ui } from "../lib/ui.svelte.js";
  import { stamp, tone } from "../lib/format.js";

  let { id, fmt } = $props();

  let views = $state([]);
  let stops = $state([]); // 커버리지 중단 기록 (SPEC §5.2.9)
  let rows = $state([]);
  let loaded = $state(false);
  const chartModule = import("./PriceChart.svelte");

  async function fetchAll() {
    try {
      const [v, p, c] = await Promise.all([
        api("/views?security_id=" + id), api("/prices/" + id + "?range=10y"),
        api("/coverage/suspensions?security_id=" + id).catch(() => ({ suspensions: [] })),
      ]);
      views = v.views;
      rows = p.rows;
      stops = c.suspensions;
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

  // 중단은 목표가 선을 끊는다 (value: null)
  const targets = $derived([
    ...views.map((v) => ({ date: v.created_at.slice(0, 10), value: v.target_price })),
    ...stops.map((c) => ({ date: c.created_at.slice(0, 10), value: null })),
  ]);
  // 변천: 의견과 중단을 시간순으로. 중단 뒤 첫 의견은 '재개'
  const history = $derived(
    [...views.map((v) => ({ kind: "view", at: v.created_at, v })), ...stops.map((c) => ({ kind: "stop", at: c.created_at, c }))]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  );
</script>

{#if !loaded}
  <p class="note">불러오는 중…</p>
{:else if !views.length}
  <div class="empty">
    <p class="note">이 종목은 아직 커버리지를 개시하지 않았습니다.</p>
    <button class="btn primary" onclick={() => (ui.viewForm = { securityId: id })}>커버리지 개시</button>
  </div>
{:else}
  <div class="history-head"><strong>투자의견 변천</strong><span class="num">{views.length}회</span></div>
  <ol class="timeline" aria-label="투자의견 변천">
    {#each history as e, i (e.kind + (e.kind === "view" ? e.v.id : e.c.id))}
      {@const prior = history[i - 1]}
      <li class:current={i === history.length - 1} class:stop={e.kind === "stop"}>
        <time class="num">{stamp(e.at)}</time>
        <span class="dot" aria-hidden="true"></span>
        {#if e.kind === "stop"}
          <span class="rating"><span class="stopchip">커버리지 중단</span></span>
          <strong class="num">—</strong>
          <span class="change">{e.c.reasons.join(" · ")}</span>
        {:else}
          {@const v = e.v}
          {@const before = prior?.kind === "view" ? prior.v : null}
          <span class="rating"><RatingChip rating={v.rating} score={v.rating_score} />{#if before && v.rating_score !== before.rating_score}<span class="rchg {v.rating_score > before.rating_score ? 'up' : 'down'}">{v.rating_score > before.rating_score ? "▲ 상향" : "▼ 하향"}</span>{/if}</span>
          <strong class="num">{fmt(v.target_price)}</strong>
          {#if before}
            <span class="change num {tone((v.target_price - before.target_price) * 1e6)}">{v.target_price > before.target_price ? "▲" : v.target_price < before.target_price ? "▼" : "—"} {fmt(Math.abs(v.target_price - before.target_price))}</span>
          {:else}<span class="change">{prior ? "재개" : "최초 제시"}</span>{/if}
        {/if}
      </li>
    {/each}
  </ol>
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
  .history-head{display:flex;align-items:baseline;gap:8px;margin:2px 0 6px}
  .history-head strong{font-size:14px}.history-head span{font-size:11.5px;color:var(--sub2)}
  .timeline{display:flex;list-style:none;overflow-x:auto;scroll-snap-type:x proximity;padding:2px 2px 14px;scrollbar-width:none}
  .timeline::-webkit-scrollbar{display:none}
  .timeline li{position:relative;display:grid;grid-template-columns:14px minmax(112px,auto);grid-template-areas:"time time" "dot rating" "line target" "line change";column-gap:7px;flex:0 0 auto;min-width:158px;padding-right:20px;scroll-snap-align:start}
  .timeline li:not(:last-child)::after{content:"";position:absolute;left:7px;right:0;top:30px;height:1px;background:var(--line)}
  .timeline time{grid-area:time;font-size:11px;color:var(--sub2);margin-bottom:3px}
  .timeline .dot{grid-area:dot;z-index:1;width:9px;height:9px;margin:6px 0 0 3px;border-radius:50%;background:var(--sub2);box-shadow:0 0 0 3px var(--bg)}
  .timeline .current .dot{background:var(--accent)}
  .timeline .stop .dot{background:var(--bg);border:1.5px solid var(--sub2);width:8px;height:8px}
  .stopchip{display:inline-block;font-size:11.5px;font-weight:640;padding:1px 7px;border-radius:6px;background:var(--bg2);color:var(--sub)}
  .timeline .rating{grid-area:rating;justify-self:start;display:flex;align-items:center;gap:5px;white-space:nowrap}
  .rchg{font-size:11px;font-weight:600}.rchg.up{color:var(--up)}.rchg.down{color:var(--down)}
  .timeline strong{grid-area:target;font-size:15px;margin-top:4px}
  .timeline .change{grid-area:change;font-size:11.5px;color:var(--sub2)}
  .timeline .change.up{color:var(--up)}.timeline .change.down{color:var(--down)}
  @media (min-width:700px){.timeline li{min-width:180px}}
</style>
