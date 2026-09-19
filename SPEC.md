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
| 네이버페이 증권 모바일 내부 JSON | 국내 컨센서스(FnGuide) | 없음 | 주 1회 | 비공식. 엔드포인트는 구현 시 브라우저 개발자도구로 확인 [미정] |
| DART OpenAPI | 국내 공시, 분기 재무(XBRL) | 무료 API 키 | 주 1회 + 공시 매일 | |
| FRED | 미국 기준금리, 국채금리(2Y/10Y), CPI 등 | 무료 API 키 | 하루 1회 | |
| 한국은행 ECOS | 한국 기준금리 | 무료 API 키 | 하루 1회 | |
| Brandfetch Logo API `cdn.brandfetch.io/ticker/{SYM}/...?c={clientId}` | 종목 로고 | 무료 client ID (공개 가능) | `<img>` 핫링크만, 캐시 금지(약관) | 폴백: Parqet(ISIN) → 이니셜 레터마크 |
| Anthropic API (`claude-sonnet-5`) | 스크린샷 → 보유 종목 JSON | `ANTHROPIC_API_KEY` Worker 시크릿 | 사용자 요청 시 | 이미 worker.js에 구현 |

야후 quoteSummary와 네이버는 비공식이라 언제든 깨질 수 있다. 소스 어댑터를 `worker/src/sources/*.js`로 분리해 교체 지점을 한 곳으로 모은다 [제안].

### 2.3 미래에 붙을 것 (지금은 만들지 않음)
- **MCP 서버** (마일스톤 9): 읽기 툴 3개 `get_portfolio`, `get_investment_views`, `get_company_view`로 시작. 쓰기는 `add_note` 정도만. Cloudflare의 원격 MCP 호스팅 + OAuth 사용. Claude Pro 커스텀 커넥터로 연결.
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
  sector        TEXT,                     -- 반도체·AI, 헬스케어 ... (자유 텍스트, 팔레트 키)
  logo_url      TEXT,                     -- 수동 지정 시. 없으면 Brandfetch 규칙으로 생성
  brand_color   TEXT,                     -- '#RRGGBB'. 로고에서 추출하거나 수동
  band_default  TEXT DEFAULT 'per',       -- 'per' | 'pbr' | 'ev_ebitda' | 'psr'
  band_multiples TEXT,                    -- JSON {"per":[8,10,12,14,16],"pbr":[...]} 사용자 수정값
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
  raw              TEXT,                  -- JSON 원문
  source           TEXT NOT NULL,         -- 'dart' | 'yahoo'
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
  series_id  TEXT PRIMARY KEY,            -- 'FEDFUNDS', 'DGS2', 'DGS10', 'BOK_BASE', 'USDKRW' ...
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
`홈` · `종목` · `포트폴리오` · `의견` · `더보기`

일정은 탭이 아니고 홈 블록 + 더보기 안. 나중에 바꿀 수 있음.

### 4.2 홈 (첫 화면) — 블록 순서
1. **시장 지표 띠**: 코스피, S&P500, USD/KRW, 미국 10년물 (한 줄, 얇게)
2. **자산 요약**: 총자산(원화) 큰 숫자, 인터랙티브 도넛(종목별 색 = 브랜드색, 현금은 달러·원화 분리 조각), 해외/국내 비중, 세로 종목 목록(로고·이름·수량·비중·평가액·손익)
3. **투자의견 요약**: 의견 있는 종목을 상승여력 순으로. 현재가 · 목표가 · 상승여력 · 등급. **의견 없는 보유 종목은 흐린 줄로 표시하고 누르면 기록 폼** [확정]
4. **다가오는 일정**: 어닝, 경제지표, 행사
5. **거시**: 기준금리(한·미)와 금리 경로 그래프(§5.8)

블록은 **접기**. 헤더 전체가 클릭 영역, 오른쪽 chevron이 상태. 접힘 상태는 기기에 기억(localStorage). 최초 기본: 1·2·3 펼침, 4·5 접힘 [제안].

### 4.3 종목 상세 (앱의 심장)
어느 화면에서든 종목을 누르면 도달. 상단 고정 헤더: 로고·이름·티커 · 현재가와 등락 · 내 목표가 · 상승여력 · 현재 등급 · `지금 사도 될까` / `지금 팔아도 될까` 버튼 · `새 의견 기록` 버튼.

