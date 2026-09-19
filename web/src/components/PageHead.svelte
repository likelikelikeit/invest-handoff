<script>
  let { title, children } = $props();
</script>

<header class="head">
  {#if title}<h1>{title}</h1>{:else}<span class="grow"></span>{/if}
  {#if children}<div class="aside">{@render children()}</div>{/if}
</header>

<style>
  .head{display:flex;align-items:flex-end;gap:12px;padding:clamp(20px,4vw,40px) 0 10px}
  h1{font-size:clamp(24px,3vw,30px);font-weight:720;letter-spacing:-.025em;flex:1}
  .aside{display:flex;gap:8px;flex:none}
  .grow{flex:1}
</style>
