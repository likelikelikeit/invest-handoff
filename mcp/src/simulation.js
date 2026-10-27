// 별도 경로·계좌 키. 실제 투자 데이터와 다른 참가자의 분석은 노출하지 않는다.
import { authenticateSim,account,marketData,registerSecurity,saveThesis,submitOrder,cancelOrder,getOrders,getAccount,getPerformance,SIM_RULES,SIM_INTRADAY_RULES,SIM_OPEN_RULES } from '../../worker/src/lib/simulation.js';
const schema=properties=>({type:'object',properties,additionalProperties:false});
const str={type:'string'},num={type:'integer',minimum:1};
export const SIM_TOOLS=[
  {name:'sim_get_rules',description:'참가 대회의 규칙과 비용을 확인합니다.',inputSchema:schema({}),run:async(e,a,id)=>{const c=await account(e,id);return {rules:({'1':SIM_RULES,'2':SIM_INTRADAY_RULES,'3':SIM_OPEN_RULES})[c.rules_version],contest:c};}},
  {name:'sim_get_account',description:'자기 계좌의 현금·보유·가격 기준일·잠정 손익과 최근 분석 번호를 확인합니다.',inputSchema:schema({}),run:async(e,a,id)=>{
    const account=await getAccount(e,id);
    const {results:theses}=await e.DB.prepare('SELECT id,security_id,created_at FROM sim_theses WHERE account_id=? ORDER BY created_at DESC LIMIT 20').bind(id).all();
    const {results:adjustments}=await e.DB.prepare('SELECT x.*,s.market_date,s.numerator,s.denominator,s.recorded_at FROM sim_split_adjustments x JOIN sim_splits s ON s.id=x.split_id WHERE x.account_id=? ORDER BY s.effective_at DESC LIMIT 20').bind(id).all();
    return {...account,recent_theses:theses,recent_adjustments:adjustments};
  }},
  {name:'sim_get_market_data',description:'등록된 한국·미국 종목의 지연 시세와 기준 시각·확인 상태를 조회합니다.',inputSchema:schema({query:str}),run:(e,a)=>marketData(e,a)},
  {name:'sim_register_security',description:'검색한 종목을 모의투자 전용 목록에 등록합니다. 개인 종목·관심 목록은 바꾸지 않습니다.',inputSchema:{...schema({symbol:str,name:str}),required:['symbol']},run:async(e,a,id)=>{
    if((await account(e,id)).status!=='active')throw new Error('종료된 대회입니다');
    return registerSecurity(e,a);
  }},
  {name:'sim_save_thesis',description:'투자 근거를 새 버전으로 저장합니다. 과거 기록은 수정하지 않습니다.',inputSchema:{...schema({security_id:num,thesis:str,valuation:str,scenarios:str,risks:str,invalidation:str,sources:str,model:str,effort:str}),required:['security_id','thesis','valuation','scenarios','risks','invalidation','sources']},run:(e,a,id)=>saveThesis(e,id,a)},
  {name:'sim_submit_order',description:'자기 분석 버전에 연결해 주문합니다. 체결 규칙은 sim_get_rules로 확인합니다. 재전송 시 같은 client_order_id를 씁니다.',inputSchema:{...schema({thesis_id:str,side:{enum:['buy','sell']},qty:num,reason:str,client_order_id:str}),required:['thesis_id','side','qty','reason','client_order_id']},run:(e,a,id)=>submitOrder(e,id,a)},
  {name:'sim_cancel_order',description:'미체결 주문을 취소합니다.',inputSchema:{...schema({order_id:str}),required:['order_id']},run:(e,a,id)=>cancelOrder(e,id,a)},
  {name:'sim_get_orders',description:'자기 주문·체결·거절 사유를 페이지별로 확인합니다.',inputSchema:schema({limit:num,offset:{type:'integer',minimum:0}}),run:(e,a,id)=>getOrders(e,id,a)},
  {name:'sim_get_performance',description:'자기 잠정 수익률·일별 평가액·최대 낙폭을 확인합니다.',inputSchema:schema({}),run:(e,a,id)=>getPerformance(e,id)},
];
export async function handleSimRpc(body,env,aid) {
  if(!body||Array.isArray(body)||typeof body!=='object')return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'올바른 요청 객체가 필요합니다'}};
  if(body.id===undefined)return null;
  const ok=result=>({jsonrpc:'2.0',id:body.id,result});
  if(body.method==='initialize')return ok({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'invest-simulation',version:'1.0.0',title:'모의투자'},instructions:'모의투자 전용 계좌입니다. 한국어로 답합니다. 먼저 sim_get_rules를 확인합니다. 모의투자의 종목·가격·분석·주문은 이 전용 도구에서만 기록합니다. 개인 투자의견·메모·보유·관심종목이나 Vault의 개인 영역에 모의투자 분석을 옮기지 않습니다. 종목 검색→전용 등록→분석→주문 순서로 진행합니다. 재전송은 같은 주문 번호를 씁니다. 배당은 반영하지 않으며, 시세·기업행동의 확인 상태를 살펴봅니다. 이 키는 자기 계좌에만 접근합니다.'});
  if(body.method==='ping')return ok({});
  if(body.method==='tools/list')return ok({tools:SIM_TOOLS.map(({run,...t})=>t)});
  if(body.method!=='tools/call')return {jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'지원하지 않는 메서드입니다'}};
  try{
    const tool=SIM_TOOLS.find(t=>t.name===body.params?.name);
    if(!tool)throw new Error('없는 모의투자 도구입니다');
    const a=body.params.arguments??{};
    if(!a||typeof a!=='object'||Array.isArray(a))throw new Error('인자를 확인하세요');
    for(const k of Object.keys(a))if(!Object.hasOwn(tool.inputSchema.properties,k))throw new Error('지원하지 않는 인자: '+k);
    for(const k of tool.inputSchema.required||[])if(a[k]===undefined)throw new Error('필수 인자가 없습니다: '+k);
    for(const [k,v] of Object.entries(a)){
      const s=tool.inputSchema.properties[k];
      if(s.type==='string'&&typeof v!=='string')throw new Error(k+'는 문자열이어야 합니다');
      if(s.type==='integer'&&(!Number.isSafeInteger(v)||v<(s.minimum??-Infinity)))throw new Error(k+'는 올바른 정수여야 합니다');
      if(s.enum&&!s.enum.includes(v))throw new Error(k+'의 값을 확인하세요');
    }
    const data=await tool.run(env,a,aid);
    return ok({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
  }catch(e){return ok({isError:true,content:[{type:'text',text:String(e.message||e)}]});}
}
export async function simulationEndpoint(request,env) {
  if(request.method!=='POST')return new Response('POST만 받습니다',{status:405});
  let aid;
  try{aid=await authenticateSim(request,env);}catch(e){if(e.status!==401)throw e;return Response.json({error:e.message},{status:401,headers:{'WWW-Authenticate':'Bearer realm="invest-simulation"','Cache-Control':'no-store'}});}
  let body;try{body=await request.json();}catch{return Response.json({error:'본문이 올바른 JSON이 아닙니다'},{status:400});}
  const result=await handleSimRpc(body,env,aid);
  return result?Response.json(result,{headers:{'Cache-Control':'no-store'}}):new Response(null,{status:202});
}
