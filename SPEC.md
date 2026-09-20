# 개인 투자 관리·리서치 웹앱 — 설계 문서 v1

> 작성일 2026-09-19. 채팅 세션에서 사용자(형진)와 함께 6단계에 걸쳐 확정한 설계.
> 이 문서는 코딩 에이전트(Claude Code, Codex)가 구현을 시작하기 전에 전부 읽는 것을 전제로 쓰였다.

표기:
- **[확정]** 사용자가 명시적으로 결정. 바꾸려면 사용자에게 먼저 묻는다.
- **[제안]** 세션에서 합리적 기본값으로 정했지만 구현 중 더 나은 방법이 있으면 바꿔도 된다. 바꾸면 커밋 메시지나 PR 설명에 이유를 남긴다.
- **[미정]** 아직 결정되지 않음. 구현 시점에 사용자에게 묻거나, 나중 마일스톤으로 미룬다.

---

## 0. 한 문단 요약

카카오페이증권 계좌를 쓰는 개인 투자자 한 명을 위한 웹앱. 보유 포트폴리오를 예쁘게 보고, 종목별 목표주가·투자의견을 사건으로 기록해 나중에 자기 예측력을 평가하고, PER·PBR 밴드 위에서 가정을 슬라이더로 만져 목표가를 도출하고, 매수 직전에 단기 기술적 상태를 계기판처럼 확인한다. 프론트는 Svelte 정적 사이트(GitHub Pages), 백엔드는 Cloudflare Worker + D1, 시세·재무·컨센서스는 크론이 외부 소스에서 받아 쌓는다. LLM은 사이트 안에 없다. 대화는 Claude/ChatGPT 구독 안에서 하고, 데이터는 나중에 MCP로 읽힌다.

---

## 1. 목적과 원칙

### 1.1 왜 만드는가
- 옵시디언 vault는 노트 형식이라 슬라이더로 가정을 바꾸고 밴드를 보고 의견 변화를 기록하는 인터랙티브 작업이 안 된다. 숫자가 최종 형태인 것들은 DB와 UI로 뺀다.
- 카카오페이증권 앱은 비중 시각화와 리서치 기능이 약하다.
- 목표가와 의견을 날짜·근거와 함께 남겨 "내가 실제로 얼마나 맞추는가"를 측정하고 싶다. 모의투자처럼 재미도 있다.
- 나중에 LLM 에이전트가 이 데이터를 맥락으로 쓰게 하고 싶다.

### 1.2 설계 원칙 [확정]
1. **LLM은 계산하지 않는다.** RSI, PER 밴드, 비중, 수익률은 전부 코드가 계산한다. LLM은 (a) 스크린샷에서 표 읽기, (b) 나중에 브리핑 생성에만 쓴다. 사이트 안에 채팅 UI를 두지 않는다.
2. **데이터는 어떤 LLM에도 묶이지 않는다.** D1이 유일한 진실. 프론트와 (추후) MCP가 같은 API를 본다.
3. **기록은 사건이다.** 투자의견은 덮어쓰지 않고 행을 추가한다. 현재 의견 = 최신 행.
4. **입력 마찰을 최소화한다.** 이런 앱은 기능이 부족해서가 아니라 입력이 귀찮아서 죽는다. 스크린샷 추출, 자동 갱신, 자동 채움이 우선이다.
5. **기술적 판정은 계기판이다.** 매수 여부나 투자의견을 만들지 않는다. 이미 내린 결정의 진입 시점 참고용이며, 기본적 투자의견과 완전히 분리되고 성과평가에 쓰이지 않는다.
6. **개인 데이터는 공개 저장소에 올리지 않는다.** 코드는 공개 저장소, 보유 데이터는 D1과 사용자 기기에만.
7. **한국어 UI.** 코드 식별자는 영어, 사용자에게 보이는 텍스트는 전부 한국어.

### 1.3 사용자 환경
- 사용자 1명. 인증은 있어야 하지만 다중 사용자 설계는 하지 않는다.
- 주 사용 기기는 아이폰(PWA로 홈 화면에 추가). 맥에서도 쓰며 데스크톱은 **화면마다 별도의 넓은 레이아웃** [확정].
- GitHub 계정 `likelikelikeit`. Pages origin은 `https://likelikelikeit.github.io`.
- 증권사는 카카오페이증권(개인용 API 없음, PC 웹 접속 불가). 토스증권·한국투자증권 등 API 제공 증권사로의 이전은 고려 중이나 미정.

---

## 2. 아키텍처

```
                         GitHub (public repo)
                         ├ web/     Svelte + Vite  ──Actions build──▶  GitHub Pages
                         ├ worker/  Cloudflare Worker (wrangler)
                         └ docs/    이 문서 등

  ┌──────────────┐   Bearer token   ┌────────────────────────┐        ┌────────┐
  │  브라우저     │ ───────────────▶ │  Cloudflare Worker      │ ─────▶ │  D1    │
  │  (PWA)       │ ◀─────────────── │  REST API + Cron        │ ◀───── │ SQLite │
  └──────────────┘                  │  (+ 추후 MCP server)     │        └────────┘
                                    └──────────┬─────────────┘
                                               │ server-side fetch
                 ┌─────────────────────────────┼────────────────────────────────┐
                 ▼             ▼               ▼               ▼                ▼
          Yahoo v8 chart  Yahoo quoteSummary  Naver 증권    DART / FRED / ECOS   Claude API
          (시세, 환율)     (crumb 필요: 컨센,   (국내 컨센,    (재무·공시 / 미국    (스크린샷→JSON,
                           어닝일, fwd EPS)    FnGuide)      거시 / 한국 금리)   키는 Worker 시크릿)
```

### 2.1 구성 요소 [확정]
| 층 | 선택 | 비고 |
|---|---|---|
| 프론트 | Svelte + Vite | 빌드 결과를 GitHub Actions가 Pages에 배포 |
| 차트 | TradingView **Lightweight Charts** (가격·밴드), 직접 SVG (도넛 등) | 십자선 스크러빙 내장, ~45KB |
| 백엔드 | Cloudflare Worker (JS), `wrangler`로 관리 | 무료 플랜: 10만 req/일, CPU 10ms/req, 서브요청 50/req |
| DB | Cloudflare D1 (SQLite) | 마이그레이션은 `worker/migrations/*.sql` |
| 스케줄 | Worker Cron Triggers | UTC 기준, §7.3 |
| 인증 | 기기별 Bearer 토큰 | §7.2. 추후 Cloudflare Pages + Access로 이전 [미정] |
| PWA | manifest + service worker, 오프라인 시 마지막 데이터 표시 | 데이터 시각을 항상 표시 |
| 폰트 | Pretendard (CDN) | SF Pro는 웹 라이선스 불가 |

### 2.2 외부 데이터 소스
| 소스 | 용도 | 인증 | 갱신 | 비고 |
|---|---|---|---|---|
| Yahoo `/v8/finance/chart/{sym}` | 일별 OHLCV, 현재가, USD/KRW(`KRW=X`), 지수(`^KS11`, `^GSPC`, `^VIX`, `^TNX`) | 없음 | 하루 2회 | 이미 worker.js에 구현. 국내 15~20분 지연 |
| Yahoo `quoteSummary` (modules: `financialData,earningsTrend,calendarEvents,defaultKeyStatistics`) | 컨센서스 목표가·추천, fwd EPS, 다음 어닝일 | **crumb + 쿠키** (§7.4) | 주 1회 (어닝일은 매일) | 국내 종목은 데이터 얇음 |
| Yahoo `/v1/finance/search?q=` | 종목 검색 | 없음 | 요청 시 | 이미 worker.js에 구현 |
| 네이버페이 증권 모바일 내부 JSON | 국내 컨센서스(FnGuide), DART 부재 시 재무 폴백 | 없음 | 주 1회 | 비공식. M5a에서 `integration`, `finance/quarter`, `finance/annual` 확인 |
| DART OpenAPI | 국내 공시, 분기 재무(XBRL) | 무료 API 키 | 주 1회 + 공시 매일 | 이력이 부족한 종목은 일일 크론이 하나씩 보강 |
| SEC EDGAR XBRL `companyconcept` | 미국 상장사 분기 재무 이력(밴드용 TTM) | 없음. User-Agent에 연락처 필수 | 로컬 스크립트 1회(`scripts/sec-history.mjs`) | 10-Q/10-K 제출사만(20-F 해외 기업·ETF 제외). 최근 분기는 야후가 채움 |
| FRED | 미국 연방기금 목표범위, EFFR, 국채금리(2Y/10Y), CPI 등 | 무료 API 키 | 하루 1회 | |
| 한국은행 ECOS | 한국 기준금리 | 무료 API 키 | 하루 1회 | |
| Brandfetch Logo API `cdn.brandfetch.io/ticker/{SYM}/...?c={clientId}` | 종목 로고 | 무료 client ID (공개 가능) | `<img>` 핫링크만, 캐시 금지(약관) | 폴백: Parqet(ISIN) → 이니셜 레터마크 |
| Anthropic API (`claude-sonnet-5`) | 스크린샷 → 보유 종목 JSON | `ANTHROPIC_API_KEY` Worker 시크릿 | 사용자 요청 시 | 이미 worker.js에 구현 |

야후 quoteSummary와 네이버는 비공식이라 언제든 깨질 수 있다. 소스 어댑터를 `worker/src/sources/*.js`로 분리해 교체 지점을 한 곳으로 모은다 [제안].

### 2.3 미래에 붙을 것 (지금은 만들지 않음)
- ~~**MCP 서버**~~ → 마일스톤 9에서 만들었다. `mcp/`의 별도 Worker `invest-mcp`, 읽기 툴 6개, OAuth는 직접 구현(§7.8). 마일스톤 10에서 쓰기 툴 2개(보유 가져오기·의견 기록)를 더했지만 **초안까지만** 쓴다(§7.9).
- **Cloudflare Pages + Access**: 프론트를 옮겨 사이트와 API를 한 도메인으로 묶고 구글 로그인으로 잠금.
- **증권사 API**(토스증권/KIS): 잔고 자동 동기화. Worker에 `/balance` 경로 추가 → §5.1의 `normalize`/`merge`에 넘기면 끝.
- **거래 이력(transactions) 테이블**: 보류. §5.1의 "변화 감지 질문"으로 대체.

---

## 3. 데이터 모델

### 3.1 컬럼 vs JSON 규칙 [확정]
**행끼리 비교하거나 필터할 값은 컬럼, 건마다 구조가 다른 덩어리는 JSON 컬럼.** 목표가·EPS·등급은 컬럼. 슬라이더 가정, DART 원문, 지표 스냅샷은 JSON.

### 3.2 테이블 (v1 초안 — 컬럼 이름과 타입은 [제안], 테이블 구성과 관계는 [확정])

