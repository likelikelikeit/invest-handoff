-- 0008: MCP가 넣는 초안 대기열 (M10).
-- 실제 데이터(positions/cash/views)는 앱에서 승인할 때만 바뀐다. MCP는 여기까지만 쓴다.
-- 의견 초안은 제출 시점의 가격·컨센서스를 payload에 얼려 둔다. 승인이 늦어도 기록 시점이 흐려지지 않게.

CREATE TABLE import_drafts (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,                       -- portfolio | view
  source      TEXT NOT NULL,                       -- mcp
  client_name TEXT,                                -- 넣은 쪽 (Claude, ChatGPT ...)
  proposed_at TEXT NOT NULL,                       -- 대화에서 정리한 시각
  payload     TEXT NOT NULL,                       -- JSON
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',     -- pending | applied | discarded
  resolved_at TEXT,
  result      TEXT                                 -- 적용 결과 JSON (view_id, added, updated ...)
);
CREATE INDEX idx_drafts_pending ON import_drafts(status, proposed_at DESC);
