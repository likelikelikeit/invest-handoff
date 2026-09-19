<script>
  // 더보기 · 거시 (SPEC §4.6, §5.8): 10년 금리 경로 + 점도표 중간값 입력(분기마다) + 즉시 갱신.
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import MacroBlock from "../components/MacroBlock.svelte";
  import { api } from "../lib/api.js";
  import { toast } from "../lib/ui.svelte.js";
  import { stamp } from "../lib/format.js";

  const y = new Date().getFullYear();
  let dots = $state({ sep: "", m0: "", m1: "", m2: "", lr: "" });
  let busy = $state(false);
  let err = $state("");
  let refreshing = $state(false);
  let report = $state(null);

  async function saveDots() {
    err = "";
    const medians = {};
    [[y, dots.m0], [y + 1, dots.m1], [y + 2, dots.m2]].forEach(([yr, v]) => { if (String(v).trim() !== "") medians[yr] = Number(v); });
    busy = true;
    try {
      await api("/macro/dots", { method: "POST", body: { sep: dots.sep, medians, long_run: dots.lr === "" ? null : Number(dots.lr) } });
      toast("점도표를 저장했습니다");
      window.dispatchEvent(new CustomEvent("macro-changed"));
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    refreshing = true;
    try {
      report = (await api("/macro/refresh?backfill=1", { method: "POST" })).report;
      toast("거시·실적일을 갱신했습니다");
      window.dispatchEvent(new CustomEvent("macro-changed"));
      window.dispatchEvent(new CustomEvent("events-changed"));
    } catch (e) {
      toast("실패: " + e.message);
    } finally {
      refreshing = false;
    }
  }
</script>

<PageHead title="거시">
  <a class="btn sm" href="#/more">‹ 더보기</a>
</PageHead>

<Gate>
  <MacroBlock detail />

  <section class="block">
    <h2>점도표 중간값 입력</h2>
    <p class="note">Fed 점도표(SEP)는 3·6·9·12월 FOMC 뒤에 나옵니다. 연말 기준 중간값을 넣으면 그래프에 점선으로 이어집니다. 같은 달을 다시 넣으면 바뀝니다.</p>
    <div class="form">
      <label class="wide"><span>점도표가 나온 FOMC 달</span><input type="month" bind:value={dots.sep} /></label>
      <label><span>{y}년 말 (%)</span><input class="num" inputmode="decimal" bind:value={dots.m0} placeholder="3.625" /></label>
      <label><span>{y + 1}년 말 (%)</span><input class="num" inputmode="decimal" bind:value={dots.m1} /></label>
      <label><span>{y + 2}년 말 (%)</span><input class="num" inputmode="decimal" bind:value={dots.m2} /></label>
      <label><span>장기 (%)</span><input class="num" inputmode="decimal" bind:value={dots.lr} /></label>
    </div>
    {#if err}<p class="msg bad">{err}</p>{/if}
    <div class="acts"><button class="btn primary" onclick={saveDots} disabled={busy || !dots.sep}>{busy ? "저장 중…" : "점도표 저장"}</button></div>
  </section>

  <section class="block">
    <h2>지금 갱신</h2>
    <p class="note">매일 08:30(KST)에 자동으로 받습니다. 키를 막 넣었을 때처럼 과거 이력까지 지금 받으려면 누르세요.</p>
    <button class="btn" onclick={refresh} disabled={refreshing}>{refreshing ? "받는 중…" : "거시·실적일 지금 받기"}</button>
    {#if report}
      <p class="note num">{stamp(report.at)} · {Object.entries(report.macro).map(([k, n]) => k + " " + n + "개").join(" · ")} · 실적일 {report.earnings}개{report.errors.length ? " · 실패: " + report.errors.join(" / ") : ""}</p>
    {/if}
  </section>
</Gate>

<style>
  .block{margin-top:28px;padding-top:12px;border-top:1px solid var(--line-soft);max-width:640px}
  h2{font-size:17px;font-weight:650;margin-bottom:6px}
  .note{font-size:13px;color:var(--sub2);margin:4px 0 10px;word-break:keep-all}
  .form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .form .wide{grid-column:1/-1}
  .form label{display:flex;flex-direction:column;gap:5px}
  .form span{font-size:12.5px;color:var(--sub)}
  .form input{min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px}
  .form input:focus{outline:none;border-color:var(--accent)}
  .acts{display:flex;justify-content:flex-end;margin-top:12px}
</style>
