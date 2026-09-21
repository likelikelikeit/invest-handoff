// /drafts — MCP가 넣은 초안 대기열 (SPEC §7.9, M10).
// MCP 서버는 여기에 제안만 쌓는다. 실제 보유·현금·의견은 이 경로로 사용자가 승인할 때만 바뀐다.

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso } from "../lib/time.js";
import { insertView, viewFields } from "./views.js";
import { insertNote, noteFields } from "./notes.js";
import { mergeRows } from "./portfolio.js";
import { putCashRows } from "./securities.js";

const out = (d) => ({ ...d, payload: JSON.parse(d.payload), result: d.result ? JSON.parse(d.result) : null });

// GET /drafts?status=pending
export async function listDrafts(request, env, headers, _p, url) {
  const status = url.searchParams.get("status") || "pending";
  if (!["pending", "applied", "discarded", "all"].includes(status)) {
    throw new HttpError(400, "status는 pending | applied | discarded | all 중 하나여야 합니다");
  }
  const { results } = await env.DB.prepare(
    "SELECT * FROM import_drafts " + (status === "all" ? "" : "WHERE status = ?1 ") +
    "ORDER BY proposed_at DESC, id DESC LIMIT 50"
  ).bind(...(status === "all" ? [] : [status])).all();
  return json({ ok: true, drafts: results.map(out) }, 200, headers);
}

async function pending(env, id) {
  const d = await env.DB.prepare("SELECT * FROM import_drafts WHERE id = ?1").bind(id).first();
  if (!d) throw new HttpError(404, "초안 " + id + "이(가) 없습니다");
  if (d.status !== "pending") throw new HttpError(409, "이미 " + (d.status === "applied" ? "반영한" : "버린") + " 초안입니다");
  return out(d);
}

async function resolve(env, id, status, result) {
  await env.DB.prepare("UPDATE import_drafts SET status = ?1, resolved_at = ?2, result = ?3 WHERE id = ?4")
    .bind(status, nowIso(), result ? JSON.stringify(result) : null, id).run();
}

/**
 * POST /drafts/:id/apply — 승인.
 * 보유 초안: 사용자가 시트에서 고친 {rows, cash}를 그대로 받아 합친다(초안 원본은 참고용으로 남는다).
 * 의견 초안: 제출 시점에 얼린 가격·컨센서스로 그 시각에 기록한다. 승인이 늦어도 시점이 밀리지 않는다.
 */
export async function applyDraft(request, env, headers, p) {
  const d = await pending(env, p.id);
  const body = await readJson(request).catch(() => ({}));

  if (d.kind === "portfolio") {
    const rows = Array.isArray(body.rows) && body.rows.length ? body.rows : d.payload.rows;
    const cash = Array.isArray(body.cash) ? body.cash : d.payload.cash || [];
    const merged = await mergeRows(env, rows, true);
    const cashRows = cash.length ? await putCashRows(env, cash) : [];
    const result = { added: merged.added, updated: merged.updated, cash: cashRows.length };
    await resolve(env, p.id, "applied", result);
    return json({ ok: true, ...result, changes: merged.changes }, 200, headers);
  }

  if (d.kind === "view") {
    const v = d.payload;
    const sec = await env.DB.prepare("SELECT id, currency FROM securities WHERE id = ?1").bind(v.security_id).first();
    if (!sec) throw new HttpError(404, "종목 " + v.security_id + "이(가) 없습니다");
    const f = viewFields(v, false);
    const view = await insertView(env, {
      securityId: sec.id, currency: sec.currency, createdAt: d.proposed_at, fields: f,
      snapshot: v.snapshot,
    });
    await resolve(env, p.id, "applied", { view_id: view.id });
    return json({ ok: true, view }, 200, headers);
  }

  if (d.kind === "note") {
    const p2 = d.payload;
    const note = await insertNote(env, {
      fields: noteFields(p2, false),
      securities: Array.isArray(p2.securities) ? p2.securities : [],
      createdAt: d.proposed_at,          // 대화에서 정리한 그 시각
    });
    await resolve(env, p.id, "applied", { note_id: note.id });
    return json({ ok: true, note }, 200, headers);
  }

  throw new HttpError(400, "모르는 초안 종류입니다: " + d.kind);
}

// POST /drafts/:id/discard — 버리기. 기록은 남긴다(무엇이 들어왔었는지 보이게).
export async function discardDraft(request, env, headers, p) {
  await pending(env, p.id);
  await resolve(env, p.id, "discarded", null);
  return json({ ok: true }, 200, headers);
}
