// 표기 규칙 (SPEC §6.4). 기존 index.html 함수 그대로.

export function won(n) {
  const s = Math.round(Math.abs(n)).toLocaleString("ko-KR");
  return (n < 0 ? "−" : "") + s + "원";
}

export function pct(n) {
  if (!Number.isFinite(n)) return "0%";
  return (Math.abs(n) >= 1 ? n.toFixed(1) : n.toFixed(2)) + "%";
}

/** 소수 6자리까지, 정수면 정수. */
export function qtyStr(q) {
  if (Math.abs(q - Math.round(q)) < 1e-9) return String(Math.round(q));
  return String(parseFloat(q.toFixed(6)));
}
