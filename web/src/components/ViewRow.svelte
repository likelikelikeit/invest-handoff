<script>
  // 의견 한 행 (SPEC §5.2). 앞면: 종목·등급·목표가 / 날짜 · 분석 당시 상승 여력 · 분석 이후.
  // 펼치면 분석 당시 주가 → 목표가 산출 방식 → 목표 기간 → 목표 기간 진행률, 그리고 결론·논리·리스크.
  import RatingChip from "./RatingChip.svelte";
  import { api } from "../lib/api.js";
  import { ui, toast } from "../lib/ui.svelte.js";
  import { loadViews, nativePrice } from "../lib/data.svelte.js";
  import { returnSince, status, elapsed, horizonEnd } from "../lib/calc/views.js";
  import { basisText } from "../lib/calc/valuation.js";
  import { valueFmt, pctSigned, tone, stamp, dayStamp, textBlocks } from "../lib/format.js";
  import { todayKst } from "../lib/today.js";

  let { v, showName = true, ondeleted } = $props();
  let open = $state(false);

  const fmt = $derived(valueFmt({ ysym: v.ysym, currency: v.currency, asset_class: "equity" }));
  const price = $derived(nativePrice(v.ysym));
  const since = $derived(returnSince(v, price));
  const today = todayKst();
  const st = $derived(status(v, today));
  const basis = $derived(basisText(v.valuation, fmt));

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
    <span class="main">
      {#if showName}<span class="nm">{v.name}</span>{/if}
      <RatingChip rating={v.rating} score={v.rating_score} />
    </span>
    <span class="tp num">{fmt(v.target_price)}</span>

    <span class="when num">{dayStamp(v.created_at)}{#if v.edited_at}<em>수정됨</em>{/if}</span>
    <span class="nums num">
      <span class="stat">
        <b class={tone(v.upside_pct * 1e6)}>{pctSigned(v.upside_pct * 100)}</b>
        <i>분석 당시 상승 여력</i>
      </span>
      <span class="stat">
        <b class={since != null ? tone(since * 1e6) : "flat"}>{since != null ? pctSigned(since * 100) : "—"}</b>
        <i>분석 이후</i>
      </span>
    </span>
  </button>

  {#if open}
    <div class="body">
      <dl class="meta num">
        <div><dt>분석 당시 주가</dt><dd>{fmt(v.price_at)}</dd></div>
        {#if basis}<div class="wide"><dt>목표가 산출 방식</dt><dd>{basis}</dd></div>{/if}
        <div><dt>목표 기간</dt><dd>{v.horizon_months}개월 · {horizonEnd(v.created_at, v.horizon_months)}</dd></div>
        <div><dt>목표 기간 진행률</dt>
          <dd>{st === "in_progress" ? Math.round(elapsed(v, today) * 100) + "%" : st === "awaiting" ? "기간 종료 · 평가 대기" : "평가됨"}</dd>
        </div>
        {#if v.consensus_target_at}<div><dt>그때 컨센 목표가</dt><dd>{fmt(v.consensus_target_at)}</dd></div>{/if}
      </dl>

      <!-- 결론은 한 덩어리 산문이라 불릿을 붙이지 않는다 -->
      {#if v.conclusion}
        <h4>결론</h4>
        {#each textBlocks(v.conclusion) as b, i (i)}<p class="para">{b.text}</p>{/each}
      {/if}
      {#if v.thesis}<h4>핵심 논리</h4>{@render body(textBlocks(v.thesis))}{/if}
      {#if v.risks}<h4>리스크</h4>{@render body(textBlocks(v.risks))}{/if}
      {#if v.edited_at}<p class="edited">수정됨 · {stamp(v.edited_at)}</p>{/if}

      <div class="acts">
        <button class="btn sm" onclick={() => (ui.viewForm = { securityId: v.security_id })}>업데이트</button>
        <button class="btn sm" onclick={() => (ui.viewForm = { edit: v })}>편집</button>
        <button class="btn sm danger" onclick={del}>삭제</button>
      </div>
    </div>
  {/if}
</li>

{#snippet body(blocks)}
  {#if blocks[0]?.kind === "p"}
    {#each blocks as b, i (i)}<p class="para">{b.text}</p>{/each}
  {:else}
    <ul class="pts">{#each blocks as b, i (i)}<li>{b.text}</li>{/each}</ul>
  {/if}
{/snippet}

<style>
  .vr{border-bottom:1px solid var(--line-soft)}
  .vr:last-child{border-bottom:none}
  .head{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main tp" "when nums";
    gap:10px 16px;padding:18px 0;text-align:left;align-items:center}
  .head:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
  .main{grid-area:main;display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
  .nm{font-size:16px;font-weight:650;letter-spacing:-.01em}
  .tp{grid-area:tp;font-size:19px;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
  .when{grid-area:when;font-size:12.5px;color:var(--sub2);align-self:center}
  .when em{font-style:normal;margin-left:6px;color:var(--orange)}
  .nums{grid-area:nums;display:flex;gap:18px}
  .stat{display:flex;flex-direction:column;align-items:flex-end;gap:1px}
  .stat b{font-size:17px;font-weight:680;letter-spacing:-.01em}
  .stat i{font-style:normal;font-size:11px;color:var(--sub2)}
  .body{padding:0 0 16px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-bottom:12px}
  .meta .wide{grid-column:1/-1}
  .meta dt{font-size:12px;color:var(--sub2)}
  .meta dd{font-size:14.5px;font-weight:560}
  h4{font-size:12.5px;color:var(--sub);font-weight:600;margin:12px 0 4px}
  .pts{padding-left:18px;font-size:14px;line-height:1.55}
  .para{font-size:14px;line-height:1.65;margin:0 0 10px;white-space:pre-wrap;word-break:keep-all}
  .para:last-child{margin-bottom:0}
  .edited{font-size:12px;color:var(--orange);margin-top:8px}
  .acts{display:flex;gap:8px;margin-top:14px}
  .danger{color:var(--red)}
  @media (max-width:420px){
    .nums{gap:12px}
    .stat b{font-size:15.5px}
    .tp{font-size:17px}
  }
</style>
