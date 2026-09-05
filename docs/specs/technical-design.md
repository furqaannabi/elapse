# Technical design — platform

Status: **Draft — aligned 2026-09-05 with the signed API FRD; the FRD is authoritative where the two differ** · Scope: everything behind the SDK (API, data, auth, webhooks, chain integration, environments). Sources: detailed doc §3, §4.4, §5, §9, §13; `sdk/ts/src/index.ts`; `.env.example`.

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

All ids are prefixed random strings (`prod_` + 14 base62). Money is stored two ways, both exact: rates as `numeric(38,18)` USD alongside the derived token base units `numeric(78,0)` (`*_wei`); balances that come from the chain (`funded_wei`, `settled_wei`, invoice `amount_wei`, `fee_wei`) as base units only, converted to USD strings at the API edge with `BigInt`. Timestamps are `timestamptz`. Every merchant-scoped table has `created_at` and `livemode boolean`; test and live rows never mix in a query (BR-API-001). The authoritative column list is the **Data / interfaces** block of the [API FRD](./api-frd.md); the sketch below is the same model in prose.

```
merchants          id, name, email, payout_address, checkout_branding jsonb
api_keys           id, merchant_id, livemode, kind 'pk'|'sk', name, hash (SHA-256 of the plaintext, bytea, unique), last4, plaintext (pk only), last_used_at, revoked_at, expires_at (roll grace)
products           id, merchant_id, livemode, name, description, rate_usd_per_second numeric(38,18), rate_per_second_wei numeric(78,0), allow_pause bool, active bool
customers          id, merchant_id, livemode, email, passkey_id, wallet_address   UNIQUE(merchant_id, livemode, wallet_address), INDEX(wallet_address)
checkout_sessions  id, merchant_id, livemode, product_id, customer_id?, subscription_id?, status 'open'|'complete'|'expired', success_url, cancel_url, expires_at, test_clock_id?
subscriptions      id, merchant_id, livemode, product_id, customer_id, status 'incomplete'|'active'|'paused'|'canceled', stream_address, chain_id,
                   started_at, paused_at, canceled_at, max_duration_seconds, max_escrow_wei, funded_wei, settled_wei, settled_seconds,
                   permit_nonce, permit_deadline, ended_reason 'canceled'|'cap_reached', simulated, test_clock_id   UNIQUE(chain_id, stream_address)
invoices           id, merchant_id, livemode, subscription_id, period_start, period_end, seconds, amount_wei (gross), fee_wei, status 'paid'|'failed', tx_hash, log_index
webhook_endpoints  id, merchant_id, livemode, url, events text[], disabled, secret_enc (AES-GCM under WEBHOOK_SECRET_KEK; the worker must sign with it, so it cannot be hashed), previous_secret_enc, previous_secret_expires_at, consecutive_failures
events             id, merchant_id, livemode, type, created, data jsonb, raw_body text (the signed bytes), pending_webhooks int, chain_event_id?
deliveries         id, event_id, endpoint_id, status 'queued'|'retrying'|'succeeded'|'exhausted'|'manual', attempt, next_attempt_at, locked_until
delivery_attempts  id, delivery_id, n, sent_at, duration_ms, status_code, error, request_headers jsonb, response_excerpt
chain_events       id, chain_id, block_number, block_hash, block_timestamp, tx_hash, log_index, address, event_name, args jsonb   UNIQUE(chain_id, tx_hash, log_index): idempotency for the indexer
ledger_entries     id, merchant_id, livemode, kind 'deposit'|'settlement'|'fee'|'refund', amount_wei, subscription_id, customer_id, tx_hash, log_index, block_hash, block_timestamp, reversed_by
idempotency_keys   key, merchant_id, request_hash, response jsonb, created_at
merchant auth      dashboard_sessions, magic_links(token_hash), notifications — see the API FRD dashboard route group
audit_log          id, merchant_id, actor, action, target, ip, at
```

Invariants (enforced in service code and tested):
- `settled_wei ≤ rate_per_second_wei × settled_seconds ≤ funded_wei ≤ max_escrow_wei` per subscription.
- An `events` row is written exactly once per chain log (`chain_events` unique index).
- `deliveries` for one event × endpoint never exceed 8 attempts.

