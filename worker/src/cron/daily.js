// 시세 크론 (SPEC §7.3, UTC 고정 — 서머타임 계산 없음). 5분 틱(cron/tick.js)이 시각을 보고 부른다.
//   runQuotes  장중 5분마다: 그 시장 종목·지수·환율의 오늘 봉을 바뀐 것만 쓴다
//   runDaily   장 마감 뒤 하루 한 번: 오늘 봉 확정 + 빈 날 메우기 + 보유 스냅샷 (+ 미국장: 의견 평가, 국내장: DART 보강)
//
// 한도 (호출당 외부 요청 50·D1 문장 50, lib/budget.js): 시세는 야후 v7 quote로 50종목씩 묶어 받고,
// 오늘 봉은 종목 수와 상관없이 D1 문장 1개로 쓴다. 그래서 종목이 100개를 넘어도 요청 2~3번이다.
// 종목별 일봉 이력(chart)은 새 종목 백필·빈 날 메우기에만, 남은 예산 안에서 쓴다.

import { history, quoteBatch, FX_SYMBOL } from "../sources/yahoo.js";
import { upsertPricesStmt, upsertBarsStmt, trackedSecurities, snapshotStmt, BACKFILL_MIN_ROWS } from "../lib/prices.js";
import { nowIso } from "../lib/time.js";
import { refreshFundamentals } from "./weekly.js";
import { fillCallPricesStmts } from "../routes/tech.js";
import { evaluateViews } from "../lib/view-evaluation.js";
import { meter } from "../lib/budget.js";

const BACKFILL_PER_RUN = 2;
const GAP_DAYS = 5;        // 마지막 봉이 이보다 오래된 종목은 일봉 이력으로 메운다
const GAP_PER_RUN = 5;
// DART 분기 이력이 이만큼 안 되는 국내 종목은 국내장 마감 때마다 하나씩, 한 사업연도(최대 4요청)씩 보강한다.
// 과거 이력을 한 번에 채우는 건 맥 미니의 scripts/dart-history.mjs가 한다.
export const DART_MIN_QUARTERS = 12;
export const DART_REPORTS_PER_RUN = 4;

/**
 * DART 고유번호가 있는데 DART 분기 행이 부족한 국내 종목 하나 (보유·관심, 숨김 제외).
 * 최근 3일 안에 시도한 종목은 건너뛴다(실패하거나 원래 분기가 적은 종목에 매일 헛요청하지 않게).
 */
export async function dartBackfillTarget(env, now = new Date()) {
  const since = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10);
  if (!env.DART_API_KEY) return null;
  return env.DB.prepare(
    "SELECT s.id, s.name, s.ticker, s.ysym, s.market, s.currency, s.dart_corp_code, " +
    "COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'dart:cursor:' || s.id), 0) AS dart_offset, " +
    "(SELECT COUNT(*) FROM financials f WHERE f.security_id = s.id AND f.source = 'dart' AND f.period_type = 'Q') AS n " +
    "FROM securities s WHERE s.archived_at IS NULL AND s.market = 'KR' AND s.asset_class = 'equity' AND s.dart_corp_code IS NOT NULL " +
    "AND (s.id IN (SELECT security_id FROM positions) OR s.id IN (SELECT security_id FROM watchlist)) " +
    "AND (SELECT COUNT(*) FROM financials f WHERE f.security_id = s.id AND f.source = 'dart' AND f.period_type = 'Q') < ?1 " +
    "AND NOT EXISTS (SELECT 1 FROM meta m WHERE m.key = 'dart:tried:' || s.id AND m.value >= ?2) " +
    "ORDER BY n, s.id LIMIT 1"
  ).bind(DART_MIN_QUARTERS, since).first();
}

const putMeta = (env, key, value, at) => env.DB.prepare(
  "INSERT INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
).bind(key, typeof value === "string" ? value : JSON.stringify(value), at);

/** 시장 하나(또는 여럿)의 종목 + 환율. markets: ['KR'] | ['US'] | ['KR','US'] | ['FX'] */
export function pickMarket(all, markets) {
  return all.filter((s) => s.ysym === FX_SYMBOL || markets.includes(s.market));
}

/** 묶음 시세 → 오늘 봉을 한 문장으로. → {written, bars, errors, quotes} */
async function writeBars(env, secs) {
  if (!secs.length) return { bars: 0, written: 0, errors: [], quotes: new Map() };
  const quotes = await quoteBatch(env, secs.map((s) => s.ysym));
  const bars = [];
  const missing = [];
  for (const s of secs) {
    const q = quotes.get(s.ysym);
    if (q?.bar) bars.push({ security_id: s.id, ...q.bar });
    else if (!q) missing.push(s.ysym);
  }
  const r = bars.length ? await upsertBarsStmt(env, bars).run() : { meta: { changes: 0 } };
  return { bars: bars.length, written: r.meta.changes, errors: missing.length ? ["시세 없음: " + missing.join(", ")] : [], quotes };
}

/** 종목별 일봉 이력 (새 종목 백필·빈 날 메우기). 문장은 종목마다 1개라 batch로. */
async function refreshHistory(env, secs, range) {
  const settled = await Promise.allSettled(secs.map((s) => history(s.ysym, range)));
  const stmts = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") stmts.push(upsertPricesStmt(env, secs[i].id, r.value));
    else errors.push(secs[i].ysym + ": " + String(r.reason && r.reason.message ? r.reason.message : r.reason));
  });
  if (stmts.length) await env.DB.batch(stmts);
  return { ok: stmts.length, errors };
}

