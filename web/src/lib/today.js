// KST 기준 오늘 'YYYY-MM-DD' (의견 기간·진행률 계산용)
export function todayKst(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
