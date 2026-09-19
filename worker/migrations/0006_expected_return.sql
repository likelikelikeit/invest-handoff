-- M8: 종목별 사용자 기대수익률 가정. 퍼센트 단위(예: 8.5 = 연 8.5%).
ALTER TABLE securities ADD COLUMN expected_return_pct REAL;
