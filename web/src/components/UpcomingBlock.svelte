<script>
  // 홈 블록 4 (SPEC §4.2): 오늘부터 30일 일정 (어닝, 경제지표, 행사).
  import EventList from "./EventList.svelte";
  import { api } from "../lib/api.js";
  import { data } from "../lib/data.svelte.js";
  import { addDays } from "../lib/calc/calendar.js";
  import { todayKst } from "../lib/today.js";

  let events = $state([]);
  let err = $state("");
  async function fetchEvents() {
    const t = todayKst();
    try { events = (await api("/events?from=" + t + "&to=" + addDays(t, 30))).events; } catch (e) { err = e.message; }
  }
  $effect(() => { if (data.loaded) fetchEvents(); });
  $effect(() => {
    const f = () => fetchEvents();
    window.addEventListener("events-changed", f);
    return () => window.removeEventListener("events-changed", f);
  });
</script>

{#if err}
  <p class="msg bad">{err}</p>
{:else if events.length}
  <EventList {events} />
{:else}
  <p class="note">앞으로 30일 안의 일정이 없습니다.</p>
{/if}
<a class="more" href="#/more/calendar">전체 일정 ›</a>

<style>
  .note{font-size:14px;color:var(--sub2);padding:6px 0}
  .more{display:inline-block;margin-top:8px;font-size:13.5px;color:var(--accent);min-height:32px}
</style>
