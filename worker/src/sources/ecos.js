// 한국은행 ECOS 어댑터. 무료 인증키(ECOS_API_KEY). 한국 기준금리.
// StatisticSearch/{키}/json/kr/{시작}/{끝}/{통계코드}/{주기}/{검색시작}/{검색끝}/{항목코드}
// fetch_key 형식: "통계코드/주기/항목코드" (예: 722Y001/D/0101000 = 한국은행 기준금리, 일별)

const API = "https://ecos.bok.or.kr/api/StatisticSearch/";

/** ECOS TIME(YYYYMMDD | YYYYMM | YYYY) → 'YYYY-MM-DD' */
export function ecosDate(t) {
  const s = String(t || "");
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
  if (/^\d{6}$/.test(s)) return s.slice(0, 4) + "-" + s.slice(4, 6) + "-01";
  if (/^\d{4}$/.test(s)) return s + "-01-01";
  return null;
}

/** 응답 → [{date, value}]. 오류 응답(RESULT)은 한국어 메시지로 throw, '데이터 없음(INFO-200)'은 빈 배열. */
export function parseEcos(data) {
  if (data?.RESULT) {
    if (data.RESULT.CODE === "INFO-200") return [];
    throw new Error("ECOS " + data.RESULT.CODE + ": " + data.RESULT.MESSAGE);
  }
  return (data?.StatisticSearch?.row || [])
    .map((r) => ({ date: ecosDate(r.TIME), value: Number(r.DATA_VALUE) }))
    .filter((r) => r.date && Number.isFinite(r.value));
}

const compact = (d, cycle) => (cycle === "D" ? d.replace(/-/g, "") : cycle === "M" ? d.slice(0, 7).replace("-", "") : d.slice(0, 4));

export async function ecosSeries(apiKey, fetchKey, start, end) {
  if (!apiKey) throw new Error("ECOS_API_KEY가 없습니다");
  const [stat, cycle, item] = String(fetchKey).split("/");
  const url = API + encodeURIComponent(apiKey) + "/json/kr/1/10000/" + stat + "/" + cycle + "/" +
    compact(start, cycle) + "/" + compact(end, cycle) + "/" + item;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("ECOS " + res.status);
  return parseEcos(await res.json());
}
