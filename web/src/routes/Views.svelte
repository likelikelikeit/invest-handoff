<script>
  // 의견 탭 (SPEC §4.5): 전체 의견 목록(필터: 종목·등급·기간), 성과 평가.
  // 성과 평가는 뼈대: 평가(사후평가 크론, M8) 전에는 진행 중·평가 대기만 센다.
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import Section from "../components/Section.svelte";
  import ViewRow from "../components/ViewRow.svelte";
  import NoteRow from "../components/NoteRow.svelte";
  import InfoTip from "../components/InfoTip.svelte";
  import SelectField from "../components/SelectField.svelte";
  import { api } from "../lib/api.js";
  import { data } from "../lib/data.svelte.js";
  import { ui } from "../lib/ui.svelte.js";
  import { RATINGS } from "../lib/ratings.js";
  import { performance } from "../lib/calc/views.js";
  import { pct, pctSigned } from "../lib/format.js";
  import { todayKst } from "../lib/today.js";

  // 종목 의견 / 테마·메모 전환 (SPEC §5.9). 메모는 채점하지 않는 기록이라 성과 블록도 함께 숨긴다.
  let mode = $state("views");
  let notes = $state([]);
  let noteTag = $state("");
  let all = $state([]);
  let fSec = $state("");
  let fRating = $state("");
  let fPeriod = $state("all");
  let err = $state("");

  async function fetchAll() {
    try {
      all = (await api("/views")).views;
      err = "";
    } catch (e) {
      err = e.message;
    }
  }
  async function fetchNotes() {
    try {
      notes = (await api("/notes")).notes;
    } catch {
      notes = [];
    }
  }
  $effect(() => { if (data.loaded) { fetchAll(); fetchNotes(); } });
  $effect(() => {
    const f = () => fetchNotes();
    window.addEventListener("notes-changed", f);
    return () => window.removeEventListener("notes-changed", f);
  });
  $effect(() => {
    const f = () => fetchAll();
    window.addEventListener("views-changed", f);
    return () => window.removeEventListener("views-changed", f);
  });

  const secs = $derived([...new Map(all.map((v) => [v.security_id, v.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ko")));
  const since = $derived.by(() => {
    const days = { "1m": 31, "3m": 92, "1y": 366 }[fPeriod];
    return days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : "";
  });
  const shown = $derived(all.filter((v) =>
    (!fSec || v.security_id === Number(fSec)) && (!fRating || v.rating === fRating) && (!since || v.created_at >= since)));
  const perf = $derived(performance(all, todayKst()));
  const noteTags = $derived([...new Set(notes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b, "ko")));
  const shownNotes = $derived(noteTag ? notes.filter((n) => n.tags.includes(noteTag)) : notes);
</script>

<PageHead title="투자의견">
  {#if data.loaded}
    {#if mode === "views"}
      <button class="btn primary" onclick={() => (ui.viewForm = {})}>커버리지 개시</button>
    {:else}
      <button class="btn primary" onclick={() => (ui.noteForm = {})}>메모 쓰기</button>
    {/if}
  {/if}
</PageHead>

<Gate>
  <div class="kind-tabs" role="tablist" aria-label="기록 종류">
    <button role="tab" aria-selected={mode === "views"} class:on={mode === "views"} onclick={() => (mode = "views")}>
      종목 의견 <span class="num">{all.length}</span>
    </button>
    <button role="tab" aria-selected={mode === "notes"} class:on={mode === "notes"} onclick={() => (mode = "notes")}>
      테마·메모 <span class="num">{notes.length}</span>
    </button>
  </div>

  {#if mode === "notes"}
    <Section id="notes-list" title="테마·섹터 메모" note={shownNotes.length + "건"}>
      {#if noteTags.length}
        <div class="filters">
          <SelectField compact bind:value={noteTag} ariaLabel="태그 필터"
            options={[{ value: "", label: "모든 태그" }, ...noteTags.map((t) => ({ value: t, label: "#" + t }))]} />
        </div>
      {/if}
      {#if shownNotes.length}
        <ul class="list">{#each shownNotes as n (n.id)}<NoteRow {n} ontouched={fetchNotes} />{/each}</ul>
      {:else}
        <p class="note">{notes.length ? "그 태그의 메모가 없습니다." : "종목이 아니라 테마·섹터·매크로에 대한 생각을 적는 곳입니다. 목표가 없이 자유롭게 쓰고, 과거 날짜로도 기록할 수 있습니다."}</p>
      {/if}
    </Section>
  {:else}
  <Section id="views-perf" title="성과 평가" note="사전 예측만">
    <div class="perf">
      <div class="big">
        <span class="lbl">적중률</span>
        <span class="v num">{perf.hitRate != null ? pct(perf.hitRate * 100) : "—"}</span>
        <span class="n num">평가된 의견 {perf.n}건</span>
      </div>
      <dl class="small num">
        <div><dt>평균 목표수익률</dt><dd>{perf.avgTarget != null ? pctSigned(perf.avgTarget * 100) : "—"}</dd></div>
        <div><dt>평균 실제수익률</dt><dd>{perf.avgActual != null ? pctSigned(perf.avgActual * 100) : "—"}</dd></div>
        <div><dt>MAE</dt><dd>{perf.mae != null ? pct(perf.mae * 100) + "p" : "—"}</dd></div>
        <div><dt>진행 중</dt><dd>{perf.inProgress}건</dd></div>
        {#if perf.awaiting}<div><dt>평가 대기</dt><dd>{perf.awaiting}건</dd></div>{/if}
      </dl>
    </div>
      {#if perf.backdated.total}
      <p class="back">
        사후 입력 {perf.backdated.total}건은 위 숫자에서 뺐습니다{#if perf.backdated.n}
          · 그중 평가된 {perf.backdated.n}건의 적중률 {perf.backdated.hitRate != null ? pct(perf.backdated.hitRate * 100) : "—"}{/if}
        <InfoTip label="사후 입력" text="과거 날짜로 소급 기록한 의견입니다. 기록 시점 가격은 그날 종가로 복원해 사실이지만, 판단 자체는 결과를 알고 적은 것이라 사전 예측과 같은 칸에서 세지 않습니다." />
      </p>
    {/if}
  <div class="criteria"><span>평가 기준</span><InfoTip label="성과 평가 기준" text="목표 시점이 지난 투자의견부터 평가합니다. 적중은 기간 안에 목표가에 한 번이라도 도달한 경우이며, 평균 목표수익률과 평균 실제수익률의 차이로 낙관·비관 편향을 읽을 수 있습니다." /></div>
  </Section>

  <Section id="views-list" title="투자의견 이력" note={shown.length + "건"}>
    <div class="filters">
      <SelectField compact bind:value={fSec} ariaLabel="종목 필터" options={[{ value: "", label: "모든 종목" }, ...secs.map(([id, name]) => ({ value: String(id), label: name }))]} />
      <SelectField compact bind:value={fRating} ariaLabel="등급 필터" options={[{ value: "", label: "모든 등급" }, ...RATINGS.map((r) => ({ value: r.label, label: r.label }))]} />
      <SelectField compact bind:value={fPeriod} ariaLabel="기간 필터" options={[
        { value: "all", label: "전체 기간" }, { value: "1m", label: "최근 1개월" },
        { value: "3m", label: "최근 3개월" }, { value: "1y", label: "최근 1년" },
      ]} />
    </div>
    {#if err}<p class="msg bad">{err}</p>{/if}
    {#if shown.length}
      <ul class="list">{#each shown as v (v.id)}<ViewRow {v} />{/each}</ul>
    {:else}
      <p class="note">{all.length ? "조건에 맞는 투자의견이 없습니다." : "아직 개시한 커버리지가 없습니다. 종목 화면이나 + 버튼에서 시작하세요."}</p>
    {/if}
  </Section>
  {/if}
</Gate>

<style>
  .perf{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
  .big{display:flex;flex-direction:column}
  .lbl{font-size:13px;color:var(--sub)}
  .big .v{font-size:40px;font-weight:720;letter-spacing:-.03em;line-height:1.1}
  .big .n{font-size:12.5px;color:var(--sub2)}
  .small{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px}
  .small dt{font-size:12px;color:var(--sub2)}
  .small dd{font-size:15px;font-weight:600}
  .note{font-size:13px;color:var(--sub2);margin-top:10px;word-break:keep-all}
  .kind-tabs{display:flex;gap:4px;padding:3px;margin-bottom:10px;border-radius:13px;background:var(--bg2);width:min(100%,360px)}
  .kind-tabs button{flex:1;min-height:40px;border-radius:10px;font-size:14px;color:var(--sub)}
  .kind-tabs button.on{background:color-mix(in srgb,var(--card) 78%,transparent);color:var(--ink);font-weight:680;box-shadow:0 2px 10px rgba(0,0,0,.08)}
  .kind-tabs span{margin-left:4px;color:var(--sub2);font-size:12px}
  .kind-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .back{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;color:var(--sub2);margin:10px 0 0;word-break:keep-all}
  .criteria{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:var(--sub2)}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
  .list{list-style:none}
  @media (min-width:900px){ .perf{grid-template-columns:240px minmax(0,1fr);align-items:center} .small{grid-template-columns:repeat(5,auto);justify-content:start} }
</style>
