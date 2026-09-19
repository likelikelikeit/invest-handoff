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

export async function putPosition(request, env, headers, p) {
  const exists = await env.DB.prepare("SELECT 1 FROM securities WHERE id = ?1").bind(p.id).first();
  if (!exists) throw new HttpError(404, "종목 " + p.id + "이(가) 없습니다");
  await upsertPositionStmt(env, p.id, positionFields(await readJson(request)), nowIso()).run();
  return json({ ok: true }, 200, headers);
}

export async function deletePosition(request, env, headers, p) {
  const r = await env.DB.prepare("DELETE FROM positions WHERE security_id = ?1").bind(p.id).run();
  if (!r.meta.changes) throw new HttpError(404, "보유 중이 아닌 종목입니다");
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
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || !rows.length) throw new HttpError(400, "rows가 비어 있습니다");
  if (rows.length > 100) throw new HttpError(400, "한 번에 100행까지 받습니다");
  const asOwned = body.asOwned !== false;
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
  if (asOwned) {
    await env.DB.batch(parsed.map((x, i) => upsertPositionStmt(env, ids[i], x.pos, at)));
  }
  const added = parsed.filter((x) => !existing.has(x.sec.ysym)).length;
  return json({ ok: true, added, updated: parsed.length - added, ids }, 200, headers);
}
