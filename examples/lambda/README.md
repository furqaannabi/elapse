# Northwind Compute — per-second serverless billing on real AWS Lambda

## What this is

A merchant that rents you **compute by the second**. You write JavaScript, press Run, and it
executes on a real AWS Lambda. **Run opens the meter, and it stays open until you end it**
([ADR 2026-09-21](../../docs/decisions/2026-09-21-the-lambda-meter-runs-until-you-end-it.md)):
edit, run again, read the output, pause while you think. Press **End session** and you pay for
the seconds it was open — press it at 83 seconds and you pay 83 seconds — with the unspent part
of your deposit refunded.

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
14:02:44  ▶ run sub_…  return crypto.randomUUID()  → "5f2…"  (3ms)   [2/20 today]
14:03:48  ⏸ auto-paused (idle) sub_…
14:04:10  ▶ resumed (asked) sub_…
14:04:31  ⏹ auto-ended (left) sub_…
14:04:33  evt_…  subscription.canceled  → session closed · 121s · $0.242
14:04:40  ▶ run sub_…  → 409 needs_start   (a new session, a fresh authorisation)
```

The console is a React page with the **VS Code editor** (Monaco) holding the JavaScript, the
runner's own source read-only beneath it, and the result as output — rendered as an image when
the code returns a `data:image` string, printed as a value otherwise. There is no Start button:
press Run, and the first one shows `<Authorize>` from [`@elapse/react`](../../sdk/react) **in this
page** — one signature, in a frame Elapse opens over the console — then your code runs and
`<Meter>` ticks in a card that sticks to the bottom of the viewport, in Northwind's colours.
When the meter starts and when it ends, a card drops in with that transaction (`proof`), since
this console is read by developers. Nobody is sent to a hosted checkout.

The controls divide the way the ownership does. **End session** is Northwind's own, beside Run,
because a merchant-started meter is the merchant's to stop (`canStop` stays false, FR-CHK-037).
**Pause** and **Resume** are `<Meter>`'s: the subscriber asks, and Northwind is what calls Elapse.
Leave the console alone for `IDLE_TIMEOUT_SECONDS` (60) and Northwind pauses the meter for you and
says why — paused seconds are never billed, so walking away costs you a minute. A session left
paused for `PAUSED_END_SECONDS` (600) is ended and refunded, and closing the tab ends it within
seconds. That last one is **Northwind's policy for a compute product, not a rule of Elapse's
billing**: a subscription meant to outlive the tab simply never calls cancel.

`npm start` bundles the page with esbuild first; Monaco still loads from a pinned CDN, and if that
CDN is unreachable the editor falls back to a plain textarea.

## How the session maps to Elapse

| What happens | Elapse |
| --- | --- |
| First Run, no session | `checkout.sessions.create` with `max_duration_seconds`; the server answers `409 needs_start` with the session id, and `<Authorize>` appears in the page |
| Subscriber authorises once | the permit is signed for `rate × max_duration_seconds` — the most this session can ever cost. Nothing is accruing yet: the Product is **merchant-started** |
| The meter starts | the first Run calls `subscriptions.start`; nothing is invoked until `subscription.updated` says `active`, so the seconds you spent editing are free. If the start does not confirm within 30 s the session is cancelled and refunded in full |
| Each later run | nothing to authorise and nothing to start: the meter is already open, so the run is simply invoked. One authorisation covers every Run in the session |
| Subscriber asks to pause or resume | `<Meter>`'s Pause and Resume post to Northwind's own `/pause` and `/resume`, which call `subscriptions.pause` / `subscriptions.resume`. Nothing is signed and nothing goes to Elapse from the page |
| Idle for `IDLE_TIMEOUT_SECONDS` | the sweep pauses the meter through `subscriptions.pause` and the console says why. Paused seconds are never billed |
| Paused for `PAUSED_END_SECONDS` | the sweep treats the session as abandoned and ends it |
| Subscriber presses End session | `subscriptions.cancel`, through Northwind's `/end` |
| Tab closed, or the heartbeat goes stale | the server calls `subscriptions.cancel` itself, retried a few times if it fails |
| Meter stops | `subscription.canceled` → the session closes and the exact settled amount is recorded |
| Next Run | `409 needs_start` — a new session, because the webhook closed the old one |

`<Meter>` ticks for as long as the session is open and freezes while it is paused; the figure it
shows when the session ends is the **settled** amount, not the estimate. The meter is on chain, so
its edges cost a confirmation each: about one to three seconds between pressing Run and the first
billable second, and the same again at the end. Everything between them is wall-clock — the
seconds you were open, whether Lambda was working or you were reading the output.

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
src/webhooks.ts    verify → 2xx → act (the part worth copying)
src/server.ts      routes: / /console /cancel /run /heartbeat /pause /resume /end /access /session /runner-source /webhooks
src/boot.ts        product, wiring, the idle/abandoned sweep
public/            the merchant's own look (see DESIGN.md); console = React + @elapse/react, bundled by esbuild; Monaco from a pinned CDN
```

## Teardown

```sh
aws lambda delete-function --function-name elapse-lambda-runner --region us-east-1
aws iam detach-role-policy --role-name elapse-lambda-runner-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name elapse-lambda-runner-role
```
