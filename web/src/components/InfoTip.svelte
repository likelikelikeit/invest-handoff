<script>
  let { text, label = "설명 보기" } = $props();
  let open = $state(false);

  function keydown(e) {
    if (e.key === "Escape") open = false;
  }
</script>

<span class="tip" onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) open = false; }}>
  <button type="button" class:open aria-label={label} aria-expanded={open} onclick={() => (open = !open)} onkeydown={keydown}>?</button>
  {#if open}<span class="bubble" role="tooltip">{text}</span>{/if}
</span>

<style>
  .tip{position:relative;display:inline-flex;vertical-align:middle;flex:none}
  button{width:22px;height:22px;border:1px solid color-mix(in srgb,var(--line) 72%,transparent);border-radius:50%;font-size:12px;font-weight:720;color:var(--sub);background:color-mix(in srgb,var(--card) 62%,transparent);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);box-shadow:0 2px 8px rgba(0,0,0,.06)}
  button.open{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
  button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .bubble{position:absolute;z-index:60;right:0;top:calc(100% + 7px);width:max-content;max-width:min(300px,calc(100vw - 40px));padding:10px 12px;border:1px solid color-mix(in srgb,var(--line) 72%,transparent);border-radius:14px;background:color-mix(in srgb,var(--card) 82%,transparent);backdrop-filter:blur(28px) saturate(190%);-webkit-backdrop-filter:blur(28px) saturate(190%);box-shadow:0 12px 36px rgba(0,0,0,.16);font-size:12.5px;font-weight:450;line-height:1.5;color:var(--sub);white-space:normal;word-break:keep-all}
</style>
