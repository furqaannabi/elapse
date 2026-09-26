#!/usr/bin/env bash
# FR-EXM-151: the Elapse half of examples/lambda against a local platform, exactly as a judge
# would run it from a clone — but with the runner mocked, so AWS is never called and no chain
# is touched.
#
#   1  a test secret key
#   2  a copy of examples/lambda outside the workspace, installed from npm
#   3  npm start creates the Product and names the runner (and opens NO checkout session)
#   4  a delivered subscription.created opens the session
#   5  POST /run executes on the mock runner while the session is open
#   6  a delivered subscription.canceled closes it, and the next /run asks to start again
#   7  demo:check
#
# Needs: bun, node 20+, a Postgres at $DATABASE_URL, and the repo root as cwd.
set -euo pipefail

ROOT="$(pwd)"
export DATABASE_URL="${DATABASE_URL:-postgres://elapse:elapse@localhost:55434/elapse_ci}"
export WEBHOOK_SECRET_KEK="${WEBHOOK_SECRET_KEK:-a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=}"
export INGEST_TOKEN="${INGEST_TOKEN:-ci-ingest-token}"
export NODE_ENV=ci
export KEEPER=0
export PORT="${API_PORT:-4000}"
API="http://localhost:$PORT"
EX_PORT="${EXAMPLE_PORT:-3002}"
SUB="sub_test00000000000"   # the id the platform's test delivery carries (api sample-objects)
WORK="$(mktemp -d)"
PIDS=()
trap 'kill "${PIDS[@]}" 2>/dev/null || true' EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
dump() { echo "--- example"; cat "$WORK/lambda.log" 2>/dev/null || true; echo "--- worker"; cat "$WORK/worker.log" 2>/dev/null || true; }

say "Platform: migrate, start API and worker"
(cd api && bun run migrate)
(cd api && exec bun src/index.ts > "$WORK/api.log" 2>&1) & PIDS+=($!)
(cd api && exec bun src/worker/index.ts > "$WORK/worker.log" 2>&1) & PIDS+=($!)
for _ in $(seq 1 30); do curl -sf "$API/v1/status" > /dev/null && break; sleep 1; done
curl -sf "$API/v1/status" > /dev/null || { cat "$WORK/api.log"; echo "API did not start"; exit 1; }

say "Step 1: a test secret key and its publishable key"
SEED="$(cd api && bun run seed-merchant "lambda-ci-$(date +%s)@example.com")"
SK="$(echo "$SEED" | awk '/^sk_test/{print $2}')"
PK="$(echo "$SEED" | awk '/^pk_test/{print $2}')"
[ -n "$SK" ] && [ -n "$PK" ] || { echo "no keys from seed-merchant: $SEED"; exit 1; }

say "Step 2: a copy of examples/lambda outside the workspace, installed like a clone would"
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
cp -R "$ROOT/examples/lambda" "$WORK/lambda"
rm -rf "$WORK/lambda/node_modules" "$WORK/lambda/.env" "$WORK/lambda/dist"
node -e '
  const fs = require("fs"), p = process.argv[1] + "/package.json";
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  pkg.dependencies["@elapse/sdk"] = "file:" + process.argv[2];
  pkg.dependencies["@elapse/react"] = "file:" + process.argv[3];
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
' "$WORK/lambda" "$SDK_TGZ" "$RCT_TGZ"
(cd "$WORK/lambda" && npm install --silent --no-audit --no-fund)

say "Step 2b: a webhook endpoint pointing at the example"
EP="$(curl -sf "$API/v1/webhook_endpoints" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
  -d "{\"url\":\"http://localhost:$EX_PORT/webhooks\",\"events\":[\"*\"]}")"
EP_ID="$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$EP")"
WHSEC="$(node -e "console.log(JSON.parse(process.argv[1]).secret)" "$EP")"
[ -n "$EP_ID" ] && [ -n "$WHSEC" ] || { echo "endpoint create failed: $EP"; exit 1; }

say "Step 3: npm start bundles the console, creates the Product and names the runner"
(cd "$WORK/lambda" && ELAPSE_SECRET_KEY="$SK" ELAPSE_PUBLISHABLE_KEY="$PK" ELAPSE_WEBHOOK_SECRET="$WHSEC" ELAPSE_API_URL="$API" \
  PORT=$EX_PORT BASE_URL="http://localhost:$EX_PORT" LAMBDA_FN=ci-mock-runner AWS_REGION=us-east-1 \
  LAMBDA_RUNNER_MODE=mock LOG_JSON=0 \
  exec npm start > "$WORK/lambda.log" 2>&1) & PIDS+=($!)
