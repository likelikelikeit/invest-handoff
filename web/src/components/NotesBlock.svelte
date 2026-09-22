<script>
  // 홈의 최근 메모 (SPEC §4.2, §5.9). 최근 5건만 제목·날짜·태그로.
  import { api } from "../lib/api.js";
  import { ui } from "../lib/ui.svelte.js";
  import { stamp } from "../lib/format.js";

  let notes = $state([]);

  async function load() {
    try {
      notes = (await api("/notes?limit=5")).notes;
    } catch {
      notes = [];
    }
  }

  $effect(() => {
    load();
    const f = () => load();
    window.addEventListener("notes-changed", f);
    return () => window.removeEventListener("notes-changed", f);
  });

  const STANCE = { positive: ["긍정", "up"], negative: ["부정", "down"], neutral: ["중립", "flat"] };
</script>

{#if notes.length}
  <ul class="list">
    {#each notes as n (n.id)}
      <li>
        <a href="#/views">{n.title}</a>
        <span class="meta num">
          {stamp(n.created_at)}
          {#if n.stance}<b class={STANCE[n.stance][1]}>{STANCE[n.stance][0]}</b>{/if}
          {#each n.tags.slice(0, 2) as t (t)}<i>#{t}</i>{/each}
        </span>
      </li>
    {/each}
  </ul>
{:else}
  <p class="empty">테마·섹터·매크로에 대한 종합 의견을 적어두면 여기 모입니다.
    <button class="btn sm" onclick={() => (ui.noteForm = {})}>종합 의견 쓰기</button>
  </p>
{/if}

<style>
  .list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .list li{display:flex;flex-direction:column;gap:2px}
  .list a{font-size:14.5px;font-weight:560;color:var(--ink);text-decoration:none;word-break:keep-all}
  .list a:hover{text-decoration:underline}
  .meta{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--sub2)}
  .meta b{font-weight:650}
  .meta b.up{color:var(--up)} .meta b.down{color:var(--down)} .meta b.flat{color:var(--sub2)}
  .meta i{font-style:normal}
  .empty{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--sub2);margin:0}
</style>
