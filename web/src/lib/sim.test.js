import { describe, it, expect, beforeEach } from "vitest";
import * as S from "./sim.svelte.js";
import { data } from "./data.svelte.js";
import { computed, orders } from "./calc/portfolio.js";

const real = [
  { id: 1, name: "A", tick: "A", mkt: "KR", sec: "기타", ysym: "A.KS", currency: "KRW", price: 100, priceNative: 100, qty: 10, avg: 80 },
  { id: 2, name: "B", tick: "B", mkt: "US", sec: "기타", ysym: "B", currency: "USD", price: 1000, priceNative: 1, qty: 1, avg: 900 },
];

describe("sim (연습장)", () => {
  beforeEach(() => {
    localStorage.clear();
    data.quotes = {};
    data.fx = 1000;
    S.stop();
    S.start(real, 500);
  });

  it("시작하면 base = 실제 보유, 현금 = 실제 현금", () => {
    const c = computed(S.resolvedState());
    expect(c.total).toBe(10 * 100 + 1000 + 500);
    expect(c.cash).toBe(500);
  });

  it("매수는 현금을 쓰고 주문서에 잡힌다", () => {
    S.setQty(1, 13);
    const st = S.resolvedState();
    expect(computed(st).cash).toBe(200);
    expect(orders(st).list[0]).toMatchObject({ id: 1, dq: 3 });
  });

  it("슬라이더 snap: 미리보기는 평단을 안 바꾸고, 확정 때 한 번만 계산", () => {
    const h = S.sim.holdings.find((x) => x.id === 1);
    const snap = { qty: h.qty, avg: h.avg, realized: h.realized };
    S.previewQty(1, 5);
    S.previewQty(1, 20);
    expect(S.sim.holdings.find((x) => x.id === 1).avg).toBe(80);
    S.commitQty(1, snap, 20);
    const after = S.sim.holdings.find((x) => x.id === 1);
    expect(after.qty).toBe(20);
    expect(after.avg).toBe(90); // (10*80 + 10*100) / 20
  });

  it("시세가 들어오면 가격이 따라간다 (달러는 환율)", () => {
    data.quotes = { B: { price: 2, currency: "USD" } };
    const b = S.resolvedState().holdings.find((x) => x.id === 2);
    expect(b.price).toBe(2000);
  });

  it("직접 입력한 현재가가 시세보다 우선", () => {
    data.quotes = { "A.KS": { price: 150, currency: "KRW" } };
    S.setManualPrice(1, 120);
    expect(S.resolvedState().holdings.find((x) => x.id === 1).price).toBe(120);
  });

  it("매수 시뮬 신규 종목은 baseQty 0, 주문서에 신규", () => {
    S.buyNew({ name: "C", tick: "C", mkt: "US", ysym: "C", sec: "기타", price: 50, avg: 50, qty: 2 });
    const o = orders(S.resolvedState()).list.find((x) => x.name === "C");
    expect(o.isNew).toBe(true);
    expect(o.dq).toBe(2);
  });

  it("제거는 전량 매도: 시작 자산 유지, 현금 증가", () => {
    S.remove(2);
    const c = computed(S.resolvedState());
    expect(c.total).toBe(2500);
    expect(c.cash).toBe(1500);
  });

  it("새로고침해도 유지(기기 임시 저장)", () => {
    S.setQty(1, 11);
    const saved = JSON.parse(localStorage.getItem("invest.sim"));
    expect(saved.active).toBe(true);
    expect(saved.holdings.find((x) => x.id === 1).qty).toBe(11);
  });
});
