-- 미국 정책금리는 EFFR 월평균(FEDFUNDS)이 아니라 FOMC가 정한 목표범위로 표시한다.
-- 목표범위는 하단·상단을 따로 저장하고, EFFR은 상세 화면의 별도 지표로 남긴다.

UPDATE macro_series
SET name = '미국 실효 연방기금금리(EFFR)'
WHERE series_id = 'FEDFUNDS';

INSERT INTO macro_series (series_id, name, unit, source, fetch_key) VALUES
  ('FED_TARGET_LOWER', '미국 연방기금 목표범위 하단', '%', 'fred', 'DFEDTARL'),
  ('FED_TARGET_UPPER', '미국 연방기금 목표범위 상단', '%', 'fred', 'DFEDTARU')
ON CONFLICT(series_id) DO UPDATE SET
  name = excluded.name,
  unit = excluded.unit,
  source = excluded.source,
  fetch_key = excluded.fetch_key;
