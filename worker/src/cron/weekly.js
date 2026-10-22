// 재무·컨센서스·실적일 순환 (SPEC §5.4·§5.7). 5분 틱(cron/tick.js)이 장이 닫힌 시간마다 부른다.
// 보유·관심 종목 전부를 하루에 한 바퀴 돈다. 한 번 실행에는 남은 예산(lib/budget.js)만큼만 하고,
// 어디까지 했는지(meta 'rot:fund')를 남겨 다음 틱이 이어서 한다. 그래서 종목이 100개를 넘어도 하루 안에 끝난다.
// (예전에는 일요일 한 번에 8종목씩이라 16종목이 한 바퀴 도는 데 2주였고, 고정 계산이 한도를 넘었다.)

import { yahooFundamentals } from "../sources/yahoo.js";
import { naverFundamentals } from "../sources/naver.js";
import { dartFundamentals, dartDisclosures, krEarningsFromDisclosures } from "../sources/dart.js";
import { kindIrSchedule, krEarningsFromKind } from "../sources/kind.js";
import { trackedEquities, upsertFinancialsStmt, upsertEstimatesStmt, replaceEarningsStmts } from "../lib/fundamentals.js";
import { nowIso, todayKst } from "../lib/time.js";
import { meter } from "../lib/budget.js";
import { dartInWorker } from "../lib/dart-gate.js";

const addDaysIso = (date, n) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// DART 정기보고서는 분기에 한 번 나오니 종목마다 주 1회(id % 7 == 요일)만 최근 4건을 다시 본다.
const DART_REPORTS = 4;
const SESSION_RESERVE = 3; // 야후 쿠키·crumb 갱신 (12시간 캐시가 만료됐을 때)

/** 이 종목을 갱신하는 데 드는 외부 요청 어림값 */
export function fetchCost(sec, withDart, withDartList = false) {
  // 국내: 네이버 3 + KIND IR 1 (+ DART 정기보고서 4) (+ DART 공시 목록 1)
  if (sec.market === "KR") return 4 + (withDart ? DART_REPORTS : 0) + (withDartList ? 1 : 0);
  const fx = sec.financial_currency && sec.financial_currency !== sec.currency ? 2 : 0;
  return 2 + fx;
}

async function getSecurity(env, id) {
  return env.DB.prepare(
    "SELECT id, name, ticker, ysym, market, currency, financial_currency, adr_ratio, " +
    "financial_to_listing_rate, financial_rate_as_of, dart_corp_code " +
    "FROM securities WHERE id = ?1 AND archived_at IS NULL"
  ).bind(id).first();
}

/** 한 종목. 소스 하나가 실패해도 다른 소스 결과는 저장한다. */
export async function refreshFundamentals(env, secOrId, {
  withDart = true, withMarketSource = true, dartOffset = 0, dartCount = 16, dartBatchByYear = false,
  now = new Date(),
} = {}) {
  const sec = typeof secOrId === "object" ? secOrId : await getSecurity(env, secOrId);
  if (!sec) throw new Error("종목을 찾지 못했습니다");
  const sources = [];
  if (sec.market === "US" && withMarketSource) sources.push(["yahoo", () => yahooFundamentals(env, sec.ysym, now, {
    listingCurrency: sec.currency,
    adrRatio: sec.adr_ratio,
  })]);
  else if (sec.market === "KR") {
    if (withMarketSource) sources.push(["naver", () => naverFundamentals(sec.ticker, now)]);
    if (withDart && dartInWorker(env) && sec.dart_corp_code) {
      sources.push(["dart", () => dartFundamentals(env.DART_API_KEY, sec.dart_corp_code, now, {
        offset: dartOffset, count: dartCount, batchByYear: dartBatchByYear,
      })]);
    }
    // 국내 실적 발표일 — 주: KIND IR 일정(확정 일시), 보조: DART 잠정실적 공시(실제 발표 확인·작년 패턴 예상). 각 요청 1번
    if (withMarketSource && /^\d{6}$/.test(sec.ticker || "")) {
      sources.push(["kind", async () => {
        const today = todayKst(now);
        const e = krEarningsFromKind(await kindIrSchedule(sec.ticker, today, addDaysIso(today, 120)), today);
        return { financials: [], estimates: [], earnings: e ? { ...e, source: "kind" } : null };
      }]);
    }
    if (withMarketSource && dartInWorker(env) && sec.dart_corp_code) {
      sources.push(["dart-list", async () => {
        const today = todayKst(now);
        const list = await dartDisclosures(env.DART_API_KEY, sec.dart_corp_code, addDaysIso(today, -400), today);
        const e = krEarningsFromDisclosures(list, today);
        return { financials: [], estimates: [], earnings: e ? { ...e, source: "dart" } : null };
      }]);
    }
  }

  const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));
  const financials = [];
  const estimates = [];
  const earnings = []; // [{date, time?, confirmed, source, detail}] 출처마다 하나
  let dartProgress = null;
  let yahooMetadata = null;
  const errors = [];
  settled.forEach((r, i) => {
    const name = sources[i][0];
    if (r.status === "rejected") errors.push(name + ": " + String(r.reason?.message || r.reason));
    else {
      const sourceCurrency = r.value.financialCurrency || sec.financial_currency || sec.currency;
      const rows = (r.value.financials || []).map((x) => {
        if (x.currency !== undefined) return x;
        if (sourceCurrency === sec.currency) {
          return { ...x, currency: sec.currency, source_currency: sourceCurrency, adr_ratio: 1, fx_rate: 1, balance_fx_rate: 1 };
        }
        return { ...x, currency: null, source_currency: sourceCurrency, adr_ratio: sec.adr_ratio || null, fx_rate: null, balance_fx_rate: null };
      });
      financials.push(...rows);
      estimates.push(...(r.value.estimates || []));
      if (r.value.earnings) earnings.push(r.value.earnings);
      if (r.value.earningsDate) {
        earnings.push({ date: r.value.earningsDate, confirmed: r.value.earningsConfirmed ?? null, source: "yahoo", detail: null });
      }
      if (name === "dart") dartProgress = r.value.progress || null;
      if (name === "yahoo") yahooMetadata = r.value;
      errors.push(...(r.value.errors || []).map((e) => name + ": " + e));
    }
  });
  // DART 배치가 정상 응답했지만 해당 보고서가 없는 경우에도 커서는 전진해야 한다.
  if (!financials.length && !estimates.length && !earnings.length && !dartProgress) {
    throw new Error(errors[0] || "재무 데이터를 찾지 못했습니다");
  }

  const at = nowIso(now);
  const stmts = [];
  if (financials.length) stmts.push(upsertFinancialsStmt(env, sec.id, financials, at));
  if (yahooMetadata?.financialCurrency) {
    stmts.push(env.DB.prepare(
      "UPDATE securities SET financial_currency=?1, financial_to_listing_rate=?2, financial_rate_as_of=?3, updated_at=?4 WHERE id=?5"
    ).bind(
      yahooMetadata.financialCurrency,
      yahooMetadata.financialToListingRate ?? null,
      yahooMetadata.financialRateAsOf ?? null,
      at,
      sec.id,
    ));
  }
  if (estimates.length) stmts.push(upsertEstimatesStmt(env, sec.id, estimates));
  // 지난 날짜(이미 발표한 분기)는 넣지 않는다
  const today = now.toISOString().slice(0, 10);
  // 확정을 먼저 쓴다: 예상 날짜는 근처(±20일)에 다른 출처의 확정이 있으면 넣지 않는다
  for (const e of [...earnings].sort((a, b) => (b.confirmed ?? -1) - (a.confirmed ?? -1))) {
    if (e.date >= today) stmts.push(...replaceEarningsStmts(env, sec.id, e.date, at, today, e));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { security_id: sec.id, financials: financials.length, estimates: estimates.length, earnings, errors, dartProgress };
}

