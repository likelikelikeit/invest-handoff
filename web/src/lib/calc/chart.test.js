import { describe, it, expect } from "vitest";
import { sliceRange, availableRanges, periodChange, range52w, volumeStats } from "./chart.js";

// 2021-09-20부터 하루씩, n일
function days(n, start = "2021-09-20", f = (i) => 100 + i) {
  const t0 = new Date(start + "T00:00:00Z").getTime();
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return [new Date(t0 + i * 86400000).toISOString().slice(0, 10), c, c + 1, c - 1, c, 1000 + i];
  });
}

describe("sliceRange", () => {
  it("마지막 날짜 기준 1년", () => {
    const rows = days(800);
    const s = sliceRange(rows, "1y");
    expect(s[s.length - 1][0]).toBe(rows[rows.length - 1][0]);
    expect(s.length).toBeGreaterThanOrEqual(365);
    expect(s.length).toBeLessThanOrEqual(367);
  });
  it("빈 배열", () => expect(sliceRange([], "1y")).toEqual([]));
});

describe("availableRanges", () => {
  it("5년치면 10Y는 꺼진다", () => {
    const a = availableRanges(days(5 * 365 + 2));
    expect(a.has("5y")).toBe(true);
    expect(a.has("10y")).toBe(false);
  });
  it("막 상장(40일)이면 1M만", () => {
    const a = availableRanges(days(40));
    expect([...a]).toEqual(["1m", "3m"].filter((k) => a.has(k)));
    expect(a.has("1m")).toBe(true);
    expect(a.has("1y")).toBe(false);
  });
});

describe("periodChange", () => {
  it("첫 종가 대비", () => {
    expect(periodChange([["a", 0, 0, 0, 100, 0], ["b", 0, 0, 0, 110, 0]])).toEqual({ abs: 10, pct: 10.000000000000009 });
  });
});

describe("range52w", () => {
  it("1년 고가·저가와 위치", () => {
    const rows = days(400, "2025-08-01", (i) => (i < 200 ? 50 : 150));
    const r = range52w(rows, 100);
    expect(r.low).toBe(49);
    expect(r.high).toBe(151);
    expect(r.pos).toBeCloseTo(51 / 102);
  });
  it("현재가가 범위를 넘으면 범위를 넓힌다", () => {
    const r = range52w(days(10), 500);
    expect(r.high).toBe(500);
    expect(r.pos).toBe(1);
  });
});

describe("volumeStats", () => {
  it("최근 거래량 / 직전 20일 평균", () => {
    const rows = days(30);
    const v = volumeStats(rows);
    expect(v.last).toBe(1029);
    expect(v.avg20).toBe((1009 + 1028) / 2);
  });
});
