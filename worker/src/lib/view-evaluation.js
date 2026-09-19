// 투자의견 사후평가 (SPEC §5.2.5). 계산은 코드가 하고, LLM은 관여하지 않는다.

import { nowIso, todayKst } from "./time.js";

/** 기록일 + 개월. 말일은 그 달의 말일로 보정한다. */
export function horizonEnd(createdAt, months) {
  const d = new Date(createdAt.slice(0, 10) + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** 만기가 지난 미평가 의견을 한 번에 최대 100개 채운다. D1 쿼리 3개. */
export async function evaluateViews(env, now = new Date()) {
  const today = todayKst(now);
  const { results: pending } = await env.DB.prepare(
    "SELECT id, security_id, created_at, horizon_months, target_price, price_at FROM views " +
    "WHERE evaluated_at IS NULL ORDER BY created_at, id LIMIT 100"
  ).all();
  const due = pending.map((v) => ({
    id: v.id, security_id: v.security_id, start: v.created_at.slice(0, 10),
    end: horizonEnd(v.created_at, v.horizon_months), target: v.target_price, price_at: v.price_at,
  })).filter((v) => v.end <= today);
  if (!due.length) return 0;

  const packed = JSON.stringify(due.map((v) => [v.id, v.security_id, v.start, v.end, v.target, v.price_at]));
  const { results: calculated } = await env.DB.prepare(
    "WITH due AS (SELECT json_extract(value,'$[0]') id, json_extract(value,'$[1]') security_id, " +
    "json_extract(value,'$[2]') start_date, json_extract(value,'$[3]') end_date, " +
    "json_extract(value,'$[4]') target, json_extract(value,'$[5]') price_at FROM json_each(?1)) " +
    "SELECT d.id, d.target, d.price_at, " +
    "MIN(CASE WHEN (d.target >= d.price_at AND p.high >= d.target) OR (d.target < d.price_at AND p.low <= d.target) THEN p.date END) hit_date, " +
    "(SELECT p2.close FROM prices p2 WHERE p2.security_id = d.security_id AND p2.date BETWEEN d.start_date AND d.end_date ORDER BY p2.date DESC LIMIT 1) price_at_horizon " +
    "FROM due d LEFT JOIN prices p ON p.security_id = d.security_id AND p.date BETWEEN d.start_date AND d.end_date GROUP BY d.id"
  ).bind(packed).all();

  const at = nowIso(now);
  const rows = calculated.filter((r) => Number(r.price_at_horizon) > 0).map((r) => {
    const targetReturn = Number(r.target) / Number(r.price_at) - 1;
    const actualReturn = Number(r.price_at_horizon) / Number(r.price_at) - 1;
    return [r.id, at, r.hit_date ? 1 : 0, r.hit_date || null, Number(r.price_at_horizon), actualReturn, targetReturn, Math.abs(actualReturn - targetReturn)];
  });
  if (!rows.length) return 0;
  const updates = JSON.stringify(rows);
  const result = await env.DB.prepare(
    "WITH vals AS (SELECT json_extract(value,'$[0]') id, json_extract(value,'$[1]') evaluated_at, " +
    "json_extract(value,'$[2]') hit, json_extract(value,'$[3]') hit_date, json_extract(value,'$[4]') price_at_horizon, " +
    "json_extract(value,'$[5]') actual_return, json_extract(value,'$[6]') target_return, json_extract(value,'$[7]') abs_error FROM json_each(?1)) " +
    "UPDATE views SET evaluated_at=(SELECT evaluated_at FROM vals WHERE vals.id=views.id), " +
    "hit=(SELECT hit FROM vals WHERE vals.id=views.id), hit_date=(SELECT hit_date FROM vals WHERE vals.id=views.id), " +
    "price_at_horizon=(SELECT price_at_horizon FROM vals WHERE vals.id=views.id), actual_return=(SELECT actual_return FROM vals WHERE vals.id=views.id), " +
    "target_return=(SELECT target_return FROM vals WHERE vals.id=views.id), abs_error=(SELECT abs_error FROM vals WHERE vals.id=views.id) " +
    "WHERE id IN (SELECT id FROM vals) AND evaluated_at IS NULL"
  ).bind(updates).run();
  return result.meta.changes;
}
