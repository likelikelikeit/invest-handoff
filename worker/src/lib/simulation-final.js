import { HttpError } from './http.js';
import { completedDate, withinUsualSession } from './simulation.js';

// D1 batch는 한 트랜잭션이다. 먼저 공통 시점의 평가를 저장하고, 대기 주문을 취소한 뒤 종료한다.
export async function finishSimulationContest(env, contestId, now = new Date()) {
  const at = now.toISOString(), kr = completedDate(now,'KR'), us = completedDate(now,'US');
  const krMax = withinUsualSession(now,'KR') ? 5400 : 604800;
  const usMax = withinUsualSession(now,'US') ? 5400 : 604800;
  // 장이 닫힌 뒤 종료하면 그날 일봉 종가를 쓴다. 한국 15분봉은 15:00에서 끝나 동시호가 종가가 빠지기 때문이다.
  // 그날 일봉이 아직 없으면 마지막 15분봉을 그대로 쓴다.
  const krClosed = withinUsualSession(now,'KR') ? 0 : 1, usClosed = withinUsualSession(now,'US') ? 0 : 1;
  const daily = `px.close>0 AND ((s.market='KR' AND ${krClosed}=1 AND px.date='${kr}') OR (s.market='US' AND ${usClosed}=1 AND px.date='${us}'))`;
  const holdings = env.DB.prepare(`INSERT INTO sim_final_holdings(account_id,security_id,name,ticker,currency,market,qty,cost_krw,price,price_at,fx,fx_date)
    SELECT a.id,s.id,s.name,s.ticker,s.currency,s.market,p.qty,p.cost_krw,
      CASE WHEN c.rules_version IN ('2','3') THEN
        CASE WHEN ${daily} THEN px.close
          WHEN mc.status='ok' AND mc.verified_at<=? AND iq.price_at<=? AND
          (strftime('%s',?)-strftime('%s',iq.price_at)) BETWEEN 0 AND CASE s.market WHEN 'KR' THEN ? ELSE ? END THEN iq.price END
      ELSE CASE WHEN px.date IS NOT NULL AND julianday(CASE s.market WHEN 'KR' THEN ? ELSE ? END)-julianday(px.date)<=7 THEN px.close END END,
      CASE WHEN c.rules_version IN ('2','3') THEN CASE WHEN ${daily} THEN px.date ELSE iq.price_at END ELSE px.date END,
      CASE WHEN s.currency='KRW' THEN 1 WHEN fx.date IS NOT NULL AND julianday(?)-julianday(fx.date)<=7 THEN fx.close END,
      CASE WHEN s.currency='USD' THEN fx.date ELSE NULL END
    FROM sim_accounts a JOIN sim_contests c ON c.id=a.contest_id JOIN sim_positions p ON p.account_id=a.id AND p.qty>0.000001
    JOIN sim_securities s ON s.id=p.security_id
    LEFT JOIN sim_intraday_quotes iq ON iq.security_id=s.id LEFT JOIN sim_market_checks mc ON mc.security_id=s.id
    LEFT JOIN sim_prices px ON px.security_id=s.id AND px.date=(SELECT MAX(date) FROM sim_prices WHERE security_id=s.id AND date<=CASE s.market WHEN 'KR' THEN ? ELSE ? END)
    LEFT JOIN sim_fx fx ON fx.date=(SELECT MAX(date) FROM sim_fx WHERE date<=?)
    WHERE c.id=? AND c.status='active'`)
    .bind(at,at,at,krMax,usMax,kr,us,us,kr,us,us,contestId);
  const accounts = env.DB.prepare(`INSERT INTO sim_final_accounts(account_id,as_of,cash,equity,return_pct,complete)
    SELECT a.id,?,a.cash,
      CASE WHEN EXISTS(SELECT 1 FROM sim_final_holdings h WHERE h.account_id=a.id AND (h.price IS NULL OR h.price<=0 OR h.fx IS NULL OR h.fx<=0)) THEN NULL
        ELSE a.cash+COALESCE((SELECT SUM(h.qty*h.price*h.fx) FROM sim_final_holdings h WHERE h.account_id=a.id),0) END,
      CASE WHEN EXISTS(SELECT 1 FROM sim_final_holdings h WHERE h.account_id=a.id AND (h.price IS NULL OR h.price<=0 OR h.fx IS NULL OR h.fx<=0)) THEN NULL
        ELSE ((a.cash+COALESCE((SELECT SUM(h.qty*h.price*h.fx) FROM sim_final_holdings h WHERE h.account_id=a.id),0))/c.initial_cash-1)*100 END,
      CASE WHEN EXISTS(SELECT 1 FROM sim_final_holdings h WHERE h.account_id=a.id AND (h.price IS NULL OR h.price<=0 OR h.fx IS NULL OR h.fx<=0)) THEN 0 ELSE 1 END
    FROM sim_accounts a JOIN sim_contests c ON c.id=a.contest_id WHERE c.id=? AND c.status='active'`).bind(at,contestId);
  const cancel = env.DB.prepare("UPDATE sim_orders SET status='cancelled',status_reason='대회 종료로 미체결 주문 취소',resolved_at=? WHERE status='pending' AND account_id IN (SELECT a.id FROM sim_accounts a JOIN sim_contests c ON c.id=a.contest_id WHERE c.id=? AND c.status='active')").bind(at,contestId);
  const end = env.DB.prepare("UPDATE sim_contests SET status='ended',ended_at=? WHERE id=? AND status='active'").bind(at,contestId);
  const result = await env.DB.batch([holdings,accounts,cancel,end]);
  if (!result[3]?.meta?.changes) throw new HttpError(409,'이미 종료되었거나 대회를 찾을 수 없습니다');
  return { ended: true, as_of: at };
}
