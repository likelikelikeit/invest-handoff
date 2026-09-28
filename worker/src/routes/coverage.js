// /coverage/suspensions — 커버리지 중단 (SPEC §5.2.9).
// 중단 = 현재 의견 철회 + 새 목표가 제시 중단. "모르겠다"를 보유(HOLD)나 억지 목표가로 넣지 않고 따로 남긴다.
// 재개는 따로 기록하지 않는다. 중단 뒤 새 의견을 쓰면 그게 재개다.
//
// 철회 규칙 [사용자 결정 2026-09-28]:
//   - 철회되는 건 그 종목의 최신 의견 하나뿐이다. 업데이트로 밀려난 이전 의견은 원래대로 만기 평가된다.
//   - 이미 목표가에 닿았거나 목표 기간이 끝난 의견은 결과가 확정돼 철회하지 않는다.
//   - 철회된 의견은 지우지 않는다. 정규 적중률·MAE에서 빠지고 화면에 '철회 N건'으로 옆에 센다.

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso, todayKst } from "../lib/time.js";
import { horizonEnd } from "../lib/view-evaluation.js";
import { SUSPEND_REASONS } from "../lib/ratings.js";
import { priceNow } from "./views.js";

export { SUSPEND_REASONS };

/** 입력 검증: 사유는 고정 태그 중에서(선택), 메모는 자유. */
export function suspendFields(body) {
  const raw = Array.isArray(body.reasons) ? body.reasons : [];
  const bad = raw.filter((r) => !SUSPEND_REASONS.includes(r));
  if (bad.length) throw new HttpError(400, "사유는 " + SUSPEND_REASONS.join(" | ") + " 중에서 고릅니다");
  const memo = body.memo == null ? null : String(body.memo).trim() || null;
  return { reasons: [...new Set(raw)], memo };
}

const SELECT =
  "SELECT c.*, s.name, s.ticker, s.ysym, s.currency, v.target_price, v.price_at AS view_price_at, v.created_at AS view_created_at " +
  "FROM coverage_suspensions c JOIN securities s ON s.id = c.security_id LEFT JOIN views v ON v.id = c.view_id ";

const out = (r) => (r ? { ...r, reasons: r.reasons ? JSON.parse(r.reasons) : [] } : null);

/** 지금 중단 상태인 종목들 (최신 중단 뒤에 새 의견이 없는 것). /views/latest가 같이 돌려준다. */
export async function currentSuspensions(env) {
  const { results } = await env.DB.prepare(
    SELECT + "WHERE s.archived_at IS NULL AND c.id = (SELECT c2.id FROM coverage_suspensions c2 WHERE c2.security_id = c.security_id " +
    "ORDER BY julianday(c2.created_at) DESC, c2.id DESC LIMIT 1) " +
    "AND NOT EXISTS (SELECT 1 FROM views v2 WHERE v2.security_id = c.security_id AND julianday(v2.created_at) > julianday(c.created_at)) " +
    "ORDER BY julianday(c.created_at) DESC"
  ).all();
  return results.map(out);
}

/**
 * 중단 한 건을 넣는다. 가격 스냅샷과 시각은 밖에서 준다
 * (앱: 지금 시세, MCP 초안: 제출 시점에 얼린 종가와 그 시각).
 */
