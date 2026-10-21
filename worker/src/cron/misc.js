// 매일 23:30 UTC (KST 08:30): 거시 시계열(FRED·ECOS) (SPEC §5.8). 5분 틱(cron/tick.js)이 하루 한 번 부른다.
// 실적일은 2026-10-22부터 여기서 받지 않는다: 매일 도는 재무 순환(refreshFundamentals)이 야후 calendarEvents에서
// 같이 받는다(종목이 많아져도 순환이 나눠서 처리한다).
// 외부 요청: FRED 5 + ECOS 1. D1: 시리즈 목록 1 + 거시 6 + meta 1.
// 쓰기를 줄이려고 값이 바뀐 행만 갱신한다(upsert WHERE value <>). 최근 60일만 받는다.

import { fredSeries } from "../sources/fred.js";
import { ecosSeries } from "../sources/ecos.js";
import { upsertMacroStmt } from "../lib/macro.js";
import { nowIso } from "../lib/time.js";

/** 백필이면 과거 전체(기준금리 경로 그래프용), 아니면 최근 60일 */
function startDate(now, backfill) {
  if (backfill) return "2015-01-01";
  return new Date(now.getTime() - 60 * 86400000).toISOString().slice(0, 10);
}

export async function runMisc(env, now = new Date(), { backfill = false } = {}) {
  const errors = [];
  const stmts = [];
  const start = startDate(now, backfill);
  const end = now.toISOString().slice(0, 10);

  const { results: series } = await env.DB.prepare(
    "SELECT series_id, source, fetch_key FROM macro_series WHERE source IN ('fred', 'ecos')"
  ).all();
  const macroSettled = await Promise.allSettled(series.map((s) =>
    s.source === "fred" ? fredSeries(env.FRED_API_KEY, s.fetch_key, start) : ecosSeries(env.ECOS_API_KEY, s.fetch_key, start, end)));
  const macro = {};
  macroSettled.forEach((r, i) => {
    const id = series[i].series_id;
    if (r.status === "fulfilled") {
      macro[id] = r.value.length;
      if (r.value.length) stmts.push(upsertMacroStmt(env, id, r.value));
    } else errors.push(id + ": " + String(r.reason?.message || r.reason));
  });

  if (stmts.length) await env.DB.batch(stmts);
  const report = { at: nowIso(now), macro, errors };
  await env.DB.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES ('cron:misc', ?1, ?2) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(JSON.stringify(report), report.at).run();
  return report;
}
