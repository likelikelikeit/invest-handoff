-- 0004: 판정 기록 조회용 인덱스 (종목별 최신순, 크론의 1주·1개월 채움)
CREATE INDEX IF NOT EXISTS idx_tech_calls_sec ON tech_calls(security_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_calls_pending ON tech_calls(price_1m, called_at);
