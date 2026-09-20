// OAuth 2.1 인가 서버 (MCP 인증 규약, RFC 7591 동적 등록 + PKCE S256).
// 사용자 인증은 이미 있는 APP_TOKEN 하나로 한다: 로그인 화면에 앱 토큰을 붙여넣으면 승인.
// 계정·비밀번호를 새로 만들지 않는 대신, 토큰이 곧 신원이다.

import { json, html, safeEqual, randomToken, sha256hex, s256, escapeHtml, readParams, HttpError } from "./http.js";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
export const CODE_TTL = 10 * MIN;
export const ACCESS_TTL = 30 * DAY;
export const REFRESH_TTL = 180 * DAY;

const iso = (ms) => new Date(ms).toISOString();

/** 인가 서버 메타데이터 (RFC 8414) */
export function authServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: origin + "/authorize",
    token_endpoint: origin + "/token",
    registration_endpoint: origin + "/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp:read"],
  };
}

/** 보호 자원 메타데이터 (RFC 9728). 401을 받은 클라이언트가 여기로 와서 인가 서버를 찾는다. */
export function resourceMetadata(origin) {
  return {
    resource: origin + "/mcp",
    authorization_servers: [origin],
    scopes_supported: ["mcp:read"],
    bearer_methods_supported: ["header"],
  };
}

const oauthError = (code, desc, status = 400) => json({ error: code, error_description: desc }, status);

/** https만 받는다. 로컬 테스트용 localhost는 예외. */
function validRedirect(uri) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

// ── 동적 등록 ─────────────────────────────────────────
export async function register(request, env) {
  const body = await readParams(request);
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length) return oauthError("invalid_redirect_uri", "redirect_uris가 필요합니다");
  if (uris.length > 10) return oauthError("invalid_redirect_uri", "redirect_uris는 10개까지입니다");
  if (!uris.every(validRedirect)) return oauthError("invalid_redirect_uri", "redirect_uri는 https여야 합니다");
  const clientId = "mcp_" + randomToken(16);
  const name = String(body.client_name || "MCP 클라이언트").slice(0, 100);
  const at = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO mcp_clients (client_id, client_name, redirect_uris, created_at) VALUES (?1, ?2, ?3, ?4)"
  ).bind(clientId, name, JSON.stringify(uris), at).run();
  return json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.parse(at) / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, 201);
}

async function loadClient(env, clientId) {
  const row = await env.DB.prepare("SELECT * FROM mcp_clients WHERE client_id = ?1").bind(String(clientId || "")).first();
  if (!row) throw new HttpError(400, "등록되지 않은 클라이언트입니다");
  return { ...row, redirect_uris: JSON.parse(row.redirect_uris) };
}

/** authorize의 공통 검증. redirect_uri가 수상하면 그리로 보내지 않고 화면에 띄운다. */
async function checkAuthorize(env, p) {
  const client = await loadClient(env, p.client_id);
  const redirect = String(p.redirect_uri || "");
  if (!client.redirect_uris.includes(redirect)) throw new HttpError(400, "등록되지 않은 redirect_uri입니다");
  if (p.response_type && p.response_type !== "code") throw new HttpError(400, "response_type은 code만 받습니다");
  if (p.code_challenge_method && p.code_challenge_method !== "S256") throw new HttpError(400, "PKCE는 S256만 받습니다");
  if (!p.code_challenge) throw new HttpError(400, "code_challenge가 필요합니다 (PKCE 필수)");
  return { client, redirect };
}

const HIDDEN = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"];

