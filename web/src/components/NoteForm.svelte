<script>
  // 메모 쓰기·편집 시트 (SPEC §5.9). 목표가·등급이 없는 자유 기록이다.
  // 의견 폼과 같은 장치: 과거 날짜로 기록, 임시 저장, 내용이 있으면 바깥 클릭으로 안 닫힘.
  import { untrack } from "svelte";
  import Sheet from "./Sheet.svelte";
  import InfoTip from "./InfoTip.svelte";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { data } from "../lib/data.svelte.js";
  import { store } from "../lib/storage.js";
  import { todayKst } from "../lib/today.js";

  const STANCES = [["positive", "긍정"], ["neutral", "중립"], ["negative", "부정"]];
  const DRAFT_KEY = "invest.notedraft";
  const maxDate = todayKst();

  let open = $state(false);
  let edit = $state(null);
  let f = $state(fresh());
  let tagInput = $state("");
  let suggested = $state([]);
  let backdate = $state(false);
  let restored = $state(false);
  let busy = $state(false);
  let err = $state("");

  function fresh() {
    return { title: "", body: "", tags: [], stance: "", securities: [], asOf: "" };
  }

  const hasContent = () => Boolean(f.title?.trim() || f.body?.trim() || f.tags.length || f.securities.length);

  // 고를 수 있는 종목: 보유 + 의견 있는 종목
  const choices = $derived.by(() => {
    const m = new Map();
    for (const p of data.positions) m.set(p.security_id, p.security.name);
    for (const v of data.views) if (!m.has(v.security_id)) m.set(v.security_id, v.name);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  });

  function saveDraft() {
    if (edit || !open) return;
    if (!hasContent()) return store.remove(DRAFT_KEY);
    try {
      store.set(DRAFT_KEY, JSON.stringify({ f, backdate }));
    } catch { /* 무시 */ }
  }

  function dropDraft() {
    store.remove(DRAFT_KEY);
    restored = false;
    f = fresh();
    backdate = false;
  }

  $effect(() => {
    const req = ui.noteForm;
    if (!req) return;
    untrack(async () => {
      err = "";
      restored = false;
      backdate = false;
      edit = req.edit || null;
      if (edit) {
        f = {
          title: edit.title, body: edit.body || "", tags: [...edit.tags], stance: edit.stance || "",
          securities: edit.securities.map((s) => s.security_id), asOf: "",
        };
      } else {
        f = fresh();
        if (req.securityId) f.securities = [req.securityId];
        try {
          const d = JSON.parse(store.get(DRAFT_KEY, "") || "null");
          if (d?.f) { f = { ...fresh(), ...d.f }; backdate = Boolean(d.backdate); restored = true; }
        } catch { /* 무시 */ }
      }
      open = true;
      try {
        suggested = (await api("/notes/tags")).tags.map((t) => t.tag);
      } catch {
        suggested = [];
      }
    });
  });

  // 입력이 바뀔 때마다 임시 저장
  $effect(() => {
    const snap = [f.title, f.body, f.tags.length, f.stance, f.securities.length, f.asOf, backdate];
    void snap;
    untrack(() => saveDraft());
  });

  function addTag(raw) {
    const t = String(raw || tagInput).trim().replace(/^#/, "");
    if (!t || f.tags.includes(t) || f.tags.length >= 12) return (tagInput = "");
    f.tags = [...f.tags, t];
    tagInput = "";
  }
  const dropTag = (t) => (f.tags = f.tags.filter((x) => x !== t));
  const toggleSec = (id) =>
    (f.securities = f.securities.includes(id) ? f.securities.filter((x) => x !== id) : [...f.securities, id]);

  async function save() {
    if (!f.title.trim()) return (err = "제목을 넣으세요");
    if (backdate && !f.asOf) return (err = "기록할 과거 날짜를 고르세요");
    busy = true;
    err = "";
    const body = {
      title: f.title, body: f.body, tags: f.tags, stance: f.stance || null, securities: f.securities,
      ...(backdate && f.asOf ? { as_of: f.asOf } : {}),
    };
    try {
      if (edit) {
        await api("/notes/" + edit.id, { method: "PATCH", body });
        toast("종합 의견을 수정했습니다");
      } else {
        const r = await api("/notes", { method: "POST", body });
        store.remove(DRAFT_KEY);
        restored = false;
        toast(r.note.backdated ? f.asOf + " 시점으로 종합 의견을 기록했습니다" : "종합 의견을 기록했습니다");
      }
      open = false;
      window.dispatchEvent(new CustomEvent("notes-changed"));
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={edit ? "종합 의견 편집" : "종합 의견 쓰기"} onclose={() => (ui.noteForm = null)} guardClose={() => !edit && hasContent()}>
  <div class="form">
    {#if restored}
      <p class="draft">쓰다 만 내용을 불러왔습니다.
        <button class="btn sm" onclick={dropDraft}>지우고 새로 쓰기</button>
      </p>
    {/if}

    <label><span>제목</span>
      <input bind:value={f.title} placeholder="예: 에이전틱 AI 확산으로 CPU 주목" />
    </label>

    <fieldset>
      <legend>방향성 <InfoTip label="방향성" text="가벼운 방향 표시입니다. 종목 투자의견의 8등급과 다르고, 성과 평가에도 들어가지 않습니다. 비워둬도 됩니다." /></legend>
      <div class="seg" role="radiogroup" aria-label="방향성">
        {#each STANCES as [k, l] (k)}
          <button role="radio" aria-checked={f.stance === k} class:on={f.stance === k}
            onclick={() => (f.stance = f.stance === k ? "" : k)}>{l}</button>
        {/each}
      </div>
    </fieldset>

    <label><span>본문</span>
      <textarea bind:value={f.body} rows="8"
        placeholder="줄바꿈으로 나누면 불릿, 빈 줄로 나누면 문단으로 보입니다. 길게 써도 됩니다."></textarea>
    </label>

    <div class="tags">
      <span class="lbl">태그</span>
      <div class="chips">
        {#each f.tags as t (t)}
          <button class="chip on" onclick={() => dropTag(t)} aria-label="{t} 태그 빼기">#{t} ×</button>
        {/each}
      </div>
      <input bind:value={tagInput} placeholder="태그를 쓰고 엔터 (예: AI, 매크로)"
        onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
      {#if suggested.filter((t) => !f.tags.includes(t)).length}
        <div class="chips">
          {#each suggested.filter((t) => !f.tags.includes(t)).slice(0, 8) as t (t)}
            <button class="chip" onclick={() => addTag(t)}>#{t}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="tags">
      <span class="lbl">관련 종목 <em>선택</em></span>
      <div class="chips">
        {#each choices as c (c.id)}
          <button class="chip" class:on={f.securities.includes(c.id)} aria-pressed={f.securities.includes(c.id)}
            onclick={() => toggleSec(c.id)}>{c.name}</button>
        {/each}
      </div>
    </div>

    {#if !edit}
      <div class="back">
        <label class="chk">
          <input type="checkbox" bind:checked={backdate} />
          <span>과거 날짜로 기록</span>
          <InfoTip label="과거 날짜로 기록" text="예전에 가졌던 생각을 지금 적을 때 씁니다. 그 날짜로 기록되고 '사후 입력'으로 표시됩니다. 종합 의견은 채점하지 않으므로 날짜 제약은 없습니다." />
        </label>
        {#if backdate}<input type="date" bind:value={f.asOf} max={maxDate} aria-label="기록 날짜" />{/if}
      </div>
    {/if}
  </div>
  {#if err}<p class="msg bad">{err}</p>{/if}

  {#snippet footer()}
    <div class="acts">
      <button class="btn" onclick={() => (open = false)}>취소</button>
      <button class="btn primary" onclick={save} disabled={busy}>{busy ? "저장 중…" : edit ? "수정" : "기록"}</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .form{display:flex;flex-direction:column;gap:14px}
  .draft{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;font-size:13px;color:var(--sub2)}
  label,fieldset{display:flex;flex-direction:column;gap:6px;border:none;min-width:0}
  label > span,legend,.lbl{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--sub)}
  .lbl em{font-style:normal;color:var(--sub2)}
  input,textarea{border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px;width:100%;font-family:inherit;color:inherit}
  input{min-height:44px}
  textarea{resize:vertical;line-height:1.5}
  input:focus,textarea:focus{outline:none;border-color:var(--accent)}
  .seg{display:flex;gap:4px;padding:3px;border-radius:12px;background:var(--bg2)}
  .seg button{flex:1;min-height:38px;border-radius:9px;font-size:13.5px;color:var(--sub)}
  .seg button.on{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .tags{display:flex;flex-direction:column;gap:8px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:12.5px;min-height:32px;padding:0 10px;border:1px solid var(--line);border-radius:99px;color:var(--sub)}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .chip:focus-visible,.seg button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .back{display:flex;flex-direction:column;gap:8px}
  .back .chk{flex-direction:row;align-items:center;gap:8px}
  .back .chk input{width:18px;height:18px;min-height:0;accent-color:var(--accent)}
  .back .chk span{font-size:13.5px;color:var(--sub)}
  .msg{margin-top:10px}
  .acts{display:flex;justify-content:flex-end;gap:8px}
</style>
