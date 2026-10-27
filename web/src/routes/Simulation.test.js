import {describe,it,expect,vi,afterEach} from 'vitest';
import {mount,unmount,flushSync} from 'svelte';
import Simulation from './Simulation.svelte';
const mocks=vi.hoisted(()=>({api:vi.fn(),settings:{token:''}}));
vi.mock('../lib/api.js',()=>mocks);
let app;
afterEach(async()=>{if(app)await unmount(app);mocks.api.mockReset();mocks.settings.token='';});
const start=()=>{const target=document.createElement('div');document.body.appendChild(target);app=mount(Simulation,{target});flushSync();return target;};
describe('모의투자 화면',()=>{
  it('토큰 없으면 설정으로 안내하고 API를 부르지 않는다',()=>{
    const target=start();expect(target.textContent).toContain('투자 앱에 연결해 주세요');expect(mocks.api).not.toHaveBeenCalled();
  });
  it('빈 대회에서는 시작 버튼을 제공한다',async()=>{
    mocks.settings.token='fixture';mocks.api.mockResolvedValue({contests:[],accounts:[],rules:{}});
    const target=start();await vi.waitFor(()=>expect([...target.querySelectorAll('button')].some(b=>b.textContent.trim()==='대회 만들기')).toBe(true));
  });
  it('네 계좌 순위와 선택한 계좌의 현금을 표시한다',async()=>{
    mocks.settings.token='fixture';
    const a={id:'account',contest_id:'contest',name:'한유민',cash:100000000,equity:100000000,return_pct:0,holdings:[]};
    mocks.api.mockImplementation(async path=>{
      if(path==='/sim/contests')return {contests:[{id:'contest',name:'시즌 1',status:'active',initial_cash:100000000,fee_bps:10,slippage_bps:5}],accounts:[a],rules:{performance:'잠정 성과'}};
      if(path.endsWith('/ranking'))return {accounts:[a]};
      return {account:a,theses:[],orders:[],total:0,performance:{max_drawdown_pct:0,snapshots:[]}};
    });
    const target=start();await vi.waitFor(()=>expect(target.textContent).toContain('아직 보유 종목이 없습니다'));
    expect(target.textContent).toContain('100,000,000원');expect(target.textContent).toContain('잠정 성과');
    expect([...target.querySelectorAll('button')].find(b=>b.textContent==='주문하기').disabled).toBe(true);
  });
  it('대회 개설 시 장중 방식과 시가 전용 대안을 보여 준다',async()=>{
    HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    HTMLDialogElement.prototype.close=function(){this.open=false;};
    mocks.settings.token='fixture';
    mocks.api.mockResolvedValue({contests:[],accounts:[],rules:{version:'2',performance:'배당 제외'},rules_by_version:{'2':{execution:'장중 15분봉'},'3':{execution:'시가 전용'}}});
    const target=start();await vi.waitFor(()=>expect([...target.querySelectorAll('button')].some(b=>b.textContent.trim()==='대회 만들기')).toBe(true));
    [...target.querySelectorAll('button')].find(b=>b.textContent.trim()==='대회 만들기').click();flushSync();
    expect(document.body.textContent).toContain('체결 방식');expect(document.body.textContent).toContain('장중 15분봉');
    document.querySelector('button[aria-label="대회 체결 방식"]').click();flushSync();
    [...document.querySelectorAll('[role="option"]')].find(b=>b.textContent.includes('정규장 시가 전용')).click();flushSync();
    expect(document.body.textContent).toContain('시가 전용');
  });
  it('주문 목록에 체결 대기와 확인 사유를 구분해 표시한다',async()=>{
    mocks.settings.token='fixture';
    const a={id:'account',contest_id:'contest',name:'한유민',cash:100000000,equity:100000000,return_pct:0,holdings:[]};
    mocks.api.mockImplementation(async path=>{
      if(path==='/sim/contests')return {contests:[{id:'contest',name:'시즌',status:'active',initial_cash:100000000}],accounts:[a],rules:{performance:'배당 제외'}};
      if(path.endsWith('/ranking'))return {accounts:[a]};
      return {account:a,theses:[],orders:[{id:'order',name:'시험',side:'buy',qty:1,created_at:'2026-10-27T13:37:00Z',status:'pending',display_status:'waiting',market_status:'hold',market_detail:'정규장 시세 확인 필요',reason:'시험'}],total:1,performance:{max_drawdown_pct:null,snapshots:[]}};
    });
    const target=start();await vi.waitFor(()=>expect(target.textContent).toContain('아직 보유 종목이 없습니다'));
    [...target.querySelectorAll('button')].find(b=>b.textContent==='주문·체결').click();flushSync();
    expect(target.textContent).toContain('체결 대기');expect(target.textContent).toContain('정규장 시세 확인 필요');
  });
});