## 3. API

Base `https://api.elapse.dev/v1`. JSON, `snake_case` on the wire (FR-API-083). Stripe conventions: `object` field on every resource, `id` prefixes, `created` unix seconds, list responses `{ object: "list", data: [], has_more }`, errors `{ error: { type, code, message, param? } }`.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST/GET | `/products`, `/products/:id` | `sk_` | `rate_usd_per_second` decimal string, must fit the token's 6 decimals exactly (BR-API-004); rate immutable after create |
| POST | `/checkout/sessions` | `sk_` | returns `url` = `https://pay.elapse.dev/c/:id` |
| GET | `/checkout/sessions/:id` | `pk_` or session token | what the hosted checkout reads; never leaks merchant secrets |
| POST | `/checkout/sessions/:id/prepare`, `/start` | `pk_` + Privy identity | prepare returns the EIP-2612 permit payload; start submits `createWithPermit` through the relayer (FR-API-032) |
| GET/POST | `/account/subscriptions`, `/account/invoices`, `/account/subscriptions/:id/cancel` | Privy access token | subscriber account page, cross-merchant (FR-API-120–123) |
| GET/POST | `/subscriptions`, `/subscriptions/:id`, `/subscriptions/:id/cancel` | `sk_` | merchant-side; `pause`/`resume` are dashboard-internal and absent from OpenAPI (FR-API-043) |
| GET | `/customers/:id`, `/invoices?subscription=` | `sk_` | |
| CRUD | `/webhook_endpoints`, `…/:id/roll_secret`, `…/:id/test` | `sk_` | secret returned once on create/roll |
| GET | `/events`, `/events/:id`, `/webhook_endpoints/:id/deliveries`, `/deliveries/:id`, POST `/deliveries/:id/resend` | `sk_` or dashboard cookie | delivery log (FR-API-063/064) |
| * | `/dashboard/*` | `elapse_session` cookie | magic link auth, profile, branding, ledger, balance, notifications, activity, stats (FR-API-100–112) |
| POST | `/internal/ingest` | `Authorization: Bearer $INGEST_TOKEN` | indexer only; body `{chain_id, block_number, block_hash, block_timestamp, tx_hash, log_index, address, event_name, args, ledger[]}` (FR-API-070) |
| POST | `/test_helpers/test_clocks`, `…/:id/advance` | `sk_test_` only | demo fast-forward for `simulated` subscriptions (FR-API-090/091) |
| GET | `/status` | public | chain, indexer lag, worker queue for judge mode (FR-API-074) |
| — | `/openapi.json` | public | generated from route schemas; published into the docs |

Auth: `Authorization: Bearer sk_test_…`, or the dashboard session cookie on the same merchant routes (one middleware, two credential kinds, FR-API-102). Keys are stored as SHA-256 + last 4 (FR-API-002): a 24-char random base62 key has ~143 bits of entropy, so a plain hash is sufficient and allows a one-query indexed lookup. `pk_` keys may only read checkout sessions and drive the session-scoped checkout actions (FR-API-004). Idempotency: `Idempotency-Key` header on POSTs, 24 h window (FR-API-081). Rate limits: 100 req/s per `sk_`, 20 per `pk_`, 10 checkout-session creates per second per merchant (FR-API-005). Key, endpoint and payout mutations write `audit_log` (FR-API-006).

## 4. Chain integration