통화·금액 규칙: 가격류는 종목의 표시통화(`securities.currency`)로 저장하고 `*_ccy`를 같이 둔다. 원화 환산은 조회 시점 또는 스냅샷의 `fx_usdkrw`로 한다. 스크린샷은 원화 환산값을 주므로 그 경우 `avg_ccy='KRW'`로 저장해도 된다.

```sql
-- 종목 마스터. 모든 것의 중심.
CREATE TABLE securities (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,            -- 한글 표시명 (사용자가 친 이름 우선)
  ticker        TEXT NOT NULL,            -- 005930, NVDA
  ysym          TEXT NOT NULL UNIQUE,     -- 야후 심볼: 005930.KS, NVDA, KRW=X
  isin          TEXT,
  market        TEXT NOT NULL,            -- 'KR' | 'US'
  currency      TEXT NOT NULL,            -- 'KRW' | 'USD'
  financial_currency TEXT,                -- 원천 재무 통화. 상장 통화와 다르면 환산 전 계산 금지
  adr_ratio     REAL,                     -- ADR 1주가 나타내는 원주 수(일반주는 1)
  financial_to_listing_rate REAL,         -- 원천 재무 통화 → 상장 통화 환산율
  financial_rate_as_of TEXT,              -- 환산율 기준일
  sector        TEXT,                     -- 반도체·AI, 헬스케어 ... (자유 텍스트, 팔레트 키)
  logo_url      TEXT,                     -- 수동 지정 시. 없으면 Brandfetch 규칙으로 생성
  brand_color   TEXT,                     -- '#RRGGBB'. 로고에서 추출하거나 수동
  band_default  TEXT DEFAULT 'per',       -- 'per' | 'pbr' | 'ev_ebitda' | 'psr'
  band_multiples TEXT,                    -- JSON {"per":[8,10,12,14,16],"pbr":[...]} 사용자 수정값
  dart_corp_code TEXT,                    -- OpenDART 회사 고유번호(8자리). M5a에서 추가
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- 관심종목. 별도 테이블 [확정]. 보유 여부와 무관.
CREATE TABLE watchlist (
  id           INTEGER PRIMARY KEY,
  security_id  INTEGER NOT NULL REFERENCES securities(id),
  group_name   TEXT,                      -- 나중에 그룹 나눌 때
  note         TEXT,
  added_at     TEXT NOT NULL,
  UNIQUE(security_id, group_name)
);

-- 현재 보유. 현재 상태만 [확정]. 거래 이력 없음(보류).
CREATE TABLE positions (
  security_id  INTEGER PRIMARY KEY REFERENCES securities(id),
  qty          REAL NOT NULL,             -- 소수점 매매 가능
  avg_price    REAL NOT NULL,
  avg_ccy      TEXT NOT NULL,
  source       TEXT,                      -- 'screenshot' | 'manual' | 'sim'
  updated_at   TEXT NOT NULL
);

-- 매일 밤 크론이 찍는 보유 스냅샷. 자산 추이 그래프의 원천.
CREATE TABLE position_snapshots (
  date         TEXT NOT NULL,             -- 'YYYY-MM-DD' (KST 기준 날짜)
  security_id  INTEGER NOT NULL REFERENCES securities(id),
  qty          REAL NOT NULL,
  price        REAL NOT NULL,             -- 종목 통화
  fx_usdkrw    REAL,
  value_krw    REAL NOT NULL,
  PRIMARY KEY (date, security_id)
);

-- 현금. 통화별.
CREATE TABLE cash (
  currency     TEXT PRIMARY KEY,          -- 'KRW' | 'USD'
  amount       REAL NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 투자의견 이력. 사건 방식 [확정]. 현재 의견 = security_id별 최신 행.
CREATE TABLE views (
  id                   INTEGER PRIMARY KEY,
  security_id          INTEGER NOT NULL REFERENCES securities(id),
  created_at           TEXT NOT NULL,     -- ISO 8601 + 오프셋. 초 단위까지 [확정]
  rating               TEXT NOT NULL,     -- §5.2 8단계 라벨
  rating_score         INTEGER NOT NULL,  -- -4..+4 [확정]
  target_price         REAL NOT NULL,
  target_ccy           TEXT NOT NULL,
  horizon_months       INTEGER NOT NULL DEFAULT 12,
  thesis               TEXT,              -- 핵심 논리, 줄바꿈 구분
  risks                TEXT,
  valuation            TEXT,              -- JSON, 선택. {"method":"per","multiple":25,"eps":12000,"eps_growth":0.15,"scenario_id":3}
  -- 기록 시점 자동 스냅샷 [확정]
  price_at             REAL NOT NULL,
  price_at_source      TEXT,              -- 'yahoo(delayed)' 등
  upside_pct           REAL NOT NULL,     -- target/price_at - 1
  consensus_target_at  REAL,              -- 그 시점 컨센 목표가 (얼려둠)
  per_at               REAL,              -- 그 시점 TTM PER
  -- 편집
  edited_at            TEXT,              -- 편집되면 채워지고 UI에 '수정됨' 표시 [확정]
  -- 사후 평가 (horizon 경과 후 크론이 채움)
  evaluated_at         TEXT,
  hit                  INTEGER,           -- 0/1, §5.2.4 정의
  hit_date             TEXT,
  price_at_horizon     REAL,
  actual_return        REAL,
  target_return        REAL,
  abs_error            REAL
);
CREATE INDEX idx_views_sec_time ON views(security_id, created_at DESC);

-- 일별 시세. OHLCV 전부 [확정]. 지수·환율도 securities에 등록해 여기 넣는다.
CREATE TABLE prices (
  security_id  INTEGER NOT NULL REFERENCES securities(id),
  date         TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL NOT NULL, volume REAL,
  adj_close    REAL,
  PRIMARY KEY (security_id, date)
);

-- 재무. 분기/연간 행. 핵심 항목은 컬럼, 원문은 JSON.
CREATE TABLE financials (
  security_id      INTEGER NOT NULL REFERENCES securities(id),
  period_end       TEXT NOT NULL,         -- 'YYYY-MM-DD'
  period_type      TEXT NOT NULL,         -- 'Q' | 'FY'
  revenue          REAL,
  operating_income REAL,
  net_income       REAL,
  eps              REAL,
  bps              REAL,
  ebitda           REAL,
  net_debt         REAL,
  shares_out       REAL,
  currency         TEXT,                  -- 계산에 쓰는 정규화 통화. 상장 통화와 같을 때만 밸류에이션 가능
  source_currency  TEXT,                  -- 원천 제공 통화
  adr_ratio        REAL,                  -- 이 행에 적용된 ADR 비율
  fx_rate          REAL,                  -- 손익·EPS에 적용한 분기 평균 원천→상장 통화 환산율
  balance_fx_rate  REAL,                  -- BPS·순부채에 적용한 분기말 원천→상장 통화 환산율
  raw              TEXT,                  -- JSON 원문
  source           TEXT NOT NULL,         -- 'dart' | 'yahoo' | 'naver'(DART 키 없을 때 국내 폴백) | 'sec'(미국 과거 이력)
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (security_id, period_end, period_type)
);

-- 추정치. 컨센서스와 사용자 자체 추정을 같은 테이블에 [확정].
CREATE TABLE estimates (
  id            INTEGER PRIMARY KEY,
  security_id   INTEGER NOT NULL REFERENCES securities(id),
  source        TEXT NOT NULL,            -- 'yahoo' | 'naver' | 'mine'
  as_of         TEXT NOT NULL,            -- 추정치 기준일
  fiscal_year   INTEGER,                  -- 대상 회계연도
  eps           REAL,
  revenue       REAL,
  target_price  REAL,                     -- 컨센 목표가 (source가 컨센일 때)
  rating_mean   REAL,                     -- 야후 recommendationMean 등
  n_analysts    INTEGER,
  raw           TEXT
);
CREATE INDEX idx_est ON estimates(security_id, source, as_of DESC);

-- 종목 가정 시나리오. 슬라이더 상태 저장.
CREATE TABLE scenarios (
  id             INTEGER PRIMARY KEY,
  security_id    INTEGER NOT NULL REFERENCES securities(id),
  name           TEXT NOT NULL,           -- 'bear' | 'base' | 'bull' | 자유
  assumptions    TEXT NOT NULL,           -- JSON {"eps_1y":..,"eps_2y":..,"growth":..,"multiple":..,"metric":"per"}
  implied_target REAL,
  note           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(security_id, name)
);

-- 매수/매도 판정 규칙. 저장할 때마다 새 버전 [확정: 화면에서 수정 가능 + 변경 이력].
CREATE TABLE tech_rule_sets (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL,
  config      TEXT NOT NULL,              -- JSON, §5.6.3
  note        TEXT
);

-- 판정 기록.
CREATE TABLE tech_calls (
  id            INTEGER PRIMARY KEY,
  security_id   INTEGER NOT NULL REFERENCES securities(id),
  side          TEXT NOT NULL,            -- 'buy' | 'sell'
  called_at     TEXT NOT NULL,
  rule_set_id   INTEGER NOT NULL REFERENCES tech_rule_sets(id),
  price_at      REAL NOT NULL,
  indicators    TEXT NOT NULL,            -- JSON [{key,value,verdict}]
  label         TEXT NOT NULL,            -- 'low' | 'neutral' | 'high' (§5.6.4)
  action        TEXT,                     -- 'bought' | 'partial' | 'waited' | 'skipped' | NULL
  price_1w      REAL,                     -- 크론이 채움. 계기판 자체 평가용 데이터 (화면 표시는 [미정])
  price_1m      REAL,
  note          TEXT
);

-- 일정. 종목 있는 것과 없는 것을 한 테이블에 [제안].
CREATE TABLE events (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  time         TEXT,                      -- 'HH:MM' 로컬(KST). 없으면 종일
  kind         TEXT NOT NULL,             -- 'earnings' | 'macro' | 'corporate' | 'custom'
  security_id  INTEGER REFERENCES securities(id),
  title        TEXT NOT NULL,
  source       TEXT NOT NULL,             -- 'yahoo' | 'manual'
  detail       TEXT,                      -- JSON
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_events_date ON events(date);

-- 거시 시계열.
CREATE TABLE macro_series (
  series_id  TEXT PRIMARY KEY,            -- 'FED_TARGET_LOWER', 'FED_TARGET_UPPER', 'FEDFUNDS', 'DGS2', 'DGS10', 'BOK_BASE' ...
  name       TEXT NOT NULL,
  unit       TEXT,
  source     TEXT NOT NULL,               -- 'fred' | 'ecos' | 'yahoo'
  fetch_key  TEXT                         -- 소스별 조회 키
);
CREATE TABLE macro (
  series_id  TEXT NOT NULL REFERENCES macro_series(series_id),
  date       TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (series_id, date)
);

-- 잡동사니 키-값 (야후 crumb/쿠키 캐시, 마지막 크론 시각 등). KV 대신 D1에 [제안].
CREATE TABLE meta (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);
```

