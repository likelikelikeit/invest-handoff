<script>
  // 메모 한 행 (SPEC §5.9). 제목·날짜·방향성·태그, 누르면 본문과 연결 종목.
  // 연결 종목의 '기록 이후 수익률'은 사실만 보여준다. 적중·실패 판정은 붙이지 않는다.
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { nativePrice } from "../lib/data.svelte.js";
  import { stamp, pctSigned, tone, textBlocks, valueFmt } from "../lib/format.js";

  let { n, ontouched } = $props();
  let open = $state(false);

  const STANCE = { positive: { label: "긍정", cls: "up" }, negative: { label: "부정", cls: "down" }, neutral: { label: "중립", cls: "flat" } };
  const stance = $derived(n.stance ? STANCE[n.stance] : null);

  /** 기록 시점 종가 → 지금 가격. 둘 다 있을 때만 수익률을 낸다. */
  const links = $derived(n.securities.map((s) => {
    const now = nativePrice(s.ysym);
    const fmt = valueFmt({ ysym: s.ysym, currency: s.currency, asset_class: "equity" });
    const since = s.price_at_note > 0 && now > 0 ? now / s.price_at_note - 1 : null;
    return { ...s, now, fmt, since };
  }));

  async function del() {
    if (!confirm("종합 의견 '" + n.title + "'을(를) 지울까요? 되돌릴 수 없습니다.")) return;
    try {
      await api("/notes/" + n.id, { method: "DELETE" });
      toast("종합 의견을 지웠습니다");
      ontouched && ontouched();
    } catch (e) {
      toast("실패: " + e.message);
    }
  }
</script>

<li class="nr" class:open>
  <button class="head" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="top">
      <span class="when num">{stamp(n.created_at)}{#if n.backdated}<em class="back">사후 입력</em>{/if}{#if n.edited_at}<em>수정됨</em>{/if}</span>
      {#if stance}<span class="stance {stance.cls}">{stance.label}</span>{/if}
    </span>
    <span class="title">{n.title}</span>
    {#if n.tags.length || n.securities.length}
      <span class="chips">
        {#each n.tags as t (t)}<span class="tag">#{t}</span>{/each}
        {#each n.securities as s (s.security_id)}<span class="sec">{s.name}</span>{/each}
      </span>
    {/if}
  </button>

  {#if open}
    <div class="body">
      {#if n.body}
        {@const blocks = textBlocks(n.body)}
        {#if blocks[0]?.kind === "p"}
          {#each blocks as b, i (i)}<p class="para">{b.text}</p>{/each}
        {:else}
          <ul class="pts">{#each blocks as b, i (i)}<li>{b.text}</li>{/each}</ul>
        {/if}
      {/if}

      {#if links.length}
        <h4>연결 종목 · 기록 이후</h4>
        <ul class="links">
          {#each links as s (s.security_id)}
            <li>
              <a href="#/security/{s.security_id}">{s.name}</a>
              <span class="num">
                {#if s.price_at_note > 0}{s.fmt(s.price_at_note)} → {s.now > 0 ? s.fmt(s.now) : "시세 없음"}{:else}그때 시세 없음{/if}
              </span>
              <b class="num {s.since != null ? tone(s.since * 1e6) : 'flat'}">{s.since != null ? pctSigned(s.since * 100) : "—"}</b>
            </li>
          {/each}
        </ul>
        <p class="hint">수익률은 사실만 적습니다. 종합 의견은 적중·실패로 채점하지 않습니다.</p>
      {/if}

      <div class="acts">
        <button class="btn sm" onclick={() => (ui.noteForm = { edit: n })}>편집</button>
        <button class="btn sm danger" onclick={del}>삭제</button>
      </div>
    </div>
  {/if}
</li>

<style>
  .nr{border-bottom:1px solid var(--line-soft)}
  .nr:last-child{border-bottom:none}
  .head{width:100%;display:flex;flex-direction:column;gap:4px;padding:12px 0;text-align:left}
  .head:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
  .top{display:flex;align-items:center;gap:8px}
  .when{font-size:12px;color:var(--sub2)}
  .when em{font-style:normal;margin-left:6px;color:var(--orange)}
  .when em.back{color:var(--sub2)}
  .stance{font-size:11.5px;font-weight:650;padding:1px 7px;border-radius:99px;background:var(--bg2)}
  .stance.up{color:var(--up)} .stance.down{color:var(--down)} .stance.flat{color:var(--sub2)}
  .title{font-size:15.5px;font-weight:620;letter-spacing:-.01em;word-break:keep-all}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
  .tag,.sec{font-size:11.5px;padding:1px 8px;border-radius:99px;border:1px solid var(--line-soft);color:var(--sub2)}
  .sec{background:var(--bg2)}
  .body{padding:0 0 14px}
  .pts{padding-left:18px;font-size:14px;line-height:1.55}
  .para{font-size:14px;line-height:1.65;margin:0 0 10px;white-space:pre-wrap;word-break:keep-all}
  h4{font-size:12.5px;color:var(--sub);font-weight:600;margin:12px 0 4px}
  .links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
  .links li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:baseline;font-size:13.5px}
  .links a{color:var(--ink);text-decoration:none;font-weight:560}
  .links a:hover{text-decoration:underline}
  .links span{color:var(--sub2);font-size:12.5px}
  .links b{font-weight:640}
  .hint{font-size:11.5px;color:var(--sub2);margin:8px 0 0}
  .acts{display:flex;gap:8px;margin-top:12px}
  .danger{color:var(--red)}
</style>
