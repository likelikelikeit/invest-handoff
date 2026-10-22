#!/bin/zsh
# 맥 미니 LaunchAgent가 부르는 래퍼 (scripts/launchd/README.md).
# 키·토큰은 ~/.invest-handoff.env (chmod 600)에 형진이 직접 둔다:
#   DART_API_KEY=...
#   CLOUDFLARE_API_TOKEN=...     # D1 편집 권한만 준 토큰
#   CLOUDFLARE_ACCOUNT_ID=...
set -a; source "$HOME/.invest-handoff.env"; set +a
cd "$(dirname "$0")/../.." || exit 1          # worker/
exec /opt/homebrew/bin/node scripts/dart-sync.mjs
