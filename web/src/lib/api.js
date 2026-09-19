// Worker API fetch 래퍼. 토큰 헤더·에러·GET 오프라인 캐시를 한 곳에 둔다.

import { store } from "./storage.js";

export const DEFAULT_API_BASE = "https://invest-api.hyungjin0416.workers.dev";
const KEY_BASE = "invest.apiBase";
const KEY_TOKEN = "invest.token";
const API_CACHE = "invest-api-v1";

function tokenTag(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function cacheKey(url) {
  const u = new URL(url);
  u.searchParams.set("__invest_cache", tokenTag(settings.token));
  return u.toString();
}

async function cached(url) {
  if (!globalThis.caches) return null;
  try {
    const hit = await (await caches.open(API_CACHE)).match(cacheKey(url));
    if (!hit) return null;
    const saved = await hit.json();
    return saved?.data && typeof saved.data === "object"
      ? { ...saved.data, _offline: true, _cached_at: saved.at } : null;
  } catch { return null; }
}

async function remember(url, data) {
  if (!globalThis.caches || typeof Response === "undefined") return;
  try {
    const payload = JSON.stringify({ at: new Date().toISOString(), data });
    await (await caches.open(API_CACHE)).put(cacheKey(url), new Response(payload, { headers: { "Content-Type": "application/json" } }));
  } catch { /* 캐시 실패가 정상 요청을 깨뜨리면 안 된다 */ }
}

export const settings = {
  get apiBase() { return store.get(KEY_BASE, DEFAULT_API_BASE); },
  set apiBase(v) { v ? store.set(KEY_BASE, v.replace(/\/+$/, "")) : store.remove(KEY_BASE); },
  get token() { return store.get(KEY_TOKEN, ""); },
  set token(v) { v ? store.set(KEY_TOKEN, v.trim()) : store.remove(KEY_TOKEN); },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = "GET", body, fetchImpl = fetch } = {}) {
  const headers = {};
  if (settings.token) headers.Authorization = "Bearer " + settings.token;
  if (body !== undefined && typeof body !== "string") headers["Content-Type"] = "application/json";

  const url = settings.apiBase + path;
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  } catch {
    if (method === "GET") {
      const hit = await cached(url);
      if (hit) return hit;
    }
    throw new ApiError(0, "서버에 연결하지 못했습니다. 네트워크나 주소를 확인하세요");
  }

  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (res.status === 401) throw new ApiError(401, "토큰이 없거나 틀립니다. 더보기 → 설정에서 넣어주세요");
  if (!res.ok || (data && data.ok === false)) {
    throw new ApiError(res.status, (data && data.error) || "요청 실패 (" + res.status + ")");
  }
  if (method === "GET" && data && typeof data === "object") await remember(url, data);
  return data;
}
