import { describe, it, expect } from "vitest";
import { normalize, snapInteger, guessYsym, num } from "./normalize.js";

describe("snapInteger", () => {
  it("나눗셈 찌꺼기는 정수로 맞춘다", () => {
    expect(snapInteger(15.999968)).toBe(16);
    expect(snapInteger(6.000007)).toBe(6);
    expect(snapInteger(0.999994)).toBe(1);
  });

  it("진짜 소수점 보유는 건드리지 않는다", () => {
    expect(snapInteger(4.134)).toBe(4.134);
    expect(snapInteger(0.065)).toBe(0.065);
    expect(snapInteger(0.000769)).toBe(0.000769);
    expect(snapInteger(0.083453)).toBe(0.083453);
  });
});

describe("normalize 수량 역산", () => {
  const base = { name: "쿠팡", tick: "CPNG", currency: "USD" };

  it("수량이 없으면 평가금액·평단으로 역산하고 정수로 정리한다", () => {
    // 16주 × 33,423원 = 534,768원 (평가손익 0)
    const n = normalize({ ...base, marketValue: 534768, avgPrice: 33423, currentPrice: 33423 }, 1);
    expect(n.qty).toBe(16);
  });

  it("손익이 섞여도 원가 기준으로 역산한다", () => {
    const n = normalize({ ...base, marketValue: 600000, profit: 65232, avgPrice: 33423, currentPrice: 37500 }, 1);
    expect(n.qty).toBe(16);
  });

  it("소수점 보유는 역산해도 그대로 둔다", () => {
    const n = normalize({ ...base, marketValue: 16128, avgPrice: 248047, currentPrice: 248047 }, 1);
    expect(n.qty).toBeCloseTo(0.065, 4);   // 정수로 끌려가지 않는다
  });

  it("화면에 수량이 있으면 그 값을 쓴다", () => {
    expect(normalize({ ...base, qty: 4.134, avgPrice: 187057, currentPrice: 200000 }, 1).qty).toBe(4.134);
  });
});

describe("보조 함수", () => {
  it("6자리 코드는 국내 심볼로", () => {
    expect(guessYsym("005930")).toBe("005930.KS");
    expect(guessYsym("NVDA")).toBe("NVDA");
  });

  it("콤마·단위가 붙은 숫자도 읽는다", () => {
    expect(num("1,234원")).toBe(1234);
    expect(num("")).toBe(0);
  });
});
