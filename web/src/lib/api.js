// Worker API fetch 래퍼. 토큰 헤더와 에러 처리를 한 곳에 둔다.
// 오프라인 캐시는 마일스톤 8에서 붙인다.

import { store } from "./storage.js";

export const DEFAULT_API_BASE = "https://invest-api.hyungjin0416.workers.dev";
const KEY_BASE = "invest.apiBase";
const KEY_TOKEN = "invest.token";

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

  let res;
  try {
    res = await fetchImpl(settings.apiBase + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "서버에 연결하지 못했습니다. 네트워크나 주소를 확인하세요");
  }

  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (res.status === 401) throw new ApiError(401, "토큰이 없거나 틀립니다. 더보기 → 설정에서 넣어주세요");
  if (!res.ok || (data && data.ok === false)) {
    throw new ApiError(res.status, (data && data.error) || "요청 실패 (" + res.status + ")");
  }
  return data;
}
