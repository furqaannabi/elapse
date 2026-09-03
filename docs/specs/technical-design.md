# Technical design — platform

Status: **Draft — awaiting human sign-off** · Scope: everything behind the SDK (API, data, auth, webhooks, chain integration, environments). Sources: detailed doc §3, §4.4, §5, §9, §13; `sdk/ts/src/index.ts`; `.env.example`.

This is the "how". The "what" lives in the per-surface FRDs. Where this page says **Undecided (human)**, the options are listed and nobody builds until one is chosen.

## 1. Services

| Service | Job | Runtime | State |
| --- | --- | --- | --- |
| `api/` | REST for merchants and the checkout; ingest for the indexer; enqueues deliveries; drives the contract via a relayer | **Bun + Hono** (decided 2026-09-03, Furqaan). OpenAPI via `@hono/zod-openapi`. Separate service from `web/`. | Postgres |
| `worker/` | Delivers webhooks from a Postgres queue with retries; runs the keeper loop for `settle()` | Bun, same codebase as `api/` (shared package), separate process | Postgres |
| `indexer/` | Envio HyperIndex on Monad; Effect API posts events to `api/` ingest | Envio hosted or self-hosted | Envio's store |
| `web/` | Landing, hosted checkout, merchant dashboard | Next.js 16, Vercel | none (calls `api/`) |
| `contracts/` | `StreamFactory`, `AccrualStream` | Foundry, Monad testnet 10143 → mainnet 143 | chain |

## 2. Data model (Postgres)

All ids are prefixed random strings (`prod_` + 14 base62). Money columns are `numeric(30,9)` USD (nano-dollar precision) and are converted to wei only at the chain boundary. Timestamps are `timestamptz`. Every table has `created_at`, `updated_at`, and `mode enum('test','live')`; test and live rows never mix in a query.

```
merchants          id, name, email, payout_address, checkout_branding jsonb
api_keys           id, merchant_id, mode, kind enum('publishable','secret'), prefix, hash (argon2), name, last_used_at, revoked_at
products           id, merchant_id, mode, name, description, rate_usd_per_second numeric, allow_pause bool, status enum('active','archived')
customers          id, merchant_id, mode, email, privy_user_id, wallet_address, default_payment
checkout_sessions  id, merchant_id, mode, product_id, customer_id?, status enum('open','complete','expired'), success_url, cancel_url, subscription_id?, expires_at
subscriptions      id, merchant_id, mode, product_id, customer_id, status enum('incomplete','active','paused','canceled'),
                   stream_address, rate_usd_per_second (snapshot), funded_usd, started_at, paused_at, canceled_at, settled_seconds, settled_usd
invoices           id, subscription_id, period_start, period_end, seconds, amount_usd, tx_hash, status enum('settled','failed')
webhook_endpoints  id, merchant_id, mode, url, secret_ciphertext (AES-GCM; worker must sign with it, so it cannot be hashed), secret_prefix, events text[], disabled_at, failure_count
events             id, merchant_id, mode, type, created, data jsonb, pending_webhooks int, source enum('api','chain'), tx_hash?, log_index?
deliveries         id, event_id, endpoint_id, attempt int, scheduled_at, delivered_at?, status_code?, response_excerpt, duration_ms, error?
chain_ingest_log   tx_hash, log_index, handled_at   -- PK (tx_hash, log_index): idempotency for the indexer
audit_log          id, merchant_id, actor, action, target, ip, created_at
```

Invariants (enforced in service code and tested):
- `settled_usd ≤ rate × settled_seconds ≤ funded_usd` per subscription.
- An `events` row is written exactly once per chain log (`chain_ingest_log` PK).
- `deliveries` for one event × endpoint never exceed 8 attempts.

## 3. API

Base `https://api.elapse.dev/v1`. JSON. Stripe conventions: `object` field on every resource, `id` prefixes, `created` unix seconds, list responses `{ object: "list", data: [], has_more }`, errors `{ error: { type, code, message, param? } }`.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST/GET | `/products`, `/products/:id` | `sk_` | `rate_usd_per_second` string, validated `^\d+(\.\d{1,9})?$` |
| POST | `/checkout/sessions` | `sk_` | returns `url` = `https://pay.elapse.dev/c/:id` |
| GET | `/checkout/sessions/:id` | `pk_` or session token | what the hosted checkout reads; never leaks merchant secrets |
| POST | `/checkout/sessions/:id/fund`, `/start`, `/cancel`, `/pause`, `/resume` | session token (Privy JWT) | subscriber actions from the hosted page |
| GET/POST | `/subscriptions/:id`, `/subscriptions/:id/cancel` | `sk_` | merchant-side |
| GET | `/customers/:id`, `/invoices?subscription=` | `sk_` | |
| CRUD | `/webhook_endpoints`, `…/:id/roll_secret`, `…/:id/test` | `sk_` | secret returned once on create/roll |
| GET | `/events`, `/events/:id`, `/events/:id/deliveries`, POST `…/deliveries/:id/resend` | `sk_` | dashboard delivery log |
| POST | `/ingest/chain` | `X-Ingest-Secret` | indexer only; body `{ tx_hash, log_index, event, args }` |
| POST | `/test_clocks`, `…/:id/advance` | `sk_test_` only | demo fast-forward |
| — | `/openapi.json` | public | generated from route schemas; published into the docs |

