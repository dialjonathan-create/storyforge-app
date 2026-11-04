#!/usr/bin/env bash
# The studio in LIVE mode: a local otherwise-studio worker (from ability-supervisor-service
# cloudflare/otherwise-studio, path in WORKER_DIR) + the stand-in story server signing tickets.
#   WORKER_DIR=../ability-supervisor-service/cloudflare/otherwise-studio bash tests/e2e/run-live.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
WORKER_DIR="${WORKER_DIR:?set WORKER_DIR to cloudflare/otherwise-studio}"
KEYS=$(node --input-type=module -e '
const kp = await crypto.subtle.generateKey({name:"Ed25519"}, true, ["sign","verify"]);
console.log(Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64") + " " + Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64"));')
PUB=${KEYS% *}; PRIV=${KEYS#* }
SECRET=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
( cd "$WORKER_DIR" && umask 077 && printf 'STUDIO_TICKET_PUBLIC_KEY=%s\nSTUDIO_SERVICE_SECRET=%s\n' "$PUB" "$SECRET" > .dev.vars && rm -rf .wrangler/state )
( cd "$WORKER_DIR" && npx --yes wrangler@4.27.0 dev --env preview --port 8790 --ip 127.0.0.1 > /tmp/otherwise-studio-dev.log 2>&1 ) &
WPID=$!
trap 'kill $WPID 2>/dev/null || true; pkill -f "wrangler.*8790" 2>/dev/null || true; rm -f "$WORKER_DIR/.dev.vars"' EXIT
for i in $(seq 1 90); do curl -fsS http://127.0.0.1:8790/health >/dev/null 2>&1 && break; sleep 1; done
STUDIO_SYNC_URL=http://127.0.0.1:8790 STUDIO_TICKET_PKCS8="$PRIV" STUDIO_SERVICE_SECRET="$SECRET" CI=1 \
  npx playwright test -c tests/e2e/playwright.config.mjs studio.live.spec.mjs
