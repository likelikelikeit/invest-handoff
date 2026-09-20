// /fundamentals — 재무·추정 조회와 단일 종목 즉시 갱신.

import { json, HttpError } from "../lib/http.js";
import { todayKst } from "../lib/time.js";
import { refreshFundamentals } from "../cron/weekly.js";
import { securityOut, valuationReadiness } from "./securities.js";

async function sec(env, id) {
  const row = await env.DB.prepare("SELECT * FROM securities WHERE id = ?1").bind(id).first();
  if (!row) throw new HttpError(404, "종목 " + id + "이(가) 없습니다");
  return row;
}

export async function getFundamentals(request, env, headers, p) {
  const s = await sec(env, p.id);
  const [financials, estimates, events] = await env.DB.batch([
    env.DB.prepare(
      "SELECT period_end, period_type, revenue, operating_income, net_income, eps, bps, ebitda, net_debt, shares_out, " +
      "source, fetched_at, currency, source_currency, adr_ratio, fx_rate, balance_fx_rate " +
      "FROM financials WHERE security_id = ?1 ORDER BY period_end DESC, period_type"
    ).bind(p.id),
    env.DB.prepare(
      "SELECT id, source, as_of, fiscal_year, eps, revenue, target_price, rating_mean, n_analysts FROM estimates e " +
      "WHERE security_id = ?1 AND id = (SELECT id FROM estimates x WHERE x.security_id=e.security_id AND x.source=e.source " +
      "AND COALESCE(x.fiscal_year,-1)=COALESCE(e.fiscal_year,-1) ORDER BY x.as_of DESC,x.id DESC LIMIT 1) " +
      "ORDER BY COALESCE(fiscal_year,9999), source"
    ).bind(p.id),
    env.DB.prepare(
      "SELECT date, title, source FROM events WHERE security_id = ?1 AND kind='earnings' AND date >= ?2 ORDER BY date LIMIT 1"
    ).bind(p.id, todayKst()),
  ]);
  const metadata = valuationReadiness(s);
  // 오래된 미환산 행은 밴드 계산에서 제외할 수 있다. 현재 TTM을 만드는 최신 4개 분기만
  // 모두 상장 통화로 정규화됐는지 확인해 화면 전체를 막을지 결정한다.
  const latestQuarters = financials.results.filter((r) => r.period_type === "Q").slice(0, 4);
  const unconverted = latestQuarters.some((r) => r.currency !== s.currency);
  const readiness = unconverted
    ? { valuation_ready: false, valuation_block_reason: "상장 통화로 환산되지 않은 재무 데이터가 있습니다" }
    : metadata;
  return json({
    ok: true,
    security: { ...securityOut(s), ...readiness },
    financials: financials.results,
    estimates: estimates.results,
    next_earnings: events.results[0] || null,
  }, 200, headers);
}

export async function refreshFundamentalsRoute(request, env, headers, p) {
  const s = await sec(env, p.id);
  try {
    const result = await refreshFundamentals(env, s, { withDart: true });
    return json({ ok: true, result }, 200, headers);
  } catch (e) {
    // 외부 비공식 소스 실패가 앱 전체 오류로 번지지 않게 200 + ok:false로 돌린다.
    return json({ ok: false, error: String(e.message || e) }, 200, headers);
  }
}