### 3.3 삭제 정책 [제안]
종목 삭제는 물리 삭제 대신 `securities.archived_at` 컬럼을 두고 숨긴다(ALTER로 추가). 의견·시세 이력이 붙어 있는 종목을 지우면 평가가 깨진다.

---

## 4. 화면 구조 [확정]

### 4.1 하단 탭 5개
`홈` · `종목` · `포트폴리오` · `투자의견` · `더보기`

일정은 탭이 아니고 홈 블록 + 더보기 안. 나중에 바꿀 수 있음.

### 4.2 홈 (첫 화면) — 블록 순서
1. **시장 지표 띠**: 코스피, S&P500, USD/KRW, 미국 10년물 (한 줄, 얇게)
2. **자산 요약**: 총자산(원화) 큰 숫자, 인터랙티브 도넛(종목별 색 = 브랜드색, 현금은 달러·원화 분리 조각), 해외/국내 비중, 세로 종목 목록(로고·이름·수량·비중·평가액·손익)
3. **투자의견 요약**: 의견 있는 종목을 상승여력 순으로. 현재가 · 목표가 · 상승여력 · 등급. **의견 없는 보유 종목은 흐린 줄로 표시하고 누르면 기록 폼** [확정]
4. **다가오는 일정**: 어닝, 경제지표, 행사
5. **거시**: 기준금리(한·미)와 금리 경로 그래프(§5.8)

블록은 **접기**. 헤더 전체가 클릭 영역, 오른쪽 chevron이 상태. 접힘 상태는 기기에 기억(localStorage). 최초 기본: 1·2·3 펼침, 4·5 접힘 [제안].

### 4.3 종목 상세 (앱의 심장)
어느 화면에서든 종목을 누르면 도달. 상단 고정 헤더: 로고·이름·티커 · 현재가와 등락 · 내 목표가 · 상승여력 · 현재 등급 · `지금 사도 될까` / `지금 팔아도 될까` 버튼 · 첫 기록이면 `커버리지 개시`, 이후에는 `투자의견 업데이트` 버튼.

세그먼트 4개 [확정]:
- **개요**: 가격 차트(스크러빙, 기간 토글 1M/3M/1Y/3Y/5Y/10Y), 52주 범위, 거래량, 다음 어닝일, 컨센 목표가 vs 내 목표가
- **밸류에이션**: 밴드 차트 두 형태(§5.3), 가정 슬라이더와 시나리오(§5.4)
- **재무**: 분기·연간 표, 핵심 항목 추이 미니 차트, 추정치(컨센/내 것) 비교
- **내 의견**: 투자의견 변천 타임라인(등급·목표가 변화), 목표가 변화 그래프 + 행 목록, 기술적 분석 기록

### 4.4 포트폴리오 탭
- **보기 모드**(기본): 도넛, 목록, 자산군 비중, 기대수익률·변동성 요약, 자산 추이(스냅샷)
- **시뮬 모드**: `시뮬레이션` 버튼으로 진입. 기존 시뮬레이터 로직(§5.5) 이식. 저장/취소. 저장한 시나리오 목록.

### 4.5 투자의견 탭
전체 의견 목록(필터: 종목·등급·기간), **성과 평가** 화면(§5.2.4).

### 4.6 더보기
일정 캘린더 · 거시 상세 · 스크린샷 가져오기 · 기술적 분석 규칙 편집 · 설정(토큰, 시세 서버 주소, 테마, 자산 비중 표시, 데이터 내보내기)

### 4.7 입력 진입점
맥락별 버튼(종목 상세의 `커버리지 개시`·`투자의견 업데이트` 등) **+ 전역 `+` 버튼** [확정]. 전역 +: 스크린샷 가져오기 / 투자의견 / 종목 추가 / 기술적 분석(`기술적 지표로 매매 적합도 확인`).

### 4.8 데스크톱
모든 화면에 별도 넓은 레이아웃 [확정]. 홈·종목 상세는 2열, 표와 차트는 넓게. 규칙·설정처럼 넓어도 내용이 없는 화면은 중앙 넓은 단일 컬럼.

### 4.9 결과 표시
판정 결과, 스크린샷 미리보기 등 "보고 닫는" 것은 iOS식 **바텀 시트** [확정].

---

## 5. 기능 상세

### 5.1 보유 입력
**경로는 셋, 합류점은 하나.** 손입력 · 종목 검색 · 스크린샷(추후 증권사 API)이 전부 `normalize(row, fx) → merge(rows, asOwned)`를 거친다. 기존 `index.html`에 구현된 이 두 함수를 이식한다.

- `normalize`: `{name, ticker, currency, qty, avgPrice, currentPrice, marketValue, profit}` 중 있는 것으로 `qty`, `avg`, `price`를 확정. 수량이 없으면 `qty = (marketValue − profit) / avgPrice`, 현재가가 없으면 `price = marketValue / qty`. 6자리 숫자 티커는 KR, 야후 심볼은 `{ticker}.KS` 추정(코스닥은 `.KQ`, 검색으로 정확히 잡음).
- `merge`: `ysym` 일치하면 덮어쓰기(`asOwned`면 positions 갱신), 없으면 securities + positions 생성.
- 스크린샷: 브라우저에서 1600px로 축소 → Worker `/import` → Claude API → 표 미리보기 시트(체크박스) → 선택 가져오기. 이미 worker.js에 구현.
- **변화 감지 질문** [확정]: 새 스크린샷/입력으로 positions가 바뀌면 종목별 수량 차이를 계산해 시트로 묻는다: `매수 / 매도 / 배당 재투자 / 분할·병합 / 모름(스킵)`. 답은 `meta`가 아닌 별도 `position_changes` 테이블에 기록 [제안: `(id, security_id, detected_at, qty_before, qty_after, reason, skipped)`]. 이게 거래 이력의 대체물이다.
- 종목 추가 폼의 두 버튼 [확정]: **보유 등록**(기존 보유. 총자산에 포함, 현금 변화 없음) / **매수 시뮬**(현금을 써서 새로 담음, 주문서에 잡힘).

### 5.2 투자의견
#### 5.2.1 폼
필수: 목표가, 등급. 선택: 핵심 논리(여러 줄), 리스크(여러 줄), 밸류에이션 근거(§5.4의 base 시나리오에서 자동 채움 가능), 목표 시점(기본 12개월).

#### 5.2.2 등급 8단계 [확정] — 커버리지 평가이며 실제 매매 의사가 아니다
| 라벨 | score |
|---|---|
| 적극 매수 | +4 |
| 매수 | +3 |
| 비중 확대 | +2 |
| 보유 | +1 |
| 중립 | 0 |
| 비중 축소 | −1 |
| 매도 | −2 |
| 적극 매도 | −3 |

> 8개 라벨을 −4..+4 아홉 칸 중 8칸에 매핑한 것. 필요하면 조정 [제안]. 성과 평가에서 등급은 `rating_score`와 이후 수익률의 스피어만 상관으로 본다(2차).

#### 5.2.3 자동 스냅샷 [확정]
저장 시 `created_at`(초 단위), `price_at`(앱이 아는 최신가, 출처 표시), `upside_pct`, `consensus_target_at`, `per_at`을 얼려둔다.

#### 5.2.4 편집 [확정]
자유 편집 허용. 편집하면 `edited_at`이 채워지고 UI에 "수정됨 · 시각"이 작게 붙는다. 종목 화면의 큰 버튼은 기록이 없으면 **커버리지 개시**, 있으면 **투자의견 업데이트**이고 편집은 기존 행의 자기 메뉴 안에만 둔다. 투자의견 업데이트는 새 행이다.

#### 5.2.5 성과 평가 지표 [확정]
- **적중(hit)**: horizon 안에 한 번이라도 목표가에 도달. 방향은 `sign(target − price_at)`. 상향 목표면 `high ≥ target`인 날, 하향 목표면 `low ≤ target`인 날이 있으면 hit [제안: 후한 기준].
- **target_return** = `target / price_at − 1`
- **actual_return** = `price_at_horizon / price_at − 1` (horizon 시점 종가, 박한 기준)
- **abs_error** = `|actual_return − target_return|`
- 화면: **적중률** 크게, 옆에 **평균 목표수익률 · 평균 실제수익률 · MAE(평균 abs_error)** 작게, 표본 수 n 항상 표시. horizon 미경과는 "진행 중"으로 따로 셈.
- 평균 목표수익률 − 평균 실제수익률 = 편향(낙관/비관). 별도 계산 없이 두 숫자로 읽힌다.
- 시장 대비 초과수익 컬럼은 2차 [미정].
- 평가 채움은 크론(매일): `created_at + horizon_months` 지난 행에 대해 prices에서 계산.

### 5.3 밸류에이션 밴드
- 지표: PER, PBR 기본. EV/EBITDA, PSR 선택 가능. **종목별 기본 지표** `securities.band_default` [확정].
- 분자: 과거 구간은 **TTM**(최근 4분기 합, financials에서 계산). 미래 구간은 추정치.
- 밴드 선 두 유파 **둘 다, 토글** [확정]:
  - **고정 배수**: 주가 차트 위에 `EPS_TTM × m` 선 5개. 배수 `m`은 자동 추천 후 사용자가 수정, `securities.band_multiples`에 저장.
  - **분위수**: 멀티플 시계열 위에 10/25/50/75/90 백분위 띠.
- **배수 자동 추천 알고리즘** [확정된 방향, 세부 제안]: 선택 기간의 일별 TTM 멀티플 시계열에서 10/25/50/75/90 백분위를 구하고 "깔끔한 수"로 반올림(≥5면 정수, <5면 0.5 단위). 예 8.7→9, 23.4→23.
- **미래 구간**: 오늘부터 최대 **2년**, 기본 **1년** [확정]. 내 추정(`estimates.source='mine'` 또는 시나리오)과 컨센(`yahoo`/`naver`) 두 갈래로 밴드 선 연장.
- **기간 토글**: 3년 / 5년 / 10년 [확정]. 미국 종목 재무 과거치는 야후에서 4~5년 정도라 10년은 국내(DART)만 될 수 있음. 데이터 없으면 토글 비활성.
- **화면 두 형태 둘 다** [확정]: (a) 주가 + 배수 선(리포트 스타일), (b) 멀티플 시계열 + 분위수 띠.
- 스크러빙 시 그 날짜의 주가, TTM EPS/BPS, 멀티플, 가장 가까운 밴드 값 표시. 배수 라벨은 평상시 최소(예: 최상·최하 선만), 스크러빙/선택 시 강조 [확정].

