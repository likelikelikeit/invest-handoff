<script>
  // 더보기 · 기타 항목 (SPEC §5.8): 자산군이 '원자재'인 시세. 지금은 금(COMEX 선물, 달러/트로이온스).
  // 종목 추가 후 종목 정보에서 자산군을 '원자재'로 바꾸면 여기에 나오고 5분 틱이 시세를 쌓는다.
  // 행: 이름 · 현재가 · 전일 대비 · 1년 전 대비 · 1년 선. 누르면 종목 상세(차트).
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import { api } from "../lib/api.js";
  import { data, refreshQuotes } from "../lib/data.svelte.js";
  import { valueFmt, won, pctSigned, tone, stamp } from "../lib/format.js";

  const OZ_G = 31.1034768; // 트로이온스 → 그램
  let items = $state([]);
  let lines = $state({});
  let err = $state("");

  async function fetchAll() {
    try {
      items = (await api("/securities")).securities.filter((s) => s.asset_class === "commodity");
      err = "";
      if (items.length) await refreshQuotes(items.map((s) => s.ysym));
      const got = await Promise.all(items.map((s) => api("/prices/" + s.id + "?range=1y").catch(() => ({ rows: [] }))));
      lines = Object.fromEntries(items.map((s, i) => [s.id, got[i].rows || []]));
    } catch (e) {
      err = e.message;
    }
  }
  $effect(() => { if (data.loaded) fetchAll(); });

  function yearChange(s) {
    const rows = lines[s.id] || [];
    const q = data.quotes[s.ysym];
    const last = q?.price ?? rows.at(-1)?.[4];
    const first = rows[0]?.[4];
    return first > 0 && last > 0 ? (last / first - 1) * 100 : null;
  }

  // 1년 종가 선 (축·점 없이 모양만)
  function spark(rows) {
    const v = rows.map((r) => r[4]).filter((x) => x > 0);
    if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v);
    return v.map((x, i) => (i * 100 / (v.length - 1)).toFixed(2) + "," + (hi === lo ? 15 : (28 - (x - lo) * 26 / (hi - lo))).toFixed(2)).join(" ");
  }
</script>

<PageHead title="기타 항목">
  <a class="btn sm" href="#/more">‹ 더보기</a>
</PageHead>

<Gate>
  {#if err}<p class="msg bad">{err}</p>{/if}
  {#if !items.length}
    <p class="note">원자재로 분류한 항목이 없습니다.</p>
  {:else}
    <ul class="list">
      {#each items as s (s.id)}
        {@const q = data.quotes[s.ysym]}
        {@const day = q && q.prevClose ? (q.price / q.prevClose - 1) * 100 : null}
        {@const yr = yearChange(s)}
        {@const pts = spark(lines[s.id] || [])}
        <li>
          <a href={"#/security/" + s.id}>
            <span class="nm">
              <span class="n1">{s.name}</span>
              <span class="n2 num">{s.ysym === "GC=F" ? "달러/온스" : s.currency}{q && s.ysym === "GC=F" && data.fx ? " · 1g 약 " + won(q.price * data.fx / OZ_G) : ""}</span>
            </span>
            {#if pts}
              <svg class="sp {yr != null ? tone(yr * 100) : 'flat'}" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
                <polyline points={pts} fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" />
              </svg>
            {/if}
            <span class="v num">
              <b>{q ? valueFmt(s)(q.price) : "시세 없음"}</b>
              <span class="ch">
                {#if day != null}<i class={tone(day * 100)}>{pctSigned(day)}</i>{/if}
                {#if yr != null}<i class={tone(yr * 100)}>1년 {pctSigned(yr)}</i>{/if}
              </span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
    {#if items.some((s) => data.quotes[s.ysym]?.time)}
      <p class="note num">{stamp(data.quotes[items[0].ysym]?.time)} 기준 · 지연</p>
    {/if}
  {/if}
</Gate>

<style>
  .list{list-style:none}
  li{border-bottom:1px solid var(--line-soft)}
  li:last-child{border-bottom:none}
  a{display:grid;grid-template-columns:minmax(0,1fr) 88px auto;align-items:center;gap:14px;min-height:64px;padding:10px 0}
  a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
  .nm{display:flex;flex-direction:column;min-width:0}
  .n1{font-size:16px;font-weight:640}
  .n2{font-size:12.5px;color:var(--sub2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sp{width:88px;height:30px}
  .sp.up{color:var(--up)}.sp.down{color:var(--down)}.sp.flat{color:var(--sub2)}
  .v{display:flex;flex-direction:column;align-items:flex-end}
  .v b{font-size:16px;font-weight:660;letter-spacing:-.01em}
  .ch{display:flex;gap:8px;font-size:12.5px}
  .ch i{font-style:normal;font-weight:560}
  .up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--sub2)}
  .note{font-size:12.5px;color:var(--sub2);margin-top:10px}
  @media (max-width:420px){ a{grid-template-columns:minmax(0,1fr) 64px auto;gap:10px} .sp{width:64px} }
</style>
