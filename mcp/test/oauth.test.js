import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index.js";
import { s256, randomToken } from "../src/http.js";
import { seed, env as makeEnv } from "./seed.js";

const ORIGIN = "https://invest-mcp.test";
let env;

const call = (path, init) => worker.fetch(new Request(ORIGIN + path, init), env);
const form = (obj) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(obj).toString(),
});
const postJson = (obj, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(obj),
});

async function registerClient() {
  const res = await call("/register", postJson({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }));
  expect(res.status).toBe(201);
  return res.json();
}

/** 등록 → 로그인 → 코드 → 토큰. 정상 경로를 한 번에. */
async function connect() {
  const client = await registerClient();
  const verifier = randomToken(32);
  const challenge = await s256(verifier);
  const params = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-1",
  };
  const approve = await call("/authorize", form({ ...params, token: "test-app-token" }));
  expect(approve.status).toBe(302);
  const code = new URL(approve.headers.get("Location")).searchParams.get("code");
  const tok = await call("/token", form({
    grant_type: "authorization_code", client_id: client.client_id, code,
    code_verifier: verifier, redirect_uri: client.redirect_uris[0],
  }));
  expect(tok.status).toBe(200);
  return { client, verifier, code, tokens: await tok.json() };
}

beforeEach(() => {
  env = makeEnv(seed().db);
});

describe("메타데이터", () => {
  it("인가 서버·보호 자원 메타데이터를 준다", async () => {
    const as = await (await call("/.well-known/oauth-authorization-server")).json();
    expect(as.issuer).toBe(ORIGIN);
    expect(as.token_endpoint).toBe(ORIGIN + "/token");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);

    // 클라이언트는 자원 경로를 붙여서도 물어본다
    const prm = await (await call("/.well-known/oauth-protected-resource/mcp")).json();
    expect(prm.resource).toBe(ORIGIN + "/mcp");
    expect(prm.authorization_servers).toEqual([ORIGIN]);
  });
});

describe("동적 등록", () => {
  it("https redirect_uri만 받는다", async () => {
    const bad = await call("/register", postJson({ redirect_uris: ["http://evil.example/cb"] }));
    expect(bad.status).toBe(400);
    const none = await call("/register", postJson({ client_name: "x" }));
    expect(none.status).toBe(400);
  });
});

describe("인가", () => {
  it("로그인 화면에 클라이언트 이름과 토큰 입력이 있다", async () => {
    const c = await registerClient();
    const res = await call("/authorize?response_type=code&client_id=" + c.client_id +
      "&redirect_uri=" + encodeURIComponent(c.redirect_uris[0]) + "&code_challenge=abc&code_challenge_method=S256");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("Claude");
    expect(body).toContain('name="token"');
    expect(body).toContain("제안");
  });

  it("등록 안 된 redirect_uri로는 보내지 않는다", async () => {
    const c = await registerClient();
    const res = await call("/authorize?client_id=" + c.client_id + "&redirect_uri=https://evil.example/cb&code_challenge=abc");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("등록되지 않은 redirect_uri");
  });

  it("PKCE 없이는 시작할 수 없다", async () => {
    const c = await registerClient();
    const res = await call("/authorize?client_id=" + c.client_id + "&redirect_uri=" + encodeURIComponent(c.redirect_uris[0]));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("code_challenge");
  });

  it("틀린 토큰은 코드를 주지 않는다", async () => {
    const c = await registerClient();
    const res = await call("/authorize", form({
      client_id: c.client_id, redirect_uri: c.redirect_uris[0], code_challenge: "abc", token: "틀린토큰",
    }));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("토큰이 맞지 않습니다");
  });

  it("맞는 토큰이면 state를 달고 코드로 돌려보낸다", async () => {
    const { client, code } = await connect();
    expect(code).toBeTruthy();
    expect(client.client_id).toMatch(/^mcp_/);
  });
});

