import { HttpError } from './http.js';
import { quote,history,search } from '../sources/yahoo.js';

export const SIM_RULES = {
  version: '1', currency: 'KRW', markets: ['KR','US'],
  execution: '주문한 거래소 현지 날짜 이후 첫 거래일 시가. 마감 시세 수집 뒤 체결 기록을 확정합니다.',
  cancellation: '체결 또는 거절되기 전의 주문은 취소할 수 있습니다.',
  fx: '미국 주식은 체결일 전 마지막 저장 환율로 자동 환전합니다. 7일보다 오래된 환율이면 체결을 보류합니다.',
  sizing: '정수 수량, 공매도·차입 없음. 미체결 매수는 현금을 예약하지 않으며 접수 순서대로 체결 시 잔액을 확인합니다.',
  performance: '가격·환율 기준 잠정 성과. 본 모의투자 대회에서는 현금배당 및 ETF 분배금을 수익에 반영하지 않습니다. 투자 성과는 주가 변동과 환율 변동을 기준으로 산정하며, 배당락에 따른 가격 변동은 별도로 보정하지 않습니다. 분할·병합은 자동 반영되지 않아 최종 평가에 사용하기 전 확인이 필요합니다.',
  isolation: '종목·시세·환율·계좌·분석·주문은 모의투자 전용입니다. 개인 투자의견·메모·보유·관심종목에는 기록하지 않습니다.',
};
export const SIM_INTRADAY_RULES = { ...SIM_RULES, version: '2',
  execution: '거래일 개장 전 주문은 당일 시가, 마감 후·휴장일 주문은 다음 거래일 시가를 적용합니다. 장중 주문은 주문 시각이 속한 15분봉이 확정되고 조회된 뒤 그 봉의 종가를 적용합니다(예: 미국 23:07 주문 → 23:00~23:15 봉 종가). 한국 15:00~15:30 동시호가처럼 그 봉이 끝내 제공되지 않으면 다음 거래일 시가를 적용합니다. 시세가 지연되거나 없으면 체결하지 않고 대기합니다.',
  sizing: '정수 수량, 공매도·차입 없음. 미체결 매수는 현금을 예약하지 않으며 체결 가능한 주문부터 처리할 때 잔액과 수량을 확인합니다.',
  performance: '본 모의투자 대회에서는 현금배당 및 ETF 분배금을 수익에 반영하지 않습니다. 투자 성과는 주가 변동과 환율 변동을 기준으로 산정하며, 배당락에 따른 가격 변동은 별도로 보정하지 않습니다. 분할·병합을 확인할 수 없으면 해당 종목의 체결과 평가를 보류합니다.',
};
export const SIM_OPEN_RULES = { ...SIM_INTRADAY_RULES, version: '3',
  execution: '거래일 개장 전 주문은 당일 시가, 개장 이후·휴장일 주문은 다음 거래일 시가를 적용합니다. 시세가 지연되거나 없으면 대기합니다.',
};
const fail = (message, status=400) => { throw new HttpError(status,message); };
const text = (v,label,max=20000) => { if(typeof v !== 'string' || !v.trim() || v.length>max) fail(label+'을 확인하세요'); return v.trim(); };
const uid = () => crypto.randomUUID();
const iso = now => now.toISOString();
const rows = async (env,sql,...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
const zone = market => market==='KR'?'Asia/Seoul':'America/New_York';
const formatters = new Map();
function formatter(market,kind) {
  const key=market+':'+kind;
  if(!formatters.has(key)) {
    const fields=kind==='date'?{year:'numeric',month:'2-digit',day:'2-digit'}:kind==='hour'?{hour:'2-digit',hourCycle:'h23'}:{weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'};
    formatters.set(key,new Intl.DateTimeFormat('en-US',{timeZone:zone(market),...fields}));
  }
  return formatters.get(key);
}
export function marketDate(now,market) {
  const p = formatter(market,'date').formatToParts(now);
  const g=t=>p.find(x=>x.type===t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function completedDate(now,market) {
  const date=marketDate(now,market);
  // 조회에서는 현지 날짜·시각으로 판단한다. 크론 스케줄은 기존 UTC 고정을 유지한다.
  const hour=Number(formatter(market,'hour').format(now));
  const closed=hour >= (market==='KR'?16:17);
  return closed ? date : new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
}
export function withinUsualSession(now,market) {
  const parts=formatter(market,'session').formatToParts(now);
  const get=t=>parts.find(p=>p.type===t)?.value;
  const weekday=!['Sat','Sun'].includes(get('weekday'));
  const minutes=Number(get('hour'))*60+Number(get('minute'));
  return weekday && (market==='KR'?minutes>=540&&minutes<930:minutes>=570&&minutes<960);
}
export async function account(env,id) {
  const a=await env.DB.prepare('SELECT a.id,a.contest_id,a.agent_id,a.name,a.cash,c.initial_cash,c.fee_bps,c.slippage_bps,c.status,c.created_at,c.ended_at,c.rules_version FROM sim_accounts a JOIN sim_contests c ON c.id=a.contest_id WHERE a.id=?').bind(id).first();
  if(!a) fail('계좌가 없습니다',404); return a;
}
const active=a=>{if(a.status!=='active')fail('종료된 대회입니다',409);};
export async function createContest(env,b,now=new Date()) {
  const name=text(b.name,'대회 이름',100);
  if(b.execution_mode!==undefined && !['intraday','open'].includes(b.execution_mode))fail('체결 방식을 확인하세요');
  if(b.execution_mode!==undefined && env.SIM_INTRADAY_ENABLED!=='true')fail('선택한 체결 방식을 현재 사용할 수 없습니다',409);
  const rules=env.SIM_INTRADAY_ENABLED==='true'?(b.execution_mode==='open'?SIM_OPEN_RULES:SIM_INTRADAY_RULES):SIM_RULES;
  const initial=Number(b.initial_cash ?? 100000000), fee=Number(b.fee_bps ?? 10), slip=Number(b.slippage_bps ?? 5);
  if(!Number.isFinite(initial)||initial<10000||initial>1e12)fail('초기 자금은 10,000~1,000,000,000,000원입니다');
  if(!Number.isFinite(fee)||!Number.isFinite(slip)||fee<0||fee>100||slip<0||slip>100)fail('비용은 각각 0~100bp입니다');
  const id=uid();
  const agents=[['codex','한유민'],['claude','김유안'],['agy-1','박아연'],['agy-2','이정안']];
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sim_contests(id,name,initial_cash,fee_bps,slippage_bps,created_at,rules_version,accounting_note) VALUES(?,?,?,?,?,?,?,?)').bind(id,name,initial,fee,slip,iso(now),rules.version,rules.performance),
    ...agents.map(([agent,name])=>env.DB.prepare('INSERT INTO sim_accounts(id,contest_id,agent_id,name,cash) VALUES(?,?,?,?,?)').bind(uid(),id,agent,name,initial)),
  ]);
  return {id};
}
export async function hashToken(token) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function rotateToken(env,id,revoke=false) {
  const a=await account(env,id); active(a);
  const token=revoke?null:('sim_'+uid().replaceAll('-','')+uid().replaceAll('-',''));
  await env.DB.prepare('UPDATE sim_accounts SET token_hash=? WHERE id=?').bind(token?await hashToken(token):null,id).run();
  return {account_id:id,token};
}
export async function authenticateSim(request,env) {
  const token=/^Bearer\s+(sim_[a-f0-9]{64})$/i.exec(request.headers.get('Authorization')||'')?.[1];
  if(!token)fail('모의투자 전용 계좌 키가 필요합니다',401);
  const a=await env.DB.prepare('SELECT id FROM sim_accounts WHERE token_hash=?').bind(await hashToken(token)).first();
  if(!a)fail('폐기되었거나 올바르지 않은 계좌 키입니다',401);
  return a.id;
}
export async function marketData(env,b,now=new Date()) {
  const q=String(b.query||'').trim().slice(0,80);
  const list=await rows(env,"SELECT id,name,ticker,ysym,market,currency FROM sim_securities WHERE name LIKE ? OR ticker LIKE ? OR ysym LIKE ? ORDER BY name LIMIT 50",'%'+q+'%','%'+q+'%','%'+q+'%');
  const {results:prices}=await env.DB.prepare('SELECT p.* FROM sim_prices p WHERE p.security_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND p.date=(SELECT MAX(date) FROM sim_prices WHERE security_id=p.security_id AND date<=?)').bind(JSON.stringify(list.map(s=>s.id)),iso(now).slice(0,10)).all();
  const quotes=await rows(env,'SELECT q.security_id,q.price,q.price_at,q.fetched_at,q.source,c.status,c.detail FROM sim_intraday_quotes q LEFT JOIN sim_market_checks c ON c.security_id=q.security_id WHERE q.security_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))',JSON.stringify(list.map(s=>s.id)));
  let candidates=[],search_error=null;
  if(q){try{candidates=await search(q);}catch(e){search_error=String(e.message);}}
  return {at:iso(now),delayed:true,securities:list.map(s=>({...s,price:prices.find(p=>p.security_id===s.id)||null,intraday:quotes.find(q=>q.security_id===s.id)||null})),candidates,search_error,truncated:list.length===50,note:'모의투자 전용 지연 시세입니다. 장중 시세와 일봉의 기준 시각 및 확인 상태를 살펴보세요. 검색 후보는 sim_register_security로 전용 목록에 등록할 수 있습니다. 개인 종목 목록과 분리됩니다.'};
}
export function simPriceStmt(env,id,bars) {
  return env.DB.prepare("INSERT INTO sim_prices(security_id,date,open,close) SELECT ?,json_extract(value,'$.date'),json_extract(value,'$.open'),json_extract(value,'$.close') FROM json_each(?) WHERE true ON CONFLICT(security_id,date) DO UPDATE SET open=excluded.open,close=excluded.close WHERE sim_prices.open IS NOT excluded.open OR sim_prices.close IS NOT excluded.close").bind(id,JSON.stringify(bars));
}
export async function registerSecurity(env,b,now=new Date(),sources={quote,history}) {
  const symbol=text(b.symbol,'심볼',24).toUpperCase();
  if(!/^(?:\d{6}\.(?:KS|KQ)|[A-Z][A-Z0-9.-]{0,14})$/.test(symbol))fail('한국·미국 주식 또는 ETF 심볼을 입력하세요');
  const old=await env.DB.prepare('SELECT * FROM sim_securities WHERE ysym=?').bind(symbol).first();if(old)return {security:old};
  const q=await sources.quote(symbol);
  const market=/\.(KS|KQ)$/.test(symbol)?'KR':'US';
  if(!['EQUITY','ETF'].includes(q.instrumentType)||q.currency!==(market==='KR'?'KRW':'USD')||(market==='US'&&!/nasdaq|nyse|amex|arca|bats|cboe|new york/i.test(q.exchange||'')))fail('지원하는 한국·미국 상장 주식 또는 ETF가 아닙니다');
  const bars=await sources.history(symbol,'1mo');
  const name=b.name?text(b.name,'종목명',100):symbol;
  const r=await env.DB.prepare('INSERT INTO sim_securities(name,ticker,ysym,market,currency,created_at,checked_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(ysym) DO NOTHING RETURNING *').bind(name,symbol.replace(/\.(KS|KQ)$/,''),symbol,market,q.currency,iso(now),iso(now)).first();
  const security=r||await env.DB.prepare('SELECT * FROM sim_securities WHERE ysym=?').bind(symbol).first();
  await simPriceStmt(env,security.id,bars).run();
  return {security,note:'모의투자 전용 종목에 등록했습니다. 개인 종목·관심 목록은 바꾸지 않습니다.'};
}
export async function refreshSimulationPrices(env,now=new Date(),sources={history}) {
  const a=await env.DB.prepare("SELECT id FROM sim_contests WHERE status='active'").first();if(!a)return;
  const stale=new Date(now.getTime()-60*60000).toISOString();
  const secs=await rows(env,"SELECT s.id,s.ysym FROM sim_securities s WHERE s.id IN (SELECT t.security_id FROM sim_theses t JOIN sim_accounts a ON a.id=t.account_id WHERE a.contest_id=?) AND (s.checked_at IS NULL OR s.checked_at<?) ORDER BY s.checked_at,s.id LIMIT 2",a.id,stale);
  const errors=[];
  for(const s of secs){
    try{const bars=await sources.history(s.ysym,'1mo');await simPriceStmt(env,s.id,bars).run();}
    catch(e){errors.push(s.ysym+': '+e.message);}
    await env.DB.prepare('UPDATE sim_securities SET checked_at=? WHERE id=?').bind(iso(now),s.id).run();
  }
  const fx=await env.DB.prepare("SELECT updated_at FROM sim_state WHERE key='fx'").first();
  if(!fx||fx.updated_at<stale){
    try{
      const bars=await sources.history('KRW=X','1mo');
      await env.DB.prepare("INSERT INTO sim_fx(date,close) SELECT json_extract(value,'$.date'),json_extract(value,'$.close') FROM json_each(?) WHERE true ON CONFLICT(date) DO UPDATE SET close=excluded.close WHERE sim_fx.close IS NOT excluded.close").bind(JSON.stringify(bars)).run();
      await env.DB.prepare("INSERT INTO sim_state(key,value,updated_at) VALUES('fx','ok',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(iso(now)).run();
    }catch(e){errors.push('환율: '+e.message);}
  }
  await env.DB.prepare("INSERT INTO sim_state(key,value,updated_at) VALUES('prices',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify({symbols:secs.length,errors}),iso(now)).run();
}
export async function saveThesis(env,aid,b,now=new Date()) {
  const a=await account(env,aid);active(a);
  const s=await env.DB.prepare('SELECT id FROM sim_securities WHERE id=?').bind(Number(b.security_id)).first();
  if(!s)fail('투자 가능한 등록 종목을 선택하세요');
  const id=uid();
  const fields=['thesis','valuation','scenarios','risks','invalidation','sources'].map(k=>text(b[k],({thesis:'투자 논리',valuation:'가치평가',scenarios:'시나리오',risks:'위험',invalidation:'철회 조건',sources:'출처'})[k]));
  await env.DB.prepare('INSERT INTO sim_theses(id,account_id,security_id,created_at,thesis,valuation,scenarios,risks,invalidation,sources,model,effort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,aid,s.id,iso(now),...fields,String(b.model||'').slice(0,100),String(b.effort||'').slice(0,50)).run();
  return {id,created_at:iso(now),note:'새 분석 버전으로 저장했습니다. 기존 기록은 수정하지 않습니다.'};
}
export async function submitOrder(env,aid,b,now=new Date()) {
  const a=await account(env,aid);active(a);
  const client=text(b.client_order_id,'중복 방지 주문 번호',100);
  const existing=await env.DB.prepare('SELECT * FROM sim_orders WHERE account_id=? AND client_order_id=?').bind(aid,client).first();
  if(existing){
    if(existing.thesis_id!==b.thesis_id||existing.side!==b.side||existing.qty!==b.qty||existing.reason!==b.reason?.trim())fail('같은 주문 번호에 다른 내용을 보낼 수 없습니다',409);
    return {order:existing,replayed:true};
  }
  if(!['buy','sell'].includes(b.side)||!Number.isSafeInteger(b.qty)||b.qty<=0||b.qty>1e9)fail('매수·매도와 양의 정수 수량을 입력하세요');
  const t=await env.DB.prepare('SELECT t.*,s.market FROM sim_theses t JOIN sim_securities s ON s.id=t.security_id WHERE t.id=? AND t.account_id=?').bind(b.thesis_id,aid).first();
  if(!t)fail('자기 계좌의 유효한 분석 버전이 필요합니다');
  const reason=text(b.reason,'주문 이유',5000),id=uid();
  try{
    await env.DB.prepare('INSERT INTO sim_orders(id,account_id,security_id,thesis_id,side,qty,reason,created_at,market_date,client_order_id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,aid,t.security_id,t.id,b.side,b.qty,reason,iso(now),marketDate(now,t.market),client).run();
  }catch(e){
    if(!/UNIQUE/.test(String(e.message)))throw e;
    const saved=await env.DB.prepare('SELECT * FROM sim_orders WHERE account_id=? AND client_order_id=?').bind(aid,client).first();
    if(!saved||saved.thesis_id!==b.thesis_id||saved.side!==b.side||saved.qty!==b.qty||saved.reason!==reason)fail('같은 주문 번호에 다른 내용을 보낼 수 없습니다',409);
    return {order:saved,replayed:true};
  }
  return {order:await env.DB.prepare('SELECT * FROM sim_orders WHERE id=?').bind(id).first(),note:'주문을 접수했습니다. 체결 시 잔액·보유 수량을 확인합니다.'};
}
export async function cancelOrder(env,aid,b,now=new Date()) {
  const a=await account(env,aid);active(a);
  const o=await env.DB.prepare('SELECT o.*,s.market FROM sim_orders o JOIN sim_securities s ON s.id=o.security_id WHERE o.id=? AND o.account_id=?').bind(b.order_id,aid).first();
  if(!o)fail('주문이 없습니다',404);
  if(o.status!=='pending')fail('이미 처리된 주문입니다',409);
  const r=await env.DB.prepare("UPDATE sim_orders SET status='cancelled',status_reason='사용자 취소',resolved_at=? WHERE id=? AND status='pending'").bind(iso(now),o.id).run();
  if(!r.meta.changes)fail('이미 처리된 주문입니다',409);
  return {cancelled:true};
}
export async function getOrders(env,aid,b={}) {
  const limit=Math.min(100,Math.max(1,Number(b.limit)||50)),offset=Math.max(0,Math.floor(Number(b.offset)||0));
  const orders=await rows(env,'SELECT o.*,s.name,s.ticker,s.currency,f.date AS fill_date,f.price AS fill_price,f.fx,f.fx_date,f.fee_krw,f.cash_delta,f.created_at AS fill_at,f.raw_price AS fill_raw_price,f.quote_start,f.quote_end,f.quote_fetched_at,f.price_source,f.slippage_bps,mc.status AS market_status,mc.detail AS market_detail,mc.attempted_at AS market_attempted_at FROM sim_orders o JOIN sim_securities s ON s.id=o.security_id LEFT JOIN sim_fills f ON f.order_id=o.id LEFT JOIN sim_market_checks mc ON mc.security_id=o.security_id WHERE o.account_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?',aid,limit,offset);
  const n=await env.DB.prepare('SELECT COUNT(*) AS total FROM sim_orders WHERE account_id=?').bind(aid).first();
  return {orders:orders.map(o=>({...o,display_status:o.status==='pending'?(o.market_attempted_at&&o.market_attempted_at>o.created_at?'waiting':'accepted'):o.status})),...n,offset,limit};
}
export async function getAccount(env,aid,now=new Date()) {
  const a=await account(env,aid);
  if(a.status==='ended') {
    const final=await env.DB.prepare('SELECT * FROM sim_final_accounts WHERE account_id=?').bind(aid).first();
    if(final) {
      const saved=await rows(env,'SELECT * FROM sim_final_holdings WHERE account_id=? ORDER BY name',aid);
      const holdings=saved.map(p=>{
        const ok=p.price>0&&p.fx>0;
        const priceDate=p.price_at?(a.rules_version!=='1'?marketDate(new Date(p.price_at),p.market):p.price_at):null;
        return {...p,price_date:priceDate,price_at:a.rules_version!=='1'?p.price_at:null,stale:!ok,
          value_krw:ok?p.qty*p.price*p.fx:null,pnl_krw:ok?p.qty*p.price*p.fx-p.cost_krw:null};
      });
      return {...a,cash:final.cash,holdings,equity:final.equity,return_pct:final.return_pct,
        complete:!!final.complete,at:final.as_of,final:true,note:final.complete?'종료 시각의 가격과 환율로 고정한 성과입니다.':'종료 시각의 가격 또는 환율이 없어 최종 성과를 계산하지 못했습니다.'};
    }
  }
  const cap=a.ended_at&&a.ended_at<iso(now)?new Date(a.ended_at):now;
  const kr=completedDate(cap,'KR'),us=completedDate(cap,'US');
  const sessionOpen={};
  const positions=await rows(env,"SELECT p.*,s.name,s.ticker,s.currency,s.market,px.close AS price,px.date AS price_date,fx.close AS fx,fx.date AS fx_date,iq.price AS intraday_price,iq.price_at AS intraday_at,iq.fetched_at AS intraday_fetched_at,mc.status AS market_status,mc.detail AS market_detail FROM sim_positions p JOIN sim_securities s ON s.id=p.security_id LEFT JOIN sim_prices px ON px.security_id=s.id AND px.date=(SELECT MAX(date) FROM sim_prices WHERE security_id=s.id AND date<=CASE s.market WHEN 'KR' THEN ? ELSE ? END) LEFT JOIN sim_fx fx ON fx.date=(SELECT MAX(date) FROM sim_fx WHERE date<=?) LEFT JOIN sim_intraday_quotes iq ON iq.security_id=s.id AND iq.price_at<=? LEFT JOIN sim_market_checks mc ON mc.security_id=s.id WHERE p.account_id=? AND p.qty>0.000001",kr,us,us,iso(cap),aid);
  let complete=true;
  const holdings=positions.map(p=>{
    const rate=p.currency==='USD'?p.fx:1;
    const cutoff=p.market==='KR'?kr:us;
    const intraday=a.rules_version!=='1';
    if(intraday && sessionOpen[p.market]===undefined) sessionOpen[p.market]=withinUsualSession(cap,p.market);
    const quoteAge=cap.getTime()-Date.parse(p.intraday_at);
    const price=intraday?p.intraday_price:p.price;
    const priceDate=intraday&&p.intraday_at?marketDate(new Date(p.intraday_at),p.market):p.price_date;
    const stale=(intraday?(p.market_status!=='ok'||!p.intraday_at||!Number.isFinite(quoteAge)||quoteAge<0||quoteAge>(sessionOpen[p.market]?90*60000:7*86400000)):
      (!p.price_date||Date.parse(cutoff)-Date.parse(p.price_date)>7*86400000))||
      (p.currency==='USD'&&(!p.fx_date||Date.parse(us)-Date.parse(p.fx_date)>7*86400000));
    const ok=price>0&&rate>0&&!stale;
    if(!ok)complete=false;
    return {...p,price,price_date:priceDate,price_at:intraday?p.intraday_at:null,stale,value_krw:ok?p.qty*price*rate:null,pnl_krw:ok?p.qty*price*rate-p.cost_krw:null};
  });
  const equity=complete?a.cash+holdings.reduce((v,p)=>v+p.value_krw,0):null;
  return {...a,holdings,equity,return_pct:equity==null?null:(equity/a.initial_cash-1)*100,complete,at:iso(now),note:(a.rules_version==='1'?SIM_RULES:SIM_INTRADAY_RULES).performance};
}
export async function getPerformance(env,aid,now=new Date()) {
  const a=await getAccount(env,aid,now);
  const snapshots=await rows(env,'SELECT * FROM sim_snapshots WHERE account_id=? ORDER BY date',aid);
  let peak=a.initial_cash,mdd=0;
  for(const s of snapshots){peak=Math.max(peak,s.equity);mdd=Math.min(mdd,(s.equity/peak-1)*100);}
  return {equity:a.equity,return_pct:a.return_pct,max_drawdown_pct:snapshots.length?mdd:null,snapshots,note:'최대 낙폭은 저장된 일별 평가액 기준입니다. '+a.note};
}
// 한 번에 소수 주문만 처리한다. 가격이 없는 주문은 건너뛰어 다른 주문을 막지 않는다.
export async function settleSimulation(env,now=new Date(),budget=40) {
  let used=1,processed=0;
  const orders=await rows(env,"SELECT o.*,s.market,s.currency,c.fee_bps,c.slippage_bps FROM sim_orders o JOIN sim_securities s ON s.id=o.security_id JOIN sim_accounts a ON a.id=o.account_id JOIN sim_contests c ON c.id=a.contest_id JOIN sim_prices p ON p.security_id=o.security_id AND p.date=(SELECT MIN(date) FROM sim_prices WHERE security_id=o.security_id AND date>o.market_date AND date<=CASE s.market WHEN 'KR' THEN ? ELSE ? END) WHERE o.status='pending' AND c.status='active' AND c.rules_version='1' ORDER BY p.date,s.market,o.created_at,o.rowid LIMIT 8",completedDate(now,'KR'),completedDate(now,'US'));
  for(const o of orders){
    if(used+5>budget)break;
    const bar=await env.DB.prepare('SELECT date,open FROM sim_prices WHERE security_id=? AND date>? AND date<=? ORDER BY date LIMIT 1').bind(o.security_id,o.market_date,completedDate(now,o.market)).first();used++;
    if(!bar||!(bar.open>0))continue;
    let fx={close:1,date:bar.date};
    if(o.currency==='USD'){
      fx=await env.DB.prepare("SELECT close,date FROM sim_fx WHERE date<? ORDER BY date DESC LIMIT 1").bind(bar.date).first();used++;
      if(!fx||!(fx.close>0)||Date.parse(bar.date)-Date.parse(fx.date)>7*86400000)continue;
    }
    const price=bar.open*(1+(o.side==='buy'?1:-1)*o.slippage_bps/10000);
    const gross=o.qty*price*fx.close,fee=gross*o.fee_bps/10000;
    const delta=(o.side==='buy'?-gross:gross)-fee;
    try {
      await env.DB.prepare("INSERT INTO sim_fills(order_id,date,price,fx,fx_date,fee_krw,cash_delta,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sim_orders WHERE id=? AND status='pending')").bind(o.id,bar.date,price,fx.close,fx.date,fee,delta,iso(now),o.id).run();used++;processed++;
    }catch(e){
      if(!/현금이 부족|수량이 부족/.test(String(e.message)))throw e;
      await env.DB.prepare("UPDATE sim_orders SET status='rejected',status_reason=?,resolved_at=? WHERE id=? AND status='pending'").bind(/현금/.test(e.message)?'체결 시 현금 부족':'체결 시 보유 수량 부족',iso(now),o.id).run();used+=2;processed++;
    }
  }
  return {processed,used};
}
export async function snapshotSimulation(env,now=new Date()) {
  const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM sim_orders o JOIN sim_securities s ON s.id=o.security_id JOIN sim_accounts a ON a.id=o.account_id JOIN sim_contests c ON c.id=a.contest_id WHERE o.status='pending' AND c.status='active' AND (c.rules_version IN ('2','3') OR EXISTS(SELECT 1 FROM sim_prices WHERE security_id=o.security_id AND date>o.market_date AND date<=CASE s.market WHEN 'KR' THEN ? ELSE ? END))").bind(completedDate(now,'KR'),completedDate(now,'US')).first();
  if(pending.n)return;
  const accounts=await rows(env,"SELECT a.id FROM sim_accounts a JOIN sim_contests c ON c.id=a.contest_id WHERE c.status='active' LIMIT 4");
  for(const a of accounts){
    const v=await getAccount(env,a.id,now);
    if(v.complete)await env.DB.prepare('INSERT INTO sim_snapshots(account_id,date,equity,cash,created_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,date) DO UPDATE SET equity=excluded.equity,cash=excluded.cash,created_at=excluded.created_at').bind(a.id,iso(now).slice(0,10),v.equity,v.cash,iso(now)).run();
  }
}
