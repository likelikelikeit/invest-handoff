-- 0015: 커버리지 중단 (SPEC §5.2.9). 중단 = 현재 의견 철회 + 새 목표가 제시 중단.
-- 재개는 따로 기록하지 않는다. 중단 뒤 새 의견을 쓰면 그게 재개다.
-- 철회된 의견은 지우지 않는다. views.withdrawn_at이 차고, 정규 적중률·MAE에서 빠져 '철회'로 따로 센다.
-- 이미 목표가에 닿은(조기 적중) 의견은 결과가 확정돼 철회하지 않는다.

CREATE TABLE coverage_suspensions (
  id              INTEGER PRIMARY KEY,
  security_id     INTEGER NOT NULL REFERENCES securities(id),
  created_at      TEXT NOT NULL,                -- 중단 시각
  reasons         TEXT,                         -- JSON 배열 (고정 태그 중에서)
  memo            TEXT,
  view_id         INTEGER,                      -- 철회한 의견 (확정된 의견이었으면 NULL)
  price_at        REAL,                         -- 중단 시점 가격 (얼림)
  price_at_source TEXT
);
CREATE INDEX idx_susp_sec ON coverage_suspensions(security_id, created_at DESC);

ALTER TABLE views ADD COLUMN withdrawn_at TEXT;
