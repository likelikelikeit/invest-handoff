<script>
  // 집중도 · 분류별 · 시장별 (기존 index.html의 통계 패널)
  import { pct, won } from "../lib/format.js";
  import { sectorColor } from "../lib/calc/colors.js";

  let { st } = $props();

  function color(k) {
    if (k === "현금") return "var(--sub2)";
    if (k === "주식") return "var(--accent)";
    if (k === "채권") return "#34c759";
    if (k === "기타") return "#af52de";
    if (k === "국내") return "#0071e3";
    if (k === "해외") return "#ff2d55";
    return sectorColor(k);
  }
  const totalOf = (arr) => arr.reduce((a, b) => a + b.value, 0);
</script>

<div class="stats">
  <div class="col">
    <h3>집중도</h3>
    <dl>
      <div><dt>종목 수</dt><dd class="num">{st.count}개</dd></div>
      <div><dt>상위 3종목</dt><dd class="num">{pct(st.top3Pct)}<em>{st.top3Names.join(", ")}</em></dd></div>
      <div><dt>최대 단일 종목</dt><dd class="num">{pct(st.maxPct)}<em>{st.maxName}</em></dd></div>
      <div><dt>HHI</dt><dd class="num">{Math.round(st.hhi).toLocaleString("ko-KR")}<em>{st.hhiVerdict}</em></dd></div>
      <div><dt>현금 비중</dt><dd class="num">{pct(st.cashPct)}</dd></div>
    </dl>
  </div>
  {#each [["자산군별", st.byAsset], ["분류별", st.bySector], ["시장별", st.byMarket]] as [title, groups] (title)}
    {@const tot = totalOf(groups)}
    {@const max = groups.length ? groups[0].value : 1}
    <div class="col">
      <h3>{title}</h3>
      <div class="bars">
        {#each groups as g (g.key)}
          <div class="bar">
            <div class="bl"><span class="bn">{g.key}</span><span class="bv num">{pct(tot > 0 ? (g.value / tot) * 100 : 0)} <span class="sub">{won(g.value)}</span></span></div>
            <div class="bt"><div class="bf" style:width="{(g.value / max) * 100}%" style:background={color(g.key)}></div></div>
          </div>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .stats{display:grid;grid-template-columns:minmax(0,1fr);gap:22px}
  h3{font-size:14px;font-weight:620;color:var(--sub);margin-bottom:8px}
  dl div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid var(--line-soft)}
  dl div:last-child{border-bottom:none}
  dt{font-size:13.5px;color:var(--sub)}
  dd{font-size:14.5px;font-weight:600;text-align:right}
  dd em{display:block;font-style:normal;font-size:12px;font-weight:450;color:var(--sub2)}
  .bars{display:flex;flex-direction:column;gap:11px}
  .bl{display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px}
  .bn{color:var(--sub)}
  .bv{font-weight:580}
  .sub{color:var(--sub2);font-weight:450}
  .bt{height:6px;border-radius:99px;background:var(--track);overflow:hidden}
  .bf{height:100%;border-radius:99px;transition:width .35s cubic-bezier(.22,1,.36,1)}
  @media (min-width:900px){ .stats{grid-template-columns:repeat(4,1fr);gap:32px} }
</style>