### 5.4 종목 가정 시뮬레이터 & 시나리오
- 슬라이더/입력: **EPS 직접 입력과 성장률 둘 다**, 한쪽을 바꾸면 다른 쪽이 따라옴 [확정]. 목표 배수. (지표가 PBR이면 BPS/ROE, EV/EBITDA면 EBITDA/순부채로 대응)
- 시나리오: **bear / base / bull 셋, base 하나만 입력해도 됨** [확정]. 각 시나리오의 implied target 표시.
- **base 시나리오 → 투자의견 폼 자동 채움** [확정]: 목표가, `valuation` JSON(지표·배수·EPS·성장률·scenario_id). 밴드에서 가정을 만지다 `이 가정으로 투자의견 작성` 버튼 → 폼에 등급과 논리만 적으면 됨. 이것이 기록의 기본 동선.
- 저장은 `scenarios` 테이블. 미래 밴드 선이 즉시 반응.

### 5.5 포트폴리오 시뮬레이터
기존 `index.html` 로직 이식. 핵심 수식(**현금 버퍼 모드** [확정]):
- `total = Σ(baseQty_i × price_i) + deposit` — 총자산은 매매로 변하지 않음
- `cash = total − Σ(qty_i × price_i)` — 매수하면 현금 감소, 음수면 경고
- 비중 슬라이더: `qty = (w/100) × total / price`
- 추가 매수 시 평단 가중평균: `avg' = (qty×avg + Δ×price) / (qty+Δ)`; 매도 시 평단 유지, 실현손익 `Δ × (price − avg)` 누적
- 주문서: `qty − baseQty` ≠ 0인 종목의 매수/매도 수량·금액, 순현금
- 슬라이더 드래그 중엔 평단 건드리지 않고 미리보기, 놓을 때 확정(기존 코드의 snap 패턴)
- **제약 경고** [확정]: 사용자가 정한 상한(단일 종목 %, 섹터 %)을 넘으면 색으로 경고. 막지 않음.
- **자산군 층** [확정, 1차]: 주식·채권·현금·기타 비중. 지금은 주식과 현금뿐이지만 자리를 만든다. `securities.asset_class` 컬럼 추가 [제안].
- **기대수익률·변동성** [확정, 1차 표시까지]: 종목별 기대수익률은 사용자 입력(가정), 변동성·상관은 `prices`에서 계산(사실). 포트폴리오 기대수익률 `Σ w_i μ_i`, 변동성 `sqrt(wᵀΣw)` (일별 수익률 공분산 × 252). 화면에서 "내 가정"과 "계산됨"을 시각적으로 구분. 최적화는 하지 않음.
- 시뮬 결과 저장 → `scenarios`와 별개로 `portfolio_scenarios` 테이블 [제안: `(id, name, weights JSON, deposit, created_at)`].

### 5.6 매수·매도 판정 (계기판)
#### 5.6.1 목적 [확정]
기본적 분석으로 이미 매수(매도)를 결정한 종목에 대해 **현 시점 단기 진입(청산) 부담**을 요약해 보여준다. 매수 여부를 판단하지 않고, 투자의견과 분리되며, 투자 성과평가에 쓰이지 않는다. 미래 가격이나 대기 기간을 예측하는 문구를 쓰지 않는다.

#### 5.6.2 지표 5개 [확정] — 전부 일봉, `prices`에서 계산
| key | 정의 | 기본 과열 | 기본 침체 |
|---|---|---|---|
| `rsi14` | Wilder RSI(14) | > 70 | < 30 |
| `dev20` | `close / SMA20 − 1` | > +5% | < −5% |
| `dev60` | `close / SMA60 − 1` | > +10% | < −10% |
| `bb_pctb` | `(close − (SMA20 − 2σ20)) / (4σ20)` | > 0.9 | < 0.1 |
| `vol_ratio` | `volume / SMA20(volume)`, **상승일에만 과열로 반영**, 하락일 급증은 참고 표시 [확정] | > 2.0 (상승일) | 판정 미반영 |

참고 표시(판정 미반영): 52주 범위 내 위치, 하락일 거래량 급증.
매도 판정은 같은 지표를 **방향만 뒤집어** 쓴다 (과열 ↔ 침체의 의미가 "청산 부담 낮음/높음"으로 바뀜).

#### 5.6.3 규칙 config (JSON, `tech_rule_sets.config`) [제안 스키마]
```json
{
  "indicators": {
    "rsi14":    {"overheat": 70,  "oversold": 30,  "weight": 1, "enabled": true},
    "dev20":    {"overheat": 0.05,"oversold": -0.05,"weight": 1, "enabled": true},
    "dev60":    {"overheat": 0.10,"oversold": -0.10,"weight": 1, "enabled": true},
    "bb_pctb":  {"overheat": 0.9, "oversold": 0.1, "weight": 1, "enabled": true},
    "vol_ratio":{"overheat": 2.0, "oversold": null,"weight": 1, "enabled": true, "up_day_only": true}
  },
  "aggregate": {"high_threshold": 3, "low_threshold": 3}
}
```
화면에서 이 숫자들만 편집. 저장 시 새 `tech_rule_sets` 행. `tech_calls.rule_set_id`가 그때 규칙을 가리킨다 [확정: 규칙 변경 이력 보존].

#### 5.6.4 집계 [확정된 방향]
`overheat_sum = Σ weight(verdict=과열)`, `oversold_sum = Σ weight(verdict=침체)`.
- `overheat_sum ≥ high_threshold` → 🔴 **단기 과열** (`label='high'`)
- `oversold_sum ≥ low_threshold` → 🟢 **진입 부담 낮음** (`label='low'`)
- 그 외 → 🟡 **중립 / 분할 접근** (`label='neutral'`)
매도 측 라벨: 🟢 청산 부담 낮음 / 🟡 중립 / 🔴 단기 침체.

#### 5.6.5 표시와 기록
바텀 시트: 큰 라벨 한 줄 + 지표별 `값 — 판정` 줄 5개 + 참고 정보. 하단에 행동 기록 버튼(`샀다 / 나눠 샀다 / 기다렸다 / 안 샀다`, 선택). 저장은 `tech_calls`. 크론이 1주·1개월 뒤 가격을 채운다(계기판 자체 평가용 데이터. 화면 노출은 [미정]).

### 5.7 일정
- 미국 어닝일: 야후 `calendarEvents` (크론 매일). 국내 실적발표일: 깨끗한 소스 없음 → 수동 [확정].
- FOMC · 금통위 · 미국 CPI/고용 발표일: 연초 공개 일정을 **연 1회 수동 입력** [확정]. 첫 시드는 구현 시 그 해 일정을 넣는다.
- 사용자 임의 이벤트 추가 폼.
- 홈 블록은 오늘부터 30일 [제안].

### 5.8 거시
- 시장 띠: `^KS11`, `^GSPC`, `KRW=X`, `^TNX`(미10년) — 야후로 받아 `prices`에 저장(securities에 지수 등록).
- 기준금리: 미국은 FOMC 연방기금 목표범위 `DFEDTARL`·`DFEDTARU`(FRED), 한국은 한국은행 기준금리(ECOS). `FEDFUNDS`는 월평균 실효 연방기금금리(EFFR)로 별도 표시한다.
- **금리 경로 그래프**: 시장 기대 경로(연방기금 선물)는 무료 소스 없음. **미국 2년물(`DGS2`)을 시장 기대의 대용치로 그리고, Fed 점도표 중간값은 분기마다 수동 입력** [확정된 방향]. `macro_series`에 `FED_DOTS_YYYYMM` 같은 시리즈로 넣는다 [제안].

### 5.9 종목 검색
`/search?q=` (야후). 이름 칸에 2글자 이상 입력 → 300ms 디바운스 → 드롭다운. 선택 시 티커·야후 심볼·현재가 자동 채움. **한글로 쳤으면 야후 영문명 대신 친 이름을 유지** (기존 구현).

---

## 6. 디자인 시스템 [확정]

### 6.1 방향
- **시각 언어는 애플, 금융 정보의 배치는 토스증권·카카오페이증권**을 참고. (애플 주식 앱은 참고하지 않음 — 사용자가 안 씀.)
- 큰 핵심 숫자, 얇은 차트 선, 절제된 구분선과 보조 텍스트, 낮은 시각 소음. 기능은 단순화하지 않는다.
- **카드 그리드 금지.** 둥근 카드가 반복되는 대시보드 대신 배경·간격·얇은 divider로 위계. 박스는 데이터에만 (표, 차트).
- 종목 목록 행 구조, 수익률 색·화살표, 차트 기간 토글 위치 등은 토스·카카오페이의 관습을 따른다.

### 6.2 색
- **상승 = 빨강, 하락 = 파랑 (한국 관례)** [확정]. 현재 `index.html`의 `--up: #e8302a`, `--down: #1f6fd0` (라이트) / `#ff5a52`, `#5aacff` (다크).
- 라이트 배경 **순백 `#ffffff`** [확정], 다크 `#000` 계열. 기본은 시스템 설정 따라가고 토글로 고정.
- 종목 색: `securities.brand_color`(로고에서 추출, canvas `getImageData` 평균/대표색. CORS 막히면 Worker가 이미지를 프록시) → 없으면 섹터 팔레트(기존 `SECTORS` 객체: 반도체·AI 파랑 계열 10단계, 헬스케어 초록, 소비·플랫폼 주황, 모빌리티 보라, 엔터 분홍, 금융 청록, 에너지·소재 황토, 기타 회색).
- 현금 조각: 회색 계열, 달러·원화는 명도 차이.

### 6.3 토큰 (기존 `index.html` `:root`를 계승)
```
--font: "Pretendard Variable", Pretendard, -apple-system, ... sans-serif
--bg #ffffff / --bg2 #f5f5f7 / --card #ffffff
--ink #1d1d1f / --sub #6e6e73 / --sub2 #86868b
--line #d2d2d7 / --line-soft #ededf0 / --track #eef0f3
--accent #0071e3 / --green #34c759 / --orange #c2410c / --red #d70015
--radius 18px / --radius-lg 26px
다크: --bg #000, --bg2 #0a0a0c, --card #1c1c1e, --ink #f5f5f7, --sub #98989d,
      --line #3a3a3c, --line-soft #2a2a2d, --accent #2997ff
```
숫자는 `font-variant-numeric: tabular-nums`.

### 6.4 표기 [확정]
- 금액 **전체 표기** (13,755,714원). 축약 안 함.
- 달러 종목은 **달러 병기** (예: `$212.34 · 293,338원`).
- 수량은 소수 6자리까지, 정수면 정수.
- 퍼센트는 ≥1%면 소수 1자리, <1%면 2자리 (기존 `pct()`).

### 6.5 밀도와 터치
- 요약 영역 여백 넉넉, 종목 목록·표는 촘촘. 모바일 터치 타깃 최소 44pt.

### 6.6 섹션과 접기
- 헤더 전체 클릭, 오른쪽 chevron 회전으로 상태 표시. 접힘 상태 localStorage 기억.

