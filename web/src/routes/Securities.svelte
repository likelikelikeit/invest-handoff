<script>
  // 종목 탭: 보유 + 관심종목 목록, 검색으로 추가. 누르면 종목 상세.
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import Logo from "../components/Logo.svelte";
  import SecuritySearch from "../components/SecuritySearch.svelte";
  import { data, holdings, refreshQuotes } from "../lib/data.svelte.js";
  import { api } from "../lib/api.js";
  import { ui } from "../lib/ui.svelte.js";
  import { assignColors, sectorColor } from "../lib/calc/colors.js";
  import { priceStr, won, pctSigned, tone, usd } from "../lib/format.js";

  const held = $derived(holdings());
  const colors = $derived(assignColors(held));
  let watch = $state([]);
  let q = $state("");
  let mode = $state("held");

  async function loadWatch() {
    try {
      watch = (await api("/watchlist")).watchlist;
      const syms = watch.map((w) => w.ysym).filter((s) => !data.quotes[s]);
      if (syms.length) refreshQuotes(syms);
    } catch { watch = []; }
  }
  $effect(() => { if (data.loaded) loadWatch(); });
  $effect(() => {
    const f = () => loadWatch();
    window.addEventListener("watchlist-changed", f);
    return () => window.removeEventListener("watchlist-changed", f);
  });

  function dayChange(ysym) {
    const qt = data.quotes[ysym];
    if (!qt || !qt.prevClose) return null;
    return (qt.price / qt.prevClose - 1) * 100;
  }

  function watchPrice(w) {
    const qt = data.quotes[w.ysym];
    if (!qt) return "시세 없음";
    if (qt.currency === "KRW") return won(qt.price);
    return usd(qt.price) + (data.fx ? " · " + won(qt.price * data.fx) : "");
  }

  async function unwatch(w) {
    await api("/watchlist/" + w.id, { method: "DELETE" });
    loadWatch();
  }

  function onpick(r) {
    ui.add = { prefill: { name: r.name, tick: r.ticker, ysym: r.symbol } };
    q = "";
  }
</script>

<PageHead title="종목" />

<Gate>
  <div class="search"><SecuritySearch bind:value={q} {onpick} id="sec-tab-search" label="종목 검색" placeholder="이름이나 티커로 찾기" /></div>

  <div class="kind-tabs" role="tablist" aria-label="종목 목록">
    <button role="tab" aria-selected={mode === "held"} class:on={mode === "held"} onclick={() => (mode = "held")}>보유 <span class="num">{held.length}</span></button>
    <button role="tab" aria-selected={mode === "watch"} class:on={mode === "watch"} onclick={() => (mode = "watch")}>관심 <span class="num">{watch.length}</span></button>
  </div>

  <section class="list-section" aria-label={mode === "held" ? "보유 종목" : "관심 종목"}>
    {#if mode === "held"}
      <ul class="list">
        {#each held as h (h.id)}
          {@const d = dayChange(h.ysym)}
          <li>
            <a href={"#/security/" + h.id}>
              <Logo {h} color={colors.get(h.id)} />
              <span class="nm"><span class="n1">{h.name}</span><span class="n2">{h.tick} · {h.sec}</span></span>
              <span class="val">
                <span class="v1 num">{h.stale ? "시세 없음" : priceStr(h)}</span>
                {#if d != null}<span class="v2 num {tone(d * 100)}">{pctSigned(d)}</span>{/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {:else if watch.length}
      <ul class="list">
        {#each watch as w (w.id)}
          {@const d = dayChange(w.ysym)}
          <li>
            <a href={"#/security/" + w.security_id}>
              <Logo h={{ name: w.name, tick: w.ticker, mkt: w.market }} color={sectorColor("기타")} />
              <span class="nm"><span class="n1">{w.name}</span><span class="n2">{w.ticker}{w.note ? " · " + w.note : ""}</span></span>
              <span class="val"><span class="v1 num">{watchPrice(w)}</span>{#if d != null}<span class="v2 num {tone(d * 100)}">{pctSigned(d)}</span>{/if}</span>
            </a>
            <button class="btn sm" onclick={() => unwatch(w)} aria-label="{w.name} 관심 해제">해제</button>
          </li>
        {/each}
      </ul>
    {:else}<p class="empty">위에서 검색해 관심 추가를 누르면 여기 모입니다.</p>
    {/if}
  </section>
</Gate>

<style>
  .search{padding:6px 0 14px}
  .kind-tabs{display:flex;gap:4px;padding:3px;margin-bottom:8px;border-radius:13px;background:var(--bg2);width:min(100%,360px)}
  .kind-tabs button{flex:1;min-height:40px;border-radius:10px;font-size:14px;color:var(--sub)}
  .kind-tabs button.on{background:color-mix(in srgb,var(--card) 78%,transparent);color:var(--ink);font-weight:680;box-shadow:0 2px 10px rgba(0,0,0,.08);backdrop-filter:blur(16px) saturate(170%);-webkit-backdrop-filter:blur(16px) saturate(170%)}
  .kind-tabs span{margin-left:4px;color:var(--sub2);font-size:12px}
  .kind-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .list-section{border-top:1px solid var(--line-soft);padding-top:3px}
  .list{list-style:none}
  .list li{display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--line-soft)}
  .list li:last-child{border-bottom:none}
  .list a{flex:1;min-width:0;display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 0}
  .list a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
  .nm{flex:1;min-width:0;display:flex;flex-direction:column}
  .n1{font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .n2{font-size:12.5px;color:var(--sub2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .val{display:flex;flex-direction:column;align-items:flex-end;flex:none}
  .v1{font-size:14.5px;font-weight:600}
  .v2{font-size:12.5px}
  .empty{font-size:14px;color:var(--sub2);padding:4px 0 8px}
  @media (min-width:900px){ .search{max-width:520px} }
</style>
