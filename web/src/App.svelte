<script>
  import { route } from "./lib/router.svelte.js";
  import { TABS, activeTab } from "./lib/tabs.js";
  import Placeholder from "./routes/Placeholder.svelte";
  import More from "./routes/More.svelte";

  const current = $derived(activeTab(route.parts));
  const titles = Object.fromEntries(TABS.map((t) => [t.key, t.label]));
</script>

<div class="shell">
  <nav class="tabbar" aria-label="주요 화면">
    {#each TABS as t (t.key)}
      <a href={t.href} class:on={current === t.key} aria-current={current === t.key ? "page" : undefined}>
        {t.label}
      </a>
    {/each}
  </nav>

  <main class="wrap">
    {#if route.parts[0] === "security" && route.parts[1]}
      <Placeholder title="종목 상세" note={"id " + route.parts[1]} />
    {:else if current === "more"}
      <More />
    {:else}
      <Placeholder title={titles[current]} note="준비 중" />
    {/if}
  </main>
</div>

<style>
  .wrap{max-width:1180px;margin:0 auto;padding:0 clamp(16px,3.5vw,32px) calc(var(--tabbar-h) + 40px + env(safe-area-inset-bottom))}

  /* 모바일: 하단 고정 탭 */
  .tabbar{
    position:fixed;left:0;right:0;bottom:0;z-index:10;
    display:grid;grid-template-columns:repeat(5,1fr);
    height:calc(var(--tabbar-h) + env(safe-area-inset-bottom));
    padding-bottom:env(safe-area-inset-bottom);
    background:color-mix(in srgb,var(--bg) 88%,transparent);
    backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
    border-top:1px solid var(--line-soft);
  }
  .tabbar a{
    display:flex;align-items:center;justify-content:center;min-height:44px;
    font-size:12px;font-weight:600;color:var(--sub2);
  }
  .tabbar a.on{color:var(--ink)}
  .tabbar a:focus-visible{outline:2px solid var(--accent);outline-offset:-4px;border-radius:8px}

  /* 데스크톱: 상단 가로 탭 (SPEC §4.8 넓은 레이아웃은 화면마다 따로 잡는다) */
  @media (min-width:900px){
    .tabbar{
      position:sticky;top:0;bottom:auto;height:auto;padding:0 clamp(16px,3.5vw,32px);
      display:flex;gap:4px;justify-content:center;
      border-top:none;border-bottom:1px solid var(--line-soft);
    }
    .tabbar a{padding:14px 16px;font-size:14px}
    .wrap{padding-bottom:80px}
  }
</style>
