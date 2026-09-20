// 앱 전역 데이터: 보유·현금(D1)과 시세(야후 지연). 화면들은 여기서 읽는다.

import { api } from "./api.js";
import { holdingFromPosition, cashParts } from "./calc/portfolio.js";

export const data = $state({
  positions: [],
  cash: [],
  quotes: {},
  fx: null,
  quoteAt: null, // 가장 최근 체결 시각 (야후)
  fetchedAt: null, // 우리가 받아온 시각
  loading: false,
  error: "",
  quoteErrors: [],
  market: [], // 시장 띠: 지수·환율 securities
  views: [], // 종목별 현재 투자의견 (/views/latest)
  drafts: [], // MCP가 넣은 대기 중 제안 (SPEC §7.9)
  loaded: false,
  offline: false,
  cachedAt: null,
});

/** 종목 통화 기준 지금 가격 (의견 상승여력 계산용) */
export function nativePrice(ysym) {
  const q = data.quotes[ysym];
  return q && typeof q.price === "number" ? q.price : null;
}

export async function loadViews() {
  try {
    data.views = (await api("/views/latest")).views;
    const missing = data.views.map((v) => v.ysym).filter((s) => !data.quotes[s]);
    if (missing.length) await refreshQuotes(missing);
  } catch {
    data.views = [];
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("views-changed"));
}

/** MCP가 넣은 초안. 실패해도 앱은 그대로 돈다. */
export async function loadDrafts() {
  try {
    data.drafts = (await api("/drafts?status=pending")).drafts;
  } catch {
    data.drafts = [];
  }
}

/** 보유 → 원화 holding 목록 (평가액 큰 순) */
export function holdings() {
  return data.positions
    .map((p) => holdingFromPosition(p, data.quotes[p.security.ysym], data.fx))
    .sort((a, b) => b.qty * b.price - a.qty * a.price);
}

export function cash() {
  return cashParts(data.cash, data.fx);
}

export async function refreshQuotes(extra = []) {
  const syms = [...new Set(data.positions.map((p) => p.security.ysym).concat(data.market.map((s) => s.ysym), extra))];
  if (!syms.length) return;
  try {
    const q = await api("/quotes?symbols=" + encodeURIComponent(syms.join(",")));
    if (q._offline) { data.offline = true; data.cachedAt = q._cached_at || data.cachedAt; }
    else data.offline = false;
    data.quotes = { ...data.quotes, ...q.quotes };
    if (q.fx && q.fx.USDKRW) data.fx = q.fx.USDKRW;
    const times = Object.values(q.quotes).map((x) => x.time).filter(Boolean).sort();
    data.quoteAt = times.length ? times[times.length - 1] : q.at;
    data.fetchedAt = q.at;
    data.quoteErrors = q.errors || [];
  } catch (e) {
    // 시세 실패는 앱을 죽이지 않는다. 평단으로 두고 "데이터 없음" 표시.
    data.quoteErrors = [e.message];
  }
}

// 시장 띠 순서 (SPEC §4.2 블록 1)
const MARKET_ORDER = ["^KS11", "^GSPC", "KRW=X", "^TNX"];

export async function load() {
  data.loading = true;
  data.error = "";
  try {
    const [pf, secs] = await Promise.all([api("/portfolio"), api("/securities")]);
    data.offline = Boolean(pf._offline || secs._offline);
    data.cachedAt = pf._cached_at || secs._cached_at || null;
    data.positions = pf.positions;
    data.cash = pf.cash;
    data.market = secs.securities
      .filter((s) => MARKET_ORDER.includes(s.ysym))
      .sort((a, b) => MARKET_ORDER.indexOf(a.ysym) - MARKET_ORDER.indexOf(b.ysym));
    data.loaded = true;
    await refreshQuotes(data.market.map((s) => s.ysym));
    await loadViews();
    await loadDrafts();
  } catch (e) {
    data.error = e.message;
  } finally {
    data.loading = false;
  }
}

/** 한 종목 시세만 (검색해서 고를 때) */
export async function quoteOne(ysym) {
  const q = await api("/quotes?symbols=" + encodeURIComponent(ysym));
  if (q.fx && q.fx.USDKRW) data.fx = q.fx.USDKRW;
  return { quote: q.quotes[ysym] || null, fx: q.fx && q.fx.USDKRW };
}
