// 판정 계기판 표시용 (계산은 Worker lib/tech.js). SPEC §5.6.

export const INDICATOR_INFO = {
  rsi14: { label: "RSI(14)", fmt: (v) => v.toFixed(1) },
  dev20: { label: "20일선 이격", fmt: (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%" },
  dev60: { label: "60일선 이격", fmt: (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%" },
  bb_pctb: { label: "볼린저 %B", fmt: (v) => v.toFixed(2) },
  vol_ratio: { label: "거래량 / 20일 평균", fmt: (v) => v.toFixed(1) + "배" },
};

/** 규칙 편집에서 쓰는 단위: 이격은 %로 보여주고 저장은 비율 */
export const RULE_UNITS = {
  rsi14: { unit: "", scale: 1, step: 1 },
  dev20: { unit: "%", scale: 100, step: 0.5 },
  dev60: { unit: "%", scale: 100, step: 0.5 },
  bb_pctb: { unit: "", scale: 1, step: 0.05 },
  vol_ratio: { unit: "배", scale: 1, step: 0.1 },
};

/** 라벨 색: 계기판 신호등 (SPEC §5.6.4). 매수 high=단기 과열(빨강), low=진입 부담 낮음(초록). 매도는 의미가 뒤집힌다. */
export function labelTone(side, label) {
  if (label === "neutral") return "amber";
  if (side === "buy") return label === "high" ? "red" : "green";
  return label === "low" ? "green" : "red";
}

export const ACTIONS = {
  buy: [["bought", "샀다"], ["partial", "나눠 샀다"], ["waited", "기다렸다"], ["skipped", "안 샀다"]],
  sell: [["bought", "팔았다"], ["partial", "나눠 팔았다"], ["waited", "기다렸다"], ["skipped", "안 팔았다"]],
};

export function actionLabel(side, action) {
  return (ACTIONS[side] || []).find((a) => a[0] === action)?.[1] ?? null;
}

export function sideLabel(side) {
  return side === "sell" ? "매도 적합도" : "매수 적합도";
}

export const LABEL_TEXT = {
  buy: { high: "단기 과열", neutral: "중립 / 분할 접근", low: "진입 부담 낮음" },
  sell: { high: "단기 침체", neutral: "중립", low: "청산 부담 낮음" },
};

/** 판정 이후 수익률 (1주·1개월 사실 표시용) */
export function afterReturn(call, key) {
  const p = call[key];
  return p != null && call.price_at > 0 ? (p / call.price_at - 1) * 100 : null;
}
