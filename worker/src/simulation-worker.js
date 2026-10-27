// 모의투자 시세·체결 전용 Worker. 개인 투자 크론과 CPU 예산을 공유하지 않는다.
import { meter } from './lib/budget.js';
import { refreshSimulationPrices,snapshotSimulation } from './lib/simulation.js';
import { runSimulationIntraday } from './cron/simulation-intraday.js';

export async function runSimulationCron(env,now=new Date(),sources={}) {
  const m=meter(env), errors=[], ran=[];
  try {
    const active=await env.DB.prepare("SELECT id FROM sim_contests WHERE status='active' AND rules_version IN ('2','3') LIMIT 1").first();
    if(!active)return {at:now.toISOString(),ran,errors,subrequests:m.fetches,d1_calls:m.d1};
    const maintenance=now.getUTCMinutes()%15===10;
    if(maintenance && m.d1Left()>26 && m.fetchLeft()>5) {
      try {
        if(now.getUTCHours()===22 && now.getUTCMinutes()===10) {await snapshotSimulation(env,now);ran.push('snapshot');}
        else {await refreshSimulationPrices(env,now,sources.history?{history:sources.history}:undefined);ran.push('history');}
      } catch(e) {errors.push('history: '+String(e.message||e));}
    }
    // 한 틱에 최대 세 종목. 남은 예산이 부족하거나 갱신할 종목이 없으면 멈춘다.
    for(let i=0;!maintenance && i<3 && m.d1Left()>=30 && m.fetchLeft()>=3;i++) {
      try {
        const result=await runSimulationIntraday(env,now,m,sources.intraday);
        if(result.deferred)break;
        if(result.error)errors.push('intraday: '+result.error);
        else ran.push('intraday');
      } catch(e) {errors.push('intraday: '+String(e.message||e));break;}
    }
    if(m.d1Left()>1) await env.DB.prepare("INSERT INTO sim_state(key,value,updated_at) VALUES('cron',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
      .bind(JSON.stringify({at:now.toISOString(),ran,errors,subrequests:m.fetches,d1_calls:m.d1}),now.toISOString()).run();
    return {at:now.toISOString(),ran,errors,subrequests:m.fetches,d1_calls:m.d1};
  } finally {m.restore();}
}

export default {
  async scheduled(controller,env,ctx) { ctx.waitUntil(runSimulationCron(env,new Date(controller.scheduledTime))); },
  fetch() { return new Response('Not found',{status:404}); },
};
