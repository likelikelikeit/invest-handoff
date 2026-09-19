// 시각은 ISO 8601 + KST 오프셋, 초 단위까지 (SPEC §3.2 views.created_at 규칙을 전체에 쓴다).

const KST_MS = 9 * 60 * 60 * 1000;

export function nowIso(d = new Date()) {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 19) + "+09:00";
}

/** KST 기준 'YYYY-MM-DD' */
export function todayKst(d = new Date()) {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
}