- The API holds the **relayer** key (`RELAYER_PRIVATE_KEY`) and is the only gas payer. It calls `StreamFactory.createWithPermit` (one transaction: permit, escrow pull, start), `AccrualStream.cancel` as the merchant party or `cancelFor` with the subscriber's signature, and the keeper calls `settleBatch` every 5 minutes.
- Subscriber funds: decided by [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md). The subscriber holds AUSD in their Privy wallet and signs one EIP-2612 `permit` for `max_escrow = rate × max_duration_seconds`; the relayer submits it and pays gas. No card, no float, no paymaster. AUSD `permit` was verified on both chains 2026-09-05 (contracts README, Tokens table). In test mode the relayer first mints `MockUSD` to the subscriber (FR-API-032).
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
| `RELAYER_PRIVATE_KEY` | api, worker | never in web; holds MON for gas only, never AUSD; Railway env on testnet, KMS before mainnet (API FRD Undecided 12) |
| factory, token addresses | api, worker, indexer, web (judge mode) | read from `contracts/deployments/<chainId>.json`, not from env (FR-CON-062) |
| `INGEST_TOKEN` | api, indexer | shared bearer for `/internal/ingest` |
| `WEBHOOK_SECRET_KEK` | api, worker | AES-GCM key for `webhook_endpoints.secret_enc` |
| `RESEND_API_KEY` | api, worker | magic links, notifications, receipts (Undecided 10) |
| `NEXT_PUBLIC_CHECKOUT_URL` | api | base of the `session.url` the API returns |
| `NEXT_PUBLIC_PRIVY_APP_ID` | web | subscriber sign-in |
| `NEXT_PUBLIC_API_URL` | web | `https://api.elapse.dev` |
| `ELAPSE_SECRET_KEY`, `ELAPSE_WEBHOOK_SECRET` | examples, cli | a merchant's credentials |

Environments: `local` (`api/docker-compose.yml` Postgres on :55434, Monad testnet), `testnet` (shared, used by the docs quickstart CI), `mainnet` (Week 5+). Hosting decided 2026-09-05 (William): Railway for the API and worker as two processes from this repo, Neon for Postgres, Vercel for `web/`, Envio hosted for the indexer.

## 7. Security checklist (every PR)

- API secret keys hashed (SHA-256 + last4, FR-API-002); webhook signing secrets encrypted at rest (the worker needs the plaintext to sign); both shown once; `sk_` and `whsec_` never reach a browser.
- Webhook signature verified before parse in every consumer we ship (SDK, CLI, examples).
- Ingest idempotent; indexer holds no merchant secrets.
- Money math in integers (nano-dollars / wei); rates validated as decimal strings.
- Test/live separation in every query (`livemode` column, key prefix).
- Audit log on key create/roll/revoke, endpoint changes, payout address changes, resends.
- No chain vocabulary in subscriber-facing responses.

## 8. Testing

| Layer | Tool | Must cover |
| --- | --- | --- |
| Contracts | Foundry | start/pause/resume/cancel/settle; refund; fuzz elapsed math; invariant settled ≤ accrued ≤ deposited |
| API | `bun test` against Postgres (`elapse_test`), requests through `app.request()` in-process | every endpoint happy path + auth failures + idempotency replay + test/live isolation |
| Worker | `bun test` | signing round-trips with `constructEvent`; retry schedule; cap 8; dedupe; resend |
| Indexer | Envio test harness | each handler posts once per log; duplicate log ignored |
| End to end | Playwright + testnet | quickstart: product → session → start → cancel → webhook received (this is also the docs CI) |

## Undecided (human) — summary

1. ~~API framework~~ — decided: Bun + Hono (Furqaan, 2026-09-03).
2. ~~Gas sponsorship mechanism~~ — decided: subscriber permit, relayer pays gas ([ADR 2026-09-04](../decisions/2026-09-04-subscriber-permit-relayer-signs.md)).
3. ~~Hosting~~ — decided 2026-09-05: Railway + Neon (API FRD Undecided 11).
4. ~~Rate-limit numbers; secret-roll overlap window~~ — decided (API FRD Undecided 6, FR-API-105); endpoint auto-disable threshold lives in the worker FRD.
5. Correction events on reorg (recommend none in MVP).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-03 | Furqaan (via William) | Bun + Hono decided for api/worker; Foundry for contracts ([ADR](../decisions/2026-09-03-bun-hono-backend.md)). |
| 2026-09-05 | Claude (for William) | Aligned with the signed API FRD: SHA-256 keys, `livemode`, wei columns, permit funding, `/internal/ingest` with `INGEST_TOKEN`, dashboard and account route groups, Railway + Neon, `bun test`. The FRD is authoritative where this page and it differ. |
