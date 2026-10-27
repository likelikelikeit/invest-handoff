// 실험 단계. 운영 크론에 연결하기 전 외부 데이터와 분할 원장을 검증한다.
import { marketDate, withinUsualSession } from './simulation.js';
import { recordSimulationSplit } from './simulation-split.js';
import { settleIntradayOrders } from './simulation-intraday-settlement.js';

export async function processSimulationSymbol(env, security, contest, reference, data, now = new Date()) {
  const mark = async (status, detail = null, verifiedAt = null) => env.DB.prepare(`INSERT INTO sim_market_checks(security_id,attempted_at,verified_at,status,detail)
    VALUES(?,?,CASE WHEN ?='ok' THEN ? ELSE NULL END,?,?) ON CONFLICT(security_id) DO UPDATE SET
    attempted_at=excluded.attempted_at,verified_at=COALESCE(excluded.verified_at,sim_market_checks.verified_at),status=excluded.status,detail=excluded.detail`)
    .bind(security.id,now.toISOString(),status,verifiedAt,status,detail).run();
  try {
    if (!reference.sessions.length || !data.sessions.length || !Number.isFinite(data.marketTime) || data.marketTime>now.getTime()/1000+60) throw new Error('정규장 또는 시세 기준 시각 확인 필요');
    const nowSeconds=now.getTime()/1000, latestSession=reference.sessions.at(-1);
    if (nowSeconds-latestSession.end>4*86400 || (withinUsualSession(now,security.market) && nowSeconds-latestSession.end>86400))
      throw new Error('시장 정규장 정보가 오래되어 확인이 필요합니다');
    if (nowSeconds>latestSession.start+20*60 && data.marketTime<latestSession.start)
      throw new Error('종목 시세가 정규장 시작을 반영하지 않았습니다');
    const last = await env.DB.prepare('SELECT verified_at FROM sim_market_checks WHERE security_id=?').bind(security.id).first();
    const first = reference.sessions[0].start;
    const earliest = Math.floor(Math.max(Date.parse(last?.verified_at || contest.created_at),Date.parse(contest.created_at)) / 1000);
    if (!Number.isFinite(earliest) || earliest < first) throw new Error('거래일 또는 기업행동 이력 확인 필요');
    for (const session of reference.sessions.filter(s => s.end >= earliest && s.start <= now.getTime() / 1000)) {
      if (!data.sessions.some(s => s.start === session.start && s.end === session.end)) throw new Error('종목과 시장의 정규장 정보가 다릅니다');
    }
    const splitEvents = data.splits.filter(e => e.at >= Date.parse(contest.created_at) / 1000 && e.at <= now.getTime() / 1000);
    if (splitEvents.length > 2) throw new Error('분할·병합 이력이 많아 별도 확인이 필요합니다');
    for (const split of splitEvents) {
      const existing = await env.DB.prepare('SELECT numerator,denominator FROM sim_splits WHERE security_id=? AND effective_at=?')
        .bind(security.id,new Date(split.at * 1000).toISOString()).first();
      if (existing) {
        if (existing.numerator !== split.numerator || existing.denominator !== split.denominator) throw new Error('분할·병합 정보가 변경됐습니다');
        continue;
      }
      const session = reference.sessions.find(s => s.start === split.at);
      const bar = session && data.rows.find(row => row.start === session.start && row.open > 0);
      if (!bar) throw new Error('분할·병합 정산용 정규장 시가 확인 필요');
      const date = marketDate(new Date(split.at * 1000), security.market);
      let fx = { close: 1, date };
      if (security.currency === 'USD') {
        fx = await env.DB.prepare('SELECT date,close FROM sim_fx WHERE date<? ORDER BY date DESC LIMIT 1').bind(date).first();
        if (!fx || !(fx.close > 0) || Date.parse(date) - Date.parse(fx.date) > 7 * 86400000) throw new Error('분할·병합 정산 환율 확인 필요');
      }
      await recordSimulationSplit(env,{security_id:security.id,effective_at:new Date(split.at*1000).toISOString(),market_date:date,
        numerator:split.numerator,denominator:split.denominator,cash_price:bar.open,fx:fx.close,fx_date:fx.date,source:'yahoo'},now);
    }
    const lastBar = data.rows.at(-1);
    if (lastBar) await env.DB.prepare(`INSERT INTO sim_intraday_quotes(security_id,price,price_at,fetched_at,source) VALUES(?,?,?,?,?)
      ON CONFLICT(security_id) DO UPDATE SET price=excluded.price,price_at=excluded.price_at,fetched_at=excluded.fetched_at,source=excluded.source
      WHERE excluded.price_at>sim_intraday_quotes.price_at OR (excluded.price_at=sim_intraday_quotes.price_at AND excluded.price<>sim_intraday_quotes.price)`)
      .bind(security.id,lastBar.close,new Date(lastBar.end*1000).toISOString(),data.fetchedAt,'yahoo:15m').run();
    const {results:orders} = await env.DB.prepare(`SELECT o.*,s.market,s.currency,c.fee_bps,c.slippage_bps,c.created_at AS contest_created_at,c.rules_version
      FROM sim_orders o JOIN sim_securities s ON s.id=o.security_id JOIN sim_accounts a ON a.id=o.account_id
      JOIN sim_contests c ON c.id=a.contest_id WHERE o.security_id=? AND c.id=? AND o.status='pending' AND c.status='active'
      ORDER BY o.created_at,o.rowid LIMIT 4`).bind(security.id,contest.id).all();
    // 이미 적용된 분할은 재체결을 막지 않는다. 위에서 전부 확인했다.
    const result = await settleIntradayOrders(env,orders,reference.sessions,{...data,splits:[]},now);
    await mark('ok',null,new Date(Math.min(data.marketTime,now.getTime()/1000)*1000).toISOString());
    return result;
  } catch (error) {
    await mark('hold',String(error.message || error).slice(0,300));
    // 체결 중 예외라면 앞선 주문이 이미 원장에 기록됐을 수 있다.
    return { filled: null, waiting: true, error: String(error.message || error) };
  }
}
