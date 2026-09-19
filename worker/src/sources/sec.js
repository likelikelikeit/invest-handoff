// SEC EDGAR XBRL(companyconcept) → 분기 재무. 공식·무료·키 없음. 미국 상장사(10-Q/10-K 제출사)만.
// 해외 기업(20-F: TSMC·노보 등)과 ETF는 대상이 아니다.
// 응답이 커서 Worker(CPU 10ms)에서 부르지 않고 로컬 스크립트(scripts/sec-history.mjs)가 과거 이력을 한 번 채운다.
// 최근 분기는 야후 주간 크론이 계속 채운다. SEC 정책상 User-Agent에 연락처가 필요하다(코드에 넣지 않는다).

export const SEC_CONCEPTS = {
  eps: { unit: "USD/shares", tags: ["EarningsPerShareDiluted", "EarningsPerShareBasic"] },
  revenue: { unit: "USD", tags: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"] },
  net_income: { unit: "USD", tags: ["NetIncomeLoss"] },
  operating_income: { unit: "USD", tags: ["OperatingIncomeLoss"] },
};

const DAY = 86400000;
const days = (f) => (Date.parse(f.end) - Date.parse(f.start)) / DAY;

/**
 * 회계일(예: 7/26, 1/28)을 가장 가까운 월말로. 야후·네이버 분기 말과 맞추기 위해서다.
 * 15일 이하면 전달 말, 16일 이상이면 그달 말.
 */
export function nearestMonthEnd(date) {
  const d = new Date(date + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + (d.getUTCDate() <= 15 ? 0 : 1);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * 주식분할 보정 계수: 제출일 뒤에 일어난 분할 비율의 곱. SEC의 주당 값은 제출 당시 주식 기준이라
 * 오늘(분할 반영된 야후 주가) 기준으로 맞추려면 이 계수로 나눈다. splits = [{ date: 'YYYY-MM-DD', ratio }].
 */
export function splitFactor(filed, splits) {
  return (splits || []).filter((x) => x.date > String(filed)).reduce((p, x) => p * x.ratio, 1);
}

/**
 * companyconcept 응답의 한 단위 사실들 → { 'YYYY-MM-DD'(월말): 값 } 분기값.
 * perShare면(EPS) 각 사실을 제출일 기준으로 분할 보정한 뒤 쓴다(4분기 파생 전에).
 * 분기 = 기간 80~100일 사실. 같은 분기가 여러 번 나오면 가장 늦게 제출된 것(정정 반영).
 * 4분기는 보통 따로 없으므로 연간(350~380일) − 그 회계연도 안의 세 분기로 파생한다.
 */
export function quarterlyFromFacts(facts, { splits = [], perShare = false } = {}) {
  const latest = (list) => {
    const by = new Map();
    for (const f of list) {
      const k = f.start + "/" + f.end;
      const old = by.get(k);
      if (!old || String(f.filed) > String(old.filed)) by.set(k, f);
    }
    return [...by.values()];
  };
  const valid = (facts || []).filter((f) => f.start && f.end && Number.isFinite(f.val))
    .map((f) => (perShare ? { ...f, val: f.val / splitFactor(f.filed, splits) } : f));
  const quarters = latest(valid.filter((f) => days(f) >= 80 && days(f) <= 100));
  const years = latest(valid.filter((f) => days(f) >= 350 && days(f) <= 380));
  const out = new Map();
  for (const q of quarters) out.set(nearestMonthEnd(q.end), q.val);
  for (const fy of years) {
    const key = nearestMonthEnd(fy.end);
    if (out.has(key)) continue;
    const inside = quarters.filter((q) => q.start >= fy.start && q.end <= fy.end && q.end !== fy.end);
    // 같은 분기가 시작일만 달리 두 번 있을 수 있어 월말 기준으로 하나씩만
    const uniq = new Map(inside.map((q) => [nearestMonthEnd(q.end), q.val]));
    if (uniq.size !== 3) continue;
    out.set(key, fy.val - [...uniq.values()].reduce((s, v) => s + v, 0));
  }
  return out;
}

/** 첫 번째로 데이터가 있는 태그의 사실들 */
export function pickFacts(conceptResponses, spec) {
  for (const tag of spec.tags) {
    const facts = conceptResponses[tag]?.units?.[spec.unit];
    if (facts && facts.length) return facts;
  }
  return [];
}

/** 항목별 분기값을 financials 행으로 합친다. EPS가 있는 분기만. */
export function secFinancialRows(byField) {
  const eps = byField.eps || new Map();
  const rows = [];
  for (const [period_end, v] of [...eps.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    rows.push({
      period_end, period_type: "Q", source: "sec", eps: v,
      revenue: byField.revenue?.get(period_end) ?? null,
      net_income: byField.net_income?.get(period_end) ?? null,
      operating_income: byField.operating_income?.get(period_end) ?? null,
    });
  }
  return rows;
}
