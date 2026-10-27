// 실험 단계: 크론에 연결되지 않았다. 외부 시세를 계좌 원장에 넣는 경계만 검증한다.
import { selectSimulationExecution } from '../sources/simulation-intraday.js';
import { marketDate } from './simulation.js';

export async function settleIntradayOrders(env, orders, referenceSessions, securityData, now = new Date()) {
  let filled = 0, waiting = 0, rejected = 0;
  for (const order of orders) {
    const created = Date.parse(order.created_at) / 1000;
    const contestStart = Date.parse(order.contest_created_at) / 1000;
    if (!Number.isFinite(created) || !Number.isFinite(contestStart)) { waiting++; continue; }
    const selected = selectSimulationExecution(created, referenceSessions, securityData, contestStart, order.rules_version==='3');
    if (!selected.price || !Number.isFinite(selected.priceTime)) { waiting++; continue; }
    const date = marketDate(new Date(selected.priceTime * 1000), order.market);
    let fx = { date, close: 1 };
    if (order.currency === 'USD') {
      fx = await env.DB.prepare('SELECT date,close FROM sim_fx WHERE date<? ORDER BY date DESC LIMIT 1').bind(date).first();
      if (!fx || !(fx.close > 0) || Date.parse(date) - Date.parse(fx.date) > 7 * 86400000) { waiting++; continue; }
    }
    const price = selected.price * (1 + (order.side === 'buy' ? 1 : -1) * order.slippage_bps / 10000);
    const gross = order.qty * price * fx.close;
    const fee = gross * order.fee_bps / 10000;
    const delta = (order.side === 'buy' ? -gross : gross) - fee;
    try {
      const result = await env.DB.prepare(`INSERT INTO sim_fills
        (order_id,date,price,fx,fx_date,fee_krw,cash_delta,created_at,price_source,raw_price,quote_start,quote_end,quote_fetched_at,slippage_bps)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(
          SELECT 1 FROM sim_orders o JOIN sim_accounts a ON a.id=o.account_id JOIN sim_contests c ON c.id=a.contest_id
          WHERE o.id=? AND o.status='pending' AND c.status='active' AND c.rules_version IN ('2','3'))`)
        .bind(order.id,date,price,fx.close,fx.date,fee,delta,now.toISOString(),
          selected.kind === 'open' ? 'yahoo:15m-open' : 'yahoo:15m-close', selected.price,
          new Date(selected.barStart * 1000).toISOString(), new Date(selected.barEnd * 1000).toISOString(),
          securityData.fetchedAt,order.slippage_bps,order.id).run();
      if (result.meta.changes) filled++;
    } catch (error) {
      if (!/현금이 부족|수량이 부족/.test(String(error.message))) throw error;
      const r = await env.DB.prepare("UPDATE sim_orders SET status='rejected',status_reason=?,resolved_at=? WHERE id=? AND status='pending'")
        .bind(/현금/.test(error.message) ? '체결 시 현금 부족' : '체결 시 보유 수량 부족', now.toISOString(), order.id).run();
      if (r.meta.changes) rejected++;
    }
  }
  return { filled, waiting, rejected };
}
