-- 모의투자 체결의 시세 기준과 슬리피지를 보존한다. 개인 투자 테이블은 변경하지 않는다.
ALTER TABLE sim_fills ADD COLUMN price_source TEXT;
ALTER TABLE sim_fills ADD COLUMN raw_price REAL;
ALTER TABLE sim_fills ADD COLUMN quote_start TEXT;
ALTER TABLE sim_fills ADD COLUMN quote_end TEXT;
ALTER TABLE sim_fills ADD COLUMN quote_fetched_at TEXT;
ALTER TABLE sim_fills ADD COLUMN slippage_bps REAL;
