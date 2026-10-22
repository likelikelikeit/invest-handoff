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

/**
 * 사업보고서는 연간 누적만 있어 4분기 행이 없다. 연속 네 분기(TTM)를 만들려면 4분기가 필요하므로
 * 4분기 = 연간 − (1·2·3분기)로 파생한다. 손익 흐름 항목만 빼고, 순차입금 같은 기말 잔액은 연간 값을 쓴다.
 * EPS는 분기마다 주식수가 달라 근사치다. 1·2·3분기 중 하나라도 없으면 만들지 않는다.
 */
export function deriveQ4(rows) {
  const out = [];
  const fys = rows.filter((r) => r.source === "dart" && r.period_type === "FY");
  for (const fy of fys) {
    const y = fy.period_end.slice(0, 4);
    const qs = ["-03-31", "-06-30", "-09-30"].map((d) =>
      rows.find((r) => r.source === "dart" && r.period_type === "Q" && r.period_end === y + d));
    if (qs.some((q) => !q)) continue;
    const minus = (k) => (fy[k] == null || qs.some((q) => q[k] == null) ? null : fy[k] - qs.reduce((s, q) => s + q[k], 0));
    out.push({
      period_end: y + "-12-31", period_type: "Q", source: "dart",
      revenue: minus("revenue"), operating_income: minus("operating_income"), net_income: minus("net_income"),
      eps: minus("eps"), bps: null, ebitda: null, net_debt: fy.net_debt, shares_out: null,
      raw: JSON.stringify({ derived: "FY - (Q1+Q2+Q3)", fy: fy.period_end }),
    });
  }
  return out;
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

/**
 * DART 요청. 리다이렉트를 따라가지 않는다: Worker에서 DART만 외부 요청 10개 안팎에서 "Too many subrequests"로
 * 죽었는데(2026-10-22 계량 결과), 리다이렉트 한 번 한 번이 서브요청으로 세진다. 따라가지 않고 그 응답을 오류로 남겨
 * 원인을 보이게 하고, 한 종목 때문에 같은 실행의 예산을 다 태우지 않게 한다.
 */
async function dartFetch(u) {
  const res = await fetch(u, { headers: { Accept: "application/json" }, redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    throw new Error("DART가 리다이렉트 " + res.status + " → " + String(res.headers.get("location") || "?").replace(/crtfc_key=[^&]+/, "crtfc_key=…"));
  }
  if (!res.ok) throw new Error("DART가 " + res.status + " 응답");
  return res;
}

async function statement(apiKey, corpCode, report) {
  const u = new URL(API);
  u.searchParams.set("crtfc_key", apiKey);
  u.searchParams.set("corp_code", corpCode);
  u.searchParams.set("bsns_year", String(report.year));
  u.searchParams.set("reprt_code", report.code);
  u.searchParams.set("fs_div", "CFS");
  const res = await dartFetch(u);
  return parseDartStatement(await res.json(), report.year, report);
}

/** TTM 3년 밴드를 만들 수 있도록 최근 공시 16개를 받는다. 없는 분기는 건너뛴다. */
export async function dartFundamentals(apiKey, corpCode, now = new Date(), {
  offset = 0, count = 16, batchByYear = false,
} = {}) {
  if (!apiKey) throw new Error("DART_API_KEY가 없습니다");
  if (!/^\d{8}$/.test(String(corpCode || ""))) throw new Error("DART 회사 고유번호가 없습니다");
  const reports = recentDartReports(now);
  const start = Math.max(0, Number(offset) || 0);
  const limit = Math.max(1, Number(count) || 1);
  const remaining = reports.slice(start);
  const selected = batchByYear && remaining.length
    ? remaining.filter((r) => r.year === remaining[0].year).slice(0, limit)
    : remaining.slice(0, limit);
  const settled = await Promise.allSettled(selected.map((r) => statement(apiKey, corpCode, r)));
  const financials = [];
  const errors = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) financials.push(r.value);
    else if (r.status === "rejected") errors.push(String(r.reason?.message || r.reason));
  }
  if (!financials.length && errors.length) throw new Error(errors[0]);
  // 일부 보고서만 실패했다면 성공분은 저장하되 커서를 넘기지 않는다. 다음 시도에서 같은 묶음을
  // 다시 받아 누락된 기간을 건너뛰지 않게 한다(UPSERT라 성공분 재수집은 무해하다).
  const nextOffset = errors.length ? start : Math.min(start + selected.length, reports.length);
  return {
    financials: financials.concat(deriveQ4(financials)), estimates: [], earningsDate: null, errors,
    progress: { offset: start, nextOffset, total: reports.length, done: !errors.length && nextOffset >= reports.length },
  };
}

