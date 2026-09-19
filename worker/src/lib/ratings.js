// 투자의견 등급 8단계 (SPEC §5.2.2). 라벨은 [확정], 점수 매핑은 [제안].
// 커버리지 평가이며 실제 매매 의사가 아니다. web/src/lib/ratings.js와 같은 표를 쓴다.
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

export function scoreOf(label) {
  const r = RATINGS.find((x) => x.label === label);
  return r ? r.score : null;
}
