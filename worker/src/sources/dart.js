// OpenDART 공식 API 어댑터. 회사 고유번호가 등록된 국내 종목만 호출한다.

const API = "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json";
const REPORTS = [
  { code: "11013", month: 3, day: 31, type: "Q" },
  { code: "11012", month: 6, day: 30, type: "Q" },
  { code: "11014", month: 9, day: 30, type: "Q" },
  { code: "11011", month: 12, day: 31, type: "FY" },
];

function amount(v) {
  if (v == null || v === "" || v === "-") return null;
  const s = String(v).replace(/,/g, "").trim();
  const paren = /^\((.*)\)$/.exec(s);
  const n = Number(paren ? "-" + paren[1] : s);
  return Number.isFinite(n) ? n : null;
}

function account(list, ids, names) {
  return list.find((x) => ids.includes(x.account_id)) ||
    list.find((x) => names.some((n) => String(x.account_nm || "").replace(/\s/g, "").includes(n)));
}

/** DART 전체 재무제표 응답 한 건 → financials 행. */
export function parseDartStatement(data, year, report) {
  if (!data || data.status === "013" || !Array.isArray(data.list)) return null;
  if (data.status !== "000") throw new Error("DART " + (data.status || "오류") + ": " + (data.message || "응답 오류"));
  const list = data.list.filter((x) => x.fs_div === "CFS" || !data.list.some((y) => y.fs_div === "CFS"));
  const rev = account(list, ["ifrs-full_Revenue"], ["매출액", "영업수익", "수익(매출액)"]);
  const op = account(list, ["dart_OperatingIncomeLoss", "ifrs-full_ProfitLossFromOperatingActivities"], ["영업이익"]);
  const net = account(list, ["ifrs-full_ProfitLoss"], ["당기순이익", "분기순이익", "반기순이익"]);
  const eps = account(list, ["ifrs-full_BasicEarningsLossPerShare"], ["기본주당이익", "주당순이익"]);
  const equity = account(list, ["ifrs-full_Equity"], ["자본총계"]);
  const debt = account(list, ["ifrs-full_Borrowings", "ifrs-full_CurrentBorrowings", "ifrs-full_NoncurrentBorrowings"], ["차입금"]);
  const cash = account(list, ["ifrs-full_CashAndCashEquivalents"], ["현금및현금성자산"]);
  const take = (x) => amount(x?.thstrm_amount ?? x?.thstrm_add_amount);
  const revenue = take(rev);
  const operating_income = take(op);
  const net_income = take(net);
  if (revenue == null && operating_income == null && net_income == null) return null;
  const period_end = year + "-" + String(report.month).padStart(2, "0") + "-" + String(report.day).padStart(2, "0");
  return {
    period_end, period_type: report.type, source: "dart",
    revenue, operating_income, net_income, eps: take(eps), bps: null, ebitda: null,
    net_debt: take(debt) != null && take(cash) != null ? take(debt) - take(cash) : null,
    shares_out: null,
    raw: JSON.stringify({ report_code: report.code, revenue: rev, operating_income: op, net_income: net, eps, equity, debt, cash }),
  };
}

export function recentDartReports(now = new Date(), count = 16) {
  const today = now.toISOString().slice(0, 10);
  const out = [];
  const y = now.getUTCFullYear();
  for (let year = y; year >= y - 4; year--) {
    for (const report of REPORTS) {
      const end = year + "-" + String(report.month).padStart(2, "0") + "-" + String(report.day).padStart(2, "0");
      if (end <= today) out.push({ year, ...report, end });
    }
  }
  return out.sort((a, b) => b.end.localeCompare(a.end)).slice(0, count);
}

async function statement(apiKey, corpCode, report) {
  const u = new URL(API);
  u.searchParams.set("crtfc_key", apiKey);
  u.searchParams.set("corp_code", corpCode);
  u.searchParams.set("bsns_year", String(report.year));
  u.searchParams.set("reprt_code", report.code);
  u.searchParams.set("fs_div", "CFS");
  const res = await fetch(u, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("DART가 " + res.status + " 응답");
  return parseDartStatement(await res.json(), report.year, report);
}

/** TTM 3년 밴드를 만들 수 있도록 최근 공시 16개를 받는다. 없는 분기는 건너뛴다. */
export async function dartFundamentals(apiKey, corpCode, now = new Date()) {
  if (!apiKey) throw new Error("DART_API_KEY가 없습니다");
  if (!/^\d{8}$/.test(String(corpCode || ""))) throw new Error("DART 회사 고유번호가 없습니다");
  const settled = await Promise.allSettled(recentDartReports(now).map((r) => statement(apiKey, corpCode, r)));
  const financials = [];
  const errors = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) financials.push(r.value);
    else if (r.status === "rejected") errors.push(String(r.reason?.message || r.reason));
  }
  if (!financials.length && errors.length) throw new Error(errors[0]);
  return { financials, estimates: [], earningsDate: null, errors };
}
