-- 0018: 자산군 'commodity'(원자재)와 금 (SPEC §5.8 '기타 항목', 2026-10-22).
-- 금은 COMEX 금 선물(GC=F, 달러/트로이온스). 미국 장중 5분 틱과 미국 마감이 같이 받는다.
-- 은·유가 같은 것도 종목 추가 후 자산군을 '원자재'로 바꾸면 기타 항목에 나오고 시세가 쌓인다.
INSERT INTO securities (name, ticker, ysym, market, currency, sector, asset_class, created_at, updated_at) VALUES
  ('금', 'GOLD', 'GC=F', 'US', 'USD', NULL, 'commodity', '2026-10-22T00:00:00+09:00', '2026-10-22T00:00:00+09:00')
ON CONFLICT(ysym) DO NOTHING;
