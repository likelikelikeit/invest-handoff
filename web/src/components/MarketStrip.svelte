<script>
  // 시장 지표 띠 (SPEC §4.2 블록 1, §5.8): 코스피 · S&P500 · 원/달러 · 미국 10년물. 한 줄, 얇게.
  // 누르면 그 지수의 상세(차트)로 간다. 금리는 %p 변화로 보여준다.
  import { data } from "../lib/data.svelte.js";
  import { valueFmt, pctSigned, tone } from "../lib/format.js";

  function change(s) {
    const q = data.quotes[s.ysym];
    if (!q || !q.prevClose) return null;
    if (s.ysym === "^TNX") {
      const d = q.price - q.prevClose;
      return { text: (d >= 0 ? "+" : "") + d.toFixed(3) + "%p", tone: tone(d * 1e6) };
    }
    const p = (q.price / q.prevClose - 1) * 100;
    return { text: pctSigned(p), tone: tone(p * 1e6) };
  }
</script>

<ul class="strip" aria-label="시장 지표">
  {#each data.market as s (s.id)}
    {@const q = data.quotes[s.ysym]}
    {@const c = change(s)}
    <li>
      <a href={"#/security/" + s.id}>
        <span class="n">{s.name}</span>
        <span class="v num">{q ? valueFmt(s)(q.price) : "데이터 없음"}</span>
        {#if c}<span class="c num {c.tone}">{c.text}</span>{/if}
      </a>
    </li>
  {/each}
</ul>

<style>
  .strip{list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px;margin:4px 0 8px}
  li{border-bottom:1px solid var(--line-soft)}
  a{display:flex;flex-direction:column;min-height:56px;padding:8px 0}
  a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:8px}
  .n{font-size:12.5px;color:var(--sub2)}
  .v{font-size:15px;font-weight:620;letter-spacing:-.01em}
  .c{font-size:12.5px;font-weight:560}
  @media (min-width:700px){
    .strip{grid-template-columns:repeat(4,minmax(0,1fr))}
    li{border-bottom:none}
  }
</style>
