// 네이버 모바일 증권 공개 JSON 어댑터 (비공식).
// 경로가 바뀌어도 이 파일만 교체하며, 호출자는 실패를 종목별 "데이터 없음"으로 처리한다.

const BASE = "https://m.stock.naver.com/api/stock/";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const EOK = 100_000_000; // 네이버 재무표의 손익 항목 단위: 억원

async function get(code, suffix) {
  const res = await fetch(BASE + encodeURIComponent(code) + suffix, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://m.stock.naver.com/" },
  });
  if (!res.ok) throw new Error("네이버 재무가 " + res.status + " 응답");
  return res.json();
}

export function naverNumber(value) {
  if (value == null || value === "" || value === "-") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function monthEnd(key) {
  if (!/^\d{6}$/.test(key)) return null;
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(4, 6));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function rowMap(info) {
  const rows = info?.financeInfo?.rowList || [];
  const find = (...names) => rows.find((r) => names.some((n) => r.title === n || r.title.startsWith(n)));
  return {
    revenue: find("매출액", "영업수익"),
    operating_income: find("영업이익"),
    net_income: find("당기순이익"),
    eps: find("EPS"),
    bps: find("BPS"),
  };
}

function column(row, key) {
  return naverNumber(row?.columns?.[key]?.value);
}

/** 네이버 분기/연간 표 → actual financials + consensus estimates. */
export function parseNaverFinance(data, periodType, asOf) {
  const titles = data?.financeInfo?.trTitleList || [];
  const rows = rowMap(data);
  const financials = [];
  const estimates = [];
  for (const t of titles) {
    const period_end = monthEnd(String(t.key || ""));
    if (!period_end) continue;
    const revenue = column(rows.revenue, t.key);
    const operating = column(rows.operating_income, t.key);
    const net = column(rows.net_income, t.key);
    const eps = column(rows.eps, t.key);
    const bps = column(rows.bps, t.key);
    const raw = JSON.stringify({ title: t, revenue, operating_income: operating, net_income: net, eps, bps });
    if (t.isConsensus === "Y") {
      if (periodType === "FY") {
        estimates.push({
          source: "naver", as_of: asOf, fiscal_year: Number(String(t.key).slice(0, 4)),
          eps, revenue: revenue == null ? null : revenue * EOK,
          target_price: null, rating_mean: null, n_analysts: null, raw,
        });
      }
      continue;
    }
    financials.push({
      period_end, period_type: periodType, source: "naver",
      revenue: revenue == null ? null : revenue * EOK,
      operating_income: operating == null ? null : operating * EOK,
      net_income: net == null ? null : net * EOK,
      eps, bps, ebitda: null, net_debt: null, shares_out: null, raw,
    });
  }
  return { financials, estimates };
}

/** integration.consensusInfo → 목표가·의견 평균. */
export function parseNaverConsensus(data, fallbackDate) {
  const x = data?.consensusInfo;
  if (!x) return null;
  const target = naverNumber(x.priceTargetMean);
  const rating = naverNumber(x.recommMean);
  if (target == null && rating == null) return null;
  return {
    source: "naver", as_of: x.createDate || fallbackDate, fiscal_year: null,
    eps: null, revenue: null, target_price: target, rating_mean: rating,
    n_analysts: null, raw: JSON.stringify(x),
  };
}

/** 국내 종목의 네이버 재무·컨센서스. 세 요청은 독립이라 병렬로 받는다. */
export async function naverFundamentals(ticker, now = new Date()) {
  const asOf = now.toISOString().slice(0, 10);
  const [integration, quarter, annual] = await Promise.all([
    get(ticker, "/integration"), get(ticker, "/finance/quarter"), get(ticker, "/finance/annual"),
  ]);
  const q = parseNaverFinance(quarter, "Q", asOf);
  const fy = parseNaverFinance(annual, "FY", asOf);
  const consensus = parseNaverConsensus(integration, asOf);
  return {
    financials: q.financials.concat(fy.financials),
    estimates: (consensus ? [consensus] : []).concat(fy.estimates),
    earningsDate: null,
  };
}
