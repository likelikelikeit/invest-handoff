// invest-mcp — Claude 커스텀 커넥터용 MCP 서버 (SPEC §2.3, 마일스톤 9).
// 경로: 메타데이터 2개(.well-known) + OAuth 3개(register/authorize/token) + /mcp.
// invest-api와 같은 D1을 읽는다. 투자 데이터는 절대 쓰지 않는다(쓰는 건 mcp_* 토큰 테이블뿐).

import { json, html, CORS, HttpError } from "./http.js";
import { authServerMetadata, resourceMetadata, register, authorizePage, authorizeApprove, token, verifyAccess } from "./oauth.js";
import { handleRpc } from "./mcp.js";

/** 인증 실패는 rfc9728대로 어디서 인가받는지 알려준다. 클라이언트는 이걸 보고 OAuth를 시작한다. */
const unauthorized = (origin, message) =>
  json({ error: "invalid_token", error_description: message }, 401, {
    "WWW-Authenticate":
      'Bearer realm="invest-note", resource_metadata="' + origin + '/.well-known/oauth-protected-resource"',
  });

const ERROR_PAGE = (message) => `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>연결 오류</title>
<body style="font-family:system-ui,sans-serif;padding:32px;line-height:1.6">
<h1 style="font-size:18px">연결할 수 없습니다</h1><p>${message}</p></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    try {
      // ── 메타데이터 ─────────────────────────────
      // 클라이언트는 자원 경로를 붙여서도 물어본다(.../oauth-authorization-server/mcp).
      if (path.startsWith("/.well-known/oauth-authorization-server")) return json(authServerMetadata(origin));
      if (path.startsWith("/.well-known/oauth-protected-resource")) return json(resourceMetadata(origin));

      // ── OAuth ────────────────────────────────
      if (path === "/register" && request.method === "POST") return await register(request, env);
      if (path === "/authorize" && request.method === "GET") return await authorizePage(request, env, url);
      if (path === "/authorize" && request.method === "POST") return await authorizeApprove(request, env);
      if (path === "/token" && request.method === "POST") return await token(request, env);

      // ── MCP ──────────────────────────────────
      if (path === "/mcp") {
        if (request.method !== "POST") {
          // 서버가 먼저 보내는 스트림(GET)은 쓰지 않는다. 상태 없는 서버다.
          return json({ error: "method_not_allowed", error_description: "POST만 받습니다" }, 405);
        }
        const token = await verifyAccess(request, env);
        if (!token) return unauthorized(origin, "토큰이 없거나 만료됐습니다");
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON을 읽을 수 없습니다" } }, 400);
        }
        const res = await handleRpc(body, env, { clientId: token.client_id, clientName: token.client_name });
        if (res == null) return new Response(null, { status: 202, headers: CORS }); // 알림만 온 경우
        return json(res);
      }

      if (path === "/health") {
        const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_tokens WHERE revoked_at IS NULL").first();
        return json({ ok: true, at: new Date().toISOString(), server: "invest-mcp", tokens: row.n });
      }

      if (path === "/") return html(ERROR_PAGE("여기는 MCP 서버입니다. Claude의 커스텀 커넥터에 <code>" + origin + "/mcp</code>를 등록하세요."));
      return json({ error: "not_found", error_description: "없는 경로입니다" }, 404);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = String(e.message || e);
      // 로그인 화면 쪽 오류는 사람이 보므로 HTML로.
      if (path === "/authorize") return html(ERROR_PAGE(message), status);
      return json({ error: status === 500 ? "server_error" : "invalid_request", error_description: message }, status);
    }
  },
};
