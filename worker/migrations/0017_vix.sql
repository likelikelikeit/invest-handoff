-- 0017: 시장 띠에 VIX(변동성 지수)를 더한다 (SPEC §5.8, 2026-10-22). 미국 장중 5분 틱이 같이 받는다.
INSERT INTO securities (name, ticker, ysym, market, currency, sector, asset_class, created_at, updated_at) VALUES
  ('VIX', 'VIX', '^VIX', 'US', 'USD', NULL, 'index', '2026-10-22T00:00:00+09:00', '2026-10-22T00:00:00+09:00')
ON CONFLICT(ysym) DO NOTHING;
