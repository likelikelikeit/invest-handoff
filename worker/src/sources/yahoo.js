// 야후 어댑터. 시세·검색 + M5a quoteSummary(crumb)·분기 재무.

const YF = "https://query1.finance.yahoo.com";
export const FX_SYMBOL = "KRW=X";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const Q2 = "https://query2.finance.yahoo.com";
const SESSION_KEY = "yahoo:session";
const SESSION_MS = 12 * 60 * 60 * 1000;

async function yahoo(path) {
  const res = await fetch(YF + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error("야후가 " + res.status + " 응답");
  return res.json();
}

export async function quote(symbol) {
  const data = await yahoo("/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1d");
  const r = data && data.chart && data.chart.result && data.chart.result[0];
  const meta = r && r.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    throw new Error(symbol + ": 시세를 못 찾음 (심볼 확인 필요)");
  }
  const prev = typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose
             : (typeof meta.previousClose === "number" ? meta.previousClose : null);
  return {
    symbol: meta.symbol || symbol,
    price: meta.regularMarketPrice,
    prevClose: prev,
    currency: meta.currency || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    marketState: meta.marketState || null,
    // 야후가 준 마지막 체결 시각. 지연 시세의 기준 시각으로 화면에 쓴다.
    time: typeof meta.regularMarketTime === "number" ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

/**
 * 야후 v8 chart 응답 → 일봉 행. 순수 함수 (테스트·로컬 백필 스크립트가 같이 쓴다).
 * 날짜는 거래소 현지 날짜: 타임스탬프 + gmtoffset. (국내 봉은 KST 00:00, 미국 봉은 ET 09:30에 찍힌다)
 * close가 없는 행(휴장·미완성)은 버린다.
 * → [{date, open, high, low, close, volume, adj_close}]
 */
export function parseChart(data) {
  const r = data && data.chart && data.chart.result && data.chart.result[0];
  if (!r || !Array.isArray(r.timestamp)) return [];
  const off = (r.meta && r.meta.gmtoffset) || 0;
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const adj = (r.indicators && r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose) || [];
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const byDate = new Map();
  r.timestamp.forEach((ts, i) => {
    const close = num(q.close && q.close[i]);
    if (close == null) return;
    const date = new Date((ts + off) * 1000).toISOString().slice(0, 10);
    // 같은 날짜가 두 번 오면(장중 마지막 봉) 뒤의 것이 이긴다
    byDate.set(date, {
      date,
      open: num(q.open && q.open[i]),
      high: num(q.high && q.high[i]),
      low: num(q.low && q.low[i]),
      close,
      volume: num(q.volume && q.volume[i]),
      adj_close: num(adj[i]),
    });
  });
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 일봉 이력. range: '5d' | '1mo' | '1y' | '5y' | '10y' */
export async function history(symbol, range = "5d") {
  const data = await yahoo("/v8/finance/chart/" + encodeURIComponent(symbol) +
    "?interval=1d&range=" + range + "&includeAdjustedClose=true&events=div%2Csplit");
  const rows = parseChart(data);
  if (!rows.length) throw new Error(symbol + ": 일봉이 비어 있음");
  return rows;
}

export async function search(q) {
  const data = await yahoo("/v1/finance/search?q=" + encodeURIComponent(q) +
                           "&quotesCount=10&newsCount=0&listsCount=0");
  return (data && data.quotes ? data.quotes : [])
    .filter((r) => r.symbol && (r.quoteType === "EQUITY" || r.quoteType === "ETF"))
    .slice(0, 8)
    .map((r) => ({
      symbol: r.symbol,
      name: r.shortname || r.longname || r.symbol,
      exchange: r.exchDisp || r.exchange || "",
      type: r.quoteType,
    }));
}

function raw(v) {
  return v && typeof v.raw === "number" && Number.isFinite(v.raw) ? v.raw : null;
}

function cookieParts(res) {
  const many = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const lines = many.length ? many : [res.headers.get("set-cookie")].filter(Boolean);
  return lines.map((x) => x.split(";", 1)[0]).filter(Boolean);
}

async function saveSession(env, session) {
  await env.DB.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(SESSION_KEY, JSON.stringify(session), new Date().toISOString()).run();
}

/** Yahoo의 쿠키+crumb을 D1에 12시간 캐시한다. */
export async function yahooSession(env, force = false) {
  if (!force) {
    const cached = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(SESSION_KEY).first();
    if (cached) {
      try {
        const value = JSON.parse(cached.value);
        if (value.crumb && value.cookie && Date.now() - value.at < SESSION_MS) return value;
      } catch { /* 깨진 캐시는 새로 받는다 */ }
    }
  }

  const headers = { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" };
  let cookies = [];
  for (const url of ["https://fc.yahoo.com", "https://finance.yahoo.com/quote/NVDA"]) {
    try {
      const res = await fetch(url, { headers, redirect: "manual" });
      cookies = cookies.concat(cookieParts(res));
      if (cookies.length) break;
    } catch { /* 다음 진입점을 시도한다 */ }
  }
  const cookie = [...new Set(cookies)].join("; ");
  if (!cookie) throw new Error("야후 세션 쿠키를 받지 못했습니다");
  const res = await fetch(Q2 + "/v1/test/getcrumb", { headers: { "User-Agent": UA, Accept: "text/plain", Cookie: cookie } });
  if (!res.ok) throw new Error("야후 crumb가 " + res.status + " 응답");
  const crumb = (await res.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("야후 crumb 응답이 올바르지 않습니다");
  const session = { cookie, crumb, at: Date.now() };
  await saveSession(env, session);
  return session;
}

async function yahooAuthed(env, path, retry = true) {
  const s = await yahooSession(env, !retry);
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(Q2 + path + sep + "crumb=" + encodeURIComponent(s.crumb), {
    headers: { "User-Agent": UA, Accept: "application/json", Cookie: s.cookie },
  });
  if ((res.status === 401 || res.status === 403) && retry) return yahooAuthed(env, path, false);
  if (!res.ok) throw new Error("야후 재무가 " + res.status + " 응답");
  const data = await res.json();
  if (data.quoteSummary && data.quoteSummary.error) throw new Error("야후 재무: " + data.quoteSummary.error.description);
  if (data.timeseries && data.timeseries.error) throw new Error("야후 재무: " + data.timeseries.error.description);
  return data;
}

const SUMMARY_MODULES = [
  "financialData", "earningsTrend", "calendarEvents", "defaultKeyStatistics",
].join(",");

/** quoteSummary 원본 → 컨센서스 추정치와 다음 실적일. */
export function parseYahooSummary(data, asOf) {
  const x = data?.quoteSummary?.result?.[0];
  if (!x) return { estimates: [], earningsDate: null, financialCurrency: null };
  const fd = x.financialData || {};
  const financialCurrency = typeof fd.financialCurrency === "string" && /^[A-Z]{3}$/.test(fd.financialCurrency)
    ? fd.financialCurrency : null;
  const estimates = [];
  const target = raw(fd.targetMeanPrice);
  const rating = raw(fd.recommendationMean);
  const analysts = raw(fd.numberOfAnalystOpinions);
  if (target != null || rating != null) {
    estimates.push({ fiscal_year: null, eps: null, revenue: null, target_price: target, rating_mean: rating, n_analysts: analysts, raw: JSON.stringify({ financialData: fd }) });
  }
  for (const t of x.earningsTrend?.trend || []) {
    if (t.period !== "0y" && t.period !== "+1y") continue;
    const end = String(t.endDate || "");
    const fy = Number(end.slice(0, 4));
    if (!Number.isInteger(fy)) continue;
    estimates.push({
      fiscal_year: fy,
      eps: raw(t.earningsEstimate?.avg), revenue: raw(t.revenueEstimate?.avg),
      target_price: null, rating_mean: null,
      n_analysts: raw(t.earningsEstimate?.numberOfAnalysts) ?? raw(t.revenueEstimate?.numberOfAnalysts),
      raw: JSON.stringify(t),
    });
  }
  const ed = x.calendarEvents?.earnings?.earningsDate?.[0];
  const earningsDate = ed?.fmt || (typeof ed?.raw === "number" ? new Date(ed.raw * 1000).toISOString().slice(0, 10) : null);
  return { estimates: estimates.map((e) => ({ ...e, as_of: asOf, source: "yahoo" })), earningsDate, financialCurrency };
}

const SERIES_TYPES = [
  "quarterlyTotalRevenue", "quarterlyOperatingIncome", "quarterlyNetIncome", "quarterlyDilutedEPS",
  "quarterlyDilutedAverageShares", "quarterlyStockholdersEquity", "quarterlyTotalDebt",
  "quarterlyCashCashEquivalentsAndShortTermInvestments", "quarterlyEBITDA",
];

/** fundamentals-timeseries 원본 → 날짜별 분기 재무. */
export function parseYahooTimeSeries(data) {
  const byDate = new Map();
  for (const series of data?.timeseries?.result || []) {
    const type = series?.meta?.type?.[0];
    if (!type || !Array.isArray(series[type])) continue;
    for (const point of series[type]) {
      const date = point.asOfDate;
      const value = raw(point.reportedValue);
      if (!date || value == null) continue;
      if (!byDate.has(date)) byDate.set(date, {});
      byDate.get(date)[type] = value;
    }
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period_end, x]) => {
    const shares = x.quarterlyDilutedAverageShares ?? null;
    const equity = x.quarterlyStockholdersEquity ?? null;
    const debt = x.quarterlyTotalDebt ?? null;
    const cash = x.quarterlyCashCashEquivalentsAndShortTermInvestments ?? null;
    return {
      period_end, period_type: "Q", source: "yahoo",
      revenue: x.quarterlyTotalRevenue ?? null,
      operating_income: x.quarterlyOperatingIncome ?? null,
      net_income: x.quarterlyNetIncome ?? null,
      eps: x.quarterlyDilutedEPS ?? null,
      bps: equity != null && shares ? equity / shares : null,
      ebitda: x.quarterlyEBITDA ?? null,
      net_debt: debt != null && cash != null ? debt - cash : null,
      shares_out: shares,
      raw: JSON.stringify(x),
    };
  });
}

/**
 * Yahoo 재무의 계산 가능 단위를 표시한다.
 * ADR의 EPS/BPS·주식 수가 원주 기준인지 ADR 기준인지 심볼마다 다를 수 있으므로 추정 환산하지 않는다.
 * 원천 통화와 상장 통화가 다르면 raw 숫자는 보존하되 currency=null로 표시해 계산을 막는다.
 */
export function normalizeYahooFinancials(rows, {
  sourceCurrency, listingCurrency, adrRatio, endRateForDate = null, incomeRateForDate = null,
}) {
  const source = sourceCurrency || null;
  const listing = listingCurrency || null;
  const crossCurrency = Boolean(source && listing && source !== listing);
  return rows.map((row) => {
    const ratio = Number(adrRatio) > 0 ? Number(adrRatio) : null;
    const endRate = crossCurrency && typeof endRateForDate === "function" ? endRateForDate(row.period_end) : 1;
    const incomeRate = crossCurrency && typeof incomeRateForDate === "function" ? incomeRateForDate(row.period_end) : 1;
    // ADR 비율은 Yahoo가 돌려준 주당·주식 수의 단위를 검증하는 메타데이터다.
    // 생산 TSM 데이터는 이미 ADR-equivalent 단위이므로 산술에는 다시 적용하지 않는다.
    const ready = Boolean(source && listing && (!crossCurrency || (ratio && endRate && incomeRate)));
    if (!ready) return {
      ...row,
      currency: null,
      source_currency: source,
      adr_ratio: ratio,
      fx_rate: null,
      balance_fx_rate: null,
    };
    if (!crossCurrency) {
      return { ...row, currency: listing, source_currency: source, adr_ratio: 1, fx_rate: 1, balance_fx_rate: 1 };
    }
    return {
      ...row,
      revenue: typeof row.revenue === "number" ? row.revenue * incomeRate : row.revenue,
      operating_income: typeof row.operating_income === "number" ? row.operating_income * incomeRate : row.operating_income,
      net_income: typeof row.net_income === "number" ? row.net_income * incomeRate : row.net_income,
      ebitda: typeof row.ebitda === "number" ? row.ebitda * incomeRate : row.ebitda,
      eps: typeof row.eps === "number" ? row.eps * incomeRate : row.eps,
      bps: typeof row.bps === "number" ? row.bps * endRate : row.bps,
      net_debt: typeof row.net_debt === "number" ? row.net_debt * endRate : row.net_debt,
      // Yahoo TSM의 diluted shares는 이미 ADR-equivalent다. adr_ratio로 나누지 않는다.
      shares_out: row.shares_out,
      currency: listing,
      source_currency: source,
      adr_ratio: ratio,
      fx_rate: incomeRate,
      balance_fx_rate: endRate,
    };
  });
}

function recentQuarterSum(rows, key) {
  const values = rows.filter((row) => row.period_type === "Q" && typeof row[key] === "number").slice(-4);
  return values.length === 4 ? values.reduce((sum, row) => sum + row[key], 0) : null;
}

function closerTo(value, a, b) {
  if (!(value > 0) || !(a > 0) || !(b > 0)) return null;
  return Math.abs(Math.log(value / a)) <= Math.abs(Math.log(value / b));
}

/**
 * Yahoo의 교차통화 컨센서스는 항목별 단위가 일정하지 않다. 합계 매출은 재무 통화이고,
 * EPS는 TSM처럼 상장 통화 ADR 기준이거나 NVO처럼 재무 통화 기준일 수 있다.
 * 최근 TTM의 원천/정규화 규모와 비교해 EPS 단위를 판별하고, 원천 단위일 때만 환산한다.
 */
export function normalizeYahooEstimates(estimates, rawRows, normalizedRows, {
  sourceCurrency, listingCurrency, latestRate,
}) {
  if (!sourceCurrency || !listingCurrency || sourceCurrency === listingCurrency) return estimates;
  if (!(latestRate > 0)) {
    return estimates.map((row) => row.fiscal_year == null ? row : { ...row, eps: null, revenue: null });
  }
  const rawEps = recentQuarterSum(rawRows, "eps");
  const listingEps = recentQuarterSum(normalizedRows, "eps");
  return estimates.map((row) => {
    if (row.fiscal_year == null) return row; // 목표가는 상장 통화다.
    const epsInSource = closerTo(row.eps, rawEps, listingEps);
    return {
      ...row,
      eps: typeof row.eps === "number" && epsInSource ? row.eps * latestRate : row.eps,
      // Yahoo earningsTrend의 aggregate 매출은 financialCurrency 기준이다.
      revenue: typeof row.revenue === "number" ? row.revenue * latestRate : row.revenue,
    };
  });
}

/** 분기말 이하의 마지막 거래일 환율(상장통화/재무통화). */
export function financialRateAt(rows, date, inverse = false) {
  let hit = null;
  for (const row of rows) {
    if (row.date > date) break;
    if (row.close > 0) hit = row.close;
  }
  return hit == null ? null : (inverse ? 1 / hit : hit);
}

/** 분기말 직전 3개월의 일별 환율 산술평균(상장통화/재무통화). */
export function financialIncomeRate(rows, periodEnd, inverse = false) {
  const start = new Date(periodEnd + "T00:00:00Z");
  if (Number.isNaN(start.getTime())) return null;
  start.setUTCMonth(start.getUTCMonth() - 3);
  const startDate = start.toISOString().slice(0, 10);
  const rates = rows.filter((row) => row.date > startDate && row.date <= periodEnd && row.close > 0)
    .map((row) => inverse ? 1 / row.close : row.close);
  return rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null;
}

/** 최근 5년 일별 환율과 분기 평균·분기말 조회 함수. */
export async function yahooFinancialFxHistory(from, to) {
  if (!from || !to) return null;
  if (from === to) return { latestRate: 1, rateAsOf: null, endRate: () => 1, incomeRate: () => 1 };
  const candidates = [];
  // Yahoo의 대표 표기 `TWD=X`, `DKK=X`, `KRW=X`는 USD 1단위당 상대통화다.
  if (to === "USD") candidates.push({ symbol: from + "=X", inverse: true });
  if (from === "USD") candidates.push({ symbol: to + "=X", inverse: false });
  candidates.push({ symbol: from + to + "=X", inverse: false });
  candidates.push({ symbol: to + from + "=X", inverse: true });
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.symbol)) continue;
    seen.add(candidate.symbol);
    try {
      const rows = await history(candidate.symbol, "5y");
      const last = rows.at(-1);
      if (!last?.close) continue;
      return {
        latestRate: candidate.inverse ? 1 / last.close : last.close,
        rateAsOf: last.date,
        endRate: (date) => financialRateAt(rows, date, candidate.inverse),
        incomeRate: (date) => financialIncomeRate(rows, date, candidate.inverse),
      };
    } catch { /* 다음 후보 */ }
  }
  return null;
}

