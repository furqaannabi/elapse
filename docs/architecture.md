# Architecture

How Elapse fits together. Product truth is in `elapse-detailed-document.pdf` §9; this page turns it into the picture a new engineer needs.

## The shape

```
 Subscriber (phone)                      Merchant server
      │                                        │
      │ opens session.url                      │ npm i @elapse/sdk
      ▼                                        ▼
 ┌──────────────┐                       ┌──────────────┐
 │ Hosted       │                       │ @elapse/sdk  │  products.create
 │ Checkout     │                       │              │  checkout.sessions.create
 │ (web/)       │                       │              │  webhooks.constructEvent
 └──────┬───────┘                       └──────┬───────┘
        │ Privy sign-in, fund, start, cancel   │ Bearer sk_…
        ▼                                      ▼
 ┌───────────────────────────────────────────────────────┐
 │ Platform API (api/)  ·  Postgres                      │
 │ merchants · keys · products · customers · sessions ·  │
 │ subscriptions · invoices · webhook endpoints ·        │
 │ events · deliveries                                   │
 └───────┬───────────────────────────────────┬───────────┘
         │ viem (relayer pays gas)           │ enqueue delivery jobs
         ▼                                   ▼
 ┌──────────────────┐               ┌──────────────────┐
 │ StreamFactory →  │               │ Webhook worker   │──POST signed JSON──▶ merchant webhook_url
 │ AccrualStream    │               │ (worker/)        │   retry 0s,30s,2m,10m,1h · cap 8
 │ (contracts/)     │               └──────────────────┘
 │ Monad 143/10143  │                        ▲
 └────────┬─────────┘                        │ Event rows
          │ StreamCreated/Started/Paused/    │
          │ Canceled/Settled                 │
          ▼                                  │
 ┌──────────────────┐   Effect API           │
 │ Envio HyperIndex │──POST /ingest──────────┘  (idempotent on txHash+logIndex;
 │ (indexer/)       │                             indexer never holds merchant secrets)
 └──────────────────┘
```

## The one flow that matters (the demo)

1. Merchant calls `products.create({ rateUsdPerSecond: "0.004" })` → `prod_…`.
2. Merchant calls `checkout.sessions.create({ product, successUrl, cancelUrl })` → `cs_…` with `session.url`.
3. Subscriber opens `session.url` on a phone. Privy Face ID creates or restores their embedded wallet (they never see it). They add funds (AUSD into per-subscription escrow; a relayer pays gas). They press **Start**.
4. API calls `StreamFactory.create(...)` and `start()`. Contract emits `StreamCreated`, `StreamStarted`. Indexer ingests → API writes `subscription.created` (and earlier `checkout.session.completed`) → worker delivers.
5. The checkout ticks from `rate × (now − started_at)`. **No transaction per second. No webhook per second.**
6. Subscriber presses **Cancel** at 83 s. API calls `cancel()`. Contract settles 83 × rate to the merchant, refunds the rest to the subscriber, emits `StreamCanceled(83, amount)` and `Settled`. Indexer → API → `subscription.canceled` with `seconds_elapsed: 83`, `amount_settled: "0.33"` → worker → merchant's server revokes access.
7. Keeper calls `settle()` every K seconds on long-running meters → `invoice.settled`. If escrow is empty → stream pauses → `invoice.payment_failed`.

## Trust boundaries

| Boundary | Rule |
| --- | --- |
| Merchant secret key | Server-side only. Never in the checkout page, never in the indexer. |
| Subscriber wallet | Privy embedded; the subscriber never sees an address, gas, or a seed phrase. |
| Indexer → API | Indexer posts to **our** ingest URL with a shared secret; it never knows merchant webhook URLs or `whsec_`. |
| API → merchant | Signed `X-Elapse-Signature: t=…,v1=…` over `{t}.{raw_body}`, verified by `constructEvent` with constant-time compare and a 300 s window. |
| Money | Only the contract moves AUSD. The API never custodies funds. Settled ≤ accrued ≤ deposited, always. |

## Locked decisions (from the doc)

- Protocol + developer platform, not a consumer app. Merchants learn nothing new.
- SDK surface frozen at §4.2. Nothing outside it exists.
- Lifecycle webhooks only; never per-second.
- Per-subscription escrow; cancel refunds unspent. Customer-balance model is later.
- Batched `settle()` by keeper; UI ticks from rate math.
- Privy for subscribers. Mera revisited after submission.
- Postgres queue + worker for deliveries. No Kafka.
- Envio HyperIndex + Effect API as the stream → event ingest.
- AUSD, displayed as USD, not yield-bearing. Gas sponsored.
- Monorepo, pnpm. Docs deploy separately from the app.
- Backend runtime: **Bun + Hono** for `api/` and `worker/`; **Foundry** for `contracts/` (Furqaan, 2026-09-03).

## Undecided (human)

- Merchant auth: magic link vs passkey.
- Deployment targets for API, worker, keeper, and web.
- CLI transport for `listen`.
- Whether Customers/Invoices dashboard pages and subscriber `/account` ship by 13 Oct.

Each of these is also recorded in the relevant FRD under `specs/`.