### 6.7 차트
- Lightweight Charts. 그리드 없음 또는 극히 얇게, 선 1.5px 내외, 영역 채움은 은은한 그라데이션.
- **스크러빙 필수**: 모바일 터치/데스크톱 포인터로 훑으면 상단에 날짜와 값. 밸류에이션 차트는 주가·TTM 실적·멀티플·인접 밴드 값 동시 표시.
- 밴드 배수 라벨은 평상시 최소, 스크러빙/선택 시 강조.
- 햅틱: `navigator.vibrate` 있으면 사용, 없으면 무시(iOS Safari 미지원).

### 6.8 상태와 시각
- 모든 시세에 "기준 시각" 표시. 지연 시세임을 숨기지 않는다.
- 오프라인이면 마지막 데이터 + "오프라인 · HH:MM 기준" 배지.

---

## 7. 기술 규약

### 7.1 저장소 구조 [제안]
```
/
├ AGENTS.md            에이전트 작업 규약 (CLAUDE.md는 @AGENTS.md 한 줄)
├ SPEC.md              이 문서
├ README.md
├ .gitignore           portfolio.json, .dev.vars, node_modules, dist, .wrangler
├ web/                 Svelte + Vite
│  ├ src/lib/api.js    fetch 래퍼(토큰 헤더, 에러 처리, 오프라인 캐시)
│  ├ src/lib/calc/     rsi.js, bands.js, portfolio.js (순수 함수, 단위 테스트 대상)
│  ├ src/lib/format.js won(), pct(), qtyStr()
│  ├ src/lib/router.svelte.js  해시 라우터 (#/security/12)
│  ├ src/routes/       home, securities, portfolio, views, more, security (상세)
│  └ src/components/
├ worker/
│  ├ wrangler.toml     D1 binding, cron triggers, vars
│  ├ migrations/       0001_init.sql, ...
│  ├ src/index.js      라우터
│  ├ src/routes/       quotes, search, import, portfolio, views, ...
│  ├ src/sources/      yahoo.js (chart, quoteSummary+crumb, search), naver.js, dart.js, fred.js, ecos.js
│  ├ src/cron/         daily_kr.js, daily_us.js, weekly.js, evaluate.js
│  └ src/calc/         서버에서도 쓰는 계산 (web/src/lib/calc와 공유 가능하면 패키지로)
├ mcp/                 MCP 서버 Worker (invest-mcp). 마이그레이션은 worker/migrations를 쓴다
│  ├ src/oauth.js      인가 서버 (동적 등록·PKCE·토큰)
│  ├ src/mcp.js        JSON-RPC (initialize / tools/list / tools/call)
│  ├ src/tools.js      읽기 툴 6개
│  └ src/write-tools.js 제안 툴 3개 (초안만 쓴다)
└ .github/workflows/pages.yml
```

마일스톤 0에서 정한 것 (2026-09-19, 사용자 확인):
- 저장소 `likelikelikeit/invest-handoff` (공개). Pages 주소 `https://likelikelikeit.github.io/invest-handoff/`, Vite `base`도 같다.
- 프론트는 SvelteKit이 아닌 **순수 Svelte 5 + Vite + 해시 라우터**. Pages에 서버 폴백이 없어 `#/security/12` 형태로 새로고침 404를 피한다.
- Worker 이름 `invest-api`(새로 만듦), D1 이름 `invest`. 기존 배포 Worker는 마일스톤 2까지 index.html용으로 남겨두고 이후 삭제.
- 루트 `package.json`에 npm workspaces(`web`, `worker`)로 lockfile 하나.
- 기존 `/?symbols=` 시세 경로는 `/quotes?symbols=`로 옮겼다. 응답에 `source: "yahoo(delayed)"`와 종목별 `time`(야후 마지막 체결 시각)을 더했다.
- merge는 서버 `POST /portfolio/merge`가 받는다(종목 ysym upsert, 기존 종목 이름은 유지, `asOwned`면 positions 덮어씀). `normalize`는 프론트 `web/src/lib/calc/`에서 먼저 거친다(M2에서 이식).
- 시드는 `portfolio.json`의 `baseQty`/`baseAvg`(실제 보유 기준)를 쓰고, 평단이 원화 환산값이라 `avg_ccy='KRW'`.
- 시각 문자열은 `views.created_at` 규칙(ISO 8601 + `+09:00`, 초 단위)을 모든 테이블에 쓴다.

마일스톤 2에서 정한 것 (2026-09-19):
- **시뮬은 연습장** (사용자 결정). 시뮬은 D1 `positions`를 절대 바꾸지 않는다. 기존 "기준 재설정"은 없애고 "실제 보유에서 다시 시작"으로 대체. 진행 중 시뮬은 기기 localStorage(`invest.sim`)에 임시 저장, "저장"하면 `portfolio_scenarios`(weights JSON에 종목별 수량·평단·가격·비중). 다시 열면 지금 시세로 가격이 붙는다.
- 시뮬 행 순서는 **시작 평가액** 순으로 고정한다. 지금 평가액 순이면 슬라이더를 끄는 중에 행이 자리를 바꾼다.
- 변화 감지(§5.1)는 **서버가 기록**한다. merge/PUT/DELETE 보유가 수량이 바뀌면 `position_changes`에 `reason NULL` 행을 넣고 응답 `changes`로 돌려준다. 앱은 시트로 이유를 묻고 `PATCH /portfolio/changes/:id`로 채운다. 시트를 닫아도 기록은 남고 앱을 다시 열면 미응답분을 다시 묻는다.
- 로고: Brandfetch `<img>` 핫링크만(`ticker/{SYM}`, 국내는 6자리 코드로 계산한 ISIN `isin/KR7…`), `fallback/404`로 받아 실패 시 이니셜 레터마크. 약관이 프로그램 접근을 금지하므로 §6.2의 "CORS 막히면 Worker가 이미지를 프록시"는 **하지 않는다**. 브랜드색 자동 추출도 하지 않고, 종목 상세에서 직접 고른다(없으면 섹터 팔레트).
- 스크린샷 가져오기: 티커가 없는 행은 이름이 같은 기존 종목의 심볼로 잇는다. 분류를 모르는 행은 기존 종목의 분류를 덮지 않는다.
- 로컬 개발용 `IMPORT_LLM_PROVIDER=mock`(`.dev.vars`에서만)으로 키 없이 가져오기 흐름을 시험한다.
- PWA: manifest + iOS 메타 + 최소 서비스 워커(캐시 없음). 오프라인 캐시는 M8.
- `prompt()` 대신 바텀 시트로 이름을 받는다. 되돌릴 수 없는 동작(시뮬 버리기, 보유 정리)만 `confirm()`.

마일스톤 3에서 정한 것 (2026-09-19):
- **D1 무료 플랜은 호출 1번에 쿼리 50개이고 `batch()` 안의 문장도 각각 센다.** 그래서 종목 하나의 일봉 전체를 JSON 파라미터 하나로 넘겨 `json_each`로 쿼리 1개에 upsert한다(`worker/src/lib/prices.js`). 보유 스냅샷도 쿼리 1개.
- 최초 5년 백필은 Worker가 아니라 **로컬 스크립트**(`worker/scripts/backfill.mjs`)로 한 번에 넣는다. 이후 새 종목은 종목 상세를 열 때 `POST /prices/:id/backfill`(그 종목 하나), 크론도 한 번에 2개씩 메운다.
- 야후는 Node `fetch`(undici)를 429로 거른다. curl과 Worker는 통과. 로컬 스크립트는 curl을 쓴다.
- 크론이 챙기는 종목 = 보유 + 관심 + 지수·환율(숨김 제외). 최근 5일 봉을 upsert해서 하루 빠져도 메워진다.
- 스냅샷 날짜 = 크론 실행 시점의 UTC 날짜(07 UTC = 그날 KST 16시, 22 UTC = 익일 KST 07시이므로 전날 미국장). 환율이 없으면 달러 종목은 건너뛴다(0원으로 찍지 않는다).
- 지수·환율(코스피, S&P500, 원/달러, 미국 10년물)은 `0002`에서 `securities`에 `asset_class` index/fx로 등록. 시장 띠는 실시간(지연) 시세, 누르면 그 지수의 상세 차트.
- 차트: 선 색은 **기간 수익률 부호**(상승 빨강·하락 파랑). 이력이 기간의 90%를 못 덮으면 그 토글은 끈다(5년치로 10Y를 흉내 내지 않는다). 기억한 기간이 없는 종목은 가능한 가장 긴 기간으로.
- 터치 스크러빙은 라이브러리 기본(길게 눌러야 켜짐) 대신 가로 드래그를 직접 받아 바로 훑이게 했다.
- 차트 라이브러리는 상세 화면에서만 늦게 불러온다(첫 화면 번들 46KB gzip 유지). TradingView 로고(라이선스 표기)는 그대로 둔다.
- 10년 이력은 아직 받지 않는다(마일스톤 표의 "5년 백필"). 필요하면 `node scripts/backfill.mjs --all --range 10y`.

마일스톤 4에서 정한 것 (2026-09-19):
- **의견은 자유롭게 삭제할 수 있다** (사용자 결정). 대가: 틀린 의견을 지우면 적중률이 부풀려진다. 삭제는 확인창 뒤 완전 삭제.
- 기록 시점 스냅샷은 **서버가 얼린다**: 가격은 야후 지연 시세 → 실패하면 저장된 마지막 종가(`price_at_source`에 출처), 둘 다 없으면 기록 거부(503). 목표가·가격은 종목 통화(미국 종목은 달러). `consensus_target_at`은 estimates가 생기는 M5a부터, `per_at`은 M5b부터 채운다.
- 편집 가능한 필드: 등급·목표가·목표 시점·논리·리스크·valuation. 기록 시점 가격 등 스냅샷은 편집으로 바뀌지 않고, 목표가를 바꾸면 **기록 시점 가격 기준**으로 상승여력을 다시 계산한다.
- 새 의견 폼은 그 종목의 최신 의견 내용을 출발점으로 채운다(업데이트는 새 행이라 매번 처음부터 쓰지 않게).
- 홈 블록 3과 종목 헤더의 상승여력은 **지금 가격 기준**(목표가 / 현재가 − 1). 의견 행의 "기록 시"는 기록 시점 기준, "이후"는 기록 후 주가 수익률.
- 등급 점수는 §5.2.2 [제안] 매핑(+4..−3)을 그대로 쓴다.
- 성과 평가 뼈대: 평가된 의견(사후평가 크론 M8)이 없으면 지표는 "—", 진행 중·평가 대기 건수만.
- 의견 타임라인: 주가 차트 위에 목표가 계단선 + 현재 목표가 점선. 오늘 기록한 의견은 마지막 일봉에 붙인다.
- §3.3·§5.1·§5.5에서 "나중에 추가"라던 `securities.archived_at`, `securities.asset_class`, `position_changes`, `portfolio_scenarios`는 배포 전이라 `0001_init.sql`에 바로 넣었다.

