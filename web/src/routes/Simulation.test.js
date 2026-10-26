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
    const target=start();await vi.waitFor(()=>expect(target.textContent).toContain('대회 만들기'));
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
});