/**
 * 순환 한 걸음. m은 틱이 넘겨주는 계량기(없으면 직접 만든다).
 * → {today, cursor, total, done, updated, attempted, errors}
 */
export async function rotateFundamentals(env, now = new Date(), m = null) {
  const own = !m;
  m ||= meter(env);
  try {
    return await rotate(env, now, m);
  } finally {
    if (own) m.restore();
  }
}

async function rotate(env, now, m) {
  const all = await trackedEquities(env);
  const today = todayKst(now);
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'rot:fund'").first();
  let state = {};
  try { state = row ? JSON.parse(row.value) : {}; } catch { state = {}; }
  if (state.day !== today) state = { day: today, cursor: 0, updated: 0, errors: [] };
  if (state.cursor >= all.length) return { today, cursor: state.cursor, total: all.length, done: true, updated: 0, attempted: 0, errors: [] };

  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  const errors = [];
  let attempted = 0;
  let updated = 0;
  // 외부 서버에 버스트를 만들지 않게 순서대로
  while (state.cursor < all.length) {
    const sec = all[state.cursor];
    const hasDart = Boolean(dartInWorker(env) && sec.dart_corp_code);
    const withDart = hasDart && sec.id % 7 === dow;
    const reserve = sec.market === "US" ? SESSION_RESERVE : 0;
    // 남은 종목은 다음 틱에. D1은 종목당 문장 7개 안팎(재무·추정·실적일 출처마다 2~3·통화)
    if (fetchCost(sec, withDart, hasDart) + reserve > m.fetchLeft() || m.d1Left() < 10) break;
    try {
      const r = await refreshFundamentals(env, sec, { withDart, dartCount: DART_REPORTS, now });
      updated++;
      errors.push(...r.errors.map((e) => sec.ysym + ": " + e));
    } catch (e) {
      errors.push(sec.ysym + ": " + String(e?.message || e));
    }
    attempted++;
    state.cursor++;
  }
  if (!attempted) return { today, cursor: state.cursor, total: all.length, done: false, updated: 0, attempted: 0, errors: [] };

  state.updated = (state.updated || 0) + updated;
  state.errors = [...(state.errors || []), ...errors].slice(-30);
  const report = {
    at: nowIso(now), day: today, cursor: state.cursor, total: all.length, done: state.cursor >= all.length,
    updated_today: state.updated, this_run: attempted, subrequests: m.fetches, d1_calls: m.d1, errors: state.errors,
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO meta (key,value,updated_at) VALUES ('rot:fund',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    ).bind(JSON.stringify(state), report.at),
    env.DB.prepare(
      "INSERT INTO meta (key,value,updated_at) VALUES ('cron:fund',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    ).bind(JSON.stringify(report), report.at),
  ]);
  return { today, cursor: state.cursor, total: all.length, done: report.done, updated, attempted, errors };
}