마일스톤 5a에서 정한 것 (2026-09-19):
- 네이버 국내 컨센서스는 모바일 공개 JSON `GET /api/stock/{6자리}/integration`의 `consensusInfo`를 쓴다. 분기·연간 재무 폴백은 `/finance/quarter`, `/finance/annual`이다. 모두 비공식이므로 `worker/src/sources/naver.js`에 격리하고 실패하면 데이터 없음으로 둔다.
- 국내 재무의 우선 소스는 DART다. `securities.dart_corp_code`(8자리)를 `0003`에서 추가했고, `DART_API_KEY`와 고유번호가 모두 있을 때 최근 공시를 보강한다. 키가 없거나 DART 행이 없는 기간은 네이버 재무를 쓰되, 이미 저장된 DART 행은 네이버가 덮어쓰지 않는다.
- 미국 컨센서스·다음 실적일은 Yahoo `quoteSummary`, 분기 재무는 `fundamentals-timeseries`를 쓴다. Yahoo 쿠키·crumb은 D1 `meta`에 12시간 캐시하고 401/403이면 한 번 재발급한다.
- 주간 크론은 보유+관심 equity를 최대 12종목씩 순환한다. DART는 종목당 외부 요청이 많아 한 번에 한 종목만 보강한다. 수동 `POST /fundamentals/:id/refresh`는 해당 종목 하나를 즉시 갱신한다.
- 재무 UI는 기존 종목 상세의 세로 `Section` 흐름을 유지한다. 분기/연간 표, 항목별 미니 차트, 컨센서스를 넣고 표는 모바일 가로 스크롤·데스크톱 전체 폭으로 표시한다. 금액은 축약하지 않는다.

마일스톤 5b에서 정한 것 (2026-09-19):
- TTM·멀티플·분위수·시나리오 목표가는 `web/src/lib/calc/valuation.js`의 순수 함수가 계산한다. 차트는 기존 가격 차트와 같은 Lightweight Charts를 늦게 불러오며, 모바일에서는 가로 드래그 즉시 스크러빙한다.
- `securities.band_multiples`는 지표별 5개 배수 배열 객체(`{per:[...], pbr:[...]}`)로 저장한다. 자동 추천은 선택 지표의 일별 멀티플 10·25·50·75·90 분위수를 §5.3 규칙으로 반올림한다.
- 시나리오 `assumptions`는 `metric`, `value`, `multiple`, `growth_pct`, `horizon_years`와 EV/EBITDA용 `net_debt`, `shares`를 저장한다. 같은 종목의 bear/base/bull은 현재 작업 가정이므로 이름별 upsert한다. base에서 의견을 열 때 목표가와 valuation JSON을 넘기며, 의견 행은 기존 사건 방식대로 새로 쓴다.
- 의견 기록 시 `per_at`은 서버가 저장된 최근 네 분기 EPS와 기록 순간 가격으로 계산해 얼린다. 네 분기가 온전히 없거나 TTM EPS가 양수가 아니면 null이다.
- 3년 TTM 밴드의 선행 네 분기를 확보하기 위해 Yahoo 재무 요청은 5년, DART는 최근 16개 보고서로 넓힌다. DART 16회와 국내 폴백을 포함해 외부 요청 40개 이하가 되도록 주간 크론은 최대 8종목씩 순환한다.
- (Claude 이어받음) 야후·네이버는 요청 기간과 무관하게 **최근 5개 분기만** 준다. 그래서 밴드 이력은 아래로 보강했다(사용자 결정 "다 보강").
  - TTM은 **연속 네 분기**(첫~끝 분기 말 240~300일)일 때만 만든다. 서버 `per_at`도 같고, 아직 끝나지 않은 분기는 뺀다.
  - **국내(DART)**: 사업보고서는 연간 누적뿐이라 4분기 행이 없어 TTM이 생기지 않던 버그를 고쳤다. 4분기 = 연간 − (1·2·3분기)로 파생(손익 흐름 항목, EPS는 근사). 보유 국내 4종목 고유번호를 채웠다(공개 DART 회사 검색). 일일 크론이 DART 분기 12개 미만인 종목을 한 번에 하나씩 보강하고, 시도한 종목은 3일 건너뛴다.
  - **미국(SEC EDGAR)**: `companyconcept`(EPS 희석·매출·순이익·영업이익)를 로컬 스크립트로 한 번 넣는다. 4분기는 연간 − 세 분기, 회계일은 가까운 월말로 맞춰 야후 행과 같은 키가 되게 했다. **EPS는 제출일 뒤에 일어난 주식분할만큼 나눠** 오늘(분할 반영 주가) 기준으로 맞춘다(야후 분할 이력). 연락처는 `SEC_USER_AGENT` 환경변수로만(사용자 허락, 코드·저장소에 없음). 해외 20-F 제출사(TSMC·노보)와 ETF는 대상이 아니라 밴드가 짧다.
  - 가격 이력도 10년으로 늘려 10년 토글이 켜지게 했다(`backfill.mjs --all --range 10y`).

밸류에이션 단위 보정 (2026-09-20):
- **계산 단위가 먼저다.** 재무 원천 통화와 상장 가격 통화, ADR 원주 비율을 `securities`와 `financials`에 명시한다. 재무행의 `currency`가 상장 통화와 같다고 확인된 행만 PER·PBR·EV/EBITDA·PSR와 의견 시점 `per_at`에 쓴다.
- TSMC ADR은 Yahoo의 합계 재무가 TWD, 가격이 USD 기준이다. EPS·BPS·희석주식 수는 이미 ADR-equivalent(1 ADR=보통주 5주)이므로 ADR 비율을 다시 곱하지 않는다. 손익·EPS는 분기 평균환율, BPS·순부채는 분기말 환율로 바꾼다. 컨센서스는 매출이 재무 통화이고 EPS는 종목별로 재무/상장 통화가 달라 최근 TTM의 원천·정규화 규모와 비교해 원천 단위일 때만 환산한다. 환산 전에는 틀린 배수·기본 가정을 보여주지 않고 화면과 MCP에 **환산 필요**를 명시한다. NVO도 같은 원칙으로 DKK→USD를 처리하고 1 ADR=보통주 1주를 기록한다. 원문 숫자는 감사용으로 보존한다.
- DART 16개 보고서를 한 Worker 호출에서 모두 받지 않는다. 국내 일일 크론이 종목별 커서를 두고 한 사업연도(최대 4요청)씩 이어받아 무료 플랜 50 서브요청 한도를 지킨다. 같은 기간은 DART의 non-null 값을 우선하고, DART에 없는 BPS·EBITDA·주식 수는 네이버 값으로 보완하며 새 null이 기존 값을 지우지 않는다.

마일스톤 6에서 정한 것 (2026-09-19):
- 지표 계산은 **Worker의 순수 함수**(`worker/src/lib/tech.js`)가 한다. 판정 API·기록·크론이 같은 코드를 쓴다. 볼린저 σ는 모표준편차, RSI는 Wilder 평활(첫 평균은 단순 평균).
- **장중**: 야후 지연 현재가를 오늘 봉으로 붙여 가격 지표에 쓴다(사용자 결정). 체결 시각은 **거래소 현지 날짜**로 마지막 일봉과 비교한다(미국 마감을 KST로 바꾸면 이미 있는 봉이 중복된다). 거래량 지표는 직전 완결 봉 기준. 판정에는 기준(종가/지연 현재가)과 시각을 항상 표시.
- 매도 판정은 **보유 종목에만** 버튼이 있다(사용자 결정). 같은 지표를 쓰고 라벨 의미만 뒤집힌다.
- 기록은 **사용자가 본 판정을 그대로** 저장한다(POST 본문에 지표·라벨·가격·규칙 버전). 행동은 나중에 PATCH로 바꿀 수 있다. 규칙이 하나도 없으면 §5.6.3 기본값으로 v1을 자동 생성.
- **1주·1개월 뒤 가격**: 일일 크론이 기록일 +7·+30일 이후 첫 거래일 종가를 채운다. 화면에는 판정 기록 행에 **사실만**(수익률 숫자) 보이고 적중률 같은 집계는 만들지 않는다(사용자 결정). 판정 기록은 종목 상세의 별도 섹션(기본 접힘)이며 투자의견·성과평가와 섞지 않는다.
- 규칙 편집은 더보기 → 판정 규칙(`#/more/rules`). 이격은 %로 보여주고 비율로 저장. 저장 = 새 버전, 이력에 버전별 판정 건수.
- 계기판 신호등은 §5.6.4의 🔴🟡🟢(빨강=과열 쪽 부담). 주가 상승/하락 색(빨강/파랑)과는 다른 의미라 점 모양으로만 쓴다.

마일스톤 7에서 정한 것 (2026-09-19):
- **크론 합치기**: §7.3의 거시(`30 23 * * *`)와 어닝일(`0 0 * * *`)을 `30 23 * * *` 하나로 합쳤다. 무료 플랜 크론 트리거가 계정당 5개라 따로 두면 여유가 없다. 거시는 최근 60일, 어닝일은 미국 보유·관심 최대 15종목(D1 쿼리 50 안쪽). DART 공시 매일 수집은 아직 없다.
- **일정 시드**(`0005`): FOMC 2026·2027, 금통위 2026, CPI·고용 2026년 남은 발표를 공식 페이지에서 확인해 넣었다. 시각은 **KST로 손 계산**(서머타임 반영, 크론 코드가 아니라 데이터). 현지 시각은 `detail.local`. 다음 해 일정은 연초에 새 마이그레이션으로. D1은 `UNION ALL` 항 수 제한이 낮아 시드도 `json_each`로 넣는다(테스트용 node:sqlite는 한도가 달라 통과하므로 마이그레이션은 로컬 D1에도 적용해 본다).
- **어닝일 교체**: 발표일이 바뀌면 같은 종목의 오늘 이후 야후 어닝일 중 옛 날짜를 지운다(주간 크론도 동일). 직접 넣은(manual) 일정만 앱에서 지울 수 있다.
- **어닝일 없는 종목**: ETF처럼 Yahoo `quoteSummary`가 404를 반환하는 미국 종목은 어닝일 수집 대상에서 조용히 건너뛴다. 404 이외의 실패는 크론 보고서의 오류에 남긴다.
- **거시 시리즈**: 미국 정책금리는 `DFEDTARL`·`DFEDTARU`(FRED)의 목표범위로 표시하고 그래프에는 범위 중간값을 쓴다. `FEDFUNDS`(월평균 EFFR)는 상세 화면에 별도 표시한다. DGS2·DGS10(FRED), 한국 기준금리 ECOS `722Y001/M/0101000`(월별). 점도표는 `FED_DOTS_YYYYMM` 시리즈에 연말 날짜로, 장기(Longer run)는 `9999-12-31`로 저장해 그래프에는 그리지 않고 숫자로만. 입력은 더보기 → 거시.
- **짧은 밸류에이션 이력 표시**(2026-09-20): 3년 미만 데이터에서 비활성 `3년`이 선택된 것처럼 보이지 않게 기간 토글 대신 `가용 이력 전체`를 표시한다. 3년 이상부터 기존 3년/5년/10년 토글을 쓴다.
- **혼합 시장 시세 시각**(2026-09-20): 한국·미국 종목처럼 마지막 체결 시각이 섞인 목록의 상단에는 가장 최신 시각 하나를 전체 기준처럼 쓰지 않고, 한 번에 받은 시세의 가장 이른 시각–가장 늦은 시각 범위를 표시한다. 개별 종목 상세에는 해당 종목 시각을 계속 표시한다.
- 홈 블록 4(30일 일정)·5(한·미 기준금리 + 금리 경로)는 §4.2 제안대로 기본 접힘. 접혀 있으면 차트 코드를 불러오지 않는다.
- 모든 차트에 `lockVisibleTimeRangeOnResize`: 컨테이너 폭이 정해지기 전에 맞춘 뒤 커지면 데이터가 오른쪽에 몰리던 문제.

