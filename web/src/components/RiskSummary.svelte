<script>
  // M8 포트폴리오 위험. 가정(기대수익률)과 계산값(변동성·상관)을 명확히 나눈다.
  import { pct } from "../lib/format.js";

  let { holdings, risk, loading = false, error = "", limits, warnings = [], editable = false, onExpected, onLimits } = $props();
  const pct1 = (v) => v == null ? "—" : pct(v * 100);

  function saveLimit(key, event) {
    const n = Number(event.currentTarget.value);
    if (Number.isFinite(n) && n > 0 && n <= 100) onLimits?.({ ...limits, [key]: n });
  }
</script>

<div class="headline">
  <dl>
    <div><dt>기대수익률 <em>내 가정</em></dt><dd class="num">{pct1(risk.expectedReturn)}</dd></div>
    <div><dt>변동성 <em>계산됨</em></dt><dd class="num">{pct1(risk.volatility)}</dd></div>
  </dl>
  <p>최근 1년 일간 수익률의 공분산을 252거래일로 연환산합니다. 현금은 기대수익률·변동성 0으로 계산합니다.</p>
</div>

{#if loading}<p class="note">가격 이력으로 위험을 계산하는 중…</p>{/if}
{#if error}<p class="note bad">위험 계산 데이터를 모두 받지 못했습니다: {error}</p>{/if}
{#if risk.expectedReturn == null}<p class="note">모든 보유 종목에 기대수익률을 넣으면 포트폴리오 기대수익률이 표시됩니다.</p>{/if}
{#if risk.volatility == null && !loading}<p class="note">종목별로 겹치는 일간 수익률이 20개 이상 있어야 변동성을 계산합니다.</p>{/if}

{#if editable}
  <div class="assumptions">
    <h3>종목별 기대수익률 <span>연 %, 내 가정</span></h3>
    {#each holdings as h (h.id)}
      <label>
        <span><b>{h.name}</b><small>{h.tick}</small></span>
        <input class="num" type="number" min="-100" max="100" step="0.1" value={h.expectedReturnPct ?? ""}
          placeholder="—" aria-label="{h.name} 기대수익률"
          onchange={(e) => onExpected?.(h.id, e.currentTarget.value === "" ? null : Number(e.currentTarget.value))} />
        <i>%</i>
      </label>
    {/each}
  </div>
{/if}

<div class="limits">
  <h3>비중 상한 <span>초과해도 거래를 막지 않습니다</span></h3>
  <label><span>단일 종목</span><input class="num" type="number" min="1" max="100" value={limits.singlePct} onchange={(e) => saveLimit("singlePct", e)} /><i>%</i></label>
  <label><span>한 섹터</span><input class="num" type="number" min="1" max="100" value={limits.sectorPct} onchange={(e) => saveLimit("sectorPct", e)} /><i>%</i></label>
</div>

{#if warnings.length}
  <ul class="warnings">
    {#each warnings as w (w.type + w.label)}
      <li><strong>{w.label}</strong> {w.type === "single" ? "단일 종목" : "섹터"} 비중 <span class="num">{pct(w.pct)}</span> · 상한 <span class="num">{pct(w.limit)}</span> 초과</li>
    {/each}
  </ul>
{/if}

{#if risk.correlations.length}
  <div class="corr">
    <h3>같이 움직이는 종목 <span>절댓값이 큰 순 · 계산됨</span></h3>
    {#each risk.correlations.slice(0, 5) as c (c.a + c.b)}
      <div><span>{c.a} · {c.b}</span><strong class="num">{c.value.toFixed(2)}</strong></div>
    {/each}
  </div>
{/if}

<style>
  .headline{padding-bottom:14px;border-bottom:1px solid var(--line-soft)}
  .headline dl{display:flex;gap:34px;flex-wrap:wrap}
  .headline dt{font-size:12.5px;color:var(--sub2)}
  .headline dt em,h3 span{font-style:normal;font-weight:500;color:var(--accent);margin-left:4px}
  .headline dd{font-size:28px;font-weight:700;letter-spacing:-.03em}
  .headline p,.note{font-size:12.5px;color:var(--sub2);margin-top:7px;word-break:keep-all}
  .note.bad{color:var(--orange)}
  h3{font-size:14px;font-weight:650;margin-bottom:7px}
  h3 span{font-size:11.5px;color:var(--sub2)}
  .assumptions,.limits,.corr{padding-top:16px}
  .assumptions label,.limits label,.corr div{display:flex;align-items:center;min-height:42px;border-bottom:1px solid var(--line-soft);gap:8px}
  .assumptions label > span,.limits label > span,.corr div > span{flex:1;min-width:0;font-size:13.5px}
  .assumptions b{font-weight:580}
  .assumptions small{color:var(--sub2);margin-left:6px}
  input{width:78px;min-height:34px;border:1px solid var(--line);background:var(--bg);border-radius:9px;padding:5px 8px;text-align:right;font-size:15px}
  input:focus{outline:none;border-color:var(--accent)}
  label i{font-style:normal;color:var(--sub2);font-size:12px;width:12px}
  .limits{display:grid;grid-template-columns:1fr 1fr;column-gap:20px}
  .limits h3{grid-column:1/-1}
  .warnings{list-style:none;margin-top:14px;border-left:3px solid var(--orange);padding:5px 0 5px 12px;background:color-mix(in srgb,var(--orange) 7%,transparent)}
  .warnings li{font-size:12.5px;padding:4px 0}
  .warnings strong{font-weight:650}
  .corr strong{font-size:14px}
  @media (min-width:900px){.assumptions{columns:2;column-gap:36px}.assumptions h3{column-span:all}.assumptions label{break-inside:avoid}}
</style>
