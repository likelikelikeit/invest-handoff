<script>
  // 종목 추가 (SPEC §5.1): 검색 → 보유 등록(실제 보유, D1) / 매수 시뮬(시뮬에 신규 담기) / 관심 추가.
  import { untrack } from "svelte";
  import Sheet from "./Sheet.svelte";
  import SecuritySearch from "./SecuritySearch.svelte";
  import { api } from "../lib/api.js";
  import { ui, askChanges, toast } from "../lib/ui.svelte.js";
  import { data, load, quoteOne, holdings, cash } from "../lib/data.svelte.js";
  import { normalize, toMergeRow, guessYsym } from "../lib/calc/normalize.js";
  import { SECTOR_NAMES } from "../lib/calc/colors.js";
  import { parseNum } from "../lib/format.js";
  import * as S from "../lib/sim.svelte.js";

  let open = $state(false);
  let f = $state(fresh());
  let busy = $state(false);
  let err = $state("");
  let priceNote = $state("");

  function fresh() {
    return { name: "", tick: "", ysym: "", sec: "반도체·AI", price: "", avg: "", qty: "1" };
  }

  // ui.add가 바뀔 때만 폼을 새로 연다 (f를 읽어도 다시 돌지 않게 untrack)
  $effect(() => {
    const req = ui.add;
    if (!req) return;
    untrack(() => {
      f = { ...fresh(), ...(req.prefill || {}) };
      err = "";
      priceNote = "";
      open = true;
      // 종목 탭 검색에서 골라 들어온 경우에도 현재가를 채운다
      if (f.ysym && !f.price) fillPrice(f.ysym);
    });
  });

  async function onpick(r) {
    f.tick = r.ticker;
    f.ysym = r.symbol;
    fillPrice(r.symbol);
  }

  async function fillPrice(ysym) {
    priceNote = "현재가 가져오는 중…";
    try {
      const { quote, fx } = await quoteOne(ysym);
      if (quote) {
        const krw = quote.currency === "KRW" ? quote.price : fx ? quote.price * fx : null;
        if (krw) f.price = Math.round(krw).toLocaleString("ko-KR");
      }
      priceNote = "";
    } catch {
      priceNote = "현재가를 못 가져왔습니다. 직접 넣어주세요.";
    }
  }

  function row() {
    if (!f.name.trim()) return (err = "종목명을 넣어주세요"), null;
    if (!(parseNum(f.price) > 0)) return (err = "현재가를 넣어주세요"), null;
    if (!(parseNum(f.qty) > 0)) return (err = "수량을 넣어주세요"), null;
    const n = normalize({ name: f.name, tick: f.tick, sec: f.sec, price: parseNum(f.price), avg: parseNum(f.avg), qty: parseNum(f.qty), currency: "KRW" }, data.fx);
    if (!n) return (err = "입력을 확인해주세요"), null;
    if (f.ysym.trim()) n.ysym = f.ysym.trim();
    return n;
  }

  async function own() {
    const n = row();
    if (!n) return;
    busy = true;
    err = "";
    try {
      const r = await api("/portfolio/merge", { method: "POST", body: { asOwned: true, rows: [toMergeRow(n)] } });
      open = false;
      await load();
      toast(n.name + " 보유 등록");
      askChanges(r.changes);
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }

  function simBuy() {
    const n = row();
    if (!n) return;
    if (!S.sim.active) S.start(holdings(), cash().total);
    const known = data.positions.find((p) => p.security.ysym.toUpperCase() === n.ysym.toUpperCase());
    S.buyNew(n, known ? { id: known.security_id, isin: known.security.isin, brandColor: known.security.brand_color } : {});
    open = false;
    location.hash = "#/portfolio";
    toast(n.name + " " + n.qty + "주를 시뮬에 담았습니다");
  }

  async function watch() {
    if (!f.name.trim()) return (err = "종목명을 넣어주세요");
    const tick = (f.tick || "").trim().toUpperCase();
    const ysym = f.ysym.trim() || guessYsym(tick);
    if (!tick || !ysym) return (err = "검색에서 종목을 골라주세요");
    const kr = /\.(KS|KQ)$/i.test(ysym) || /^[0-9]{6}$/.test(tick);
    busy = true;
    err = "";
    try {
      const s = await api("/securities", { method: "POST", body: {
        name: f.name.trim(), ticker: tick, ysym, market: kr ? "KR" : "US", currency: kr ? "KRW" : "USD", sector: f.sec,
      } });
      await api("/watchlist", { method: "POST", body: { security_id: s.security.id } });
      open = false;
      toast(f.name + " 관심종목에 추가");
      ui.add = null;
      window.dispatchEvent(new CustomEvent("watchlist-changed"));
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="종목 추가" onclose={() => (ui.add = null)}>
  <div class="form">
    <div class="full"><SecuritySearch bind:value={f.name} {onpick} id="add-name" /></div>
    <label><span>티커</span><input bind:value={f.tick} placeholder="005930" autocomplete="off" /></label>
    <label><span>야후 심볼</span><input bind:value={f.ysym} placeholder="자동" autocomplete="off" /></label>
    <label class="full"><span>분류</span>
      <select bind:value={f.sec}>{#each SECTOR_NAMES as k (k)}<option value={k}>{k}</option>{/each}</select>
    </label>
    <label><span>현재가(원)</span><input class="num" bind:value={f.price} inputmode="numeric" placeholder={priceNote || "259500"} /></label>
    <label><span>평단(원)</span><input class="num" bind:value={f.avg} inputmode="numeric" placeholder="현재가와 같으면 비움" /></label>
    <label class="full"><span>수량</span><input class="num" bind:value={f.qty} inputmode="decimal" /></label>
  </div>
  {#if priceNote}<p class="msg">{priceNote}</p>{/if}
  {#if err}<p class="msg bad">{err}</p>{/if}
  <p class="hint">보유 등록은 원래 갖고 있던 종목(총자산에 포함, 현금 변화 없음), 매수 시뮬은 현금을 써서 새로 담는 연습입니다.</p>

  {#snippet footer()}
    <div class="acts">
      <button class="btn" onclick={watch} disabled={busy}>관심 추가</button>
      <span class="sp"></span>
      <button class="btn" onclick={simBuy} disabled={busy}>매수 시뮬</button>
      <button class="btn primary" onclick={own} disabled={busy}>보유 등록</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .full{grid-column:1/-1}
  label{display:flex;flex-direction:column;gap:5px;min-width:0}
  label span{font-size:12.5px;color:var(--sub)}
  input,select{min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px;width:100%}
  input:focus,select:focus{outline:none;border-color:var(--accent)}
  .hint{font-size:12.5px;color:var(--sub2);margin-top:12px;word-break:keep-all}
  .msg{margin-top:10px}
  .acts{display:flex;gap:8px;flex-wrap:wrap}
  .sp{flex:1}
</style>
