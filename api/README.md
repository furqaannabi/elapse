# API — Bun + Hono + Postgres

Platform REST: API keys, products, checkout sessions, subscriptions, invoices,
webhook endpoints, events and deliveries; ingest for the indexer; the relayer
that opens and cancels streams. Spec: [`docs/specs/api-frd.md`](../docs/specs/api-frd.md)
(signed 2026-09-05). Every route, test and column carries its `FR-API-nnn`.

HMAC header: `X-Elapse-Signature: t=unix,v1=hmac_sha256`, payload `{t}.{raw_body}`.

## Setup

```sh
curl -fsSL https://bun.sh/install | bash      # Bun ≥ 1.2 (native Postgres driver, bun test)
cd api
docker compose up -d                          # Postgres 16 on :55434 with `elapse` and `elapse_test`
pnpm install
cp .env.example .env                          # then fill in WEBHOOK_SECRET_KEK, INGEST_TOKEN, RELAYER_PRIVATE_KEY
bun run migrate
bun run seed-merchant you@example.com         # prints a local sk_test key (dev only)
bun run dev                                   # :4000
bun run worker                                # second process: webhook deliveries
bun test                                      # migrates + runs against elapse_test
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/app.ts` | The Hono app: routers under `/v1`, FR-API-082 error shape for every failure, `GET /openapi.json` (FR-API-084) |
| `src/routes/` | One file per resource, each an `OpenAPIHono` router with Zod request/response schemas; `operationId` equals the SDK method name |
| `src/middleware/auth.ts` | `requireAuth`: Bearer `sk_`/`pk_` or the dashboard session cookie (`X-Elapse-Mode`, Origin check), mode scoping (FR-API-001, 004, 101, 102) |
| `scripts/seed-merchant.ts` | Dev only: merchant + publishable keys + one printed `sk_test` |
| `src/worker/` | The second process (`bun run worker`): webhook deliveries (claim with `FOR UPDATE SKIP LOCKED`, sign, POST, retry schedule, attempt rows, time-based auto-disable), `keeper.ts` (hourly settle, cap ends), `reconcile.ts`, `heartbeat.ts`, `notify.ts` (expiry notices, first delivery, notification emails). Imports only `db/`, `lib/`, `chain/`, `services/` |
| `src/services/` | Logic shared by routes and the worker: checkout flow, the CLI SSE stream |
| `src/chain/` | viem relayer client and `deployments.ts` (which token each mode escrows) |
| `deployments/` | `<chainId>.json` copied from `contracts/deployments/` by `pnpm sync-deployments` |
| `src/db/` | Bun `SQL` client, migration runner, one repository per table |
| `src/lib/` | Pure helpers: ids, key generation and hashing, decimal money, errors, signature, mail templates (one shell for sign-in, notices, receipts) |
| `migrations/` | Plain SQL, `NNNN_name.sql`, applied once each by `bun run migrate` |
| `test/` | `bun test`; the preload migrates the test database; helpers seed a merchant with keys |

## Rules baked in

- Secret keys are stored as SHA-256 + last 4 and returned once (FR-API-002). Publishable keys are not secret and keep their plaintext for the dashboard.
- Every merchant table has `livemode`; every query is scoped by the key's mode. An id from the other mode is a `404`, never a `403` (BR-API-001, FR-API-082).
- Money is decimal strings on the wire, `NUMERIC` in Postgres and `BigInt` in code. `rate_usd_per_second` must fit the token's 6 decimals or the request is rejected (BR-API-004).
- Queries use Bun's tagged-template `sql`, which parameterises every value.

## Dashboard sign-in

Magic link (FR-API-100): `POST /v1/dashboard/auth/magic_link {email}` always answers `{sent:true}` and emails a 15-minute single-use link to `${DASHBOARD_ORIGIN}/login/verify?token=…`; `POST /v1/dashboard/auth/verify {token}` sets the `elapse_session` cookie (HttpOnly, SameSite=Lax, 7-day idle) and creates the merchant with a publishable key per mode on first sign-in. Tokens and cookie values are stored as SHA-256. Cookie requests take the mode from `X-Elapse-Mode` and must send the dashboard `Origin` to mutate. Keys (`/v1/api_keys`) are cookie-only.

