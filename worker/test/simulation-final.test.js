import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from './d1shim.js';
import { createContest, getAccount, saveThesis, submitOrder } from '../src/lib/simulation.js';
import { finishSimulationContest } from '../src/lib/simulation-final.js';

let env, cid, aid, sid;
const started = new Date('2026-10-27T00:00:00Z'), ended = new Date('2026-10-27T06:00:00Z');
beforeEach(async()=>{
  env={DB:makeDb(),SIM_INTRADAY_ENABLED:'true'};
  cid=(await createContest(env,{name:'시험',initial_cash:100000},started)).id;
  aid=env.DB.raw.prepare('SELECT id FROM sim_accounts LIMIT 1').get().id;
  sid=env.DB.raw.prepare("INSERT INTO sim_securities(name,ticker,ysym,market,currency,created_at) VALUES('시험','TEST','TEST','KR','KRW',?) RETURNING id").get(started.toISOString()).id;
  env.DB.raw.prepare('INSERT INTO sim_positions(account_id,security_id,qty,cost_krw) VALUES(?,?,?,?)').run(aid,sid,10,10000);
  env.DB.raw.prepare("INSERT INTO sim_intraday_quotes(security_id,price,price_at,fetched_at,source) VALUES(?,?,?,?,?)").run(sid,1200,'2026-10-27T05:30:00Z','2026-10-27T05:50:00Z','test');
  env.DB.raw.prepare("INSERT INTO sim_market_checks(security_id,attempted_at,verified_at,status) VALUES(?,?,?,'ok')").run(sid,'2026-10-27T05:50:00Z','2026-10-27T05:50:00Z');
});
describe('대회 종료 공통 평가 스냅샷',()=>{
  it('종료 시점에 고정하고 이후 가격이 바뀌어도 성과가 달라지지 않는다',async()=>{
    await finishSimulationContest(env,cid,ended);
    const before=await getAccount(env,aid,ended);expect(before).toMatchObject({final:true,equity:112000,complete:true,at:ended.toISOString()});
    env.DB.raw.exec('UPDATE sim_intraday_quotes SET price=3000');
    env.DB.raw.exec('UPDATE sim_accounts SET cash=500');
    const after=await getAccount(env,aid,new Date('2026-10-28T00:00:00Z'));
    expect(after).toMatchObject({equity:112000,cash:100000,at:ended.toISOString()});
    expect(after.holdings[0].price).toBe(1200);
  });
  it('시세가 누락되면 수익률을 추정하지 않고 비어 있는 상태로 고정한다',async()=>{
    env.DB.raw.exec('DELETE FROM sim_intraday_quotes');
    await finishSimulationContest(env,cid,ended);
    expect(await getAccount(env,aid,ended)).toMatchObject({final:true,equity:null,return_pct:null,complete:false});
  });
  it('미체결 주문을 최종 성과에서 제외하고 취소하며 이후 주문은 거절한다',async()=>{
    const t=await saveThesis(env,aid,{security_id:sid,thesis:'논리',valuation:'가치',scenarios:'시나리오',risks:'위험',invalidation:'철회',sources:'출처'},started);
    const body={thesis_id:t.id,side:'buy',qty:1,reason:'근거',client_order_id:'one'};
    await submitOrder(env,aid,body,started);await finishSimulationContest(env,cid,ended);
    expect(env.DB.raw.prepare('SELECT status,status_reason FROM sim_orders').get()).toMatchObject({status:'cancelled',status_reason:'대회 종료로 미체결 주문 취소'});
    await expect(submitOrder(env,aid,{...body,client_order_id:'two'},ended)).rejects.toThrow('종료된 대회');
    expect((await getAccount(env,aid,ended)).equity).toBe(112000);
  });
});
