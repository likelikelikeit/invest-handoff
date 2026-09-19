// 포트폴리오 계산 (SPEC §5.5). 기존 index.html의 computed/setQty/setWeight/통계/주문서를 순수 함수로 옮겼다.
// 금액은 전부 원화. holding 모양:
//   {id, name, tick, mkt, sec, assetClass, expectedReturnPct, ysym, currency, price, priceNative, qty, avg, baseQty, baseAvg, realized, brandColor, stale}
// state 모양: {holdings, removed, deposit}
//   deposit = 시작 현금(실제 현금 원화 환산 + 추가 납입금). 매매로 변하지 않는다.

/** D1 보유 + 시세 → holding. 시세가 없으면 평단으로 두고 stale 표시. */
export function holdingFromPosition(p, quote, fx) {
  const s = p.security;
  const toKrw = (v, ccy) => (ccy === "USD" ? (fx ? v * fx : null) : v);
  const avg = toKrw(p.avg_price, p.avg_ccy);
  let price = null;
  let priceNative = null;
  if (quote && typeof quote.price === "number") {
    priceNative = quote.price;
    price = toKrw(quote.price, quote.currency === "KRW" ? "KRW" : "USD");
  }
  const stale = !(price > 0);
  if (stale) price = avg || 0;
  return {
    id: p.security_id,
    name: s.name,
    tick: s.ticker,
    mkt: s.market,
    sec: s.sector || "기타",
    assetClass: s.asset_class || "equity",
    expectedReturnPct: s.expected_return_pct,
    ysym: s.ysym,
    isin: s.isin,
    currency: s.currency,
    brandColor: s.brand_color,
    price,
    priceNative,
    qty: p.qty,
    avg: avg || 0,
    baseQty: p.qty,
    baseAvg: avg || 0,
    realized: 0,
    stale,
  };
}

/** 현금 행들 → 원화 합과 조각 */
export function cashParts(cashRows, fx) {
  const parts = [];
  for (const r of cashRows || []) {
    const krw = r.currency === "USD" ? (fx ? r.amount * fx : 0) : r.amount;
    if (krw > 0.5) parts.push({ currency: r.currency, amount: r.amount, krw });
  }
  return { parts, total: parts.reduce((a, b) => a + b.krw, 0) };
}

export function computed(state) {
  let stock = 0, cost = 0, realized = 0, baseStock = 0;
  for (const h of state.holdings) {
    stock += h.qty * h.price;
    cost += h.qty * h.avg;
    realized += h.realized;
    baseStock += h.baseQty * h.price;
  }
  // 목록에서 지운 종목도 시작 자산과 실현손익에는 남아 있어야 한다
  for (const r of state.removed || []) {
    baseStock += r.baseQty * r.price;
    realized += r.realized;
  }
  // 매도는 주식을 현금으로 바꿀 뿐이라 총자산을 늘리거나 줄이지 않는다
  const total = baseStock + (state.deposit || 0);
  return {
    stock, cost, cash: total - stock, total,
    pl: stock - cost, plPct: cost > 0 ? ((stock - cost) / cost) * 100 : 0,
    realized, baseStock,
  };
}

/** 수량 변경: 추가 매수는 평단 가중평균, 매도는 평단 유지하고 실현손익 확정. 새 holding을 돌려준다. */
export function setQty(h, nq) {
  if (!Number.isFinite(nq) || nq < 0) nq = 0;
  const out = { ...h };
  if (nq > h.qty) {
    const add = nq - h.qty;
    out.avg = (h.qty * h.avg + add * h.price) / nq;
  } else if (nq < h.qty) {
    const sold = h.qty - nq;
    out.realized = h.realized + sold * (h.price - h.avg);
  }
  out.qty = nq;
  return out;
}

/** 비중 w% → 수량 */
export function qtyForWeight(w, total, price) {
  if (!(price > 0) || !(total > 0)) return 0;
  return ((w / 100) * total) / price;
}

