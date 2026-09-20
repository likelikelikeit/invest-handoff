<script>
  // 홈 블록 3 (SPEC §4.2): 의견 있는 종목을 지금 상승여력 순으로. 현재가 · 목표가 · 상승여력 · 등급.
  // 의견 없는 보유 종목은 흐린 줄, 누르면 기록 폼.
  import Logo from "./Logo.svelte";
  import RatingChip from "./RatingChip.svelte";
  import { data, holdings, nativePrice } from "../lib/data.svelte.js";
  import { ui } from "../lib/ui.svelte.js";
  import { homeRows } from "../lib/calc/views.js";
  import { assignColors } from "../lib/calc/colors.js";
  import { valueFmt, pctSigned, tone } from "../lib/format.js";

  const held = $derived(holdings());
  const colors = $derived(assignColors(held));
  const rows = $derived(homeRows(data.views, held, nativePrice));
  const fmtOf = (v) => valueFmt({ ysym: v.ysym, currency: v.currency, asset_class: "equity" });
</script>

{#if !rows.length}
  <p class="empty">아직 의견이 없습니다.</p>
{:else}
  <ul class="list">
    {#each rows as r (r.kind + (r.kind === "view" ? r.view.security_id : r.holding.id))}
      {#if r.kind === "view"}
        {@const v = r.view}
        <li>
          <a href={"#/security/" + v.security_id}>
            <Logo h={{ name: v.name, tick: v.ticker, mkt: v.market, isin: v.isin }} color={colors.get(v.security_id) || "var(--sub2)"} size={32} />
            <span class="nm">
              <span class="n1">{v.name} <RatingChip rating={v.rating} score={v.rating_score} /></span>
              <span class="n2 num">{r.price != null ? fmtOf(v)(r.price) : "시세 없음"} → {fmtOf(v)(v.target_price)}</span>
            </span>
            <span class="up num {r.upside != null ? tone(r.upside * 1e6) : 'flat'}">{r.upside != null ? pctSigned(r.upside * 100) : "—"}</span>
          </a>
        </li>
      {:else}
        {@const h = r.holding}
        <li class="none">
          <button onclick={() => (ui.viewForm = { securityId: h.id })}>
            <Logo {h} color={colors.get(h.id)} size={32} />
            <span class="nm"><span class="n1">{h.name}</span><span class="n2">커버리지 없음 · 눌러서 개시</span></span>
            <span class="up flat">+</span>
          </button>
        </li>
      {/if}
    {/each}
  </ul>
{/if}

<style>
  .empty{font-size:14px;color:var(--sub2);padding:4px 0 8px}
  .list{list-style:none}
  .list li{border-bottom:1px solid var(--line-soft)}
  .list li:last-child{border-bottom:none}
  .list a,.list button{width:100%;display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;text-align:left}
  .list a:focus-visible,.list button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
  .none{opacity:.5}
  .nm{flex:1;min-width:0;display:flex;flex-direction:column}
  .n1{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .n2{font-size:12.5px;color:var(--sub2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .up{font-size:16px;font-weight:660;flex:none;min-width:72px;text-align:right}
</style>
