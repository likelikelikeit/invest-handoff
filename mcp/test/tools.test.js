import { describe, it, expect, beforeEach } from "vitest";
import { TOOL_BY_NAME } from "../src/mcp.js";
import { seed, env as makeEnv, dayAgo } from "./seed.js";

let env;
const run = (name, args = {}) => TOOL_BY_NAME.get(name).run(env, args);

beforeEach(() => {
  env = makeEnv(seed().db);
});

describe("get_portfolio", () => {
  it("원화 환산·비중·손익을 코드가 계산해 준다", async () => {
    const r = await run("get_portfolio");
    expect(r.fx_usdkrw.rate).toBe(1300);

    const nvda = r.positions.find((p) => p.ticker === "NVDA");
    expect(nvda.qty).toBe(10);
    expect(nvda.last_price).toBeCloseTo(120, 6);
    expect(nvda.value_krw).toBe(1560000); // 10주 × 120달러 × 1300
    expect(nvda.return_pct).toBe(20);
    expect(nvda.last_price_date).toBe(dayAgo(0));

    const sam = r.positions.find((p) => p.ticker === "005930");
    expect(sam.value_krw).toBe(7000000);
    expect(sam.return_pct).toBeCloseTo(16.7, 1);

    expect(r.total.stock_krw).toBe(8560000);
    expect(r.total.cash_krw).toBe(1000000);
    expect(r.total.total_krw).toBe(9560000);
    // 비중은 현금 포함 총자산 기준
    expect(nvda.weight_pct).toBeCloseTo(16.3, 1);
    expect(r.sector_krw["반도체·AI"]).toBe(8560000);
    expect(r.price_basis).toContain("지연");
  });

  it("환율·지수는 보유가 아니므로 나오지 않는다", async () => {
    const r = await run("get_portfolio");
    expect(r.positions.map((p) => p.ticker)).not.toContain("USDKRW");
  });
});

describe("get_investment_views", () => {
  it("기본은 종목별 현재 의견", async () => {
    const r = await run("get_investment_views");
    expect(r.views).toHaveLength(2);
    expect(r.views.find((v) => v.ticker === "NVDA").rating).toBe("적극 매수");
    expect(r.views[0].upside_at_record_pct).toBeDefined();
    expect(r.rule).toContain("덮어쓰지 않는");
  });

  it("종목을 주면 이력 전부와 평가 요약을 준다", async () => {
    const r = await run("get_investment_views", { ticker: "엔비디아" });
    expect(r.views).toHaveLength(2);
    expect(r.views[0].created_at > r.views[1].created_at).toBe(true); // 최신 먼저
    expect(r.evaluated_summary.n).toBe(1);
    expect(r.evaluated_summary.hit_rate_pct).toBe(100);
    const done = r.views.find((v) => v.evaluation);
    expect(done.evaluation.actual_return_pct).toBe(20);
    expect(done.evaluation.target_return_pct).toBe(50);
  });

  it("없는 종목이면 등록된 종목을 알려준다", async () => {
    await expect(run("get_investment_views", { ticker: "없는회사" })).rejects.toThrow(/엔비디아/);
  });
});

describe("get_company_view", () => {
  it("시세·보유·TTM·밸류에이션·의견·판정·일정을 한 장에", async () => {
    const r = await run("get_company_view", { ticker: "NVDA" });
    expect(r.security.name).toBe("엔비디아");
    expect(r.price.close).toBeCloseTo(120, 6);
    expect(r.price.high_52w).toBeCloseTo(121.2, 1);
    expect(r.price.position_in_52w_pct).toBeGreaterThan(90);
    expect(r.position.qty).toBe(10);
    expect(r.position.value_krw).toBe(1560000);

    expect(r.ttm.eps).toBeCloseTo(4.6, 6); // 최근 4개 분기 합
    expect(r.valuation.per_ttm).toBeCloseTo(26.09, 2);
    expect(r.valuation.pbr).toBeCloseTo(6, 6);

    expect(r.estimates[0].target_price).toBe(160);
    expect(r.views).toHaveLength(2);
    expect(r.recent_tech_calls[0].label).toBe("low");
    expect(r.upcoming_events).toHaveLength(1);
  });

  it("분기가 4개 미만이면 TTM을 비운다", async () => {
    const r = await run("get_company_view", { ticker: "005930" });
    expect(r.ttm).toBeNull();
    expect(r.valuation.per_ttm).toBeNull();
    expect(r.position.qty).toBe(100);
  });
});

describe("get_calendar", () => {
  it("기본은 오늘부터 30일", async () => {
    const r = await run("get_calendar");
    const titles = r.events.map((e) => e.title);
    expect(titles).toContain("엔비디아 실적 발표");
    expect(titles).toContain("FOMC 결과 발표");
    expect(titles).not.toContain("먼 미래 일정"); // 100일 뒤
    expect(r.events.every((e) => e.date >= r.from && e.date <= r.to)).toBe(true);
    expect(r.events.find((e) => e.title === "엔비디아 실적 발표").security.ticker).toBe("NVDA");
    expect(r.timezone).toContain("KST");
  });

  it("기간을 넓히면 먼 일정도 나온다", async () => {
    const r = await run("get_calendar", { from: dayAgo(0), to: dayAgo(-200) });
    expect(r.events.map((e) => e.title)).toContain("먼 미래 일정");
  });

  it("거꾸로 된 기간은 막는다", async () => {
    await expect(run("get_calendar", { from: "2026-09-20", to: "2026-09-01" })).rejects.toThrow(/빠릅니다/);
  });
});

describe("get_macro", () => {
  it("최신값과 1년 전 대비, 점도표를 준다", async () => {
    const r = await run("get_macro");
    const ff = r.series.find((s) => s.series_id === "FEDFUNDS");
    expect(ff.latest.value).toBe(4);
    expect(ff.year_ago.value).toBe(5);
    expect(ff.change_1y).toBe(-1);
    expect(r.fed_dots.meeting).toBe("2026-09");
    expect(r.fed_dots.median_by_year["2026"]).toBe(3.6);
    expect(r.fed_dots.long_run).toBe(3);
  });
});

describe("get_tech_calls", () => {
  it("판정과 그 뒤 가격, 그리고 섞지 말라는 규칙을 같이 준다", async () => {
    const r = await run("get_tech_calls");
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].change_1w_pct).toBe(5);
    expect(r.calls[0].change_1m_pct).toBe(10);
    expect(r.calls[0].indicators[0].key).toBe("rsi14");
    expect(r.rule).toContain("예측형");
  });

  it("종목으로 거를 수 있다", async () => {
    expect((await run("get_tech_calls", { ticker: "005930" })).calls).toHaveLength(0);
  });
});
