<script>
  // 종목 상세의 '관련 메모' (SPEC §5.9). 이 종목을 연결한 테마·섹터 메모를 보여준다.
  // 이 종목을 왜 샀는지가 종목 의견이 아니라 테마 메모에 있는 경우가 많다.
  import NoteRow from "./NoteRow.svelte";
  import { api } from "../lib/api.js";
  import { ui } from "../lib/ui.svelte.js";

  let { id } = $props();
  let notes = $state([]);
  let err = $state("");

  async function load() {
    try {
      notes = (await api("/notes?security_id=" + id)).notes;
      err = "";
    } catch (e) {
      err = e.message;
    }
  }

  $effect(() => {
    const sid = id;
    if (sid == null) return;
    load();
    const f = () => load();
    window.addEventListener("notes-changed", f);
    return () => window.removeEventListener("notes-changed", f);
  });
</script>

{#if err}<p class="msg bad">{err}</p>{/if}
{#if notes.length}
  <ul class="list">{#each notes as n (n.id)}<NoteRow {n} ontouched={load} />{/each}</ul>
{:else}
  <p class="note">이 종목을 연결한 메모가 없습니다.</p>
{/if}
<button class="btn sm" onclick={() => (ui.noteForm = { securityId: id })}>이 종목으로 메모 쓰기</button>

<style>
  .list{list-style:none;margin:0 0 10px;padding:0}
  .note{font-size:13px;color:var(--sub2);margin:0 0 10px}
</style>
