<script>
  let { title, note = "" } = $props();
</script>

<header class="head">
  <h1>{title}</h1>
  {#if note}<p>{note}</p>{/if}
</header>

<style>
  .head{padding:clamp(22px,4vw,44px) 0 0}
  h1{font-size:clamp(22px,2.6vw,28px);font-weight:700;letter-spacing:-.02em}
  p{font-size:14px;color:var(--sub2);margin-top:4px}
</style>
