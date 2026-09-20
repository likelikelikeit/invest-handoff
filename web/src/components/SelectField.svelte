<script>
  import { onMount } from "svelte";

  let {
    value = $bindable(), options = [], placeholder = "고르세요", ariaLabel = "옵션 선택",
    compact = false, inline = false, onchange,
  } = $props();
  let open = $state(false);
  let root = $state();

  const selected = $derived(options.find((o) => String(o.value) === String(value)) || null);

  function choose(option) {
    if (option.disabled) return;
    value = option.value;
    open = false;
    onchange?.(option.value);
  }

  function keydown(e) {
    if (e.key === "Escape") open = false;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      e.preventDefault();
      open = true;
    }
  }

  onMount(() => {
    const outside = (e) => { if (open && root && !root.contains(e.target)) open = false; };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  });
</script>

<span class="select" class:compact class:inline bind:this={root}>
  <button type="button" class="trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
    onclick={() => (open = !open)} onkeydown={keydown}>
    <span>{selected?.label || placeholder}</span>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  {#if open}
    <span class="options" role="listbox" aria-label={ariaLabel}>
      {#each options as option (String(option.value))}
        <button type="button" role="option" aria-selected={String(option.value) === String(value)} disabled={option.disabled}
          onclick={() => choose(option)}>
          <span>{option.label}</span>
          {#if String(option.value) === String(value)}<b aria-hidden="true">✓</b>{/if}
        </button>
      {/each}
    </span>
  {/if}
</span>

<style>
  .select{position:relative;display:block;min-width:0}
  .trigger{width:100%;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 11px 8px 13px;border:1px solid color-mix(in srgb,var(--line) 84%,transparent);border-radius:12px;background:color-mix(in srgb,var(--card) 72%,transparent);backdrop-filter:blur(16px) saturate(160%);-webkit-backdrop-filter:blur(16px) saturate(160%);font-size:15px;text-align:left;box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 45%,transparent),0 2px 8px rgba(0,0,0,.035)}
  .trigger span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .trigger svg{width:16px;height:16px;flex:none;color:var(--sub2);transition:transform .18s}
  .trigger[aria-expanded="true"] svg{transform:rotate(180deg)}
  .trigger:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .options{position:absolute;z-index:55;left:0;top:calc(100% + 6px);min-width:100%;width:max-content;max-width:min(360px,calc(100vw - 32px));max-height:280px;overflow:auto;padding:6px;border:1px solid color-mix(in srgb,var(--line) 72%,transparent);border-radius:16px;background:color-mix(in srgb,var(--card) 82%,transparent);backdrop-filter:blur(28px) saturate(190%);-webkit-backdrop-filter:blur(28px) saturate(190%);box-shadow:0 16px 44px rgba(0,0,0,.18)}
  .options button{width:100%;min-height:40px;display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:11px;text-align:left;font-size:14px}
  .options button:hover,.options button[aria-selected="true"]{background:color-mix(in srgb,var(--accent) 10%,var(--bg2))}
  .options button span{flex:1;min-width:0;white-space:normal;line-height:1.35}
  .options b{color:var(--accent);font-size:13px}
  .options button:disabled{opacity:.4}
  .compact{display:inline-block;min-width:118px}
  .compact .trigger{min-height:40px;padding:6px 9px 6px 11px;border-radius:11px;font-size:13.5px}
  .inline{display:inline-block;min-width:0}
  .inline .trigger{min-height:28px;padding:2px 6px;border:0;border-radius:8px;background:transparent;box-shadow:none;font-size:12px;color:var(--sub2)}
  .inline .trigger svg{width:12px;height:12px}
  .inline .options{left:auto;right:0;min-width:160px}
</style>
