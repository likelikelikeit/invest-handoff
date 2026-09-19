import { describe, it, expect } from "vitest";
import { mount, flushSync } from "svelte";
import Fundamentals from "./Fundamentals.svelte";

describe("Fundamentals 스모크", () => {
  it("분기 재무와 컨센서스를 한국어로 표시한다", () => {
    const target = document.createElement("div");
    mount(Fundamentals, { target, props: {
      id: 1,
      payload: {
        security: { currency: "KRW" },
        financials: [{ period_end: "2026-06-30", period_type: "Q", revenue: 100000000, eps: 1200, source: "naver", fetched_at: "2026-09-19T00:00:00+09:00" }],
        estimates: [{ id: 1, source: "naver", as_of: "2026-09-19", fiscal_year: null, target_price: 90000, rating_mean: 4 }],
      },
    } });
    flushSync();
    expect(target.textContent).toContain("100,000,000원");
    expect(target.textContent).toContain("목표가·의견");
    expect(target.textContent).toContain("90,000원");
    expect(target.textContent).toContain("높을수록 매수");
  });
});
