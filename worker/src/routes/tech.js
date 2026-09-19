// /tech — 매수·매도 판정 계기판 (SPEC §5.6). 투자의견(views)·성과평가와 섞지 않는다.

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso } from "../lib/time.js";
import { quote } from "../sources/yahoo.js";
import { DEFAULT_RULES, computeIndicators, judge, validateRules } from "../lib/tech.js";

/** 거래소 현지 날짜 'YYYY-MM-DD'. 미국 장 마감(KST 새벽)을 한국 날짜로 바꾸면 이미 있는 봉이 한 번 더 붙는다. */
export function exchangeDate(when, market) {
  const tz = market === "KR" ? "Asia/Seoul" : "America/New_York";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
}

const ACTIONS = ["bought", "partial", "waited", "skipped"];
const SIDES = ["buy", "sell"];

/** 현재 규칙 (최신 버전). 하나도 없으면 SPEC 기본값으로 첫 버전을 만든다. */
export async function currentRules(env) {
  let row = await env.DB.prepare("SELECT id, created_at, config, note FROM tech_rule_sets ORDER BY id DESC LIMIT 1").first();
  if (!row) {
    row = await env.DB.prepare(
      "INSERT INTO tech_rule_sets (created_at, config, note) VALUES (?1, ?2, '기본값 (SPEC §5.6.3)') RETURNING id, created_at, config, note"
    ).bind(nowIso(), JSON.stringify(DEFAULT_RULES)).first();
  }
  return { ...row, config: JSON.parse(row.config) };
}

export async function getRules(request, env, headers) {
  return json({ ok: true, rules: await currentRules(env) }, 200, headers);
}

export async function listRules(request, env, headers) {
  const { results } = await env.DB.prepare(
    "SELECT r.id, r.created_at, r.config, r.note, (SELECT COUNT(*) FROM tech_calls c WHERE c.rule_set_id = r.id) AS calls " +
    "FROM tech_rule_sets r ORDER BY r.id DESC LIMIT 50"
  ).all();
  return json({ ok: true, versions: results.map((r) => ({ ...r, config: JSON.parse(r.config) })) }, 200, headers);
}

