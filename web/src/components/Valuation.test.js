import { describe, it, expect, vi } from "vitest";
import { mount, flushSync } from "svelte";

vi.mock("lightweight-charts", () => {
  const series = () => ({ setData() {} });
  return {
    AreaSeries: "area", LineSeries: "line", ColorType: { Solid: "solid" },
    CrosshairMode: { Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    createChart: () => ({
      addSeries: series, removeSeries() {}, applyOptions() {}, subscribeCrosshairMove() {},
      timeScale: () => ({ fitContent() {}, coordinateToLogical: () => 0 }),
      setCrosshairPosition() {}, clearCrosshairPosition() {}, remove() {},
    }),
  };
});

const Valuation = (await import("./Valuation.svelte")).default;

describe("Valuation 스모크", () => {
  it("두 밴드 형태와 base 의견 기록 동선을 한국어로 표시한다", () => {
    const ends = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
    const financials = [1, 2, 3, 4, 5].map((n) => ({
      period_end: ends[n - 1], period_type: "Q",
      eps: n, revenue: n * 1000000, bps: 50 + n, shares_out: 1000, ebitda: n * 200000, net_debt: 100000,
    }));
    const prices = [
      ["2025-09-30", 90, 110, 80, 100, 1],
      ["2026-01-05", 100, 130, 95, 120, 1],
    ];
    const target = document.createElement("div");
    mount(Valuation, { target, props: {
      id: 1,
      sec: { id: 1, currency: "USD", band_default: "per", band_multiples: { per: [5, 10, 15, 20, 25] } },
      payload: { financials, estimates: [{ fiscal_year: 2026, eps: 20 }] },
      quote: { price: 120 }, initialPrices: prices, initialScenarios: [],
    } });
    flushSync();
    expect(target.textContent).toContain("주가 밴드");
    expect(target.textContent).toContain("멀티플 분위");
    expect(target.textContent).toContain("내 가정");
    expect(target.textContent).toContain("이 가정으로 의견 기록");
    expect(target.querySelector('[aria-label="목표 배수"]')).toBeTruthy();
  });
});
