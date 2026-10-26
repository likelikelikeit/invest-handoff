import { json,readJson,HttpError } from '../lib/http.js';
import { createContest,rotateToken,getAccount,getPerformance,getOrders,saveThesis,submitOrder,cancelOrder,registerSecurity,SIM_RULES } from '../lib/simulation.js';
import {search} from '../sources/yahoo.js';

export async function simSecurities(req,env,h) {
  const {results:securities}=await env.DB.prepare('SELECT * FROM sim_securities ORDER BY name').all();
  return json({securities},200,h);
}
export async function simRegister(req,env,h){return json(await registerSecurity(env,await readJson(req)),201,h);}
export async function simSearch(req,env,h,p,url){return json({results:await search(url.searchParams.get('q')||'')},200,h);}

export async function simList(req,env,h) {
  const {results:contests}=await env.DB.prepare('SELECT * FROM sim_contests ORDER BY created_at DESC LIMIT 50').all();
  const {results:accounts}=await env.DB.prepare('SELECT id,contest_id,agent_id,name,token_hash IS NOT NULL AS connected FROM sim_accounts ORDER BY agent_id').all();
  return json({contests,accounts,rules:SIM_RULES},200,h);
}
export async function simCreate(req,env,h) {
  const a=await env.DB.prepare("SELECT id FROM sim_contests WHERE status='active'").first();
  if(a)throw new HttpError(409,'진행 중인 대회를 종료한 뒤 새 대회를 만드세요');
  return json(await createContest(env,await readJson(req)),201,h);
}
export async function simEnd(req,env,h,p) {
  // 미체결 주문을 조용히 없애거나 과거 시가 체결을 누락시키지 않는다.
  const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM sim_orders o JOIN sim_accounts a ON a.id=o.account_id WHERE a.contest_id=? AND o.status='pending'").bind(p.sid).first();
  if(pending.n)throw new HttpError(409,'미체결 주문이 있습니다. 체결 또는 취소 후 종료하세요');
  const r=await env.DB.prepare("UPDATE sim_contests SET status='ended',ended_at=? WHERE id=? AND status='active' AND NOT EXISTS(SELECT 1 FROM sim_orders o JOIN sim_accounts a ON a.id=o.account_id WHERE a.contest_id=sim_contests.id AND o.status='pending')").bind(new Date().toISOString(),p.sid).run();
  if(!r.meta.changes)throw new HttpError(409,'대회 상태나 미체결 주문이 바뀌었습니다. 새로고침해 주세요.');
  return json({ended:true},200,h);
}
export async function simDetail(req,env,h,p) {
  const a=await getAccount(env,p.sid);
  const {results:theses}=await env.DB.prepare('SELECT t.*,s.name,s.ticker FROM sim_theses t JOIN sim_securities s ON s.id=t.security_id WHERE t.account_id=? ORDER BY created_at DESC LIMIT 100').bind(p.sid).all();
  return json({account:a,theses,...await getOrders(env,p.sid,{limit:100}),performance:await getPerformance(env,p.sid)},200,h);
}
export async function simToken(req,env,h,p) { return json(await rotateToken(env,p.sid,(await readJson(req)).revoke===true),200,h); }
export async function simThesis(req,env,h,p) { return json(await saveThesis(env,p.sid,await readJson(req)),201,h); }
export async function simOrder(req,env,h,p) { return json(await submitOrder(env,p.sid,await readJson(req)),201,h); }
export async function simCancel(req,env,h,p) { return json(await cancelOrder(env,p.sid,await readJson(req)),200,h); }
export async function simRanking(req,env,h,p) {
  const {results:ids}=await env.DB.prepare('SELECT id FROM sim_accounts WHERE contest_id=?').bind(p.sid).all();
  const accounts=[];
  for(const a of ids)accounts.push(await getAccount(env,a.id));
  accounts.sort((a,b)=>(b.return_pct??-Infinity)-(a.return_pct??-Infinity));
  return json({accounts,at:new Date().toISOString(),note:SIM_RULES.performance},200,h);
}
