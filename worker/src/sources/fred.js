// FRED (세인트루이스 연준) 어댑터. 무료 키(FRED_API_KEY). 미국 기준금리·국채금리.
// https://fred.stlouisfed.org/docs/api/fred/series_observations.html

const API = "https://api.stlouisfed.org/fred/series/observations";

/** observations 응답 → [{date, value}]. 값이 '.'(결측)인 날은 뺀다. */
export function parseFred(data) {
  return (data?.observations || [])
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => /^\d{4}-\d\d-\d\d$/.test(o.date) && Number.isFinite(o.value));
}

export async function fredSeries(apiKey, seriesId, start) {
  if (!apiKey) throw new Error("FRED_API_KEY가 없습니다");
  const url = API + "?series_id=" + encodeURIComponent(seriesId) + "&api_key=" + encodeURIComponent(apiKey) +
    "&file_type=json&observation_start=" + start;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("FRED " + seriesId + " " + res.status);
  return parseFred(await res.json());
}
