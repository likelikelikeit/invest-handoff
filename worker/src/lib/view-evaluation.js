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

/**
 * 미평가 의견을 한 번에 최대 100개 본다. D1 쿼리 최대 4개.
 *
 * 두 단계다 [사용자 결정 2026-09-23]:
 *   1) 조기 적중 — 목표 기간 중이라도 목표가에 닿았으면 그날로 hit=1, hit_date를 채운다.
 *      적중 기준이 "기간 안에 한 번이라도 도달"이라 닿은 순간 결과가 확정되기 때문이다.
 *   2) 만기 평가 — 기간이 끝나면 만기 종가로 실제수익률·MAE까지 채우고 evaluated_at을 찍는다.
 * 그래서 hit=1이면서 evaluated_at이 비어 있는 행이 생긴다(조기 적중, 수익률은 아직).
 */
export async function evaluateViews(env, now = new Date()) {
  const today = todayKst(now);
  const { results: pending } = await env.DB.prepare(
    "SELECT id, security_id, created_at, horizon_months, target_price, price_at, hit FROM views " +
    "WHERE evaluated_at IS NULL ORDER BY created_at, id LIMIT 100"
  ).all();
  const all = pending.map((v) => ({
    id: v.id, security_id: v.security_id, start: v.created_at.slice(0, 10),
    end: horizonEnd(v.created_at, v.horizon_months), target: v.target_price, price_at: v.price_at,
    hit: v.hit, due: horizonEnd(v.created_at, v.horizon_months) <= today,
  }));
  if (!all.length) return 0;

  const packed = JSON.stringify(all.map((v) => [v.id, v.security_id, v.start, v.end, v.target, v.price_at]));
  const { results: calculated } = await env.DB.prepare(
    "WITH due AS (SELECT json_extract(value,'$[0]') id, json_extract(value,'$[1]') security_id, " +
    "json_extract(value,'$[2]') start_date, json_extract(value,'$[3]') end_date, " +
    "json_extract(value,'$[4]') target, json_extract(value,'$[5]') price_at FROM json_each(?1)) " +
    "SELECT d.id, d.target, d.price_at, " +
    "MIN(CASE WHEN (d.target >= d.price_at AND p.high >= d.target) OR (d.target < d.price_at AND p.low <= d.target) THEN p.date END) hit_date, " +
    "(SELECT p2.close FROM prices p2 WHERE p2.security_id = d.security_id AND p2.date BETWEEN d.start_date AND d.end_date ORDER BY p2.date DESC LIMIT 1) price_at_horizon " +
    "FROM due d LEFT JOIN prices p ON p.security_id = d.security_id AND p.date BETWEEN d.start_date AND d.end_date GROUP BY d.id"
  ).bind(packed).all();

  const byId = new Map(all.map((v) => [v.id, v]));
  let changes = 0;

  // 1) 조기 적중: 기간 중인데 이미 닿은 것. 한 번만 쓴다(hit가 비어 있을 때만).
  const early = calculated
    .filter((r) => r.hit_date && !byId.get(r.id).due && byId.get(r.id).hit == null)
    .map((r) => [r.id, r.hit_date]);
  if (early.length) {
    const r = await env.DB.prepare(
      "WITH vals AS (SELECT json_extract(value,'$[0]') id, json_extract(value,'$[1]') hit_date FROM json_each(?1)) " +
      "UPDATE views SET hit = 1, hit_date = (SELECT hit_date FROM vals WHERE vals.id = views.id) " +
      "WHERE id IN (SELECT id FROM vals) AND evaluated_at IS NULL AND hit IS NULL"
    ).bind(JSON.stringify(early)).run();
    changes += r.meta.changes;
  }

  // 2) 만기 평가
  const at = nowIso(now);
  const rows = calculated.filter((r) => byId.get(r.id).due && Number(r.price_at_horizon) > 0).map((r) => {
    const targetReturn = Number(r.target) / Number(r.price_at) - 1;
    const actualReturn = Number(r.price_at_horizon) / Number(r.price_at) - 1;
    return [r.id, at, r.hit_date ? 1 : 0, r.hit_date || null, Number(r.price_at_horizon), actualReturn, targetReturn, Math.abs(actualReturn - targetReturn)];
  });
  if (!rows.length) return changes;
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
  return changes + result.meta.changes;
}
