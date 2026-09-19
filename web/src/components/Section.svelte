<script>
  // 접는 블록 (SPEC §4.2, §6.6): 헤더 전체가 클릭 영역, 오른쪽 chevron이 상태. 접힘 상태는 기기에 기억.
  import { store } from "../lib/storage.js";

  let { id, title, note = "", defaultOpen = true, children, aside } = $props();

  const key = "invest.section." + id;
  let open = $state(store.get(key, defaultOpen ? "1" : "0") === "1");

  function toggle() {
    open = !open;
    store.set(key, open ? "1" : "0");
  }
</script>

<section class="sec">
  <div class="headrow">
    <button class="head" aria-expanded={open} aria-controls={"sec-" + id} onclick={toggle}>
      <h2>{title}</h2>
      {#if note}<span class="note">{note}</span>{/if}
      <svg class="chev" class:open viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    {#if aside}<div class="aside">{@render aside()}</div>{/if}
  </div>
  {#if open}
    <div id={"sec-" + id} class="body">{@render children()}</div>
  {/if}
</section>

<style>
  .sec{border-top:1px solid var(--line-soft);padding:6px 0 18px}
  .sec:first-child{border-top:none}
  .headrow{display:flex;align-items:center;gap:8px}
  .head{flex:1;display:flex;align-items:baseline;gap:10px;min-height:48px;padding:10px 0;text-align:left}
  .head:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}
  h2{font-size:18px;font-weight:680;letter-spacing:-.02em}
  .note{font-size:12.5px;color:var(--sub2)}
  .chev{width:16px;height:16px;margin-left:auto;align-self:center;color:var(--sub2);transition:transform .2s ease;transform:rotate(-90deg)}
  .chev.open{transform:rotate(0)}
  .aside{flex:none}
  @media (prefers-reduced-motion:reduce){.chev{transition:none}}
</style>
