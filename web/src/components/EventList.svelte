<script>
  // 일정 목록 (홈 블록 4, 더보기 일정). 시각은 KST. 종목 일정은 누르면 종목 상세.
  import { dayLabel, dday, eventTitle, KIND_LABEL } from "../lib/calc/calendar.js";
  import { todayKst } from "../lib/today.js";

  let { events, ondelete = null } = $props();
  const today = todayKst();
</script>

<ul class="list">
  {#each events as e (e.id)}
    <li class:past={e.date < today}>
      <span class="when num"><b>{dayLabel(e.date)}</b><span>{e.time || "종일"}</span></span>
      <span class="what">
        <span class="t">
          <i class="k {e.kind}">{KIND_LABEL[e.kind] || e.kind}</i>
          {#if e.security_id}<a href={"#/security/" + e.security_id}>{eventTitle(e)}</a>{:else}{eventTitle(e)}{/if}
        </span>
        {#if e.detail?.local}<span class="sub num">현지 {e.detail.local}</span>{/if}
      </span>
      <span class="dd num">{e.date >= today ? dday(e.date, today) : ""}</span>
      {#if ondelete && e.source === "manual" && e.kind !== "macro"}
        <button class="del" aria-label="{eventTitle(e)} 지우기" onclick={() => ondelete(e)}>×</button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .list{list-style:none}
  li{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 0;border-bottom:1px solid var(--line-soft)}
  li:last-child{border-bottom:none}
  li.past{opacity:.45}
  .when{display:flex;flex-direction:column;width:68px;flex:none;font-size:12.5px;color:var(--sub2)}
  .when b{font-size:14px;color:var(--ink);font-weight:620}
  .what{flex:1;min-width:0;display:flex;flex-direction:column}
  .t{font-size:14.5px;font-weight:560;display:flex;align-items:center;gap:6px;min-width:0}
  .t a{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sub{font-size:12px;color:var(--sub2)}
  .k{font-style:normal;font-size:11px;font-weight:640;padding:1px 6px;border-radius:5px;flex:none;background:var(--bg2);color:var(--sub)}
  .k.earnings{background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--accent)}
  .k.macro{background:color-mix(in srgb,var(--orange) 13%,transparent);color:var(--orange)}
  .dd{font-size:12.5px;color:var(--sub2);flex:none}
  .del{width:36px;height:36px;border-radius:8px;color:var(--sub2);font-size:17px}
  .del:hover{background:var(--bg2);color:var(--red)}
</style>
