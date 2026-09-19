// 표기 규칙 (SPEC §6.4). won/wonSigned/pct/pctSigned/qtyStr는 기존 index.html 함수 그대로.

export function won(n) {
  const s = Math.round(Math.abs(n)).toLocaleString("ko-KR");
  return (n < 0 ? "−" : "") + s + "원";
}

export function wonSigned(n) {
  if (Math.abs(n) < 1) return "0원";
  return (n > 0 ? "+" : "−") + Math.round(Math.abs(n)).toLocaleString("ko-KR") + "원";
}

export function pct(n) {
  if (!Number.isFinite(n)) return "0%";
  return (Math.abs(n) >= 1 ? n.toFixed(1) : n.toFixed(2)) + "%";
}

export function pctSigned(n) {
  if (!Number.isFinite(n)) return "0%";
  return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

/** 소수 6자리까지, 정수면 정수. */
export function qtyStr(q) {
  if (Math.abs(q - Math.round(q)) < 1e-9) return String(Math.round(q));
  return String(parseFloat(q.toFixed(6)));
}

export function usd(n) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 달러 종목은 달러 병기: "$212.34 · 293,338원" */
export function priceStr(h) {
  if (h.currency === "USD" && h.priceNative != null) return usd(h.priceNative) + " · " + won(h.price);
  return won(h.price);
}

/** 상승 빨강 · 하락 파랑 (한국 관례). 기존 cls()와 같은 문턱. */
export function tone(n) {
  return n > 0.5 ? "up" : n < -0.5 ? "down" : "flat";
}

/** 퍼센트용 문턱 (0.005%p) */
export function tonePct(n) {
  return n > 0.005 ? "up" : n < -0.005 ? "down" : "flat";
}

/** ISO 시각 → "9/19 16:00" (KST) */
export function stamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return g("month") + "/" + g("day") + " " + g("hour") + ":" + g("minute");
}

export function parseNum(v) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
