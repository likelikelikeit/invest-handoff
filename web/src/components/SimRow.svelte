<script>
  // 시뮬 한 줄: 현재가 · ± 수량 · 비중 슬라이더 · 평가액/손익 · 제거. 기존 index.html의 .row 이식.
  // 슬라이더를 끄는 동안은 평단을 건드리지 않고 미리보기, 놓을 때 확정 (snap 패턴).
  import Logo from "./Logo.svelte";
  import { won, wonSigned, pctSigned, qtyStr, tone, tonePct, parseNum, usd } from "../lib/format.js";
  import { SECTOR_NAMES } from "../lib/calc/colors.js";
  import { qtyForWeight } from "../lib/calc/portfolio.js";
  import * as S from "../lib/sim.svelte.js";

  let { h, total, color } = $props();

  const val = $derived(h.qty * h.price);
  const w = $derived(total > 0 ? (val / total) * 100 : 0);
  const baseW = $derived(total > 0 ? ((h.baseQty * h.price) / total) * 100 : 0);
  const pl = $derived((h.price - h.avg) * h.qty);
  const plp = $derived(h.avg > 0 ? (h.price / h.avg - 1) * 100 : 0);
  const dq = $derived(h.qty - h.baseQty);

  // 슬라이더 최대: 현재 비중을 25% 단위로 올림 (드래그 중에는 고정)
  let snap = null;
  let dragMax = $state(null);
  const smax = $derived(dragMax ?? Math.max(25, Math.ceil(w / 25) * 25));

  function onSlide(e) {
    if (!snap) {
      snap = { qty: h.qty, avg: h.avg, realized: h.realized };
      dragMax = smax;
    }
    S.previewQty(h.id, qtyForWeight(parseFloat(e.currentTarget.value), total, h.price));
  }
  function onSlideEnd() {
    if (!snap) return;
    const target = h.qty;
    S.commitQty(h.id, snap, target);
    snap = null;
    dragMax = null;
  }
  const enter = (e) => e.key === "Enter" && e.currentTarget.blur();
</script>

