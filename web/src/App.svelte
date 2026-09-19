<script>
  import { onMount } from "svelte";
  import { route } from "./lib/router.svelte.js";
  import { TABS, activeTab } from "./lib/tabs.js";
  import { settings } from "./lib/api.js";
  import { load } from "./lib/data.svelte.js";
  import { ui, askChanges, loadPendingChanges } from "./lib/ui.svelte.js";
  import { applySavedTheme } from "./lib/theme.js";
  import Placeholder from "./routes/Placeholder.svelte";
  import Home from "./routes/Home.svelte";
  import Securities from "./routes/Securities.svelte";
  import Security from "./routes/Security.svelte";
  import Portfolio from "./routes/Portfolio.svelte";
  import More from "./routes/More.svelte";
  import Views from "./routes/Views.svelte";
  import Rules from "./routes/Rules.svelte";
  import Calendar from "./routes/Calendar.svelte";
  import Macro from "./routes/Macro.svelte";
  import Fab from "./components/Fab.svelte";
  import AddSheet from "./components/AddSheet.svelte";
  import ImportSheet from "./components/ImportSheet.svelte";
  import ChangeSheet from "./components/ChangeSheet.svelte";
  import ViewForm from "./components/ViewForm.svelte";
  import TechSheet from "./components/TechSheet.svelte";

  const current = $derived(activeTab(route.parts));
  const titles = Object.fromEntries(TABS.map((t) => [t.key, t.label]));
  const securityId = $derived(route.parts[0] === "security" ? Number(route.parts[1]) : null);

  onMount(async () => {
    applySavedTheme();
    if (settings.token) {
      await load();
      // 답하지 않은 보유 변화가 남아 있으면 다시 묻는다
      askChanges(await loadPendingChanges());
    }
  });

  // 화면을 바꾸면 맨 위로
  $effect(() => {
    route.path;
    window.scrollTo(0, 0);
  });
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
    {#if securityId}
      {#key securityId}<Security id={securityId} />{/key}
    {:else if current === "home"}
      <Home />
    {:else if current === "securities"}
      <Securities />
    {:else if current === "portfolio"}
      <Portfolio />
    {:else if current === "views"}
      <Views />
    {:else if current === "more" && route.parts[1] === "rules"}
      <Rules />
    {:else if current === "more" && route.parts[1] === "calendar"}
      <Calendar />
    {:else if current === "more" && route.parts[1] === "macro"}
      <Macro />
    {:else if current === "more"}
      <More />
    {:else}
      <Placeholder title={titles[current]} note="준비 중" />
    {/if}
  </main>

  {#if settings.token}<Fab />{/if}
  <AddSheet />
  <ImportSheet />
  <ChangeSheet />
  <ViewForm />
  <TechSheet />

  {#if ui.toast}<div class="toast" role="status">{ui.toast}</div>{/if}
</div>

<style>
  .wrap{max-width:1180px;margin:0 auto;padding:0 clamp(16px,3.5vw,32px) calc(var(--tabbar-h) + 96px + env(safe-area-inset-bottom))}

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

  .toast{
    position:fixed;left:50%;transform:translateX(-50%);z-index:20;
    bottom:calc(var(--tabbar-h) + 88px + env(safe-area-inset-bottom));
    max-width:min(92vw,480px);padding:10px 16px;border-radius:14px;
    background:var(--ink);color:var(--bg);font-size:14px;font-weight:550;box-shadow:0 8px 28px rgba(0,0,0,.2);
  }

  /* 데스크톱: 상단 가로 탭 (SPEC §4.8 넓은 레이아웃은 화면마다 따로 잡는다) */
  @media (min-width:900px){
    .tabbar{
      position:sticky;top:0;bottom:auto;height:auto;padding:0 clamp(16px,3.5vw,32px);
      display:flex;gap:4px;justify-content:center;
      border-top:none;border-bottom:1px solid var(--line-soft);
    }
    .tabbar a{padding:14px 16px;font-size:14px}
    .wrap{padding-bottom:80px}
    .toast{bottom:32px}
  }
</style>
