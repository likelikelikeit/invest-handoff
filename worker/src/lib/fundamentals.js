// M5a 재무·추정 저장. 한 종목의 여러 행을 json_each 한 문장으로 넣어 D1 쿼리 한도를 지킨다.

const FIN_COLS = ["revenue", "operating_income", "net_income", "eps", "bps", "ebitda", "net_debt", "shares_out"];

function dedupeFinancials(rows) {
  const byKey = new Map();
  // 같은 기간이면 DART(공식)가 네이버 폴백보다 우선한다.
  for (const row of rows) {
    const key = row.period_end + ":" + row.period_type;
    const old = byKey.get(key);
    if (!old || row.source === "dart" || old.source !== "dart") byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function upsertFinancialsStmt(env, securityId, rows, fetchedAt) {
  const packed = JSON.stringify(dedupeFinancials(rows).map((r) => [
    r.period_end, r.period_type, r.revenue, r.operating_income, r.net_income, r.eps, r.bps,
    r.ebitda, r.net_debt, r.shares_out, r.raw, r.source,
  ]));
  const keepDart = (col) => "CASE WHEN financials.source = 'dart' AND excluded.source <> 'dart' THEN financials." + col +
    " ELSE COALESCE(excluded." + col + ", financials." + col + ") END";
  return env.DB.prepare(
    "INSERT INTO financials (security_id, period_end, period_type, revenue, operating_income, net_income, eps, bps, ebitda, net_debt, shares_out, raw, source, fetched_at) " +
    "SELECT ?1, json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), " +
    "json_extract(value,'$[4]'), json_extract(value,'$[5]'), json_extract(value,'$[6]'), json_extract(value,'$[7]'), " +
    "json_extract(value,'$[8]'), json_extract(value,'$[9]'), json_extract(value,'$[10]'), json_extract(value,'$[11]'), ?3 " +
    "FROM json_each(?2) WHERE true ON CONFLICT(security_id, period_end, period_type) DO UPDATE SET " +
    FIN_COLS.map((c) => c + " = " + keepDart(c)).join(", ") +
    ", raw = CASE WHEN financials.source = 'dart' AND excluded.source <> 'dart' THEN financials.raw ELSE excluded.raw END" +
    ", source = CASE WHEN financials.source = 'dart' AND excluded.source <> 'dart' THEN financials.source ELSE excluded.source END" +
    ", fetched_at = excluded.fetched_at"
  ).bind(securityId, packed, fetchedAt);
}

export function upsertEstimatesStmt(env, securityId, rows) {
  const packed = JSON.stringify(rows.map((r) => [
    r.source, r.as_of, r.fiscal_year, r.eps, r.revenue, r.target_price, r.rating_mean, r.n_analysts, r.raw,
  ]));
  return env.DB.prepare(
    "INSERT INTO estimates (security_id, source, as_of, fiscal_year, eps, revenue, target_price, rating_mean, n_analysts, raw) " +
    "SELECT ?1, json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), " +
    "json_extract(value,'$[4]'), json_extract(value,'$[5]'), json_extract(value,'$[6]'), json_extract(value,'$[7]'), json_extract(value,'$[8]') " +
    "FROM json_each(?2) WHERE true ON CONFLICT DO UPDATE SET eps = excluded.eps, revenue = excluded.revenue, " +
    "target_price = excluded.target_price, rating_mean = excluded.rating_mean, n_analysts = excluded.n_analysts, raw = excluded.raw"
  ).bind(securityId, packed);
}

/**
 * 다음 실적일 교체: 같은 종목의 오늘 이후 야후 어닝일 중 새 날짜가 아닌 것은 지우고 새 날짜를 넣는다.
 * (발표일이 바뀌면 옛 날짜가 남지 않게. 지난 일정은 기록으로 둔다.) → 문 2개
 */
export function replaceEarningsStmts(env, securityId, date, createdAt, today) {
  return [
    env.DB.prepare(
      "DELETE FROM events WHERE security_id = ?1 AND kind = 'earnings' AND source = 'yahoo' AND date >= ?2 AND date <> ?3"
    ).bind(securityId, today, date),
    upsertEarningsStmt(env, securityId, date, createdAt),
  ];
}

export function upsertEarningsStmt(env, securityId, date, createdAt) {
  return env.DB.prepare(
    "INSERT INTO events (date, kind, security_id, title, source, detail, created_at) " +
    "VALUES (?1, 'earnings', ?2, '실적 발표 예정', 'yahoo', NULL, ?3) " +
    "ON CONFLICT(security_id, kind, date, source) DO UPDATE SET title = excluded.title"
  ).bind(date, securityId, createdAt);
}

/** 재무 갱신 대상: 보유+관심 equity, 숨김 제외. */
export async function trackedEquities(env) {
  const { results } = await env.DB.prepare(
    "SELECT s.id, s.name, s.ticker, s.ysym, s.market, s.currency, s.dart_corp_code " +
    "FROM securities s WHERE s.archived_at IS NULL AND s.asset_class = 'equity' AND " +
    "(s.id IN (SELECT security_id FROM positions) OR s.id IN (SELECT security_id FROM watchlist)) ORDER BY s.id"
  ).all();
  return results;
}

export function parseRaw(row) {
  if (!row) return row;
  try { return { ...row, raw: row.raw ? JSON.parse(row.raw) : null }; }
  catch { return { ...row, raw: null }; }
}