describe("토큰", () => {
  it("code_verifier가 틀리면 거부한다", async () => {
    const c = await registerClient();
    const challenge = await s256("진짜");
    const approve = await call("/authorize", form({
      client_id: c.client_id, redirect_uri: c.redirect_uris[0], code_challenge: challenge, token: "test-app-token",
    }));
    const code = new URL(approve.headers.get("Location")).searchParams.get("code");
    const res = await call("/token", form({
      grant_type: "authorization_code", client_id: c.client_id, code, code_verifier: "가짜",
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("같은 인가 코드는 두 번 쓸 수 없다", async () => {
    const { client, verifier, code } = await connect();
    const again = await call("/token", form({
      grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier,
    }));
    expect(again.status).toBe(400);
    expect((await again.json()).error_description).toContain("이미 쓴");
  });

  it("갱신 토큰은 새 토큰을 주고 자신은 폐기된다(회전)", async () => {
    const { client, tokens } = await connect();
    const res = await call("/token", form({
      grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token,
    }));
    const next = await res.json();
    expect(next.access_token).toBeTruthy();
    expect(next.access_token).not.toBe(tokens.access_token);

    const reuse = await call("/token", form({
      grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token,
    }));
    expect(reuse.status).toBe(400);
  });

  it("토큰 원문은 DB에 남지 않는다", async () => {
    const { tokens } = await connect();
    const rows = env.DB.raw.prepare("SELECT token_hash FROM mcp_tokens").all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.token_hash !== tokens.access_token && /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });
});

describe("/mcp 접근", () => {
  it("토큰 없이는 401과 인가 서버 위치를 준다", async () => {
    const res = await call("/mcp", postJson({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("/.well-known/oauth-protected-resource");
  });

  it("엉뚱한 토큰도 401", async () => {
    const res = await call("/mcp", postJson({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { Authorization: "Bearer not-a-real-token" }));
    expect(res.status).toBe(401);
  });

  it("GET은 받지 않는다(상태 없는 서버)", async () => {
    expect((await call("/mcp", { method: "GET" })).status).toBe(405);
  });

  it("발급받은 토큰으로 initialize·tools/list가 된다", async () => {
    const { tokens } = await connect();
    const auth = { Authorization: "Bearer " + tokens.access_token };
    const init = await (await call("/mcp", postJson({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, auth))).json();
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.serverInfo.title).toBe("투자 노트");
    expect(init.result.instructions).toContain("앱에서 확인하면 반영된다");

    const list = await (await call("/mcp", postJson({ jsonrpc: "2.0", id: 2, method: "tools/list" }, auth))).json();
    expect(list.result.tools.map((t) => t.name).sort()).toEqual([
      "add_investment_view", "get_calendar", "get_company_view", "get_investment_views", "get_macro",
      "get_pending_drafts", "get_portfolio", "get_tech_calls", "submit_portfolio_import",
    ]);

    // 알림에는 응답하지 않는다
    const note = await call("/mcp", postJson({ jsonrpc: "2.0", method: "notifications/initialized" }, auth));
    expect(note.status).toBe(202);
  });

  it("모르는 프로토콜 버전을 주면 우리가 아는 최신으로 답한다", async () => {
    const { tokens } = await connect();
    const res = await (await call("/mcp", postJson(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      { Authorization: "Bearer " + tokens.access_token }
    ))).json();
    expect(res.result.protocolVersion).toBe("2025-06-18");
  });

  it("tools/call이 실제 데이터를 돌려준다", async () => {
    const { tokens } = await connect();
    const auth = { Authorization: "Bearer " + tokens.access_token };
    const res = await (await call("/mcp", postJson(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_portfolio", arguments: {} } }, auth))).json();
    expect(res.result.isError).toBeUndefined();
    expect(res.result.structuredContent.total.total_krw).toBe(9560000);
    expect(JSON.parse(res.result.content[0].text).positions).toHaveLength(2);
  });

  it("툴 실행 오류는 프로토콜 오류가 아니라 오류 결과로 온다", async () => {
    const { tokens } = await connect();
    const res = await (await call("/mcp", postJson(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_company_view", arguments: { ticker: "없는회사" } } },
      { Authorization: "Bearer " + tokens.access_token }))).json();
    expect(res.error).toBeUndefined();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("엔비디아");
  });

  it("없는 메서드는 -32601", async () => {
    const { tokens } = await connect();
    const res = await (await call("/mcp", postJson({ jsonrpc: "2.0", id: 9, method: "없는거" },
      { Authorization: "Bearer " + tokens.access_token }))).json();
    expect(res.error.code).toBe(-32601);
  });
});
