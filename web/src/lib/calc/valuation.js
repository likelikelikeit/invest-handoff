/** 밸류에이션은 전부 순수 함수로 계산한다. API/컴포넌트는 결과만 표시·저장한다. */

export const VALUATION_METRICS = [
  { key: "per", label: "PER", valueLabel: "EPS", growthLabel: "EPS 성장률" },
  { key: "pbr", label: "PBR", valueLabel: "BPS", growthLabel: "ROE" },
  { key: "ev_ebitda", label: "EV/EBITDA", valueLabel: "EBITDA", growthLabel: "EBITDA 성장률" },
  { key: "psr", label: "PSR", valueLabel: "주당매출", growthLabel: "매출 성장률" },
];

const sum = (rows, key) => rows.every((r) => Number.isFinite(r[key]))
  ? rows.reduce((s, r) => s + r[key], 0) : null;

const DAY = 86400000;

/** 네 분기가 연속인가: 첫 분기 말과 끝 분기 말 사이가 약 9개월(± 한 달). 빠진 분기가 있으면 TTM이 아니다. */
export function consecutiveQuarters(four) {
  if (four.length !== 4) return false;
  const span = (Date.parse(four[3].period_end) - Date.parse(four[0].period_end)) / DAY;
  return span >= 240 && span <= 300;
}

/** 최근 4개 분기를 굴려 TTM 행을 만든다. BPS·순차입금·주식수는 기말값을 쓴다. 연속 네 분기일 때만. */
export function ttmSeries(financials) {
  const q = (financials || []).filter((r) => r.period_type === "Q")
    .sort((a, b) => a.period_end.localeCompare(b.period_end));
  const out = [];
  for (let i = 3; i < q.length; i++) {
    const four = q.slice(i - 3, i + 1);
    if (!consecutiveQuarters(four)) continue;
    const last = q[i];
    const shares = Number.isFinite(last.shares_out) ? last.shares_out
      : [...four].reverse().find((r) => Number.isFinite(r.shares_out))?.shares_out ?? null;
    const revenue = sum(four, "revenue");
    out.push({
      date: last.period_end,
      eps: sum(four, "eps"), revenue, ebitda: sum(four, "ebitda"),
      bps: Number.isFinite(last.bps) ? last.bps : null,
      net_debt: Number.isFinite(last.net_debt) ? last.net_debt : null,
      shares,
      revenue_per_share: revenue != null && shares > 0 ? revenue / shares : null,
    });
  }
  return out;
}

export function baseValue(row, metric) {
  if (!row) return null;
  if (metric === "per") return row.eps;
  if (metric === "pbr") return row.bps;
  if (metric === "ev_ebitda") return row.ebitda;
  if (metric === "psr") return row.revenue_per_share;
  return null;
}

export function multipleAt(price, row, metric) {
  const px = Number(price);
  const value = baseValue(row, metric);
  if (!(px > 0) || !(value > 0)) return null;
  if (metric === "ev_ebitda") {
    if (!(row.shares > 0)) return null;
    return (px * row.shares + Number(row.net_debt || 0)) / value;
  }
  return px / value;
}

/** 일봉마다 그날까지 발표된 최신 TTM을 붙인다. */
export function dailyMultiples(prices, ttm, metric) {
  const fs = [...(ttm || [])].sort((a, b) => a.date.localeCompare(b.date));
  let j = -1;
  return (prices || []).map((p) => {
    while (j + 1 < fs.length && fs[j + 1].date <= p[0]) j++;
    if (j < 0) return null;
    const row = fs[j];
    const multiple = multipleAt(p[4], row, metric);
    return multiple == null ? null : { date: p[0], price: p[4], multiple, fundamental: baseValue(row, metric), ttm: row };
  }).filter(Boolean);
}

export function quantile(values, p) {
  const a = (values || []).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}

export function cleanMultiple(n) {
  if (!Number.isFinite(n)) return null;
  return n >= 5 ? Math.round(n) : Math.round(n * 2) / 2;
}

