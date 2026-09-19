<script>
  // 전역 + 버튼 (SPEC §4.7). M2: 스크린샷 가져오기 / 종목 추가. 의견 기록(M4)·판정(M6)은 해당 마일스톤에서.
  import Sheet from "./Sheet.svelte";
  import { ui } from "../lib/ui.svelte.js";

  let open = $state(false);

  function go(fn) {
    open = false;
    fn();
  }
</script>

<button class="fab" aria-label="추가" onclick={() => (open = true)}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
</button>

<Sheet bind:open title="추가">
  <ul class="menu">
    <li><button onclick={() => go(() => (ui.importOpen = true))}><span class="m1">스크린샷 가져오기</span><span class="m2">증권사 보유 화면으로 한 번에 갱신</span></button></li>
    <li><button onclick={() => go(() => (ui.add = {}))}><span class="m1">종목 추가</span><span class="m2">보유 등록 · 매수 시뮬 · 관심</span></button></li>
  </ul>
</Sheet>

<style>
  .fab{
    position:fixed;right:max(16px,env(safe-area-inset-right));z-index:11;
    bottom:calc(var(--tabbar-h) + 16px + env(safe-area-inset-bottom));
    width:56px;height:56px;border-radius:50%;background:var(--accent);color:#fff;
    display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,113,227,.35);
  }
  .fab svg{width:24px;height:24px}
  .fab:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
  .menu{list-style:none}
  .menu li{border-bottom:1px solid var(--line-soft)}
  .menu li:last-child{border-bottom:none}
  .menu button{width:100%;display:flex;flex-direction:column;align-items:flex-start;min-height:60px;padding:12px 0;text-align:left}
  .m1{font-size:16px;font-weight:600}
  .m2{font-size:13px;color:var(--sub2)}
  @media (min-width:900px){ .fab{bottom:32px;right:32px} }
</style>
