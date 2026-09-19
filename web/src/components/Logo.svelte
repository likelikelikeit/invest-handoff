<script>
  // 종목 로고: Brandfetch(<img> 핫링크만, 약관) → 없으면 이니셜 레터마크.
  // 미국은 ticker/, 국내는 계산한 ISIN으로 isin/ 경로. fallback/404로 받아 onerror에서 레터마크로 바꾼다.
  import { BRANDFETCH_CLIENT_ID } from "../lib/config.js";
  import { krIsin } from "../lib/calc/normalize.js";

  let { h, color = "var(--sub2)", size = 36 } = $props();

  function src(h) {
    if (!BRANDFETCH_CLIENT_ID) return null;
    const id = h.mkt === "KR" ? (h.isin || krIsin(h.tick)) : h.tick;
    if (!id) return null;
    const kind = h.mkt === "KR" ? "isin" : "ticker";
    const px = size * 2; // 레티나
    return "https://cdn.brandfetch.io/" + kind + "/" + encodeURIComponent(id) +
      "/w/" + px + "/h/" + px + "/fallback/404/icon?c=" + BRANDFETCH_CLIENT_ID;
  }

  let failed = $state(false);
  const url = $derived(src(h));
  const initial = $derived(String(h.name || h.tick || "?").trim().slice(0, 1).toUpperCase());
</script>

<span class="logo" style:width="{size}px" style:height="{size}px" style:--c={color}>
  {#if url && !failed}
    <img src={url} alt="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" onerror={() => (failed = true)} />
  {:else}
    <span class="mark" style:font-size="{Math.round(size * 0.42)}px" aria-hidden="true">{initial}</span>
  {/if}
</span>

<style>
  .logo{
    display:inline-flex;flex:none;border-radius:50%;overflow:hidden;
    background:var(--bg2);box-shadow:inset 0 0 0 1px var(--line-soft);
  }
  img{width:100%;height:100%;object-fit:cover;display:block}
  .mark{
    width:100%;height:100%;display:flex;align-items:center;justify-content:center;
    background:var(--c);color:#fff;font-weight:650;letter-spacing:-.02em;
  }
</style>
