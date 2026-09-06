#!/usr/bin/env bash
# FR-DOC-012 / FR-EXM-031: run the Quickstart's steps 2–6 against a local
# platform, exactly as a judge would from a clone, and fail if any step lies.
#
#   2  npm install @elapse/sdk (from npm, in a copy of examples/saas outside the workspace)
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

say "Step 1: a test secret key"
SK="$(cd api && bun run seed-merchant "ci-$(date +%s)@example.com" | awk '/^sk_test/{print $2}')"
[ -n "$SK" ] || { echo "no key from seed-merchant"; exit 1; }

say "Step 2: a copy of examples/saas outside the workspace, installed from npm"
cp -R "$ROOT/examples/saas" "$WORK/saas"
rm -rf "$WORK/saas/node_modules" "$WORK/saas/.env"
(cd "$WORK/saas" && npm install --silent --no-audit --no-fund)
node -e "const v=require('$WORK/saas/node_modules/@elapse/sdk/package.json').version; console.log('@elapse/sdk', v)"

say "Step 5 (setup): an HTTP endpoint at the example's webhook URL"
EP="$(curl -sf "$API/v1/webhook_endpoints" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
  -d "{\"url\":\"http://localhost:$EX_PORT/webhooks\",\"events\":[\"*\"]}")"
EP_ID="$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$EP")"
WHSEC="$(node -e "console.log(JSON.parse(process.argv[1]).secret)" "$EP")"
[ -n "$EP_ID" ] && [ -n "$WHSEC" ] || { echo "endpoint create failed: $EP"; exit 1; }

say "Steps 3–4: npm start creates the Product and a Checkout session"
(cd "$WORK/saas" && ELAPSE_SECRET_KEY="$SK" ELAPSE_WEBHOOK_SECRET="$WHSEC" ELAPSE_API_URL="$API" PORT=$EX_PORT BASE_URL=http://localhost:$EX_PORT LOG_JSON=0 \
  exec npm start > "$WORK/saas.log" 2>&1) & PIDS+=($!)
for i in $(seq 1 30); do grep -q "Listening on :$EX_PORT" "$WORK/saas.log" && break; sleep 1; done
grep -q "^Product:  prod_" "$WORK/saas.log" || { cat "$WORK/saas.log"; echo "no Product line"; exit 1; }
grep -q "^Checkout: http" "$WORK/saas.log" || { cat "$WORK/saas.log"; echo "no Checkout line"; exit 1; }
grep "^Product:\|^Checkout:" "$WORK/saas.log"

say "Step 5: a signed delivery through the worker, verified by the example"
curl -sf -X POST "$API/v1/webhook_endpoints/$EP_ID/test" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
  -d '{"type":"subscription.canceled"}' > /dev/null
for i in $(seq 1 60); do grep -q "revoke access" "$WORK/saas.log" && break; sleep 1; done
grep "revoke access" "$WORK/saas.log" || { echo "--- example"; cat "$WORK/saas.log"; echo "--- worker"; cat "$WORK/worker.log"; echo "no delivery reached the example"; exit 1; }

say "Step 6: demo:check"
(cd "$WORK/saas" && ELAPSE_WEBHOOK_SECRET="$WHSEC" BASE_URL=http://localhost:$EX_PORT npm run --silent demo:check)

say "Quickstart passed."
