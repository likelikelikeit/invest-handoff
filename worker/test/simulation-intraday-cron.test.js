import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from './d1shim.js';
import { createContest, saveThesis, submitOrder } from '../src/lib/simulation.js';
import { runSimulationIntraday } from '../src/cron/simulation-intraday.js';

const start = Date.parse('2026-10-27T00:00:00Z') / 1000;
const prev = { start:start-86400, end:start-86400+23400 }, today = { start,end:start+23400 };
const now = new Date((start+3600)*1000);
let env, aid, other, sid;
const values={thesis:'논리',valuation:'가치',scenarios:'시나리오',risks:'위험',invalidation:'철회',sources:'출처'};
beforeEach(async()=>{
  env={DB:makeDb(),SIM_INTRADAY_ENABLED:'true'};
  await createContest(env,{name:'대회'},new Date((prev.start+3600)*1000));
  [aid,other]=env.DB.raw.prepare('SELECT id FROM sim_accounts LIMIT 2').all().map(x=>x.id);
  sid=env.DB.raw.prepare("INSERT INTO sim_securities(name,ticker,ysym,market,currency,created_at) VALUES('시험','TEST','TEST','KR','KRW',?) RETURNING id").get(now.toISOString()).id;
  for (const a of [aid,other]) {
    const when=new Date((start+7*60)*1000);
    const t=await saveThesis(env,a,{...values,security_id:sid},when);
    await submitOrder(env,a,{thesis_id:t.id,side:'buy',qty:1,reason:'근거',client_order_id:'one'},when);
  }
});
describe('모의 시세 수집 예산·공유',()=>{
  it('같은 종목의 두 계좌 주문에 시세를 한 번만 조회해 사용한다',async()=>{
    const calls=[];
    const fake=async symbol=>{calls.push(symbol);return {sessions:[prev,today],marketTime:start+3600,fetchedAt:now.toISOString(),splits:[],rows:[{start,end:start+900,sessionStart:start,open:1000,close:1010,volume:5}]};};
    expect(await runSimulationIntraday(env,now,null,fake)).toMatchObject({security_id:sid,filled:2});
    expect(calls).toEqual(['^KS11','TEST']);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM sim_fills').get().n).toBe(2);
    expect(await runSimulationIntraday(env,now,null,fake)).toMatchObject({deferred:'갱신 대상 없음'});
    expect(calls).toHaveLength(2);
  });
  it('남은 예산이 부족하면 개인 작업 뒤 추가 수집을 하지 않는다',async()=>{
    let called=false;
    const result=await runSimulationIntraday(env,now,{d1Left:()=>20,fetchLeft:()=>20},async()=>{called=true;});
    expect(result.deferred).toBe('실행 예산 부족');expect(called).toBe(false);
  });
  it('외부 조회 실패 시 보류 상태를 남기고 주문은 미체결로 둔다',async()=>{
    const result=await runSimulationIntraday(env,now,null,async()=>{throw new Error('시세 없음');});
    expect(result.error).toBe('시세 없음');
    expect(env.DB.raw.prepare('SELECT status FROM sim_market_checks').get().status).toBe('hold');
    expect(env.DB.raw.prepare("SELECT COUNT(*) n FROM sim_orders WHERE status='pending'").get().n).toBe(2);
  });
  it('운영에서는 분리된 시세 Worker에서 종목과 시장 시세를 함께 받는다',async()=>{
    let request;
    env.SIM_FEED={fetch:async(url,options)=>{request={url,body:JSON.parse(options.body)};return Response.json({reference:{sessions:[prev,today]},data:{sessions:[prev,today],marketTime:start+3600,fetchedAt:now.toISOString(),splits:[],rows:[{start,end:start+900,sessionStart:start,open:1000,close:1010,volume:5}]}});}};
    expect(await runSimulationIntraday(env,now)).toMatchObject({filled:2});
    expect(request.body).toMatchObject({symbol:'TEST',market:'KR',at:now.toISOString()});
  });
  it('운영 시세 Worker 연결이 없으면 주문을 체결하지 않는다',async()=>{
    expect(await runSimulationIntraday(env,now)).toMatchObject({error:'모의 시세 Worker 연결이 없습니다'});
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM sim_fills').get().n).toBe(0);
  });
});
