/** 재무 화면 계산은 UI 밖의 순수 함수로 둔다. */

export const FINANCIAL_METRICS = [
  { key: "revenue", label: "매출" },
  { key: "operating_income", label: "영업이익" },
  { key: "net_income", label: "순이익" },
  { key: "eps", label: "EPS" },
  { key: "bps", label: "BPS" },
  { key: "ebitda", label: "EBITDA" },
  { key: "net_debt", label: "순차입금" },
];

export function financialPeriods(rows, type, limit = 6) {
  return (rows || []).filter((r) => r.period_type === type)
    .sort((a, b) => a.period_end.localeCompare(b.period_end)).slice(-limit);
}

export function availableMetrics(rows) {
  return FINANCIAL_METRICS.filter((m) => rows.some((r) => Number.isFinite(r[m.key])));
}

export function metricSeries(rows, key) {
  return rows.filter((r) => Number.isFinite(r[key])).map((r) => ({ date: r.period_end, value: r[key] }));
}

export function latestTarget(estimates, market) {
  const preferred = market === "KR" ? "naver" : "yahoo";
  const rows = (estimates || []).filter((e) => Number.isFinite(e.target_price));
  return rows.find((e) => e.source === preferred) || rows[0] || null;
}

export function sourceLabel(source) {
  return ({ dart: "DART", naver: "네이버·FnGuide", yahoo: "Yahoo", mine: "내 추정" })[source] || source;
}
