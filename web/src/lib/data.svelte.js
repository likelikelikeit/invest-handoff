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
  loaded: false,
});

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
  const syms = [...new Set(data.positions.map((p) => p.security.ysym).concat(extra))];
  if (!syms.length) return;
  try {
    const q = await api("/quotes?symbols=" + encodeURIComponent(syms.join(",")));
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

export async function load() {
  data.loading = true;
  data.error = "";
  try {
    const pf = await api("/portfolio");
    data.positions = pf.positions;
    data.cash = pf.cash;
    data.loaded = true;
    await refreshQuotes();
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
