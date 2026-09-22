// 투자의견 계산 (SPEC §5.2.4). 순수 함수. 가격은 전부 의견의 목표 통화(종목 통화) 기준.

/** created_at('2026-09-19T16:00:00+09:00') + horizon_months → 'YYYY-MM-DD' (KST 날짜) */
export function horizonEnd(createdAt, months) {
  const d = new Date(createdAt.slice(0, 10) + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // 말일 보정: 1/31 + 1개월 = 2/28(29)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** 'in_progress' | 'awaiting'(기간 끝, 크론 평가 전) | 'evaluated' */
export function status(v, today) {
  if (v.evaluated_at) return "evaluated";
  return horizonEnd(v.created_at, v.horizon_months) <= today ? "awaiting" : "in_progress";
}

/** 기간 경과 비율 0~1 */
export function elapsed(v, today) {
  const a = new Date(v.created_at.slice(0, 10) + "T00:00:00Z").getTime();
  const b = new Date(horizonEnd(v.created_at, v.horizon_months) + "T00:00:00Z").getTime();
  const t = new Date(today + "T00:00:00Z").getTime();
  return b > a ? Math.max(0, Math.min(1, (t - a) / (b - a))) : 1;
}

/** 지금 가격 기준 상승여력 */
export function upsideNow(v, price) {
  return price > 0 ? v.target_price / price - 1 : null;
}

/** 기록 이후 수익률 */
export function returnSince(v, price) {
  return price > 0 && v.price_at > 0 ? price / v.price_at - 1 : null;
}

/** 목표 방향으로 얼마나 왔나 (0 = 기록 시점, 1 = 목표 도달). 하향 목표도 같은 식. */
export function progressToTarget(v, price) {
  const span = v.target_price - v.price_at;
  if (!(price > 0) || span === 0) return null;
  return (price - v.price_at) / span;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * 성과 요약 (SPEC §5.2.5).
 *
 * 적중률은 '판정이 끝난' 의견으로 낸다 = 만기 평가된 것 + 기간 중 이미 목표가에 닿은 것(조기 적중).
 * 적중 기준이 "기간 안에 한 번이라도 도달"이라 닿는 순간 결과가 확정되기 때문이다 [사용자 결정 2026-09-23].
 * 평균 목표/실제 수익률과 MAE는 만기 종가가 있어야 하므로 만기 평가된 것만으로 낸다.
 * 그래서 두 표본 수가 다를 수 있다 — 화면에 둘 다 적는다(n, matured).
 *
 * 소급 기록(backdated, §5.2.6)도 같이 센다 [사용자 결정 2026-09-22].
 */
export function performance(views, today) {
  const matured = views.filter((v) => v.evaluated_at);
  const early = views.filter((v) => !v.evaluated_at && v.hit === 1);
  const judged = matured.concat(early);
  const hits = judged.filter((v) => v.hit === 1).length;
  const open = views.filter((v) => !v.evaluated_at && v.hit !== 1);
  return {
    n: judged.length,
    early: early.length,
    hitRate: judged.length ? hits / judged.length : null,
    matured: matured.length,
    avgTarget: mean(matured.map((v) => v.target_return).filter((x) => x != null)),
    avgActual: mean(matured.map((v) => v.actual_return).filter((x) => x != null)),
    mae: mean(matured.map((v) => v.abs_error).filter((x) => x != null)),
    inProgress: open.filter((v) => status(v, today) === "in_progress").length,
    awaiting: open.filter((v) => status(v, today) === "awaiting").length,
  };
}

/**
 * 홈 의견 블록 (SPEC §4.2 블록 3): 의견 있는 종목을 지금 상승여력 큰 순으로,
 * 의견 없는 보유 종목은 뒤에 흐린 줄로.
 * latest: /views/latest, held: [{id, name, ...}], priceOf(ysym) → 목표 통화 가격
 */
export function homeRows(latest, held, priceOf) {
  const withView = latest.map((v) => {
    const price = priceOf(v.ysym);
    return { kind: "view", view: v, price, upside: upsideNow(v, price) };
  });
  withView.sort((a, b) => (b.upside ?? -Infinity) - (a.upside ?? -Infinity));
  const has = new Set(latest.map((v) => v.security_id));
  const without = held.filter((h) => !has.has(h.id)).map((h) => ({ kind: "none", holding: h }));
  return withView.concat(without);
}