## Ingest (chain → platform)

`POST /internal/ingest` is the indexer's only door (FR-API-070). `Authorization: Bearer $INGEST_TOKEN`
(the same value the indexer holds as `ENVIO_INGEST_TOKEN`); a Merchant key or cookie gets the same 401.
One transaction per log: `chain_events` row (unique on `chain_id, tx_hash, log_index`, so a repeat is
`{duplicate: true}`), Subscription lookup by `stream_address` or by the relayer's `pending_tx`, then the
FR-API-071 mapping: `StreamStarted` → `active` + `checkout.session.completed` + `subscription.created`;
pause/resume → `subscription.updated`; `Settled` → paid Invoice + `invoice.settled`; `StreamCanceled` →
`canceled` (+ `invoice.payment_failed` and a `payment_failed` notification first when the cap was reached)
+ `subscription.canceled`. Ledger rows land in `ledger_entries`. A log for a stream we did not create is
stored with `subscription_id NULL` and answered `{ignored: true}`. Fixtures in `test/ingest-fixtures.ts`
mirror the indexer's bodies byte for byte.

## Checkout actions and the relayer

`POST /v1/checkout/sessions/:id/prepare` (pk_) binds the subscriber's wallet as a Customer, creates
the `incomplete` Subscription for the chosen cap, and returns the ERC-2612 permit to sign (exact
`max_escrow`, factory as spender, 10-minute deadline). `POST …/start {signature}` checks the
signature recovers to that wallet, refuses a wallet short of the cap (`insufficient_balance`), submits
`StreamFactory.createWithPermit` through the relayer and records `pending_tx`. `active` arrives
from ingest. The relayer needs `RELAYER_PRIVATE_KEY` (MON for gas, never AUSD), `MONAD_RPC_URL`,
`CHAIN_ID`; without them `start` answers 503. The merchant must have a payout address.
Platform chore (Undecided 4): keep the relayer topped up from the testnet faucet. Measured 2026-09-06 at
~100 gwei: a checkout (mint + `createWithPermit`) costs about 0.1 MON, so one 5 MON claim is ~50 checkouts.
An empty relayer answers `503 relayer_unfunded`; the page says nothing was charged. `pnpm sync-deployments` refreshes `deployments/<chainId>.json`.

### Merchant-driven meters

`POST /v1/subscriptions/:id/start` starts a `merchant`-mode meter when the resource is ready;
`/pause` and `/resume` stop and restart the clock around the work itself (contracts FR-CON-074 lets
the relayer, as keeper, do both). `/cancel` ends it, and since 2026-09-19 also releases a *held*
session — one authorised but never started — which the subscriber may no longer do themselves
(FR-CON-057). If nobody releases it, the unstarted sweep refunds it in full after
`min(cap, UNSTARTED_WINDOW_S)`. All four answer `202` with `pending_tx`; the status follows from
ingest, never from the transaction receipt.

The public session read carries `start_tx` and `end_tx` (FR-API-143) so `<Meter proof>` can show
the two transactions that bracket a meter. They are written at ingest and are public chain data;
`pending_tx` deliberately stays out of that read, because it holds whatever went out last.

## Proven live (2026-09-05, Monad testnet)

