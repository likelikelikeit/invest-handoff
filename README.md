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

## API (전부 `Authorization: Bearer <APP_TOKEN>`, `/health`만 예외)

| 경로 | 설명 |
|---|---|
| `GET /portfolio` | 보유(종목 정보 포함) + 현금 |
| `POST /portfolio/merge` | `{rows, asOwned}` ysym 기준 upsert. asOwned면 보유도 덮어씀 |
| `PUT·DELETE /portfolio/positions/:securityId` | 보유 한 종목 |
| `GET·POST /securities`, `GET·PATCH·DELETE /securities/:id` | 종목. DELETE는 숨김(archived_at) |
| `GET·POST /watchlist`, `DELETE /watchlist/:id` | 관심종목 |
| `GET /cash`, `PUT /cash/KRW\|USD` | 현금 |
| `GET /quotes?symbols=`, `GET /search?q=`, `POST /import?mt=` | 기존 worker.js 경로 |

Worker 로컬 비밀값은 `worker/.dev.vars.example`를 `worker/.dev.vars`로 복사해서 채운다.

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