세그먼트 4개 [확정]:
- **개요**: 가격 차트(스크러빙, 기간 토글 1M/3M/1Y/3Y/5Y/10Y), 52주 범위, 거래량, 다음 어닝일, 컨센 목표가 vs 내 목표가
- **밸류에이션**: 밴드 차트 두 형태(§5.3), 가정 슬라이더와 시나리오(§5.4)
- **재무**: 분기·연간 표, 핵심 항목 추이 미니 차트, 추정치(컨센/내 것) 비교
- **내 의견**: 의견 이력 타임라인(목표가 변화 그래프 + 행 목록), 판정 기록

### 4.4 포트폴리오 탭
- **보기 모드**(기본): 도넛, 목록, 자산군 비중, 기대수익률·변동성 요약, 자산 추이(스냅샷)
- **시뮬 모드**: `시뮬레이션` 버튼으로 진입. 기존 시뮬레이터 로직(§5.5) 이식. 저장/취소. 저장한 시나리오 목록.

### 4.5 의견 탭
전체 의견 목록(필터: 종목·등급·기간), **성과 평가** 화면(§5.2.4).

### 4.6 더보기
일정 캘린더 · 거시 상세 · 스크린샷 가져오기 · 판정 규칙 편집 · 설정(토큰, 시세 서버 주소, 테마, 데이터 내보내기)

### 4.7 입력 진입점
맥락별 버튼(종목 상세의 `새 의견 기록` 등) **+ 전역 `+` 버튼** [확정]. 전역 +: 스크린샷 가져오기 / 의견 기록 / 종목 추가 / 판정.

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
자유 편집 허용. 편집하면 `edited_at`이 채워지고 UI에 "수정됨 · 시각"이 작게 붙는다. 종목 화면의 큰 버튼은 항상 **새 의견 기록**이고 편집은 기존 행의 자기 메뉴 안에만 둔다. 의견 업데이트는 새 행이다.

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
- **base 시나리오 → 투자의견 폼 자동 채움** [확정]: 목표가, `valuation` JSON(지표·배수·EPS·성장률·scenario_id). 밴드에서 가정을 만지다 `이 가정으로 의견 기록` 버튼 → 폼에 등급과 논리만 적으면 됨. 이것이 기록의 기본 동선.
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
- 기준금리: 미국 `FEDFUNDS`(FRED), 한국 기준금리(ECOS).
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
│  ├ src/routes/       home, securities, portfolio, views, more, security/[id]
│  └ src/components/
├ worker/
│  ├ wrangler.toml     D1 binding, cron triggers, vars
│  ├ migrations/       0001_init.sql, ...
│  ├ src/index.js      라우터
│  ├ src/routes/       quotes, search, import, portfolio, views, ...
│  ├ src/sources/      yahoo.js (chart, quoteSummary+crumb, search), naver.js, dart.js, fred.js, ecos.js
│  ├ src/cron/         daily_kr.js, daily_us.js, weekly.js, evaluate.js
│  └ src/calc/         서버에서도 쓰는 계산 (web/src/lib/calc와 공유 가능하면 패키지로)
└ .github/workflows/pages.yml
```

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
| `0 23 * * 0` | 월 08:00 | quoteSummary(컨센·fwd EPS), 네이버 컨센, DART/야후 재무 갱신 |
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
| 9 | MCP 읽기 툴 3개 (Cloudflare 원격 MCP + OAuth), Claude 커스텀 커넥터 연결 | Claude 앱에서 "내 투자의견" 치면 답이 옴 |

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
| 네이버 컨센 엔드포인트 | 미정 | 구현 시 개발자도구로 확인. 비공식 |
| 국내 실적발표일 소스 | 없음 | 수동 |
| 시장 기대 금리 경로 | 대용치 | DGS2 + 점도표 수동 |
| 시장 대비 초과수익 | 2차 | |
| 등급-수익률 상관(스피어만) | 2차 | |
| tech_calls 1w/1m 화면 노출 | 미정 | 데이터는 쌓음 |
| 홈 블록 기본 접힘 상태 | 제안 | 1·2·3 펼침 |
| 맥 미니 | 안 함 | 크론이 대체. vault 자동화와 묶일 때 재검토 |
| 브리핑 자동 생성(LLM) | 후순위 | 붙이면 월 몇 천 원 수준 |

---

## 11. 용어
- **보유 등록 vs 매수 시뮬**: 전자는 원래 갖고 있던 것(총자산 포함), 후자는 현금으로 새로 담는 가상 매수.
- **기준 재설정(rebase)**: 시뮬레이션 결과를 실제로 체결한 뒤 현재 상태를 새 출발점으로 삼는 동작. `baseQty ← qty`, 주문서·실현손익 초기화.
- **계기판**: §5.6 매수·매도 판정. 판단하지 않고 상태만 요약.
- **사건 방식**: 덮어쓰지 않고 행을 추가하는 기록 방식.
- **TTM**: 최근 4분기 합.
