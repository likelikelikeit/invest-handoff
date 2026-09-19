-- 0005: 거시 시계열 정의 + 연 1회 수동 일정 시드 (SPEC §5.7, §5.8).
-- 일정은 발표 시각을 KST로 저장한다. 출처(2026-09-19 확인):
--   FOMC  federalreserve.gov/monetarypolicy/fomccalendars.htm  (둘째 날 14:00 ET 발표 → KST 다음 날 03:00, 서머타임 아니면 04:00)
--   CPI   bls.gov/schedule/news_release/cpi.htm      (08:30 ET → KST 21:30 / 22:30)
--   고용  bls.gov/schedule/news_release/empsit.htm   (08:30 ET → KST 21:30 / 22:30)
--   금통위 bok.or.kr 통화정책방향 결정회의 일정      (10:00 KST 전후 발표)
-- 미국 서머타임: 2026-03-08 ~ 2026-11-01, 2027-03-14 ~ 2027-11-07. 크론 코드가 아니라 시드 데이터라 손으로 계산해 넣었다.
-- 내년 일정은 연초에 같은 방식의 새 마이그레이션으로 추가한다.

INSERT INTO macro_series (series_id, name, unit, source, fetch_key) VALUES
  ('FEDFUNDS', '미국 기준금리(실효 연방기금금리)', '%', 'fred', 'FEDFUNDS'),
  ('DGS2', '미국 2년물 국채금리', '%', 'fred', 'DGS2'),
  ('DGS10', '미국 10년물 국채금리', '%', 'fred', 'DGS10'),
  ('BOK_BASE', '한국은행 기준금리', '%', 'ecos', '722Y001/M/0101000')
ON CONFLICT(series_id) DO NOTHING;

-- 같은 (종류, 날짜, 제목)이 있으면 넣지 않는다 (종목 없는 일정은 security_id가 NULL이라 유니크 인덱스가 막지 못한다)
INSERT INTO events (date, time, kind, security_id, title, source, detail, created_at)
SELECT v.date, v.time, 'macro', NULL, v.title, 'manual', v.detail, '2026-09-19T00:00:00+09:00'
FROM (
  SELECT '2026-01-29' AS date, '04:00' AS time, 'FOMC 금리 결정' AS title, '{"local":"2026-01-28 14:00 ET"}' AS detail
  UNION ALL SELECT '2026-03-19', '03:00', 'FOMC 금리 결정 · 점도표', '{"local":"2026-03-18 14:00 ET","sep":true}'
  UNION ALL SELECT '2026-04-30', '03:00', 'FOMC 금리 결정', '{"local":"2026-04-29 14:00 ET"}'
  UNION ALL SELECT '2026-06-18', '03:00', 'FOMC 금리 결정 · 점도표', '{"local":"2026-06-17 14:00 ET","sep":true}'
  UNION ALL SELECT '2026-07-30', '03:00', 'FOMC 금리 결정', '{"local":"2026-07-29 14:00 ET"}'
  UNION ALL SELECT '2026-09-17', '03:00', 'FOMC 금리 결정 · 점도표', '{"local":"2026-09-16 14:00 ET","sep":true}'
  UNION ALL SELECT '2026-10-29', '03:00', 'FOMC 금리 결정', '{"local":"2026-10-28 14:00 ET"}'
  UNION ALL SELECT '2026-12-10', '04:00', 'FOMC 금리 결정 · 점도표', '{"local":"2026-12-09 14:00 ET","sep":true}'
  UNION ALL SELECT '2027-01-28', '04:00', 'FOMC 금리 결정', '{"local":"2027-01-27 14:00 ET"}'
  UNION ALL SELECT '2027-03-18', '03:00', 'FOMC 금리 결정 · 점도표', '{"local":"2027-03-17 14:00 ET","sep":true}'
  UNION ALL SELECT '2027-04-29', '03:00', 'FOMC 금리 결정', '{"local":"2027-04-28 14:00 ET"}'
  UNION ALL SELECT '2027-06-10', '03:00', 'FOMC 금리 결정 · 점도표', '{"local":"2027-06-09 14:00 ET","sep":true}'
  UNION ALL SELECT '2027-07-29', '03:00', 'FOMC 금리 결정', '{"local":"2027-07-28 14:00 ET"}'
  UNION ALL SELECT '2027-09-16', '03:00', 'FOMC 금리 결정 · 점도표', '{"local":"2027-09-15 14:00 ET","sep":true}'
  UNION ALL SELECT '2027-10-28', '03:00', 'FOMC 금리 결정', '{"local":"2027-10-27 14:00 ET"}'
  UNION ALL SELECT '2027-12-09', '04:00', 'FOMC 금리 결정 · 점도표', '{"local":"2027-12-08 14:00 ET","sep":true}'
  UNION ALL SELECT '2026-01-15', '10:00', '금통위 기준금리 결정', NULL
  UNION ALL SELECT '2026-02-26', '10:00', '금통위 기준금리 결정', NULL
  UNION ALL SELECT '2026-04-10', '10:00', '금통위 기준금리 결정', NULL
  UNION ALL SELECT '2026-05-28', '10:00', '금통위 기준금리 결정', NULL
  UNION ALL SELECT '2026-07-16', '10:00', '금통위 기준금리 결정', NULL
  UNION ALL SELECT '2026-08-27', '10:00', '금통위 기준금리 결정', NULL
  UNION ALL SELECT '2026-10-22', '10:00', '금통위 기준금리 결정', NULL
  UNION ALL SELECT '2026-11-26', '10:00', '금통위 기준금리 결정', NULL
  UNION ALL SELECT '2026-10-14', '21:30', '미국 CPI (9월)', '{"local":"2026-10-14 08:30 ET"}'
  UNION ALL SELECT '2026-11-10', '22:30', '미국 CPI (10월)', '{"local":"2026-11-10 08:30 ET"}'
  UNION ALL SELECT '2026-12-10', '22:30', '미국 CPI (11월)', '{"local":"2026-12-10 08:30 ET"}'
  UNION ALL SELECT '2026-10-02', '21:30', '미국 고용보고서 (9월)', '{"local":"2026-10-02 08:30 ET"}'
  UNION ALL SELECT '2026-11-06', '22:30', '미국 고용보고서 (10월)', '{"local":"2026-11-06 08:30 ET"}'
  UNION ALL SELECT '2026-12-04', '22:30', '미국 고용보고서 (11월)', '{"local":"2026-12-04 08:30 ET"}'
) v
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.kind = 'macro' AND e.date = v.date AND e.title = v.title);