UX 보완에서 정한 것 (2026-09-20):
- 홈의 긴 블록과 종목 상세의 최초 펼침 상태, 거시·실적일 통합 새로고침은 현재 방식을 유지한다. 보유 수량은 저장값을 바꾸지 않고 화면에서만 정수에 매우 가까우면 정수로 표시한다.
- 종목 목록은 `보유`·`관심` 세그먼트로 즉시 전환하며 앵커 이동은 쓰지 않는다. 검색 결과의 긴 종목명은 말줄임하지 않고 줄바꿈한다.
- 투자의견의 첫 기록은 `커버리지 개시`, 그 뒤의 새 행은 `투자의견 업데이트`로 부른다. 기존 행 수정은 계속 `기록 편집`이며 사건 방식은 바꾸지 않는다. 종목 상세에는 날짜순 등급·목표가 변천 타임라인을 둔다.
- 포트폴리오의 기대수익률 입력은 기본 접힘으로 두고, 장문의 보조 설명은 `?` 팝오버로 옮긴다. 단, 오류·위험 경고처럼 행동에 필요한 문구는 숨기지 않는다. 비중 상한의 비차단 설명은 반복 가치가 없어 표시하지 않는다.
- 자산 비중 막대는 더보기에서 `기본`과 `분할 라벨` 중 고를 수 있고 기기에 기억한다. 분할 라벨은 해외·국내·현금을 막대 색과 맞춰 바로 아래에 배치한다.
- 네이티브 `<select>` 대신 키보드·ARIA를 지원하는 공통 선택창을 쓴다. 리퀴드 글래스는 시트·팝오버·선택 목록·전역 `+`처럼 떠 있는 층에 제한해 적용하고, 본문 카드 전체에는 남용하지 않는다.

마일스톤 8에서 정한 것 (2026-09-19):
- **기대수익률 가정**: 종목별 연 기대수익률(%)을 `securities.expected_return_pct`에 저장한다(`0006`). 모든 보유 종목에 값이 있을 때만 포트폴리오 기대수익률을 표시하며 현금 가정은 0이다.
- **변동성·상관**: 최근 1년 일봉의 단순 일간 수익률로 종목 간 공분산·상관을 계산하고 공분산에 252를 곱해 연환산한다. 겹치는 수익률이 20개 미만인 쌍은 제외한다. 화면에서 기대수익률은 “내 가정”, 변동성·상관은 “계산됨”으로 구분한다.
- **제약 경고**: 기본 상한은 단일 종목 25%, 섹터 40%. 기기별 분석 환경 설정이라 localStorage에 저장하고, 초과 시 주황 경고만 보이며 시뮬 거래를 막지 않는다.
- **오프라인**: 서비스 워커가 앱 셸과 같은 출처 정적 자산을 캐시하고, API 래퍼가 성공한 GET JSON을 토큰별 Cache API 키에 저장한다. 네트워크 연결 실패 시 마지막 응답을 쓰고 화면 상단과 시세 기준에 “오프라인”을 표시한다.
- **의견 사후평가**: 미국장 일일 크론에서 미평가 의견을 최대 100개씩 D1 쿼리 3개로 처리한다. 기간 안의 일중 high/low로 목표 도달을 판정하고, 목표 시점 이하 마지막 거래일 종가로 실제수익률·MAE를 채운다.

마일스톤 9에서 정한 것 (2026-09-20):
- **별도 Worker**: MCP 서버는 `invest-api`에 붙이지 않고 `mcp/`의 새 Worker `invest-mcp`로 뒀다. 같은 D1을 읽지만 인증 방식(OAuth)과 수명주기가 달라서, 한쪽 배포가 다른 쪽을 흔들지 않게 한다. 마이그레이션은 `worker/migrations` 한 곳에서만 돌린다.
- **OAuth 직접 구현** (§7.7): 외부 인가 서버나 Durable Object를 쓰지 않는다. 동적 등록(RFC 7591) + 인가 코드 + PKCE S256, 접근 토큰 30일·갱신 토큰 180일(회전), 토큰은 SHA-256 해시만 저장. 로그인은 새 계정 대신 이미 있는 `APP_TOKEN`을 붙여넣는 화면 하나.
- **상태 없는 Streamable HTTP**: 세션(Mcp-Session-Id)도 서버발 SSE 스트림도 쓰지 않아서 Durable Object가 필요 없다(무료 플랜). `POST /mcp` 하나에 `initialize`/`tools/list`/`tools/call`, `GET /mcp`는 405.
- **읽기 툴 6개**: SPEC §2.3의 3개(`get_portfolio`, `get_investment_views`, `get_company_view`)에 `get_calendar`, `get_macro`, `get_tech_calls`를 더했다. 대화에서 "다음 주에 뭐 있어?", "내 판정 맞았어?"를 바로 답하려면 필요했다. 전부 읽기 전용이고 쓰기 툴은 없다.
- **계산은 툴이 한다**: 비중·수익률·TTM·PER·1년 전 대비 변화까지 코드가 계산해서 넘기고, `instructions`로 모델에게 다시 계산하지 말라고 못박는다(AGENTS 규칙 "LLM은 계산하지 않는다"의 연장).
- **판정 분리 유지**: `get_tech_calls` 응답에 "투자의견·성과평가와 섞지 말고 예측형 조언을 만들지 말라"는 규칙 문구를 같이 넣는다.

마일스톤 10에서 정한 것 (2026-09-20):
- **쓰기는 제안까지**: MCP 쓰기 툴이 실제 보유·의견을 바로 바꾸지 않고 `import_drafts`에 쌓는다. "실제 데이터는 앱에서만 바뀐다"를 불변식으로 두면 쓰기 권한을 넓혀도 위험이 크게 늘지 않는다. 승인 화면도 홈 한 곳(가져오기 대기)이면 된다.
- **의견도 같은 대기열을 지난다**: 대신 기록 시점이 흐려지지 않게 제출 순간의 가격·컨센서스·PER을 얼려 두고, 승인 시 그 시각으로 기록한다.
- **정규화 재사용**: 스크린샷 판독만 대화 쪽 모델이 하고, `normalize`·`merge`·변화 감지는 기존 코드 그대로다. 초안은 `normalize`가 읽는 키 이름으로 저장한다.
- **툴 범위**: 보유 + 현금 + 투자의견까지. 관심종목·판정·시나리오 쓰기는 열지 않았다(대화에서 만들 이유가 약하고, 판정은 지표 계산이 필요하다).

### 7.2 인증 [확정: 1차]
- Worker 시크릿 `APP_TOKEN`(긴 무작위 문자열). 모든 API 요청에 `Authorization: Bearer <token>`. 없거나 틀리면 401.
- 프론트: 설정 화면에서 토큰 붙여넣기 → localStorage. 기기마다 한 번.
- CORS `ALLOW_ORIGINS = ["https://likelikelikeit.github.io"]`. Origin은 스킴+호스트만(경로 없음).
- `/import`(Claude API 과금)는 토큰 + 하루 호출 상한(`meta`에 카운터, 기본 30회) [제안].
- 2차: Cloudflare Pages + Access로 이전. 프론트 코드 변경 없음.

### 7.3 크론 (UTC) [확정: 서머타임 무관하게 고정]
| 시각(UTC) | KST | 작업 |
|---|---|---|
| `0 7 * * 1-5` | 16:00 | 국내 종목 시세(OHLCV 당일 행), 국내 지수, 환율, 보유 스냅샷(국내) |
| `0 22 * * 1-5` | 07:00 익일 | 미국 종목 시세(EDT/EST 모두 마감 후), 미국 지수·금리, 보유 스냅샷(전체, 이 시점에 하루치 확정), 의견 사후평가, tech_calls 1w/1m 채움 |
| `0 23 * * SUN` | 월 08:00 | quoteSummary(컨센·fwd EPS), 네이버 컨센, DART/야후 재무 갱신 |
| `30 23 * * *` | 08:30 | FRED, ECOS 거시 |
| `0 0 * * *` | 09:00 | 어닝일(calendarEvents), DART 공시 |
휴장일에도 돌아가며 같은 값을 다시 쓸 뿐(UPSERT)이라 무해.

### 7.4 야후 crumb
1. `GET https://fc.yahoo.com` (또는 finance.yahoo.com) → `Set-Cookie`에서 세션 쿠키(A1/A3) 확보
2. `GET https://query2.finance.yahoo.com/v1/test/getcrumb` (쿠키 포함) → crumb 문자열
3. `GET https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}?modules=...&crumb={crumb}` (쿠키 포함)
쿠키·crumb은 `meta`에 저장하고 401/403이면 재발급. 유럽 엣지에서 GDPR 동의 페이지로 리다이렉트되면 실패 처리 후 재시도. 항상 데스크톱 `User-Agent` 헤더 사용.

### 7.5 Worker 제약 대응
- CPU 10ms/req: 큰 JSON 파싱 주의. 스크린샷은 브라우저에서 축소해서 보냄(이미 구현). 크론은 종목을 배치로 나눠 여러 번 실행되게(예: 10종목씩) [제안].
- 서브요청 50/req: 크론 한 번에 외부 호출 40개 이하.
- D1 배치 쓰기는 `batch()` 사용.

### 7.6 프론트 규약
- 모든 계산은 `web/src/lib/calc/`의 순수 함수로 두고 단위 테스트(Vitest). 기존 세션에서는 jsdom 스모크 테스트로 검증해왔음 — 이어간다.
- API 응답은 IndexedDB(or Cache API)에 저장해 오프라인 표시.
- 시세 지연 표시 필수.
- 접근성: 슬라이더·버튼에 `aria-label`, 키보드 조작 가능.

