<script>
  // 스크린샷 가져오기 (SPEC §5.1, 기존 index.html 이식).
  // 브라우저에서 1600px로 줄임 → Worker /import → 미리보기(체크박스) → 선택한 것만 보유로 합침 → 변화 감지 질문.
  import Sheet from "./Sheet.svelte";
  import { api } from "../lib/api.js";
  import { ui, askChanges, toast } from "../lib/ui.svelte.js";
  import { data, load } from "../lib/data.svelte.js";
  import { normalize, toMergeRow } from "../lib/calc/normalize.js";
  import { won, qtyStr } from "../lib/format.js";

  let open = $state(false);
  let msg = $state({ text: "", bad: false });
  let parsed = $state([]);
  let busy = $state(false);
  let over = $state(false);
  let fileIn = $state();

  $effect(() => {
    if (ui.importOpen) {
      open = true;
      parsed = [];
      msg = { text: "", bad: false };
    }
  });

  // 큰 캡처는 줄여서 보낸다. 토큰도 아끼고 워커 CPU 한도에도 안 걸린다
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 1600 / img.width);
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve({ b64: cv.toDataURL("image/jpeg", 0.85).split(",")[1], mt: "image/jpeg" });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 열지 못했습니다")); };
      img.src = url;
    });
  }

  /** 스크린샷에 티커가 없을 때 이름으로 기존 종목을 찾아 심볼과 분류를 잇는다. */
  function attachKnown(n, raw) {
    const known = data.positions.find((p) =>
      p.security.ysym.toUpperCase() === n.ysym.toUpperCase() || p.security.name === n.name);
    if (known) {
      n.ysym = known.security.ysym;
      n.tick = known.security.ticker;
      n.mkt = known.security.market;
    }
    const row = toMergeRow(n);
    // 분류를 모르면 보내지 않는다(기존 종목의 분류를 '기타'로 덮지 않게)
    if (!raw.sec) delete row.sector;
    if (!known && !raw.sec) row.sector = "기타";
    return { row, known: !!known };
  }

  async function handle(file) {
    if (!file || !/^image\//.test(file.type)) return (msg = { text: "이미지 파일만 됩니다.", bad: true });
    parsed = [];
    busy = true;
    msg = { text: "이미지를 읽는 중…", bad: false };
    try {
      const img = await shrink(file);
      const r = await api("/import?mt=" + encodeURIComponent(img.mt), { method: "POST", body: img.b64 });
      if (!r.rows || !r.rows.length) return (msg = { text: "표를 찾지 못했습니다. 보유 목록이 나온 화면인지 확인해 주세요.", bad: true });
      parsed = r.rows.map((raw) => {
        const n = normalize(raw, data.fx);
        return { raw, n, pick: !!n, ...(n ? attachKnown(n, raw) : {}) };
      });
      const good = parsed.filter((p) => p.n).length;
      msg = { text: "읽은 종목 " + r.rows.length + "개 중 " + good + "개를 쓸 수 있습니다. 확인하고 가져오세요.", bad: false };
    } catch (e) {
      msg = { text: "실패: " + e.message, bad: true };
    } finally {
      busy = false;
    }
  }

  async function takeIn() {
    const rows = parsed.filter((p) => p.n && p.pick).map((p) => p.row);
    if (!rows.length) return (msg = { text: "선택된 종목이 없습니다.", bad: true });
    busy = true;
    try {
      const r = await api("/portfolio/merge", { method: "POST", body: { asOwned: true, rows } });
      open = false;
      await load();
      toast("가져왔습니다. 새 종목 " + r.added + "개, 갱신 " + r.updated + "개");
      askChanges(r.changes);
    } catch (e) {
      msg = { text: "실패: " + e.message, bad: true };
    } finally {
      busy = false;
    }
  }

  function onpaste(e) {
    if (!open) return;
    for (const it of (e.clipboardData && e.clipboardData.items) || []) {
      if (it.type.startsWith("image")) { handle(it.getAsFile()); break; }
    }
  }
</script>

<svelte:window {onpaste} />

<Sheet bind:open title="스크린샷 가져오기" onclose={() => (ui.importOpen = false)}>
  <button class="drop" class:over disabled={busy}
    onclick={() => fileIn.click()}
    ondragenter={(e) => { e.preventDefault(); over = true; }}
    ondragover={(e) => { e.preventDefault(); over = true; }}
    ondragleave={() => (over = false)}
    ondrop={(e) => { e.preventDefault(); over = false; handle(e.dataTransfer.files[0]); }}>
    <span class="d1">증권사 보유 화면 캡처를 고르세요</span>
    <span class="d2">끌어다 놓기, 붙여넣기(⌘/Ctrl + V)도 됩니다</span>
  </button>
  <input bind:this={fileIn} type="file" accept="image/*" hidden onchange={(e) => { handle(e.currentTarget.files[0]); e.currentTarget.value = ""; }} />

  {#if msg.text}<p class="msg" class:bad={msg.bad} role="status">{msg.text}</p>{/if}

  {#if parsed.length}
    <div class="prev">
      <div class="prow head"><span></span><span>종목</span><span class="pr">수량</span><span class="pr hide-s">평단</span><span class="pr hide-s">현재가</span></div>
      {#each parsed as p, i (i)}
        {#if p.n}
          <label class="prow">
            <input type="checkbox" bind:checked={p.pick} aria-label="{p.n.name} 가져오기" />
            <span class="pn">{p.n.name} <span class="as">{p.row.ysym}{p.known ? "" : " · 새 종목"}</span></span>
            <span class="pr num">{qtyStr(p.n.qty)}주</span>
            <span class="pr num hide-s">{won(p.n.avg)}</span>
            <span class="pr num hide-s">{won(p.n.price)}</span>
          </label>
        {:else}
          <div class="prow bad2"><span></span><span class="pn">{p.raw.name || "이름 없음"}</span><span class="pr">읽기 실패</span><span class="hide-s"></span><span class="hide-s"></span></div>
        {/if}
      {/each}
    </div>
    <p class="hint">이미 있는 종목은 수량·평단을 덮어쓰고, 없으면 새로 추가합니다.</p>
  {/if}

  {#snippet footer()}
    <div class="acts">
      <button class="btn" onclick={() => (open = false)}>닫기</button>
      <button class="btn primary" onclick={takeIn} disabled={busy || !parsed.some((p) => p.n && p.pick)}>선택한 종목 가져오기</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .drop{width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
    padding:28px 18px;border:1.5px dashed var(--line);border-radius:14px;background:var(--bg2);text-align:center}
  .drop:hover,.drop.over{border-color:var(--accent);background:var(--card)}
  .drop:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .d1{font-size:15px;font-weight:560}
  .d2{font-size:12.5px;color:var(--sub2)}
  .msg{margin-top:12px}
  .prev{margin-top:12px;border:1px solid var(--line-soft);border-radius:12px;overflow:hidden}
  .prow{display:grid;grid-template-columns:24px minmax(0,1.5fr) 92px 110px 110px;gap:10px;align-items:center;
    min-height:44px;padding:8px 12px;font-size:14px;border-bottom:1px solid var(--line-soft)}
  .prow:last-child{border-bottom:none}
  .prow.head{font-size:12px;color:var(--sub2);background:var(--bg2);min-height:0}
  .pn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .as{font-size:12px;color:var(--sub2)}
  .pr{text-align:right}
  .prow input{width:18px;height:18px;accent-color:var(--accent)}
  .bad2{opacity:.45}
  .hint{font-size:12.5px;color:var(--sub2);margin-top:10px}
  .acts{display:flex;justify-content:flex-end;gap:8px}
  @media (max-width:640px){
    .prow{grid-template-columns:24px 1fr 96px}
    .hide-s{display:none}
  }
</style>
