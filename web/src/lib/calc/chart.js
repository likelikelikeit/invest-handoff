// 가격 차트용 순수 함수. rows = [[date, open, high, low, close, volume], ...] 날짜 오름차순.

export const RANGES = [
  { key: "1m", label: "1M", years: 1 / 12 },
  { key: "3m", label: "3M", years: 0.25 },
  { key: "1y", label: "1Y", years: 1 },
  { key: "3y", label: "3Y", years: 3 },
  { key: "5y", label: "5Y", years: 5 },
  { key: "10y", label: "10Y", years: 10 },
];

function minusYears(date, years) {
  const d = new Date(date + "T00:00:00Z");
  return new Date(d.getTime() - Math.round(years * 365.25) * 86400000).toISOString().slice(0, 10);
}

/** 마지막 날짜 기준으로 기간만큼 자른다 */
export function sliceRange(rows, key) {
  if (!rows.length) return rows;
  const r = RANGES.find((x) => x.key === key);
  if (!r) return rows;
  const from = minusYears(rows[rows.length - 1][0], r.years);
  return rows.filter((x) => x[0] >= from);
}

/**
 * 이력이 그 기간을 (거의) 덮을 때만 토글을 켠다. 10년 버튼이 5년치로 같은 그림을 보여주지 않게.
 * 90% 이상 덮으면 사용 가능.
 */
export function availableRanges(rows) {
  if (!rows.length) return new Set();
  const first = new Date(rows[0][0] + "T00:00:00Z").getTime();
  const last = new Date(rows[rows.length - 1][0] + "T00:00:00Z").getTime();
  const spanYears = (last - first) / (365.25 * 86400000);
  return new Set(RANGES.filter((r, i) => i === 0 || spanYears >= r.years * 0.9).map((r) => r.key));
}

/** 기간 첫 종가 대비 */
export function periodChange(rows) {
  if (rows.length < 2) return { abs: 0, pct: 0 };
  const a = rows[0][4];
  const b = rows[rows.length - 1][4];
  return { abs: b - a, pct: a ? (b / a - 1) * 100 : 0 };
}

/** 52주 범위: 최근 1년 고가·저가와 현재가 위치(0~1). 고가·저가가 없으면 종가로. */
export function range52w(rows, current) {
  const yr = sliceRange(rows, "1y");
  if (!yr.length) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const r of yr) {
    low = Math.min(low, r[3] ?? r[4]);
    high = Math.max(high, r[2] ?? r[4]);
  }
  const px = current ?? yr[yr.length - 1][4];
  low = Math.min(low, px);
  high = Math.max(high, px);
  return { low, high, pos: high > low ? (px - low) / (high - low) : 0.5 };
}

/** 최근 거래량과 20일 평균 */
export function volumeStats(rows) {
  const v = rows.filter((r) => r[5] != null);
  if (!v.length) return null;
  const last = v[v.length - 1][5];
  const tail = v.slice(-21, -1);
  const avg20 = tail.length ? tail.reduce((a, r) => a + r[5], 0) / tail.length : null;
  return { last, avg20, ratio: avg20 ? last / avg20 : null };
}
