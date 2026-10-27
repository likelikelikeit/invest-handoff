import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from './d1shim.js';
import { createContest, saveThesis, submitOrder } from '../src/lib/simulation.js';
import { recordSimulationSplit } from '../src/lib/simulation-split.js';

let env, aid, sid;
beforeEach(async () => {
  env = { DB: makeDb() };
  await createContest(env, { name: '분할 시험', initial_cash: 100000 }, new Date('2026-10-26T00:00:00Z'));
  aid = env.DB.raw.prepare('SELECT id FROM sim_accounts LIMIT 1').get().id;
  sid = env.DB.raw.prepare("INSERT INTO sim_securities(name,ticker,ysym,market,currency,created_at) VALUES('시험','TEST','TEST','KR','KRW',?) RETURNING id").get('2026-10-26T00:00:00Z').id;
});
function apply(id, numerator, denominator, price = 1000) {
  return env.DB.raw.prepare(`INSERT INTO sim_splits(id,security_id,effective_at,market_date,numerator,denominator,cash_price,fx,fx_date,source,recorded_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,sid,'2026-10-27T00:00:00Z','2026-10-27',numerator,denominator,price,1,'2026-10-27','test','2026-10-27T01:00:00Z');
}
describe('모의투자 분할 원장', () => {
  it('10대1 분할은 수량과 원가를 조정하고 중복 적용을 막는다', () => {
    env.DB.raw.prepare('INSERT INTO sim_positions(account_id,security_id,qty,cost_krw) VALUES(?,?,?,?)').run(aid,sid,10,10000);
    apply('one',10,1);
    expect(env.DB.raw.prepare('SELECT qty,cost_krw FROM sim_positions').get()).toMatchObject({qty:100,cost_krw:10000});
    expect(() => apply('two',10,1)).toThrow();
    expect(env.DB.raw.prepare('SELECT qty FROM sim_positions').get().qty).toBe(100);
  });
  it('1대10 병합에서 소수 주식은 검증된 시가로 현금 정산하고 내역을 남긴다', () => {
    env.DB.raw.prepare('INSERT INTO sim_positions(account_id,security_id,qty,cost_krw) VALUES(?,?,?,?)').run(aid,sid,13,13000);
    apply('reverse',1,10,10000);
    const row = env.DB.raw.prepare('SELECT * FROM sim_split_adjustments').get();
    expect(row.qty_after).toBe(1); expect(row.fractional_qty).toBeCloseTo(.3);
    expect(row.cash_krw).toBeCloseTo(3000); expect(row.cost_after).toBeCloseTo(10000);
    expect(env.DB.raw.prepare('SELECT cash FROM sim_accounts WHERE id=?').get(aid).cash).toBeCloseTo(103000);
  });
  it('미체결 주문을 취소하고 이미 처리된 과거 원장은 건드리지 않는다', async () => {
    const when = new Date('2026-10-26T03:00:00Z');
    const t = await saveThesis(env,aid,{security_id:sid,thesis:'논리',valuation:'가치',scenarios:'시나리오',risks:'위험',invalidation:'철회',sources:'출처'},when);
    await submitOrder(env,aid,{thesis_id:t.id,side:'buy',qty:1,reason:'근거',client_order_id:'id'},when);
    apply('event',10,1);
    expect(env.DB.raw.prepare('SELECT status,status_reason FROM sim_orders').get()).toMatchObject({status:'cancelled',status_reason:'분할·병합으로 주문 취소'});
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM positions').get().n).toBe(0);
  });
  it('분할일 이후 체결이 이미 있다면 조정하지 않고 확인을 요구한다', async () => {
    const when = new Date('2026-10-26T03:00:00Z');
    const t = await saveThesis(env,aid,{security_id:sid,thesis:'논리',valuation:'가치',scenarios:'시나리오',risks:'위험',invalidation:'철회',sources:'출처'},when);
    const o = await submitOrder(env,aid,{thesis_id:t.id,side:'buy',qty:1,reason:'근거',client_order_id:'id'},when);
    env.DB.raw.prepare("INSERT INTO sim_fills(order_id,date,price,fx,fx_date,fee_krw,cash_delta,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(o.order.id,'2026-10-27',1000,1,'2026-10-27',0,-1000,'2026-10-27T02:00:00Z');
    expect(() => apply('late',10,1)).toThrow('확인이 필요합니다');
    expect(env.DB.raw.prepare('SELECT qty FROM sim_positions').get().qty).toBe(1);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM sim_splits').get().n).toBe(0);
  });
  it('사건 재전송은 한 번만 적용하고 다른 비율은 충돌로 처리한다', async () => {
    env.DB.raw.prepare('INSERT INTO sim_positions(account_id,security_id,qty,cost_krw) VALUES(?,?,?,?)').run(aid,sid,10,10000);
    const event={security_id:sid,effective_at:'2026-10-27T00:00:00Z',market_date:'2026-10-27',numerator:10,denominator:1,cash_price:1000,fx:1,fx_date:'2026-10-27',source:'test'};
    const now = new Date('2026-10-27T01:00:00Z');
    const [a,b] = await Promise.all([recordSimulationSplit(env,event,now),recordSimulationSplit(env,event,now)]);
    expect(a.id).toBe(b.id);
    expect(env.DB.raw.prepare('SELECT qty FROM sim_positions').get().qty).toBe(100);
    await expect(recordSimulationSplit(env,{...event,numerator:5},now)).rejects.toThrow('정보가 달라');
  });
});
