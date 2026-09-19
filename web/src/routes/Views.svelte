<script>
  // 의견 탭 (SPEC §4.5): 전체 의견 목록(필터: 종목·등급·기간), 성과 평가.
  // 성과 평가는 뼈대: 평가(사후평가 크론, M8) 전에는 진행 중·평가 대기만 센다.
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import Section from "../components/Section.svelte";
  import ViewRow from "../components/ViewRow.svelte";
  import { api } from "../lib/api.js";
  import { data } from "../lib/data.svelte.js";
  import { ui } from "../lib/ui.svelte.js";
  import { RATINGS } from "../lib/ratings.js";
  import { performance } from "../lib/calc/views.js";
  import { pct, pctSigned } from "../lib/format.js";
  import { todayKst } from "../lib/today.js";

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
  $effect(() => { if (data.loaded) fetchAll(); });
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
</script>

<PageHead title="의견">
  {#if data.loaded}<button class="btn primary" onclick={() => (ui.viewForm = {})}>새 의견</button>{/if}
</PageHead>

<Gate>
  <Section id="views-perf" title="성과 평가">
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
    <p class="note">목표 시점이 지난 의견부터 평가됩니다. 적중 = 기간 안에 한 번이라도 목표가 도달. 평균 목표수익률과 실제수익률의 차이가 낙관·비관 편향입니다.</p>
  </Section>

  <Section id="views-list" title="전체 의견" note={shown.length + "건"}>
    <div class="filters">
      <select bind:value={fSec} aria-label="종목 필터">
        <option value="">모든 종목</option>
        {#each secs as [id, name] (id)}<option value={String(id)}>{name}</option>{/each}
      </select>
      <select bind:value={fRating} aria-label="등급 필터">
        <option value="">모든 등급</option>
        {#each RATINGS as r (r.label)}<option value={r.label}>{r.label}</option>{/each}
      </select>
      <select bind:value={fPeriod} aria-label="기간 필터">
        <option value="all">전체 기간</option>
        <option value="1m">최근 1개월</option>
        <option value="3m">최근 3개월</option>
        <option value="1y">최근 1년</option>
      </select>
    </div>
    {#if err}<p class="msg bad">{err}</p>{/if}
    {#if shown.length}
      <ul class="list">{#each shown as v (v.id)}<ViewRow {v} />{/each}</ul>
    {:else}
      <p class="note">{all.length ? "조건에 맞는 의견이 없습니다." : "아직 기록한 의견이 없습니다. 종목 화면이나 + 버튼에서 기록하세요."}</p>
    {/if}
  </Section>
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
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
  .filters select{min-height:40px;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:0 10px;font-size:14px}
  .list{list-style:none}
  @media (min-width:900px){ .perf{grid-template-columns:240px minmax(0,1fr);align-items:center} .small{grid-template-columns:repeat(5,auto);justify-content:start} }
</style>
