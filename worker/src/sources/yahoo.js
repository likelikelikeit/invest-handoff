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
  if (!x) return { estimates: [], earningsDate: null };
  const fd = x.financialData || {};
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
  return { estimates: estimates.map((e) => ({ ...e, as_of: asOf, source: "yahoo" })), earningsDate };
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

/** 미국 종목의 분기 재무·컨센서스·실적일을 한 번에 가져온다. */
export async function yahooFundamentals(env, symbol, now = new Date()) {
  const asOf = now.toISOString().slice(0, 10);
  const start = Math.floor(Date.UTC(now.getUTCFullYear() - 3, 0, 1) / 1000);
  const end = Math.floor(now.getTime() / 1000) + 86400;
  const [summary, series] = await Promise.all([
    yahooAuthed(env, "/v10/finance/quoteSummary/" + encodeURIComponent(symbol) + "?modules=" + SUMMARY_MODULES),
    yahooAuthed(env, "/ws/fundamentals-timeseries/v1/finance/timeseries/" + encodeURIComponent(symbol) +
      "?symbol=" + encodeURIComponent(symbol) + "&type=" + SERIES_TYPES.join(",") + "&period1=" + start + "&period2=" + end),
  ]);
  const s = parseYahooSummary(summary, asOf);
  return { financials: parseYahooTimeSeries(series), estimates: s.estimates, earningsDate: s.earningsDate };
}
