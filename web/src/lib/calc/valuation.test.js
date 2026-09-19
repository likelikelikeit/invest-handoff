import { describe, it, expect } from "vitest";
import {
  ttmSeries, consecutiveQuarters, dailyMultiples, quantile, cleanMultiple, suggestedMultiples,
  valueFromGrowth, growthFromValue, scenarioTarget, bandPrice, roundValue,
} from "./valuation.js";

// 실제 분기 말 (2024-12-31 ~ 2025-12-31)
const ENDS = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
const quarters = [1, 2, 3, 4, 5].map((n) => ({
  period_end: ENDS[n - 1], period_type: "Q",
  eps: n, revenue: n * 100, ebitda: n * 20, bps: 50 + n, shares_out: 10, net_debt: 20,
}));

describe("밸류에이션 순수 계산", () => {
  it("네 분기를 TTM으로 합치고 기말 항목은 마지막 값을 쓴다", () => {
    const rows = ttmSeries(quarters);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ eps: 10, revenue: 1000, ebitda: 200, bps: 54, shares: 10, revenue_per_share: 100 });
    expect(rows[1].eps).toBe(14);
  });

  it("빠진 분기가 있으면 그 자리의 TTM은 만들지 않는다", () => {
    const gap = quarters.filter((q) => q.period_end !== "2025-06-30");
    expect(ttmSeries(gap)).toHaveLength(0);
    expect(consecutiveQuarters(quarters.slice(0, 4))).toBe(true);
    expect(consecutiveQuarters([quarters[0], quarters[1], quarters[3], quarters[4]])).toBe(false);
  });

  it("일봉에 당시 TTM을 붙여 PER 시계열을 만든다", () => {
    const ttm = ttmSeries(quarters);
    const prices = [["2025-09-29", 0, 0, 0, 100], ["2025-09-30", 0, 0, 0, 200], ["2026-01-05", 0, 0, 0, 280]];
    const rows = dailyMultiples(prices, ttm, "per");
    expect(rows.map((x) => x.multiple)).toEqual([20, 20]);
  });

  it("분위수와 깔끔한 추천 배수를 계산한다", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(cleanMultiple(4.74)).toBe(4.5);
    expect(cleanMultiple(8.7)).toBe(9);
    expect(suggestedMultiples([10, 20, 30, 40, 50].map((multiple) => ({ multiple })))).toEqual([14, 20, 30, 40, 46]);
  });

  it("직접 값과 성장률을 양방향으로 바꾸고 시나리오 목표가를 계산한다", () => {
    expect(valueFromGrowth(10, 21, 2)).toBeCloseTo(14.641);
    expect(growthFromValue(10, 14.641, 2)).toBeCloseTo(21, 3);
    expect(scenarioTarget({ metric: "per", value: 12, multiple: 20 })).toBe(240);
    expect(scenarioTarget({ metric: "ev_ebitda", value: 1000, multiple: 8, net_debt: 2000, shares: 100 })).toBe(60);
    expect(bandPrice({ eps: 12 }, "per", 20)).toBe(240);
    expect(roundValue(7.91 * 1.2, "per")).toBe(9.492);
    expect(roundValue(1234567.89, "ev_ebitda")).toBe(1234568);
  });
});
