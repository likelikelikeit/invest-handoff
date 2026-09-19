<script>
  // 더보기 (SPEC §4.6): 스크린샷 가져오기 · 설정(토큰, 서버 주소, 테마, 데이터 내보내기).
  // 일정 캘린더·거시 상세·판정 규칙 편집은 해당 마일스톤에서.
  import PageHead from "../components/PageHead.svelte";
  import { api, settings, DEFAULT_API_BASE } from "../lib/api.js";
  import { load } from "../lib/data.svelte.js";
  import { ui } from "../lib/ui.svelte.js";
  import { setTheme, themeMode } from "../lib/theme.js";
  import { qtyStr } from "../lib/format.js";

  let apiBase = $state(settings.apiBase);
  let token = $state(settings.token);
  let status = $state({ kind: "idle", text: "" });
  let positions = $state([]);
  let theme = $state(themeMode());

  function save() {
    settings.apiBase = apiBase.trim() === DEFAULT_API_BASE ? "" : apiBase.trim();
    settings.token = token;
    apiBase = settings.apiBase;
    status = { kind: "idle", text: "저장했습니다" };
  }

  async function check() {
    save();
    status = { kind: "busy", text: "확인 중…" };
    positions = [];
    try {
      const data = await api("/portfolio");
      positions = data.positions;
      status = { kind: "ok", text: "연결됨 · 보유 " + data.positions.length + "종목" };
      load();
    } catch (e) {
      status = { kind: "bad", text: e.message };
    }
  }

  function pickTheme(m) {
    theme = m;
    setTheme(m);
  }

  // 데이터 내보내기: 지금 서버에 있는 보유·현금·종목·관심·변화 기록·저장한 시뮬을 JSON 한 파일로.
  let exporting = $state(false);
  async function exportJson() {
    exporting = true;
    try {
      const [pf, secs, wl, ch, sc] = await Promise.all([
        api("/portfolio"), api("/securities?all=1"), api("/watchlist"), api("/portfolio/changes"), api("/portfolio/scenarios"),
      ]);
      const out = { exported_at: new Date().toISOString(), positions: pf.positions, cash: pf.cash,
        securities: secs.securities, watchlist: wl.watchlist, position_changes: ch.changes, portfolio_scenarios: sc.scenarios };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "invest-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      status = { kind: "bad", text: "내보내기 실패: " + e.message };
    } finally {
      exporting = false;
    }
  }
</script>

<PageHead title="더보기" />

<div class="page">
  <ul class="menu">
    <li><a class="mlink" href="#/more/calendar"><span class="m1">일정</span><span class="m2">FOMC·금통위·CPI·실적 발표, 직접 추가</span></a></li>
    <li><a class="mlink" href="#/more/macro"><span class="m1">거시</span><span class="m2">한·미 기준금리, 금리 경로, 점도표 입력</span></a></li>
    <li><a class="mlink" href="#/more/rules"><span class="m1">판정 규칙</span><span class="m2">매수·매도 계기판의 과열·침체 기준과 가중치 (버전 이력)</span></a></li>
    <li><button onclick={() => (ui.importOpen = true)} disabled={!settings.token}>
      <span class="m1">스크린샷 가져오기</span><span class="m2">증권사 보유 화면 캡처로 보유 갱신</span>
    </button></li>
  </ul>

  <section class="block" aria-labelledby="settings-title">
    <h2 id="settings-title">설정</h2>

    <label class="field">
      <span>서버 주소</span>
      <input type="url" bind:value={apiBase} spellcheck="false" autocomplete="off" autocapitalize="off" />
    </label>

    <label class="field">
      <span>토큰</span>
      <input type="password" bind:value={token} placeholder="APP_TOKEN 붙여넣기" spellcheck="false" autocomplete="off" autocapitalize="off" />
    </label>
    <p class="hint">토큰은 이 기기에만 저장됩니다. 기기마다 한 번 넣으면 됩니다.</p>

    <div class="actions">
      <button class="btn" onclick={save}>저장</button>
      <button class="btn primary" onclick={check} disabled={status.kind === "busy"}>연결 확인</button>
    </div>

    {#if status.text}
      <p class="status {status.kind}" role="status">{status.text}</p>
    {/if}

    {#if positions.length}
      <ul class="list">
        {#each positions as p (p.security_id)}
          <li>
            <span class="name">{p.security.name}</span>
            <span class="tick">{p.security.ticker}</span>
            <span class="qty num">{qtyStr(p.qty)}주</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="block" aria-labelledby="theme-title">
    <h2 id="theme-title">테마</h2>
    <div class="seg" role="radiogroup" aria-label="테마">
      {#each [["system", "시스템"], ["light", "라이트"], ["dark", "다크"]] as [k, l] (k)}
        <button role="radio" aria-checked={theme === k} class:on={theme === k} onclick={() => pickTheme(k)}>{l}</button>
      {/each}
    </div>
  </section>

  <section class="block" aria-labelledby="export-title">
    <h2 id="export-title">데이터 내보내기</h2>
    <p class="hint">보유·현금·종목·관심·보유 변화 기록·저장한 시뮬을 JSON 파일 하나로 받습니다.</p>
    <button class="btn" onclick={exportJson} disabled={!settings.token || exporting}>{exporting ? "모으는 중…" : "JSON 내보내기"}</button>
  </section>
</div>

<style>
  .page{max-width:640px;margin:0 auto}
  .menu{list-style:none;border-top:1px solid var(--line-soft)}
  .menu li{border-bottom:1px solid var(--line-soft)}
  .menu button,.menu .mlink{width:100%;display:flex;flex-direction:column;align-items:flex-start;min-height:60px;padding:12px 0;text-align:left}
  .menu button:disabled{opacity:.45}
  .m1{font-size:16px;font-weight:600}
  .m2{font-size:13px;color:var(--sub2)}
  .block{margin-top:28px;padding-top:20px;border-top:1px solid var(--line-soft)}
  h2{font-size:17px;font-weight:650;margin-bottom:14px}
  .field{display:block;margin-bottom:12px}
  .field span{display:block;font-size:13px;color:var(--sub);margin-bottom:4px}
  .field input{
    width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;
    background:var(--bg);font-size:16px;
  }
  .field input:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
  .hint{font-size:13px;color:var(--sub2);margin:-4px 0 14px}
  .actions{display:flex;gap:8px}
  .actions .btn{min-height:44px}
  .status{margin-top:14px;font-size:14px;color:var(--sub)}
  .status.ok{color:var(--ink);font-weight:600}
  .status.bad{color:var(--red)}
  .list{list-style:none;margin-top:10px}
  .list li{display:flex;align-items:baseline;gap:8px;padding:10px 0;border-bottom:1px solid var(--line-soft);font-size:15px}
  .name{font-weight:550}
  .tick{font-size:13px;color:var(--sub2)}
  .qty{margin-left:auto;color:var(--sub)}
  .seg{display:inline-flex;padding:3px;border-radius:12px;background:var(--bg2)}
  .seg button{min-height:40px;padding:0 18px;border-radius:9px;font-size:14px;color:var(--sub)}
  .seg button.on{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .seg button:focus-visible{outline:2px solid var(--accent)}
</style>