### 7.7 비밀
- 절대 커밋 금지: `portfolio.json`(사용자 실제 보유 데이터), `.dev.vars`, 토큰, API 키.
- Worker 시크릿: `APP_TOKEN`, `ANTHROPIC_API_KEY`, `DART_API_KEY`, `FRED_API_KEY`, `ECOS_API_KEY`. Brandfetch client ID는 공개 가능하므로 프론트 vars.

### 7.8 MCP 서버 (invest-mcp)
- 주소 `https://invest-mcp.hyungjin0416.workers.dev`. Claude 커스텀 커넥터에는 `/mcp`를 등록한다.
- 경로: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`(자원 경로가 붙어 와도 받는다), `POST /register`, `GET·POST /authorize`, `POST /token`, `POST /mcp`, `GET /health`.
- 시크릿은 `APP_TOKEN` 하나. `invest-api`와 같은 값이어야 한다(앱에서 쓰는 그 토큰).
- 저장소: `mcp_clients`, `mcp_auth_codes`, `mcp_tokens` (마이그레이션 `0007`). 투자 데이터에는 쓰지 않는다.
- 2026-09-20 확인: Claude와 ChatGPT 양쪽에서 커스텀 커넥터로 붙어 동작했다. 특정 클라이언트에 맞춘 구현이 아니라 표준(RFC 7591·8414·9728 + PKCE)만 따른 결과다.

### 7.9 초안 대기열 (MCP 쓰기)
모바일에서 증권사 화면을 Claude/ChatGPT에 찍어 보내면 그쪽 모델이 표를 읽고 MCP로 넣는다. 워커가 LLM을 부르지 않으므로 `/import`용 키가 없어도 가져오기가 된다.

- **제안까지만 쓴다.** MCP 쓰기 툴은 `import_drafts`에만 넣는다(`0008`). 보유·현금·의견은 앱에서 승인할 때만 바뀐다. LLM 오독이 곧바로 실제 데이터가 되지 않게 하는 안전장치이고, 토큰이 새도 잃는 게 작다.
- **툴 3개**: `submit_portfolio_import`(보유+현금), `add_investment_view`(의견), `get_pending_drafts`(대기 확인).
- **정규화는 앱이 한다.** 초안은 `web/src/lib/calc/normalize.js`가 읽는 모양으로 저장하고, 승인 화면은 기존 스크린샷 가져오기 시트를 그대로 쓴다. 병합·변화 감지도 기존 경로(`mergeRows`)를 탄다.
- **의견은 제출 시점을 기록한다.** `add_investment_view`가 그 순간의 가격·컨센서스·PER을 payload에 얼리고, 승인 시 `created_at`은 제출 시각(`proposed_at`)으로 들어간다. 승인이 며칠 늦어도 예측 시점이 밀리지 않는다. 가격 기준은 저장된 마지막 종가(`close YYYY-MM-DD`)다.
- **경로**: `GET /drafts?status=`, `POST /drafts/:id/apply`(보유는 시트에서 고친 `{rows, cash}`를 보내면 그쪽이 이긴다), `POST /drafts/:id/discard`. 버린 초안도 행은 남는다.
- **스코프**: 토큰 스코프를 `mcp:read mcp:propose`로 넓히고 로그인 화면 문구도 "읽기와 제안"으로 바꿨다. 이미 연결된 클라이언트는 다시 연결하지 않아도 된다(스코프를 강제하지 않는다).
- `/import`(앱 안 스크린샷 업로드)는 남겨 둔다. 저렴한 공급자를 넣으면 앱만으로도 되는 길이 유지된다(§10 미정 항목 유지).

---

## 8. 구현 순서 (마일스톤) [확정]

각 단계는 끝나면 쓸 수 있는 것이 하나 늘어난다. 한 세션에 한 단계가 적당. 5는 둘로 쪼개질 수 있음.

| # | 내용 | 완료 기준 |
|---|---|---|
| 0 | 골격: 저장소, Svelte·Vite·wrangler, D1 생성, `0001_init.sql`, Actions 배포 파이프라인, 빈 탭 5개 | 빈 앱이 Pages에 뜨고 Worker `/health`가 200 |
| 1 | 백엔드 이관: 토큰 인증, `/portfolio` CRUD, 종목·관심·현금 API, 기존 `/quotes` `/search` `/import` 유지, `portfolio.json` → D1 시드 스크립트 | 아이폰에서 토큰 넣고 보유 15종목이 API로 읽힘 |
| 2 | **첫 배포**: 홈 자산 요약(도넛·로고·색·목록), 종목 탭, 포트폴리오 탭(보기/시뮬 모드, 기존 로직 이식), 스크린샷 가져오기, 변화 감지 질문 | 기존 시뮬레이터 기능이 새 앱에서 전부 동작. PWA 설치 |
| 3 | 시세: 크론 2회, 5년 백필, 지수·환율, 보유 스냅샷, 종목 상세 개요(스크러빙 차트), 시장 띠 | 종목 상세에 5년 차트가 뜨고 매일 자동 갱신 |
| 4 | 투자의견: 폼, 8등급, 자동 스냅샷, 편집·수정됨, 의견 탭, 성과 평가 뼈대(진행 중만), 홈 의견 블록 | 첫 의견을 기록하고 홈에 상승여력 순으로 보임 |
| 5a | 재무·추정: DART, 야후 quoteSummary(crumb), 네이버 컨센, financials/estimates 채움, 재무 세그먼트 | 삼성전자·엔비디아 분기 재무와 컨센이 표로 보임 |
| 5b | 밸류에이션: TTM 멀티플 시계열, 밴드 두 형태, 배수 자동 추천, 가정 슬라이더(EPS↔성장률), 시나리오 3개, base→의견 폼 자동 채움 | 밴드에서 가정 만져 의견 기록까지 한 동선 |
| 6 | 매수·매도 판정: 5지표 계산, 규칙 편집 화면(버전), 시트 UI, 기록, 1w/1m 크론 | 종목 상세에서 판정 버튼이 동작 |
| 7 | 일정·거시: FOMC 등 시드, 어닝일 크론, FRED·ECOS, 금리 경로 그래프, 홈 블록 완성 | 홈 다섯 블록 전부 실데이터 |
| 8 | 자산군 층, 기대수익률·변동성·상관, 제약 경고, PWA 오프라인 캐시, 의견 사후평가 크론 완성 | 포트폴리오 탭에 변동성이 보이고 지하철에서 앱이 열림 |
| 9 | MCP 읽기 툴 6개 (별도 Worker `invest-mcp` + 직접 구현한 OAuth), Claude 커스텀 커넥터 연결 | Claude 앱에서 "내 투자의견" 치면 답이 옴 |
| 10 | MCP 쓰기(제안) 툴: 사진으로 읽은 보유·대화에서 정리한 의견을 초안으로 넣고 앱에서 승인 | 폰에서 스크린샷을 Claude/ChatGPT에 주면 앱 홈에 "가져오기 대기"가 뜨고, 눌러서 보유·의견에 반영됨 |

이후: Cloudflare Pages + Access 이전, 초과수익 벤치마크, 증권사 API 연동, 브리핑 생성.

---

## 9. 기존 자산 (이 문서와 함께 넘기는 파일)

- **`worker.js`** — 현재 Cloudflare에 배포된 Worker. 경로: `GET /?symbols=` 시세+환율, `GET /search?q=`, `POST /import?mt=`(base64 본문 → Claude → rows). `ALLOW_ORIGINS`, `MAX_SYMBOLS=40`, `MODEL='claude-sonnet-5'`, 추출 프롬프트 포함. **마일스톤 1에서 `worker/src/`로 흡수.**
- **`index.html`** — 단일 파일 포트폴리오 시뮬레이터(순수 JS). 이식할 것: `normalize`/`mergeHoldings`, `computed`(현금 버퍼 수식), `setQty`(평단 재계산)/`setWeight`, 슬라이더 snap 패턴, 도넛 SVG(stroke-dasharray 방식, hover 연동), `SECTORS` 팔레트, 자동완성, 스크린샷 축소·미리보기 UI, safe storage 래퍼, 테마 토글, CSS 토큰. 디자인 톤의 기준점이기도 하다.
- **`portfolio.json`** — 사용자의 실제 보유 15종목(`{holdings:[{id,name,tick,mkt,sec,ysym,price,qty,avg,baseQty,baseAvg,realized}],removed:[],deposit}`). **비공개. 커밋 금지. D1 시드에만 사용.**

---

## 10. 보류·미정 목록

| 항목 | 상태 | 메모 |
|---|---|---|
| 거래 이력(transactions) | 보류 | 카카오페이 PC 불가. 증권사 이전/API 시 재검토. §5.1 변화 감지가 대체 |
| Cloudflare Pages + Access | 2차 | 토큰 방식으로 먼저 |
| 네이버 컨센 엔드포인트 | 확정(M5a) | `/api/stock/{code}/integration`의 `consensusInfo`. 비공식이라 어댑터 격리·실패 허용 |
| 국내 실적발표일 소스 | 없음 | 수동 |
| 시장 기대 금리 경로 | 대용치 | DGS2 + 점도표 수동 |
| 시장 대비 초과수익 | 2차 | |
| 등급-수익률 상관(스피어만) | 2차 | |
| tech_calls 1w/1m 화면 노출 | 확정(M6) | 판정 기록 행에 사실(수익률)만. 집계 없음 |
| 홈 블록 기본 접힘 상태 | 제안 | 1·2·3 펼침 |
| 맥 미니 | 안 함 | 크론이 대체. vault 자동화와 묶일 때 재검토 |
| 브리핑 자동 생성(LLM) | 후순위 | 붙이면 월 몇 천 원 수준 |
| 스크린샷 인식 LLM 공급자 | 미정 | 사용자가 나중에 더 저렴한 것으로 정함(2026-09-19). M1에서 `/import`의 LLM 호출을 어댑터로 분리해 공급자·모델·키 이름을 설정으로 바꿀 수 있게 한다. 키가 없으면 `/import`만 "키 없음" 응답 |

---

## 11. 용어
- **보유 등록 vs 매수 시뮬**: 전자는 원래 갖고 있던 것(총자산 포함), 후자는 현금으로 새로 담는 가상 매수.
- **기준 재설정(rebase)**: 시뮬레이션 결과를 실제로 체결한 뒤 현재 상태를 새 출발점으로 삼는 동작. `baseQty ← qty`, 주문서·실현손익 초기화.
- **계기판**: §5.6 매수·매도 판정. 판단하지 않고 상태만 요약.
- **사건 방식**: 덮어쓰지 않고 행을 추가하는 기록 방식.
- **TTM**: 최근 4분기 합.
