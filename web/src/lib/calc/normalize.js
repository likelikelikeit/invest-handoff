// 공통 입력 계층 (SPEC §5.1). 기존 index.html의 normalize를 그대로 옮겼다.
// 손입력 · 검색 · 스크린샷 · (나중에) 증권사 API 모두 이 함수를 거친다.
// 결과의 price/avg는 원화 환산값이다.

export function guessYsym(tick) {
  return /^[0-9]{6}$/.test(tick) ? tick + ".KS" : tick;
}

/**
 * 역산한 수량이 정수에 아주 가까우면 정수로 맞춘다 (15.999968 → 16).
 * 나눗셈 찌꺼기를 그대로 저장하면 다음에 제대로 입력할 때 "수량이 바뀌었다"로 잡힌다.
 * 소수점 거래(0.065주, 4.134주)는 정수에서 멀어 건드리지 않는다.
 */
export function snapInteger(q) {
  const r = Math.round(q);
  return r >= 1 && Math.abs(q - r) <= Math.max(1e-6, r * 1e-5) ? r : q;
}

export function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * row: {name, tick|ticker, ysym?, sec?, currency?, qty, avgPrice|avg, currentPrice|price, marketValue, profit}
 * → {name, tick, mkt, ysym, sec, price, avg, qty} (원화) 또는 쓸 수 없으면 null
 */
export function normalize(row, fx) {
  const tick = String(row.tick || row.ticker || "").trim().toUpperCase();
  const name = String(row.name || "").trim();
  const isKR = /^[0-9]{6}$/.test(tick);
  const rate = row.currency === "USD" && fx ? fx : 1;

  let qty = num(row.qty);
  let avg = num(row.avgPrice != null ? row.avgPrice : row.avg);
  let price = num(row.currentPrice != null ? row.currentPrice : row.price);
  const mv = num(row.marketValue);
  const pl = num(row.profit);

  // 화면에 수량이 없으면 평가금액·손익·평단으로 역산한다
  if (!(qty > 0) && mv > 0 && avg > 0) {
    const cost = mv - (pl || 0);
    if (cost > 0) qty = snapInteger(cost / avg);
  }
  if (!(price > 0) && mv > 0 && qty > 0) price = mv / qty;
  if (!(price > 0) && avg > 0) price = avg;
  if (!(avg > 0)) avg = price;

  if (!name || !(qty > 0) || !(price > 0)) return null;

  return {
    name,
    tick: tick || name.slice(0, 6),
    mkt: isKR ? "KR" : "US",
    ysym: row.ysym || guessYsym(tick || name),
    sec: row.sec || "기타",
    price: price * rate,
    avg: avg * rate,
    qty,
  };
}

/** normalize 결과 → 서버 POST /portfolio/merge 행. 평단은 원화 환산값이라 avg_ccy='KRW'. */
export function toMergeRow(n) {
  return {
    name: n.name,
    ticker: n.tick,
    ysym: n.ysym,
    market: n.mkt,
    currency: n.mkt === "KR" ? "KRW" : "USD",
    sector: n.sec,
    qty: n.qty,
    avg_price: n.avg,
    avg_ccy: "KRW",
  };
}

/**
 * 국내 보통주 ISIN: KR7 + 6자리 코드 + "00" + 검사 숫자.
 * 로고(Brandfetch isin/ 경로)용. 우선주·ETF 등은 다를 수 있어 로고가 없으면 레터마크로 떨어진다.
 */
export function krIsin(code) {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const body = "KR7" + code + "00";
  // ISIN 검사 숫자: 문자를 숫자로 풀어 쓴 뒤 Luhn
  const digits = body.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body + ((10 - (sum % 10)) % 10);
}
