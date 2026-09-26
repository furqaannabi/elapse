# Northwind Compute — per-second serverless billing on real AWS Lambda

## What this is

A merchant that rents you **compute by the second**. You write JavaScript, press Run, and it
executes on a real AWS Lambda. **Each Run opens a meter and closes it the moment your code
returns** ([ADR 2026-09-26](../../docs/decisions/2026-09-26-lambda-session-ends-with-its-run.md)):
you pay for the seconds your code runs — if it runs for 30 seconds you pay 30 seconds — and the
unspent part of your deposit comes back. The next Run opens a fresh meter, with a fresh Face ID.

**Try it live:** <https://examples.elapse.finance/lambda/> — test mode on Monad testnet, nothing real is charged.

Anything JavaScript can do works: `fetch` calls, sorting, `require("node:crypto")`, async. The
editor opens on a hello-world, so the first Run is immediate. For something that actually burns
compute, paste `MANDELBROT_SNIPPET` from `runner/snippet.mjs`: it renders a tile, and asking for
more pixels or more iterations costs more Lambda seconds — which is what makes the per-second
meter legible.

It is the advanced Elapse example. Unlike [`examples/saas`](../saas), which you clone and run
with two keys, this one needs an AWS account and a deployed runner
([ADR 2026-09-12](../../docs/decisions/2026-09-12-examples-lambda-aws-only.md)).

Two clocks, never confused:

| | pays | for |
| --- | --- | --- |
| Subscriber → merchant | Elapse, per second | the seconds the session was open |
| Merchant → AWS | Lambda, per millisecond | the renders actually run |

The gap between them is the merchant's margin.

## Prerequisites

- Node 20 or newer.
- An Elapse dashboard account with a **test secret key** and a **payout address** (without one,
  no Checkout session can be created and the first Run will say so).
- An **AWS account** with credentials on the standard chain (`aws configure`, `AWS_PROFILE`, or
  environment). They are never read from `.env`.
- The AWS CLI, for the one-time provisioning below.

## Provision the runner

Two resources, once. The runner **executes the JavaScript you send it**, so its role is given
nothing beyond writing its own logs — that role is the boundary, and it matters.

```sh
# 1. A role only Lambda can assume, with logs-only access and no other AWS permissions.
cat > trust.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON

aws iam create-role --role-name elapse-lambda-runner-role \
  --assume-role-policy-document file://trust.json \
  --description "Elapse example Lambda runner: logs only, no other AWS access"

aws iam attach-role-policy --role-name elapse-lambda-runner-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# 2. The function. 1024MB is not about memory — Lambda scales CPU with it, and this workload
#    is CPU-bound, so a smaller setting mostly just makes renders slower and bills longer.
cd runner && zip -j ../runner.zip index.mjs && cd ..

aws lambda create-function \
  --function-name elapse-lambda-runner \
  --runtime nodejs20.x --handler index.handler \
  --role "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/elapse-lambda-runner-role" \
  --zip-file fileb://runner.zip \
  --timeout 10 --memory-size 1024 \
  --region us-east-1
```

Already have an older runner deployed? Update it in place:

```sh
cd runner && zip -j ../runner.zip index.mjs && cd ..
aws lambda update-function-code --function-name elapse-lambda-runner \
  --zip-file fileb://runner.zip --region us-east-1
aws lambda update-function-configuration --function-name elapse-lambda-runner \
  --timeout 10 --memory-size 1024 --region us-east-1
```

Confirm it executes before going further:

```sh
aws lambda invoke --function-name elapse-lambda-runner --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"code":"return 2 + 2"}' /dev/stdout
# {"ok":true,"result":4,"ms":…,"logs":[]}
```

Real invocations show up in CloudWatch Logs as Lambda's own `START` / `END` / `REPORT` lines —
useful to watch during a demo. Nothing in the billing path depends on CloudWatch.

## Run it

```sh
cp .env.example .env      # paste ELAPSE_SECRET_KEY and ELAPSE_PUBLISHABLE_KEY, set LAMBDA_FN and AWS_REGION
npm install
npm start
```

In a second terminal, forward webhooks to this server. The first line it prints is your signing
secret; put it in `.env` as `ELAPSE_WEBHOOK_SECRET` and restart:

```sh
npx @elapse/cli listen --forward localhost:3000/webhooks
```

Then open <http://localhost:3000>.

## What you will see

```
Product:  prod_…  Serverless runtime  $0.002/s
Webhooks: POST http://localhost:3000/webhooks
Runner:   elapse-lambda-runner @ us-east-1

14:02:09  evt_…  checkout.session.completed → provision session
14:02:11  evt_…  subscription.created   → session authorised sub_…
14:02:12  ▶ starting meter sub_…
14:02:13  evt_…  subscription.updated   → meter started sub_…
14:02:43  ⏹ ended (run finished) sub_…
14:02:43  ▶ run sub_…  30 s of hashing  → {"seconds":30,…}  (30012ms)   [1/20 today]
14:02:45  evt_…  subscription.canceled  → session closed · 32s · $0.064
14:03:10  (next Run: 409 needs_start — a new session, a fresh authorisation)
```

