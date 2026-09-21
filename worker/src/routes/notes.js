// /notes — 테마·섹터·매크로 투자 메모 (SPEC §5.9).
// 종목 의견(views)과 달리 목표가·등급·기간이 없고 성과를 채점하지 않는다.
// 회고용으로 연결 종목의 '기록 시점 종가'만 같이 주고, 이후 수익률은 앱이 지금 시세로 계산한다.

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso, todayKst } from "../lib/time.js";

const STANCES = ["positive", "neutral", "negative"];
const MAX_TAGS = 12;
const MAX_SECURITIES = 20;

function text(v, { max = 4000 } = {}) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new HttpError(400, max + "자를 넘습니다");
  return s;
}

/** 입력 검증. partial이면 온 필드만 본다. */
export function noteFields(body, partial) {
  const out = {};
  if (body.title !== undefined || !partial) {
    const t = text(body.title, { max: 200 });
    if (!t) throw new HttpError(400, "제목이 필요합니다");
    out.title = t;
  }
  if (body.body !== undefined) out.body = text(body.body, { max: 20000 });
  if (body.stance !== undefined) {
    if (body.stance != null && body.stance !== "" && !STANCES.includes(body.stance)) {
      throw new HttpError(400, "stance는 " + STANCES.join(" | ") + " 중 하나여야 합니다");
    }
    out.stance = body.stance || null;
  }
  if (body.tags !== undefined) {
    const tags = Array.isArray(body.tags) ? body.tags : [];
    if (tags.length > MAX_TAGS) throw new HttpError(400, "태그는 " + MAX_TAGS + "개까지입니다");
    const clean = [...new Set(tags.map((t) => text(t, { max: 40 })).filter(Boolean))];
    out.tags = clean.length ? JSON.stringify(clean) : null;
  }
  return out;
}