const PAGE = (client, params, error) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>투자 노트 연결</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; --accent:#111; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141414; --fg:#f2f2f2; --muted:#9a9a9a; --line:#2c2c2c; --accent:#f2f2f2; } }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--fg);
         font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo",sans-serif; }
  .card { width:100%; max-width:380px; }
  h1 { font-size:20px; margin:0 0 6px; letter-spacing:-0.02em; }
  p { font-size:14px; color:var(--muted); margin:0 0 20px; line-height:1.6; }
  label { display:block; font-size:13px; margin-bottom:8px; }
  input { width:100%; box-sizing:border-box; padding:12px; font-size:16px; border:1px solid var(--line);
          border-radius:10px; background:transparent; color:var(--fg); }
  button { width:100%; margin-top:12px; padding:13px; font-size:15px; font-weight:600; border:0; border-radius:10px;
           background:var(--accent); color:var(--bg); cursor:pointer; }
  .err { font-size:13px; color:#d33; margin:12px 0 0; }
  .note { font-size:12px; color:var(--muted); margin-top:18px; line-height:1.6; }
</style></head>
<body><form class="card" method="post" action="/authorize">
  <h1>투자 노트 연결</h1>
  <p><strong>${escapeHtml(client.client_name)}</strong>이(가) 내 투자 데이터를 <strong>읽기 전용</strong>으로 보려고 합니다.
     앱에서 쓰는 토큰을 붙여넣으면 연결됩니다.</p>
  <label for="token">앱 토큰</label>
  <input id="token" name="token" type="password" autocomplete="off" autofocus required>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
  <button type="submit">연결 허용</button>
  <p class="note">읽기만 합니다. 보유·의견·일정·거시·판정 기록을 조회하고, 아무것도 바꾸지 않습니다.</p>
  ${HIDDEN.map((k) => (params[k] ? `<input type="hidden" name="${k}" value="${escapeHtml(params[k])}">` : "")).join("")}
</form></body></html>`;

export async function authorizePage(request, env, url) {
  const p = Object.fromEntries(url.searchParams.entries());
  const { client } = await checkAuthorize(env, p);
  return html(PAGE(client, p));
}

export async function authorizeApprove(request, env) {
  const p = await readParams(request);
  const { client, redirect } = await checkAuthorize(env, p);
  if (!env.APP_TOKEN) throw new HttpError(500, "워커에 APP_TOKEN 시크릿이 없습니다");
  if (!safeEqual(String(p.token || "").trim(), env.APP_TOKEN)) {
    return html(PAGE(client, p, "토큰이 맞지 않습니다. 다시 확인해 주세요."), 401);
  }
  const now = Date.now();
  const code = randomToken(32);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mcp_auth_codes WHERE expires_at < ?1").bind(iso(now)),
    env.DB.prepare(
      "INSERT INTO mcp_auth_codes (code_hash, client_id, redirect_uri, code_challenge, scope, expires_at, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    ).bind(await sha256hex(code), client.client_id, redirect, String(p.code_challenge),
           p.scope ? String(p.scope) : null, iso(now + CODE_TTL), iso(now)),
  ]);
  const to = new URL(redirect);
  to.searchParams.set("code", code);
  if (p.state) to.searchParams.set("state", String(p.state));
  return new Response(null, { status: 302, headers: { Location: to.toString(), "Cache-Control": "no-store" } });
}

// ── 토큰 발급 ─────────────────────────────────────────
async function issue(env, clientId) {
  const now = Date.now();
  const access = randomToken(32);
  const refresh = randomToken(32);
  const row = (hash, kind, ttl) => env.DB.prepare(
    "INSERT INTO mcp_tokens (token_hash, client_id, kind, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
  ).bind(hash, clientId, kind, iso(now + ttl), iso(now));
  await env.DB.batch([
    row(await sha256hex(access), "access", ACCESS_TTL),
    row(await sha256hex(refresh), "refresh", REFRESH_TTL),
    env.DB.prepare("DELETE FROM mcp_tokens WHERE expires_at < ?1").bind(iso(now)),
  ]);
  return json({
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL / 1000),
    refresh_token: refresh,
    scope: "mcp:read",
  });
}

export async function token(request, env) {
  const p = await readParams(request);
  const clientId = String(p.client_id || "");
  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.code_verifier) return oauthError("invalid_request", "code와 code_verifier가 필요합니다");
    const row = await env.DB.prepare("SELECT * FROM mcp_auth_codes WHERE code_hash = ?1")
      .bind(await sha256hex(String(p.code))).first();
    if (!row) return oauthError("invalid_grant", "인가 코드가 없습니다");
    if (row.used_at) return oauthError("invalid_grant", "이미 쓴 인가 코드입니다");
    if (Date.parse(row.expires_at) < Date.now()) return oauthError("invalid_grant", "인가 코드가 만료됐습니다");
    if (row.client_id !== clientId) return oauthError("invalid_grant", "클라이언트가 다릅니다");
    if (p.redirect_uri && String(p.redirect_uri) !== row.redirect_uri) return oauthError("invalid_grant", "redirect_uri가 다릅니다");
    if ((await s256(String(p.code_verifier))) !== row.code_challenge) return oauthError("invalid_grant", "code_verifier가 맞지 않습니다");
    await env.DB.prepare("UPDATE mcp_auth_codes SET used_at = ?1 WHERE code_hash = ?2")
      .bind(new Date().toISOString(), row.code_hash).run();
    return issue(env, row.client_id);
  }
  if (p.grant_type === "refresh_token") {
    const hash = await sha256hex(String(p.refresh_token || ""));
    const row = await env.DB.prepare("SELECT * FROM mcp_tokens WHERE token_hash = ?1 AND kind = 'refresh'").bind(hash).first();
    if (!row || row.revoked_at) return oauthError("invalid_grant", "갱신 토큰이 없습니다");
    if (Date.parse(row.expires_at) < Date.now()) return oauthError("invalid_grant", "갱신 토큰이 만료됐습니다");
    if (clientId && row.client_id !== clientId) return oauthError("invalid_grant", "클라이언트가 다릅니다");
    // 갱신 토큰은 한 번 쓰면 버린다(회전).
    await env.DB.prepare("UPDATE mcp_tokens SET revoked_at = ?1 WHERE token_hash = ?2")
      .bind(new Date().toISOString(), hash).run();
    return issue(env, row.client_id);
  }
  return oauthError("unsupported_grant_type", "authorization_code 또는 refresh_token만 받습니다");
}

/** /mcp 요청의 Bearer 확인. 통과하면 토큰 행을 돌려준다. */
export async function verifyAccess(request, env) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!m) return null;
  const hash = await sha256hex(m[1].trim());
  const row = await env.DB.prepare("SELECT * FROM mcp_tokens WHERE token_hash = ?1 AND kind = 'access'").bind(hash).first();
  if (!row || row.revoked_at || Date.parse(row.expires_at) < Date.now()) return null;
  const today = new Date().toISOString().slice(0, 10);
  // 마지막 사용은 하루 한 번만 기록한다 (D1 쓰기 아끼기).
  if (!row.last_used_at || !row.last_used_at.startsWith(today)) {
    await env.DB.prepare("UPDATE mcp_tokens SET last_used_at = ?1 WHERE token_hash = ?2")
      .bind(new Date().toISOString(), hash).run();
  }
  return row;
}