The console is a React page with the **VS Code editor** (Monaco) holding the JavaScript, the
runner's own source read-only beneath it, and the result as output — rendered as an image when
the code returns a `data:image` string, printed as a value otherwise. There is no Start button:
press Run, and the first one shows `<Authorize>` from [`@elapse/react`](../../sdk/react) **in this
page** — one signature, in a window Elapse opens ([ADR 2026-09-20](../../docs/decisions/2026-09-20-authorise-in-a-window-only.md)) — then your code runs and
`<Meter>` ticks in a card that sticks to the bottom of the viewport, in Northwind's colours.
When the meter starts and when it ends, a card drops in with that transaction (`proof`), since
this console is read by developers. Nobody is sent to a hosted checkout.

There is nothing to press but Run. The meter is Northwind's to stop (`canStop` stays false,
FR-CHK-037), and Northwind stops it itself the moment your code returns, whether it returned a
value or threw. Closing the tab mid-run ends it within seconds too. That last one is **Northwind's
policy for a compute product, not a rule of Elapse's billing**: a subscription meant to outlive
the tab simply never calls cancel.

`npm start` bundles the page with esbuild first; Monaco still loads from a pinned CDN, and if that
CDN is unreachable the editor falls back to a plain textarea.

## How the session maps to Elapse

| What happens | Elapse |
| --- | --- |
| First Run, no session | `checkout.sessions.create` with `max_duration_seconds`; the server answers `409 needs_start` with the session id, and `<Authorize>` appears in the page |
| Subscriber authorises once | the permit is signed for `rate × max_duration_seconds` — the most this session can ever cost. Nothing is accruing yet: the Product is **merchant-started** |
| The meter starts | the first Run calls `subscriptions.start`; nothing is invoked until `subscription.updated` says `active`, so the seconds you spent editing are free. If the start does not confirm within 30 s the session is cancelled and refunded in full |
| The code returns, or throws | the run ends the session: `subscriptions.cancel` before the Run is answered, so you pay for the seconds your code ran plus a confirmation either side |
| A session still open after `IDLE_TIMEOUT_SECONDS` | left over from a run that did not finish cleanly: the sweep ends it and the escrow comes back. Nothing is ever paused |
| Tab closed, or the heartbeat goes stale | the server calls `subscriptions.cancel` itself, retried a few times if it fails |
| Meter stops | `subscription.canceled` → the session closes and the exact settled amount is recorded |
| Next Run | `409 needs_start` — a new session, because the webhook closed the old one |

`<Meter>` ticks while your code runs; the figure it shows when the session ends is the
**settled** amount, not the estimate. The meter is on chain, so its edges cost a confirmation
each: about one to three seconds between pressing Run and the first billable second, and the same
again at the end — so a 30-second run settles for roughly 32.

## Security

Read this before pointing anyone else at it.

- The runner **executes arbitrary JavaScript you submit**, inside AWS Lambda's per-invocation
  microVM. That is the product, not an accident.
- **Outbound network access is deliberate.** `fetch` works from inside submitted code. That is a
  capability this example intends to offer, so treat the runner as able to reach the internet.
- What holds the line is the execution role: it carries **logs-only** access and nothing else, so
  submitted code cannot reach any other AWS service in your account.
- A Lambda outside a VPC keeps that outbound access, and `new Function` is not a security
  sandbox. This is a **demo runner, not a hardened sandbox for hostile users**. Do not expose it
  publicly as-is. If you need isolation from the network, put the function in a VPC with no NAT.
- Cost guards, in order: a hard **20 executions per UTC day** (`DAILY_RUN_LIMIT`), checked before
  any AWS call; the **10s timeout**, which also bounds a runaway loop; and your account's
  concurrency ceiling. Worst case ≈ 20 × 10s × 1024MB ≈ **205 GB-s per day**, comfortably inside
  the 400,000 GB-s monthly free tier.
- A session's maximum charge is `rate × MAX_DURATION_SECONDS` — by default 1 hour, about
  **$7.20** — enforced on-chain even if the server dies and every auto-end path fails.
- AWS credentials come from the standard SDK chain, never from `.env`, and are never logged.
- Webhook signatures are verified before the payload is parsed; an unverified delivery is a 400.

## Files

```
runner/index.mjs   the deployed Lambda: runs submitted JS, with require() for node builtins
runner/snippet.mjs what the editor opens on (hello world) plus the heavier Mandelbrot example
runner/index.d.mts its contract, so the tests typecheck against it
src/config.ts      env, with a readable error naming anything missing
src/executor.ts    run(input) — the real AWS runner, and a mock used only by tests/CI
src/session.ts     sessions, evt_ dedupe, the daily cap, and the sweep's pause/end decision
src/claim.ts       claimVerdict: whether a console may claim a session the webhook has not
                   announced yet, so a Run is never lost to a late delivery (ADR 2026-09-22)
src/webhooks.ts    verify → 2xx → act (the part worth copying)
src/server.ts      routes: / /console /cancel /run /claim /heartbeat /pause /resume /end
                   /access/:sub /session/:sub /runner-source /default-snippet /webhooks
src/boot.ts        product, wiring, the idle/abandoned sweep, and boot reconciliation
src/index.ts       npm start: reads .env, boots, prints
src/demo-check.ts  npm run demo:check
public/            the merchant's own look (see DESIGN.md); console = React + @elapse/react, bundled by esbuild; Monaco from a pinned CDN
```

## Teardown

```sh
aws lambda delete-function --function-name elapse-lambda-runner --region us-east-1
aws iam detach-role-policy --role-name elapse-lambda-runner-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name elapse-lambda-runner-role
```
