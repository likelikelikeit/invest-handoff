import { describe, it, expect } from "vitest";
import { labelTone, actionLabel, afterReturn, INDICATOR_INFO, LABEL_TEXT } from "./tech.js";

describe("판정 표시", () => {
  it("신호등 색: 매도는 의미가 뒤집힌다", () => {
    expect(labelTone("buy", "high")).toBe("red"); // 단기 과열
    expect(labelTone("buy", "low")).toBe("green"); // 진입 부담 낮음
    expect(labelTone("sell", "low")).toBe("green"); // 청산 부담 낮음
    expect(labelTone("sell", "high")).toBe("red"); // 단기 침체
    expect(labelTone("sell", "neutral")).toBe("amber");
    expect(LABEL_TEXT.sell.low).toBe("청산 부담 낮음");
  });
  it("행동 문구는 매수·매도에 맞게", () => {
    expect(actionLabel("buy", "partial")).toBe("나눠 샀다");
    expect(actionLabel("sell", "bought")).toBe("팔았다");
    expect(actionLabel("buy", null)).toBeNull();
  });
  it("1주·1개월 뒤 수익률은 사실만", () => {
    expect(afterReturn({ price_at: 100, price_1w: 110 }, "price_1w")).toBeCloseTo(10);
    expect(afterReturn({ price_at: 100, price_1m: null }, "price_1m")).toBeNull();
  });
  it("지표 값 표기", () => {
    expect(INDICATOR_INFO.dev20.fmt(0.0523)).toBe("+5.2%");
    expect(INDICATOR_INFO.vol_ratio.fmt(2.34)).toBe("2.3배");
  });
});
