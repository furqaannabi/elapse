# Indexer (`indexer/` — Envio HyperIndex on Monad) — FRD

Status: **Draft — awaiting human sign-off** · Surface: Platform (chain → platform ingest) · Sources: detailed doc §5.2 Delivery pipeline (steps 1–2), §7 judge mode, §9 Architecture ("Index: Envio HyperIndex on chain 143"), §11 Envio bounty, §12 Week 1/3, §15 "Envio Effect double-fire (preload)"; `indexer/README.md`; contracts FRD events; API FRD FR-API-070–074.

## Problem

The contract emits events; the platform needs rows. The indexer is the only bridge (doc §5.2 step 2): it watches every `AccrualStream` clone spawned by the `StreamFactory` on Monad and POSTs each lifecycle event to **our** ingest URL — never to a Merchant, and never holding a Merchant secret. It must survive Envio's preload double-execution, restarts and re-syncs without producing duplicate merchant Events, and it must expose its lag so judge mode can show "Envio status" honestly.

## User stories

1. As the platform, I want every `StreamStarted/Paused/Resumed/Canceled/Settled` on our factory's clones delivered to `POST /internal/ingest` within a few seconds of the block, so that Merchant webhooks fire promptly (doc §16 "not a cron job").
2. As the platform, I want re-syncs and preload runs to be harmless, so that a Subscriber is never told they were canceled twice (§15).
3. As a judge in judge mode, I want to see the indexer's latest block against the chain head and a live GraphQL query, so that "Envio indexes it" is verifiable (§7, §10 step 5).
4. As the Envio bounty reviewer, I want HyperIndex + Effect API to be the canonical stream → event ingest, documented as such (§11).
5. As a developer, I want a one-command local run against testnet, so that Week 1 ends with `StreamCanceled` and `Settled` visibly indexed (§12 Week 1).
6. As the API, I want each ingest body to carry `block_hash` and `block_timestamp`, so that Invoice periods and reorg audits come from the chain, not from the platform clock.

## Functional requirements

### Configuration and discovery (doc §9, §12; contracts FRD FR-CON-003)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-IDX-001 | `indexer/config.yaml` declares one network per deployment: chain id **10143** (testnet) now, **143** (mainnet) in Week 5; `start_block` = factory deployment block from `contracts/deployments/<chainId>.json`. Contract `StreamFactory` at that address with event `StreamCreated`. | `pnpm envio codegen && pnpm envio dev` starts and reaches the head on testnet. |
| FR-IDX-002 | Dynamic contract registration: the `StreamFactory.StreamCreated` contract-register handler calls `context.addAccrualStream(event.params.stream)` so every clone is indexed from its creation block. | Test: create a stream after the indexer started; its `StreamStarted` is indexed. |
| FR-IDX-003 | `AccrualStream` ABI events indexed: `Deposited`, `StreamStarted`, `StreamPaused`, `StreamResumed`, `Settled`, `StreamCanceled` (contracts FRD Data block). The ABI is copied from `contracts/out` by a script, never hand-edited. | `pnpm sync-abi` diff is empty in CI. |
| FR-IDX-004 | Envio HyperSync is the data source for Monad (no RPC polling); `MONAD_RPC_URL` is fallback only. | Config review; sync from `start_block` to head < 2 min on testnet. |

### Entities (what the indexer stores; doc §9 "Envio + our event log")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-IDX-010 | `Stream` entity keyed by clone address: `factory, merchant, subscriber, token, ratePerSecond, status (Created|Active|Paused|Canceled), pauseReason, startedAt, pausedAt, canceledAt, deposited, settledSeconds, settledAmount, createdBlock, updatedBlock`. Each handler updates it. | After the kill-gate cancel (FR-CON-073), `Stream.status == Canceled` and `settledSeconds == 83`. |
| FR-IDX-011 | `StreamEvent` entity keyed `${chainId}_${txHash}_${logIndex}`: `stream, name, args (json), blockNumber, blockHash, blockTimestamp, txHash, logIndex, ingestStatus (pending|sent|failed|duplicate), ingestAttempts, lastIngestAt`. | One row per log; ingest status visible in GraphQL. |
| FR-IDX-012 | `Settlement` entity per `Settled` event: `stream, seconds, amount, blockTimestamp, txHash` — mirrors the platform's Invoice and lets judge mode query "settled this session". | Row per `Settled`. |
| FR-IDX-013 | `Factory` singleton: `streamCount, activeCount, totalSettled` aggregate counters. | Counters match a raw count query. |

