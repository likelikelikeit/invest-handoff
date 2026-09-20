// 종목·관심종목·현금.

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso } from "../lib/time.js";

const MARKETS = ["KR", "US"];
const CURRENCIES = ["KRW", "USD"];
const BANDS = ["per", "pbr", "ev_ebitda", "psr"];
const ASSET_CLASSES = ["equity", "bond", "cash", "index", "fx", "other"];

// 쓰기 가능한 컬럼과 검증. band_multiples는 객체로 받아 JSON 문자열로 저장한다.
const FIELDS = {
  name: (v) => str(v, "name"),
  ticker: (v) => str(v, "ticker"),
  ysym: (v) => str(v, "ysym"),
  isin: (v) => (v == null || v === "" ? null : str(v, "isin")),
  dart_corp_code: (v) => {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    if (!/^\d{8}$/.test(s)) throw new HttpError(400, "dart_corp_code는 8자리 숫자여야 합니다");
    return s;
  },
  market: (v) => oneOf(v, MARKETS, "market"),
  currency: (v) => oneOf(v, CURRENCIES, "currency"),
  sector: (v) => (v == null || v === "" ? null : str(v, "sector")),
  asset_class: (v) => oneOf(v, ASSET_CLASSES, "asset_class"),
  expected_return_pct: (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < -100 || n > 100) throw new HttpError(400, "expected_return_pct는 -100~100 사이 숫자여야 합니다");
    return n;
  },
  logo_url: (v) => (v == null || v === "" ? null : str(v, "logo_url")),
  brand_color: (v) => {
    if (v == null || v === "") return null;
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new HttpError(400, "brand_color는 #RRGGBB 형식이어야 합니다");
    return v;
  },
  band_default: (v) => oneOf(v, BANDS, "band_default"),
  band_multiples: (v) => (v == null ? null : JSON.stringify(v)),
};

function str(v, key) {
  const s = String(v ?? "").trim();
  if (!s) throw new HttpError(400, key + "이(가) 비어 있습니다");
  return s;
}
function oneOf(v, list, key) {
  if (!list.includes(v)) throw new HttpError(400, key + "는 " + list.join(" | ") + " 중 하나여야 합니다");
  return v;
}

export function pickFields(body, { partial }) {
  const out = {};
  for (const [k, check] of Object.entries(FIELDS)) {
    if (body[k] !== undefined) out[k] = check(body[k]);
  }
  if (!partial) {
    for (const k of ["name", "ticker", "ysym", "market", "currency"]) {
      if (out[k] === undefined) throw new HttpError(400, k + "이(가) 필요합니다");
    }
  }
  return out;
}

/** DB 행 → API 모양. band_multiples를 객체로 되돌린다. */
export function securityOut(row) {
  if (!row) return null;
  return { ...row, band_multiples: row.band_multiples ? JSON.parse(row.band_multiples) : null };
}

/**
 * ysym 기준 upsert 문. 이미 있으면 이름은 건드리지 않는다
 * (사용자가 한글로 친 이름을 야후 영문명이 덮지 않게, SPEC §5.9).
 */
export function upsertSecurityStmt(env, s, at) {
  const cols = Object.keys(s);
  const updatable = cols.filter((c) => c !== "ysym" && c !== "name");
  const sql =
    "INSERT INTO securities (" + cols.join(", ") + ", created_at, updated_at) VALUES (" +
    cols.map((_, i) => "?" + (i + 1)).join(", ") + ", ?" + (cols.length + 1) + ", ?" + (cols.length + 1) + ") " +
    "ON CONFLICT(ysym) DO UPDATE SET " +
    updatable.map((c) => c + " = excluded." + c).concat(["archived_at = NULL", "updated_at = excluded.updated_at"]).join(", ") +
    " RETURNING id";
  return env.DB.prepare(sql).bind(...cols.map((c) => s[c]), at);
}

async function getSecurity(env, id) {
  const row = await env.DB.prepare("SELECT * FROM securities WHERE id = ?1").bind(id).first();
  if (!row) throw new HttpError(404, "종목 " + id + "이(가) 없습니다");
  return row;
}

// ── /securities ──────────────────────────────────────
export async function listSecurities(request, env, headers, _p, url) {
  const all = url.searchParams.get("all") === "1";
  const { results } = await env.DB.prepare(
    "SELECT * FROM securities" + (all ? "" : " WHERE archived_at IS NULL") + " ORDER BY name"
  ).all();
  return json({ ok: true, securities: results.map(securityOut) }, 200, headers);
}

