-- 0002: 시장 띠(SPEC §5.8)용 지수·환율을 종목 마스터에 등록한다. 시세는 prices에 같이 쌓인다.
-- asset_class로 보유/관심 종목과 구분한다 (index, fx).
INSERT INTO securities (name, ticker, ysym, market, currency, sector, asset_class, created_at, updated_at) VALUES
  ('코스피',       'KS11',  '^KS11', 'KR', 'KRW', NULL, 'index', '2026-09-19T00:00:00+09:00', '2026-09-19T00:00:00+09:00'),
  ('S&P 500',      'GSPC',  '^GSPC', 'US', 'USD', NULL, 'index', '2026-09-19T00:00:00+09:00', '2026-09-19T00:00:00+09:00'),
  ('원/달러',      'USDKRW','KRW=X', 'KR', 'KRW', NULL, 'fx',    '2026-09-19T00:00:00+09:00', '2026-09-19T00:00:00+09:00'),
  ('미국 10년물',  'TNX',   '^TNX',  'US', 'USD', NULL, 'index', '2026-09-19T00:00:00+09:00', '2026-09-19T00:00:00+09:00')
ON CONFLICT(ysym) DO NOTHING;