### Ingest via Effect API (doc §5.2 step 2 "Effect API, cache: false"; §11)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-IDX-020 | An Effect `postIngest` (`experimental_createEffect({name:"postIngest", input, output, cache:false}, …)`) POSTs `{chain_id, block_number, block_hash, block_timestamp, tx_hash, log_index, address, event_name, args}` to `INGEST_URL` with `Authorization: Bearer $INGEST_TOKEN` (API FRD FR-API-070). Every `AccrualStream` handler awaits it. | Integration test against a local API: each event produces one `chain_events` row. |
| FR-IDX-021 | `cache: false` is mandatory (the doc's own note): delivery is a side effect and must not be memoised to disk. The input carries `tx_hash+log_index` so the platform de-duplicates; the handler tolerates the Effect running more than once (Envio preload). | Run the handler twice on one log → platform reports `duplicate: true` on the second; `StreamEvent.ingestStatus == sent`. |
| FR-IDX-022 | `args` are serialised with `uint256` as decimal strings and addresses lower-cased; no floats. | Snapshot of the JSON body for `StreamCanceled(at, 83, 332000)`. |
| FR-IDX-023 | The Effect retries `5xx`/network errors 3× with 1 s, 4 s, 16 s backoff, then records `ingestStatus: failed` and **does not throw** (a failing ingest must not halt indexing). `4xx` → `failed` immediately, logged with body. | Fault-injection test; indexing continues. |
| FR-IDX-024 | A `reconcile` script (`pnpm reconcile`) re-POSTs every `StreamEvent` with `ingestStatus in (pending, failed)`; safe to run any time because ingest is idempotent. | Script leaves zero `failed` rows against a healthy API. |
| FR-IDX-025 | The indexer holds exactly one secret: `INGEST_TOKEN`. No Merchant ids, webhook URLs or `whsec_` values exist anywhere in `indexer/` (doc §5.2 "Indexer must not know merchant secrets"). | `grep -r whsec_ indexer/` empty; env review. |

### Reorgs and ordering (doc §15)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-IDX-030 | Every ingest carries `block_hash`; the platform stores it. Envio `rollback_on_reorg` follows Undecided 2; if enabled, a rolled-back `StreamEvent` re-posts after the reorg with the new `block_hash`, and the platform treats the old `(tx_hash, log_index)` as a duplicate unless the hash differs (API decides). | Simulated reorg fixture; no duplicate merchant Event. |
| FR-IDX-031 | Handlers are pure functions of event params + entity state; no wall-clock reads, no ordering assumptions across streams. Within a stream, events are processed in `(blockNumber, logIndex)` order (HyperIndex guarantee). | Replay from `start_block` produces identical entities (deterministic). |
| FR-IDX-032 | Unknown or malformed logs (ABI mismatch after a redeploy) are logged and skipped, never thrown. | Corrupt-ABI test. |

### Health, lag and judge mode (doc §7 "Envio query", checkout FRD FR-CHK-011)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-IDX-040 | The Envio GraphQL endpoint (Hasura, default `:8080/v1/graphql`) is reachable by the platform; the platform's `GET /v1/status` (FR-API-074) reads `chain_metadata.latest_processed_block` (or equivalent) and reports `lag_blocks`/`lag_seconds` vs the RPC head. | `lag_seconds < 5` on idle testnet. |
| FR-IDX-041 | The indexer exposes `INDEXER_PUBLIC_GRAPHQL_URL` for the judge panel's "Envio query" (read-only, public entities only) — a fixed query returning the `Stream` for the session's `stream_address`. | Query returns within 300 ms. |
| FR-IDX-042 | `StreamEvent.ingestStatus` counts (`pending/failed`) are surfaced in `GET /v1/status` as `indexer.unsent_events`. | Status shows 0 after reconcile. |
| FR-IDX-043 | Structured logs per handler: `event, stream, block, ingestStatus, durationMs`. | Log snapshot. |

### Delivery and bounty (doc §11 Envio $1,000, §12)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-IDX-050 | Week 1: `StreamCanceled` and `Settled` from the kill-gate transaction are queryable in GraphQL (`Stream.status == Canceled`). Week 3: Envio → ingest → worker end-to-end fires a Merchant webhook. | Kill-gate checklist in `contracts/README.md`; Week 3 demo of `subscription.canceled` at an ngrok URL. |
| FR-IDX-051 | Deployment: Envio Hosted Service (preferred, Undecided 1) with the same `config.yaml`; `INGEST_URL`/`INGEST_TOKEN` as hosted env vars; fallback `docker compose` in `indexer/`. | Hosted deployment URL recorded in `indexer/README.md`. |
| FR-IDX-052 | Bounty note in `indexer/README.md` and docs "Contracts" page: HyperIndex + Effect API is the canonical stream → event ingest; the signed, retried, secret-rotated Merchant hop is ours (doc §5.2 last paragraph). Video timestamp for "Envio delivery" (doc §16 item 4). | README section present; timestamp in submission notes. |

### Tests and local run (doc §12 Week 1 "Envio indexes StreamCanceled and Settled", §15 "Quickstart is a CI script")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-IDX-060 | Handler unit tests with Envio's generated `TestHelpers`/`MockDb`: one test per event name asserting the `Stream` and `StreamEvent` entity after the handler, named `FR_IDX_010_*`. | `pnpm test` green in `indexer/`. |
| FR-IDX-061 | Effect tests inject a fake `fetch`: success, `5xx` then success (retry), `4xx` (fail fast), network error ×4 (`failed`, no throw). | Four tests green. |
| FR-IDX-062 | Integration test (`pnpm test:e2e`): anvil + deployed factory + local indexer + local API; run the kill-gate sequence (`create → deposit → start → warp 83 → cancel`) and assert `GET /v1/subscriptions/:id` shows `canceled`, `seconds_elapsed: 83`. | Runs in CI nightly and before the Week 1 and Week 3 checkpoints. |
| FR-IDX-063 | `indexer/README.md` documents the one-command local run (`pnpm envio dev` with `.env` from `.env.example`), the hosted deploy, and the reconcile script. | A newcomer follows it to a synced indexer without asking. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-IDX-001 | The indexer POSTs to the platform only. It never contacts a Merchant URL and never signs with a `whsec_` (doc §5.2). |
| BR-IDX-002 | Ingest is idempotent on `(chain_id, tx_hash, log_index)`; the indexer may send any log any number of times (doc §15). |
| BR-IDX-003 | Effects that perform delivery use `cache: false`; cached Effects are allowed only for pure lookups (none in MVP). |
| BR-IDX-004 | No per-second activity: the indexer reacts to lifecycle and `Settled` logs only; there is no timer-driven handler (doc §2 "Not a webhook per second"). |
| BR-IDX-005 | Numbers are strings/bigints end-to-end; no `Number()` on `uint256`. |
| BR-IDX-006 | Indexing never halts on platform failure; the platform never trusts the indexer's `status` over its own idempotent derivation. |
| BR-IDX-007 | Chain ids are explicit everywhere (`10143` testnet, `143` mainnet); a testnet indexer can never post into a live-mode Subscription (API FR-API-072). |

## Data / interfaces

```
config.yaml   networks: [{id: 10143, start_block: <factory block>, contracts: [StreamFactory{address}, AccrualStream{dynamic}]}]
schema.graphql  Stream, StreamEvent, Settlement, Factory (fields in FR-IDX-010–013)
handlers.ts   StreamFactory.StreamCreated.contractRegister → addAccrualStream
              StreamFactory.StreamCreated.handler → Stream(Created), Factory.streamCount++
              AccrualStream.{Deposited,StreamStarted,StreamPaused,StreamResumed,Settled,StreamCanceled}.handler
                 → update Stream, write StreamEvent, await context.effect(postIngest, {...})
effects.ts    postIngest (cache:false) → POST $INGEST_URL, Bearer $INGEST_TOKEN, 3 retries
env           INGEST_URL, INGEST_TOKEN, ENVIO_API_TOKEN (hosted), CHAIN_ID
```

Ingest body (shared type in `packages/shared` with the API): see FR-IDX-020; `event_name ∈ {StreamCreated, Deposited, StreamStarted, StreamPaused, StreamResumed, Settled, StreamCanceled}`.

## Undecided (human)

1. **Hosting.** (a) Envio Hosted Service; (b) self-hosted Docker on the same box as the API; (c) both (hosted for demo, Docker for CI). **Recommend (c)** — hosted is zero-ops for the video, Docker keeps the Week-1 gate independent of a third party.
2. **Reorg handling.** (a) `rollback_on_reorg: true` and platform keys on `(tx_hash, log_index, block_hash)`; (b) `rollback_on_reorg: false`, rely on MonadBFT fast finality and record `block_hash` for audit; (c) delay ingest by N blocks. **Recommend (b)** for 13 Oct with `block_hash` stored, revisit post-hackathon.
3. **Ingest transport.** (a) HTTP POST per log (as doc); (b) batch POST per block; (c) platform pulls from GraphQL. **Recommend (a)** — it is the Envio-documented Effect pattern the bounty is judged on.
4. **Public GraphQL for judge mode.** (a) expose Envio endpoint directly; (b) proxy through `GET /v1/status`. **Recommend (b)** plus a link to the raw endpoint in the panel.

## Open

- Confirm HyperSync coverage for Monad testnet 10143 and mainnet 143 at Week 1 start; if absent, RPC mode with `MONAD_RPC_URL`.
- Envio API surface (`experimental_createEffect`, `contractRegister`) is version-specific — pin the `envio` version in `indexer/package.json` and record it here.
- Whether `Deposited` should trigger a platform update at all (API FRD FR-API-071 says yes, no merchant Event).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
