import { describe, it, expect, vi } from "vitest";
import { makeDb } from "./d1shim.js";

vi.mock("../src/sources/yahoo.js", () => ({
  yahooFundamentals: async () => ({
    financials: [{ period_end: "2026-07-31", period_type: "Q", revenue: 10, operating_income: 2, net_income: 1, eps: 1, bps: 2, ebitda: 3, net_debt: -1, shares_out: 10, raw: "{}", source: "yahoo" }],
    estimates: [{ source: "yahoo", as_of: "2026-09-19", fiscal_year: null, eps: null, revenue: null, target_price: 300, rating_mean: 1.2, n_analysts: 40, raw: "{}" }],
    earningsDate: "2026-11-17",
  }),
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
