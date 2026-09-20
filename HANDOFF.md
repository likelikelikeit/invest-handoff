# 세션 인계 메모

업데이트: 2026-09-21 00:05 KST (Claude Code)

## 시작할 때
1. `AGENTS.md`와 `SPEC.md`를 먼저 읽는다.
2. `main`에서 시작한다. 지금은 브랜치에 남은 작업이 없다.

## 현재 상태 (전부 배포됨)
- `main` = `9847ca1`. 원격 push 완료, Pages 배포 확인(`index-D30wo4xp.js`).
- Worker `invest-api` 배포 완료(`32d07028`), `invest-mcp` 배포 완료(`5ec70ea1` — ADR 통화 보정 포함).
- D1 마이그레이션 `0011_fed_target_range.sql` 로컬·원격 적용 완료. 원격에 대기 중인 마이그레이션 없음.
- 테스트: web 95 · worker 90 · mcp 41 = 226개 통과. 프로덕션 빌드 성공.

## 남은 일 (사용자 몫)
1. 앱 → 더보기 → 거시 → **거시·실적일 지금 받기**. `FED_TARGET_LOWER/UPPER`가 아직 0행이라 목표범위와 금리 경로 그래프가 비어 있다.
   예상 쓰기 ~8,600행(2015년부터 일별 2개 시리즈). D1 일일 10만 행 한도 대비 안전하다. 누르지 않아도 매일 08:30 크론이 최근 60일치는 채운다.
2. 아이폰 확인: 보유/관심 전환, 긴 검색명, 커버리지 개시 → 투자의견 업데이트 → 변천 타임라인, 기술적 분석 진입점, 커스텀 선택창, 자산 비중 표시 옵션, 목표범위와 별도 EFFR.

## 주의
- `.dev.vars`, `portfolio.json`, 토큰·API 키는 커밋하지 않는다.
- UI 용어만 바뀌었고 DB/API 식별자(`views`, `tech_calls`)는 그대로다.
- 로컬 개발: 프론트 `cd web && npm run dev`, Worker `cd worker && npx wrangler dev`.
  MCP를 같이 띄우려면 로컬 D1 파일을 두 프로세스가 동시에 잡을 수 없으니 한 번에 하나만 실행한다
  (`cd mcp && npx wrangler dev --port 8788 --persist-to ../worker/.wrangler/state`).
