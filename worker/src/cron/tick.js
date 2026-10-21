// 5분 틱 (SPEC §7.3). 크론 트리거는 이것 하나다. 시각(UTC 고정, 서머타임 계산 없음)을 보고 할 일을 고른다.
//
//   장중 5분마다     국내 UTC 00:00~06:35 (KST 09:00~15:35) · 미국 UTC 13:30~21:05 (EDT·EST 장중을 둘 다 덮는 넓은 창)
//                   → 그 시장 종목·지수·환율 오늘 봉 (runQuotes)
//   그 밖 평일 30분   환율만
//   국내 마감        UTC 07:00 이후 그날 처음 → runDaily('kr')   (KST 16:00)
//   미국 마감        UTC 22:00 이후 그날 처음 → runDaily('us')   (KST 07:00)
//   거시            UTC 23:30 이후 그날 처음 → runMisc           (KST 08:30)
//   재무 순환        장이 닫힌 틱마다 남은 예산만큼 → rotateFundamentals (하루 한 바퀴)
//
// "그날 처음"은 meta 'tick:done'에 UTC 날짜로 남긴다. 한 틱이 실패하거나 빠져도 다음 틱이 이어서 한다.
// 계량기 하나를 틱 전체가 같이 쓴다(호출당 한도는 틱 단위다). 앞의 일이 쓰고 남은 예산을 순환이 쓴다.

import { runQuotes, runDaily } from "./daily.js";
import { runMisc } from "./misc.js";
import { rotateFundamentals } from "./weekly.js";
import { meter } from "../lib/budget.js";
import { nowIso } from "../lib/time.js";

export const CRON_TICK = "*/5 * * * *";

const KR_OPEN = 0, KR_END = 6 * 60 + 35;
const US_OPEN = 13 * 60 + 30, US_END = 21 * 60 + 5;
const KR_CLOSE = 7 * 60, US_CLOSE = 22 * 60, MISC = 23 * 60 + 30;

/** 순수 함수: 이 시각에 할 일. done = {kr, us, misc} 마지막으로 끝낸 UTC 날짜 */
export function planTick(now, done = {}) {
  const dow = now.getUTCDay();
  const weekday = dow >= 1 && dow <= 5;
  const t = now.getUTCHours() * 60 + now.getUTCMinutes();
  const date = now.toISOString().slice(0, 10);
  const kr = weekday && t >= KR_OPEN && t <= KR_END;
  const us = weekday && t >= US_OPEN && t <= US_END;
  const markets = [...(kr ? ["KR"] : []), ...(us ? ["US"] : [])];
  return {
    date,
    quotes: markets.length ? markets : weekday && now.getUTCMinutes() % 30 === 0 ? ["FX"] : [],
    closeKr: weekday && t >= KR_CLOSE && done.kr !== date,
    closeUs: weekday && t >= US_CLOSE && done.us !== date,
    misc: t >= MISC && done.misc !== date,
    rotate: !kr && !us,
  };
}

export async function runTick(env, now = new Date()) {
  const m = meter(env);
  const ran = [];
  const errors = [];
  try {
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'tick:done'").first();
    let done = {};
    try { done = row ? JSON.parse(row.value) : {}; } catch { done = {}; }
    const plan = planTick(now, done);
    const before = JSON.stringify(done);

    const step = async (name, fn) => {
      try { await fn(); ran.push(name); return true; }
      catch (e) { errors.push(name + ": " + String(e?.message || e)); return false; }
    };

    if (plan.quotes.length) await step("quotes:" + plan.quotes.join("+"), () => runQuotes(env, plan.quotes, now, m));
    if (plan.closeKr && await step("close:kr", () => runDaily(env, "kr", now, m))) done.kr = plan.date;
    if (plan.closeUs && await step("close:us", () => runDaily(env, "us", now, m))) done.us = plan.date;
    if (plan.misc && await step("misc", () => runMisc(env, now))) done.misc = plan.date;
    if (plan.rotate && m.fetchLeft() > 8 && m.d1Left() > 10) await step("fundamentals", () => rotateFundamentals(env, now, m));

    if (JSON.stringify(done) !== before) {
      await env.DB.prepare(
        "INSERT INTO meta (key, value, updated_at) VALUES ('tick:done', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).bind(JSON.stringify(done), nowIso(now)).run();
    }
    return { at: nowIso(now), ran, errors, subrequests: m.fetches, d1_calls: m.d1 };
  } finally {
    m.restore();
  }
}
