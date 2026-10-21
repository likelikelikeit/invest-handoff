-- 0016: 실적 발표일의 확정/예상 구분 (SPEC §5.7). 아침 브리핑이 둘을 다르게 보여준다.
--   1 = 확정(회사·거래소가 공지했거나 이미 발표됨), 0 = 예상(과거 패턴·데이터 제공처 추정), NULL = 모름(수동 일정 등)
ALTER TABLE events ADD COLUMN confirmed INTEGER;
