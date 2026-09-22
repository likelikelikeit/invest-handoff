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

/** 화면 표시용 수량. 계산·입력 원본은 보존하고 정수에 매우 가까운 가져오기 오차만 숨긴다. */
export function qtyDisplay(q) {
  if (Math.abs(q - Math.round(q)) < 1e-4) return String(Math.round(q));
  return qtyStr(q);
}

export function usd(n) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 종목 종류에 맞는 값 표기 함수. sec = {ysym, currency, asset_class}
 *   금리(^TNX) 4.253%  ·  지수 2,650.12  ·  환율 1,385.20원  ·  주식 원/달러
 */
export function valueFmt(sec) {
  if (sec.ysym === "^TNX") return (v) => v.toFixed(3) + "%";
  if (sec.asset_class === "index") return (v) => v.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (sec.asset_class === "fx") return (v) => v.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "원";
  return sec.currency === "USD" ? usd : won;
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

/**
 * 목록용 날짜 (KST). 올해는 "8/26", 다른 해는 "2025/8/26".
 * 시각까지 앞에 내세우지 않는다 — 기록이 쌓이면 시:분은 소음이다.
 */
export function dayStamp(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = (x) => {
    const p = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(x);
    const g = (t) => p.find((v) => v.type === t)?.value;
    return { y: g("year"), m: g("month"), d: g("day") };
  };
  const a = parts(d);
  const b = parts(now);
  return (a.y === b.y ? "" : a.y + "/") + a.m + "/" + a.d;
}

/** "2027-08-26"(또는 ISO 시각) → "2027/08/26". 투자의견 화면의 전체 날짜 표기 [2026-09-23]. */
export function slashDate(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(s || ""));
  return m ? m[1] + "/" + m[2] + "/" + m[3] : "";
}

export function parseNum(v) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 핵심 논리·리스크 본문 (SPEC §5.2.1). 쓴 모양을 그대로 살린다.
 *   빈 줄로 나눠 쓰면 → 문단 (문단 안 줄바꿈도 그대로)
 *   한 줄씩 쓰면      → 불릿
 * 길이 제한은 없다. 길게 쓰면 문단 하나가 길어질 뿐이다.
 */
export function textBlocks(text) {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  if (/\n[ \t]*\n/.test(t)) {
    return t.split(/\n[ \t]*\n+/).map((b) => b.trim()).filter(Boolean).map((body) => ({ kind: "p", text: body }));
  }
  return t.split("\n").map((l) => l.trim()).filter(Boolean).map((body) => ({ kind: "li", text: body }));
}
