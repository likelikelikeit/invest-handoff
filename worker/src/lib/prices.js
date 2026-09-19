// 일봉 저장·보유 스냅샷. D1 무료 플랜은 호출 1번에 쿼리 50개(batch 안의 문장도 각각 셈)라
// 종목 하나의 이력 전체를 JSON 파라미터 하나로 넘겨 json_each로 한 쿼리에 넣는다.

/** rows(parseChart 결과) → prices upsert 문 하나 */
export function upsertPricesStmt(env, securityId, rows) {
  const packed = JSON.stringify(rows.map((r) => [r.date, r.open, r.high, r.low, r.close, r.volume, r.adj_close]));
  return env.DB.prepare(
    "INSERT INTO prices (security_id, date, open, high, low, close, volume, adj_close) " +
    "SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), " +
    "json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'), json_extract(value, '$[6]') " +
    "FROM json_each(?2) WHERE true " +
    "ON CONFLICT(security_id, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, " +
    "close = excluded.close, volume = excluded.volume, adj_close = excluded.adj_close"
  ).bind(securityId, packed);
}

/** 크론이 시세를 챙기는 종목: 보유 + 관심 + 지수·환율. 숨긴 종목은 뺀다. */
export async function trackedSecurities(env) {
  const { results } = await env.DB.prepare(
    "SELECT s.id, s.ysym, s.market, s.currency, s.asset_class, " +
    "(SELECT COUNT(*) FROM prices p WHERE p.security_id = s.id) AS n " +
    "FROM securities s WHERE s.archived_at IS NULL AND (s.asset_class IN ('index', 'fx') " +
    "OR s.id IN (SELECT security_id FROM positions) OR s.id IN (SELECT security_id FROM watchlist)) ORDER BY s.id"
  ).all();
  return results;
}

/** 이력이 이만큼 안 되면 백필 대상 (5년 ≈ 1,250거래일, 막 상장한 종목도 있으니 넉넉히) */
export const BACKFILL_MIN_ROWS = 200;

/**
 * 보유 스냅샷 (SPEC §3.2 position_snapshots). date 이하의 가장 최근 종가와 환율로 원화 평가액을 얼린다.
 * market: 'KR' | 'US' | 'ALL'. 쿼리 하나.
 */
export function snapshotStmt(env, date, market) {
  return env.DB.prepare(
    "INSERT INTO position_snapshots (date, security_id, qty, price, fx_usdkrw, value_krw) " +
    "SELECT ?1, p.security_id, p.qty, px.close, fx.close, " +
    "p.qty * px.close * (CASE s.currency WHEN 'USD' THEN fx.close ELSE 1 END) " +
    "FROM positions p JOIN securities s ON s.id = p.security_id " +
    "JOIN prices px ON px.security_id = p.security_id " +
    "AND px.date = (SELECT MAX(date) FROM prices WHERE security_id = p.security_id AND date <= ?1) " +
    "LEFT JOIN (SELECT close FROM prices WHERE security_id = (SELECT id FROM securities WHERE ysym = 'KRW=X') " +
    "AND date <= ?1 ORDER BY date DESC LIMIT 1) fx ON 1 = 1 " +
    "WHERE (?2 = 'ALL' OR s.market = ?2) AND (s.currency <> 'USD' OR fx.close IS NOT NULL) " +
    "ON CONFLICT(date, security_id) DO UPDATE SET qty = excluded.qty, price = excluded.price, " +
    "fx_usdkrw = excluded.fx_usdkrw, value_krw = excluded.value_krw"
  ).bind(date, market);
}

/** 'YYYY-MM-DD' 기준 range 시작일 */
export function rangeStart(range, today) {
  const d = new Date(today + "T00:00:00Z");
  const years = { "1m": 1 / 12, "3m": 0.25, "1y": 1, "3y": 3, "5y": 5, "10y": 10, max: 100 }[range];
  if (years == null) return null;
  const days = Math.round(years * 365.25);
  return new Date(d.getTime() - days * 86400000).toISOString().slice(0, 10);
}
