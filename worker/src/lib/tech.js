// 매수·매도 판정 계기판 (SPEC §5.6). 순수 함수. 매수 여부를 판단하지 않고 단기 진입(청산) 부담만 요약한다.
// 예측형 문구를 만들지 않는다. 투자의견·성과평가와 섞지 않는다.

export const DEFAULT_RULES = {
  indicators: {
    rsi14: { overheat: 70, oversold: 30, weight: 1, enabled: true },
    dev20: { overheat: 0.05, oversold: -0.05, weight: 1, enabled: true },
    dev60: { overheat: 0.10, oversold: -0.10, weight: 1, enabled: true },
    bb_pctb: { overheat: 0.9, oversold: 0.1, weight: 1, enabled: true },
    vol_ratio: { overheat: 2.0, oversold: null, weight: 1, enabled: true, up_day_only: true },
  },
  aggregate: { high_threshold: 3, low_threshold: 3 },
};

export const INDICATOR_KEYS = ["rsi14", "dev20", "dev60", "bb_pctb", "vol_ratio"];

/** 라벨 문구 (SPEC §5.6.4). 매도 측은 같은 지표의 의미가 뒤집힌다. */
export const LABELS = {
  buy: { high: "단기 과열", neutral: "중립 / 분할 접근", low: "진입 부담 낮음" },
  sell: { high: "단기 침체", neutral: "중립", low: "청산 부담 낮음" },
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function sma(xs, n) {
  return xs.length >= n ? mean(xs.slice(-n)) : null;
}

/** 모표준편차 (볼린저 밴드 관례) */
export function stdev(xs, n) {
  if (xs.length < n) return null;
  const w = xs.slice(-n);
  const m = mean(w);
  return Math.sqrt(mean(w.map((x) => (x - m) ** 2)));
}

/** Wilder RSI(n): 첫 평균은 단순 평균, 이후 (prev × (n−1) + 현재) / n */
export function wilderRsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/**
 * 일봉(오름차순 [{date, close, high, low, volume}]) + 선택적 장중 현재가 → 지표 값과 참고 정보.
 * 장중 가격은 오늘 봉으로 붙여 가격 지표에 쓰고, 거래량 지표는 직전 완결 봉 기준(장중 거래량은 모자라서).
 */
export function computeIndicators(bars, live = null) {
  const done = bars.filter((b) => Number.isFinite(b.close));
  const closes = done.map((b) => b.close);
  let asOf = done.length ? done[done.length - 1].date : null;
  let intraday = false;
  if (live && Number.isFinite(live.price) && live.date && (!asOf || live.date > asOf)) {
    closes.push(live.price);
    asOf = live.date;
    intraday = true;
  }
  const price = closes[closes.length - 1];
  const s20 = sma(closes, 20);
  const s60 = sma(closes, 60);
  const sd20 = stdev(closes, 20);

  // 거래량: 직전 완결 봉과 그 봉까지 20일 평균, 그 봉이 상승일이었는지
  const vbars = done.filter((b) => Number.isFinite(b.volume) && b.volume > 0);
  let vol = null;
  if (vbars.length >= 21) {
    const last = vbars[vbars.length - 1];
    const idx = done.indexOf(last);
    const prev = idx > 0 ? done[idx - 1].close : null;
    vol = {
      ratio: last.volume / sma(vbars.map((b) => b.volume), 20),
      upDay: prev != null ? last.close > prev : null,
      date: last.date,
    };
  }

  // 참고: 52주 범위 안 위치 (최근 약 252거래일 고가·저가)
  const yr = done.slice(-252);
  let pos52 = null;
  if (yr.length >= 20) {
    const hi = Math.max(...yr.map((b) => b.high ?? b.close), price);
    const lo = Math.min(...yr.map((b) => b.low ?? b.close), price);
    pos52 = hi > lo ? (price - lo) / (hi - lo) : null;
  }

  return {
    as_of: asOf, intraday, price,
    values: {
      rsi14: wilderRsi(closes, 14),
      dev20: s20 ? price / s20 - 1 : null,
      dev60: s60 ? price / s60 - 1 : null,
      bb_pctb: sd20 ? (price - (s20 - 2 * sd20)) / (4 * sd20) : null,
      vol_ratio: vol ? vol.ratio : null,
    },
    vol,
    pos52,
  };
}

/**
 * 지표 값 + 규칙 → 판정. side: 'buy' | 'sell'.
 * verdict: '과열' | '침체' | '보통' | '데이터 없음' | '꺼짐'. 매도 측도 지표의 과열·침체 판정은 같고, 집계 라벨의 의미만 뒤집힌다.
 * 거래량은 상승일 급증만 과열로 센다. 하락일 급증은 참고(판정 미반영).
 */
export function judge(ind, rules, side = "buy") {
  const cfg = rules.indicators;
  const rows = [];
  let overheat = 0;
  let oversold = 0;
  for (const key of INDICATOR_KEYS) {
    const c = cfg[key] || {};
    const value = ind.values[key];
    let verdict = "보통";
    if (!c.enabled) verdict = "꺼짐";
    else if (value == null || !Number.isFinite(value)) verdict = "데이터 없음";
    else if (key === "vol_ratio") {
      const hot = c.overheat != null && value > c.overheat;
      if (hot && (!c.up_day_only || ind.vol?.upDay)) verdict = "과열";
    } else if (c.overheat != null && value > c.overheat) verdict = "과열";
    else if (c.oversold != null && value < c.oversold) verdict = "침체";
    const w = Number(c.weight) || 0;
    if (verdict === "과열") overheat += w;
    if (verdict === "침체") oversold += w;
    rows.push({ key, value, verdict, weight: w });
  }
  const a = rules.aggregate;
  // 매수: 과열 누적 → high(단기 과열), 침체 누적 → low(진입 부담 낮음)
  // 매도: 과열 누적 → low(청산 부담 낮음), 침체 누적 → high(단기 침체)
  let label = "neutral";
  if (overheat >= a.high_threshold) label = side === "buy" ? "high" : "low";
  else if (oversold >= a.low_threshold) label = side === "buy" ? "low" : "high";

  const refs = [];
  if (ind.pos52 != null) refs.push({ key: "pos52", value: ind.pos52 });
  const vc = cfg.vol_ratio || {};
  if (ind.vol && ind.vol.upDay === false && vc.overheat != null && ind.vol.ratio > vc.overheat) {
    refs.push({ key: "down_volume_spike", value: ind.vol.ratio });
  }
  return { label, label_text: LABELS[side][label], overheat_sum: overheat, oversold_sum: oversold, indicators: rows, refs };
}

/** 규칙 config 검증: 숫자만, 지표 5개 고정. 잘못되면 한국어 메시지로 throw. */
export function validateRules(cfg) {
  if (!cfg || typeof cfg !== "object") throw new Error("규칙이 비어 있습니다");
  const out = { indicators: {}, aggregate: {} };
  for (const key of INDICATOR_KEYS) {
    const c = cfg.indicators?.[key];
    if (!c) throw new Error(key + " 규칙이 없습니다");
    const num = (v, name, nullable) => {
      if (v == null && nullable) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(key + "." + name + "는 숫자여야 합니다");
      return n;
    };
    out.indicators[key] = {
      overheat: num(c.overheat, "overheat", true),
      oversold: num(c.oversold, "oversold", true),
      weight: num(c.weight ?? 1, "weight"),
      enabled: c.enabled !== false,
      ...(key === "vol_ratio" ? { up_day_only: c.up_day_only !== false } : {}),
    };
    const o = out.indicators[key];
    if (o.weight < 0) throw new Error(key + " 가중치는 0 이상이어야 합니다");
    if (o.overheat != null && o.oversold != null && o.oversold >= o.overheat) throw new Error(key + ": 침체 기준이 과열 기준보다 작아야 합니다");
  }
  for (const k of ["high_threshold", "low_threshold"]) {
    const n = Number(cfg.aggregate?.[k]);
    if (!(n > 0)) throw new Error("집계 기준 " + k + "는 0보다 커야 합니다");
    out.aggregate[k] = n;
  }
  return out;
}
