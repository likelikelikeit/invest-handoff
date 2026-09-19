<script>
  // 더보기 · 일정 (SPEC §4.6, §5.7): 석 달 단위로 넘겨 보는 일정 목록 + 직접 추가(국내 실적일 등).
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import EventList from "../components/EventList.svelte";
  import { api } from "../lib/api.js";
  import { data } from "../lib/data.svelte.js";
  import { toast } from "../lib/ui.svelte.js";
  import { groupByMonth } from "../lib/calc/calendar.js";
  import { todayKst } from "../lib/today.js";

  const monthStart = (d) => d.slice(0, 7) + "-01";
  let start = $state(monthStart(todayKst()));
  let events = $state([]);
  let form = $state({ date: todayKst(), time: "", title: "", security_id: "" });
  let busy = $state(false);
  let err = $state("");

  function shift(months) {
    const d = new Date(start + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + months);
    start = d.toISOString().slice(0, 10);
  }
  const end = $derived.by(() => {
    const d = new Date(start + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 3);
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  });

  async function fetchEvents() {
    try { events = (await api("/events?from=" + start + "&to=" + end)).events; } catch (e) { err = e.message; }
  }
  $effect(() => { start; if (data.loaded) fetchEvents(); });

  const groups = $derived(groupByMonth(events));
  const held = $derived(data.positions.map((p) => ({ id: p.security_id, name: p.security.name })));

  async function add() {
    if (!form.title.trim()) return (err = "제목을 넣어주세요");
    busy = true;
    err = "";
    try {
      await api("/events", { method: "POST", body: {
        date: form.date, time: form.time || null, title: form.title.trim(),
        kind: form.security_id ? "corporate" : "custom", security_id: form.security_id ? Number(form.security_id) : null,
      } });
      toast("일정을 추가했습니다");
      form = { ...form, title: "", time: "" };
      await fetchEvents();
      window.dispatchEvent(new CustomEvent("events-changed"));
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }

  async function remove(e) {
    if (!confirm(e.title + " 일정을 지울까요?")) return;
    try {
      await api("/events/" + e.id, { method: "DELETE" });
      await fetchEvents();
      window.dispatchEvent(new CustomEvent("events-changed"));
    } catch (x) {
      toast("실패: " + x.message);
    }
  }
</script>

<PageHead title="일정">
  <a class="btn sm" href="#/more">‹ 더보기</a>
</PageHead>

<Gate>
  <div class="nav">
    <button class="btn sm" onclick={() => shift(-3)} aria-label="이전 석 달">‹</button>
    <span class="range num">{start.slice(0, 7)} ~ {end.slice(0, 7)}</span>
    <button class="btn sm" onclick={() => shift(3)} aria-label="다음 석 달">›</button>
    <button class="btn sm" onclick={() => (start = monthStart(todayKst()))}>이번 달</button>
  </div>

  {#each groups as g (g.month)}
    <h2>{g.label}</h2>
    <EventList events={g.items} ondelete={remove} />
  {:else}
    <p class="note">이 기간에 일정이 없습니다.</p>
  {/each}

  <section class="add">
    <h2>일정 추가</h2>
    <p class="note">국내 실적 발표일처럼 자동으로 안 들어오는 일정을 직접 넣습니다. FOMC·금통위 등은 연초에 한 번 넣어 둡니다.</p>
    <div class="form">
      <label><span>날짜</span><input type="date" bind:value={form.date} /></label>
      <label><span>시각 (KST, 선택)</span><input type="time" bind:value={form.time} /></label>
      <label class="wide"><span>제목</span><input bind:value={form.title} placeholder="예: 삼성전자 3분기 잠정실적" /></label>
      <label class="wide"><span>종목 (선택)</span>
        <select bind:value={form.security_id}>
          <option value="">없음</option>
          {#each held as h (h.id)}<option value={String(h.id)}>{h.name}</option>{/each}
        </select>
      </label>
    </div>
    {#if err}<p class="msg bad">{err}</p>{/if}
    <div class="acts"><button class="btn primary" onclick={add} disabled={busy}>{busy ? "추가 중…" : "추가"}</button></div>
  </section>
</Gate>

<style>
  .nav{display:flex;align-items:center;gap:8px;margin:4px 0 8px}
  .range{font-size:15px;font-weight:600;min-width:150px;text-align:center}
  h2{font-size:15px;font-weight:650;color:var(--sub);margin:18px 0 2px}
  .note{font-size:13px;color:var(--sub2);padding:4px 0;word-break:keep-all}
  .add{margin-top:28px;padding-top:8px;border-top:1px solid var(--line-soft);max-width:640px}
  .form{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
  .form .wide{grid-column:1/-1}
  .form label{display:flex;flex-direction:column;gap:5px}
  .form span{font-size:12.5px;color:var(--sub)}
  .form input,.form select{min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px}
  .form input:focus,.form select:focus{outline:none;border-color:var(--accent)}
  .acts{display:flex;justify-content:flex-end;margin-top:12px}
</style>
