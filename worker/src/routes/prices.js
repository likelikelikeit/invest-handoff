// /prices — 일봉 조회·단일 종목 백필, /status — 크론 마지막 실행.

import { json, HttpError } from "../lib/http.js";
import { todayKst } from "../lib/time.js";
import { history } from "../sources/yahoo.js";
import { upsertPricesStmt, rangeStart, BACKFILL_MIN_ROWS } from "../lib/prices.js";

async function getSec(env, id) {
  const s = await env.DB.prepare("SELECT id, ysym, currency FROM securities WHERE id = ?1").bind(id).first();
  if (!s) throw new HttpError(404, "종목 " + id + "이(가) 없습니다");
  return s;
}

/**
 * GET /prices/:id?range=1m|3m|1y|3y|5y|10y|max
 * → { rows: [[date, open, high, low, close, volume], ...], first, last, count }
 *   first/count는 range와 무관한 전체 이력 기준 (10Y 토글을 켤지 정할 때 쓴다)
 */
export async function getPrices(request, env, headers, p, url) {
  const sec = await getSec(env, p.id);
  const range = url.searchParams.get("range") || "5y";
  const from = rangeStart(range, todayKst());
  if (!from) throw new HttpError(400, "range는 1m | 3m | 1y | 3y | 5y | 10y | max 중 하나입니다");
  const [rows, span] = await env.DB.batch([
    env.DB.prepare(
      "SELECT date, open, high, low, close, volume FROM prices WHERE security_id = ?1 AND date >= ?2 ORDER BY date"
    ).bind(p.id, from),
    env.DB.prepare("SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS count FROM prices WHERE security_id = ?1").bind(p.id),
  ]);
  const s = span.results[0];
  return json({
    ok: true, security_id: p.id, currency: sec.currency, range,
    first: s.first, last: s.last, count: s.count,
    rows: rows.results.map((r) => [r.date, r.open, r.high, r.low, r.close, r.volume]),
  }, 200, headers);
}

/** POST /prices/:id/backfill — 이력이 비었으면 5년치를 지금 받는다. 이미 있으면 최근 5일만. */
export async function backfillPrices(request, env, headers, p) {
  const sec = await getSec(env, p.id);
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM prices WHERE security_id = ?1").bind(p.id).first()).n;
  const range = n < BACKFILL_MIN_ROWS ? "5y" : "5d";
  let rows;
  try {
    rows = await history(sec.ysym, range);
  } catch (e) {
    // 외부 소스 실패는 앱을 죽이지 않는다
    return json({ ok: false, error: String(e.message || e) }, 200, headers);
  }
  await upsertPricesStmt(env, p.id, rows).run();
  return json({ ok: true, range, fetched: rows.length }, 200, headers);
}

/** GET /status — 크론 마지막 실행 보고 */
export async function getStatus(request, env, headers) {
  const { results } = await env.DB.prepare("SELECT key, value, updated_at FROM meta WHERE key LIKE 'cron:%'").all();
  const cron = Object.fromEntries(results.map((r) => [r.key.slice(5), JSON.parse(r.value)]));
  return json({ ok: true, cron }, 200, headers);
}
