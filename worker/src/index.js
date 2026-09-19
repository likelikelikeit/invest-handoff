// invest-api 라우터. 마일스톤 0: /health 만.
// 기존 worker.js의 /quotes /search /import 는 마일스톤 1에서 routes/ 로 옮긴다.

function allowedOrigins(env) {
  return String(env.ALLOW_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (allowedOrigins(env).includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status: status || 200, headers });

async function handleHealth(env, headers) {
  let db = "없음";
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").first();
      db = "ok (테이블 " + row.n + "개)";
    } catch (e) {
      db = "오류: " + String(e.message || e);
    }
  }
  return json({ ok: true, at: new Date().toISOString(), db }, 200, headers);
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    try {
      if (url.pathname === "/health") return await handleHealth(env, headers);
      return json({ ok: false, error: "없는 경로입니다" }, 404, headers);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 500, headers);
    }
  },
};
