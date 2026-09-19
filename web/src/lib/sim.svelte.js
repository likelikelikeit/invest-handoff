// 포트폴리오 시뮬레이터 상태 (SPEC §5.5). 시뮬은 연습장이다: 실제 보유(D1 positions)를 절대 바꾸지 않는다.
// 진행 중인 시뮬은 기기에 임시 저장(새로고침해도 유지), "저장"하면 portfolio_scenarios에 남는다.
//
// 저장하는 holding은 가격 없이 수량·평단만 들고, 가격은 렌더할 때 최신 시세로 붙인다(resolve).
// 사용자가 현재가를 직접 고치면 manualPrice가 이긴다(기존 시뮬레이터 기능).

import { store } from "./storage.js";
import { data } from "./data.svelte.js";
import { api } from "./api.js";
import { setQty as calcSetQty, qtyForWeight, computed, removeHolding as calcRemove } from "./calc/portfolio.js";

const KEY = "invest.sim";

function blank() {
  return { active: false, holdings: [], removed: [], deposit: 0, extra: 0, startedAt: null, name: "" };
}

function restore() {
  try {
    const o = JSON.parse(store.get(KEY, "null"));
    if (o && Array.isArray(o.holdings)) return { ...blank(), ...o };
  } catch { /* 깨진 임시 저장은 버린다 */ }
  return blank();
}

export const sim = $state(restore());

function persist() {
  store.set(KEY, JSON.stringify($state.snapshot(sim)));
}

/** 시세를 붙인 holding. price는 원화. */
export function resolve(h) {
  let price = h.price;
  let priceNative = h.priceNative ?? null;
  const q = data.quotes[h.ysym];
  if (q && typeof q.price === "number") {
    priceNative = q.price;
    price = q.currency === "KRW" ? q.price : data.fx ? q.price * data.fx : h.price;
  }
  if (h.manualPrice > 0) {
    price = h.manualPrice;
    priceNative = null;
  }
  return { ...h, price, priceNative };
}

export function resolvedState() {
  return {
    holdings: sim.holdings.map(resolve),
    removed: sim.removed,
    deposit: sim.deposit + sim.extra,
  };
}

/** 실제 보유와 현금에서 새로 시작 */
export function start(realHoldings, cashTotal) {
  Object.assign(sim, blank(), {
    active: true,
    startedAt: new Date().toISOString(),
    deposit: cashTotal,
    holdings: realHoldings.map((h) => ({
      id: h.id, name: h.name, tick: h.tick, mkt: h.mkt, sec: h.sec, ysym: h.ysym, isin: h.isin,
      currency: h.currency, brandColor: h.brandColor,
      price: h.price, priceNative: h.priceNative,
      qty: h.qty, avg: h.avg, baseQty: h.qty, baseAvg: h.avg, realized: 0, manualPrice: null,
    })),
  });
  persist();
}

export function stop() {
  Object.assign(sim, blank());
  store.remove(KEY);
}

function update(id, fn) {
  const i = sim.holdings.findIndex((x) => x.id === id);
  if (i < 0) return;
  const r = fn(resolve(sim.holdings[i]));
  const h = sim.holdings[i];
  sim.holdings[i] = { ...h, qty: r.qty, avg: r.avg, realized: r.realized, price: r.price, priceNative: r.priceNative };
  persist();
}

export function setQty(id, nq) {
  update(id, (h) => calcSetQty(h, nq));
}

export function setWeight(id, w) {
  const c = computed(resolvedState());
  update(id, (h) => calcSetQty(h, qtyForWeight(w, c.total, h.price)));
}

/** 드래그 중 미리보기: 평단·실현손익을 건드리지 않고 수량만 (기존 snap 패턴). */
export function previewQty(id, q) {
  const i = sim.holdings.findIndex((x) => x.id === id);
  if (i >= 0) sim.holdings[i].qty = q;
}

/** 드래그 끝: 시작 시점 스냅으로 되돌린 뒤 정식 setQty */
export function commitQty(id, snap, target) {
  const i = sim.holdings.findIndex((x) => x.id === id);
  if (i < 0) return;
  Object.assign(sim.holdings[i], snap);
  setQty(id, target);
}

export function setManualPrice(id, v) {
  const i = sim.holdings.findIndex((x) => x.id === id);
  if (i < 0) return;
  sim.holdings[i].manualPrice = v > 0 ? v : null;
  persist();
}

export function setSector(id, sec) {
  const i = sim.holdings.findIndex((x) => x.id === id);
  if (i < 0) return;
  sim.holdings[i].sec = sec;
  persist();
}

export function remove(id) {
  const next = calcRemove(resolvedState(), id);
  sim.holdings = sim.holdings.filter((x) => x.id !== id);
  sim.removed = next.removed;
  persist();
}

export function setExtra(v) {
  sim.extra = Math.max(0, v || 0);
  persist();
}

/**
 * 매수 시뮬: 현금을 써서 새로 담는다 (baseQty 0). 이미 있으면 그만큼 추가 매수.
 * n = normalize 결과 {name, tick, mkt, ysym, sec, price, avg, qty}
 */
export function buyNew(n, extra = {}) {
  const ex = sim.holdings.find((x) => x.ysym.toUpperCase() === n.ysym.toUpperCase());
  if (ex) {
    setQty(ex.id, resolve(ex).qty + n.qty);
    return;
  }
  sim.holdings.push({
    id: extra.id ?? "new:" + n.ysym, name: n.name, tick: n.tick, mkt: n.mkt, sec: n.sec, ysym: n.ysym,
    isin: extra.isin ?? null, currency: n.mkt === "KR" ? "KRW" : "USD", brandColor: extra.brandColor ?? null,
    price: n.price, priceNative: null, qty: n.qty, avg: n.price, baseQty: 0, baseAvg: n.price, realized: 0, manualPrice: null,
  });
  persist();
}

// ── 저장한 시뮬 (portfolio_scenarios) ─────────────────────

export async function saveScenario(name) {
  const st = resolvedState();
  const weights = {
    v: 1,
    extra: sim.extra,
    holdings: st.holdings.map((h) => ({
      id: h.id, ysym: h.ysym, name: h.name, tick: h.tick, mkt: h.mkt, sec: h.sec, currency: h.currency,
      qty: h.qty, avg: h.avg, baseQty: h.baseQty, baseAvg: h.baseAvg, realized: h.realized,
      price: h.price, manualPrice: h.manualPrice,
      weight: 0, // 아래에서 채움
    })),
    removed: sim.removed,
  };
  const c = computed(st);
  for (const h of weights.holdings) h.weight = c.total > 0 ? (h.qty * h.price) / c.total : 0;
  return api("/portfolio/scenarios", { method: "POST", body: { name, deposit: sim.deposit, weights } });
}

/** 저장한 시뮬을 다시 연다. 가격은 지금 시세로 다시 붙는다. */
export function openScenario(sc) {
  const w = sc.weights || {};
  Object.assign(sim, blank(), {
    active: true,
    name: sc.name,
    startedAt: new Date().toISOString(),
    deposit: sc.deposit || 0,
    extra: w.extra || 0,
    removed: w.removed || [],
    holdings: (w.holdings || []).map((h) => ({ isin: null, brandColor: null, priceNative: null, manualPrice: null, ...h })),
  });
  persist();
}
