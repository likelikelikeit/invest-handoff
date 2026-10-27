import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from './d1shim.js';
import { createContest, saveThesis, submitOrder } from '../src/lib/simulation.js';
import { settleIntradayOrders } from '../src/lib/simulation-intraday-settlement.js';

const open = Date.parse('2026-10-27T13:30:00Z') / 1000;
const session = { start: open, end: open + 23400 };
const previous = { start: open - 86400, end: open - 86400 + 23400 };
const fetched = new Date((open + 3600) * 1000);
let env, accountId, securityId;
const feed = () => ({ sessions: [session], splits: [], fetchedAt: fetched.toISOString(), rows: [
  { start: open, end: open + 900, sessionStart: open, open: 100, close: 101 },
  { start: open + 900, end: open + 1800, sessionStart: open, open: 101, close: 102 },
] });
async function makeOrder(time = new Date((open + 7 * 60) * 1000), qty = 1, account = accountId) {
  const thesis = await saveThesis(env, account, { security_id: securityId, thesis: '근거', valuation: '가치', scenarios: '시나리오', risks: '위험', invalidation: '철회', sources: '출처' }, time);
  const saved = await submitOrder(env, account, { thesis_id: thesis.id, side: 'buy', qty, reason: '근거', client_order_id: crypto.randomUUID() }, time);
  return env.DB.raw.prepare(`SELECT o.*, s.market,s.currency,c.fee_bps,c.slippage_bps,c.created_at AS contest_created_at
    FROM sim_orders o JOIN sim_securities s ON s.id=o.security_id JOIN sim_accounts a ON a.id=o.account_id
    JOIN sim_contests c ON c.id=a.contest_id WHERE o.id=?`).get(saved.order.id);
}
beforeEach(async () => {
  env = { DB: makeDb(), SIM_INTRADAY_ENABLED: 'true' };
  await createContest(env, { name: '시험', initial_cash: 1000000 }, new Date('2026-10-26T00:00:00Z'));
  accountId = env.DB.raw.prepare('SELECT id FROM sim_accounts LIMIT 1').get().id;
  securityId = env.DB.raw.prepare("INSERT INTO sim_securities(name,ticker,ysym,market,currency,created_at) VALUES('시험','TEST','TEST','US','USD',?) RETURNING id").get('2026-10-26T00:00:00Z').id;
  env.DB.raw.prepare("INSERT INTO sim_fx(date,close) VALUES('2026-10-26',1400)").run();
});
describe('모의 15분봉 체결 원장', () => {
  it('주문이 속한 완성 봉의 종가에 비용을 적용하고 두 번 차감하지 않는다', async () => {
    const order = await makeOrder();
    expect((await settleIntradayOrders(env, [order], [previous, session], feed(), fetched)).filled).toBe(1);
    expect((await settleIntradayOrders(env, [order], [previous, session], feed(), fetched)).filled).toBe(0);
    const fill = env.DB.raw.prepare('SELECT * FROM sim_fills').get();
    expect(fill.raw_price).toBe(101); expect(fill.price).toBeCloseTo(101 * 1.0005);
    expect(fill.quote_end).toBe(new Date((open + 900) * 1000).toISOString());
    expect(fill.fx).toBe(1400); expect(fill.fee_krw).toBeCloseTo(fill.price * 1400 * .001);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM sim_fills').get().n).toBe(1);
  });
  it('필요한 봉과 환율이 없으면 체결하지 않는다', async () => {
    const order = await makeOrder();
    const data = feed(); data.rows.shift();
    expect((await settleIntradayOrders(env, [order], [previous, session], data, fetched)).waiting).toBe(1);
    env.DB.raw.exec('DELETE FROM sim_fx');
    expect((await settleIntradayOrders(env, [order], [previous, session], feed(), fetched)).waiting).toBe(1);
    expect(env.DB.raw.prepare('SELECT status FROM sim_orders').get().status).toBe('pending');
  });
  it('동시에 같은 주문을 처리해도 한 번만 원장을 변경한다', async () => {
    const order = await makeOrder();
    const before = env.DB.raw.prepare('SELECT cash FROM sim_accounts WHERE id=?').get(accountId).cash;
    await Promise.all([
      settleIntradayOrders(env, [order], [previous, session], feed(), fetched),
      settleIntradayOrders(env, [order], [previous, session], feed(), fetched),
    ]);
    const fills = env.DB.raw.prepare('SELECT cash_delta FROM sim_fills').all();
    expect(fills).toHaveLength(1);
    expect(env.DB.raw.prepare('SELECT cash FROM sim_accounts WHERE id=?').get(accountId).cash).toBeCloseTo(before + fills[0].cash_delta);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM positions').get().n).toBe(0);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM cash').get().n).toBe(0);
  });
  it('같은 시가를 두 계좌에 공유하고 각각 잔고 검사를 한다', async () => {
    const first = await makeOrder(new Date((open - 60) * 1000));
    const other = env.DB.raw.prepare('SELECT id FROM sim_accounts WHERE id<>? LIMIT 1').get(accountId).id;
    const second = await makeOrder(new Date((open - 60) * 1000), 1000000, other);
    const result = await settleIntradayOrders(env, [first, second], [previous, session], feed(), fetched);
    expect(result).toMatchObject({ filled: 1, rejected: 1 });
    expect(env.DB.raw.prepare('SELECT raw_price FROM sim_fills').get().raw_price).toBe(100);
  });
});
