// 야후 어댑터. 기존 worker.js의 시세·검색을 그대로 옮겼다.
// quoteSummary(crumb)는 마일스톤 5a에서 여기에 붙는다.

const YF = "https://query1.finance.yahoo.com";
export const FX_SYMBOL = "KRW=X";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
