<script>
  import { onMount } from 'svelte';
  import PageHead from '../components/PageHead.svelte';
  import Sheet from '../components/Sheet.svelte';
  import SelectField from '../components/SelectField.svelte';
  import SecuritySearch from '../components/SecuritySearch.svelte';
  import { api,settings } from '../lib/api.js';
  import { won,pctSigned,tonePct,stamp,qtyStr,usd } from '../lib/format.js';
  let contests=$state([]),accounts=$state([]),ranking=$state([]),contestId=$state(''),accountId=$state('');
  let rules=$state(null),detail=$state(null),busy=$state(false),loading=$state(true),error=$state(''),offline=$state(false),message=$state('');
  let createOpen=$state(false),thesisOpen=$state(false),orderOpen=$state(false),keyOpen=$state(false),secret=$state('');
  let name=$state('모의투자 시즌 1'),initial=$state(100000000),fee=$state(10),slippage=$state(5),section=$state('holdings');
  let securities=$state([]),securityId=$state(''),thesis=$state(''),valuation=$state(''),scenarios=$state(''),risks=$state(''),invalidation=$state(''),sources=$state('');
  let thesisId=$state(''),side=$state('buy'),qty=$state(1),reason=$state(''),clientOrderId=$state('');
  let detailSequence=0,rankingSequence=0;
  const contest=$derived(contests.find(c=>c.id===contestId));
  const current=$derived(detail?.account);
  const members=$derived(accounts.filter(a=>a.contest_id===contestId));
  const disabled=$derived(busy||offline||contest?.status!=='active');
  const labels={pending:'미체결',filled:'체결',cancelled:'취소',rejected:'거절'};
  const fields=[['투자 논리','thesis'],['가치평가','valuation'],['시나리오','scenarios'],['위험','risks'],['철회 조건','invalidation'],['출처','sources']];

  async function chooseAccount(id){
    accountId=id;detail=null;const seq=++detailSequence;
    try{const r=await api('/sim/accounts/'+id);if(seq===detailSequence){detail=r;offline=offline||!!r._offline;}}
    catch(e){if(seq===detailSequence)error=e.message;}
  }
  async function chooseContest(id){
    contestId=id;ranking=[];detail=null;accountId='';const seq=++rankingSequence;
    try{
      const r=await api('/sim/contests/'+id+'/ranking');if(seq!==rankingSequence)return;
      ranking=r.accounts;offline=offline||!!r._offline;
      const first=accounts.find(a=>a.contest_id===id);if(first)await chooseAccount(first.id);
    }catch(e){if(seq===rankingSequence)error=e.message;}
  }
  async function refresh(){
    loading=true;error='';offline=false;
    try{
      const r=await api('/sim/contests');contests=r.contests;accounts=r.accounts;rules=r.rules;offline=!!r._offline;
      if(contests.length){
        const id=contests.some(c=>c.id===contestId)?contestId:contests[0].id;
        const keep=accountId;await chooseContest(id);if(keep&&accounts.some(a=>a.id===keep&&a.contest_id===id))await chooseAccount(keep);
      }
    }catch(e){error=e.status===500?'모의투자 데이터를 불러오지 못했습니다. 서버 오류라면 마이그레이션 0019 적용 여부를 확인하세요. '+e.message:e.message;}
    finally{loading=false;}
  }
  async function mutate(fn){
    if(busy||offline)return;busy=true;error='';message='';
    try{await fn();}catch(e){error=e.message;}finally{busy=false;}
  }
  const create=()=>mutate(async()=>{
    const r=await api('/sim/contests',{method:'POST',body:{name,initial_cash:initial,fee_bps:fee,slippage_bps:slippage}});
    createOpen=false;contestId=r.id;await refresh();message='동일 자금으로 네 계좌를 만들었습니다.';
  });
  const end=()=>{if(confirm('대회를 종료할까요? 종료 후에는 주문과 분석을 추가할 수 없습니다.'))mutate(async()=>{await api('/sim/contests/'+contestId+'/end',{method:'POST',body:{}});await refresh();});};
  const issueKey=()=>{
    if(members.find(a=>a.id===accountId)?.connected&&!confirm('새 키를 발급하면 기존 연결 키는 즉시 폐기됩니다. 재발급할까요?'))return;
    mutate(async()=>{const r=await api('/sim/accounts/'+accountId+'/token',{method:'POST',body:{}});secret=r.token;keyOpen=true;accounts=accounts.map(a=>a.id===accountId?{...a,connected:1}:a);});
  };
  const revoke=()=>{if(confirm('이 계좌의 에이전트 접속키를 폐기할까요?'))mutate(async()=>{await api('/sim/accounts/'+accountId+'/token',{method:'POST',body:{revoke:true}});secret='';accounts=accounts.map(a=>a.id===accountId?{...a,connected:0}:a);message='접속키를 폐기했습니다.';});};
  const openThesis=()=>mutate(async()=>{
    const r=await api('/sim/securities');securities=r.securities||[];
    if(r._offline){offline=true;throw new Error('오프라인에서는 분석을 저장할 수 없습니다.');}
    securityId=String(securities[0]?.id||'');thesisOpen=true;
  });
  const addSecurity=pick=>mutate(async()=>{
    const r=await api('/sim/securities',{method:'POST',body:{symbol:pick.symbol,name:pick.name}});
    securities=[...securities.filter(s=>s.id!==r.security.id),r.security];securityId=String(r.security.id);
  });
  const save=()=>mutate(async()=>{
    await api('/sim/accounts/'+accountId+'/theses',{method:'POST',body:{security_id:Number(securityId),thesis,valuation,scenarios,risks,invalidation,sources}});
    thesisOpen=false;thesis='';valuation='';scenarios='';risks='';invalidation='';sources='';await chooseAccount(accountId);message='분석을 새 버전으로 저장했습니다.';
  });
  function openOrder(){thesisId=detail?.theses[0]?.id||'';reason='';qty=1;side='buy';clientOrderId=crypto.randomUUID();orderOpen=true;}
  const send=()=>mutate(async()=>{
    await api('/sim/accounts/'+accountId+'/orders',{method:'POST',body:{thesis_id:thesisId,side,qty:Number(qty),reason,client_order_id:clientOrderId}});
    orderOpen=false;await chooseAccount(accountId);section='orders';message='주문을 접수했습니다. 체결 결과는 주문 기록에서 확인하세요.';
  });
  const cancel=id=>mutate(async()=>{await api('/sim/accounts/'+accountId+'/cancel',{method:'POST',body:{order_id:id}});await chooseAccount(accountId);});
  onMount(()=>{if(settings.token)refresh();else loading=false;});