<div class="row" class:ghost={h.qty <= 0}>
  <div class="c-name">
    <Logo {h} {color} size={32} />
    <div class="nmwrap">
      <div class="nm1">{h.name}{#if h.baseQty === 0}<span class="tag">신규</span>{/if}</div>
      <div class="nm2">
        <span>{h.tick}</span><span>·</span>
        <select class="secSel" value={h.sec} onchange={(e) => S.setSector(h.id, e.currentTarget.value)} aria-label="{h.name} 분류">
          {#each SECTOR_NAMES as k (k)}<option value={k}>{k}</option>{/each}
        </select>
      </div>
    </div>
  </div>

  <label class="c-price">
    <span class="mlabel">현재가</span>
    <input class="inp num" value={Math.round(h.price).toLocaleString("ko-KR")} inputmode="numeric"
      aria-label="{h.name} 현재가" onchange={(e) => S.setManualPrice(h.id, parseNum(e.currentTarget.value))} onkeydown={enter} />
    {#if h.manualPrice}<span class="hint">직접 입력</span>{:else if h.priceNative != null && h.currency === "USD"}<span class="hint num">{usd(h.priceNative)}</span>{/if}
  </label>

  <div class="c-qty">
    <span class="mlabel">수량</span>
    <div class="stepper">
      <button onclick={() => S.setQty(h.id, Math.max(0, h.qty - 1))} aria-label="{h.name} 한 주 매도">−</button>
      <input class="qin num" value={qtyStr(h.qty)} inputmode="decimal" aria-label="{h.name} 수량"
        onchange={(e) => S.setQty(h.id, parseNum(e.currentTarget.value))} onkeydown={enter} />
      <button onclick={() => S.setQty(h.id, h.qty + 1)} aria-label="{h.name} 한 주 매수">+</button>
    </div>
  </div>

  <div class="c-slider">
    <div class="sl">
      <input type="range" min="0" max={smax} step="0.1" value={Math.min(w, smax).toFixed(1)}
        aria-label="{h.name} 목표 비중" oninput={onSlide} onchange={onSlideEnd} />
      <input class="pct num" value={w.toFixed(2)} inputmode="decimal" aria-label="{h.name} 비중 퍼센트"
        onchange={(e) => S.setWeight(h.id, Math.max(0, parseNum(e.currentTarget.value)))} onkeydown={enter} />
    </div>
    {#if Math.abs(w - baseW) > 0.005}
      <div class="delta num {tonePct(w - baseW)}">{w > baseW ? "▲" : "▼"} {Math.abs(w - baseW).toFixed(2)}%p</div>
    {/if}
  </div>

  <div class="c-value">
    <div>
      <div class="val1 num">{won(val)}</div>
      <div class="val2 num {tone(pl)}">{wonSigned(pl)} ({pctSigned(plp)})</div>
    </div>
    {#if Math.abs(dq) > 1e-9}
      <div class="delta num {tone(dq * 1e9)}">{dq > 0 ? "매수 " : "매도 "}{qtyStr(Math.abs(dq))}주</div>
    {/if}
  </div>

  <div class="c-del">
    <button class="xbtn" onclick={() => S.remove(h.id)} aria-label="{h.name} 전량 매도 후 제거">×</button>
  </div>
</div>

<style>
  .row{display:grid;gap:10px 12px;align-items:center;
    grid-template-columns:1fr auto;
    grid-template-areas:"name del" "price qty" "slider slider" "value value";
    padding:16px 0;border-bottom:1px solid var(--line-soft)}
  .row.ghost{opacity:.45}
  .c-name{grid-area:name;display:flex;align-items:center;gap:10px;min-width:0}
  .nmwrap{min-width:0}
  .nm1{font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tag{font-size:11px;font-weight:600;color:var(--up);margin-left:6px}
  .nm2{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--sub2)}
  .secSel{border:none;background:none;color:var(--sub2);font-size:12px;padding:0 2px;border-radius:5px;cursor:pointer;max-width:110px}
  .c-price{grid-area:price;display:flex;flex-direction:column;gap:2px}
  .c-qty{grid-area:qty;display:flex;flex-direction:column;gap:2px}
  .c-slider{grid-area:slider}
  .c-value{grid-area:value;display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .c-del{grid-area:del;text-align:right}
  .mlabel{font-size:11.5px;color:var(--sub2)}
  .hint{font-size:11.5px;color:var(--sub2)}

  .inp{width:100%;min-height:36px;border:1px solid transparent;background:var(--bg2);border-radius:9px;padding:6px 9px;font-size:15px;text-align:right}
  .inp:focus{outline:none;border-color:var(--accent);background:var(--card)}
  .stepper{display:flex;align-items:center;gap:4px}
  .stepper button{width:36px;height:36px;border:1px solid var(--line);border-radius:9px;font-size:17px;line-height:1;color:var(--sub);flex:none}
  .stepper button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  .qin{flex:1;min-width:0;width:90px;min-height:36px;border:1px solid transparent;background:var(--bg2);border-radius:9px;padding:5px 6px;font-size:15px;text-align:center}
  .qin:focus{outline:none;border-color:var(--accent);background:var(--card)}

  .sl{display:flex;align-items:center;gap:9px}
  /* 터치 영역은 28px, 보이는 트랙은 4px */
  .sl input[type=range]{-webkit-appearance:none;appearance:none;flex:1;min-width:54px;height:28px;background:transparent;outline:none;margin:0}
  .sl input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:99px;background:var(--track)}
  .sl input[type=range]::-moz-range-track{height:4px;border-radius:99px;background:var(--track)}
  .sl input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;margin-top:-10px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,.14);box-shadow:0 1px 4px rgba(0,0,0,.22);cursor:grab}
  .sl input[type=range]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,.14);cursor:grab}
  .sl input[type=range]:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
  .pct{width:64px;min-height:36px;border:1px solid transparent;background:none;border-radius:8px;padding:4px;font-size:15px;font-weight:580;text-align:right;flex:none}
  .pct:focus{outline:none;border-color:var(--accent);background:var(--card)}
  .delta{font-size:12px;font-weight:560;text-align:right}
  .c-slider .delta{padding-right:72px}
  .val1{font-size:15px;font-weight:600}
  .val2{font-size:12.5px}
  .xbtn{width:44px;height:44px;border-radius:10px;color:var(--sub2);font-size:18px;line-height:1}
  .xbtn:hover{background:var(--bg2);color:var(--red)}

  @media (min-width:1000px){
    .row{grid-template-columns:minmax(170px,1.55fr) 130px 170px minmax(150px,1.35fr) minmax(140px,1.05fr) 44px;
      grid-template-areas:"name price qty slider value del";padding:11px 0}
    .mlabel{display:none}
    .c-value{flex-direction:column;align-items:flex-end;gap:0;text-align:right}
  }
</style>
