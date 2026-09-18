#!/usr/bin/env bash
# FR-DOC-012 / FR-EXM-031: run the Quickstart's steps 2–6 against a local
# platform, exactly as a judge would from a clone, and fail if any step lies.
#
#   2  a copy of examples/saas outside the workspace, installed from packed workspace tarballs
#   3  products.create           (the example does it at start)
#   4  checkout.sessions.create  (same; the printed URL is asserted)
#   5  handle a signed delivery  (an HTTP endpoint at the example, the endpoint's test call, the worker delivers)
#   6  demo:check                (the example's own local signature check)
#
# Needs: bun, node 20+, a Postgres at $DATABASE_URL, and the repo root as cwd.
# Step 7 (a phone) is not here; the chain is never touched. Wall time is capped by the workflow.
set -euo pipefail

ROOT="$(pwd)"
export DATABASE_URL="${DATABASE_URL:-postgres://elapse:elapse@localhost:55434/elapse_ci}"
export WEBHOOK_SECRET_KEK="${WEBHOOK_SECRET_KEK:-a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=}"
export INGEST_TOKEN="${INGEST_TOKEN:-ci-ingest-token}"
export NODE_ENV=ci
export KEEPER=0
export PORT="${API_PORT:-4000}"
API="http://localhost:$PORT"
EX_PORT="${EXAMPLE_PORT:-3000}"
WORK="$(mktemp -d)"
PIDS=()
trap 'kill "${PIDS[@]}" 2>/dev/null || true' EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Platform: migrate, start API and worker"
(cd api && bun run migrate)
(cd api && exec bun src/index.ts > "$WORK/api.log" 2>&1) & PIDS+=($!)
(cd api && exec bun src/worker/index.ts > "$WORK/worker.log" 2>&1) & PIDS+=($!)
for i in $(seq 1 30); do curl -sf "$API/v1/status" > /dev/null && break; sleep 1; done
curl -sf "$API/v1/status" > /dev/null || { cat "$WORK/api.log"; echo "API did not start"; exit 1; }

say "Step 1: a test secret key and its publishable key"
SEED="$(cd api && bun run seed-merchant "ci-$(date +%s)@example.com")"
SK="$(echo "$SEED" | awk '/^sk_test/{print $2}')"
PK="$(echo "$SEED" | awk '/^pk_test/{print $2}')"
[ -n "$SK" ] && [ -n "$PK" ] || { echo "no keys from seed-merchant: $SEED"; exit 1; }

say "Step 2: a copy of examples/saas outside the workspace, installed like a clone would"
# @elapse/sdk 0.2.0 and @elapse/react 0.1.0 are not on npm yet, so the clone installs exactly what
# `npm publish` would upload: a pack of each workspace package. Restore the npm ranges once both
# versions are published.
pack_workspace() {
  local dir="$1"
  (cd "$ROOT/$dir" && pnpm --silent build > /dev/null && npm pack --silent --pack-destination "$WORK" > /dev/null)
}
pack_workspace sdk/ts
pack_workspace sdk/react
SDK_TGZ="$(ls "$WORK"/elapse-sdk-*.tgz | head -1)"
RCT_TGZ="$(ls "$WORK"/elapse-react-*.tgz | head -1)"
[ -n "$SDK_TGZ" ] && [ -n "$RCT_TGZ" ] || { echo "npm pack produced no tarballs"; exit 1; }
cp -R "$ROOT/examples/saas" "$WORK/saas"
rm -rf "$WORK/saas/node_modules" "$WORK/saas/.env" "$WORK/saas/dist"
node -e '
  const fs = require("fs"), p = process.argv[1] + "/package.json";
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  pkg.dependencies["@elapse/sdk"] = "file:" + process.argv[2];
  pkg.dependencies["@elapse/react"] = "file:" + process.argv[3];
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
' "$WORK/saas" "$SDK_TGZ" "$RCT_TGZ"
(cd "$WORK/saas" && npm install --silent --no-audit --no-fund)
node -e "const v=require('$WORK/saas/node_modules/@elapse/sdk/package.json').version; console.log('@elapse/sdk', v)"
node -e "const v=require('$WORK/saas/node_modules/@elapse/react/package.json').version; console.log('@elapse/react', v)"

say "Step 5 (setup): an HTTP endpoint at the example's webhook URL"
EP="$(curl -sf "$API/v1/webhook_endpoints" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
  -d "{\"url\":\"http://localhost:$EX_PORT/webhooks\",\"events\":[\"*\"]}")"
EP_ID="$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$EP")"
WHSEC="$(node -e "console.log(JSON.parse(process.argv[1]).secret)" "$EP")"
[ -n "$EP_ID" ] && [ -n "$WHSEC" ] || { echo "endpoint create failed: $EP"; exit 1; }

say "Steps 3–4: npm start bundles the page, creates the Product and a checkout session"
(cd "$WORK/saas" && ELAPSE_SECRET_KEY="$SK" ELAPSE_PUBLISHABLE_KEY="$PK" ELAPSE_WEBHOOK_SECRET="$WHSEC" ELAPSE_API_URL="$API" PORT=$EX_PORT BASE_URL=http://localhost:$EX_PORT LOG_JSON=0 \
  exec npm start > "$WORK/saas.log" 2>&1) & PIDS+=($!)
for i in $(seq 1 30); do grep -q "Listening on :$EX_PORT" "$WORK/saas.log" && break; sleep 1; done
grep -q "^Product:  prod_" "$WORK/saas.log" || { cat "$WORK/saas.log"; echo "no Product line"; exit 1; }
grep -q "^Session:  cs_" "$WORK/saas.log" || { cat "$WORK/saas.log"; echo "no Session line"; exit 1; }
grep "^Product:\|^Session:" "$WORK/saas.log"

# FR-EXM-032: the product page authorises in place — the bundle is served and nothing links to /c/.
PAGE="$(curl -sf "http://localhost:$EX_PORT/")"
echo "$PAGE" | grep -q 'src="/web.js"' || { echo "$PAGE" | head -40; echo "the page does not load its bundle"; exit 1; }
! echo "$PAGE" | grep -q "/c/cs_" || { echo "the page still links to a hosted checkout"; exit 1; }
curl -sf "http://localhost:$EX_PORT/web.js" > /dev/null || { echo "the page bundle is not served"; exit 1; }

say "Step 5: a signed delivery through the worker, verified by the example"
curl -sf -X POST "$API/v1/webhook_endpoints/$EP_ID/test" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
  -d '{"type":"subscription.canceled"}' > /dev/null
for i in $(seq 1 60); do grep -q "revoke access" "$WORK/saas.log" && break; sleep 1; done
grep "revoke access" "$WORK/saas.log" || { echo "--- example"; cat "$WORK/saas.log"; echo "--- worker"; cat "$WORK/worker.log"; echo "no delivery reached the example"; exit 1; }

say "Step 6: demo:check"
(cd "$WORK/saas" && ELAPSE_WEBHOOK_SECRET="$WHSEC" BASE_URL=http://localhost:$EX_PORT npm run --silent demo:check)

say "Quickstart passed."
