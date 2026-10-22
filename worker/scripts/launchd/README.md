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
4. 매일 동기화 등록: `com.invest.dart-sync.plist`의 경로를 맞춘 뒤
   `cp scripts/launchd/com.invest.dart-sync.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.invest.dart-sync.plist`
5. 확인: `~/Library/Logs/invest-dart-sync.log`, 또는 D1 meta `cron:dart`.
