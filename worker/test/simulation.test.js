import {describe,it,expect,beforeEach} from 'vitest';
import {makeDb} from './d1shim.js';
import {createContest,saveThesis,submitOrder,cancelOrder,settleSimulation,getAccount,getPerformance,rotateToken,authenticateSim,marketDate,completedDate,snapshotSimulation,registerSecurity,refreshSimulationPrices} from '../src/lib/simulation.js';
import api from '../src/index.js';
import mcp from '../../mcp/src/index.js';
import {trackedSecurities} from '../src/lib/prices.js';
const at=s=>new Date(s),mon=at('2026-10-26T02:00:00Z'),tue=at('2026-10-27T22:10:00Z');
let env,aid,bid,sid,us;
const b={thesis:'사업 성장',valuation:'성장 기간과 마진을 반영',scenarios:'경쟁·수요 3개 시나리오',risks:'점유율 하락',invalidation:'고객 이탈',sources:'https://example.com/ir'};
const thesis=async(account=aid,security=sid)=>saveThesis(env,account,{...b,security_id:security},mon);
const order=async(t,extra={})=>submitOrder(env,aid,{thesis_id:t.id,side:'buy',qty:10,reason:'기대수익과 비중 근거',client_order_id:crypto.randomUUID(),...extra},mon);
const bar=(security,date,open,close=open)=>env.DB.raw.prepare('INSERT INTO sim_prices(security_id,date,open,close) VALUES(?,?,?,?)').run(security,date,open,close);
beforeEach(async()=>{
  env={DB:makeDb(),APP_TOKEN:'owner'};
  await createContest(env,{name:'시즌',initial_cash:100000,fee_bps:10,slippage_bps:5},mon);
  [aid,bid]=env.DB.raw.prepare('SELECT id FROM sim_accounts ORDER BY agent_id').all().map(a=>a.id);
  const s=(ticker,market,currency)=>env.DB.raw.prepare('INSERT INTO sim_securities(name,ticker,ysym,market,currency,created_at,checked_at) VALUES(?,?,?,?,?,?,?) RETURNING id').get(ticker,ticker,ticker,market,currency,mon.toISOString(),mon.toISOString()).id;
  sid=s('KRSTOCK','KR','KRW');us=s('USSTOCK','US','USD');
  bar(sid,'2026-10-26',1000);bar(sid,'2026-10-27',1100,1200);bar(us,'2026-10-27',100,105);
  env.DB.raw.exec("INSERT INTO sim_fx(date,close) VALUES('2026-10-26',1400),('2026-10-27',1500)");
});
describe('모의투자 회계·권한',()=>{
  it('네 계좌만 만들고 실제 보유와 현금은 바꾸지 않는다',()=>{
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sim_accounts').get().n).toBe(4);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM positions').get().n).toBe(0);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM cash').get().n).toBe(0);
  });
  it('진행 대회를 중복 개설하지 않는다',async()=>{await expect(createContest(env,{name:'중복'},mon)).rejects.toThrow();});
  it('접수일에는 체결하지 않고 다음 거래일 시가·비용으로 한 번만 체결한다',async()=>{
    const t=await thesis();await order(t);
    await settleSimulation(env,mon);expect((await getAccount(env,aid,mon)).cash).toBe(100000);
    await settleSimulation(env,tue);await settleSimulation(env,tue);
    const a=await getAccount(env,aid,tue),gross=10*1100*1.0005;
    expect(a.cash).toBeCloseTo(100000-gross*1.001,7);expect(a.holdings[0].qty).toBe(10);
    expect(a.equity).toBeCloseTo(a.cash+12000,7);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sim_fills').get().n).toBe(1);
  });
  it('소수·음수 수량과 타 계좌 분석을 거절한다',async()=>{
    const t=await thesis();for(const qty of [-1,0,0.5,'10'])await expect(order(t,{qty})).rejects.toMatchObject({status:400});
    const other=await thesis(bid);await expect(order(other)).rejects.toMatchObject({status:400});
  });
  it('중복 주문 번호를 재사용하고 내용이 달라지면 충돌을 반환한다',async()=>{
    const t=await thesis(),key='same';const a=await order(t,{client_order_id:key});
    expect((await order(t,{client_order_id:key})).order.id).toBe(a.order.id);
    await expect(order(t,{client_order_id:key,qty:11})).rejects.toMatchObject({status:409});
  });
  it('동시에 재전송한 주문도 한 건으로 접수한다',async()=>{
    const t=await thesis();const [a,b]=await Promise.all([order(t,{client_order_id:'race'}),order(t,{client_order_id:'race'})]);
    expect(a.order.id).toBe(b.order.id);
  });
  it('동시 체결에서도 중복 차감이 없다',async()=>{
    await order(await thesis());await Promise.all([settleSimulation(env,tue),settleSimulation(env,tue)]);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sim_fills').get().n).toBe(1);
  });
  it('잔고보다 많은 주문은 거절하고 다음 주문은 계속 처리한다',async()=>{
    const t=await thesis();await order(t,{qty:1000});await order(t,{qty:1});await settleSimulation(env,tue);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sim_orders WHERE status='rejected'").get().n).toBe(1);
    expect((await getAccount(env,aid,tue)).holdings[0].qty).toBe(1);
  });
  it('보유하지 않은 매도를 거절한다',async()=>{
    await order(await thesis(),{side:'sell'});await settleSimulation(env,tue);
    expect((await getAccount(env,aid,tue)).cash).toBe(100000);
    expect(env.DB.raw.prepare('SELECT status FROM sim_orders').get().status).toBe('rejected');
  });
  it('매도 시 잔여 취득원가와 현금을 함께 갱신한다',async()=>{
    const t=await thesis();await order(t);await settleSimulation(env,tue);
    const original=(await getAccount(env,aid,tue)).holdings[0].cost_krw;
    await submitOrder(env,aid,{thesis_id:t.id,side:'sell',qty:4,reason:'비중 조정',client_order_id:'sale'},tue);
    bar(sid,'2026-10-29',1300);await settleSimulation(env,at('2026-10-29T22:10:00Z'));
    const a=await getAccount(env,aid,at('2026-10-29T22:10:00Z'));
    expect(a.holdings[0].qty).toBe(6);expect(a.holdings[0].cost_krw).toBeCloseTo(original*0.6,7);
  });
  it('환율은 체결일 이전 값을 쓰고 미래 환율을 사용하지 않는다',async()=>{
    await order(await thesis(aid,us),{qty:1});env.DB.raw.prepare('UPDATE sim_accounts SET cash=200000 WHERE id=?').run(aid);
    await settleSimulation(env,tue);
    const f=env.DB.raw.prepare('SELECT * FROM sim_fills').get();expect(f.fx).toBe(1400);expect(f.fx_date).toBe('2026-10-26');
  });
  it('환율이 없으면 0원으로 체결하지 않고 대기한다',async()=>{
    env.DB.raw.exec('DELETE FROM sim_fx');
    await order(await thesis(aid,us),{qty:1});await settleSimulation(env,tue);
    expect(env.DB.raw.prepare('SELECT status FROM sim_orders').get().status).toBe('pending');
  });
  it('접수일에만 취소하고 다른 계좌 주문은 취소하지 못한다',async()=>{
    const o=await order(await thesis());await expect(cancelOrder(env,bid,{order_id:o.order.id},mon)).rejects.toMatchObject({status:404});
    await expect(cancelOrder(env,aid,{order_id:o.order.id},tue)).rejects.toMatchObject({status:409});
    await cancelOrder(env,aid,{order_id:o.order.id},mon);await settleSimulation(env,tue);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sim_fills').get().n).toBe(0);
  });
  it('계좌 키를 회전하고 앱 소유자 API에 사용할 수 없다',async()=>{
    const old=await rotateToken(env,aid),request=key=>new Request('https://x/sim/contests',{headers:{Authorization:'Bearer '+key}});
    expect(await authenticateSim(request(old.token),env)).toBe(aid);
    expect((await api.fetch(request(old.token),env)).status).toBe(401);
    await rotateToken(env,aid);await expect(authenticateSim(request(old.token),env)).rejects.toMatchObject({status:401});
  });
  it('전용 MCP는 자기 계좌만 노출하고 account_id 위조 인자를 거절한다',async()=>{
    const {token}=await rotateToken(env,aid);
    const call=body=>mcp.fetch(new Request('https://x/sim/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    const r=await(await call({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'sim_get_account',arguments:{}}})).json();
    expect(r.result.structuredContent.id).toBe(aid);
    const bad=await(await call({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'sim_get_account',arguments:{account_id:bid}}})).json();expect(bad.result.isError).toBe(true);
    expect((await call({id:3,method:'tools/call',params:{name:'get_portfolio'}})).status).toBe(200);
  });
  it('모의 종목이 개인 영역의 시세 수집 대상에 들어가지 않는다',async()=>{
    await thesis();expect((await trackedSecurities(env)).some(s=>s.ysym==='KRSTOCK')).toBe(false);
  });
  it('체결 대기분을 처리한 뒤 일별 평가를 저장한다',async()=>{
    await order(await thesis());await snapshotSimulation(env,tue);expect((await getPerformance(env,aid,tue)).snapshots).toHaveLength(0);
    await settleSimulation(env,tue);await snapshotSimulation(env,tue);expect((await getPerformance(env,aid,tue)).snapshots).toHaveLength(1);
  });
  it('미국 자정 UTC 이후에도 직전 마감일을 유지한다',()=>{
    expect(marketDate(at('2026-10-28T01:00:00Z'),'US')).toBe('2026-10-27');
    expect(completedDate(at('2026-10-28T01:00:00Z'),'US')).toBe('2026-10-27');
    expect(completedDate(mon,'KR')).toBe('2026-10-25');
  });
  it('전용 MCP의 잘못된 접속키는 401이다',async()=>{
    const r=await mcp.fetch(new Request('https://x/sim/mcp',{method:'POST',body:'{}'}),env);expect(r.status).toBe(401);
  });
  it('종목 등록·분석·시세 갱신·체결이 개인 영역의 어떤 테이블도 바꾸지 않는다',async()=>{
    const privateTables=env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,4)<>'sim_' AND substr(name,1,7)<>'sqlite_'").all().map(t=>t.name);
    const dump=()=>Object.fromEntries(privateTables.map(t=>[t,env.DB.raw.prepare('SELECT * FROM '+t).all()]));
    const before=dump();
    const sources={quote:async()=>({currency:'USD',exchange:'NasdaqGS'}),history:async()=>[{date:'2026-10-27',open:100,close:105}]};
    const s=await registerSecurity(env,{symbol:'ONLYSIM',name:'모의 전용'},mon,sources);
    await order(await thesis(aid,s.security.id),{qty:1});
    await refreshSimulationPrices(env,tue,sources);await settleSimulation(env,tue);
    expect(dump()).toEqual(before);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sim_securities WHERE ysym='ONLYSIM'").get().n).toBe(1);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sim_theses').get().n).toBe(1);
  });
});
