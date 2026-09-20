<script>
  // iOS식 바텀 시트 (SPEC §4.9). 데스크톱에서는 가운데 뜨는 패널.
  // <dialog>를 써서 포커스 가두기·Esc 닫기를 브라우저에 맡긴다.
  let { open = $bindable(false), title, onclose, children, footer } = $props();

  let dlg = $state();

  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  });

  function closed() {
    open = false;
    onclose && onclose();
  }

  function backdrop(e) {
    if (e.target === dlg) dlg.close();
  }
</script>

<dialog bind:this={dlg} onclose={closed} onclick={backdrop} aria-label={title}>
  <div class="panel">
    <div class="grab" aria-hidden="true"></div>
    <header>
      <h2>{title}</h2>
      <button class="x" aria-label="닫기" onclick={() => dlg.close()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </header>
    <div class="content">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</dialog>

<style>
  dialog{
    position:fixed;inset:auto 0 0 0;margin:0 auto;width:100%;max-width:640px;max-height:88vh;
    padding:0;border:none;background:transparent;color:var(--ink);overflow:visible;
  }
  dialog::backdrop{background:rgba(0,0,0,.32);backdrop-filter:blur(2px)}
  .panel{
    display:flex;flex-direction:column;max-height:88vh;
    background:color-mix(in srgb,var(--card) 88%,transparent);border:1px solid color-mix(in srgb,var(--line) 65%,transparent);border-bottom:0;border-radius:var(--radius-lg) var(--radius-lg) 0 0;
    backdrop-filter:blur(34px) saturate(185%);-webkit-backdrop-filter:blur(34px) saturate(185%);
    box-shadow:0 -8px 40px rgba(0,0,0,.18),inset 0 1px 0 color-mix(in srgb,#fff 42%,transparent);
    padding-bottom:env(safe-area-inset-bottom);
    animation:up .26s cubic-bezier(.22,1,.36,1);
  }
  .grab{width:36px;height:5px;border-radius:99px;background:var(--line);margin:8px auto 0}
  header{display:flex;align-items:center;gap:12px;padding:10px 20px 6px}
  h2{font-size:18px;font-weight:680;letter-spacing:-.02em;flex:1}
  .x{width:44px;height:44px;margin-right:-10px;display:flex;align-items:center;justify-content:center;color:var(--sub);border-radius:50%}
  .x svg{width:16px;height:16px}
  .x:focus-visible{outline:2px solid var(--accent)}
  .content{overflow-y:auto;padding:4px 20px 16px;-webkit-overflow-scrolling:touch}
  footer{padding:12px 20px 16px;border-top:1px solid var(--line-soft)}
  @keyframes up{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}
  @media (min-width:900px){
    dialog{inset:0;margin:auto;height:fit-content}
    .panel{border:1px solid color-mix(in srgb,var(--line) 65%,transparent);border-radius:var(--radius-lg)}
    .grab{display:none}
  }
  @media (prefers-reduced-motion:reduce){.panel{animation:none}}
</style>
