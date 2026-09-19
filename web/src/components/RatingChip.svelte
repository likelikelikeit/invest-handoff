<script>
  import { ratingTone } from "../lib/ratings.js";
  let { rating, score } = $props();
</script>

<span class="chip {ratingTone(score)}">{rating}</span>

<style>
  .chip{display:inline-block;font-size:11.5px;font-weight:640;padding:1px 7px;border-radius:6px;white-space:nowrap}
  .up{background:color-mix(in srgb,var(--up) 13%,transparent);color:var(--up)}
  .down{background:color-mix(in srgb,var(--down) 13%,transparent);color:var(--down)}
  .flat{background:var(--bg2);color:var(--sub)}
</style>
