# Northwind Compute — per-second serverless billing on real AWS Lambda

## What this is

A merchant that rents you a **live compute session**. You write JavaScript, press Run, and it
executes on a real AWS Lambda. You pay for the seconds your session is **open** — not per
invocation — and the session **starts and ends by itself**: your first Run opens it, and it
closes when you walk away, go idle, or hit the cap.

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
14:02:19  ▶ run sub_…  return 2 + 2  → 4  (9ms)   [1/20 today]
14:03:20  ⏹ auto-ended (idle) sub_…
14:03:21  evt_…  subscription.canceled  → session closed · 62s · $0.12
14:03:25  ▶ run sub_…  → 409 needs_start
```

The console is a React page with the **VS Code editor** (Monaco) holding the JavaScript, the
runner's own source read-only beneath it, and the result as output — rendered as an image when
the code returns a `data:image` string, printed as a value otherwise. There is no Start button
and no Stop button: press Run, and the first one shows `<Authorize>` from
[`@elapse/react`](../../sdk/react) **in this page** — one Face ID in a window Elapse opens — then
your code runs and `<Meter>` ticks beside it. Nobody is sent to a hosted checkout. Close the tab
and the session ends within seconds. `npm start` bundles the page with esbuild first; Monaco
still loads from a pinned CDN, and if that CDN is unreachable the editor falls back to a plain
textarea.

## How the session maps to Elapse

| What happens | Elapse |
| --- | --- |
| First Run, no session | `checkout.sessions.create` with `max_duration_seconds`; the server answers `409 needs_start` with the session id, and `<Authorize>` appears in the page |
| Subscriber authorises once | the permit is signed for `rate × max_duration_seconds` — the most this session can ever cost. Nothing is accruing yet: the Product is **merchant-started** |
| The meter starts | the first Run calls `subscriptions.start`; nothing is invoked until `subscription.updated` says `active`, so the seconds you spent editing are free. If the start does not confirm within 30 s the session is cancelled and refunded in full |
| Each run | `subscriptions.resume` before the invocation and `subscriptions.pause` the moment it returns, so you pay for the seconds your code runs plus the confirmation either side — roughly 1–3 s, not the minutes you spend reading the output |
| Tab closed, idle, or gone | the server calls `subscriptions.cancel` itself, retried a few times if it fails |
| Meter stops | `subscription.canceled` → the session closes and the exact settled amount is recorded |
| Next Run | `409 needs_start` again — a new session, because the webhook closed the old one |

`<Meter>` ticks while your code runs and stops between runs; the figure it shows when the session
ends is the **settled** amount, not the estimate. The meter is on chain, so the smallest thing it
can bill is a confirmation, not a millisecond: a 0 ms Lambda call costs about one to three
seconds of meter.

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
src/session.ts     sessions, evt_ dedupe, the daily cap, and the auto-end decision
src/webhooks.ts    verify → 2xx → act (the part worth copying)
src/server.ts      routes: / /console /cancel /run /heartbeat /end /access /session /runner-source /webhooks
src/boot.ts        product, wiring, the auto-end sweep
public/            the merchant's own look (see DESIGN.md); console = React + Monaco from CDN
```

## Teardown

```sh
aws lambda delete-function --function-name elapse-lambda-runner --region us-east-1
aws iam detach-role-policy --role-name elapse-lambda-runner-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name elapse-lambda-runner-role
```