/** 목록에서 빼기: 전량 매도로 보고 removed로 옮긴다. */
export function removeHolding(state, id) {
  const h = state.holdings.find((x) => x.id === id);
  if (!h) return state;
  const realized = h.realized + h.qty * (h.price - h.avg);
  return {
    ...state,
    holdings: state.holdings.filter((x) => x.id !== id),
    removed: [...(state.removed || []), { id: h.id, name: h.name, tick: h.tick, baseQty: h.baseQty, price: h.price, realized }],
  };
}

/** 도넛 조각. 종목은 평가액 큰 순, 현금은 끝에 통화별로. */
export function slices(holdings, colors, cash) {
  const arr = holdings
    .map((h) => ({ id: h.id, label: h.name, color: colors.get(h.id), value: h.qty * h.price }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  for (const c of cash) {
    if (c.value > 0.5) arr.push({ id: "cash-" + c.key, label: c.label, color: c.color, value: c.value, isCash: true });
  }
  return arr;
}

/** 주문서: 시작 대비 바뀐 수량 */
export function orders(state) {
  const ords = [];
  for (const h of state.holdings) {
    const dq = h.qty - h.baseQty;
    if (Math.abs(dq) < 1e-7) continue;
    ords.push({ id: h.id, name: h.name, tick: h.tick, dq, amt: Math.abs(dq) * h.price, isNew: h.baseQty === 0 });
  }
  for (const r of state.removed || []) {
    if (r.baseQty > 1e-9) ords.push({ id: r.id, name: r.name, tick: r.tick, dq: -r.baseQty, amt: r.baseQty * r.price, gone: true });
  }
  ords.sort((a, b) => b.amt - a.amt);
  const buy = ords.filter((o) => o.dq > 0).reduce((a, b) => a + b.amt, 0);
  const sell = ords.filter((o) => o.dq < 0).reduce((a, b) => a + b.amt, 0);
  return { list: ords, buy, sell, net: sell - buy };
}

/** 그룹별 합 → [{key, value}] 큰 순. 현금은 따로 넣는다. */
function groupSum(items, keyOf, cash) {
  const g = new Map();
  for (const x of items) g.set(keyOf(x), (g.get(keyOf(x)) || 0) + x.v);
  if (cash > 0.5) g.set("현금", cash);
  return [...g.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

/** 집중도·분류별·시장별 */
export function stats(state, c) {
  const vals = state.holdings
    .map((h) => ({ n: h.name, v: h.qty * h.price, sec: h.sec, mkt: h.mkt, asset: h.assetClass || "equity" }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  const stockSum = vals.reduce((a, b) => a + b.v, 0);
  const top3 = vals.slice(0, 3);
  const hhi = vals.reduce((a, b) => {
    const w = stockSum > 0 ? (b.v / stockSum) * 100 : 0;
    return a + w * w;
  }, 0);
  const pctOf = (v) => (c.total > 0 ? (v / c.total) * 100 : 0);
  return {
    count: state.holdings.length,
    top3Pct: pctOf(top3.reduce((a, b) => a + b.v, 0)),
    top3Names: top3.map((x) => x.n),
    maxPct: vals.length ? pctOf(vals[0].v) : 0,
    maxName: vals.length ? vals[0].n : "",
    hhi,
    hhiVerdict: hhi < 1500 ? "고르게 퍼져 있음" : hhi < 2500 ? "보통" : "한쪽으로 쏠림",
    cashPct: pctOf(c.cash),
    bySector: groupSum(vals, (x) => x.sec, c.cash),
    byMarket: groupSum(vals, (x) => (x.mkt === "KR" ? "국내" : "해외"), c.cash),
    byAsset: groupSum(vals, (x) => ({ equity: "주식", bond: "채권", cash: "현금", other: "기타" }[x.asset] || "기타"), c.cash),
  };
}

/** 가격 행([[date,...,close]]) → 날짜별 단순 일간 수익률. */
export function dailyReturns(rows) {
  const out = new Map();
  let prev = null;
  for (const row of rows || []) {
    const close = Number(row[4]);
    if (prev > 0 && close > 0) out.set(row[0], close / prev - 1);
    if (close > 0) prev = close;
  }
  return out;
}

function sampleCov(xs, ys) {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / (xs.length - 1);
}

function paired(a, b) {
  const xs = [], ys = [];
  for (const [date, x] of a) {
    if (b.has(date)) { xs.push(x); ys.push(b.get(date)); }
  }
  return [xs, ys];
}

/**
 * 종목별 1년 일봉으로 연환산 변동성·상관, 사용자 가정으로 기대수익률을 계산한다.
 * histories는 Map 또는 { [security_id]: rows }. 현금 기대수익률·변동성은 0으로 둔다.
 */
export function riskMetrics(holdings, histories, cash = 0) {
  const valueOf = (h) => Math.max(0, h.qty * h.price);
  const stock = holdings.reduce((s, h) => s + valueOf(h), 0);
  const total = stock + Number(cash || 0);
  const rowsOf = (id) => histories instanceof Map ? histories.get(id) : histories?.[id];
  const assets = holdings.filter((h) => valueOf(h) > 0).map((h) => ({
    h, weight: total > 0 ? valueOf(h) / total : 0, returns: dailyReturns(rowsOf(h.id)),
  }));

  const assumed = assets.filter((a) => a.h.expectedReturnPct != null && a.h.expectedReturnPct !== "" && Number.isFinite(Number(a.h.expectedReturnPct)));
  const expectedCoverage = assets.reduce((s, a) => s + a.weight, 0) > 0
    ? assumed.reduce((s, a) => s + a.weight, 0) / assets.reduce((s, a) => s + a.weight, 0) : 0;
  const expectedReturn = assets.length && assumed.length === assets.length
    ? assumed.reduce((s, a) => s + a.weight * Number(a.h.expectedReturnPct) / 100, 0) : null;

  const usable = assets.filter((a) => a.returns.size >= 20);
  let variance = 0;
  let covarianceReady = usable.length > 0;
  for (let i = 0; i < usable.length; i++) {
    for (let j = 0; j < usable.length; j++) {
      const [xs, ys] = paired(usable[i].returns, usable[j].returns);
      const cov = xs.length >= 20 ? sampleCov(xs, ys) : null;
      if (cov == null) covarianceReady = false;
      else variance += usable[i].weight * usable[j].weight * cov * 252;
    }
  }

  const correlations = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const [xs, ys] = paired(usable[i].returns, usable[j].returns);
      if (xs.length < 20) continue;
      const cov = sampleCov(xs, ys);
      const vx = sampleCov(xs, xs), vy = sampleCov(ys, ys);
      if (!(vx > 0) || !(vy > 0)) continue;
      correlations.push({
        a: usable[i].h.name, b: usable[j].h.name,
        value: cov / Math.sqrt(vx * vy), observations: xs.length,
      });
    }
  }
  correlations.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const riskWeight = usable.reduce((s, a) => s + a.weight, 0);
  return {
    expectedReturn,
    expectedCoverage,
    volatility: covarianceReady && variance >= 0 ? Math.sqrt(variance) : null,
    riskCoverage: stock > 0 ? (riskWeight * total) / stock : 0,
    correlations,
  };
}

/** 단일 종목·섹터 상한은 경고만 돌려준다. 거래를 막지 않는다. */
export function constraintWarnings(state, c, limits = {}) {
  if (!(c.total > 0)) return [];
  const single = Number(limits.singlePct);
  const sector = Number(limits.sectorPct);
  const warnings = [];
  const bySector = new Map();
  for (const h of state.holdings) {
    const pct = h.qty * h.price / c.total * 100;
    if (single > 0 && pct > single) warnings.push({ type: "single", label: h.name, pct, limit: single });
    bySector.set(h.sec, (bySector.get(h.sec) || 0) + pct);
  }
  if (sector > 0) {
    for (const [label, pct] of bySector) if (pct > sector) warnings.push({ type: "sector", label, pct, limit: sector });
  }
  return warnings.sort((a, b) => b.pct - a.pct);
}
