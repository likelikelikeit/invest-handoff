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