/** 규칙 저장 = 새 버전 (이력 보존, 이전 판정은 그때 규칙을 가리킨다) */
export async function saveRules(request, env, headers) {
  const body = await readJson(request);
  let config;
  try {
    config = validateRules(body.config);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const row = await env.DB.prepare(
    "INSERT INTO tech_rule_sets (created_at, config, note) VALUES (?1, ?2, ?3) RETURNING id, created_at, config, note"
  ).bind(nowIso(), JSON.stringify(config), body.note ? String(body.note).trim() || null : null).first();
  return json({ ok: true, rules: { ...row, config: JSON.parse(row.config) } }, 200, headers);
}

async function getSec(env, id) {
  const s = await env.DB.prepare("SELECT id, name, ysym, market, currency, asset_class FROM securities WHERE id = ?1").bind(id).first();
  if (!s) throw new HttpError(404, "종목 " + id + "이(가) 없습니다");
  return s;
}

/**
 * GET /tech/:id?side=buy|sell — 지금 판정. 일봉 최근 300개 + 야후 지연 현재가(오늘 봉으로).
 * 현재가를 못 받으면 마지막 종가 기준으로 계산하고 그렇게 표시한다.
 */
export async function getTech(request, env, headers, p, url) {
  const side = url.searchParams.get("side") || "buy";
  if (!SIDES.includes(side)) throw new HttpError(400, "side는 buy | sell 중 하나여야 합니다");
  const sec = await getSec(env, p.id);
  const [{ results }, rules] = await Promise.all([
    env.DB.prepare(
      "SELECT date, close, high, low, volume FROM (SELECT * FROM prices WHERE security_id = ?1 ORDER BY date DESC LIMIT 300) ORDER BY date"
    ).bind(p.id).all(),
    currentRules(env),
  ]);
  if (results.length < 61) {
    return json({ ok: false, error: "시세 이력이 부족해 판정할 수 없습니다 (60거래일 이상 필요)" }, 200, headers);
  }
  let live = null;
  let quoteTime = null;
  try {
    const q = await quote(sec.ysym);
    quoteTime = q.time || null;
    // 체결 시각의 거래소 현지 날짜가 마지막 일봉보다 뒤일 때만 오늘 봉으로 붙는다 (computeIndicators가 비교)
    live = { price: q.price, date: exchangeDate(q.time ? new Date(q.time) : new Date(), sec.market) };
  } catch { /* 현재가 없음: 마지막 종가 기준 */ }
  const ind = computeIndicators(results, live);
  const j = judge(ind, rules.config, side);
  return json({
    ok: true, side, security_id: p.id, rule_set_id: rules.id,
    price: ind.price, as_of: ind.as_of, intraday: ind.intraday, quote_time: quoteTime,
    ...j,
  }, 200, headers);
}

/**
 * POST /tech/:id/calls — 본 판정을 그대로 기록 (사용자가 본 것 = 기록되는 것).
 * { side, rule_set_id, price_at, label, indicators, action?, note? }
 */
export async function createCall(request, env, headers, p) {
  await getSec(env, p.id);
  const b = await readJson(request);
  if (!SIDES.includes(b.side)) throw new HttpError(400, "side는 buy | sell 중 하나여야 합니다");
  if (!["low", "neutral", "high"].includes(b.label)) throw new HttpError(400, "label이 올바르지 않습니다");
  if (!(Number(b.price_at) > 0)) throw new HttpError(400, "price_at이 필요합니다");
  if (!Array.isArray(b.indicators)) throw new HttpError(400, "indicators가 필요합니다");
  if (b.action != null && !ACTIONS.includes(b.action)) throw new HttpError(400, "action은 " + ACTIONS.join(" | ") + " 중 하나여야 합니다");
  const rs = await env.DB.prepare("SELECT id FROM tech_rule_sets WHERE id = ?1").bind(Number(b.rule_set_id)).first();
  if (!rs) throw new HttpError(400, "규칙 버전 " + b.rule_set_id + "이(가) 없습니다");
  const indicators = b.indicators.map((x) => ({ key: String(x.key), value: x.value == null ? null : Number(x.value), verdict: String(x.verdict) }));
  const row = await env.DB.prepare(
    "INSERT INTO tech_calls (security_id, side, called_at, rule_set_id, price_at, indicators, label, action, note) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING *"
  ).bind(p.id, b.side, nowIso(), rs.id, Number(b.price_at), JSON.stringify(indicators), b.label, b.action ?? null,
    b.note ? String(b.note).trim() || null : null).first();
  return json({ ok: true, call: { ...row, indicators } }, 200, headers);
}

/** PATCH /tech/calls/:id — 나중에 행동·메모 기록 */
export async function patchCall(request, env, headers, p) {
  const b = await readJson(request);
  if (b.action !== undefined && b.action !== null && !ACTIONS.includes(b.action)) {
    throw new HttpError(400, "action은 " + ACTIONS.join(" | ") + " 중 하나여야 합니다");
  }
  const r = await env.DB.prepare(
    "UPDATE tech_calls SET action = CASE WHEN ?1 THEN ?2 ELSE action END, note = CASE WHEN ?3 THEN ?4 ELSE note END WHERE id = ?5"
  ).bind(b.action !== undefined ? 1 : 0, b.action ?? null, b.note !== undefined ? 1 : 0, b.note ? String(b.note).trim() || null : null, p.id).run();
  if (!r.meta.changes) throw new HttpError(404, "판정 기록 " + p.id + "이(가) 없습니다");
  return json({ ok: true }, 200, headers);
}

/** GET /tech/calls?security_id= */
export async function listCalls(request, env, headers, _p, url) {
  const sid = url.searchParams.get("security_id");
  const { results } = await env.DB.prepare(
    "SELECT * FROM tech_calls " + (sid ? "WHERE security_id = ?1 " : "") + "ORDER BY called_at DESC, id DESC LIMIT 200"
  ).bind(...(sid ? [Number(sid)] : [])).all();
  return json({ ok: true, calls: results.map((c) => ({ ...c, indicators: JSON.parse(c.indicators) })) }, 200, headers);
}

/**
 * 크론: 1주·1개월 뒤 가격 채움 (SPEC §5.6.5, 계기판 자체 평가용 데이터).
 * 기록일 + 7일 / + 30일 이후 첫 거래일 종가. 아직 그 날짜 봉이 없으면 다음에 다시.
 */
export function fillCallPricesStmts(env) {
  const fill = (col, days) => env.DB.prepare(
    "UPDATE tech_calls SET " + col + " = (SELECT p.close FROM prices p WHERE p.security_id = tech_calls.security_id " +
    "AND p.date >= date(substr(tech_calls.called_at, 1, 10), '+" + days + " days') ORDER BY p.date LIMIT 1) " +
    "WHERE " + col + " IS NULL AND date(substr(called_at, 1, 10), '+" + days + " days') <= date('now')"
  );
  return [fill("price_1w", 7), fill("price_1m", 30)];
}
