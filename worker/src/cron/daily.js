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

export const CRON_KR = "0 7 * * 1-5";
export const CRON_US = "0 22 * * 1-5";

const MAX_DAILY = 35; // 종목 수가 늘면 여기서 잘린다. 넘으면 meta에 남겨 알 수 있게.
const BACKFILL_PER_RUN = 2;

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

  const report = {
    at: nowIso(now), which, date,
    updated: a.ok, backfilled: b.ok, snapshots: snap.meta.changes,
    errors: a.errors.concat(b.errors),
    truncated: truncated ? daily.length - MAX_DAILY : 0,
  };
  await env.DB.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind("cron:" + which, JSON.stringify(report), report.at).run();
  return report;
}
