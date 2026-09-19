<script>
  // 종목 검색 자동완성 (SPEC §5.9, 기존 index.html 이식).
  // 2글자 이상 → 300ms 디바운스 → 드롭다운. 한글로 쳤으면 야후 영문명 대신 친 이름을 유지.
  import { api } from "../lib/api.js";

  let { value = $bindable(""), onpick, placeholder = "예: 삼성전자, NVDA", id = "sec-search", label = "종목명" } = $props();

  let items = $state([]);
  let cursor = $state(-1);
  let open = $state(false);
  let note = $state("");
  let timer = null;
  let lastQ = "";

  function close() {
    open = false;
    items = [];
    cursor = -1;
    note = "";
  }

  function oninput() {
    const q = value.trim();
    clearTimeout(timer);
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      if (q === lastQ && open) return;
      lastQ = q;
      try {
        const r = await api("/search?q=" + encodeURIComponent(q));
        items = r.results || [];
        cursor = -1;
        note = items.length ? "" : "결과가 없습니다. 직접 입력해도 됩니다.";
        open = true;
      } catch (e) {
        items = [];
        note = e.message;
        open = true;
      }
    }, 300);
  }

  function pick(i) {
    const r = items[i];
    if (!r) return;
    close();
    const typed = value.trim();
    const name = /[가-힣]/.test(typed) ? typed : r.name;
    value = name;
    onpick && onpick({ ...r, name, ticker: r.symbol.replace(/\.(KS|KQ)$/i, "") });
  }

  function onkeydown(e) {
    if (!open || !items.length) {
      if (e.key === "Escape") close();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); cursor = (cursor + 1) % items.length; }
    else if (e.key === "ArrowUp") { e.preventDefault(); cursor = (cursor - 1 + items.length) % items.length; }
    else if (e.key === "Enter" && cursor >= 0) { e.preventDefault(); pick(cursor); }
    else if (e.key === "Escape") close();
  }
</script>

<div class="ac">
  <label for={id}>{label}</label>
  <input {id} type="text" bind:value {placeholder} autocomplete="off" spellcheck="false"
    role="combobox" aria-expanded={open} aria-controls={id + "-list"} aria-autocomplete="list"
    {oninput} {onkeydown} onblur={() => setTimeout(close, 150)} />
  {#if open}
    <div class="list" id={id + "-list"} role="listbox">
      {#if note}<p class="note">{note}</p>{/if}
      {#each items as r, i (r.symbol)}
        <div class="item" class:on={i === cursor} role="option" aria-selected={i === cursor} tabindex="-1"
          onmousedown={(e) => { e.preventDefault(); pick(i); }}>
          <span class="an">{r.name}</span>
          <span class="as">{r.symbol}{r.exchange ? " · " + r.exchange : ""}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ac{position:relative;display:flex;flex-direction:column;gap:5px}
  label{font-size:12.5px;color:var(--sub)}
  input{min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px;width:100%}
  input:focus{outline:none;border-color:var(--accent)}
  .list{position:absolute;top:100%;left:0;right:0;z-index:30;margin-top:5px;background:var(--card);border:1px solid var(--line);
    border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.14);max-height:280px;overflow-y:auto}
  .item{display:flex;justify-content:space-between;align-items:baseline;gap:10px;min-height:44px;padding:10px 12px;font-size:14px;cursor:pointer;border-bottom:1px solid var(--line-soft)}
  .item:last-child{border-bottom:none}
  .item:hover,.item.on{background:var(--bg2)}
  .an{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .as{font-size:12px;color:var(--sub2);flex:none}
  .note{padding:10px 12px;font-size:13px;color:var(--sub2)}
</style>
