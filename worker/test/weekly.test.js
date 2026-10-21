import { describe, it, expect, vi } from "vitest";
import { makeDb } from "./d1shim.js";

vi.mock("../src/sources/yahoo.js", () => ({
  // globalThis.__yahooFetches만큼 실제로 fetch를 부르는 척한다 (예산 시험용)
  yahooFundamentals: async () => {
    for (let i = 0; i < (globalThis.__yahooFetches || 0); i++) await fetch("https://yahoo.test");
    return {
    financials: [{ period_end: "2026-07-31", period_type: "Q", revenue: 10, operating_income: 2, net_income: 1, eps: 1, bps: 2, ebitda: 3, net_debt: -1, shares_out: 10, raw: "{}", source: "yahoo" }],
    estimates: [{ source: "yahoo", as_of: "2026-09-19", fiscal_year: null, eps: null, revenue: null, target_price: 300, rating_mean: 1.2, n_analysts: 40, raw: "{}" }],
    earningsDate: "2026-11-17",
    };
  },
}));
vi.mock("../src/sources/naver.js", () => ({
  naverFundamentals: async () => ({
    financials: [{ period_end: "2026-06-30", period_type: "Q", revenue: 100, operating_income: 20, net_income: 10, eps: 1, bps: 2, ebitda: null, net_debt: null, shares_out: null, raw: "{}", source: "naver" }],
    estimates: [{ source: "naver", as_of: "2026-09-19", fiscal_year: null, eps: null, revenue: null, target_price: 90000, rating_mean: 4, n_analysts: null, raw: "{}" }],
    earningsDate: null,
  }),
}));
vi.mock("../src/sources/dart.js", () => ({
  dartFundamentals: async () => ({
    financials: [{ period_end: "2026-06-30", period_type: "Q", revenue: 110, operating_income: 22, net_income: 11, eps: null, bps: null, ebitda: null, net_debt: null, shares_out: null, raw: "{}", source: "dart" }],
    estimates: [], earningsDate: null, errors: [],
  }),
}));

const { runWeekly } = await import("../src/cron/weekly.js");

describe("주간 재무 크론", () => {
  it("국내·미국 추적 종목을 갱신하고 DART를 우선해 보고를 남긴다", async () => {
    const env = { DB: makeDb(), DART_API_KEY: "test" };
    const at = "2026-09-19T00:00:00+09:00";
    const ins = env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,dart_corp_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
    ins.run("삼성전자", "005930", "005930.KS", "KR", "KRW", "00126380", at, at);
    ins.run("엔비디아", "NVDA", "NVDA", "US", "USD", null, at, at);
    env.DB.raw.exec("INSERT INTO positions VALUES (5,1,1,'KRW','manual','" + at + "'),(6,1,1,'KRW','manual','" + at + "')");

    const report = await runWeekly(env, new Date("2026-09-19T14:00:00Z"));
    expect(report).toMatchObject({ updated: 2, attempted: 2, total: 2, errors: [] });
    expect(await env.DB.prepare("SELECT revenue,source FROM financials WHERE security_id=5").first()).toEqual({ revenue: 110, source: "dart" });
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM estimates").first()).n).toBe(2);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE kind='earnings'").first()).n).toBe(1);
    expect(JSON.parse((await env.DB.prepare("SELECT value FROM meta WHERE key='cron:weekly'").first()).value).updated).toBe(2);
  });
});

describe("서브요청 예산", () => {
  it("계량기는 fetch와 D1 호출을 세고, 끝나면 원래대로 돌려놓는다", async () => {
    const { meter } = await import("../src/lib/budget.js");
    const env = { DB: makeDb() };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}");
    const m = meter(env);
    await fetch("https://x");
    await env.DB.prepare("SELECT 1").first();
    await env.DB.batch([env.DB.prepare("SELECT 1"), env.DB.prepare("SELECT 2")]);
    expect([m.fetches, m.d1]).toEqual([1, 2]);
    m.restore();
    await env.DB.prepare("SELECT 1").first();
    expect(m.d1).toBe(2);
    globalThis.fetch = realFetch;
  });

  it("예산이 모자라면 남은 종목은 다음 주로 넘기고 커서도 처리한 만큼만 민다", async () => {
    const { fetchCost } = await import("../src/cron/weekly.js");
    expect(fetchCost({ market: "KR" }, true)).toBe(7);
    expect(fetchCost({ market: "US", currency: "USD", financial_currency: "TWD" }, false)).toBe(4);

    const env = { DB: makeDb(), DART_API_KEY: "test" };
    const at = "2026-09-19T00:00:00+09:00";
    const ins = env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?) RETURNING id");
    for (let i = 0; i < 8; i++) {
      const id = ins.get("미국" + i, "U" + i, "U" + i, "US", "USD", at, at).id;
      env.DB.raw.prepare("INSERT INTO positions VALUES (?,1,1,'USD','manual',?)").run(id, at);
    }
    // 종목마다 외부 요청을 10번씩 쓰게 하면 예산(44) 안에서 몇 종목 만에 멈춰야 한다
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}");
    globalThis.__yahooFetches = 10;
    try {
      const report = await runWeekly(env, new Date("2026-09-19T14:00:00Z"));
      expect(report.attempted).toBeGreaterThan(0);
      expect(report.attempted).toBeLessThan(8);
      expect(report.subrequests).toBe(report.attempted * 10);
      const cursor = await env.DB.prepare("SELECT value FROM meta WHERE key='cron:weekly:cursor'").first();
      expect(Number(cursor.value)).toBe(report.attempted);   // 못 한 종목부터 다음 주에
    } finally {
      globalThis.fetch = realFetch;
      globalThis.__yahooFetches = 0;
    }
  });
});