for _ in $(seq 1 30); do grep -q "Listening on :$EX_PORT" "$WORK/lambda.log" && break; sleep 1; done
grep -q "^Product:  prod_" "$WORK/lambda.log" || { dump; echo "no Product line"; exit 1; }
grep -q "^Runner:   ci-mock-runner @ us-east-1" "$WORK/lambda.log" || { dump; echo "no Runner line"; exit 1; }
# FR-EXM-114: nothing is handed out at boot, because there is no Start button.
! grep -q "^Checkout:" "$WORK/lambda.log" || { dump; echo "boot opened a checkout session; it should not"; exit 1; }
grep "^Product:\|^Runner:" "$WORK/lambda.log"

# FR-EXM-152: the console is bundled and served, authorises in place, and carries no secret key.
CONSOLE="$(curl -sf "http://localhost:$EX_PORT/console")"
# Relative on purpose (FR-EXM-159): /console and /lambda/console must each find their own bundle.
echo "$CONSOLE" | grep -q 'src="web.js"' || { dump; echo "the console does not load its bundle"; exit 1; }
curl -sf "http://localhost:$EX_PORT/web.js" > /dev/null || { dump; echo "the console bundle is not served"; exit 1; }
echo "$CONSOLE" | grep -q "data-publishable-key=\"pk_test" || { dump; echo "the console has no publishable key"; exit 1; }
! echo "$CONSOLE" | grep -q "sk_test" || { dump; echo "a secret key reached the page"; exit 1; }
! echo "$CONSOLE" | grep -q "/c/" || { dump; echo "the console still links to a hosted checkout"; exit 1; }
curl -sf "http://localhost:$EX_PORT/web.js" > /dev/null || { dump; echo "the console bundle is not served"; exit 1; }

say "Step 4: a delivered subscription.created opens the session"
curl -sf -X POST "$API/v1/webhook_endpoints/$EP_ID/test" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
  -d '{"type":"subscription.created"}' > /dev/null
for _ in $(seq 1 60); do grep -q "session open $SUB" "$WORK/lambda.log" && break; sleep 1; done
grep -q "session open $SUB" "$WORK/lambda.log" || { dump; echo "no delivery reached the example"; exit 1; }

say "Step 5: POST /run executes on the mock runner while the session is open"
RUN="$(curl -sf -X POST "http://localhost:$EX_PORT/run?sub=$SUB" -H "Content-Type: application/json" -d '{"code":"return 2+2"}')"
node -e 'const b=JSON.parse(process.argv[1]); if(!b.ok) { console.error("run failed", b); process.exit(1);} console.log("ran ->", b.result)' "$RUN"

say "Step 6: a delivered subscription.canceled closes it, and the next run asks to start again"
curl -sf -X POST "$API/v1/webhook_endpoints/$EP_ID/test" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
  -d '{"type":"subscription.canceled"}' > /dev/null
for _ in $(seq 1 60); do grep -q "session closed" "$WORK/lambda.log" && break; sleep 1; done
grep -q "session closed" "$WORK/lambda.log" || { dump; echo "the canceled delivery did not close the session"; exit 1; }
CODE="$(curl -s -o "$WORK/after.json" -w '%{http_code}' -X POST "http://localhost:$EX_PORT/run?sub=$SUB" -H "Content-Type: application/json" -d '{"code":"return 1"}')"
[ "$CODE" = "409" ] || { dump; echo "expected 409 needs_start after the session closed, got $CODE: $(cat "$WORK/after.json")"; exit 1; }
node -e 'const b=require("fs").readFileSync(process.argv[1],"utf8"); if(!JSON.parse(b).needs_start) { console.error("no needs_start:", b); process.exit(1);} console.log("closed -> needs_start")' "$WORK/after.json"

say "Step 7: demo:check"
(cd "$WORK/lambda" && ELAPSE_WEBHOOK_SECRET="$WHSEC" BASE_URL="http://localhost:$EX_PORT" npm run --silent demo:check)

say "OK: session opened by webhook, ran on the mock runner, closed by webhook, and refuses to run after."
