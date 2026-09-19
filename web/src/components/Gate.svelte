<script>
  // 데이터가 필요한 화면 공통: 토큰 없음 / 불러오는 중 / 에러 / 본문.
  import { data, load } from "../lib/data.svelte.js";
  import { settings } from "../lib/api.js";

  let { children } = $props();
</script>

{#if !settings.token}
  <div class="blank">
    <p class="b1">토큰이 없습니다</p>
    <p class="b2">더보기 → 설정에서 토큰을 한 번 넣으면 이 기기에서 계속 열립니다.</p>
    <a class="btn primary" href="#/more">설정으로</a>
  </div>
{:else if data.error && !data.loaded}
  <div class="blank">
    <p class="b1">불러오지 못했습니다</p>
    <p class="b2">{data.error}</p>
    <button class="btn" onclick={load}>다시 시도</button>
  </div>
{:else if !data.loaded}
  <p class="loading">불러오는 중…</p>
{:else}
  {@render children()}
{/if}

<style>
  .blank{padding:48px 0;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}
  .b1{font-size:16px;font-weight:620}
  .b2{font-size:14px;color:var(--sub);max-width:40ch;word-break:keep-all;margin-bottom:8px}
  .loading{padding:48px 0;text-align:center;color:var(--sub2);font-size:14px}
</style>