export function suggestedMultiples(series) {
  const values = (series || []).map((x) => x.multiple).filter((x) => Number.isFinite(x) && x > 0 && x < 500);
  if (!values.length) return [];
  return [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => cleanMultiple(quantile(values, p)));
}

/** 특정 배수에서 주가로 환산. EV/EBITDA는 기업가치에서 순차입금을 뺀다. */
export function bandPrice(row, metric, multiple) {
  const value = baseValue(row, metric);
  const m = Number(multiple);
  if (!(value > 0) || !(m > 0)) return null;
  if (metric === "ev_ebitda") {
    if (!(row.shares > 0)) return null;
    const price = (value * m - Number(row.net_debt || 0)) / row.shares;
    return price > 0 ? price : null;
  }
  return value * m;
}

/** 성장률에서 계산한 값의 부동소수점 꼬리를 없앤다: 주당 지표는 소수 4자리, EBITDA 총액은 정수. */
export function roundValue(v, metric) {
  if (!Number.isFinite(v)) return v;
  return metric === "ev_ebitda" ? Math.round(v) : Math.round(v * 10000) / 10000;
}

export function valueFromGrowth(current, growthPct, years = 1) {
  const c = Number(current), g = Number(growthPct), y = Number(years);
  return c > 0 && Number.isFinite(g) && y > 0 ? c * Math.pow(1 + g / 100, y) : null;
}

export function growthFromValue(current, value, years = 1) {
  const c = Number(current), v = Number(value), y = Number(years);
  return c > 0 && v > 0 && y > 0 ? (Math.pow(v / c, 1 / y) - 1) * 100 : null;
}

export function scenarioTarget(a) {
  const value = Number(a?.value), multiple = Number(a?.multiple);
  if (!(value > 0) || !(multiple > 0)) return null;
  if (a.metric === "ev_ebitda") {
    const shares = Number(a.shares), netDebt = Number(a.net_debt || 0);
    if (!(shares > 0)) return null;
    const target = (value * multiple - netDebt) / shares;
    return target > 0 ? target : null;
  }
  return value * multiple;
}

export function latestConsensusValue(estimates, metric, latestTtm) {
  const future = (estimates || []).filter((e) => Number.isFinite(e.fiscal_year)).sort((a, b) => a.fiscal_year - b.fiscal_year);
  if (metric === "per") return future.find((e) => e.eps > 0)?.eps ?? null;
  if (metric === "psr" && latestTtm?.shares > 0) {
    const revenue = future.find((e) => e.revenue > 0)?.revenue;
    return revenue ? revenue / latestTtm.shares : null;
  }
  return null;
}

/** 배수 표기: 40 → "40배", 1.2 → "1.2배" */
export function multipleText(n) {
  if (!Number.isFinite(n)) return "";
  return String(parseFloat(n.toFixed(2))) + "배";
}

/**
 * 목표가 산출 방식을 조각으로 (SPEC §5.2.7). 화면이 숫자만 굵게 쓰려고 나눠 준다.
 *   { valueLabel: "EPS", value: "$15.00", label: "PER", multiple: "40배", target: "$600.00" }
 * fmt는 종목 통화 표기 함수(valueFmt). EV/EBITDA는 순부채·주식수를 거쳐 주당 목표가가 나오므로
 * 곱셈 결과를 목표가로 쓰지 않는다(target = null).
 */
export function basisParts(a, fmt) {
  const m = VALUATION_METRICS.find((x) => x.key === a?.metric);
  if (!m || !(a.value > 0) || !(a.multiple > 0)) return null;
  return {
    valueLabel: m.valueLabel,
    value: fmt(a.value),
    label: m.label,
    multiple: multipleText(a.multiple),
    target: m.key === "ev_ebitda" ? null : fmt(a.value * a.multiple),
  };
}

/** 같은 내용을 한 줄 글로: "EPS $15.00 × PER 40배 = $600.00" */
export function basisText(a, fmt) {
  const p = basisParts(a, fmt);
  if (!p) return null;
  const head = p.valueLabel + " " + p.value + " × " + p.label + " " + p.multiple;
  return p.target ? head + " = " + p.target : head;
}