/** 다음 실적 발표일만 (일일 크론용, calendarEvents 모듈 하나라 가볍다). 없으면 null. */
export async function yahooEarningsDate(env, symbol, now = new Date()) {
  const data = await yahooAuthed(env, "/v10/finance/quoteSummary/" + encodeURIComponent(symbol) + "?modules=calendarEvents");
  return parseYahooSummary(data, now.toISOString().slice(0, 10)).earningsDate;
}

/** 미국 종목의 분기 재무·컨센서스·실적일을 한 번에 가져온다. */
export async function yahooFundamentals(env, symbol, now = new Date(), { listingCurrency = null, adrRatio = null } = {}) {
  const asOf = now.toISOString().slice(0, 10);
  // 5년을 요청하지만 야후는 최근 5개 분기만 준다. 과거 이력은 SEC(scripts/sec-history.mjs)가 채운다.
  const start = Math.floor(Date.UTC(now.getUTCFullYear() - 5, 0, 1) / 1000);
  const end = Math.floor(now.getTime() / 1000) + 86400;
  const [summary, series] = await Promise.all([
    yahooAuthed(env, "/v10/finance/quoteSummary/" + encodeURIComponent(symbol) + "?modules=" + SUMMARY_MODULES),
    yahooAuthed(env, "/ws/fundamentals-timeseries/v1/finance/timeseries/" + encodeURIComponent(symbol) +
      "?symbol=" + encodeURIComponent(symbol) + "&type=" + SERIES_TYPES.join(",") + "&period1=" + start + "&period2=" + end),
  ]);
  const s = parseYahooSummary(summary, asOf);
  const sourceCurrency = s.financialCurrency || listingCurrency;
  const fx = sourceCurrency && listingCurrency
    ? await yahooFinancialFxHistory(sourceCurrency, listingCurrency)
    : null;
  const rawFinancials = parseYahooTimeSeries(series);
  const financials = normalizeYahooFinancials(rawFinancials, {
    sourceCurrency, listingCurrency, adrRatio,
    endRateForDate: fx?.endRate || null,
    incomeRateForDate: fx?.incomeRate || null,
  });
  const estimates = normalizeYahooEstimates(s.estimates, rawFinancials, financials, {
    sourceCurrency, listingCurrency, latestRate: fx?.latestRate ?? null,
  });
  const errors = [];
  if (sourceCurrency && listingCurrency && sourceCurrency !== listingCurrency && !(Number(adrRatio) > 0)) {
    errors.push("ADR 원주 비율이 없어 재무 단위를 확인하지 못했습니다");
  }
  if (sourceCurrency && listingCurrency && sourceCurrency !== listingCurrency && !fx) {
    errors.push(sourceCurrency + "→" + listingCurrency + " 환율 이력을 받지 못했습니다");
  }
  return {
    financials,
    estimates,
    earningsDate: s.earningsDate,
    financialCurrency: sourceCurrency,
    financialToListingRate: fx?.latestRate ?? null,
    financialRateAsOf: fx?.rateAsOf ?? null,
    errors,
  };
}
