-- 0007: MCP 서버용 OAuth 저장소 (M9). Claude 커스텀 커넥터가 OAuth로 붙는다.
-- 토큰과 인가 코드는 원문을 저장하지 않고 SHA-256 해시만 둔다(DB가 새도 토큰이 새지 않게).

-- 동적 등록(RFC 7591)으로 들어오는 클라이언트. Claude가 자기 redirect_uri를 등록한다.
CREATE TABLE mcp_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT,
  redirect_uris TEXT NOT NULL,           -- JSON 배열
  created_at    TEXT NOT NULL
);

-- 인가 코드: 10분 안에 한 번만 쓴다 (PKCE S256)
CREATE TABLE mcp_auth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope          TEXT,
  expires_at     TEXT NOT NULL,
  used_at        TEXT,
  created_at     TEXT NOT NULL
);

-- 접근·갱신 토큰
CREATE TABLE mcp_tokens (
  token_hash   TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,            -- 'access' | 'refresh'
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX idx_mcp_tokens_client ON mcp_tokens(client_id, kind);
