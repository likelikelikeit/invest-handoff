import { describe, it, expect } from "vitest";
import { makeDb } from "./d1shim.js";
import { parseNaverConsensus, parseNaverFinance } from "../src/sources/naver.js";
import { parseYahooSummary, parseYahooTimeSeries, normalizeYahooFinancials, normalizeYahooEstimates, financialRateAt, financialIncomeRate } from "../src/sources/yahoo.js";
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
      financialData: { targetMeanPrice: raw(328.5), recommendationMean: raw(1.3), numberOfAnalystOpinions: raw(58), financialCurrency: "USD" },
      earningsTrend: { trend: [{ period: "0y", endDate: "2027-01-31", earningsEstimate: { avg: raw(9.3), numberOfAnalysts: raw(51) }, revenueEstimate: { avg: raw(411000000000) } }] },
      calendarEvents: { earnings: { earningsDate: [{ fmt: "2026-11-17" }] } },
    }] } };
    const s = parseYahooSummary(summary, "2026-09-19");
    expect(s.earningsDate).toBe("2026-11-17");
    expect(s.financialCurrency).toBe("USD");
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

  it("ADR 재무를 상장 통화와 ADR 1주 단위로 환산하고 메타데이터가 없으면 계산을 막는다", () => {
    const source = [{ period_end: "2026-06-30", revenue: 1000, net_income: 100, eps: 10, bps: 50, shares_out: 500, raw: "{}" }];
    const [tsm] = normalizeYahooFinancials(source, {
      sourceCurrency: "TWD", listingCurrency: "USD", adrRatio: 5,
      endRateForDate: () => 0.03, incomeRateForDate: () => 0.031,
    });
    expect(tsm).toMatchObject({
      revenue: 31, net_income: 3.1, eps: 0.31, bps: 1.5, shares_out: 500,
      currency: "USD", source_currency: "TWD", adr_ratio: 5, fx_rate: 0.031, balance_fx_rate: 0.03,
    });
    expect(normalizeYahooFinancials(source, {
      sourceCurrency: "TWD", listingCurrency: "USD", adrRatio: null,
      endRateForDate: () => 0.03, incomeRateForDate: () => 0.031,
    })[0]).toMatchObject({ currency: null, source_currency: "TWD", adr_ratio: null });
    const fx = [{ date: "2026-03-31", close: 32 }, { date: "2026-06-29", close: 31 }];
    expect(financialRateAt(fx, "2026-06-30", true)).toBeCloseTo(1 / 31);
    expect(financialIncomeRate(fx, "2026-06-30", true)).toBeCloseTo((1 / 32 + 1 / 31) / 2);
    expect(financialRateAt(fx, "2026-01-01", true)).toBeNull();
  });

  it("교차통화 컨센서스의 매출과 원천 통화 EPS만 상장 통화로 바꾼다", () => {
    const rawRows = [1, 2, 3, 4].map((n) => ({ period_type: "Q", eps: 6, revenue: 75 }));
    const usdRows = rawRows.map((row) => ({ ...row, eps: row.eps * 0.16, revenue: row.revenue * 0.16 }));
    const base = { fiscal_year: 2027, revenue: 320, target_price: null };
    expect(normalizeYahooEstimates([{ ...base, eps: 24 }], rawRows, usdRows, {
      sourceCurrency: "DKK", listingCurrency: "USD", latestRate: 0.16,
    })[0]).toMatchObject({ eps: 3.84, revenue: 51.2 });
    expect(normalizeYahooEstimates([{ ...base, eps: 4.2 }], rawRows, usdRows, {
      sourceCurrency: "TWD", listingCurrency: "USD", latestRate: 0.032,
    })[0]).toMatchObject({ eps: 4.2, revenue: 10.24 });
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
  it("DART 공식 값은 지키고 네이버의 보완 필드는 합치며 null로 기존 값을 지우지 않는다", async () => {
    const env = { DB: makeDb() };
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("삼성전자", "005930", "005930.KS", "KR", "KRW", at, at);
    const base = { period_end: "2026-06-30", period_type: "Q", operating_income: 2, net_income: 3, eps: 4, bps: 5, ebitda: 6, net_debt: null, shares_out: 7, raw: "{}", currency: "KRW", source_currency: "KRW", adr_ratio: 1, fx_rate: 1 };
    await upsertFinancialsStmt(env, 5, [{ ...base, revenue: 100, source: "naver" }], at).run();
    await upsertFinancialsStmt(env, 5, [{ ...base, revenue: 110, bps: null, ebitda: null, shares_out: null, source: "dart" }], at).run();
    await upsertFinancialsStmt(env, 5, [{ ...base, revenue: 999, bps: null, ebitda: null, shares_out: null, source: "naver" }], at).run();
    await upsertEstimatesStmt(env, 5, [{ source: "naver", as_of: "2026-09-19", fiscal_year: null, eps: null, revenue: null, target_price: 100, rating_mean: 4, n_analysts: null, raw: "{}" }]).run();
    await upsertEstimatesStmt(env, 5, [{ source: "naver", as_of: "2026-09-19", fiscal_year: null, eps: null, revenue: null, target_price: 120, rating_mean: 4.1, n_analysts: null, raw: "{}" }]).run();
    await upsertEarningsStmt(env, 5, "2026-10-30", at).run();
    await upsertEarningsStmt(env, 5, "2026-10-30", at).run();

    const f = await env.DB.prepare("SELECT revenue,bps,ebitda,shares_out,source FROM financials WHERE security_id=5").first();
    expect(f).toEqual({ revenue: 110, bps: 5, ebitda: 6, shares_out: 7, source: "dart" });
    expect((await env.DB.prepare("SELECT COUNT(*) n,target_price FROM estimates WHERE security_id=5").first())).toEqual({ n: 1, target_price: 120 });
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE security_id=5").first()).n).toBe(1);

    const res = await getFundamentals({}, env, {}, { id: 5 });
    const body = await res.json();
    expect(body.financials[0].source).toBe("dart");
    expect(body.estimates[0].target_price).toBe(120);
    expect(body.next_earnings.date).toBe("2026-10-30");
    expect(body.security.valuation_ready).toBe(true);
    expect(body.financials[0]).toMatchObject({ currency: "KRW", source_currency: "KRW", fx_rate: 1 });
  });

  it("환산되지 않은 ADR 재무는 valuation_ready=false로 반환한다", async () => {
    const env = { DB: makeDb() };
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,financial_currency,adr_ratio,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("TSMC", "TSM", "TSM", "US", "USD", "TWD", 5, at, at);
    env.DB.raw.prepare("INSERT INTO financials (security_id,period_end,period_type,eps,source,fetched_at,source_currency,adr_ratio) VALUES (?,?,?,?,?,?,?,?)")
      .run(5, "2026-06-30", "Q", 10, "yahoo", at, "TWD", 5);
    const body = await (await getFundamentals({}, env, {}, { id: 5 })).json();
    expect(body.security).toMatchObject({
      financial_currency: "TWD", adr_ratio: 5, valuation_ready: false,
      valuation_block_reason: "상장 통화로 환산되지 않은 재무 데이터가 있습니다",
    });
  });

  it("같은 배치의 DART와 네이버 행도 소스 순서와 무관하게 필드별 병합한다", async () => {
    const env = { DB: makeDb() };
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("SK하이닉스", "000660", "000660.KS", "KR", "KRW", at, at);
    const naver = { period_end: "2026-06-30", period_type: "Q", revenue: 100, operating_income: 20, net_income: 10, eps: 2, bps: 80, ebitda: 30, net_debt: null, shares_out: 70, raw: "naver", source: "naver" };
    const dart = { ...naver, revenue: 110, operating_income: 22, net_income: 11, eps: null, bps: null, ebitda: null, shares_out: null, raw: "dart", source: "dart" };
    await upsertFinancialsStmt(env, 5, [dart, naver], at).run();
    expect(await env.DB.prepare("SELECT revenue,eps,bps,ebitda,shares_out,source FROM financials WHERE security_id=5").first())
      .toEqual({ revenue: 110, eps: 2, bps: 80, ebitda: 30, shares_out: 70, source: "dart" });
  });
});