export async function suspendCoverage(env, { securityId, createdAt, reasons, memo, snapshot }) {
  const view = await env.DB.prepare(
    "SELECT * FROM views WHERE security_id = ?1 ORDER BY julianday(created_at) DESC, id DESC LIMIT 1"
  ).bind(securityId).first();
  if (!view) throw new HttpError(400, "커버리지를 개시하지 않은 종목입니다");
  if (Date.parse(createdAt) < Date.parse(view.created_at)) {
    throw new HttpError(409, "중단 시점보다 나중에 쓴 의견이 있습니다");
  }
  const last = await env.DB.prepare(
    "SELECT created_at FROM coverage_suspensions WHERE security_id = ?1 ORDER BY julianday(created_at) DESC, id DESC LIMIT 1"
  ).bind(securityId).first();
  if (last && Date.parse(last.created_at) >= Date.parse(view.created_at)) {
    throw new HttpError(409, "이미 커버리지를 중단한 종목입니다");
  }

  // 결과가 아직 안 난 의견만 철회한다. 중단일까지 목표가에 닿았으면 적중으로 확정하고 철회하지 않는다.
  const asOf = todayKst(new Date(createdAt));
  let withdraw = !view.evaluated_at && view.hit !== 1 && !view.withdrawn_at && horizonEnd(view.created_at, view.horizon_months) > asOf;
  if (withdraw) {
    const up = view.target_price >= view.price_at;
    const touched = await env.DB.prepare(
      "SELECT MIN(date) AS d FROM prices WHERE security_id = ?1 AND date BETWEEN ?2 AND ?3 AND " +
      (up ? "high >= ?4" : "low <= ?4")
    ).bind(securityId, view.created_at.slice(0, 10), asOf, view.target_price).first();
    if (touched?.d) {
      await env.DB.prepare("UPDATE views SET hit = 1, hit_date = ?1 WHERE id = ?2").bind(touched.d, view.id).run();
      withdraw = false;
    }
  }
  if (withdraw) {
    await env.DB.prepare("UPDATE views SET withdrawn_at = ?1 WHERE id = ?2").bind(createdAt, view.id).run();
  }

  const row = await env.DB.prepare(
    "INSERT INTO coverage_suspensions (security_id, created_at, reasons, memo, view_id, price_at, price_at_source) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id"
  ).bind(
    securityId, createdAt, reasons.length ? JSON.stringify(reasons) : null, memo,
    withdraw ? view.id : null, snapshot?.price ?? null, snapshot?.source ?? null
  ).first();
  return out(await env.DB.prepare(SELECT + "WHERE c.id = ?1").bind(row.id).first());
}

// GET /coverage/suspensions?security_id=
export async function listSuspensions(request, env, headers, _p, url) {
  const sid = url.searchParams.get("security_id");
  const { results } = await env.DB.prepare(
    SELECT + (sid ? "WHERE c.security_id = ?1 " : "") + "ORDER BY julianday(c.created_at) DESC, c.id DESC LIMIT 200"
  ).bind(...(sid ? [Number(sid)] : [])).all();
  return json({ ok: true, suspensions: results.map(out) }, 200, headers);
}

// POST /coverage/suspensions — 지금 시세로 중단한다.
export async function createSuspension(request, env, headers) {
  const body = await readJson(request);
  const sec = await env.DB.prepare("SELECT id, ysym FROM securities WHERE id = ?1").bind(Number(body.security_id)).first();
  if (!sec) throw new HttpError(404, "종목 " + body.security_id + "이(가) 없습니다");
  const f = suspendFields(body);
  let snapshot = null;
  try { snapshot = await priceNow(env, sec); } catch { /* 가격을 몰라도 중단은 기록한다 */ }
  const suspension = await suspendCoverage(env, { securityId: sec.id, createdAt: nowIso(), ...f, snapshot });
  return json({ ok: true, suspension }, 200, headers);
}

// DELETE /coverage/suspensions/:id — 잘못 누른 중단을 되돌린다. 철회도 함께 풀려 원래대로 평가된다.
export async function deleteSuspension(request, env, headers, p) {
  const c = await env.DB.prepare("SELECT * FROM coverage_suspensions WHERE id = ?1").bind(p.id).first();
  if (!c) throw new HttpError(404, "중단 기록 " + p.id + "이(가) 없습니다");
  if (c.view_id) await env.DB.prepare("UPDATE views SET withdrawn_at = NULL WHERE id = ?1").bind(c.view_id).run();
  await env.DB.prepare("DELETE FROM coverage_suspensions WHERE id = ?1").bind(p.id).run();
  return json({ ok: true }, 200, headers);
}