</script>

<PageHead title="모의투자"><button class="btn sm" disabled={busy||loading} onclick={refresh}>새로고침</button></PageHead>
<p class="intro">같은 출발선, 서로 다른 판단. 모든 기록은 모의투자 안에만 남습니다.</p>
{#if error}<p class="msg bad" role="alert">{error}</p>{/if}
{#if message}<p class="msg" role="status">{message}</p>{/if}
{#if offline}<p class="notice" role="status">오프라인 · 마지막 저장 데이터입니다. 주문과 설정 변경은 연결 후 가능합니다.</p>{/if}
{#if !settings.token}
  <div class="empty"><h2>투자 앱에 연결해 주세요</h2><p>더보기에서 앱 토큰을 설정하면 대회를 만들 수 있습니다.</p><a href="#/more" class="btn">설정으로</a></div>
{:else if loading&&!contests.length}<p class="empty">불러오는 중…</p>
{:else if !contests.length&&!error}
  <div class="empty"><span class="eyebrow">첫 번째 시즌</span><h2>네 명의 투자 기록을 한곳에</h2><p>같은 자금으로 시작하고, 분석에서 주문과 체결까지 이어지는 과정을 남깁니다.</p><button class="btn primary" disabled={busy||offline} onclick={()=>createOpen=true}>대회 만들기</button></div>
{:else if contests.length}
  <div class="toolbar"><SelectField value={contestId} options={contests.map(c=>({value:c.id,label:c.name+(c.status==='ended'?' · 종료':' · 진행 중')}))} ariaLabel="대회 선택" onchange={chooseContest}/><span class="grow"></span>
    {#if contest?.status==='active'}<button class="btn sm" disabled={busy||offline} onclick={end}>대회 종료</button>{:else}<button class="btn primary sm" disabled={busy||offline} onclick={()=>createOpen=true}>새 대회</button>{/if}
  </div>
  <div class="season"><span class="eyebrow">동일 초기 자금</span><strong class="num">{won(contest?.initial_cash||0)}</strong><p>매매 수수료 {contest?.fee_bps}bp · 슬리피지 {contest?.slippage_bps}bp · 다음 거래일 시가 체결</p></div>
  <p class="notice">{rules?.performance}</p>
  <div class="competition"><section aria-label="계좌 비교"><div class="section-head"><h2>계좌 비교</h2><span>가격·환율 기준 · 종가 평가</span></div>
    {#each ranking as a,i (a.id)}
      <button class="rank" class:selected={accountId===a.id} onclick={()=>chooseAccount(a.id)}>
        <span class="rank-no">{i+1}</span><span class="person"><b>{a.name}</b><small>{a.holdings.length}종목 · 현금 {won(a.cash)}</small></span>
        <span class="result"><b class={tonePct(a.return_pct||0)}>{a.return_pct==null?'계산 대기':pctSigned(a.return_pct)}</b><small>{a.equity==null?'시세 확인 필요':won(a.equity)}</small></span>
      </button>
    {/each}
  </section>
  {#if current}
    <section class="account"><div class="account-head"><div><span class="eyebrow">개별 계좌</span><h2>{current.name}</h2></div><div class="actions"><button class="btn sm" disabled={disabled} onclick={openThesis}>분석 기록</button><button class="btn primary sm" disabled={disabled||!detail.theses.length} onclick={openOrder}>주문하기</button></div></div>
      <div class="segments" aria-label="계좌 상세 화면">
        {#each [['holdings','보유'],['orders','주문·체결'],['research','분석'],['connection','에이전트 연결']] as [key,label]}<button class:on={section===key} aria-pressed={section===key} onclick={()=>section=key}>{label}</button>{/each}
      </div>
      {#if section==='holdings'}
        <div class="totals"><div><span>평가 자산</span><b class="num">{current.equity==null?'계산 대기':won(current.equity)}</b></div><div><span>주문 가능 현금</span><b class="num">{won(current.cash)}</b></div><div><span>일별 최대 낙폭</span><b class="num down">{pctSigned(detail.performance.max_drawdown_pct)}</b></div></div>
        {#if !current.holdings.length}<p class="empty small">아직 보유 종목이 없습니다. 분석을 기록한 뒤 주문해 보세요.</p>{/if}
        {#each current.holdings as p (p.security_id)}<div class="holding"><div><b>{p.name}</b><small>{p.ticker} · {qtyStr(p.qty)}주</small><small>지연 종가 {p.price_date||'없음'}{p.currency==='USD'?' · 환율 '+(p.fx_date||'없음'):''}</small></div><div class="result"><b>{p.value_krw==null?'시세 없음':won(p.value_krw)}</b><small>{p.price==null?'—':p.currency==='USD'?usd(p.price):won(p.price)}</small><small class={tonePct(p.pnl_krw||0)}>평가손익 {p.pnl_krw==null?'—':won(p.pnl_krw)}</small></div></div>{/each}
        {#if detail.performance.snapshots.length}<details><summary>일별 평가 기록</summary>{#each detail.performance.snapshots as s}<div class="line"><span>{s.date}</span><span class="num">{won(s.equity)}</span></div>{/each}</details>{/if}
      {:else if section==='orders'}
        {#if !detail.orders.length}<p class="empty small">접수한 주문이 없습니다.</p>{/if}
        {#each detail.orders as o (o.id)}<details class="record"><summary><span><b class={o.side==='buy'?'up':'down'}>{o.side==='buy'?'매수':'매도'}</b> {o.name} · {qtyStr(o.qty)}주<small>{stamp(o.created_at)}</small></span><span>{labels[o.status]}</span></summary><p>{o.reason}</p><small>연결 분석 {o.thesis_id}</small>{#if o.fill_date}<p>{o.fill_date} · {o.currency==='USD'?usd(o.fill_price):won(o.fill_price)} · 비용 {won(o.fee_krw)}{o.currency==='USD'?' · 환율 '+o.fx.toLocaleString('ko-KR')+'원 ('+o.fx_date+')':''}</p>{/if}{#if o.status_reason}<p>{o.status_reason}</p>{/if}{#if o.status==='pending'}<button class="btn sm" disabled={disabled} onclick={()=>cancel(o.id)}>주문 취소</button>{/if}</details>{/each}
        <p class="msg">최근 {detail.orders.length}건 / 전체 {detail.total}건. 전체 기록은 에이전트 도구에서 페이지별로 조회할 수 있습니다.</p>
      {:else if section==='research'}
        {#if !detail.theses.length}<p class="empty small">아직 분석이 없습니다. 저장한 분석은 새 버전으로만 추가됩니다.</p>{/if}
        {#each detail.theses as t (t.id)}<details class="record"><summary><b>{t.name}</b><small>{stamp(t.created_at)}</small></summary>{#each fields as [label,key]}<h3>{label}</h3><p class="prose">{t[key]}</p>{/each}<small>분석 번호 {t.id}{t.model?' · '+t.model:''}{t.effort?' · '+t.effort:''}</small></details>{/each}
        <p class="msg">최근 100개 분석 버전까지 표시합니다.</p>
      {:else}
        <div class="connection"><h3>{current.name} 전용 연결</h3><p>이 키로는 이 계좌의 분석·주문·성과만 접근할 수 있습니다. 키는 발급 직후 한 번 표시합니다.</p><p class="msg">연결 주소</p><code>https://invest-mcp.hyungjin0416.workers.dev/sim/mcp</code><div class="actions"><button class="btn" disabled={disabled} onclick={issueKey}>접속키 발급·재발급</button><button class="btn" disabled={disabled||!members.find(a=>a.id===accountId)?.connected} onclick={revoke}>키 폐기</button></div><p class="msg">작업실에는 계좌별 키와 전용 중계 연결이 필요합니다. 일반 투자 MCP의 공용 로그인으로는 주문할 수 없습니다.</p></div>
      {/if}
    </section>
  {:else}<p class="empty small">계좌를 불러오는 중…</p>{/if}</div>
  <details class="rules"><summary>대회 규칙</summary>{#if rules}{#each [rules.execution,rules.cancellation,rules.fx,rules.sizing] as rule}<p>{rule}</p>{/each}{/if}<p>리서치·과정·도구 활용 심사와 최종 직위 배정은 이 화면에서 자동 채점하지 않습니다.</p></details>
{/if}

<Sheet bind:open={createOpen} title="대회 만들기">
  <form onsubmit={e=>{e.preventDefault();create();}} class="form"><label>대회 이름<input bind:value={name} required maxlength="100" /></label><label>1인 초기 자금 (원)<input type="number" bind:value={initial} min="10000" max="1000000000000" required /></label><div class="pair"><label>매매 수수료 (bp)<input type="number" bind:value={fee} min="0" max="100" step="0.1" required /></label><label>슬리피지 (bp)<input type="number" bind:value={slippage} min="0" max="100" step="0.1" required /></label></div><p class="msg">1bp = 0.01%. 한유민·김유안·박아연·이정안에게 같은 자금을 배정합니다. 규칙은 개설 후 수정할 수 없습니다.</p><p class="notice">가격·환율 기준 예비 운용입니다. 배당·분할은 자동 반영되지 않습니다.</p>{#if error}<p class="msg bad" role="alert">{error}</p>{/if}<button class="btn primary" disabled={busy||offline}>네 계좌로 시작</button></form>
</Sheet>
<Sheet bind:open={thesisOpen} title="분석 기록" guardClose={()=>true}>
  <form class="form" onsubmit={e=>{e.preventDefault();save();}}><SecuritySearch id="sim-security-search" label="모의투자 종목 검색·추가" searchPath="/sim/search" onpick={addSecurity}/><SelectField bind:value={securityId} options={securities.map(s=>({value:String(s.id),label:s.name+' · '+s.ticker}))} ariaLabel="분석 종목"/>
    <p class="msg">검색해 추가한 종목과 분석은 모의투자에만 저장됩니다. 개인 종목·관심·투자의견에는 들어가지 않습니다.</p>
    <label>투자 논리<textarea bind:value={thesis} required maxlength="20000"></textarea></label><label>가치평가<textarea bind:value={valuation} required maxlength="20000"></textarea></label><label>시나리오<textarea bind:value={scenarios} required maxlength="20000"></textarea></label><label>위험<textarea bind:value={risks} required maxlength="20000"></textarea></label><label>철회 조건<textarea bind:value={invalidation} required maxlength="20000"></textarea></label><label>출처<textarea bind:value={sources} required maxlength="20000" placeholder="자료 주소와 확인한 내용을 적어 주세요."></textarea></label>{#if error}<p class="msg bad" role="alert">{error}</p>{/if}<button class="btn primary" disabled={busy||offline||!securityId}>새 분석 버전 저장</button></form>
</Sheet>
<Sheet bind:open={orderOpen} title="모의 주문" guardClose={()=>true}>
  <form class="form" onsubmit={e=>{e.preventDefault();send();}}><SelectField bind:value={thesisId} options={(detail?.theses||[]).map(t=>({value:t.id,label:t.name+' · '+stamp(t.created_at)}))} ariaLabel="주문 근거 분석 버전"/><SelectField bind:value={side} options={[{value:'buy',label:'매수'},{value:'sell',label:'매도'}]} ariaLabel="매매 방향"/><label>수량 (주)<input type="number" bind:value={qty} min="1" max="1000000000" step="1" required /></label><label>주문 이유·비중 근거<textarea bind:value={reason} required maxlength="5000"></textarea></label><p class="msg">다음 거래일 시가에 비용을 반영합니다. 체결 시 현금이나 수량이 부족하면 거절됩니다.</p>{#if error}<p class="msg bad" role="alert">{error}</p>{/if}<button class="btn primary" disabled={busy||offline||!thesisId}>주문 접수</button></form>
</Sheet>
<Sheet bind:open={keyOpen} title="에이전트 접속키" onclose={()=>secret=''}><div class="form"><p>이 창을 닫으면 키를 다시 볼 수 없습니다. 에이전트의 연결 설정에 저장해 주세요.</p><textarea readonly value={secret} aria-label="새 모의투자 접속키"></textarea><p class="msg">키는 서버에 해시로만 저장됩니다. 기존 키가 있었다면 폐기되었습니다.</p></div></Sheet>

<style>
  .intro{color:var(--sub);margin-bottom:28px}.eyebrow{display:block;font-size:12px;color:var(--sub2);letter-spacing:.03em}.empty{padding:64px 0;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px}.empty p{max-width:42ch;color:var(--sub);word-break:keep-all}.empty h2{font-size:26px;letter-spacing:-.04em}.empty.small{padding:35px 0;font-size:14px;color:var(--sub)}
  .toolbar,.actions,.account-head,.section-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.toolbar{margin:22px 0}.toolbar :global(.select){min-width:220px}.grow{flex:1}.season{padding:20px 0 24px}.season strong{display:block;font-size:clamp(30px,5vw,46px);font-weight:700;letter-spacing:-.045em}.season p{color:var(--sub);font-size:13px}.notice{padding:12px 0;color:var(--orange);font-size:13px;border-top:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft);line-height:1.7}
  section{margin:30px 0}.section-head{justify-content:space-between;margin-bottom:8px}.section-head span{font-size:12px;color:var(--sub2)}h2{font-size:20px;font-weight:680}.rank{display:flex;align-items:center;gap:16px;width:100%;text-align:left;padding:18px 10px;border-bottom:1px solid var(--line-soft);border-left:2px solid transparent}.rank.selected{border-left-color:var(--accent);background:var(--bg2)}.rank-no{font-size:14px;color:var(--sub2);width:15px}.person{flex:1}.rank b{font-size:17px}.result{text-align:right}small{display:block;font-size:12px;color:var(--sub2);font-weight:400;overflow-wrap:anywhere}.rank small{margin-top:3px}.account{border-top:1px solid var(--line);padding-top:28px}.account-head{justify-content:space-between;margin-bottom:18px}
  .segments{display:flex;gap:20px;overflow-x:auto;border-bottom:1px solid var(--line-soft);margin-bottom:24px;white-space:nowrap}.segments button{min-height:44px;font-size:13px;color:var(--sub2);border-bottom:2px solid transparent}.segments button.on{border-color:var(--ink);color:var(--ink);font-weight:650}.totals{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:24px}.totals span{display:block;color:var(--sub);font-size:12px}.totals b{display:block;font-size:19px;font-weight:620;margin-top:4px}.holding,.line{display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--line-soft);gap:16px}.holding b{font-size:15px}.record{padding:16px 0;border-bottom:1px solid var(--line-soft)}summary{cursor:pointer;min-height:44px;align-content:center;font-size:14px}.record summary{display:flex;align-items:center;justify-content:space-between;gap:15px}.record p{margin:10px 0;font-size:14px}.record h3{font-size:12px;color:var(--sub);margin-top:18px}.prose{white-space:pre-wrap;overflow-wrap:anywhere}.rules{margin:36px 0;color:var(--sub);font-size:13px}.rules p{margin:12px 0}.connection{max-width:640px}.connection p{font-size:14px;color:var(--sub);margin:12px 0}.connection code{font-size:12px;overflow-wrap:anywhere}.connection .actions{margin-top:20px}.form{display:flex;flex-direction:column;gap:18px;padding-top:8px}.form label{font-size:13px;color:var(--sub);display:flex;flex-direction:column;gap:6px}.form input,.form textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg);color:var(--ink);font-family:inherit;font-size:16px;min-width:0}.form textarea{min-height:100px;resize:vertical}.pair{display:flex;gap:16px}.pair label{flex:1;min-width:0}.msg{margin:8px 0}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  @media(min-width:900px){.competition{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:40px;align-items:start}.competition .account{border-top:0;border-left:1px solid var(--line-soft);padding:0 0 0 32px;margin-top:30px}.season{padding-top:16px}.rank{padding:20px 12px}.rank b{font-size:17px}.account-head h2{font-size:24px}.totals{justify-content:flex-start;gap:28px}.intro{margin-bottom:16px}}
  @media(max-width:420px){.rank{gap:9px;padding-left:4px;padding-right:4px}.rank b{font-size:15px}.rank small{font-size:11px}.account-head{align-items:flex-start}.actions{gap:6px}.totals{gap:14px}.totals b{font-size:16px}.toolbar :global(.select){min-width:180px;flex:1}}
</style>
