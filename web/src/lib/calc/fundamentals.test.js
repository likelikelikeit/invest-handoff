import { describe, it, expect } from "vitest";
import { financialPeriods, availableMetrics, metricSeries, latestTarget, sourceLabel } from "./fundamentals.js";

describe("재무 화면 계산", () => {
  const rows = [
    { period_end: "2025-12-31", period_type: "FY", revenue: 30, eps: 3 },
    { period_end: "2026-06-30", period_type: "Q", revenue: 20, eps: 2 },
    { period_end: "2026-03-31", period_type: "Q", revenue: 10, eps: 1 },
  ];

  it("기간을 나누고 오래된→최신 순으로 정렬한다", () => {
    expect(financialPeriods(rows, "Q").map((r) => r.period_end)).toEqual(["2026-03-31", "2026-06-30"]);
  });

  it("값이 있는 지표와 차트 점만 만든다", () => {
    const q = financialPeriods(rows, "Q");
    expect(availableMetrics(q).map((m) => m.key)).toEqual(["revenue", "eps"]);
    expect(metricSeries(q, "revenue")).toEqual([{ date: "2026-03-31", value: 10 }, { date: "2026-06-30", value: 20 }]);
  });

  it("국내는 네이버, 해외는 Yahoo 목표가를 우선한다", () => {
    const est = [{ source: "yahoo", target_price: 2 }, { source: "naver", target_price: 1 }];
    expect(latestTarget(est, "KR").source).toBe("naver");
    expect(latestTarget(est, "US").source).toBe("yahoo");
    expect(sourceLabel("dart")).toBe("DART");
  });
});
