import { describe, it, expect } from 'vitest';
import { makeDb } from './d1shim.js';
import { createContest, saveThesis, submitOrder } from '../src/lib/simulation.js';
import { runSimulationCron } from '../src/simulation-worker.js';

describe('별도 모의투자 Worker', () => {
  it('원장부터 시세까지 모의 테이블만 바꾸고 개인 테이블은 읽거나 쓰지 않는다', async () => {
    const env={DB:makeDb(),SIM_INTRADAY_ENABLED:'true'};
    const open=Date.parse('2026-10-27T00:00:00Z')/1000, prior={start:open-86400,end:open-86400+23400}, today={start:open,end:open+23400};
    await createContest(env,{name:'시험'},new Date((prior.start+3600)*1000));
    const aid=env.DB.raw.prepare('SELECT id FROM sim_accounts LIMIT 1').get().id;
    const sid=env.DB.raw.prepare("INSERT INTO sim_securities(name,ticker,ysym,market,currency,created_at) VALUES('시험','TEST','TEST','KR','KRW',?) RETURNING id").get(new Date(open*1000).toISOString()).id;
    const created=new Date((open+420)*1000);
    const thesis=await saveThesis(env,aid,{security_id:sid,thesis:'논리',valuation:'가치',scenarios:'시나리오',risks:'위험',invalidation:'철회',sources:'출처'},created);
    await submitOrder(env,aid,{thesis_id:thesis.id,side:'buy',qty:1,reason:'근거',client_order_id:'one'},created);
    const privateTables=env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,4)<>'sim_' AND substr(name,1,7)<>'sqlite_'").all().map(x=>x.name);
    const dump=()=>Object.fromEntries(privateTables.map(t=>[t,env.DB.raw.prepare('SELECT * FROM '+t).all()]));
    const before=dump(),queries=[];
    const original=env.DB.prepare;env.DB.prepare=sql=>{queries.push(sql);return original(sql);};
    const now=new Date((open+3600)*1000);
    const intraday=async()=>({sessions:[prior,today],marketTime:open+3600,fetchedAt:now.toISOString(),splits:[],rows:[{start:open,end:open+900,sessionStart:open,open:1000,close:1010,volume:10}]});
    const result=await runSimulationCron(env,now,{intraday});
    expect(result.errors).toEqual([]);expect(result.ran).toContain('intraday');
    expect(queries.every(q=>!privateTables.some(t=>new RegExp('\\b'+t+'\\b','i').test(q)))).toBe(true);
    expect(dump()).toEqual(before);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM sim_fills').get().n).toBe(1);
    expect(result.d1_calls).toBeLessThanOrEqual(44);
  });
});
