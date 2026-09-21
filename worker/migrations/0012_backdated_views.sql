-- 0012: 과거 날짜로 소급 기록한 투자의견 표시 (SPEC §5.2.6).
-- 예측 기록의 핵심은 "그때는 몰랐다"는 것이라, 사후에 넣은 의견은 섞지 않고 따로 센다.
-- 가격·PER·컨센서스는 그 날짜 기준으로 복원하므로 스냅샷 자체는 사실이다.

ALTER TABLE views ADD COLUMN backdated INTEGER NOT NULL DEFAULT 0;