function securityIds(body) {
  const ids = Array.isArray(body.securities) ? body.securities : [];
  if (ids.length > MAX_SECURITIES) throw new HttpError(400, "연결 종목은 " + MAX_SECURITIES + "개까지입니다");
  return [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

async function linkSecurities(env, noteId, ids) {
  const stmts = [env.DB.prepare("DELETE FROM note_securities WHERE note_id = ?1").bind(noteId)];
  for (const id of ids) {
    stmts.push(env.DB.prepare(
      "INSERT INTO note_securities (note_id, security_id) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM securities WHERE id = ?2)"
    ).bind(noteId, id));
  }
  await env.DB.batch(stmts);
}

/**
 * 메모에 붙일 종목 정보. price_at_note = 기록일(포함) 이전 마지막 종가.
 * 이후 수익률은 앱이 지금 시세로 계산한다(서버는 사실만 준다).
 */
const LINK_SELECT =
  "SELECT ns.note_id, s.id AS security_id, s.name, s.ticker, s.ysym, s.currency, s.market, " +
  "(SELECT p.close FROM prices p WHERE p.security_id = s.id AND p.date <= substr(n.created_at, 1, 10) ORDER BY p.date DESC LIMIT 1) AS price_at_note " +
  "FROM note_securities ns JOIN securities s ON s.id = ns.security_id JOIN notes n ON n.id = ns.note_id ";

const out = (row, links) => ({
  ...row,
  tags: row.tags ? JSON.parse(row.tags) : [],
  securities: links.filter((l) => l.note_id === row.id).map(({ note_id, ...rest }) => rest),
});

// GET /notes?tag=&security_id=&stance=&limit=
export async function listNotes(request, env, headers, _p, url) {
  const where = [];
  const args = [];
  const tag = url.searchParams.get("tag");
  if (tag) {
    args.push(tag);
    where.push("EXISTS (SELECT 1 FROM json_each(n.tags) WHERE json_each.value = ?" + args.length + ")");
  }
  const sid = url.searchParams.get("security_id");
  if (sid) {
    args.push(Number(sid));
    where.push("EXISTS (SELECT 1 FROM note_securities ns WHERE ns.note_id = n.id AND ns.security_id = ?" + args.length + ")");
  }
  const stance = url.searchParams.get("stance");
  if (stance) {
    args.push(stance);
    where.push("n.stance = ?" + args.length);
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 300);
  args.push(limit);

  const { results } = await env.DB.prepare(
    "SELECT n.* FROM notes n " + (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
    "ORDER BY n.created_at DESC, n.id DESC LIMIT ?" + args.length
  ).bind(...args).all();
  if (!results.length) return json({ ok: true, notes: [] }, 200, headers);

  const ids = results.map((r) => r.id);
  const { results: links } = await env.DB.prepare(
    LINK_SELECT + "WHERE ns.note_id IN (" + ids.map((_, i) => "?" + (i + 1)).join(",") + ") ORDER BY s.name"
  ).bind(...ids).all();
  return json({ ok: true, notes: results.map((r) => out(r, links)) }, 200, headers);
}

/** GET /notes/tags — 지금까지 쓴 태그 (많이 쓴 순). 입력 추천용. */
export async function listNoteTags(request, env, headers) {
  const { results } = await env.DB.prepare(
    "SELECT json_each.value AS tag, COUNT(*) AS n FROM notes, json_each(notes.tags) " +
    "WHERE notes.tags IS NOT NULL GROUP BY tag ORDER BY n DESC, tag LIMIT 40"
  ).all();
  return json({ ok: true, tags: results }, 200, headers);
}

async function readOne(env, id) {
  const row = await env.DB.prepare("SELECT * FROM notes WHERE id = ?1").bind(id).first();
  if (!row) throw new HttpError(404, "메모 " + id + "이(가) 없습니다");
  const { results: links } = await env.DB.prepare(LINK_SELECT + "WHERE ns.note_id = ?1 ORDER BY s.name").bind(id).all();
  return out(row, links);
}

/** 'YYYY-MM-DD' 소급 날짜. 오늘이거나 없으면 null. 메모는 시세가 필요 없어 날짜 제약이 없다. */
export function noteAsOf(value, today) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d\d-\d\d$/.test(s)) throw new HttpError(400, "as_of는 YYYY-MM-DD 형식이어야 합니다");
  if (s > today) throw new HttpError(400, "미래 날짜로는 기록할 수 없습니다");
  return s === today ? null : s;
}

/** 메모 한 건 넣기. 초안 승인(§7.9)도 이 함수를 쓴다. */
export async function insertNote(env, { fields: f, securities = [], createdAt, backdated = false }) {
  const row = await env.DB.prepare(
    "INSERT INTO notes (created_at, backdated, title, body, tags, stance) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id"
  ).bind(createdAt, backdated ? 1 : 0, f.title, f.body ?? null, f.tags ?? null, f.stance ?? null).first();
  if (securities.length) await linkSecurities(env, row.id, securities);
  return readOne(env, row.id);
}

// POST /notes
export async function createNote(request, env, headers) {
  const body = await readJson(request);
  const f = noteFields(body, false);
  const asOf = noteAsOf(body.as_of, todayKst());
  const note = await insertNote(env, {
    fields: f,
    securities: securityIds(body),
    createdAt: asOf ? asOf + "T00:00:00+09:00" : nowIso(),
    backdated: Boolean(asOf),
  });
  return json({ ok: true, note }, 200, headers);
}

// PATCH /notes/:id — 편집. 기록 시각은 그대로 두고 edited_at을 채운다.
export async function patchNote(request, env, headers, p) {
  const cur = await env.DB.prepare("SELECT id FROM notes WHERE id = ?1").bind(p.id).first();
  if (!cur) throw new HttpError(404, "메모 " + p.id + "이(가) 없습니다");
  const body = await readJson(request);
  const f = noteFields(body, true);
  const cols = Object.keys(f);
  if (!cols.length && body.securities === undefined) throw new HttpError(400, "바꿀 내용이 없습니다");
  if (cols.length) {
    f.edited_at = nowIso();
    const keys = [...cols, "edited_at"];
    await env.DB.prepare(
      "UPDATE notes SET " + keys.map((c, i) => c + " = ?" + (i + 1)).join(", ") + " WHERE id = ?" + (keys.length + 1)
    ).bind(...keys.map((c) => f[c]), p.id).run();
  }
  if (body.securities !== undefined) await linkSecurities(env, p.id, securityIds(body));
  return json({ ok: true, note: await readOne(env, p.id) }, 200, headers);
}

// DELETE /notes/:id
export async function deleteNote(request, env, headers, p) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM note_securities WHERE note_id = ?1").bind(p.id),
    env.DB.prepare("DELETE FROM notes WHERE id = ?1").bind(p.id),
  ]);
  return json({ ok: true }, 200, headers);
}
