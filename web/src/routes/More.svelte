<script>
  import { api, settings, DEFAULT_API_BASE } from "../lib/api.js";
  import { qtyStr } from "../lib/format.js";

  let apiBase = $state(settings.apiBase);
  let token = $state(settings.token);
  let status = $state({ kind: "idle", text: "" });
  let positions = $state([]);

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
    } catch (e) {
      status = { kind: "bad", text: e.message };
    }
  }
</script>

<header class="head">
  <h1>더보기</h1>
</header>

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

<style>
  .head{padding:clamp(22px,4vw,44px) 0 0}
  h1{font-size:clamp(22px,2.6vw,28px);font-weight:700;letter-spacing:-.02em}
  .block{max-width:640px;margin:28px auto 0;padding-top:20px;border-top:1px solid var(--line-soft)}
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
  .btn{min-height:44px;padding:0 18px;border:1px solid var(--line);border-radius:980px;font-size:15px;font-weight:550}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .btn:disabled{opacity:.5}
  .btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .status{margin-top:14px;font-size:14px;color:var(--sub)}
  .status.ok{color:var(--ink);font-weight:600}
  .status.bad{color:var(--red)}
  .list{list-style:none;margin-top:10px}
  .list li{display:flex;align-items:baseline;gap:8px;padding:10px 0;border-bottom:1px solid var(--line-soft);font-size:15px}
  .name{font-weight:550}
  .tick{font-size:13px;color:var(--sub2)}
  .qty{margin-left:auto;color:var(--sub)}
</style>
