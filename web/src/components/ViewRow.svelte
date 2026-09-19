<script>
  // 의견 한 행: 날짜·종목·등급·목표가·기록 시 상승여력·기록 후 수익률. 누르면 논리·리스크와 편집/삭제.
  import RatingChip from "./RatingChip.svelte";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { loadViews, nativePrice } from "../lib/data.svelte.js";
  import { returnSince, status, elapsed, horizonEnd } from "../lib/calc/views.js";
  import { valueFmt, pctSigned, tone, stamp } from "../lib/format.js";
  import { todayKst } from "../lib/today.js";

  let { v, showName = true, ondeleted } = $props();
  let open = $state(false);

  const fmt = $derived(valueFmt({ ysym: v.ysym, currency: v.currency, asset_class: "equity" }));
  const price = $derived(nativePrice(v.ysym));
  const since = $derived(returnSince(v, price));
  const today = todayKst();
  const st = $derived(status(v, today));

  async function del() {
    if (!confirm((v.name || "") + " " + stamp(v.created_at) + " 의견을 지울까요? 되돌릴 수 없습니다.")) return;
    try {
      await api("/views/" + v.id, { method: "DELETE" });
      toast("의견을 지웠습니다");
      await loadViews();
      ondeleted && ondeleted(v.id);
    } catch (e) {
      toast("실패: " + e.message);
    }
  }
</script>

<li class="vr" class:open>
  <button class="head" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="when num">{stamp(v.created_at)}{#if v.edited_at}<em>수정됨</em>{/if}</span>
    <span class="main">
      {#if showName}<span class="nm">{v.name}</span>{/if}
      <RatingChip rating={v.rating} score={v.rating_score} />
      <span class="tp num">목표 {fmt(v.target_price)}</span>
    </span>
    <span class="nums num">
      <span>기록 시 <b class={tone(v.upside_pct * 1e6)}>{pctSigned(v.upside_pct * 100)}</b></span>
      <span>이후 <b class={since != null ? tone(since * 1e6) : "flat"}>{since != null ? pctSigned(since * 100) : "—"}</b></span>
    </span>
  </button>
  {#if open}
    <div class="body">
      <dl class="meta num">
        <div><dt>기록 시점 가격</dt><dd>{fmt(v.price_at)}</dd></div>
        <div><dt>목표 시점</dt><dd>{v.horizon_months}개월 · {horizonEnd(v.created_at, v.horizon_months)}</dd></div>
        <div><dt>상태</dt><dd>{st === "in_progress" ? "진행 중 " + Math.round(elapsed(v, today) * 100) + "%" : st === "awaiting" ? "평가 대기" : "평가됨"}</dd></div>
        {#if v.consensus_target_at}<div><dt>그때 컨센 목표가</dt><dd>{fmt(v.consensus_target_at)}</dd></div>{/if}
      </dl>
      {#if v.thesis}<h4>핵심 논리</h4><ul class="pts">{#each v.thesis.split("\n").filter(Boolean) as t, i (i)}<li>{t}</li>{/each}</ul>{/if}
      {#if v.risks}<h4>리스크</h4><ul class="pts">{#each v.risks.split("\n").filter(Boolean) as t, i (i)}<li>{t}</li>{/each}</ul>{/if}
      {#if v.edited_at}<p class="edited">수정됨 · {stamp(v.edited_at)}</p>{/if}
      <div class="acts">
        <button class="btn sm" onclick={() => (ui.viewForm = { edit: v })}>편집</button>
        <button class="btn sm danger" onclick={del}>삭제</button>
      </div>
    </div>
  {/if}
</li>

<style>
  .vr{border-bottom:1px solid var(--line-soft)}
  .vr:last-child{border-bottom:none}
  .head{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main nums" "when nums";gap:2px 12px;padding:12px 0;text-align:left;align-items:center}
  .head:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
  .when{grid-area:when;font-size:12px;color:var(--sub2)}
  .when em{font-style:normal;margin-left:6px;color:var(--orange)}
  .main{grid-area:main;display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
  .nm{font-size:15px;font-weight:600}
  .tp{font-size:13.5px;color:var(--sub)}
  .nums{grid-area:nums;display:flex;flex-direction:column;align-items:flex-end;font-size:12px;color:var(--sub2)}
  .nums b{font-size:14px;font-weight:620;margin-left:4px}
  .body{padding:0 0 14px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-bottom:10px}
  .meta dt{font-size:12px;color:var(--sub2)}
  .meta dd{font-size:14px;font-weight:560}
  h4{font-size:12.5px;color:var(--sub);font-weight:600;margin:10px 0 4px}
  .pts{padding-left:18px;font-size:14px;line-height:1.55}
  .edited{font-size:12px;color:var(--orange);margin-top:8px}
  .acts{display:flex;gap:8px;margin-top:12px}
  .danger{color:var(--red)}
</style>
