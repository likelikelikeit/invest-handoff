import { json,readJson,HttpError } from '../lib/http.js';
import { createContest,rotateToken,getAccount,getPerformance,getOrders,saveThesis,submitOrder,cancelOrder,registerSecurity,SIM_RULES,SIM_INTRADAY_RULES,SIM_OPEN_RULES } from '../lib/simulation.js';
import {search} from '../sources/yahoo.js';
import { finishSimulationContest } from '../lib/simulation-final.js';

export async function simSecurities(req,env,h) {
  const {results:securities}=await env.DB.prepare('SELECT * FROM sim_securities ORDER BY name').all();
  return json({securities},200,h);
}
export async function simRegister(req,env,h){return json(await registerSecurity(env,await readJson(req)),201,h);}
export async function simSearch(req,env,h,p,url){return json({results:await search(url.searchParams.get('q')||'')},200,h);}

export async function simList(req,env,h) {
  const {results:contests}=await env.DB.prepare('SELECT * FROM sim_contests ORDER BY created_at DESC LIMIT 50').all();
  const {results:accounts}=await env.DB.prepare('SELECT id,contest_id,agent_id,name,token_hash IS NOT NULL AS connected FROM sim_accounts ORDER BY agent_id').all();
  const active=contests.find(c=>c.status==='active');
  const versions={'1':SIM_RULES,'2':SIM_INTRADAY_RULES,'3':SIM_OPEN_RULES};
  const rules=versions[active?.rules_version ?? (env.SIM_INTRADAY_ENABLED==='true'?'2':'1')];
  return json({contests,accounts,rules,rules_by_version:versions},200,h);
}
export async function simCreate(req,env,h) {
  const a=await env.DB.prepare("SELECT id FROM sim_contests WHERE status='active'").first();
  if(a)throw new HttpError(409,'진행 중인 대회를 종료한 뒤 새 대회를 만드세요');
  return json(await createContest(env,await readJson(req)),201,h);
}
export async function simEnd(req,env,h,p) {
  return json(await finishSimulationContest(env,p.sid),200,h);
}
export async function simDetail(req,env,h,p) {
  const a=await getAccount(env,p.sid);
  const {results:theses}=await env.DB.prepare('SELECT t.*,s.name,s.ticker FROM sim_theses t JOIN sim_securities s ON s.id=t.security_id WHERE t.account_id=? ORDER BY created_at DESC LIMIT 100').bind(p.sid).all();
  const {results:adjustments}=await env.DB.prepare('SELECT x.*,sp.market_date,sp.numerator,sp.denominator,sp.cash_price,sp.fx,sp.fx_date,sp.recorded_at,s.name,s.ticker FROM sim_split_adjustments x JOIN sim_splits sp ON sp.id=x.split_id JOIN sim_securities s ON s.id=sp.security_id WHERE x.account_id=? ORDER BY sp.effective_at DESC LIMIT 100').bind(p.sid).all();
  return json({account:a,theses,adjustments,...await getOrders(env,p.sid,{limit:100}),performance:await getPerformance(env,p.sid)},200,h);
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
