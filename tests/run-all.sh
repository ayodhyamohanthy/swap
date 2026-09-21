#!/usr/bin/env sh
# SwapSeat — full local validation in the documented order.
#
# NOTE (pre-existing repo defect, see docs/PWA.md): the three browser suites
# drive the CLASSIC engine (their selectors are #lookupBtn / #seatmap /
# #swapList / #postBtn). Since the mobile flow became the default surface,
# they must be pointed at ?legacy=1 or they time out on hidden elements.
# This script does that for you, so the documented commands work as written.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PLAYWRIGHT_CORE="${PLAYWRIGHT_CORE:-$HOME/node_modules/playwright-core}"
export CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BASE_URL="${BASE_URL:-http://localhost:8099/index.html}"
PORT="$(printf '%s' "$BASE_URL" | sed -n 's|.*://[^:/]*:\([0-9]*\).*|\1|p')"
PORT="${PORT:-8099}"

status=0
run() { echo "\n=== $1 ==="; shift; "$@" || status=1; }

run "data layer (geometry)" node tests/geometry.test.js
run "PWA layer" node tests/pwa.test.js
run "ledger schema" node tests/ledger.test.js

if curl -sf -o /dev/null "$BASE_URL"; then
  echo "\n(static server already running on :$PORT)"
else
  echo "\n(starting python3 -m http.server $PORT)"
  (cd "$ROOT" && python3 -m http.server "$PORT" >/dev/null 2>&1 &)
  sleep 2
fi

export BASE="$BASE_URL?legacy=1"
run "browser smoke" node tests/e2e-smoke.js
run "browser flows" node tests/e2e-flows.js
run "browser v2" node tests/e2e-v2.js

echo
[ "$status" -eq 0 ] && echo "ALL SUITES PASSED" || echo "SOME SUITES FAILED"
exit "$status"
