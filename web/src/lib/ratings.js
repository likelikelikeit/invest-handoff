// 투자의견 등급 8단계 (SPEC §5.2.2). worker/src/lib/ratings.js와 같은 표.
export const RATINGS = [
  { label: "적극 매수", score: 4 },
  { label: "매수", score: 3 },
  { label: "비중 확대", score: 2 },
  { label: "보유", score: 1 },
  { label: "중립", score: 0 },
  { label: "비중 축소", score: -1 },
  { label: "매도", score: -2 },
  { label: "적극 매도", score: -3 },
];

/** 등급 칩 색: 긍정 빨강 계열, 부정 파랑 계열 (한국 관례), 중립 회색 */
export function ratingTone(score) {
  return score > 0 ? "up" : score < 0 ? "down" : "flat";
}

export const HORIZONS = [3, 6, 12, 24];
