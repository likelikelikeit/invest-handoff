// 매일 23:30 UTC (KST 08:30): 거시 시계열(FRED·ECOS) + 미국 보유·관심 종목 다음 실적일 (SPEC §5.7, §5.8).
// SPEC §7.3은 거시(23:30)와 어닝일(00:00)을 나눴지만, 무료 플랜 크론 트리거가 계정당 5개라 하나로 합쳤다.
// 외부 요청: FRED 3 + ECOS 1 + 야후 실적일 종목 수(최대 15) + 야후 세션 2 ≈ 21개.
// D1 쿼리: 시리즈 목록 1 + 거시 4 + 실적일 종목당 2(지우기·넣기) × 15 + 세션·meta 몇 개 ≈ 40개 (한도 50).
// 쓰기를 줄이려고 값이 바뀐 행만 갱신한다(upsert WHERE value <>). 최근 60일만 받는다.

import { fredSeries } from "../sources/fred.js";
import { ecosSeries } from "../sources/ecos.js";
import { yahooEarningsDate } from "../sources/yahoo.js";
import { upsertMacroStmt } from "../lib/macro.js";
import { replaceEarningsStmts } from "../lib/fundamentals.js";
import { nowIso } from "../lib/time.js";

export const CRON_MISC = "30 23 * * *";
const MAX_EARNINGS = 15;

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

  // 다음 실적일: 미국 보유·관심 equity (국내는 깨끗한 소스가 없어 수동, SPEC §5.7)
  const { results: us } = await env.DB.prepare(
    "SELECT id, ysym FROM securities WHERE archived_at IS NULL AND market = 'US' AND asset_class = 'equity' " +
    "AND (id IN (SELECT security_id FROM positions) OR id IN (SELECT security_id FROM watchlist)) ORDER BY id LIMIT ?1"
  ).bind(MAX_EARNINGS).all();
  let earnings = 0;
  // 야후에 버스트를 만들지 않게 순서대로
  for (const s of us) {
    try {
      const d = await yahooEarningsDate(env, s.ysym, now);
      if (d && d >= end) {
        stmts.push(...replaceEarningsStmts(env, s.id, d, nowIso(now), end));
        earnings++;
      }
    } catch (e) {
      errors.push(s.ysym + ": " + String(e.message || e));
    }
  }

  if (stmts.length) await env.DB.batch(stmts);
  const report = { at: nowIso(now), macro, earnings, errors };
  await env.DB.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES ('cron:misc', ?1, ?2) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(JSON.stringify(report), report.at).run();
  return report;
}
