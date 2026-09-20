// /views — 투자의견 (SPEC §5.2). 사건 방식: 업데이트는 새 행, 현재 의견 = 종목별 최신 행.
// 편집은 허용하되 edited_at을 채운다. 기록 시점 스냅샷(price_at 등)은 편집으로 바뀌지 않는다.
// 삭제는 자유 (사용자 결정 2026-09-19).

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso } from "../lib/time.js";
import { quote } from "../sources/yahoo.js";
import { RATINGS, scoreOf } from "../lib/ratings.js";
import { perAt } from "../lib/valuation.js";

const EDITABLE = ["rating", "target_price", "horizon_months", "thesis", "risks", "valuation"];

function text(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** 입력 검증. partial이면 온 필드만. */
function fields(body, partial) {
  const out = {};
  if (body.rating !== undefined || !partial) {
    if (scoreOf(body.rating) == null) throw new HttpError(400, "rating은 " + RATINGS.map((r) => r.label).join(" | ") + " 중 하나여야 합니다");
    out.rating = body.rating;
    out.rating_score = scoreOf(body.rating);
  }
  if (body.target_price !== undefined || !partial) {
    const t = Number(body.target_price);
    if (!(t > 0)) throw new HttpError(400, "target_price는 0보다 커야 합니다");
    out.target_price = t;
  }
  if (body.horizon_months !== undefined || !partial) {
    const h = body.horizon_months === undefined ? 12 : Number(body.horizon_months);
    if (!Number.isInteger(h) || h < 1 || h > 60) throw new HttpError(400, "horizon_months는 1~60 사이 정수여야 합니다");
    out.horizon_months = h;
  }
  if (body.thesis !== undefined) out.thesis = text(body.thesis);
  if (body.risks !== undefined) out.risks = text(body.risks);
  if (body.valuation !== undefined) out.valuation = body.valuation == null ? null : JSON.stringify(body.valuation);
  return out;
}

const SELECT =
  "SELECT v.*, s.name, s.ticker, s.ysym, s.market, s.currency, s.isin, s.brand_color, s.sector " +
  "FROM views v JOIN securities s ON s.id = v.security_id ";

function out(row) {
  if (!row) return null;
  return { ...row, valuation: row.valuation ? JSON.parse(row.valuation) : null };
}

/**
 * 기록 시점 가격: 앱이 아는 최신가 (SPEC §5.2.3). 야후 지연 시세 → 실패하면 저장된 마지막 종가.
 * 둘 다 없으면 기록할 수 없다(상승여력을 못 얼린다).
 */
async function priceNow(env, sec) {
  try {
    const q = await quote(sec.ysym);
    return { price: q.price, source: "yahoo(delayed)" + (q.time ? " " + q.time : "") };
  } catch {
    const r = await env.DB.prepare("SELECT date, close FROM prices WHERE security_id = ?1 ORDER BY date DESC LIMIT 1").bind(sec.id).first();
    if (r) return { price: r.close, source: "close " + r.date };
    throw new HttpError(503, "지금 가격을 알 수 없어 의견을 기록할 수 없습니다 (시세 없음)");
  }
}

/** 그 시점 컨센 목표가 (estimates, M5a부터 채워짐). 없으면 null. */
async function consensusNow(env, securityId) {
  const r = await env.DB.prepare(
    "SELECT target_price FROM estimates WHERE security_id = ?1 AND source IN ('yahoo','naver') AND target_price IS NOT NULL " +
    "ORDER BY as_of DESC LIMIT 1"
  ).bind(securityId).first();
  return r ? r.target_price : null;
}

// GET /views?security_id=&rating=&from=YYYY-MM-DD
export async function listViews(request, env, headers, _p, url) {
  const where = [];
  const args = [];
  const sid = url.searchParams.get("security_id");
  if (sid) { args.push(Number(sid)); where.push("v.security_id = ?" + args.length); }
  const rating = url.searchParams.get("rating");
  if (rating) { args.push(rating); where.push("v.rating = ?" + args.length); }
  const from = url.searchParams.get("from");
  if (from) { args.push(from); where.push("v.created_at >= ?" + args.length); }
  const { results } = await env.DB.prepare(
    SELECT + (where.length ? "WHERE " + where.join(" AND ") + " " : "") + "ORDER BY v.created_at DESC, v.id DESC LIMIT 500"
  ).bind(...args).all();
  return json({ ok: true, views: results.map(out) }, 200, headers);
}

// GET /views/latest — 종목별 현재 의견(최신 행)
export async function latestViews(request, env, headers) {
  const { results } = await env.DB.prepare(
    SELECT + "WHERE v.id = (SELECT v2.id FROM views v2 WHERE v2.security_id = v.security_id ORDER BY v2.created_at DESC, v2.id DESC LIMIT 1) " +
    "AND s.archived_at IS NULL ORDER BY v.created_at DESC"
  ).all();
  return json({ ok: true, views: results.map(out) }, 200, headers);
}

/**
 * 의견 한 행을 넣는다. 스냅샷(가격·컨센·PER)과 기록 시각을 밖에서 준다.
 * 앱에서 바로 기록할 때는 '지금'이지만, MCP 초안을 승인할 때는 제출 시점을 그대로 쓴다 (SPEC §7.9).
 */
export async function insertView(env, { securityId, currency, createdAt, fields: f, snapshot }) {
  const row = await env.DB.prepare(
    "INSERT INTO views (security_id, created_at, rating, rating_score, target_price, target_ccy, horizon_months, thesis, risks, valuation, " +
    "price_at, price_at_source, upside_pct, consensus_target_at, per_at) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) RETURNING id"
  ).bind(
    securityId, createdAt, f.rating, f.rating_score, f.target_price, currency, f.horizon_months,
    f.thesis ?? null, f.risks ?? null, f.valuation ?? null,
    snapshot.price, snapshot.source, f.target_price / snapshot.price - 1,
    snapshot.consensus ?? null, snapshot.per ?? null
  ).first();
  const v = await env.DB.prepare(SELECT + "WHERE v.id = ?1").bind(row.id).first();
  return out(v);
}

export { fields as viewFields };

// POST /views — 새 의견. 스냅샷은 서버가 얼린다.
export async function createView(request, env, headers) {
  const body = await readJson(request);
  const sid = Number(body.security_id);
  const sec = await env.DB.prepare("SELECT id, ysym, currency FROM securities WHERE id = ?1").bind(sid).first();
  if (!sec) throw new HttpError(404, "종목 " + body.security_id + "이(가) 없습니다");
  const f = fields(body, false);
  const px = await priceNow(env, sec);
  const view = await insertView(env, {
    securityId: sid, currency: sec.currency, createdAt: nowIso(), fields: f,
    snapshot: { price: px.price, source: px.source, consensus: await consensusNow(env, sid), per: await perAt(env, sid, px.price) },
  });
  return json({ ok: true, view }, 200, headers);
}

// PATCH /views/:id — 편집. edited_at을 채우고, 목표가가 바뀌면 기록 시점 가격 기준으로 상승여력을 다시 계산.
export async function patchView(request, env, headers, p) {
  const cur = await env.DB.prepare("SELECT * FROM views WHERE id = ?1").bind(p.id).first();
  if (!cur) throw new HttpError(404, "의견 " + p.id + "이(가) 없습니다");
  const body = await readJson(request);
  const f = fields(body, true);
  const cols = Object.keys(f).filter((k) => EDITABLE.includes(k) || k === "rating_score");
  if (!cols.length) throw new HttpError(400, "바꿀 내용이 없습니다");
  if (f.target_price !== undefined) {
    f.upside_pct = f.target_price / cur.price_at - 1;
    cols.push("upside_pct");
  }
  f.edited_at = nowIso();
  cols.push("edited_at");
  await env.DB.prepare(
    "UPDATE views SET " + cols.map((c, i) => c + " = ?" + (i + 1)).join(", ") + " WHERE id = ?" + (cols.length + 1)
  ).bind(...cols.map((c) => f[c]), p.id).run();
  const v = await env.DB.prepare(SELECT + "WHERE v.id = ?1").bind(p.id).first();
  return json({ ok: true, view: out(v) }, 200, headers);
}

// DELETE /views/:id
export async function deleteView(request, env, headers, p) {
  const r = await env.DB.prepare("DELETE FROM views WHERE id = ?1").bind(p.id).run();
  if (!r.meta.changes) throw new HttpError(404, "의견 " + p.id + "이(가) 없습니다");
  return json({ ok: true }, 200, headers);
}
