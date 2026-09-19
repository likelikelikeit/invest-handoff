// 응답·CORS·인증 공통.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function allowedOrigins(env) {
  return String(env.ALLOW_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(request, env) {
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

export const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status: status || 200, headers });

/** 길이가 달라도 시간이 새지 않게 비교한다. */
export function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** Authorization: Bearer <APP_TOKEN> 확인. 시크릿이 없으면 전부 막는다. */
export function checkAuth(request, env) {
  if (!env.APP_TOKEN) throw new HttpError(500, "워커에 APP_TOKEN 시크릿이 없습니다");
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!m || !safeEqual(m[1].trim(), env.APP_TOKEN)) throw new HttpError(401, "토큰이 없거나 틀립니다");
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "본문이 올바른 JSON이 아닙니다");
  }
}
