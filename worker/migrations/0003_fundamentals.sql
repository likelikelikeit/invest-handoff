-- M5a: DART 회사 고유번호와 외부 데이터 upsert용 고유 인덱스.
ALTER TABLE securities ADD COLUMN dart_corp_code TEXT;

CREATE UNIQUE INDEX idx_est_unique
  ON estimates(security_id, source, as_of, COALESCE(fiscal_year, -1));

CREATE UNIQUE INDEX idx_events_unique
  ON events(security_id, kind, date, source);
