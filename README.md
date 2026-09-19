# invest-handoff

개인 투자 관리·리서치 웹앱. 설계는 [SPEC.md](SPEC.md), 에이전트 작업 규약은 [AGENTS.md](AGENTS.md).

- 프론트 `web/` — Svelte 5 + Vite, GitHub Pages (`https://likelikelikeit.github.io/invest-handoff/`)
- 백엔드 `worker/` — Cloudflare Worker `invest-api` (`https://invest-api.hyungjin0416.workers.dev`) + D1 `invest`

## 로컬 개발

```bash
npm install                      # 루트에서 한 번 (web, worker 둘 다 설치)
npm run dev                      # 프론트 http://localhost:5173/invest-handoff/
npm test                         # Vitest
npm run db:migrate:local -w worker
npm run worker:dev               # Worker http://127.0.0.1:8787/health
```

API 스모크 테스트는 로컬 Worker를 띄운 상태에서 `node worker/scripts/smoke.mjs http://127.0.0.1:8787 local-dev-token`.

## 보유 시드 (portfolio.json → D1)

```bash
cd worker
node scripts/seed.mjs            # ../portfolio.json → .seed/seed.sql (gitignore)
npx wrangler d1 execute invest --remote --file .seed/seed.sql
```

여러 번 돌려도 같은 결과(upsert). 로컬은 `--remote` 대신 `--local`.

## 시세 백필 (최초 한 번, 또는 종목을 많이 추가한 뒤)

```bash
cd worker
node scripts/backfill.mjs          # 이력이 부족한 추적 종목만 5년치 (--local, --all, --range 10y)
SEC_USER_AGENT="이름 이메일" node scripts/sec-history.mjs   # 미국 종목 분기 재무 이력(SEC, 분할 보정). 새 미국 종목을 추가한 뒤 한 번
```

크론(UTC `0 7 * * 1-5`, `0 22 * * 1-5`)이 이후 매일 최근 5일 봉과 보유 스냅샷을 채운다. 미국장 크론은 만기가 지난 투자의견의 적중·실제수익률도 평가한다. 일요일 `0 23 * * SUN`에는 재무·컨센서스를 최대 8종목씩, 매일 `30 23 * * *`에는 거시(FRED·ECOS)와 미국 다음 실적일을 갱신한다(`FRED_API_KEY`, `ECOS_API_KEY` 시크릿 필요). 로컬 시험: `npx wrangler dev --test-scheduled` 후 `curl "http://127.0.0.1:8787/__scheduled?cron=0+22+*+*+1-5"`.

## API (전부 `Authorization: Bearer <APP_TOKEN>`, `/health`만 예외)

| 경로 | 설명 |
|---|---|
| `GET /portfolio` | 보유(종목 정보 포함) + 현금 |
| `POST /portfolio/merge` | `{rows, asOwned}` ysym 기준 upsert. asOwned면 보유도 덮어씀 |
| `PUT·DELETE /portfolio/positions/:securityId` | 보유 한 종목 (수량이 바뀌면 응답 `changes`) |
| `GET /portfolio/changes?pending=1`, `PATCH /portfolio/changes/:id` | 보유 변화 기록과 이유 `{reason}` 또는 `{skipped:true}` |
| `GET·POST /portfolio/scenarios`, `DELETE /portfolio/scenarios/:id` | 저장한 시뮬 |
| `GET·POST /securities`, `GET·PATCH·DELETE /securities/:id` | 종목. PATCH로 자산군·연 기대수익률(%) 설정, DELETE는 숨김(archived_at) |
| `GET·POST /watchlist`, `DELETE /watchlist/:id` | 관심종목 |
| `GET /prices/:id?range=1m\|3m\|1y\|3y\|5y\|10y\|max` | 일봉 `[[date,o,h,l,c,v]]` + 전체 이력 first/last/count |
| `POST /prices/:id/backfill` | 이력이 비었으면 5년, 있으면 최근 5일 |
| `GET /views?security_id=&rating=&from=`, `GET /views/latest` | 투자의견 이력 필터 조회, 종목별 최신 의견 조회 |
| `POST /views`, `PATCH·DELETE /views/:id` | 새 투자의견 기록, 기존 의견 편집·삭제 |
| `GET /fundamentals/:id` | 분기·연간 재무, 최근 컨센서스, 다음 실적일 |
| `POST /fundamentals/:id/refresh` | 해당 종목 재무·컨센서스 즉시 갱신 |
| `GET·POST /scenarios?security_id=`, `DELETE /scenarios/:id` | 종목별 bear/base/bull 밸류에이션 가정 조회·저장·삭제 |
| `GET /tech/:id?side=buy|sell` | 판정 계기판(5지표·라벨·참고, 지연 현재가 포함) |
| `POST /tech/:id/calls`, `PATCH /tech/calls/:id`, `GET /tech/calls?security_id=` | 판정 기록·행동·목록 (1주·1개월 뒤 가격은 크론) |
| `GET·POST /tech/rules`, `GET /tech/rules/history` | 판정 규칙(저장 = 새 버전) |
| `GET /events?from=&to=`, `POST /events`, `DELETE /events/:id` | 일정 조회·직접 추가·삭제(직접 넣은 것만) |
| `GET /macro?from=`, `POST /macro/dots`, `POST /macro/refresh?backfill=1` | 거시 시계열·점도표 입력·즉시 갱신 |
| `GET /status` | 크론 마지막 실행 보고 |
| `GET /cash`, `PUT /cash/KRW\|USD` | 현금 |
| `GET /quotes?symbols=`, `GET /search?q=`, `POST /import?mt=` | 기존 worker.js 경로 |

로컬에서 스크린샷 가져오기를 키 없이 시험하려면 `worker/.dev.vars`에 `IMPORT_LLM_PROVIDER=mock`을 넣는다(가짜 행을 돌려준다).

Worker 로컬 비밀값은 `worker/.dev.vars.example`를 `worker/.dev.vars`로 복사해서 채운다.

국내 재무는 DART가 우선이고 `DART_API_KEY`가 없거나 고유번호가 비어 있으면 네이버 재무를 폴백으로 쓴다. 국내 종목 상세의 `종목 정보`에서 DART 회사 고유번호(8자리)를 저장할 수 있다. 네이버와 Yahoo는 비공식 소스라 실패해도 앱은 저장된 마지막 데이터 또는 “데이터 없음”을 표시한다.

## Cloudflare 최초 설정 (한 번)

```bash
cd worker
npx wrangler login               # 브라우저로 Cloudflare 계정 인증
npx wrangler d1 create invest    # 나온 database_id를 wrangler.toml에 넣는다
npx wrangler d1 migrations apply invest --remote
npx wrangler deploy
```

## 비밀

`portfolio.json`, `.dev.vars`, 토큰, API 키는 커밋하지 않는다. Worker 시크릿은 `npx wrangler secret put 이름`으로 넣는다.
