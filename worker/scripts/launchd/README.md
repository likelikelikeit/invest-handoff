# 맥 미니에서 DART 돌리기

OpenDART는 Cloudflare 서버 요청을 오류 페이지로 돌려보낸다(302 → error1.html). 그래서 DART만 맥 미니(국내 가정 회선)가 맡는다.
시세·KIND 실적 일정·야후 재무는 그대로 Cloudflare 5분 틱이 한다(SPEC §7.3).

1. 저장소를 받는다: `git clone https://github.com/likelikelikeit/invest-handoff ~/invest-handoff && cd ~/invest-handoff && npm install`
2. 키 파일을 만든다(형진이 직접, 화면에 붙여 넣은 값이 남지 않게): `~/.invest-handoff.env`
   ```
   DART_API_KEY=...
   CLOUDFLARE_API_TOKEN=...      # Cloudflare 대시보드 → API 토큰 → D1 편집 권한만
   CLOUDFLARE_ACCOUNT_ID=...
   ```
   `chmod 600 ~/.invest-handoff.env`
3. 과거 이력 한 번: `cd worker && set -a && source ~/.invest-handoff.env && set +a && node scripts/dart-history.mjs`
   (처음엔 `--dry`로 받아만 보고 `.seed/dart-history.sql`을 확인해도 된다)
4. 매일 동기화 등록: `com.invest.dart-sync.plist`의 `/Users/ME`를 맥 미니 계정 홈으로 바꾸고(PATH에 `/opt/homebrew/bin`이 들어 있어야 launchd에서 npx를 찾는다), 실패 알림용 `~/bin/run-with-alert`가 있는지 확인한다. LaunchAgent는 매시 `:10`에 확인하지만 스크립트가 오전(08:10 이후)·오후(18:10 이후) 슬롯을 로컬 상태 파일로 가려 **실제 DART·D1 작업은 하루 최대 두 번만** 한다. 정시를 놓치면 다음 시간에 한 번 따라잡는다.
   ```bash
   cp scripts/launchd/com.invest.dart-sync.plist ~/Library/LaunchAgents/
   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.invest.dart-sync.plist 2>/dev/null || true
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.invest.dart-sync.plist
   ```
5. 확인: `launchctl list | grep invest`, `~/Library/Logs/invest-dart-sync.log`, 또는 D1 meta `cron:dart`. 실패하면 작업실 텔레그램 봇이 알린다.

2026-10-22 설치됨(Agent Workshop 세션): 과거 이력 완료, LaunchAgent 등록·수동 실행 exit 0, 실패 알림 연결.

## 모의투자 매일 점검 (2026-10-27 추가)

`scripts/sim-check.mjs`는 진행 중인 모의투자 대회를 읽기만 하고 점검한다: 체결 Worker 실행·오류, 시세 보류 종목, 막힌 미체결 주문, 환율·평가 시세 신선도, 현금 원장(초기 자금 + 체결 + 분할 정산 = 현재 현금), 음수 잔고·보유, 07:10 일별 스냅샷, 지난 24시간 체결·거절·분할. 문제가 있으면 종료 코드 1이라 `run-with-alert`가 알린다. 대회가 없으면 바로 끝난다.

토큰은 위 `~/.invest-handoff.env`를 그대로 쓴다. `com.invest.sim-check.plist`의 `/Users/ME`를 바꾸고 등록한다(07:30 KST에 한 번).

```bash
chmod +x scripts/launchd/sim-check.sh
cp scripts/launchd/com.invest.sim-check.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.invest.sim-check.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.invest.sim-check.plist
```

손으로 돌릴 때: `cd worker && node scripts/sim-check.mjs` (PC에서는 `npx wrangler login`만 돼 있으면 된다). 결과는 `~/Library/Logs/invest-sim-check.log`.
