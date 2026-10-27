// 서비스 바인딩으로만 호출되는 모의투자 전용 시세 Worker. DB에 접근하지 않는다.
import { simulationIntraday } from './sources/simulation-intraday.js';

export default {
  async fetch(request) {
    if(request.method!=='POST')return new Response('허용하지 않는 요청',{status:405});
    try {
      const {symbol,market,at}=await request.json();
      if(typeof symbol!=='string'||symbol.length>24||!['KR','US'].includes(market)||!Number.isFinite(Date.parse(at)))
        return Response.json({error:'모의 시세 요청을 확인하세요'},{status:400});
      const now=new Date(at),benchmark=market==='KR'?'^KS11':'^GSPC';
      const [reference,data]=await Promise.all([simulationIntraday(benchmark,market,now,{sessionsOnly:true}),simulationIntraday(symbol,market,now)]);
      return Response.json({reference:{sessions:reference.sessions},data});
    } catch(e) {return Response.json({error:String(e.message||e).slice(0,300)},{status:502});}
  },
};
