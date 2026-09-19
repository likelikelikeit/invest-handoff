// M5a 주간 재무·컨센서스 갱신 (일요일 23 UTC = 월요일 08 KST).

import { yahooFundamentals } from "../sources/yahoo.js";
import { naverFundamentals } from "../sources/naver.js";
import { dartFundamentals } from "../sources/dart.js";
import { trackedEquities, upsertFinancialsStmt, upsertEstimatesStmt, upsertEarningsStmt } from "../lib/fundamentals.js";
import { nowIso } from "../lib/time.js";

// Cloudflare weekday는 1=일요일이라 모호하지 않은 SUN 표기를 쓴다.
export const CRON_WEEKLY = "0 23 * * SUN";
// DART 16회 + 국내 폴백 3회씩을 합쳐도 외부 요청 40개 이하가 되도록 8종목으로 제한한다.
const MAX_PER_RUN = 8;
const DART_PER_RUN = 1;

async function getSecurity(env, id) {
  return env.DB.prepare(
    "SELECT id, name, ticker, ysym, market, currency, dart_corp_code FROM securities WHERE id = ?1 AND archived_at IS NULL"
  ).bind(id).first();
}

/** 한 종목. 소스 하나가 실패해도 다른 소스 결과는 저장한다. */
export async function refreshFundamentals(env, secOrId, { withDart = true, now = new Date() } = {}) {
  const sec = typeof secOrId === "object" ? secOrId : await getSecurity(env, secOrId);
  if (!sec) throw new Error("종목을 찾지 못했습니다");
  const sources = [];
  if (sec.market === "US") sources.push(["yahoo", () => yahooFundamentals(env, sec.ysym, now)]);
  else if (sec.market === "KR") {
    sources.push(["naver", () => naverFundamentals(sec.ticker, now)]);
    if (withDart && env.DART_API_KEY && sec.dart_corp_code) {
      sources.push(["dart", () => dartFundamentals(env.DART_API_KEY, sec.dart_corp_code, now)]);
    }
  }

  const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));
  const financials = [];
  const estimates = [];
  let earningsDate = null;
  const errors = [];
  settled.forEach((r, i) => {
    const name = sources[i][0];
    if (r.status === "rejected") errors.push(name + ": " + String(r.reason?.message || r.reason));
    else {
      financials.push(...(r.value.financials || []));
      estimates.push(...(r.value.estimates || []));
      earningsDate ||= r.value.earningsDate || null;
      errors.push(...(r.value.errors || []).map((e) => name + ": " + e));
    }
  });
  if (!financials.length && !estimates.length && !earningsDate) {
    throw new Error(errors[0] || "재무 데이터를 찾지 못했습니다");
  }

  const at = nowIso(now);
  const stmts = [];
  if (financials.length) stmts.push(upsertFinancialsStmt(env, sec.id, financials, at));
  if (estimates.length) stmts.push(upsertEstimatesStmt(env, sec.id, estimates));
  if (earningsDate) stmts.push(upsertEarningsStmt(env, sec.id, earningsDate, at));
  if (stmts.length) await env.DB.batch(stmts);
  return { security_id: sec.id, financials: financials.length, estimates: estimates.length, earningsDate, errors };
}

/** 무료 플랜 쿼리·서브요청 한도를 위해 8종목씩 순환한다. */
export async function runWeekly(env, now = new Date()) {
  const all = await trackedEquities(env);
  const cursorRow = await env.DB.prepare("SELECT value FROM meta WHERE key = 'cron:weekly:cursor'").first();
  const start = all.length ? Number(cursorRow?.value || 0) % all.length : 0;
  const picked = all.length <= MAX_PER_RUN ? all : Array.from({ length: MAX_PER_RUN }, (_, i) => all[(start + i) % all.length]);
  let dartLeft = DART_PER_RUN;
  const settled = [];
  // DART 보강 대상을 한 종목으로 제한하고, 나머지 소스 호출은 순차 실행해 외부 서버에 버스트를 만들지 않는다.
  for (const sec of picked) {
    const withDart = Boolean(dartLeft && env.DART_API_KEY && sec.dart_corp_code);
    if (withDart) dartLeft--;
    try { settled.push({ status: "fulfilled", value: await refreshFundamentals(env, sec, { withDart, now }) }); }
    catch (reason) { settled.push({ status: "rejected", reason, sec }); }
  }
  const errors = [];
  let updated = 0;
  settled.forEach((r) => {
    if (r.status === "fulfilled") { updated++; errors.push(...r.value.errors.map((e) => all.find((s) => s.id === r.value.security_id)?.ysym + ": " + e)); }
    else errors.push(r.sec.ysym + ": " + String(r.reason?.message || r.reason));
  });
  const next = all.length ? (start + picked.length) % all.length : 0;
  const report = { at: nowIso(now), updated, attempted: picked.length, total: all.length, errors };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO meta (key,value,updated_at) VALUES ('cron:weekly',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    ).bind(JSON.stringify(report), report.at),
    env.DB.prepare(
      "INSERT INTO meta (key,value,updated_at) VALUES ('cron:weekly:cursor',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    ).bind(String(next), report.at),
  ]);
  return report;
}