Auth: `Authorization: Bearer sk_test_…`. Keys are hashed at rest (argon2id); the prefix (`sk_test_4f2…`) is stored for display. `pk_` keys may only read checkout sessions. Idempotency: `Idempotency-Key` header on POSTs, 24 h window. Rate limits per key (Undecided: numbers). Every mutating call writes `audit_log`.

## 4. Chain integration

- The API holds the **relayer** key (`RELAYER_PRIVATE_KEY`) and is the only signer. It calls `StreamFactory.create`, `AccrualStream.start/pause/resume/cancel`, and the keeper calls `settle`.
- Subscriber funds: Privy embedded wallet signs an AUSD `approve` + `deposit` into the stream (gas sponsored). **Undecided (human):** paymaster mechanism on Monad (Privy gas sponsorship vs our relayer calling `depositFor`). Recommendation: relayer `depositFor` with a subscriber signature (EIP-2612 permit if AUSD supports it) so the UI never asks for gas.
- Event truth comes from the indexer, not from the API's own tx receipts: the API writes `subscription.*` events on ingest so what merchants receive is what the chain says.
- Reorg policy: Envio handles finality; ingest is idempotent, and an event already delivered is never retracted (Undecided: whether to emit a correction event; recommendation: none in MVP, Monad finality is fast).

## 5. Webhook pipeline

1. Event row created (`pending_webhooks` = number of subscribed, enabled endpoints).
2. One `deliveries` row per endpoint, `scheduled_at = now`.
3. Worker polls `deliveries WHERE delivered_at IS NULL AND scheduled_at <= now() FOR UPDATE SKIP LOCKED`.
4. Body = the event JSON exactly as stored (byte-stable; the signature is over these bytes). Headers: `Content-Type: application/json`, `X-Elapse-Signature: t=<unix>,v1=<hmac_sha256(secret, "<t>.<body>")>`, `X-Elapse-Event: evt_…`, `User-Agent: Elapse/1.0`.
5. 10 s timeout. 2xx → delivered. Otherwise schedule next attempt at +0 s, +30 s, +2 m, +10 m, +1 h (then hourly) until attempt 8, then mark failed and increment endpoint `failure_count`.
6. Dashboard shows attempts; **Resend** creates a fresh delivery row (attempt counter restarts, same event bytes).
7. Secret roll: new secret immediately signs; old secret remains valid for 24 h (Undecided: window) so merchants can rotate without a gap. The SDK verifies against the header it is given; multiple `v1=` values are allowed in the header during overlap.

The signing must round-trip with `sdk/ts/src/index.ts` `constructEvent` unchanged; that function is the contract.

## 6. Environments and config

| Var | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | api, worker | Postgres |
| `MONAD_RPC_URL`, `CHAIN_ID` | api, worker | 10143 testnet, 143 mainnet |
| `RELAYER_PRIVATE_KEY` | api, worker | never in web |
| `STREAM_FACTORY_ADDRESS`, `AUSD_ADDRESS` | api, worker, indexer, web (judge mode) | per chain |
| `INGEST_SECRET` | api, indexer | shared secret for `/ingest/chain` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | web | subscriber sign-in |
| `NEXT_PUBLIC_API_URL` | web | `https://api.elapse.dev` |
| `ELAPSE_SECRET_KEY`, `ELAPSE_WEBHOOK_SECRET` | examples, cli | a merchant's credentials |

Environments: `local` (docker Postgres, Anvil or Monad testnet), `testnet` (shared, used by the docs quickstart CI), `mainnet` (Week 5+). **Undecided (human):** hosting for api/worker (Fly.io, Railway, Render) and Postgres (Neon, Supabase, RDS). Recommendation for the hackathon: Railway for api + worker + Postgres in one project, Vercel for `web/`, Envio hosted for the indexer.

## 7. Security checklist (every PR)

- API secret keys hashed (argon2id); webhook signing secrets encrypted at rest (the worker needs the plaintext to sign); both shown once; `sk_` and `whsec_` never reach a browser.
- Webhook signature verified before parse in every consumer we ship (SDK, CLI, examples).
- Ingest idempotent; indexer holds no merchant secrets.
- Money math in integers (nano-dollars / wei); rates validated as decimal strings.
- Test/live separation in every query (`mode` column, key prefix).
- Audit log on key create/roll/revoke, endpoint changes, payout address changes, resends.
- No chain vocabulary in subscriber-facing responses.

## 8. Testing

| Layer | Tool | Must cover |
| --- | --- | --- |
| Contracts | Foundry | start/pause/resume/cancel/settle; refund; fuzz elapsed math; invariant settled ≤ accrued ≤ deposited |
| API | vitest + supertest against Postgres | every endpoint happy path + auth failures + idempotency replay + test/live isolation |
| Worker | vitest | signing round-trips with `constructEvent`; retry schedule; cap 8; dedupe; resend |
| Indexer | Envio test harness | each handler posts once per log; duplicate log ignored |
| End to end | Playwright + testnet | quickstart: product → session → start → cancel → webhook received (this is also the docs CI) |

## Undecided (human) — summary

1. ~~API framework~~ — decided: Bun + Hono (Furqaan, 2026-09-03).
2. Gas sponsorship mechanism for subscriber deposits.
3. Hosting for api/worker/Postgres.
4. Rate-limit numbers; secret-roll overlap window; endpoint auto-disable threshold.
5. Correction events on reorg (recommend none in MVP).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-03 | Furqaan (via William) | Bun + Hono decided for api/worker; Foundry for contracts ([ADR](../decisions/2026-09-03-bun-hono-backend.md)). |
