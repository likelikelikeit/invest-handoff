// 종목별 bear/base/bull 가정. 같은 이름은 덮어써도 views와 달리 시나리오는 현재 작업 상태다.

import { json, HttpError, readJson } from "../lib/http.js";
import { nowIso } from "../lib/time.js";
import { impliedTarget, VALUATION_METRICS } from "../lib/valuation.js";

const NAMES = ["bear", "base", "bull"];

function parseAssumptions(body) {
  const a = body?.assumptions;
  if (!a || typeof a !== "object" || Array.isArray(a)) throw new HttpError(400, "assumptions가 필요합니다");
  if (!VALUATION_METRICS.includes(a.metric)) throw new HttpError(400, "지원하지 않는 밸류에이션 지표입니다");
  const out = {
    metric: a.metric,
    value: Number(a.value),
    multiple: Number(a.multiple),
    growth_pct: a.growth_pct == null ? null : Number(a.growth_pct),
    horizon_years: a.horizon_years == null ? 1 : Number(a.horizon_years),
  };
  if (!(out.value > 0)) throw new HttpError(400, "가정 값은 0보다 커야 합니다");
  if (!(out.multiple > 0)) throw new HttpError(400, "목표 배수는 0보다 커야 합니다");
  if (!(out.horizon_years > 0 && out.horizon_years <= 2)) throw new HttpError(400, "미래 구간은 2년 이하여야 합니다");
  if (out.growth_pct != null && !Number.isFinite(out.growth_pct)) throw new HttpError(400, "성장률이 올바르지 않습니다");
  if (a.fiscal_year != null) out.fiscal_year = Number(a.fiscal_year);
  if (a.net_debt != null) out.net_debt = Number(a.net_debt);
  if (a.shares != null) out.shares = Number(a.shares);
  return out;
}

function out(row) {
  return row ? { ...row, assumptions: JSON.parse(row.assumptions) } : null;
}

export async function listValuationScenarios(request, env, headers, _p, url) {
  const sid = Number(url.searchParams.get("security_id"));
  if (!Number.isInteger(sid) || sid < 1) throw new HttpError(400, "security_id가 필요합니다");
  const { results } = await env.DB.prepare(
    "SELECT id,security_id,name,assumptions,implied_target,note,created_at,updated_at FROM scenarios " +
    "WHERE security_id=?1 ORDER BY CASE name WHEN 'bear' THEN 1 WHEN 'base' THEN 2 ELSE 3 END"
  ).bind(sid).all();
  return json({ ok: true, scenarios: results.map(out) }, 200, headers);
}

export async function saveValuationScenario(request, env, headers) {
  const body = await readJson(request);
  const sid = Number(body.security_id);
  const name = String(body.name || "");
  if (!Number.isInteger(sid) || sid < 1) throw new HttpError(400, "security_id가 필요합니다");
  if (!NAMES.includes(name)) throw new HttpError(400, "name은 bear | base | bull 중 하나여야 합니다");
  const exists = await env.DB.prepare("SELECT 1 FROM securities WHERE id=?1").bind(sid).first();
  if (!exists) throw new HttpError(404, "종목 " + sid + "이(가) 없습니다");
  const assumptions = parseAssumptions(body);
  const target = impliedTarget(assumptions);
  if (!(target > 0)) throw new HttpError(400, "가정으로 목표가를 계산할 수 없습니다");
  const at = nowIso();
  await env.DB.prepare(
    "INSERT INTO scenarios (security_id,name,assumptions,implied_target,note,created_at,updated_at) " +
    "VALUES (?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(security_id,name) DO UPDATE SET " +
    "assumptions=excluded.assumptions,implied_target=excluded.implied_target,note=excluded.note,updated_at=excluded.updated_at"
  ).bind(sid, name, JSON.stringify(assumptions), target, body.note == null ? null : String(body.note).trim() || null, at).run();
  const row = await env.DB.prepare("SELECT * FROM scenarios WHERE security_id=?1 AND name=?2").bind(sid, name).first();
  return json({ ok: true, scenario: out(row) }, 200, headers);
}

export async function deleteValuationScenario(request, env, headers, p) {
  const r = await env.DB.prepare("DELETE FROM scenarios WHERE id=?1").bind(p.id).run();
  if (!r.meta.changes) throw new HttpError(404, "시나리오 " + p.id + "이(가) 없습니다");
  return json({ ok: true }, 200, headers);
}
