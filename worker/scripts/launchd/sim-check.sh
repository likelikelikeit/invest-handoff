#!/bin/zsh
# 맥 미니 LaunchAgent가 부르는 모의투자 매일 점검 래퍼. 읽기만 한다.
# 토큰은 dart-sync와 같은 ~/.invest-handoff.env (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
set -a; source "$HOME/.invest-handoff.env"; set +a
cd "$(dirname "$0")/../.." || exit 1          # worker/
exec /opt/homebrew/bin/node scripts/sim-check.mjs "$@"
