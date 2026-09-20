// 밸류에이션 계산은 서버에서도 숫자로 검증한다. LLM은 관여하지 않는다.

export const VALUATION_METRICS = ["per", "pbr", "ev_ebitda", "psr"];

/** 시나리오의 주당 적정가. value는 PER=EPS, PBR=BPS, PSR=주당매출, EV=EBITDA 총액. */
export function impliedTarget(a) {
  const value = Number(a?.value);
  const multiple = Number(a?.multiple);
  if (!(value > 0) || !(multiple > 0)) return null;
  if (a.metric === "ev_ebitda") {
    const shares = Number(a.shares);
    const netDebt = Number(a.net_debt || 0);
    if (!(shares > 0)) return null;
    const target = (value * multiple - netDebt) / shares;
    return target > 0 && Number.isFinite(target) ? target : null;
  }
  const target = value * multiple;
  return target > 0 && Number.isFinite(target) ? target : null;
}

/**
 * 의견 기록 순간의 TTM PER. 이미 끝난 최근 네 분기 EPS가 연속으로(첫~끝 분기 말 약 9개월) 있을 때만 값이 생긴다.
 * 빠진 분기가 있으면 TTM이 아니므로 null.
 */
export async function perAt(env, securityId, price, today = new Date().toISOString().slice(0, 10)) {
  const { results } = await env.DB.prepare(
    "SELECT f.period_end, f.eps, f.currency, s.currency AS listing_currency FROM financials f " +
    "JOIN securities s ON s.id = f.security_id WHERE f.security_id = ?1 AND f.period_type = 'Q' AND f.eps IS NOT NULL " +
    "AND f.period_end <= ?2 ORDER BY f.period_end DESC LIMIT 4"
  ).bind(securityId, today).all();
  if (results.length !== 4) return null;
  // ADR·이중상장 종목의 원천 재무 통화가 상장 가격 통화로 정규화되지 않았으면
  // 가격/TTM EPS를 섞지 않는다. 0009 이전·직접 입력 행도 통화가 비면 안전하게 중단한다.
  if (results.some((row) => !row.currency || row.currency !== row.listing_currency)) return null;
  const span = (Date.parse(results[0].period_end) - Date.parse(results[3].period_end)) / 86400000;
  if (span < 240 || span > 300) return null;
  const eps = results.reduce((sum, row) => sum + Number(row.eps), 0);
  return eps > 0 && Number.isFinite(price / eps) ? price / eps : null;
}
