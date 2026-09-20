// /portfolio — 현재 보유(positions)와 현금.

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso } from "../lib/time.js";
import { pickFields, securityOut, upsertSecurityStmt } from "./securities.js";

const SOURCES = ["screenshot", "manual", "sim"];

function positionFields(body) {
  const qty = Number(body.qty);
  const avg = Number(body.avg_price);
  if (!(qty > 0)) throw new HttpError(400, "qty는 0보다 커야 합니다");
  if (!(avg >= 0)) throw new HttpError(400, "avg_price는 0 이상의 숫자여야 합니다");
  if (body.avg_ccy != null && !["KRW", "USD"].includes(body.avg_ccy)) {
    throw new HttpError(400, "avg_ccy는 KRW | USD 중 하나여야 합니다");
  }
  if (body.source != null && !SOURCES.includes(body.source)) {
    throw new HttpError(400, "source는 " + SOURCES.join(" | ") + " 중 하나여야 합니다");
  }
  return { qty, avg_price: avg, avg_ccy: body.avg_ccy || null, source: body.source || "manual" };
}

function upsertPositionStmt(env, securityId, f, at) {
  // avg_ccy를 안 주면 종목 통화를 쓴다.
  return env.DB.prepare(
    "INSERT INTO positions (security_id, qty, avg_price, avg_ccy, source, updated_at) " +
    "VALUES (?1, ?2, ?3, COALESCE(?4, (SELECT currency FROM securities WHERE id = ?1)), ?5, ?6) " +
    "ON CONFLICT(security_id) DO UPDATE SET qty = excluded.qty, avg_price = excluded.avg_price, " +
    "avg_ccy = excluded.avg_ccy, source = excluded.source, updated_at = excluded.updated_at"
  ).bind(securityId, f.qty, f.avg_price, f.avg_ccy, f.source, at);
}

export async function getPortfolio(request, env, headers) {
  const [pos, cash] = await env.DB.batch([
    env.DB.prepare(
      "SELECT p.security_id, p.qty, p.avg_price, p.avg_ccy, p.source, p.updated_at AS position_updated_at, s.* " +
      "FROM positions p JOIN securities s ON s.id = p.security_id ORDER BY s.name"
    ),
    env.DB.prepare("SELECT * FROM cash ORDER BY currency"),
  ]);
  const positions = pos.results.map((r) => {
    const { security_id, qty, avg_price, avg_ccy, source, position_updated_at, ...sec } = r;
    return { security_id, qty, avg_price, avg_ccy, source, updated_at: position_updated_at, security: securityOut(sec) };
  });
  return json({ ok: true, at: nowIso(), positions, cash: cash.results }, 200, headers);
}

// ── 변화 감지 (SPEC §5.1) ─────────────────────────────
// 보유 수량이 바뀌는 모든 쓰기(merge, put, delete)는 position_changes에 행을 남긴다(reason NULL).
// 앱은 응답의 changes로 "매수/매도/…" 질문을 띄우고 PATCH로 이유를 채운다. 시트를 닫아도 기록은 남는다.

const QTY_EPS = 1e-9;

async function currentQty(env, ids) {
  if (!ids.length) return new Map();
  const { results } = await env.DB.prepare(
    "SELECT security_id, qty FROM positions WHERE security_id IN (" + ids.map((_, i) => "?" + (i + 1)).join(",") + ")"
  ).bind(...ids).all();
  return new Map(results.map((r) => [r.security_id, r.qty]));
}

/** before/after 수량 맵을 비교해 바뀐 것만 기록하고 반환한다. */
async function recordChanges(env, pairs, at) {
  const changed = pairs.filter((x) => Math.abs((x.before || 0) - (x.after || 0)) > QTY_EPS);
  if (!changed.length) return [];
  const res = await env.DB.batch(changed.map((x) => env.DB.prepare(
    "INSERT INTO position_changes (security_id, detected_at, qty_before, qty_after) VALUES (?1, ?2, ?3, ?4) RETURNING id"
  ).bind(x.id, at, x.before || 0, x.after || 0)));
  return changed.map((x, i) => ({ id: res[i].results[0].id, security_id: x.id, qty_before: x.before || 0, qty_after: x.after || 0 }));
}

async function withNames(env, changes) {
  if (!changes.length) return changes;
  const ids = [...new Set(changes.map((c) => c.security_id))];
  const { results } = await env.DB.prepare(
    "SELECT id, name, ticker FROM securities WHERE id IN (" + ids.map((_, i) => "?" + (i + 1)).join(",") + ")"
  ).bind(...ids).all();
  const byId = new Map(results.map((r) => [r.id, r]));
  return changes.map((c) => ({ ...c, name: byId.get(c.security_id)?.name, ticker: byId.get(c.security_id)?.ticker }));
}

export async function putPosition(request, env, headers, p) {
  const exists = await env.DB.prepare("SELECT 1 FROM securities WHERE id = ?1").bind(p.id).first();
  if (!exists) throw new HttpError(404, "종목 " + p.id + "이(가) 없습니다");
  const f = positionFields(await readJson(request));
  const at = nowIso();
  const before = (await currentQty(env, [p.id])).get(p.id) || 0;
  await upsertPositionStmt(env, p.id, f, at).run();
  const changes = await withNames(env, await recordChanges(env, [{ id: p.id, before, after: f.qty }], at));
  return json({ ok: true, changes }, 200, headers);
}

