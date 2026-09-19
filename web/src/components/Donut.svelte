<script>
  // 도넛: stroke-dasharray 방식 (기존 index.html). 조각에 올리거나 누르면 가운데에 이름·비중·금액.
  import { pct, won } from "../lib/format.js";

  let { slices, hoverId = $bindable(null), label = "총자산", sub = "" } = $props();

  const R = 72;
  const C = 2 * Math.PI * R;
  const total = $derived(slices.reduce((a, b) => a + b.value, 0));
  const arcs = $derived.by(() => {
    let off = 0;
    return slices.map((s) => {
      const frac = total > 0 ? s.value / total : 0;
      const len = frac * C;
      const a = { ...s, frac, len, off };
      off += len;
      return a;
    });
  });
  const hit = $derived(arcs.find((a) => String(a.id) === String(hoverId)));

  function toggle(id) {
    hoverId = String(hoverId) === String(id) ? null : id;
  }
</script>

<div class="donut">
  <svg viewBox="0 0 200 200" role="img" aria-label="종목별 비중 도넛 차트">
    <circle cx="100" cy="100" r={R} fill="none" stroke="var(--track)" stroke-width="30" />
    {#each arcs as a (a.id)}
      {@const on = hoverId === null || String(hoverId) === String(a.id)}
      <circle
        role="button"
        tabindex="-1"
        aria-label={a.label + " " + pct(a.frac * 100)}
        cx="100" cy="100" r={R} fill="none"
        stroke={a.color}
        stroke-width={String(hoverId) === String(a.id) ? 36 : 30}
        stroke-dasharray="{a.len.toFixed(3)} {(C - a.len).toFixed(3)}"
        stroke-dashoffset={(-a.off).toFixed(3)}
        transform="rotate(-90 100 100)"
        opacity={on ? 1 : 0.34}
        onmouseenter={() => (hoverId = a.id)}
        onmouseleave={() => (hoverId = null)}
        onclick={() => toggle(a.id)}
        onkeydown={(e) => e.key === "Enter" && toggle(a.id)}
      ><title>{a.label} {pct(a.frac * 100)}</title></circle>
    {/each}
  </svg>
  <div class="center">
    {#if hit}
      <div class="lbl">{hit.label}</div>
      <div class="big num">{pct(hit.frac * 100)}</div>
      <div class="sm num">{won(hit.value)}</div>
    {:else}
      <div class="lbl">{label}</div>
      <div class="big num">{won(total)}</div>
      {#if sub}<div class="sm">{sub}</div>{/if}
    {/if}
  </div>
</div>

<style>
  .donut{position:relative;width:100%;max-width:300px;margin:0 auto}
  svg{display:block;width:100%;height:auto;overflow:visible}
  circle[role=button]{transition:stroke-width .18s ease,opacity .18s ease;cursor:pointer;outline:none}
  .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center;padding:0 18%}
  .lbl{font-size:12px;color:var(--sub2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .big{font-size:clamp(19px,5vw,24px);font-weight:660;letter-spacing:-.03em;line-height:1.18;margin-top:3px;word-break:keep-all}
  .sm{font-size:12.5px;color:var(--sub);margin-top:3px}
  @media (prefers-reduced-motion:reduce){circle{transition:none!important}}
</style>
