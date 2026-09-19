// 일일 시세 크론 (SPEC §7.3, UTC 고정 — 서머타임 계산 없음).
//   0 7  * * 1-5  (KST 16:00)      국내 종목·지수·환율, 국내 보유 스냅샷
//   0 22 * * 1-5  (KST 익일 07:00)  미국 종목·지수·환율, 전체 보유 스냅샷(하루치 확정)
// 휴장일에도 돌지만 같은 값을 UPSERT할 뿐이라 무해하다.
//
// 한도: 서브요청 50·D1 쿼리 50/호출. 최근 5일 봉만 받고, 종목 하나당 fetch 1 + 쿼리 1.
// 이력이 비어 있는 종목(새로 추가된 것)은 한 번에 BACKFILL_PER_RUN개씩 5년치를 메운다.

import { history } from "../sources/yahoo.js";
import { upsertPricesStmt, trackedSecurities, snapshotStmt, BACKFILL_MIN_ROWS } from "../lib/prices.js";
import { nowIso } from "../lib/time.js";
import { refreshFundamentals } from "./weekly.js";

export const CRON_KR = "0 7 * * 1-5";
export const CRON_US = "0 22 * * 1-5";

const MAX_DAILY = 35; // 종목 수가 늘면 여기서 잘린다. 넘으면 meta에 남겨 알 수 있게.
const BACKFILL_PER_RUN = 2;
// DART 분기 이력이 이만큼 안 되는 국내 종목은 일일 크론마다 하나씩 보강한다 (DART 요청 16개 + 네이버 3개).
// 주간 크론은 한 주에 한 종목만 DART를 부르므로, 새로 고유번호를 넣은 종목이 몇 주씩 기다리지 않게.
export const DART_MIN_QUARTERS = 12;

/**
 * DART 고유번호가 있는데 DART 분기 행이 부족한 국내 종목 하나 (보유·관심, 숨김 제외).
 * 최근 3일 안에 시도한 종목은 건너뛴다(실패하거나 원래 분기가 적은 종목에 매일 헛요청하지 않게).
 */
export async function dartBackfillTarget(env, now = new Date()) {
  const since = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10);
  if (!env.DART_API_KEY) return null;
  return env.DB.prepare(
    "SELECT s.id, s.name, s.ticker, s.ysym, s.market, s.currency, s.dart_corp_code, " +
    "(SELECT COUNT(*) FROM financials f WHERE f.security_id = s.id AND f.source = 'dart' AND f.period_type = 'Q') AS n " +
    "FROM securities s WHERE s.archived_at IS NULL AND s.market = 'KR' AND s.asset_class = 'equity' AND s.dart_corp_code IS NOT NULL " +
    "AND (s.id IN (SELECT security_id FROM positions) OR s.id IN (SELECT security_id FROM watchlist)) " +
    "AND (SELECT COUNT(*) FROM financials f WHERE f.security_id = s.id AND f.source = 'dart' AND f.period_type = 'Q') < ?1 " +
    "AND NOT EXISTS (SELECT 1 FROM meta m WHERE m.key = 'dart:tried:' || s.id AND m.value >= ?2) " +
    "ORDER BY n, s.id LIMIT 1"
  ).bind(DART_MIN_QUARTERS, since).first();
}

async function refresh(env, secs, range) {
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

/** which: 'kr' | 'us'. now는 테스트용. */
export async function runDaily(env, which, now = new Date()) {
  const all = await trackedSecurities(env);
  const isFx = (s) => s.ysym === "KRW=X";
  const pick = all.filter((s) => isFx(s) || (which === "kr" ? s.market === "KR" : s.market === "US"));
  const needBackfill = all.filter((s) => s.n < BACKFILL_MIN_ROWS).slice(0, BACKFILL_PER_RUN);
  const backfillIds = new Set(needBackfill.map((s) => s.id));
  const daily = pick.filter((s) => !backfillIds.has(s.id));
  const truncated = daily.length > MAX_DAILY;

  const a = await refresh(env, daily.slice(0, MAX_DAILY), "5d");
  const b = needBackfill.length ? await refresh(env, needBackfill, "5y") : { ok: 0, errors: [] };

  // 스냅샷 날짜: 두 크론 모두 UTC 날짜 = 그 거래일의 KST 날짜 (07 UTC = 16 KST 같은 날, 22 UTC = 익일 07 KST이므로 전날)
  const date = now.toISOString().slice(0, 10);
  const snap = await snapshotStmt(env, date, which === "kr" ? "KR" : "ALL").run();

  // 국내 재무 이력 보강 (한 종목). 실패해도 시세·스냅샷 결과는 그대로 남긴다.
  let dart = null;
  const dartErrors = [];
  const target = await dartBackfillTarget(env, now);
  if (target) {
    await env.DB.prepare(
      "INSERT INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind("dart:tried:" + target.id, date, nowIso(now)).run();
    try {
      const r = await refreshFundamentals(env, target, { withDart: true, now });
      dart = { ysym: target.ysym, financials: r.financials };
      dartErrors.push(...r.errors.map((e) => target.ysym + ": " + e));
    } catch (e) {
      dartErrors.push(target.ysym + ": " + String(e.message || e));
    }
  }

  const report = {
    at: nowIso(now), which, date,
    updated: a.ok, backfilled: b.ok, snapshots: snap.meta.changes, dart,
    errors: a.errors.concat(b.errors, dartErrors),
    truncated: truncated ? daily.length - MAX_DAILY : 0,
  };
  await env.DB.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind("cron:" + which, JSON.stringify(report), report.at).run();
  return report;
}