// ── 국내 실적 발표일 (SPEC §5.7) ─────────────────────────
// 출처: DART 공시 목록(list.json)의 공정공시(I002). 회사가 내는 '영업(잠정)실적(공정공시)'의 접수일이 곧 발표일이다.
//   - 오늘 잠정실적 공시가 들어왔으면 → 오늘, 확정(이미 발표)
//   - 아니면 → 작년 같은 분기 잠정실적 공시일 + 1년(주말이면 다음 월요일), 예상
// '기업설명회(IR) 개최' 안내공시에서 확정 날짜를 읽는 일은 문서를 받아 풀어야 해 맥 미니 스크립트가 한다
// (scripts/kr-earnings-confirm.mjs). 잠정실적 공시를 내지 않는 회사는 여기서 날짜를 만들지 않는다.

const LIST_API = "https://opendart.fss.or.kr/api/list.json";

/** 최근 공정공시 목록. → [{report_nm, rcept_dt:'YYYY-MM-DD', rcept_no}] */
export async function dartDisclosures(apiKey, corpCode, from, to) {
  if (!apiKey) throw new Error("DART_API_KEY가 없습니다");
  const u = new URL(LIST_API);
  u.searchParams.set("crtfc_key", apiKey);
  u.searchParams.set("corp_code", corpCode);
  u.searchParams.set("bgn_de", from.replace(/-/g, ""));
  u.searchParams.set("end_de", to.replace(/-/g, ""));
  u.searchParams.set("pblntf_detail_ty", "I002");
  u.searchParams.set("page_count", "100");
  const res = await dartFetch(u);
  return parseDisclosureList(await res.json());
}

export function parseDisclosureList(data) {
  if (!data || data.status === "013") return [];
  if (data.status !== "000") throw new Error("DART " + (data.status || "오류") + ": " + (data.message || "응답 오류"));
  return (data.list || []).map((x) => ({
    report_nm: String(x.report_nm || "").trim(),
    rcept_dt: /^\d{8}$/.test(String(x.rcept_dt))
      ? x.rcept_dt.slice(0, 4) + "-" + x.rcept_dt.slice(4, 6) + "-" + x.rcept_dt.slice(6, 8) : null,
    rcept_no: x.rcept_no || null,
  })).filter((x) => x.rcept_dt);
}

const isPrelim = (nm) => /잠정/.test(nm) && /실적/.test(nm) && !/정정/.test(nm);

function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function onWeekday(date) {
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  return dow === 6 ? addDays(date, 2) : dow === 0 ? addDays(date, 1) : date;
}

/**
 * 공시 목록 → 다음 실적 발표일. 순수 함수. today는 KST 'YYYY-MM-DD'.
 * → {date, confirmed: 1|0, detail} 또는 null(근거 없음)
 */
export function krEarningsFromDisclosures(list, today) {
  const prelim = list.filter((x) => isPrelim(x.report_nm)).map((x) => x.rcept_dt).sort();
  if (!prelim.length) return null;
  if (prelim.includes(today)) return { date: today, confirmed: 1, detail: { basis: "오늘 잠정실적 공시" } };

  // 작년 같은 분기 공시일 + 1년. 올해 그 분기를 이미 냈으면(후보일 ±45일 안에 더 최근 공시가 있으면) 건너뛴다.
  const candidates = [];
  for (const d of prelim) {
    const next = onWeekday(String(Number(d.slice(0, 4)) + 1) + d.slice(4));
    if (prelim.some((r) => r > d && r >= addDays(next, -45) && r <= addDays(next, 45))) continue;
    if (next > today) candidates.push({ date: next, from: d });
    // 작년보다 늦어지는 중: 후보일이 막 지났는데 아직 공시가 없으면 다음 영업일로 미룬다
    else if (next > addDays(today, -30)) candidates.push({ date: onWeekday(addDays(today, 1)), from: d, late: true });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.date < b.date ? -1 : 1));
  const c = candidates[0];
  return {
    date: c.date, confirmed: 0,
    detail: { basis: "작년 같은 분기 잠정실적 공시일 + 1년", last_year: c.from, ...(c.late ? { note: "작년보다 늦어지는 중" } : {}) },
  };
}
