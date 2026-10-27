import { describe, it, expect } from 'vitest';
import { parseSimulationIntraday, firstOrderBar, selectSimulationExecution } from '../src/sources/simulation-intraday.js';

const start = Date.parse('2026-10-27T13:30:00Z') / 1000;
const response = (marketTime = start + 1800) => ({ chart: { result: [{
  meta: { exchangeTimezoneName: 'America/New_York', regularMarketTime: marketTime,
    tradingPeriods: [[{ start, end: start + 23400 }]] },
  timestamp: [start, start + 900, start + 1800, start + 23400],
  indicators: { quote: [{ open: [10, 11, 12, 13], close: [11, 12, 13, 13], volume: [10, 20, 30, 0] }] },
}] } });

describe('모의투자 15분봉 검증', () => {
  it('미완성 봉과 장 마감 표식을 제외하고 주문이 속한 확정 봉을 고른다', () => {
    const data = parseSimulationIntraday(response(), 'America/New_York', new Date((start + 2700) * 1000));
    expect(data.rows.map(x => x.start)).toEqual([start, start + 900]);
    expect(firstOrderBar(data.rows, start + 7 * 60, start, start + 23400)?.close).toBe(11);
    expect(data.delayMinutes).toBeNull();
    expect(data.minimumWaitMinutes).toBe(15);
  });
  it('제공자 기준 시각이 봉 끝에 못 미치면 미완성 봉으로 보류한다', () => {
    const data = parseSimulationIntraday(response(start + 500), 'America/New_York', new Date((start + 3600) * 1000));
    expect(data.rows).toHaveLength(0);
  });
  it('한국 시세는 봉 종료 후 최소 20분이 지날 때까지 보류한다', () => {
    const krStart=Date.parse('2026-10-27T00:00:00Z')/1000;
    const data=response(); const item=data.chart.result[0]; item.meta.exchangeTimezoneName='Asia/Seoul';
    item.meta.tradingPeriods=[[{start:krStart,end:krStart+21600}]];item.meta.regularMarketTime=krStart+1800;
    item.timestamp=[krStart,krStart+900,krStart+1800,krStart+21600];
    expect(parseSimulationIntraday(data, 'Asia/Seoul', new Date((krStart + 900 + 19 * 60) * 1000)).rows).toHaveLength(0);
    expect(parseSimulationIntraday(data, 'Asia/Seoul', new Date((krStart + 900 + 20 * 60) * 1000)).rows).toHaveLength(1);
  });
  it('한국 15시 종료 표기를 15시 30분으로 보정하고 빠진 마지막 봉은 보류한다', () => {
    const krStart=Date.parse('2026-10-27T00:00:00Z')/1000;
    const data=response(); const item=data.chart.result[0];item.meta.exchangeTimezoneName='Asia/Seoul';
    item.meta.tradingPeriods=[[{start:krStart,end:krStart+21600}]];item.meta.regularMarketTime=krStart+23400;
    item.timestamp=[krStart+20700,krStart+21600];item.indicators.quote=[{open:[100,101],close:[101,102],volume:[1,0]}];
    const parsed=parseSimulationIntraday(data,'Asia/Seoul',new Date((krStart+25000)*1000));
    expect(parsed.sessions[0].end).toBe(krStart+23400);
    expect(firstOrderBar(parsed.rows,krStart+21900,krStart,krStart+23400)).toBeNull();
  });
  it('기대한 봉이 없으면 이후 봉으로 소급 체결하지 않는다', () => {
    const data = response();
    data.chart.result[0].indicators.quote[0].volume[0] = 0;
    const rows = parseSimulationIntraday(data, 'America/New_York', new Date((start + 3600) * 1000)).rows;
    expect(firstOrderBar(rows, start + 60, start, start + 23400)).toBeNull();
  });
  it('거래소 시간이 맞지 않거나 정규장 정보가 없으면 실패한다', () => {
    expect(() => parseSimulationIntraday(response(), 'Asia/Seoul')).toThrow();
    const data = response(); data.chart.result[0].meta.tradingPeriods = [];
    expect(() => parseSimulationIntraday(data, 'America/New_York')).toThrow();
  });
  it('분할 정보가 불명확하면 해당 응답을 사용하지 않는다', () => {
    const data = response(); data.chart.result[0].events = { splits: { invalid: { date: start, numerator: 1, denominator: 0 } } };
    expect(() => parseSimulationIntraday(data, 'America/New_York', new Date((start + 3600) * 1000))).toThrow('분할·병합');
  });
  it('장전 주문은 정규장 첫 봉의 시가, 장중 주문은 해당 봉의 종가를 고른다', () => {
    const data = parseSimulationIntraday(response(), 'America/New_York', new Date((start + 3600) * 1000));
    const previous = { start: start - 86400, end: start - 86400 + 23400 };
    const sessions = [previous, ...data.sessions];
    expect(selectSimulationExecution(start - 60, sessions, data)).toMatchObject({ kind: 'open', price: 10, priceTime: start });
    expect(selectSimulationExecution(start + 7 * 60, sessions, data)).toMatchObject({ kind: 'close', price: 11, priceTime: start + 900 });
    expect(selectSimulationExecution(start + 15 * 60, sessions, data)).toMatchObject({ kind: 'close', price: 12 });
  });
  it('시가·시세 또는 거래일 이력이 빠지면 다른 봉으로 체결하지 않는다', () => {
    const data = parseSimulationIntraday(response(), 'America/New_York', new Date((start + 3600) * 1000));
    const previous = { start: start - 86400, end: start - 86400 + 23400 };
    expect(selectSimulationExecution(start - 60, data.sessions, data).reason).toBe('거래일 이력 확인 필요');
    expect(selectSimulationExecution(start - 60, [previous, ...data.sessions], { ...data, rows: data.rows.slice(1) }).reason).toBe('확정 시세 대기');
    expect(selectSimulationExecution(start + 7 * 60, [previous, ...data.sessions], { ...data, sessions: [] }).reason).toBe('종목의 정규장 확인 필요');
  });
  it('주말 뒤 서머타임 종료 시 제공된 월요일 정규장 시가를 쓴다', () => {
    const friday = { start: Date.parse('2026-10-30T13:30:00Z') / 1000, end: Date.parse('2026-10-30T20:00:00Z') / 1000 };
    const monday = { start: Date.parse('2026-11-02T14:30:00Z') / 1000, end: Date.parse('2026-11-02T21:00:00Z') / 1000 };
    const rows = [{ start: monday.start, end: monday.start + 900, sessionStart: monday.start, open: 100, close: 101 }];
    const orderTime = Date.parse('2026-10-31T03:00:00Z') / 1000;
    expect(selectSimulationExecution(orderTime, [friday, monday], { sessions: [friday, monday], rows }))
      .toMatchObject({ kind: 'open', price: 100, priceTime: monday.start });
  });
  it('대회 중 분할이 발견되면 보유 조정을 확인할 때까지 체결을 보류한다', () => {
    const data = parseSimulationIntraday(response(), 'America/New_York', new Date((start + 3600) * 1000));
    data.splits = [{ at: start - 60, numerator: 10, denominator: 1 }];
    expect(selectSimulationExecution(start + 60, data.sessions, data, start - 86400).reason).toBe('분할·병합 확인 필요');
  });
  it('끝내 제공되지 않는 봉(한국 15시 이후)은 다음 정규장 시가로 체결하고, 그 전에는 대기한다', () => {
    const krStart=Date.parse('2026-10-27T00:00:00Z')/1000, day={start:krStart,end:krStart+23400};
    const next={start:krStart+86400,end:krStart+86400+23400},previous={start:krStart-86400,end:krStart-86400+23400};
    const rows=[{start:krStart+20700,end:krStart+21600,sessionStart:krStart,open:100,close:101}];
    const order=krStart+21900; // 15:05 KST
    expect(selectSimulationExecution(order,[previous,day],{sessions:[previous,day],rows,splits:[]}).reason).toBe('확정 시세 대기');
    const withNext=[...rows,{start:next.start,end:next.start+900,sessionStart:next.start,open:110,close:111}];
    expect(selectSimulationExecution(order,[previous,day,next],{sessions:[previous,day,next],rows:withNext,splits:[]}))
      .toMatchObject({kind:'open',price:110,priceTime:next.start,fallback:'missing_bar'});
  });
  it('시가 전용 선택 시 개장 전은 당일, 개장 후는 다음 거래일 시가를 고른다', () => {
    const next={start:start+86400,end:start+86400+23400},previous={start:start-86400,end:start-86400+23400};
    const data={sessions:[previous,{start,end:start+23400},next],rows:[
      {start,end:start+900,sessionStart:start,open:100,close:101},
      {start:next.start,end:next.start+900,sessionStart:next.start,open:110,close:111},
    ],splits:[]};
    expect(selectSimulationExecution(start-60,data.sessions,data,null,true)).toMatchObject({kind:'open',price:100});
    expect(selectSimulationExecution(start+1,data.sessions,data,null,true)).toMatchObject({kind:'open',price:110});
  });
});
