<script>
  // 판정 규칙 편집 (SPEC §4.6, §5.6.3): 숫자만 편집. 저장하면 새 버전이 되고, 이전 판정은 그때 규칙을 가리킨다.
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import { api } from "../lib/api.js";
  import { toast } from "../lib/ui.svelte.js";
  import { data } from "../lib/data.svelte.js";
  import { INDICATOR_INFO, RULE_UNITS } from "../lib/tech.js";
  import { stamp } from "../lib/format.js";

  const KEYS = ["rsi14", "dev20", "dev60", "bb_pctb", "vol_ratio"];
  let cur = $state(null);
  let form = $state(null);
  let note = $state("");
  let versions = $state([]);
  let busy = $state(false);
  let err = $state("");

  const show = (key, v) => (v == null ? "" : String(Math.round(v * RULE_UNITS[key].scale * 1000) / 1000));
  const store = (key, s) => (String(s).trim() === "" ? null : Number(s) / RULE_UNITS[key].scale);

  function toForm(cfg) {
    return {
      indicators: Object.fromEntries(KEYS.map((k) => [k, {
        overheat: show(k, cfg.indicators[k].overheat), oversold: show(k, cfg.indicators[k].oversold),
        weight: String(cfg.indicators[k].weight), enabled: cfg.indicators[k].enabled, up_day_only: cfg.indicators[k].up_day_only,
      }])),
      high: String(cfg.aggregate.high_threshold), low: String(cfg.aggregate.low_threshold),
    };
  }

  async function load() {
    try {
      const [r, h] = await Promise.all([api("/tech/rules"), api("/tech/rules/history")]);
      cur = r.rules;
      form = toForm(r.rules.config);
      versions = h.versions;
    } catch (e) {
      err = e.message;
    }
  }
  $effect(() => { if (data.loaded) load(); });

  async function save() {
    busy = true;
    err = "";
    const config = {
      indicators: Object.fromEntries(KEYS.map((k) => {
        const f = form.indicators[k];
        return [k, {
          overheat: store(k, f.overheat), oversold: k === "vol_ratio" ? null : store(k, f.oversold),
          weight: Number(f.weight), enabled: f.enabled, ...(k === "vol_ratio" ? { up_day_only: f.up_day_only !== false } : {}),
        }];
      })),
      aggregate: { high_threshold: Number(form.high), low_threshold: Number(form.low) },
    };
    try {
      await api("/tech/rules", { method: "POST", body: { config, note } });
      toast("새 규칙 버전을 저장했습니다");
      note = "";
      await load();
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<PageHead title="기술적 분석 규칙">
  <a class="btn sm" href="#/more">‹ 더보기</a>
</PageHead>

<Gate>
  {#if form}
    <p class="lead">과열·침체 기준과 가중치만 바꿉니다. 저장하면 새 버전(v{(versions[0]?.id ?? cur.id) + 1})이 되고, 지난 판정 기록은 그때의 규칙을 그대로 가리킵니다.</p>
    <div class="table">
      <div class="tr th"><span>지표</span><span>과열 &gt;</span><span>침체 &lt;</span><span>가중치</span><span>사용</span></div>
      {#each KEYS as k (k)}
        {@const f = form.indicators[k]}
        <div class="tr" class:off={!f.enabled}>
          <span class="name">{INDICATOR_INFO[k].label}{#if k === "vol_ratio"}<em>상승일만</em>{/if}</span>
          <label><input class="num" type="number" step={RULE_UNITS[k].step} bind:value={f.overheat} aria-label="{INDICATOR_INFO[k].label} 과열 기준" /><i>{RULE_UNITS[k].unit}</i></label>
          {#if k === "vol_ratio"}
            <span class="na">판정 미반영</span>
          {:else}
            <label><input class="num" type="number" step={RULE_UNITS[k].step} bind:value={f.oversold} aria-label="{INDICATOR_INFO[k].label} 침체 기준" /><i>{RULE_UNITS[k].unit}</i></label>
          {/if}
          <label><input class="num" type="number" min="0" step="0.5" bind:value={f.weight} aria-label="{INDICATOR_INFO[k].label} 가중치" /></label>
          <label class="chk"><input type="checkbox" bind:checked={f.enabled} aria-label="{INDICATOR_INFO[k].label} 사용" /></label>
        </div>
      {/each}
    </div>
    <div class="agg">
      <label><span>과열 합이 이 이상이면 '단기 과열'</span><input class="num" type="number" min="0.5" step="0.5" bind:value={form.high} /></label>
      <label><span>침체 합이 이 이상이면 '진입 부담 낮음'</span><input class="num" type="number" min="0.5" step="0.5" bind:value={form.low} /></label>
      <label class="wide"><span>메모 (선택)</span><input bind:value={note} placeholder="예: RSI 과열 기준을 75로 완화" /></label>
    </div>
    {#if err}<p class="msg bad">{err}</p>{/if}
    <div class="acts"><button class="btn primary" onclick={save} disabled={busy}>{busy ? "저장 중…" : "새 버전으로 저장"}</button></div>

    <h2>버전 이력</h2>
    <ul class="hist">
      {#each versions as v (v.id)}
        <li><span class="vid">v{v.id}{v.id === cur.id ? " · 현재" : ""}</span><span class="num">{stamp(v.created_at)}</span><span class="vn">{v.note || ""}</span><span class="num">판정 {v.calls}건</span></li>
      {/each}
    </ul>
  {:else if err}
    <p class="msg bad">{err}</p>
  {/if}
</Gate>

<style>
  .lead{font-size:13.5px;color:var(--sub);margin:4px 0 14px;word-break:keep-all;max-width:640px}
  .table{max-width:720px}
  .tr{display:grid;grid-template-columns:minmax(0,1.6fr) 1fr 1fr .8fr 44px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-soft)}
  .tr.th{font-size:12px;color:var(--sub2);padding-top:0}
  .tr.off{opacity:.5}
  .name{font-size:14px;font-weight:560}
  .name em{display:block;font-style:normal;font-size:11.5px;color:var(--sub2);font-weight:400}
  .tr label{display:flex;align-items:center;gap:4px}
  .tr input.num{width:100%;min-width:0;min-height:40px;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:6px 8px;font-size:15px;text-align:right}
  .tr i{font-style:normal;font-size:12px;color:var(--sub2);min-width:14px}
  .na{font-size:12px;color:var(--sub2)}
  .chk{justify-content:center}
  .chk input{width:20px;height:20px;accent-color:var(--accent)}
  .agg{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:720px;margin-top:16px}
  .agg label{display:flex;flex-direction:column;gap:5px}
  .agg .wide{grid-column:1/-1}
  .agg span{font-size:12.5px;color:var(--sub)}
  .agg input{min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;font-size:16px}
  input:focus{outline:none;border-color:var(--accent)}
  .acts{margin-top:14px;max-width:720px;display:flex;justify-content:flex-end}
  h2{font-size:17px;font-weight:650;margin:28px 0 8px;padding-top:18px;border-top:1px solid var(--line-soft);max-width:720px}
  .hist{list-style:none;max-width:720px}
  .hist li{display:grid;grid-template-columns:90px 110px minmax(0,1fr) auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px}
  .vid{font-weight:620}
  .vn{color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media (max-width:560px){
    .tr{grid-template-columns:minmax(0,1.3fr) 1fr 1fr .8fr 36px;gap:5px}
    .agg{grid-template-columns:1fr}
    .hist li{grid-template-columns:70px 1fr auto}
    .hist .vn{display:none}
  }
</style>