Checkout `prepare` → permit signature → `start` → relayer tx
[`0x5decd1d9…75e54b`](https://testnet.monadscan.com/tx/0x5decd1d95b8fea0b2f62cb9b671106b8a9e6177165d0ae1c79e5e0878175e54b)
→ Envio → `POST /internal/ingest` → `checkout.session.completed` + `subscription.created` → worker →
receiver verifying with `@elapse/sdk`. 4.7 s from the start click to the verified webhook.

## Status (judge mode)

`GET /v1/status` is public: chain id, block time, factory and token, indexer lag read from Envio's GraphQL
(`INDEXER_GRAPHQL_URL`), unsent ingest count, last ingest time, and the webhook queue depth. An unreachable
indexer is reported as `indexer.ok: false`, never as a 500.

## Keeper

Inside the worker process (`src/worker/keeper.ts`): every tick it calls `settleBatch` for active streams
last settled over `KEEPER_CADENCE_S` ago (3600 in production, [ADR 2026-09-08](../docs/decisions/2026-09-08-keeper-cadence-one-hour.md))
and for any stream past its cap, whose first `settle()` emits the cap-end pair. It stamps `last_settle_requested_at` and nothing else; the `Settled`/`StreamCanceled` logs come back
through the indexer. Proven live 2026-09-05: a 60 s cap ended by the keeper, `invoice.payment_failed` +
`subscription.canceled` + `invoice.settled` delivered 78 s after the start click. `KEEPER=0` disables it.

## Worker

Spec: [`docs/specs/worker-frd.md`](../docs/specs/worker-frd.md) (signed 2026-09-05). Retries `0s, 30s, 2m, 10m, 1h, 1h, 1h, 1h`, cap 8, 10 s timeout, no redirects, any `2xx` is success. Signs `{t}.{raw_body}` with the endpoint's decrypted `whsec_`, both secrets during a roll's grace window. An endpoint failing for 3 days straight is disabled (bell warning at 24 h, email if the merchant's switch is on). A sweep every minute writes key and secret expiry notices 24 h and 1 h before a roll's grace ends, and the first 2xx per mode writes a first-delivery notice (FR-WRK-042, FR-API-109). Env: `WORKER_CONCURRENCY` (16), `WORKER_BATCH` (50).

## Modes and chains

Both modes drive real streams on Monad testnet (10143) and escrow testnet **AUSD** ([ADR 2026-09-13 AUSD only](../docs/decisions/2026-09-13-ausd-only-mockusd-to-test-fixture.md)): nothing is minted, a short wallet sees Add funds in the Elapse window, and `start` refuses before any gas is spent (FR-API-034). The escrow token is a property of the chain, so live mode moves to mainnet (143) with mainnet AUSD when `contracts/deployments/143.json` lands, with no code change (`LIVE_CHAIN_ID`, default 10143). The relayer's own testnet MON comes from <https://faucet.monad.xyz>: a platform chore, not a user's.

## Hosting (Undecided 11, decided)

API, worker and Postgres run as three containers on **one EC2 host** (`api/docker-compose.ec2.yml`), behind
the host's nginx: it terminates TLS for `api.elapse.finance` and proxies to `127.0.0.1:4000`, which is the
only published port. Postgres publishes nothing at all and is reached only over the compose network; its
volume, `elapse-pg`, is the database, so backups are EBS snapshots or a `pg_dump` cron, not someone else's
job. `.github/workflows/deploy-ec2.yml` deploys on a green CI run from `master`: it pipes
`api/scripts/deploy-ec2.sh` over SSH, which fast-forwards the checkout to that commit, rebuilds, and waits
for `/v1/status`. Migrations run as the api container starts; the worker waits for the api to be healthy,
and there is exactly one worker because two keepers would both submit settle transactions.

This replaced **Railway + Neon** ([ADR 2026-09-15](../docs/decisions/2026-09-15-api-on-one-ec2-host.md)), which is what every record written before it describes.

Production environment lives in `api/.env` on the box (`chmod 600`, gitignored, names in `api/.env.example`).
`RELAYER_PRIVATE_KEY` is in it — read by both containers, since the API opens and cancels streams and the
worker's keeper settles them — holds MON for gas and never AUSD; AWS Secrets Manager or SSM is the better
home for it than a file on the disk. The relayer is its own wallet, set as the factory's `keeper`; the factory owner and fee treasury are a separate wallet William holds. A hardware wallet or multisig for the owner is post-submission (Undecided 12, [ADR 2026-09-07](../docs/decisions/2026-09-07-submission-on-testnet-live-mode-mockusd.md)).
