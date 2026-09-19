/**
 * 포트폴리오 시뮬레이터 백엔드 (Cloudflare Workers)
 *
 * 경로
 *   GET  /?symbols=NVDA,005930.KS   시세 + 달러 환율
 *   GET  /search?q=삼성전자          종목 검색 (심볼 찾기)
 *   POST /import?mt=image/png       스크린샷 → 보유 종목 JSON
 *                                   본문은 base64 문자열 그대로
 *
 * /import 를 쓰려면 Cloudflare 대시보드에서
 *   Settings → Variables and Secrets → Add → Secret
 *   이름 ANTHROPIC_API_KEY, 값은 console.anthropic.com 에서 발급한 키
 * 를 넣어야 합니다. 키는 여기에만 있고 앱에는 내려가지 않습니다.
 */

// ── 설정 ──────────────────────────────────────────────
// 비워두면 아무 주소에서나 호출됩니다. 배포 주소가 정해지면 채워서 잠그세요.
const ALLOW_ORIGINS = [];

const MAX_SYMBOLS = 40;
const FX_SYMBOL = "KRW=X";
const YF = "https://query1.finance.yahoo.com";
const MODEL = "claude-sonnet-5";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const EXTRACT_PROMPT =
`이미지는 증권사 앱이나 웹의 보유 종목 목록 화면이다. 표의 각 행을 읽어 JSON만 출력한다.

{"rows":[{"name":"","ticker":"","currency":"KRW","qty":null,"avgPrice":null,"currentPrice":null,"marketValue":null,"profit":null}]}

규칙:
- name 은 화면에 보이는 종목명 그대로.
- ticker 는 티커나 6자리 종목코드. 안 보이면 빈 문자열.
- currency 는 금액이 원으로 표시되면 "KRW", 달러면 "USD".
- qty(수량), avgPrice(평균단가), currentPrice(현재가), marketValue(평가금액), profit(평가손익)
  은 화면에 실제로 보이는 값만 숫자로 넣고, 없으면 null 로 둔다. 추측하지 않는다.
- 숫자에서 쉼표, 원, 달러, %, 화살표는 빼고 값만. 손실이나 하락은 음수.
- 합계 행, 현금 행, 요약 카드는 제외하고 개별 종목만.
- 설명이나 코드블록 없이 JSON 객체 하나만 출력한다.`;

// ── 공통 ──────────────────────────────────────────────
function headersFor(origin) {
  const open = ALLOW_ORIGINS.length === 0;
  const allowed = open ? "*" : (ALLOW_ORIGINS.indexOf(origin) >= 0 ? origin : null);
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
  if (allowed) h["Access-Control-Allow-Origin"] = allowed;
  if (!open) h["Vary"] = "Origin";
  return h;
}
const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status: status || 200, headers: headers });

async function yahoo(path) {
  const res = await fetch(YF + path, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error("야후가 " + res.status + " 응답");
  return res.json();
}

// ── 시세 ──────────────────────────────────────────────
async function quote(symbol) {
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
  };
}

async function handleQuotes(url, headers) {
  const raw = (url.searchParams.get("symbols") || "").trim();
  if (!raw) return json({ ok: false, error: "symbols 파라미터가 필요합니다" }, 400, headers);

  const symbols = [];
  raw.split(",").forEach(function (s) {
    const t = s.trim();
    if (t && symbols.indexOf(t) < 0 && symbols.length < MAX_SYMBOLS) symbols.push(t);
  });

  const wanted = symbols.concat([FX_SYMBOL]);
  const settled = await Promise.allSettled(wanted.map(quote));
  const quotes = {}, errors = [];
  let fx = null;

  settled.forEach(function (r, i) {
    if (r.status === "fulfilled") {
      if (wanted[i] === FX_SYMBOL) fx = r.value.price;
      else quotes[wanted[i]] = r.value;
    } else {
      errors.push(String(r.reason && r.reason.message ? r.reason.message : r.reason));
    }
  });

  return json({ ok: Object.keys(quotes).length > 0, at: new Date().toISOString(),
                fx: { USDKRW: fx }, quotes: quotes, errors: errors }, 200, headers);
}

// ── 종목 검색 ──────────────────────────────────────────
async function handleSearch(url, headers) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ ok: false, error: "q 파라미터가 필요합니다", results: [] }, 400, headers);

  try {
    const data = await yahoo("/v1/finance/search?q=" + encodeURIComponent(q) +
                             "&quotesCount=10&newsCount=0&listsCount=0");
    const results = (data && data.quotes ? data.quotes : [])
      .filter(function (r) { return r.symbol && (r.quoteType === "EQUITY" || r.quoteType === "ETF"); })
      .slice(0, 8)
      .map(function (r) {
        return { symbol: r.symbol, name: r.shortname || r.longname || r.symbol,
                 exchange: r.exchDisp || r.exchange || "", type: r.quoteType };
      });
    return json({ ok: true, results: results }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e.message || e), results: [] }, 200, headers);
  }
}

// ── 스크린샷 읽기 ──────────────────────────────────────
async function handleImport(request, url, env, headers) {
  if (!env || !env.ANTHROPIC_API_KEY) {
    return json({ ok: false, error: "워커에 ANTHROPIC_API_KEY 시크릿이 없습니다" }, 501, headers);
  }
  const mediaType = url.searchParams.get("mt") || "image/png";
  const b64 = (await request.text()).trim();
  if (!b64) return json({ ok: false, error: "이미지가 비어 있습니다" }, 400, headers);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: EXTRACT_PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return json({ ok: false, error: "Claude API " + res.status, detail: detail.slice(0, 300) }, 200, headers);
  }

  const out = await res.json();
  const text = (out.content || [])
    .filter(function (b) { return b.type === "text"; })
    .map(function (b) { return b.text; }).join("");
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return json({ ok: true, rows: parsed.rows || [], usage: out.usage || null }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: "읽은 결과를 해석하지 못했습니다", raw: cleaned.slice(0, 400) }, 200, headers);
  }
}

// ── 진입점 ────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = headersFor(origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers });
    if (!headers["Access-Control-Allow-Origin"]) {
      return json({ ok: false, error: "허용되지 않은 주소입니다" }, 403, headers);
    }

    try {
      if (url.pathname === "/search") return await handleSearch(url, headers);
      if (url.pathname === "/import") {
        if (request.method !== "POST") return json({ ok: false, error: "POST로 보내주세요" }, 405, headers);
        return await handleImport(request, url, env, headers);
      }
      if (request.method !== "GET") return json({ ok: false, error: "GET만 받습니다" }, 405, headers);
      return await handleQuotes(url, headers);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 200, headers);
    }
  },
};
