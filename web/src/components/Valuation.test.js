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
      currency: "USD", eps: n, revenue: n * 1000000, bps: 50 + n, shares_out: 1000, ebitda: n * 200000, net_debt: 100000,
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

  it("재무 통화나 ADR 단위가 정규화되지 않으면 밸류에이션 계산을 막는다", () => {
    const target = document.createElement("div");
    mount(Valuation, { target, props: {
      id: 3,
      sec: { id: 3, currency: "USD", financial_currency: "TWD", adr_ratio: 5, band_default: "per" },
      payload: { security: { valuation_ready: false, financial_currency: "TWD", adr_ratio: 5 }, financials: [] },
      quote: { price: 477.57 }, initialPrices: [], initialScenarios: [],
    } });
    flushSync();
    expect(target.textContent).toContain("통화·주식 단위 환산이 필요합니다");
    expect(target.textContent).toContain("재무는 TWD, 주가는 USD 기준");
    expect(target.textContent).toContain("ADR 1주는 보통주 5주");
    expect(target.textContent).not.toContain("이 가정으로 의견 기록");
  });

  it("ADR 재무의 최신 분기가 USD로 정규화되면 밸류에이션을 다시 연다", () => {
    const financials = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].map((period_end) => ({
      period_end, period_type: "Q", currency: "USD", eps: 2, bps: 30, revenue: 100, shares_out: 10,
    }));
    const target = document.createElement("div");
    mount(Valuation, { target, props: {
      id: 3,
      sec: { id: 3, currency: "USD", financial_currency: "TWD", adr_ratio: 5, valuation_ready: false, band_default: "per" },
      payload: { security: { valuation_ready: true, financial_currency: "TWD", adr_ratio: 5 }, financials, estimates: [] },
      quote: { price: 100 }, initialPrices: [], initialScenarios: [],
    } });
    flushSync();
    expect(target.textContent).toContain("주가 밴드");
    expect(target.textContent).not.toContain("통화·주식 단위 환산이 필요합니다");
  });
});
