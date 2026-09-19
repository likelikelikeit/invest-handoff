import { describe, it, expect } from "vitest";
import {
  holdingFromPosition, cashParts, computed, setQty, qtyForWeight, removeHolding, orders, stats, slices,
} from "./portfolio.js";
import { normalize, toMergeRow, krIsin, guessYsym } from "./normalize.js";
import { assignColors, SECTORS } from "./colors.js";

const h = (o) => ({ id: 1, name: "A", tick: "A", mkt: "US", sec: "기타", price: 100, qty: 10, avg: 80, baseQty: 10, baseAvg: 80, realized: 0, ...o });

describe("computed (현금 버퍼 모드)", () => {
  it("총자산은 매매로 변하지 않는다", () => {
    const s0 = { holdings: [h()], removed: [], deposit: 500 };
    const c0 = computed(s0);
    expect(c0.total).toBe(1500);
    expect(c0.cash).toBe(500);
    const s1 = { ...s0, holdings: [setQty(s0.holdings[0], 13)] };
    const c1 = computed(s1);
    expect(c1.total).toBe(1500);
    expect(c1.cash).toBe(200);
  });
  it("현금이 모자라면 음수", () => {
    const s = { holdings: [setQty(h(), 20)], removed: [], deposit: 0 };
    expect(computed(s).cash).toBe(-1000);
  });
  it("지운 종목도 시작 자산과 실현손익에 남는다", () => {
    const s = removeHolding({ holdings: [h()], removed: [], deposit: 0 }, 1);
    const c = computed(s);
    expect(c.total).toBe(1000);
    expect(c.cash).toBe(1000);
    expect(c.realized).toBe(200);
  });
});

describe("setQty", () => {
  it("추가 매수는 평단 가중평균", () => {
    const x = setQty(h(), 20);
    expect(x.avg).toBe(90);
    expect(x.realized).toBe(0);
  });
  it("매도는 평단 유지, 실현손익", () => {
    const x = setQty(h(), 4);
    expect(x.avg).toBe(80);
    expect(x.realized).toBe(120);
  });
  it("음수·NaN은 0", () => expect(setQty(h(), NaN).qty).toBe(0));
  it("원본을 바꾸지 않는다", () => {
    const a = h();
    setQty(a, 20);
    expect(a.qty).toBe(10);
  });
});

describe("qtyForWeight", () => {
  it("비중 → 수량", () => expect(qtyForWeight(10, 10000, 100)).toBe(10));
  it("가격 0이면 0", () => expect(qtyForWeight(10, 10000, 0)).toBe(0));
});

describe("orders", () => {
  it("매수·매도·전량 정리·순현금", () => {
    let s = { holdings: [h({ id: 1 }), h({ id: 2, name: "B", baseQty: 0, qty: 0 })], removed: [], deposit: 0 };
    s = { ...s, holdings: [setQty(s.holdings[0], 5), setQty(s.holdings[1], 3)] };
    const o = orders(s);
    expect(o.list.map((x) => [x.id, x.dq])).toEqual([[1, -5], [2, 3]]);
    expect(o.list[1].isNew).toBe(true);
    expect(o.buy).toBe(300);
    expect(o.sell).toBe(500);
    expect(o.net).toBe(200);
    const g = orders(removeHolding(s, 1));
    expect(g.list.find((x) => x.id === 1).gone).toBe(true);
  });
});

describe("stats", () => {
  it("HHI와 그룹", () => {
    const s = { holdings: [h({ id: 1, mkt: "US", sec: "반도체·AI" }), h({ id: 2, mkt: "KR", sec: "금융" })], removed: [], deposit: 0 };
    const st = stats(s, computed(s));
    expect(Math.round(st.hhi)).toBe(5000);
    expect(st.hhiVerdict).toBe("한쪽으로 쏠림");
    expect(st.byMarket.map((x) => x.key).sort()).toEqual(["국내", "해외"]);
  });
});

