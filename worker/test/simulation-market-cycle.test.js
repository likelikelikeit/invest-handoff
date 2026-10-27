import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from './d1shim.js';
import { createContest, saveThesis, submitOrder, getAccount } from '../src/lib/simulation.js';
import { processSimulationSymbol } from '../src/lib/simulation-market-cycle.js';

const open = Date.parse('2026-10-27T00:00:00Z') / 1000;
const prior = { start: open - 86400, end: open - 86400 + 23400 };
const today = { start: open, end: open + 23400 };
const now = new Date((open + 3600) * 1000);
let env, aid, sid, contest, security;
const reference = () => ({ sessions: [prior, today] });
const feed = () => ({ sessions: [prior, today], marketTime: open + 3600, fetchedAt: now.toISOString(), splits: [], rows: [
  {start:open,end:open+900,sessionStart:open,open:1000,close:1010,volume:5},
] });
async function order(when = new Date((open + 7 * 60) * 1000)) {
  const t = await saveThesis(env,aid,{security_id:sid,thesis:'논리',valuation:'가치',scenarios:'시나리오',risks:'위험',invalidation:'철회',sources:'출처'},when);
  return submitOrder(env,aid,{thesis_id:t.id,side:'buy',qty:1,reason:'근거',client_order_id:'order'},when);
}
beforeEach(async () => {
  env = { DB: makeDb(), SIM_INTRADAY_ENABLED: 'true' };
  const result = await createContest(env,{name:'시험',initial_cash:100000},new Date((prior.start + 3600) * 1000));
  contest = env.DB.raw.prepare('SELECT id,created_at FROM sim_contests WHERE id=?').get(result.id);
  aid = env.DB.raw.prepare('SELECT id FROM sim_accounts LIMIT 1').get().id;
  sid = env.DB.raw.prepare("INSERT INTO sim_securities(name,ticker,ysym,market,currency,created_at) VALUES('시험','TEST','TEST','KR','KRW',?) RETURNING id").get(contest.created_at).id;
  security = {id:sid,market:'KR',currency:'KRW'};
});
describe('모의 시세 확인 순서', () => {
  it('정규장과 기업행동을 확인한 뒤 평가용 시세와 체결을 따로 저장한다', async () => {
    await order();
    expect(await processSimulationSymbol(env,security,contest,reference(),feed(),now)).toMatchObject({filled:1});
    expect(env.DB.raw.prepare('SELECT price FROM sim_intraday_quotes').get().price).toBe(1010);
    expect(env.DB.raw.prepare('SELECT raw_price FROM sim_fills').get().raw_price).toBe(1010);
    expect(env.DB.raw.prepare('SELECT status FROM sim_market_checks').get().status).toBe('ok');
    const account=await getAccount(env,aid,now);
    expect(account.holdings[0]).toMatchObject({price:1010,price_at:new Date((open+900)*1000).toISOString(),stale:false});
  });
  it('시장과 종목의 정규장이 불일치하면 체결과 평가 시세 저장을 보류한다', async () => {
    await order(); const data = feed(); data.sessions = [today];
    expect(await processSimulationSymbol(env,security,contest,reference(),data,now)).toMatchObject({filled:null,waiting:true});
    expect(env.DB.raw.prepare('SELECT status FROM sim_market_checks').get().status).toBe('hold');
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM sim_fills').get().n).toBe(0);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM sim_intraday_quotes').get().n).toBe(0);
  });
  it('분할을 먼저 처리하고 기존 미체결 주문을 취소한다', async () => {
    await order(new Date((open-60)*1000)); env.DB.raw.prepare('INSERT INTO sim_positions(account_id,security_id,qty,cost_krw) VALUES(?,?,?,?)').run(aid,sid,10,10000);
    const data = feed(); data.splits = [{at:open,numerator:10,denominator:1}];
    expect(await processSimulationSymbol(env,security,contest,reference(),data,now)).toMatchObject({filled:0});
    expect(env.DB.raw.prepare('SELECT qty FROM sim_positions').get().qty).toBe(100);
    expect(env.DB.raw.prepare('SELECT status FROM sim_orders').get().status).toBe('cancelled');
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM sim_splits').get().n).toBe(1);
  });
  it('분할 이후에 접수한 새 주문은 조정 후 현재 가격으로 처리한다', async () => {
    await order();
    const data=feed(); data.splits=[{at:open,numerator:10,denominator:1}];
    expect(await processSimulationSymbol(env,security,contest,reference(),data,now)).toMatchObject({filled:1});
    expect(env.DB.raw.prepare('SELECT status FROM sim_orders').get().status).toBe('filled');
  });
  it('시세 검증이 실패하면 이전 가격으로 계좌 평가액을 표시하지 않는다', async () => {
    await order(); await processSimulationSymbol(env,security,contest,reference(),feed(),now);
    const data=feed(); data.sessions=[];
    await processSimulationSymbol(env,security,contest,reference(),data,now);
    const account=await getAccount(env,aid,now);
    expect(account.complete).toBe(false); expect(account.equity).toBeNull();
  });
});
