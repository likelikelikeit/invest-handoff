<script>
  // 작은 '?' 설명 팝오버.
  // 말풍선은 화면 기준(position:fixed)으로 띄운다. 시트 본문처럼 overflow:auto인 부모 안에서
  // absolute로 두면 잘려서 일부만 보인다. 아래 공간이 모자라면 버튼 위로 뒤집는다.
  let { text, label = "설명 보기" } = $props();
  let open = $state(false);
  let btn = $state();
  let pos = $state({ left: 0, top: 0, width: 280, above: false });

  const MARGIN = 12;   // 화면 가장자리 여백
  const GAP = 8;       // 버튼과 말풍선 사이

  function place() {
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - MARGIN * 2);
    // 버튼 오른쪽 끝에 맞추되 화면 밖으로 나가지 않게 가둔다
    const left = Math.min(Math.max(MARGIN, r.right - width), window.innerWidth - MARGIN - width);
    const below = window.innerHeight - r.bottom;
    const above = below < 150 && r.top > below;
    pos = { left, top: above ? r.top - GAP : r.bottom + GAP, width, above };
  }

  function toggle() {
    open = !open;
    if (open) place();
  }

  function keydown(e) {
    if (e.key === "Escape") open = false;
  }

  $effect(() => {
    if (!open) return;
    const reflow = () => place();
    const outside = (e) => { if (btn && !btn.contains(e.target)) open = false; };
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
      document.removeEventListener("pointerdown", outside);
    };
  });
</script>

<span class="tip">
  <button bind:this={btn} type="button" class:open aria-label={label} aria-expanded={open} onclick={toggle} onkeydown={keydown}>?</button>
</span>

{#if open}
  <span class="bubble" class:above={pos.above} role="tooltip"
    style="left:{pos.left}px; top:{pos.top}px; width:{pos.width}px">{text}</span>
{/if}

<style>
  .tip{position:relative;display:inline-flex;vertical-align:middle;flex:none}
  button{width:22px;height:22px;border:1px solid color-mix(in srgb,var(--line) 72%,transparent);border-radius:50%;font-size:12px;font-weight:720;color:var(--sub);background:color-mix(in srgb,var(--card) 62%,transparent);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);box-shadow:0 2px 8px rgba(0,0,0,.06)}
  button.open{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
  button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .bubble{position:fixed;z-index:1000;padding:10px 12px;border:1px solid color-mix(in srgb,var(--line) 72%,transparent);border-radius:14px;
    background:color-mix(in srgb,var(--card) 92%,transparent);backdrop-filter:blur(28px) saturate(190%);-webkit-backdrop-filter:blur(28px) saturate(190%);
    box-shadow:0 12px 36px rgba(0,0,0,.16);font-size:12.5px;font-weight:450;line-height:1.5;color:var(--sub);white-space:normal;word-break:keep-all}
  .bubble.above{transform:translateY(-100%)}
</style>