/** 장중 5분: 그 시장 오늘 봉만. 보고는 meta 'cron:quotes'. */
export async function runQuotes(env, markets, now = new Date(), m = null) {
  const own = !m;
  m ||= meter(env);
  try {
    const secs = pickMarket(await trackedSecurities(env), markets);
    let r;
    try { r = await writeBars(env, secs); } catch (e) { r = { bars: 0, written: 0, errors: [String(e.message || e)] }; }
    const report = { at: nowIso(now), markets, symbols: secs.length, bars: r.bars, written: r.written, errors: r.errors };
    await putMeta(env, "cron:quotes", report, report.at).run();
    return report;
  } finally {
    if (own) m.restore();
  }
}

/** which: 'kr' | 'us'. 장 마감 뒤 하루 한 번. m은 틱이 넘겨주는 계량기(없으면 직접 만든다). */
export async function runDaily(env, which, now = new Date(), m = null) {
  const own = !m;
  m ||= meter(env);
  try {
    return await daily(env, which, now, m);
  } finally {
    if (own) m.restore();
  }
}

async function daily(env, which, now, m) {
  const all = await trackedSecurities(env);
  const pick = pickMarket(all, [which === "kr" ? "KR" : "US"]);
  const errors = [];
  const date = now.toISOString().slice(0, 10);

  // 1) 오늘 봉 확정 (묶음 시세, 요청 1~3번)
  let a = { bars: 0, written: 0 };
  try {
    a = await writeBars(env, pick);
    errors.push(...a.errors);
  } catch (e) {
    errors.push("묶음 시세 실패: " + String(e.message || e));
  }

  // 2) 새 종목 5년 백필, 3) 마지막 봉이 오래된 종목 메우기 — 남은 예산 안에서만
  const needBackfill = all.filter((s) => s.n < BACKFILL_MIN_ROWS).slice(0, Math.max(0, Math.min(BACKFILL_PER_RUN, m.fetchLeft() - 10)));
  const b = needBackfill.length ? await refreshHistory(env, needBackfill, "5y") : { ok: 0, errors: [] };
  const stale = new Date(now.getTime() - GAP_DAYS * 86400000).toISOString().slice(0, 10);
  const done = new Set(needBackfill.map((s) => s.id));
  const gaps = pick.filter((s) => !done.has(s.id) && s.n >= BACKFILL_MIN_ROWS && (!s.last || s.last < stale))
    .slice(0, Math.max(0, Math.min(GAP_PER_RUN, m.fetchLeft() - 8)));
  const g = gaps.length ? await refreshHistory(env, gaps, "1mo") : { ok: 0, errors: [] };
  errors.push(...b.errors, ...g.errors);

  // 스냅샷 날짜: UTC 날짜 = 그 거래일의 KST 날짜 (07 UTC = 16 KST 같은 날, 22 UTC = 익일 07 KST이므로 전날)
  const snap = await snapshotStmt(env, date, which === "kr" ? "KR" : "ALL").run();
  // 판정 기록의 1주·1개월 뒤 가격 (계기판 자체 평가용, SPEC §5.6.5). 쿼리 2개.
  const filled = await env.DB.batch(fillCallPricesStmts(env));
  // 전체 스냅샷이 확정되는 미국장 마감에서만 의견 만기 평가. 한 번에 D1 쿼리 3개.
  const viewsEvaluated = which === "us" ? await evaluateViews(env, now) : 0;

  // 국내 재무 이력 보강 (한 종목). 실패해도 시세·스냅샷 결과는 그대로 남긴다.
  // 예산이 모자라면 DART는 다음 실행으로 미룬다(시도 기록을 남기지 않으니 내일 다시 고른다).
  let dart = null;
  const target = which === "kr" && m.fetchLeft() >= DART_REPORTS_PER_RUN && m.d1Left() >= 6 ? await dartBackfillTarget(env, now) : null;
  if (target) {
    try {
      const r = await refreshFundamentals(env, target, {
        withDart: true, withMarketSource: false, dartOffset: target.dart_offset,
        dartCount: DART_REPORTS_PER_RUN, dartBatchByYear: true, now,
      });
      const progress = r.dartProgress || { nextOffset: target.dart_offset, done: true };
      const metaStmts = [putMeta(env, "dart:cursor:" + target.id, progress.done ? "0" : String(progress.nextOffset), nowIso(now))];
      if (progress.done || r.errors.length) metaStmts.push(putMeta(env, "dart:tried:" + target.id, date, nowIso(now)));
      await env.DB.batch(metaStmts);
      dart = { ysym: target.ysym, financials: r.financials, progress };
      errors.push(...r.errors.map((e) => target.ysym + ": " + e));
    } catch (e) {
      await putMeta(env, "dart:tried:" + target.id, date, nowIso(now)).run();
      // 몇 번째 외부 요청에서 죽었는지 남겨 한도 문제인지 DART 문제인지 가른다
      errors.push(target.ysym + ": " + String(e.message || e) + " (외부 요청 " + m.fetches + "번째, D1 " + m.d1 + ")");
    }
  }

  const report = {
    at: nowIso(now), which, date,
    updated: a.bars, written: a.written, backfilled: b.ok, gaps_filled: g.ok, snapshots: snap.meta.changes, dart,
    subrequests: m.fetches, d1_calls: m.d1,
    tech_filled: filled.reduce((s, r) => s + (r.meta?.changes || 0), 0), views_evaluated: viewsEvaluated,
    errors,
  };
  await putMeta(env, "cron:" + which, report, report.at).run();
  return report;
}
