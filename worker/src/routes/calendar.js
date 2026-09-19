// /events — 일정 (SPEC §5.7), /macro — 거시 시계열·점도표 (SPEC §5.8).

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso } from "../lib/time.js";
import { upsertMacroStmt, dotsId, LONG_RUN_DATE } from "../lib/macro.js";
import { runMisc } from "../cron/misc.js";

const KINDS = ["earnings", "macro", "corporate", "custom"];
const isDate = (s) => /^\d{4}-\d\d-\d\d$/.test(String(s || ""));

// GET /events?from=YYYY-MM-DD&to=YYYY-MM-DD — 종목 일정은 숨긴 종목 제외, 종목 이름 포함
export async function listEvents(request, env, headers, _p, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, "from, to는 YYYY-MM-DD 형식이어야 합니다");
  const { results } = await env.DB.prepare(
    "SELECT e.*, s.name AS security_name, s.ticker FROM events e LEFT JOIN securities s ON s.id = e.security_id " +
    "WHERE e.date BETWEEN ?1 AND ?2 AND (e.security_id IS NULL OR s.archived_at IS NULL) " +
    "ORDER BY e.date, COALESCE(e.time, '00:00'), e.id"
  ).bind(from, to).all();
  return json({ ok: true, events: results.map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })) }, 200, headers);
}

// POST /events — 사용자 임의 일정 {date, time?, title, kind?(custom|corporate), security_id?}
export async function createEvent(request, env, headers) {
  const b = await readJson(request);
  if (!isDate(b.date)) throw new HttpError(400, "날짜는 YYYY-MM-DD 형식이어야 합니다");
  if (b.time != null && b.time !== "" && !/^\d\d:\d\d$/.test(b.time)) throw new HttpError(400, "시간은 HH:MM 형식이어야 합니다");
  const title = String(b.title || "").trim();
  if (!title) throw new HttpError(400, "제목이 필요합니다");
  const kind = b.kind || "custom";
  if (!["custom", "corporate"].includes(kind)) throw new HttpError(400, "직접 추가하는 일정은 custom | corporate만 됩니다");
  const sid = b.security_id == null ? null : Number(b.security_id);
  if (sid != null && !(await env.DB.prepare("SELECT 1 FROM securities WHERE id = ?1").bind(sid).first())) {
    throw new HttpError(404, "종목 " + sid + "이(가) 없습니다");
  }
  const row = await env.DB.prepare(
    "INSERT INTO events (date, time, kind, security_id, title, source, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'manual', NULL, ?6) RETURNING *"
  ).bind(b.date, b.time || null, kind, sid, title, nowIso()).first();
  return json({ ok: true, event: row }, 200, headers);
}

// DELETE /events/:id — 직접 넣은(manual) 일정만. 야후 어닝일은 크론이 다시 만들기 때문에 지우지 않는다.
export async function deleteEvent(request, env, headers, p) {
  const e = await env.DB.prepare("SELECT source FROM events WHERE id = ?1").bind(p.id).first();
  if (!e) throw new HttpError(404, "일정 " + p.id + "이(가) 없습니다");
  if (e.source !== "manual") throw new HttpError(409, "자동으로 받은 일정은 지울 수 없습니다");
  await env.DB.prepare("DELETE FROM events WHERE id = ?1").bind(p.id).run();
  return json({ ok: true }, 200, headers);
}

// GET /macro?from=YYYY-MM-DD — 시리즈 정의 + 값 + 최신 점도표
export async function getMacro(request, env, headers, _p, url) {
  const from = url.searchParams.get("from") || "2020-01-01";
  if (!isDate(from)) throw new HttpError(400, "from은 YYYY-MM-DD 형식이어야 합니다");
  const [defs, rows, dots] = await env.DB.batch([
    env.DB.prepare("SELECT series_id, name, unit, source FROM macro_series WHERE series_id NOT LIKE 'FED_DOTS_%' ORDER BY series_id"),
    env.DB.prepare("SELECT series_id, date, value FROM macro WHERE series_id NOT LIKE 'FED_DOTS_%' AND date >= ?1 ORDER BY series_id, date").bind(from),
    env.DB.prepare(
      "SELECT m.series_id, m.date, m.value FROM macro m WHERE m.series_id = " +
      "(SELECT series_id FROM macro_series WHERE series_id LIKE 'FED_DOTS_%' ORDER BY series_id DESC LIMIT 1) ORDER BY m.date"
    ),
  ]);
  const series = {};
  for (const d of defs.results) series[d.series_id] = { ...d, points: [] };
  for (const r of rows.results) series[r.series_id]?.points.push([r.date, r.value]);
  const dr = dots.results;
  const status = await env.DB.prepare("SELECT value FROM meta WHERE key = 'cron:misc'").first();
  return json({
    ok: true, series,
    dots: dr.length ? {
      sep: dr[0].series_id.slice(-6, -2) + "-" + dr[0].series_id.slice(-2),
      points: dr.filter((r) => r.date !== LONG_RUN_DATE).map((r) => [r.date, r.value]),
      long_run: dr.find((r) => r.date === LONG_RUN_DATE)?.value ?? null,
    } : null,
    cron: status ? JSON.parse(status.value) : null,
  }, 200, headers);
}

// POST /macro/dots — 점도표 중간값 수동 입력 (분기마다). {sep:'YYYY-MM', medians:{2026:3.625, 2027:3.375, ...}, long_run?}
export async function saveDots(request, env, headers) {
  const b = await readJson(request);
  if (!/^\d{4}-\d\d$/.test(String(b.sep || ""))) throw new HttpError(400, "sep은 YYYY-MM 형식이어야 합니다 (점도표가 나온 FOMC 달)");
  const rows = [];
  for (const [year, v] of Object.entries(b.medians || {})) {
    const n = Number(v);
    if (!/^\d{4}$/.test(year) || !Number.isFinite(n) || n < 0 || n > 20) throw new HttpError(400, year + "년 중간값이 올바르지 않습니다");
    rows.push({ date: year + "-12-31", value: n });
  }
  if (b.long_run != null && b.long_run !== "") {
    const n = Number(b.long_run);
    if (!Number.isFinite(n) || n < 0 || n > 20) throw new HttpError(400, "장기 중간값이 올바르지 않습니다");
    rows.push({ date: LONG_RUN_DATE, value: n });
  }
  if (!rows.length) throw new HttpError(400, "중간값을 하나 이상 넣어주세요");
  const id = dotsId(b.sep);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO macro_series (series_id, name, unit, source, fetch_key) VALUES (?1, ?2, '%', 'manual', NULL) ON CONFLICT(series_id) DO NOTHING"
    ).bind(id, "Fed 점도표 중간값 (" + b.sep + " FOMC)"),
    env.DB.prepare("DELETE FROM macro WHERE series_id = ?1").bind(id),
    upsertMacroStmt(env, id, rows),
  ]);
  return json({ ok: true, series_id: id, points: rows.length }, 200, headers);
}

// POST /macro/refresh?backfill=1 — 거시·실적일 즉시 갱신 (키를 막 넣었을 때 과거 이력까지)
export async function refreshMacro(request, env, headers, _p, url) {
  const report = await runMisc(env, new Date(), { backfill: url.searchParams.get("backfill") === "1" });
  return json({ ok: true, report }, 200, headers);
}
