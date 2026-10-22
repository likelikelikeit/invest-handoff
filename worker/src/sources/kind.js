// KIND(한국거래소 기업공시채널) IR 일정 어댑터. 비공식 화면이라 실패해도 앱은 그대로 돈다(SPEC §5.7).
// 국내 실적 발표일의 주 소스다: 회사가 '2026년 3분기 경영실적 발표' 같은 IR 일정을 날짜·시각과 함께 미리 올린다.
// (SK하이닉스처럼 잠정실적 공시 전에 IR 개최 안내로 정확한 일시가 먼저 나오는 경우를 잡는다.)
// DART 잠정실적 공시는 보조다(실제 발표 확인 + 작년 패턴으로 예상일) — sources/dart.js.

const URL_IR = "https://kind.krx.co.kr/corpgeneral/irschedule.do";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 한 종목의 IR 일정. code는 6자리 종목코드. → [{title, place, date, time}] */
export async function kindIrSchedule(code, from, to) {
  const body = new URLSearchParams({
    method: "searchIRScheduleSub", forward: "searchirschedule_sub", currentPageSize: "100", pageIndex: "1",
    orderMode: "0", orderStat: "D", searchCodeType: "number", repIsuSrtCd: "A" + code, fromDate: from, toDate: to,
  });
  const res = await fetch(URL_IR, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("KIND IR 일정이 " + res.status + " 응답");
  return parseKindIr(await res.text());
}

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** 목록 HTML → 행. 칸: 번호, 회사명, 제목, 장소, 일자, 시작시간. 순수 함수. */
export function parseKindIr(html) {
  const out = [];
  for (const row of String(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(strip);
    if (cells.length < 6 || !/^\d{4}-\d\d-\d\d$/.test(cells[4])) continue;
    out.push({ title: cells[2], place: cells[3], date: cells[4], time: /^\d\d:\d\d$/.test(cells[5]) ? cells[5] : null });
  }
  return out;
}

/**
 * 실적 발표 IR인지. 'N분기 경영실적 발표', 'Q3 2026 Earnings Release', 'To discuss FY 2026 Q3 Financial Results',
 * 컨퍼런스콜·생중계 '실적 설명'은 맞다. 해외 NDR·Corporate Day·기관 탐방의 '경영실적 설명'은 아니다.
 */
export function isEarningsIr(r) {
  const t = r.title;
  if (/Corporate Day|NDR|탐방|간담회|컨퍼런스 참가|포럼|기관투자자 미팅|이해 ?(증진|제고)/i.test(t)) return false;
  if (/(실적|Earnings|Financial Results).*(발표|설명회|Release|Conference)|Financial Results|실적발표/i.test(t)) return true;
  return /실적/.test(t) && /컨퍼런스 ?콜|conference ?call|webcast|생중계/i.test(r.place + " " + t);
}

/** 오늘 이후 가장 가까운 실적 발표 IR → {date, time, confirmed:1, detail} 또는 null. today는 KST. */
export function krEarningsFromKind(rows, today) {
  const next = rows.filter((r) => r.date >= today && isEarningsIr(r)).sort((a, b) => (a.date + (a.time || "") < b.date + (b.time || "") ? -1 : 1))[0];
  if (!next) return null;
  // 같은 날 국문·영문 두 줄이 올라오면 국문 제목을 남긴다
  const ko = rows.find((r) => r.date === next.date && isEarningsIr(r) && /[가-힣]/.test(r.title)) || next;
  return { date: next.date, time: next.time, confirmed: 1, detail: { basis: "KIND IR 일정", title: ko.title } };
}