export async function deletePosition(request, env, headers, p) {
  const at = nowIso();
  const before = (await currentQty(env, [p.id])).get(p.id);
  if (before == null) throw new HttpError(404, "보유 중이 아닌 종목입니다");
  await env.DB.prepare("DELETE FROM positions WHERE security_id = ?1").bind(p.id).run();
  const changes = await withNames(env, await recordChanges(env, [{ id: p.id, before, after: 0 }], at));
  return json({ ok: true, changes }, 200, headers);
}

const REASONS = ["buy", "sell", "dividend_reinvest", "split"];

export async function listChanges(request, env, headers, _p, url) {
  const pending = url.searchParams.get("pending") === "1";
  const { results } = await env.DB.prepare(
    "SELECT c.*, s.name, s.ticker FROM position_changes c JOIN securities s ON s.id = c.security_id" +
    (pending ? " WHERE c.reason IS NULL AND c.skipped = 0" : "") +
    " ORDER BY c.detected_at DESC, c.id DESC LIMIT 200"
  ).all();
  return json({ ok: true, changes: results }, 200, headers);
}

/** { reason: 'buy'|'sell'|'dividend_reinvest'|'split' } 또는 { skipped: true } */
export async function patchChange(request, env, headers, p) {
  const body = await readJson(request);
  let reason = null;
  let skipped = 0;
  if (body.skipped) skipped = 1;
  else if (REASONS.includes(body.reason)) reason = body.reason;
  else throw new HttpError(400, "reason은 " + REASONS.join(" | ") + " 중 하나이거나 skipped: true여야 합니다");
  const r = await env.DB.prepare("UPDATE position_changes SET reason = ?1, skipped = ?2 WHERE id = ?3")
    .bind(reason, skipped, p.id).run();
  if (!r.meta.changes) throw new HttpError(404, "변화 기록 " + p.id + "이(가) 없습니다");
  return json({ ok: true }, 200, headers);
}

// ── 시뮬 저장 (portfolio_scenarios, SPEC §5.5) ─────────────────
// 시뮬은 연습장이다. 실제 보유(positions)는 절대 바꾸지 않는다.

export async function listScenarios(request, env, headers) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, deposit, created_at, weights FROM portfolio_scenarios ORDER BY created_at DESC"
  ).all();
  return json({ ok: true, scenarios: results.map((r) => ({ ...r, weights: JSON.parse(r.weights) })) }, 200, headers);
}

export async function createScenario(request, env, headers) {
  const body = await readJson(request);
  const name = String(body.name || "").trim();
  if (!name) throw new HttpError(400, "이름이 필요합니다");
  if (!body.weights || typeof body.weights !== "object") throw new HttpError(400, "weights가 필요합니다");
  const deposit = Number(body.deposit || 0);
  if (!Number.isFinite(deposit)) throw new HttpError(400, "deposit은 숫자여야 합니다");
  const row = await env.DB.prepare(
    "INSERT INTO portfolio_scenarios (name, weights, deposit, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id"
  ).bind(name, JSON.stringify(body.weights), deposit, nowIso()).first();
  return json({ ok: true, id: row.id }, 200, headers);
}

export async function deleteScenario(request, env, headers, p) {
  const r = await env.DB.prepare("DELETE FROM portfolio_scenarios WHERE id = ?1").bind(p.id).run();
  if (!r.meta.changes) throw new HttpError(404, "시나리오 " + p.id + "이(가) 없습니다");
  return json({ ok: true }, 200, headers);
}

/**
 * 여러 행을 한 번에 합친다 (SPEC §5.1의 merge 서버 쪽).
 * rows: [{name, ticker, ysym, market, currency, sector?, qty, avg_price, avg_ccy?, source?}]
 * 종목은 ysym 기준 upsert. asOwned면 보유도 덮어쓴다. 아니면 종목만 등록한다(시뮬 매수는 프론트 상태).
 * normalize(스크린샷 숫자 → qty/avg/price)는 프론트 lib/calc에서 먼저 거친다.
 */
export async function mergePortfolio(request, env, headers) {
  const body = await readJson(request);
  const r = await mergeRows(env, body.rows, body.asOwned !== false);
  return json({ ok: true, ...r }, 200, headers);
}

/** merge의 알맹이. /portfolio/merge와 초안 승인(§7.9)이 같이 쓴다. */
export async function mergeRows(env, rowsIn, asOwned) {
  const rows = Array.isArray(rowsIn) ? rowsIn : null;
  if (!rows || !rows.length) throw new HttpError(400, "rows가 비어 있습니다");
  if (rows.length > 100) throw new HttpError(400, "한 번에 100행까지 받습니다");
  const at = nowIso();

  const parsed = rows.map((r, i) => {
    try {
      const sec = pickFields(r, { partial: false });
      return { sec, pos: asOwned ? positionFields(r) : null };
    } catch (e) {
      throw new HttpError(400, (i + 1) + "번째 행: " + e.message);
    }
  });

  const existing = new Set(
    (await env.DB.prepare("SELECT ysym FROM securities").all()).results.map((r) => r.ysym)
  );
  const secResults = await env.DB.batch(parsed.map((x) => upsertSecurityStmt(env, x.sec, at)));
  const ids = secResults.map((r) => r.results[0].id);
  let changes = [];
  if (asOwned) {
    const before = await currentQty(env, ids);
    await env.DB.batch(parsed.map((x, i) => upsertPositionStmt(env, ids[i], x.pos, at)));
    changes = await withNames(env, await recordChanges(
      env, parsed.map((x, i) => ({ id: ids[i], before: before.get(ids[i]) || 0, after: x.pos.qty })), at
    ));
  }
  const added = parsed.filter((x) => !existing.has(x.sec.ysym)).length;
  return { added, updated: parsed.length - added, ids, changes };
}
