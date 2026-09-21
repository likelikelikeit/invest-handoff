-- 0013: 투자의견 결론 (SPEC §5.2.1).
-- 핵심 논리·리스크와 별개로 "예상 EPS 얼마에 멀티플 몇 배를 왜 줘서 목표가 얼마, 그래서 무슨 의견"을
-- 한 덩어리 글로 남긴다. 숫자는 target_price·valuation에 이미 있고, 여기는 그 이유를 적는 칸이다.

ALTER TABLE views ADD COLUMN conclusion TEXT;