export async function getSecurityRoute(request, env, headers, p) {
  return json({ ok: true, security: securityOut(await getSecurity(env, p.id)) }, 200, headers);
}

export async function createSecurity(request, env, headers) {
  const s = pickFields(await readJson(request), { partial: false });
  const row = await upsertSecurityStmt(env, s, nowIso()).first();
  return json({ ok: true, security: securityOut(await getSecurity(env, row.id)) }, 200, headers);
}

export async function patchSecurity(request, env, headers, p) {
  await getSecurity(env, p.id);
  const s = pickFields(await readJson(request), { partial: true });
  const cols = Object.keys(s);
  if (cols.length) {
    await env.DB.prepare(
      "UPDATE securities SET " + cols.map((c, i) => c + " = ?" + (i + 1)).join(", ") +
      ", updated_at = ?" + (cols.length + 1) + " WHERE id = ?" + (cols.length + 2)
    ).bind(...cols.map((c) => s[c]), nowIso(), p.id).run();
  }
  return json({ ok: true, security: securityOut(await getSecurity(env, p.id)) }, 200, headers);
}

/** 물리 삭제 대신 숨김 (SPEC §3.3). 보유 중이면 막는다. */
export async function archiveSecurity(request, env, headers, p) {
  await getSecurity(env, p.id);
  const held = await env.DB.prepare("SELECT 1 FROM positions WHERE security_id = ?1").bind(p.id).first();
  if (held) throw new HttpError(409, "보유 중인 종목은 숨길 수 없습니다. 보유를 먼저 지우세요");
  const at = nowIso();
  await env.DB.prepare("UPDATE securities SET archived_at = ?1, updated_at = ?1 WHERE id = ?2").bind(at, p.id).run();
  return json({ ok: true, archived_at: at }, 200, headers);
}

// ── /watchlist ──────────────────────────────────────
export async function listWatchlist(request, env, headers) {
  const { results } = await env.DB.prepare(
    "SELECT w.id, w.security_id, w.group_name, w.note, w.added_at, s.name, s.ticker, s.ysym, s.market, s.currency " +
    "FROM watchlist w JOIN securities s ON s.id = w.security_id ORDER BY w.added_at"
  ).all();
  return json({ ok: true, watchlist: results }, 200, headers);
}

export async function addWatch(request, env, headers) {
  const body = await readJson(request);
  const sid = Number(body.security_id);
  if (!Number.isInteger(sid)) throw new HttpError(400, "security_id가 필요합니다");
  await getSecurity(env, sid);
  const row = await env.DB.prepare(
    "INSERT INTO watchlist (security_id, group_name, note, added_at) VALUES (?1, ?2, ?3, ?4) " +
    "ON CONFLICT(security_id, group_name) DO UPDATE SET note = excluded.note RETURNING id"
  ).bind(sid, body.group_name || null, body.note || null, nowIso()).first();
  return json({ ok: true, id: row.id }, 200, headers);
}

export async function removeWatch(request, env, headers, p) {
  const r = await env.DB.prepare("DELETE FROM watchlist WHERE id = ?1").bind(p.id).run();
  if (!r.meta.changes) throw new HttpError(404, "관심종목 " + p.id + "이(가) 없습니다");
  return json({ ok: true }, 200, headers);
}

// ── /cash ──────────────────────────────────────────
export async function listCash(request, env, headers) {
  const { results } = await env.DB.prepare("SELECT * FROM cash ORDER BY currency").all();
  return json({ ok: true, cash: results }, 200, headers);
}

/** [{currency, amount}] 여러 통화를 한 번에. 초안 승인(§7.9)과 /cash가 같이 쓴다. */
export async function putCashRows(env, rows) {
  const at = nowIso();
  const stmts = rows.map((r) => {
    const ccy = oneOf(r.currency, CURRENCIES, "currency");
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, "amount는 0 이상의 숫자여야 합니다");
    return env.DB.prepare(
      "INSERT INTO cash (currency, amount, updated_at) VALUES (?1, ?2, ?3) " +
      "ON CONFLICT(currency) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at"
    ).bind(ccy, amount, at);
  });
  if (stmts.length) await env.DB.batch(stmts);
  return rows;
}

export async function putCash(request, env, headers, p) {
  const amount = (await readJson(request)).amount;
  await putCashRows(env, [{ currency: p.currency, amount }]);
  return json({ ok: true }, 200, headers);
}