describe("holdingFromPosition", () => {
  const pos = { security_id: 7, qty: 2, avg_price: 1000000, avg_ccy: "KRW",
    security: { name: "엔비디아", ticker: "NVDA", market: "US", sector: "반도체·AI", ysym: "NVDA", currency: "USD", brand_color: null } };
  it("달러 시세를 원화로", () => {
    const x = holdingFromPosition(pos, { price: 200, currency: "USD" }, 1400);
    expect(x.price).toBe(280000);
    expect(x.priceNative).toBe(200);
    expect(x.stale).toBe(false);
  });
  it("시세 없으면 평단으로 두고 stale", () => {
    const x = holdingFromPosition(pos, null, 1400);
    expect(x.price).toBe(1000000);
    expect(x.stale).toBe(true);
  });
  it("달러 평단은 환율로", () => {
    const x = holdingFromPosition({ ...pos, avg_price: 100, avg_ccy: "USD" }, { price: 200, currency: "USD" }, 1400);
    expect(x.avg).toBe(140000);
  });
});

describe("cashParts / slices", () => {
  it("통화별 조각", () => {
    const c = cashParts([{ currency: "KRW", amount: 1000 }, { currency: "USD", amount: 10 }], 1400);
    expect(c.total).toBe(15000);
    expect(c.parts.map((p) => p.currency)).toEqual(["KRW", "USD"]);
  });
  it("종목 큰 순 + 현금 끝", () => {
    const colors = new Map([[1, "#111"], [2, "#222"]]);
    const s = slices([h({ id: 1, qty: 1 }), h({ id: 2, qty: 5 })], colors, [{ key: "KRW", label: "원화", value: 50, color: "#ccc" }]);
    expect(s.map((x) => x.id)).toEqual([2, 1, "cash-KRW"]);
  });
});

describe("normalize (기존 index.html과 같은 결과)", () => {
  it("수량이 없으면 평가금액·손익·평단으로 역산", () => {
    const n = normalize({ name: "삼성전자", ticker: "005930", currency: "KRW", avgPrice: 50000, marketValue: 330000, profit: 30000 });
    expect(n.qty).toBe(6);
    expect(n.price).toBe(55000);
    expect(n.mkt).toBe("KR");
    expect(n.ysym).toBe("005930.KS");
  });
  it("달러는 환율로 원화 환산", () => {
    const n = normalize({ name: "NVIDIA", ticker: "nvda", currency: "USD", qty: 2, avgPrice: 100, currentPrice: 150 }, 1400);
    expect(n.avg).toBe(140000);
    expect(n.price).toBe(210000);
    expect(n.tick).toBe("NVDA");
  });
  it("쓸 수 없으면 null", () => expect(normalize({ name: "x" })).toBeNull());
  it("toMergeRow", () => {
    const r = toMergeRow(normalize({ name: "NVIDIA", ticker: "NVDA", qty: 1, avg: 100 }));
    expect(r).toMatchObject({ ticker: "NVDA", market: "US", currency: "USD", avg_ccy: "KRW", qty: 1, avg_price: 100 });
  });
  it("guessYsym", () => {
    expect(guessYsym("000660")).toBe("000660.KS");
    expect(guessYsym("TSLA")).toBe("TSLA");
  });
});

describe("krIsin", () => {
  it("알려진 ISIN과 일치", () => {
    expect(krIsin("005930")).toBe("KR7005930003"); // 삼성전자
    expect(krIsin("000660")).toBe("KR7000660001"); // SK하이닉스
    expect(krIsin("352820")).toBe("KR7352820005"); // 하이브
  });
  it("6자리가 아니면 null", () => expect(krIsin("NVDA")).toBeNull());
});

describe("assignColors", () => {
  it("브랜드색 우선, 같은 섹터는 팔레트를 내려간다", () => {
    const m = assignColors([
      { id: 1, sec: "반도체·AI" }, { id: 2, sec: "반도체·AI" }, { id: 3, sec: "없는섹터" }, { id: 4, sec: "금융", brandColor: "#123456" },
    ]);
    expect(m.get(1)).toBe(SECTORS["반도체·AI"][0]);
    expect(m.get(2)).toBe(SECTORS["반도체·AI"][1]);
    expect(m.get(3)).toBe(SECTORS["기타"][0]);
    expect(m.get(4)).toBe("#123456");
  });
});
