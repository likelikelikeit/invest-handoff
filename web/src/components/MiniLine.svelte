<script>
  // 재무 핵심 항목 미니 차트. 축약값을 계산하지 않고 화면 좌표만 만든다.
  let { points = [], color = "var(--accent)", label = "추이" } = $props();
  const W = 640, H = 150, X = 8, Y = 14;
  const values = $derived(points.map((p) => p.value));
  const lo = $derived(values.length ? Math.min(...values) : 0);
  const hi = $derived(values.length ? Math.max(...values) : 0);
  const coords = $derived(points.map((p, i) => {
    const x = points.length < 2 ? W / 2 : X + i * (W - X * 2) / (points.length - 1);
    const y = hi === lo ? H / 2 : Y + (hi - p.value) * (H - Y * 2) / (hi - lo);
    return { ...p, x, y };
  }));
  const line = $derived(coords.map((p) => p.x + "," + p.y).join(" "));
  const area = $derived(coords.length ? X + "," + (H - Y) + " " + line + " " + (W - X) + "," + (H - Y) : "");
</script>

<div class="chart" role="img" aria-label={label}>
  {#if coords.length > 1}
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="fin-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color={color} stop-opacity=".16"/><stop offset="1" stop-color={color} stop-opacity="0"/></linearGradient></defs>
      <polygon points={area} fill="url(#fin-fill)" />
      <polyline points={line} fill="none" stroke={color} stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
      {#each coords as p (p.date)}<circle cx={p.x} cy={p.y} r="3" fill="var(--bg)" stroke={color} stroke-width="2" vector-effect="non-scaling-stroke" />{/each}
    </svg>
  {:else}
    <p>추이를 그릴 데이터가 부족합니다.</p>
  {/if}
</div>

<style>
  .chart{height:150px;width:100%;margin:8px 0 2px}
  svg{display:block;width:100%;height:100%;overflow:visible}
  p{display:flex;align-items:center;justify-content:center;height:100%;font-size:13px;color:var(--sub2)}
</style>
