// 거시 시계열 저장. 시리즈 하나를 json_each 쿼리 하나로 넣는다(D1 쿼리 한도).

export function upsertMacroStmt(env, seriesId, rows) {
  const packed = JSON.stringify(rows.map((r) => [r.date, r.value]));
  return env.DB.prepare(
    "INSERT INTO macro (series_id, date, value) SELECT ?1, json_extract(value,'$[0]'), json_extract(value,'$[1]') " +
    "FROM json_each(?2) WHERE true ON CONFLICT(series_id, date) DO UPDATE SET value = excluded.value " +
    "WHERE macro.value <> excluded.value"
  ).bind(seriesId, packed);
}

/** 점도표 시리즈 id: FED_DOTS_YYYYMM (SPEC §5.8 [제안]) */
export const dotsId = (sep) => "FED_DOTS_" + sep.replace("-", "");

/** 장기(Longer run)는 날짜가 없어 9999-12-31로 저장한다. 그래프에는 그리지 않고 숫자로만. */
export const LONG_RUN_DATE = "9999-12-31";
