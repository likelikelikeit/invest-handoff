import { describe, it, expect } from "vitest";
import { nearestMonthEnd, quarterlyFromFacts, secFinancialRows, pickFacts, SEC_CONCEPTS, splitFactor } from "../src/sources/sec.js";

describe("nearestMonthEnd", () => {
  it("회계일을 가까운 월말로 (야후와 같은 키)", () => {
    expect(nearestMonthEnd("2026-07-26")).toBe("2026-07-31");
    expect(nearestMonthEnd("2025-10-26")).toBe("2025-10-31");
    expect(nearestMonthEnd("2025-10-03")).toBe("2025-09-30");
    expect(nearestMonthEnd("2024-03-02")).toBe("2024-02-29");
    expect(nearestMonthEnd("2025-12-31")).toBe("2025-12-31");
  });
});

const f = (start, end, val, filed = "2026-01-01") => ({ start, end, val, filed });

describe("quarterlyFromFacts", () => {
  it("분기 사실은 그대로, 4분기는 연간 − 세 분기", () => {
    const facts = [
      f("2025-01-27", "2025-04-27", 0.76), f("2025-04-28", "2025-07-27", 1.08),
      f("2025-07-28", "2025-10-26", 1.3), f("2025-01-27", "2025-10-26", 3.14), // 9개월 누적은 무시
      f("2025-01-27", "2026-01-25", 4.9),
    ];
    const m = quarterlyFromFacts(facts);
    expect([...m.keys()]).toEqual(["2025-04-30", "2025-07-31", "2025-10-31", "2026-01-31"]);
    expect(m.get("2026-01-31")).toBeCloseTo(1.76);
  });
  it("정정 공시가 있으면 늦게 제출된 값", () => {
    const m = quarterlyFromFacts([f("2025-01-01", "2025-03-31", 1, "2025-05-01"), f("2025-01-01", "2025-03-31", 2, "2026-02-01")]);
    expect(m.get("2025-03-31")).toBe(2);
  });
  it("세 분기가 다 없으면 4분기를 만들지 않는다", () => {
    const m = quarterlyFromFacts([f("2025-01-01", "2025-03-31", 1), f("2025-01-01", "2025-12-31", 10)]);
    expect(m.has("2025-12-31")).toBe(false);
  });
});

describe("주식분할 보정", () => {
  const splits = [{ date: "2021-07-20", ratio: 4 }, { date: "2024-06-10", ratio: 10 }];
  it("제출일 뒤의 분할만 곱한다", () => {
    expect(splitFactor("2021-05-01", splits)).toBe(40);
    expect(splitFactor("2023-05-01", splits)).toBe(10);
    expect(splitFactor("2025-05-01", splits)).toBe(1);
  });
  it("분할 전후 제출분이 섞여도 같은 기준으로 맞추고, 4분기 파생도 맞춘 값으로", () => {
    // 엔비디아 FY2024(2023-01-30 ~ 2024-01-28): 분기는 분할 전 제출, 연간은 분할 뒤 재표시분
    const facts = [
      f("2023-01-30", "2023-04-30", 0.82, "2023-05-26"),
      f("2023-05-01", "2023-07-30", 2.48, "2023-08-28"),
      f("2023-07-31", "2023-10-29", 3.71, "2023-11-22"),
      f("2023-01-30", "2024-01-28", 1.19, "2025-02-26"),
    ];
    const m = quarterlyFromFacts(facts, { splits, perShare: true });
    expect(m.get("2023-04-30")).toBeCloseTo(0.082);
    expect(m.get("2023-10-31")).toBeCloseTo(0.371);
    expect(m.get("2024-01-31")).toBeCloseTo(1.19 - 0.082 - 0.248 - 0.371);
  });
  it("주당 값이 아니면 보정하지 않는다", () => {
    const m = quarterlyFromFacts([f("2023-01-01", "2023-03-31", 100, "2020-01-01")], { splits, perShare: false });
    expect(m.get("2023-03-31")).toBe(100);
  });
});

describe("secFinancialRows / pickFacts", () => {
  it("EPS 있는 분기만 행으로, 다른 항목은 같은 월말로 붙인다", () => {
    const rows = secFinancialRows({
      eps: new Map([["2025-07-31", 1.08], ["2025-04-30", 0.76]]),
      revenue: new Map([["2025-07-31", 46700000000]]),
    });
    expect(rows.map((r) => r.period_end)).toEqual(["2025-04-30", "2025-07-31"]);
    expect(rows[1]).toMatchObject({ period_type: "Q", source: "sec", eps: 1.08, revenue: 46700000000, net_income: null });
  });
  it("태그 중 데이터가 있는 첫 번째", () => {
    const resp = { Revenues: { units: { USD: [] } }, RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [f("a", "b", 1)] } } };
    expect(pickFacts(resp, SEC_CONCEPTS.revenue)).toHaveLength(1);
  });
});
