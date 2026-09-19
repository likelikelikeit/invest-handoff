import { describe, it, expect } from "vitest";
import { makeDb } from "./d1shim.js";
import { parseNaverConsensus, parseNaverFinance } from "../src/sources/naver.js";
import { parseYahooSummary, parseYahooTimeSeries } from "../src/sources/yahoo.js";
import { parseDartStatement, recentDartReports } from "../src/sources/dart.js";
import { upsertFinancialsStmt, upsertEstimatesStmt, upsertEarningsStmt } from "../src/lib/fundamentals.js";
import { getFundamentals } from "../src/routes/fundamentals.js";

const raw = (n) => ({ raw: n });

describe("외부 재무 파서", () => {
  it("네이버 컨센서스와 억원 단위 재무를 원 단위로 바꾼다", () => {
    expect(parseNaverConsensus({ consensusInfo: { createDate: "2026-09-17", recommMean: "4.00", priceTargetMean: "487,045" } }, "x"))
      .toMatchObject({ as_of: "2026-09-17", target_price: 487045, rating_mean: 4 });
    const data = { financeInfo: {
      trTitleList: [{ isConsensus: "N", title: "2026.06.", key: "202606" }, { isConsensus: "Y", title: "2027.12.", key: "202712" }],
      rowList: [
        { title: "매출액", columns: { 202606: { value: "1,714,995" }, 202712: { value: "5,000,000" } } },
        { title: "영업이익", columns: { 202606: { value: "894,924" } } },
        { title: "당기순이익", columns: { 202606: { value: "716,245" } } },
        { title: "EPS", columns: { 202606: { value: "10,718" }, 202712: { value: "20,000" } } },
        { title: "BPS", columns: { 202606: { value: "86,052" } } },
      ],
    } };
    const q = parseNaverFinance(data, "Q", "2026-09-19");
    expect(q.financials[0]).toMatchObject({ period_end: "2026-06-30", revenue: 171499500000000, eps: 10718, source: "naver" });
    expect(q.estimates).toHaveLength(0);
    const fy = parseNaverFinance(data, "FY", "2026-09-19");
    expect(fy.estimates[0]).toMatchObject({ fiscal_year: 2027, revenue: 500000000000000, eps: 20000 });
  });

  it("Yahoo 컨센서스·연간 추정과 분기 시계열을 정규화한다", () => {
    const summary = { quoteSummary: { result: [{
      financialData: { targetMeanPrice: raw(328.5), recommendationMean: raw(1.3), numberOfAnalystOpinions: raw(58) },
      earningsTrend: { trend: [{ period: "0y", endDate: "2027-01-31", earningsEstimate: { avg: raw(9.3), numberOfAnalysts: raw(51) }, revenueEstimate: { avg: raw(411000000000) } }] },
      calendarEvents: { earnings: { earningsDate: [{ fmt: "2026-11-17" }] } },
    }] } };
    const s = parseYahooSummary(summary, "2026-09-19");
    expect(s.earningsDate).toBe("2026-11-17");
    expect(s.estimates).toHaveLength(2);
    expect(s.estimates[1]).toMatchObject({ fiscal_year: 2027, eps: 9.3, revenue: 411000000000 });

    const point = (date, value) => ({ asOfDate: date, reportedValue: raw(value) });
    const series = (type, value) => ({ meta: { type: [type] }, [type]: [point("2026-07-31", value)] });
    const rows = parseYahooTimeSeries({ timeseries: { result: [
      series("quarterlyTotalRevenue", 96221000000), series("quarterlyOperatingIncome", 60000000000),
      series("quarterlyNetIncome", 59688000000), series("quarterlyDilutedEPS", 2.4),
      series("quarterlyDilutedAverageShares", 24000000000), series("quarterlyStockholdersEquity", 120000000000),
      series("quarterlyTotalDebt", 100), series("quarterlyCashCashEquivalentsAndShortTermInvestments", 140),
    ] } });
    expect(rows[0]).toMatchObject({ period_end: "2026-07-31", revenue: 96221000000, eps: 2.4, bps: 5, net_debt: -40 });
  });

  it("DART 핵심 계정을 골라 분기 행을 만든다", () => {
    const data = { status: "000", list: [
      { fs_div: "CFS", account_id: "ifrs-full_Revenue", account_nm: "매출액", thstrm_amount: "86,061,700,000,000" },
      { fs_div: "CFS", account_id: "dart_OperatingIncomeLoss", account_nm: "영업이익", thstrm_amount: "12,166,100,000,000" },
      { fs_div: "CFS", account_id: "ifrs-full_ProfitLoss", account_nm: "당기순이익", thstrm_amount: "12,225,700,000,000" },
    ] };
    expect(parseDartStatement(data, 2026, { code: "11014", month: 9, day: 30, type: "Q" }))
      .toMatchObject({ period_end: "2026-09-30", revenue: 86061700000000, source: "dart" });
    expect(recentDartReports(new Date("2026-09-19T00:00:00Z"), 2).map((x) => x.code)).toEqual(["11012", "11013"]);
  });
});

describe("재무 D1 저장과 조회", () => {
  it("DART 행은 이후 네이버 폴백이 덮지 않고, 추정·실적일은 같은 키로 갱신된다", async () => {
    const env = { DB: makeDb() };
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("삼성전자", "005930", "005930.KS", "KR", "KRW", at, at);
    const base = { period_end: "2026-06-30", period_type: "Q", operating_income: 2, net_income: 3, eps: 4, bps: 5, ebitda: null, net_debt: null, shares_out: null, raw: "{}" };
    await upsertFinancialsStmt(env, 5, [{ ...base, revenue: 100, source: "naver" }], at).run();
    await upsertFinancialsStmt(env, 5, [{ ...base, revenue: 110, source: "dart" }], at).run();
    await upsertFinancialsStmt(env, 5, [{ ...base, revenue: 999, source: "naver" }], at).run();
    await upsertEstimatesStmt(env, 5, [{ source: "naver", as_of: "2026-09-19", fiscal_year: null, eps: null, revenue: null, target_price: 100, rating_mean: 4, n_analysts: null, raw: "{}" }]).run();
    await upsertEstimatesStmt(env, 5, [{ source: "naver", as_of: "2026-09-19", fiscal_year: null, eps: null, revenue: null, target_price: 120, rating_mean: 4.1, n_analysts: null, raw: "{}" }]).run();
    await upsertEarningsStmt(env, 5, "2026-10-30", at).run();
    await upsertEarningsStmt(env, 5, "2026-10-30", at).run();

    const f = await env.DB.prepare("SELECT revenue,source FROM financials WHERE security_id=5").first();
    expect(f).toEqual({ revenue: 110, source: "dart" });
    expect((await env.DB.prepare("SELECT COUNT(*) n,target_price FROM estimates WHERE security_id=5").first())).toEqual({ n: 1, target_price: 120 });
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE security_id=5").first()).n).toBe(1);

    const res = await getFundamentals({}, env, {}, { id: 5 });
    const body = await res.json();
    expect(body.financials[0].source).toBe("dart");
    expect(body.estimates[0].target_price).toBe(120);
    expect(body.next_earnings.date).toBe("2026-10-30");
  });
});
