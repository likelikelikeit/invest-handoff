import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api, settings, ApiError, DEFAULT_API_BASE } from "./api.js";
import { qtyDisplay, qtyStr, won, pct } from "./format.js";

function fakeFetch(status, body, seen) {
  return async (url, init) => {
    seen.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
}

describe("api", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("기본 주소와 Bearer 토큰을 붙인다", async () => {
    settings.token = "  abc  ";
    const seen = [];
    await api("/portfolio", { fetchImpl: fakeFetch(200, { ok: true }, seen) });
    expect(seen[0].url).toBe(DEFAULT_API_BASE + "/portfolio");
    expect(seen[0].init.headers.Authorization).toBe("Bearer abc");
  });

  it("주소 끝 슬래시를 지운다", () => {
    settings.apiBase = "http://127.0.0.1:8787/";
    expect(settings.apiBase).toBe("http://127.0.0.1:8787");
  });

  it("401은 한국어 안내", async () => {
    const p = api("/portfolio", { fetchImpl: fakeFetch(401, { ok: false }, []) });
    await expect(p).rejects.toThrow(/토큰/);
  });

  it("서버 에러 메시지를 그대로 올린다", async () => {
    const p = api("/x", { fetchImpl: fakeFetch(409, { ok: false, error: "보유 중" }, []) });
    await expect(p).rejects.toMatchObject({ status: 409, message: "보유 중" });
  });

  it("네트워크 실패는 status 0", async () => {
    const p = api("/x", { fetchImpl: async () => { throw new TypeError("fail"); } });
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ status: 0 });
  });

  it("GET 성공 응답을 저장하고 오프라인이면 마지막 응답을 돌려준다", async () => {
    const saved = new Map();
    vi.stubGlobal("caches", { open: async () => ({
      put: async (key, res) => saved.set(key, await res.json()),
      match: async (key) => saved.has(key) ? { json: async () => saved.get(key) } : null,
    }) });
    await api("/portfolio", { fetchImpl: fakeFetch(200, { ok: true, positions: [1] }, []) });
    const out = await api("/portfolio", { fetchImpl: async () => { throw new TypeError("offline"); } });
    expect(out.positions).toEqual([1]);
    expect(out._offline).toBe(true);
    expect(out._cached_at).toBeTruthy();
  });
});

describe("format", () => {
  it("qtyStr: 정수는 정수, 소수는 6자리까지", () => {
    expect(qtyStr(4)).toBe("4");
    expect(qtyStr(6.000007)).toBe("6.000007");
    expect(qtyStr(0.0007691234)).toBe("0.000769");
  });
  it("qtyDisplay: 원본은 건드리지 않고 정수 근처 표시 오차만 숨긴다", () => {
    expect(qtyDisplay(6.000007)).toBe("6");
    expect(qtyDisplay(15.999968)).toBe("16");
    expect(qtyDisplay(0.999994)).toBe("1");
    expect(qtyDisplay(0.000769)).toBe("0.000769");
  });
  it("won: 축약 없이 전체", () => expect(won(13755714)).toBe("13,755,714원"));
  it("pct: 1% 이상 한 자리, 미만 두 자리", () => {
    expect(pct(12.345)).toBe("12.3%");
    expect(pct(0.456)).toBe("0.46%");
  });
});
