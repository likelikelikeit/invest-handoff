// 일정·거시 표시용 순수 함수 (SPEC §5.7, §5.8).

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function addDays(date, n) {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → '10/29(목)' */
export function dayLabel(date) {
  const d = new Date(date + "T00:00:00Z");
  return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "(" + WEEK[d.getUTCDay()] + ")";
}

/** 오늘이면 '오늘', 내일 '내일', 그 뒤 'D-n' */
export function dday(date, today) {
  const n = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  if (n === 0) return "오늘";
  if (n === 1) return "내일";
  if (n > 1) return "D-" + n;
  return n + "일";
}

export const KIND_LABEL = { earnings: "실적", macro: "거시", corporate: "기업", custom: "메모" };

/** 표시 제목: 종목 실적은 종목 이름을 앞에 */
export function eventTitle(e) {
  if (e.kind === "earnings" && e.security_name) return e.security_name + " 실적 발표";
  // 제목에 종목 이름이 이미 있으면 앞에 또 붙이지 않는다
  if (e.security_name && e.kind !== "macro" && !e.title.includes(e.security_name)) return e.security_name + " · " + e.title;
  return e.title;
}

/** 월별로 묶기 [{month:'2026-10', label:'2026년 10월', items:[...]}] */
export function groupByMonth(events) {
  const out = [];
  for (const e of events) {
    const m = e.date.slice(0, 7);
    let g = out[out.length - 1];
    if (!g || g.month !== m) {
      g = { month: m, label: m.slice(0, 4) + "년 " + Number(m.slice(5)) + "월", items: [] };
      out.push(g);
    }
    g.items.push(e);
  }
  return out;
}

/** 시리즈의 최신 값과 직전과 다른 마지막 값(변화) */
export function latestWithChange(points) {
  if (!points || !points.length) return null;
  const [date, value] = points[points.length - 1];
  let prev = null;
  for (let i = points.length - 2; i >= 0; i--) {
    if (points[i][1] !== value) { prev = { date: points[i][0], value: points[i][1] }; break; }
  }
  return { date, value, prev };
}

/**
 * Fed 목표범위 하단·상단을 날짜별로 합친다.
 * 두 시리즈의 갱신일이 잠시 어긋나도 마지막 관측값을 이어서 쓴다.
 */
export function fedTargetRanges(series) {
  const events = new Map();
  for (const [date, value] of series?.FED_TARGET_LOWER?.points || []) {
    events.set(date, { ...(events.get(date) || {}), lower: value });
  }
  for (const [date, value] of series?.FED_TARGET_UPPER?.points || []) {
    events.set(date, { ...(events.get(date) || {}), upper: value });
  }
  let lower = null;
  let upper = null;
  const out = [];
  for (const date of [...events.keys()].sort()) {
    const event = events.get(date);
    if (Number.isFinite(event.lower)) lower = event.lower;
    if (Number.isFinite(event.upper)) upper = event.upper;
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      out.push({ date, lower, upper, value: (lower + upper) / 2 });
    }
  }
  return out;
}

/** 최신 Fed 목표범위와 직전의 다른 목표범위. value는 차트용 중간값이다. */
export function latestFedTarget(series) {
  const ranges = fedTargetRanges(series);
  if (!ranges.length) return null;
  const last = ranges.at(-1);
  let prev = null;
  for (let i = ranges.length - 2; i >= 0; i--) {
    const row = ranges[i];
    if (row.lower !== last.lower || row.upper !== last.upper) {
      prev = row;
      break;
    }
  }
  return { ...last, prev };
}

/**
 * 금리 경로 (SPEC §5.8): Fed 목표범위 중간값 + 2년물(시장 기대 대용치) + 점도표 중간값(연말 점).
 * 점도표는 마지막 목표범위 날짜에서 시작해 연말 중간값으로 잇는다.
 */
export function ratePath(macro) {
  const s = macro?.series || {};
  const fed = fedTargetRanges(s).map(({ date, value }) => [date, value]);
  const dots = macro?.dots?.points || [];
  const start = fed.length ? { time: fed[fed.length - 1][0], value: fed[fed.length - 1][1] } : null;
  return {
    fed: fed.map(([time, value]) => ({ time, value })),
    two: (s.DGS2?.points || []).map(([time, value]) => ({ time, value })),
    bok: (s.BOK_BASE?.points || []).map(([time, value]) => ({ time, value })),
    dots: start && dots.length ? [start, ...dots.filter(([d]) => d > start.time).map(([time, value]) => ({ time, value }))] : [],
  };
}
