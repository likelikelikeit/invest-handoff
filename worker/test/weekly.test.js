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
vi.mock("../src/sources/kind.js", async (orig) => ({
  ...(await orig()),
  // KIND IR 일정: 10/21 3분기 실적 발표 확정 (DART 예상 10/8과 ±20일 안이라 예상은 빠져야 한다)
  kindIrSchedule: async () => [
    { title: "BNK 2026 Corporate Day 참석", place: "여의도", date: "2026-10-01", time: "10:00" },
    { title: "Q3 2026 Earnings Release", place: "-", date: "2026-10-21", time: "16:00" },
    { title: "2026년 3분기 경영실적 발표", place: "-", date: "2026-10-21", time: "16:00" },
  ],
}));
vi.mock("../src/sources/dart.js", async (orig) => ({
  ...(await orig()),
  // 작년 10/8에 3분기 잠정실적 공시 → 올해 예상일 10/8(목)
  dartDisclosures: async () => [{ report_nm: "연결재무제표기준영업(잠정)실적(공정공시)", rcept_dt: "2025-10-08", rcept_no: "1" }],
  dartFundamentals: async () => ({
    financials: [{ period_end: "2026-06-30", period_type: "Q", revenue: 110, operating_income: 22, net_income: 11, eps: null, bps: null, ebitda: null, net_debt: null, shares_out: null, raw: "{}", source: "dart" }],
    estimates: [], earningsDate: null, errors: [],
  }),
}));

const { rotateFundamentals } = await import("../src/cron/weekly.js");

describe("재무 순환", () => {
  it("국내·미국 추적 종목을 갱신하고 DART를 우선해 보고를 남긴다", async () => {
    const env = { DB: makeDb(), DART_API_KEY: "test", DART_IN_WORKER: "1" };
    const at = "2026-09-19T00:00:00+09:00";
    const ins = env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,dart_corp_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
    ins.run("삼성전자", "005930", "005930.KS", "KR", "KRW", "00126380", at, at);
    ins.run("엔비디아", "NVDA", "NVDA", "US", "USD", null, at, at);
    env.DB.raw.exec("INSERT INTO positions VALUES (5,1,1,'KRW','manual','" + at + "'),(6,1,1,'KRW','manual','" + at + "')");

    // KST 9/18(금): 삼성(id 5)은 5 % 7 = 금요일이라 이번 순환에서 DART도 본다
    const report = await rotateFundamentals(env, new Date("2026-09-18T14:00:00Z"));
    expect(report).toMatchObject({ updated: 2, attempted: 2, total: 2, done: true, errors: [] });
    expect(await env.DB.prepare("SELECT revenue,source FROM financials WHERE security_id=5").first()).toEqual({ revenue: 110, source: "dart" });
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM estimates").first()).n).toBe(2);
    const ev = env.DB.raw.prepare("SELECT security_id, date, title, source, confirmed FROM events WHERE kind='earnings' ORDER BY security_id").all();
    expect(ev).toEqual([
      { security_id: 5, date: "2026-10-21", title: "실적 발표", source: "kind", confirmed: 1 },          // 국내: KIND IR 확정 (DART 예상 10/8은 빠짐)
      { security_id: 6, date: "2026-11-17", title: "실적 발표 예정", source: "yahoo", confirmed: null }, // 미국: 야후
    ]);
    expect(JSON.parse((await env.DB.prepare("SELECT value FROM meta WHERE key='cron:fund'").first()).value)).toMatchObject({ updated_today: 2, done: true });
    // 그날 한 바퀴를 다 돌았으면 다음 틱은 아무것도 하지 않는다
    expect(await rotateFundamentals(env, new Date("2026-09-18T14:05:00Z"))).toMatchObject({ attempted: 0, done: true });
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
    expect([m.fetches, m.d1]).toEqual([1, 3]);   // batch는 문장 수만큼 센다
    m.restore();
    await env.DB.prepare("SELECT 1").first();
    expect(m.d1).toBe(3);
    globalThis.fetch = realFetch;
  });

  it("예산이 모자라면 남은 종목은 다음 틱이 이어서 하고, 날이 바뀌면 처음부터", async () => {
    const { fetchCost } = await import("../src/cron/weekly.js");
    expect(fetchCost({ market: "KR" }, true)).toBe(8);
    expect(fetchCost({ market: "US", currency: "USD", financial_currency: "TWD" }, false)).toBe(4);

    const env = { DB: makeDb(), DART_API_KEY: "test", DART_IN_WORKER: "1" };
    const at = "2026-09-19T00:00:00+09:00";
    const ins = env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?) RETURNING id");
    for (let i = 0; i < 8; i++) {
      const id = ins.get("미국" + i, "U" + i, "U" + i, "US", "USD", at, at).id;
      env.DB.raw.prepare("INSERT INTO positions VALUES (?,1,1,'USD','manual',?)").run(id, at);
    }
    // 종목마다 외부 요청을 10번씩 쓰게 하면 예산(44) 안에서 몇 종목 만에 멈추고, 다음 틱이 이어서 한다
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}");
    globalThis.__yahooFetches = 10;
    try {
      const a = await rotateFundamentals(env, new Date("2026-09-19T14:00:00Z"));
      expect(a.attempted).toBeGreaterThan(0);
      expect(a.attempted).toBeLessThan(8);
      expect(a.done).toBe(false);
      let cursor = a.cursor;
      for (let k = 1; cursor < 8 && k < 10; k++) cursor = (await rotateFundamentals(env, new Date(Date.UTC(2026, 8, 19, 14, 5 * k)))).cursor;
      expect(cursor).toBe(8);   // 몇 틱에 나눠 하루 안에 다 돈다
      // 다음 날이면 처음부터
      const next = await rotateFundamentals(env, new Date("2026-09-20T14:00:00Z"));
      expect(next.attempted).toBeGreaterThan(0);
      expect(next.cursor).toBe(next.attempted);
    } finally {
      globalThis.fetch = realFetch;
      globalThis.__yahooFetches = 0;
    }
  });
});
