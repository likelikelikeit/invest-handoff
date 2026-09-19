-- 0001_init: SPEC §3.2 테이블 전부.
-- SPEC에서 "나중에 ALTER로 추가"라고 한 [제안] 컬럼/테이블은 아직 배포 전이라 여기서 바로 만든다:
--   securities.archived_at (§3.3), securities.asset_class (§5.5),
--   position_changes (§5.1), portfolio_scenarios (§5.5)

-- 종목 마스터. 모든 것의 중심. 지수·환율도 여기 등록한다.
CREATE TABLE securities (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  ticker         TEXT NOT NULL,
  ysym           TEXT NOT NULL UNIQUE,
  isin           TEXT,
  market         TEXT NOT NULL,              -- KR | US
  currency       TEXT NOT NULL,              -- KRW | USD
  sector         TEXT,
  asset_class    TEXT NOT NULL DEFAULT 'equity', -- equity | bond | cash | index | fx | other
  logo_url       TEXT,
  brand_color    TEXT,
  band_default   TEXT DEFAULT 'per',         -- per | pbr | ev_ebitda | psr
  band_multiples TEXT,                       -- JSON
  archived_at    TEXT,                       -- 숨김(물리 삭제 대신)
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE watchlist (
  id           INTEGER PRIMARY KEY,
  security_id  INTEGER NOT NULL REFERENCES securities(id),
  group_name   TEXT,
  note         TEXT,
  added_at     TEXT NOT NULL,
  UNIQUE(security_id, group_name)
);

-- 현재 보유. 현재 상태만.
CREATE TABLE positions (
  security_id  INTEGER PRIMARY KEY REFERENCES securities(id),
  qty          REAL NOT NULL,
  avg_price    REAL NOT NULL,
  avg_ccy      TEXT NOT NULL,
  source       TEXT,                         -- screenshot | manual | sim
  updated_at   TEXT NOT NULL
);

-- 보유 수량 변화와 그 이유 (거래 이력 대체물, §5.1)
CREATE TABLE position_changes (
  id           INTEGER PRIMARY KEY,
  security_id  INTEGER NOT NULL REFERENCES securities(id),
  detected_at  TEXT NOT NULL,
  qty_before   REAL NOT NULL,
  qty_after    REAL NOT NULL,
  reason       TEXT,                         -- buy | sell | dividend_reinvest | split | NULL
  skipped      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_pos_changes_sec ON position_changes(security_id, detected_at DESC);

CREATE TABLE position_snapshots (
  date         TEXT NOT NULL,                -- KST 기준 YYYY-MM-DD
  security_id  INTEGER NOT NULL REFERENCES securities(id),
  qty          REAL NOT NULL,
  price        REAL NOT NULL,
  fx_usdkrw    REAL,
  value_krw    REAL NOT NULL,
  PRIMARY KEY (date, security_id)
);

CREATE TABLE cash (
  currency     TEXT PRIMARY KEY,             -- KRW | USD
  amount       REAL NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 투자의견 이력. 사건 방식: 덮어쓰지 않는다. 현재 의견 = security_id별 최신 행.
CREATE TABLE views (
  id                   INTEGER PRIMARY KEY,
  security_id          INTEGER NOT NULL REFERENCES securities(id),
  created_at           TEXT NOT NULL,
  rating               TEXT NOT NULL,
  rating_score         INTEGER NOT NULL,
  target_price         REAL NOT NULL,
  target_ccy           TEXT NOT NULL,
  horizon_months       INTEGER NOT NULL DEFAULT 12,
  thesis               TEXT,
  risks                TEXT,
  valuation            TEXT,                 -- JSON
  price_at             REAL NOT NULL,
  price_at_source      TEXT,
  upside_pct           REAL NOT NULL,
  consensus_target_at  REAL,
  per_at               REAL,
  edited_at            TEXT,
  evaluated_at         TEXT,
  hit                  INTEGER,
  hit_date             TEXT,
  price_at_horizon     REAL,
  actual_return        REAL,
  target_return        REAL,
  abs_error            REAL
);
CREATE INDEX idx_views_sec_time ON views(security_id, created_at DESC);

-- 일별 시세 OHLCV
CREATE TABLE prices (
  security_id  INTEGER NOT NULL REFERENCES securities(id),
  date         TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL NOT NULL, volume REAL,
  adj_close    REAL,
  PRIMARY KEY (security_id, date)
);

CREATE TABLE financials (
  security_id      INTEGER NOT NULL REFERENCES securities(id),
  period_end       TEXT NOT NULL,
  period_type      TEXT NOT NULL,            -- Q | FY
  revenue          REAL,
  operating_income REAL,
  net_income       REAL,
  eps              REAL,
  bps              REAL,
  ebitda           REAL,
  net_debt         REAL,
  shares_out       REAL,
  raw              TEXT,
  source           TEXT NOT NULL,            -- dart | yahoo
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (security_id, period_end, period_type)
);

-- 컨센서스와 자체 추정을 한 테이블에
CREATE TABLE estimates (
  id            INTEGER PRIMARY KEY,
  security_id   INTEGER NOT NULL REFERENCES securities(id),
  source        TEXT NOT NULL,               -- yahoo | naver | mine
  as_of         TEXT NOT NULL,
  fiscal_year   INTEGER,
  eps           REAL,
  revenue       REAL,
  target_price  REAL,
  rating_mean   REAL,
  n_analysts    INTEGER,
  raw           TEXT
);
CREATE INDEX idx_est ON estimates(security_id, source, as_of DESC);

-- 종목 가정 시나리오 (슬라이더 상태)
CREATE TABLE scenarios (
  id             INTEGER PRIMARY KEY,
  security_id    INTEGER NOT NULL REFERENCES securities(id),
  name           TEXT NOT NULL,
  assumptions    TEXT NOT NULL,              -- JSON
  implied_target REAL,
  note           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(security_id, name)
);

-- 포트폴리오 시뮬 결과 (§5.5)
CREATE TABLE portfolio_scenarios (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  weights     TEXT NOT NULL,                 -- JSON
  deposit     REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- 판정 규칙. 저장할 때마다 새 버전.
CREATE TABLE tech_rule_sets (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL,
  config      TEXT NOT NULL,                 -- JSON, §5.6.3
  note        TEXT
);

CREATE TABLE tech_calls (
  id            INTEGER PRIMARY KEY,
  security_id   INTEGER NOT NULL REFERENCES securities(id),
  side          TEXT NOT NULL,               -- buy | sell
  called_at     TEXT NOT NULL,
  rule_set_id   INTEGER NOT NULL REFERENCES tech_rule_sets(id),
  price_at      REAL NOT NULL,
  indicators    TEXT NOT NULL,               -- JSON [{key,value,verdict}]
  label         TEXT NOT NULL,               -- low | neutral | high
  action        TEXT,                        -- bought | partial | waited | skipped | NULL
  price_1w      REAL,
  price_1m      REAL,
  note          TEXT
);

CREATE TABLE events (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  time         TEXT,                         -- HH:MM KST
  kind         TEXT NOT NULL,                -- earnings | macro | corporate | custom
  security_id  INTEGER REFERENCES securities(id),
  title        TEXT NOT NULL,
  source       TEXT NOT NULL,                -- yahoo | manual
  detail       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_events_date ON events(date);

CREATE TABLE macro_series (
  series_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  unit       TEXT,
  source     TEXT NOT NULL,                  -- fred | ecos | yahoo | manual
  fetch_key  TEXT
);
CREATE TABLE macro (
  series_id  TEXT NOT NULL REFERENCES macro_series(series_id),
  date       TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (series_id, date)
);

-- 키-값 잡동사니 (crumb 캐시, /import 일일 카운터, 마지막 크론 시각 등)
CREATE TABLE meta (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);
