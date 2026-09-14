# Webhook worker (`api/src/worker/` — Postgres-queued deliveries) — FRD

Status: **FR-WRK-075 unstarted-session sweep Signed 2026-09-14 (Furqaan)** · **Signed 2026-09-05 (William); FR-WRK-072 signed 2026-09-07 (William); FR-WRK-073 signed 2026-09-07 (William)** · Surface: Platform (Merchant webhook delivery) · Sources: detailed doc §2 "Not a webhook per second", §4.4 Signature, §5.1 catalog, §5.2 steps 3–5, §5.3 payload, §9 "Queue in Postgres + worker. No Kafka.", §10 step 3, §12 Week 2/4, §15; `worker/README.md`; `sdk/ts/src/index.ts` (`constructEvent`); design brief §3.9; API FRD FR-API-060–064, FR-API-073.

## Problem

"Your server finds out via webhook, not a cron job" (doc §16). The worker is the Stripe-grade hop the doc says is ours: signed, retried, secret-rotated, observable (§5.2). It takes Events the API wrote, fans them out to each subscribed Webhook endpoint, signs every request so `@elapse/sdk` `constructEvent` verifies it byte-for-byte, retries on a fixed schedule, records every attempt for the dashboard delivery log, and never — under any load — sends anything per second.

## User stories

1. As a Merchant engineer, I want `subscription.canceled` to arrive within seconds of the cancel with a valid `X-Elapse-Signature`, so that the quickstart's `constructEvent` returns the event on the first try (§10 step 3).
2. As a Merchant engineer, I want failed deliveries retried automatically and visible with status codes in the dashboard, so that a deploy hiccup does not lose an event (§5.2 step 5).
3. As a Merchant, I want "Resend" on any delivery, so that I can replay an event into a fixed handler (design brief §3.9).
4. As a Merchant, I want to roll my signing secret without a gap, so that rotation is safe in production.
5. As the platform, I want the queue in Postgres with no extra infrastructure, so that one process and one database run the whole demo (§9).

## Functional requirements

### Job creation (doc §5.2 step 3; API FRD FR-API-073)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-001 | When the API inserts an Event, in the same transaction it inserts one Delivery per Webhook endpoint of that Merchant where `livemode` matches, `disabled = false`, and `events[]` contains the type or `"*"`. `status = queued`, `attempt = 0`, `next_attempt_at = now()`. `Event.pending_webhooks` = number of Deliveries created. **Amended 2026-09-06:** a `kind: cli` endpoint matches only while its `cli_connected_until > now()`, and the worker's claim query never returns its Deliveries; the API streams them (API FR-API-131/134). | 1 Event × 2 matching endpoints + 1 disabled → 2 Deliveries, `pending_webhooks: 2`. |
| FR-WRK-002 | Only the six §5.1 types can create Deliveries; an allowlist in the worker rejects anything else with an error log (defence in depth against a future `invoice.tick`). | Insert of `invoice.tick` → no Delivery, error logged. |
| FR-WRK-003 | Dedupe by Event id: `UNIQUE(event_id, endpoint_id)` on Deliveries; a second job-creation for the same Event (e.g. ingest replay that slipped through) is a no-op (doc §15 "worker dedupes evt ids"). | Double insert → one row. |
| FR-WRK-004 | "Send test event" (API FR-API-061) creates a synthetic Event (`type` chosen, sample `data.object`, id `evt_test_…`) and a Delivery to that endpoint only, using the same code path. | Test event verifies with `constructEvent`. |

### Queue and execution (doc §9 "Queue in Postgres + worker (good enough)")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-010 | The worker polls `SELECT … FROM deliveries WHERE status IN ('queued','retrying') AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now()) ORDER BY next_attempt_at LIMIT $batch FOR UPDATE SKIP LOCKED`, sets `locked_until = now() + 60s`, and processes rows concurrently (default 16). Poll interval 500 ms; idle backoff to 2 s. | Two worker processes never deliver the same attempt (test with 200 jobs). |
| FR-WRK-011 | Each attempt: `POST endpoint.url` with body = `events.raw_body` (the exact bytes stored at Event creation), headers `Content-Type: application/json`, `User-Agent: Elapse/1.0`, `X-Elapse-Signature` (FR-WRK-020), `X-Elapse-Delivery: dlv_…`. Timeout **10 s** total (connect + response). No redirects followed. | Mock server records identical bytes to `raw_body`. |
| FR-WRK-012 | Success = any `2xx` → `status = succeeded`, `Event.pending_webhooks −= 1`, `endpoint.consecutive_failures = 0`. Everything else (non-2xx, timeout, DNS/TLS/connection error) = failure. `3xx` is a failure (doc §5.2 "Merchant returns 2xx"). | Table-driven test over 200, 204, 301, 400, 500, timeout, ECONNREFUSED. |
| FR-WRK-013 | Retry schedule after a failed attempt n: `0s, 30s, 2m, 10m, 1h` for attempts 1–5, then `1h, 1h, 1h` for 6–8 (Undecided 1, decided 2026-09-05); **cap 8 attempts**; after the 8th failure `status = exhausted`, `pending_webhooks −= 1`. | Assert `next_attempt_at` deltas; 8 failures → `exhausted`. |
| FR-WRK-014 | Every attempt writes `delivery_attempts(n, sent_at, duration_ms, status_code, error, request_headers, response_excerpt ≤ 1 KiB)` — this is the dashboard delivery log (design brief §3.9: event, type, status code, attempt n/8, time; drawer with headers incl. signature, body, response). | Row per attempt; excerpt truncated at 1 024 bytes. |
| FR-WRK-015 | A crashed worker's lock expires (`locked_until`) and the row is retried by another worker with the same attempt number (the crashed attempt is recorded as `error: "lock_expired"` if no attempt row exists). | Kill mid-attempt test. |
| FR-WRK-016 | Live-mode URLs: HTTPS only, resolved address must not be loopback/private/link-local (re-checked at send time, not only at creation — DNS rebinding). Test mode allows `http://` and localhost (ngrok/CLI). | SSRF test set. |

### Signing (doc §4.4; `sdk/ts/src/index.ts`)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-020 | `t` = unix seconds **at send time of this attempt**; `v1 = hex(HMAC_SHA256(secret, "${t}.${raw_body}"))`; header `X-Elapse-Signature: t=<t>,v1=<hex>`. The SDK rejects `|now − t| > 300 s`, so `t` must never be the Event's `created`. | Test: sign, then `constructEvent(raw_body, header, secret)` returns the Event; a retry 1 h later also verifies. |
| FR-WRK-021 | The signed bytes are exactly the bytes sent: no re-serialisation between storage, signing and the HTTP body. Lowercase hex; no spaces around `,` or `=` (the SDK splits on `,` then `=`). | Byte-equality test; header regex `^t=\d+,v1=[0-9a-f]{64}(,v1=[0-9a-f]{64})?$`. |
| FR-WRK-022 | The worker's signer is tested against `sdk/ts` `constructEvent` in CI (import the SDK; no re-implementation of the verifier). Python `construct_event` (Week 5) joins the same fixture. | CI job `sign-verify` green. |
| FR-WRK-023 | Signing secret is decrypted from `webhook_endpoints.secret_enc` at send time and never logged; `request_headers` in attempts stores the signature header (public) but not the secret. | Log scrubber test. |

### Resend and dashboard actions (doc §5.2 step 5 "resend"; design brief §3.9)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-030 | `POST /v1/deliveries/:id/resend` (API FR-API-064) enqueues a `manual` attempt on the same Delivery immediately, freshly signed, regardless of current status; it does not reset or extend the automatic schedule and does not change `pending_webhooks`. | Resend on `exhausted` → new attempt row, status stays `exhausted` unless the resend succeeds (then `succeeded`). |
| FR-WRK-031 | Resend attempts are recorded with `manual = true` and the actor (audit log FR-API-006). | Attempt row flag. |
| FR-WRK-032 | A Delivery to a `disabled` endpoint is skipped (`status = skipped`) at poll time; re-enabling the endpoint does not replay skipped Deliveries (Merchant uses Resend). | Test. |

### Secret rotation (doc §5.2 "secret-rotated")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-040 | After `roll_secret`, for the overlap window the Merchant chose at roll time (`previous_secret_expires_at` = now + 0 / 1 h / 24 h, dashboard decision 9, API FR-API-105) the worker signs every request with **both** secrets: header `t=<t>,v1=<hmac_new>,v1=<hmac_old>`. After `previous_secret_expires_at` only the new secret is used and `previous_secret_enc` is nulled. A roll with grace 0 nulls the old secret immediately. | Header carries two `v1` entries during overlap; one after; grace 0 → one from the first attempt. |
| FR-WRK-041 | **SDK dependency (P1):** `constructEvent` currently builds `Object.fromEntries(...)`, so a second `v1` overwrites the first — during overlap it would verify only the *last* `v1`. `sdk/ts` collects all `v1` values and accepts if **any** matches (constant-time each) — decided 2026-09-04, SDK FRD FR-SDK-020/021. Until merged, the worker places the **old** secret's `v1` last so un-migrated merchants keep verifying. | SDK test: header with two `v1`s verifies against either secret; old SDK behaviour documented in CHANGELOG. |
| FR-WRK-042 | Expiry notices: a scheduler in the worker (runs every minute) writes a `notifications` row (API FR-API-109) for each API key or endpoint secret whose `expires_at` / `previous_secret_expires_at` falls within the next 24 h and again within the next 1 h, once per (target, threshold); and an email through the API's sender when the Merchant's "key or secret about to expire" switch is on (dashboard FR-DSH-105). Endpoint auto-disable (FR-WRK-050) writes the "endpoint stopped retrying" notification and email the same way. | Two rows per rolled key over 24 h, never a third on re-run; email mock called once per row when the switch is on. |

### Endpoint health and auto-disable (design brief §3.9 "Disabled-endpoint state")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-050 | Auto-disable, time-based (Stripe's rule; [ADR 2026-09-05](../decisions/2026-09-05-worker-in-api-and-auto-disable.md), Undecided 3): `endpoint.failing_since` is set on the first failed attempt of a streak and cleared by any `2xx`. When `now − failing_since ≥ 3 days` the worker sets `disabled = true`, `disabled_reason = "auto:failing_3d"`, writes an audit row and a `notifications(kind: endpoint_exhausted)` row (API FR-API-109); the dashboard shows the disabled state with a Re-enable action, which clears `failing_since`. A warning notification is written once when the streak passes 24 h. `consecutive_failures` stays as a display counter of exhausted Deliveries. | Fixture: failures from T to T+3d → disabled at the first attempt after T+3d; a `200` at T+2d resets; warning row exactly once at T+24h; Re-enable clears the streak. |
| FR-WRK-051 | Per-endpoint success rate for the endpoints list (design brief §3.9) = succeeded / (succeeded + exhausted) over the last 7 days, computed by a SQL view. | View test. |

### Observability (doc §7 judge mode "webhook delivery log"; API FR-API-074)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-060 | Worker reports `queued`, `retrying`, `oldest_queued_age_s`, `attempts_last_minute`, `success_rate_1h` to `GET /v1/status` (via a `worker_heartbeat` row updated every 5 s). | Status reflects a stalled worker within 15 s. |
| FR-WRK-061 | Judge mode's "live webhook delivery log for this session" (checkout FRD FR-CHK-011) is `GET /v1/deliveries?subscription=sub_…` filtered through the session's Events; the worker adds nothing beyond attempt rows. | Panel shows the `subscription.canceled` attempt with `200` within 5 s of cancel in the demo. |
| FR-WRK-062 | Structured log per attempt: `delivery_id, event_id, type, endpoint_id, n, status_code, duration_ms, outcome`. Never the body, never the secret. | Log snapshot. |

### Keeper (contracts FR-CON-033/034, cadence Undecided 6 = 5 min; added 2026-09-05 when built, derived from the signed contracts FRD)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-070 | The worker process runs a keeper tick every `KEEPER_TICK_MS` (30 s). Each tick selects `active` Subscriptions with a `stream_address` whose `COALESCE(last_settle_requested_at, started_at)` is older than `KEEPER_CADENCE_S` (code default 300; **3600 on the hosted worker** per [ADR 2026-09-08](../decisions/2026-09-08-keeper-cadence-one-hour.md)) and calls `StreamFactory.settleBatch` through the relayer in chunks of 50 per chain, then stamps `last_settle_requested_at`. Paused, incomplete and canceled Subscriptions are never selected. A failed batch is logged and left for the next tick; the loop never stops. `KEEPER=0` disables it. | Unit tests with a fake chain: due-by-cadence selection, chunking, failure leaves rows untouched. |
| FR-WRK-071 | A Subscription past its cap (`started_at + max_duration_seconds + paused_seconds ≤ now`) is selected on the next tick regardless of cadence, because the first `settle()` after exhaustion is what emits the cap-end pair (`Settled` + `StreamCanceled`, contracts FR-CON-041). The keeper writes nothing else; the logs return through the indexer and ingest. | Test: capped stream settled at once, a paused-past-cap stream not; **live 2026-09-05**: 60 s cap ended by the keeper, `invoice.settled`, `invoice.payment_failed`, `subscription.canceled` delivered 78 s after start. |
| FR-WRK-072 | Keeper gas ([ADR 2026-09-07 keeper gas](../decisions/2026-09-07-keeper-gas-per-stream-estimate.md)): `settleBatch` must never be sent with the node's estimate for the batch, because the factory's try/catch turns an inner out-of-gas into a "successful" no-op that burns the whole limit. Each tick the keeper first estimates gas for `settle()` **directly on every due stream** (a revert there is honest); a stream whose direct estimate reverts is skipped this tick, logged `{stream, skipped: reason}` once per hour at most, and left for reconciliation (indexer FR-IDX-024); the batch is sent with `gas = 25 000 + sum of direct estimates x 1.25`. A tick whose batch receipt shows zero logs for a non-empty batch logs `{keeper_batch_no_effect: true}` at error level, since that is exactly the drain signature. | Unit test on the gas arithmetic with a fake chain; integration test with the fake chain: a stream whose direct estimate reverts is skipped and the batch carries the summed gas; log line asserted. |
| FR-WRK-073 | Reconcile (William 2026-09-07, option 1; closes the platform side of indexer FR-IDX-024): the worker runs a reconcile pass every `RECONCILE_INTERVAL_S` (3600) and `bun run reconcile` runs it once. For every `active` or `paused` Subscription with a `stream_address`, it reads the stream's `status()` on chain. When the chain says canceled while the row does not, it fetches that stream's `Settled` and `StreamCanceled` logs (`eth_getLogs` from the row's start block) and runs each through the same ingest path the indexer uses, which is idempotent on `txHash + logIndex`, so the Events, Invoices, ledger rows and webhook deliveries are exactly what the indexer would have produced. A stream the keeper skips (FR-WRK-072) is reconciled on the next pass regardless of the interval. Each reconciled Subscription logs `{reconciled: sub_…, logs: n}`; a stream whose chain read fails is logged and left for the next pass. Nothing is written from view calls alone. | Fake chain: DB active + chain canceled with two logs → both ingested once, row canceled, second pass is a no-op; chain active → untouched; read failure → logged, untouched. `bun run reconcile` exits 0 with the count. |
| FR-WRK-074 | **Relayer gas sample** (William 2026-09-08, grill answers: runway not a fixed balance; address shown; the worker reads the chain, never the public route). On every keeper tick the worker reads the relayer's native MON balance for the configured chain and writes one row to `relayer_balance_samples (chain_id, address, balance_wei numeric(78,0), sampled_at)`; samples older than 7 days are deleted on the same tick. A failed read is logged and skipped; the tick's settle work is unaffected. Runs whenever the keeper runs (`KEEPER=0` disables both). | Fake chain: a tick writes one sample with the fake balance; a read failure writes nothing and the tick still settles; rows older than 7 days are gone after a tick. |
| FR-WRK-075 | **Unstarted-session sweep** (2026-09-14). Every keeper tick, select Subscriptions that are `incomplete` with a funded stream and older than `min(max_duration_seconds, 15 min)` (API FR-API-127) and cancel them through the relayer, refunding the subscriber in full (contracts FR-CON-056). Modelled on `keeper.ts`: select due rows, submit, let ingest carry the result back. One failure never blocks the rest of the batch, and a row already `canceling` is skipped. | Injected clock: a funded unstarted row past the window is cancelled once; one inside it is untouched; an `active` row is never selected; a failing cancel does not stop the batch. |

## Build order (decided 2026-09-05, William)

| Week | Ships | FRs |
| --- | --- | --- |
| 2 | Delivery loop: poll with `FOR UPDATE SKIP LOCKED`, decrypt and sign (both secrets in a grace window), POST with 10 s timeout and no redirects, 2xx rule, schedule capped at 8, attempt rows, `exhausted`/`skipped`, time-based auto-disable with its notification and audit rows, deliveries read routes and Resend | FR-WRK-010–016, 020–023, 030–032, 040–041, 050, 062 |
| 3 | ~~Keeper loop~~ **built 2026-09-05 (FR-WRK-070/071)** · ~~worker heartbeat~~ **built 2026-09-06 (FR-WRK-060)** | keeper (contracts FR-CON-030s), FR-WRK-060–061 |
| 4 | Expiry notices and emails (needs dashboard notifications) · success-rate view for the endpoints list · CLI `listen --forward` transport (Undecided 5) | FR-WRK-042, 051, CLI FRD |

Nothing is stubbed: a Week 3 or 4 item is absent until it is built.

## Business rules

| Id | Rule |
| --- | --- |
| BR-WRK-001 | No per-second or timer-driven Events. The worker only delivers Events created from lifecycle chain events, test clocks, or "Send test event" (doc §2, §5.1). |
| BR-WRK-002 | The signed payload is `{t}.{raw_body}`, HMAC-SHA256 with the endpoint's `whsec_`, `t` fresh per attempt; the reference verifier is `sdk/ts` `constructEvent` — if the worker and the SDK disagree, the worker is wrong. |
| BR-WRK-003 | Exactly the schedule `0s, 30s, 2m, 10m, 1h`, cap 8, 10 s timeout, 2xx = success (`worker/README.md`). Change only by editing this FRD. |
| BR-WRK-004 | At-least-once delivery, no ordering guarantee across Events; Merchants must be idempotent on `evt_` id and read `data.object.status`. Documented in docs "Webhooks". |
| BR-WRK-005 | Secrets are never logged, never returned by the worker, never sent to the indexer (BR-IDX-001). |
| BR-WRK-006 | Postgres is the only queue; no Kafka, Redis or SQS for 13 Oct (doc §9). |
| BR-WRK-007 | Test and live Deliveries share the code path but never cross: an endpoint receives only Events of its own `livemode` (BR-API-001). |

## Data / interfaces

```
deliveries(id dlv_…, event_id, endpoint_id, status queued|retrying|succeeded|exhausted|skipped, attempt, next_attempt_at, locked_until, created_at)   -- authoritative status list (decided 2026-09-05; API FRD corrected)
    UNIQUE(event_id, endpoint_id)
delivery_attempts(id, delivery_id, n, manual bool, actor, sent_at, duration_ms, status_code, error, request_headers jsonb, response_excerpt text)
webhook_endpoints(+ consecutive_failures, failing_since, warned_24h_at, disabled_reason, previous_secret_enc, previous_secret_expires_at)
worker_heartbeat(worker_id, seen_at, queued, retrying, oldest_queued_age_s)

Request:  POST {url}
          Content-Type: application/json
          User-Agent: Elapse/1.0
          X-Elapse-Signature: t=1756800000,v1=<64 hex>[,v1=<64 hex>]
          X-Elapse-Delivery: dlv_…
          <raw_body: the §5.3 Event JSON, byte-identical to events.raw_body>
Schedule: attempt n fails → next_attempt_at = sent_at + [0s, 30s, 2m, 10m, 1h, …][n]  (n from 1; cap 8)
Env:      DATABASE_URL, WEBHOOK_SECRET_KEK, WORKER_CONCURRENCY=16, WORKER_BATCH=50
```

## Undecided (human)

1. ~~**Delays for attempts 6–8.**~~ **Decided 2026-09-05 (William): (a)** repeat `1h` for attempts 6–8, total ≈ 4 h 13 m (FR-WRK-013).
2. ~~**Secret-rotation overlap window.**~~ **Decided 2026-09-03 (dashboard decision 9):** the Merchant picks per roll: now, 1 h, or 24 h (FR-WRK-040); the SDK fix in FR-WRK-041 is decided too.
3. ~~**Auto-disable threshold.**~~ **Decided 2026-09-05 (William): (c)** time-based, 3 days of continuous failure with a 24 h warning, Stripe's rule; the count-based draft was a demo shortcut and the failure need not be demoed (FR-WRK-050, [ADR](../decisions/2026-09-05-worker-in-api-and-auto-disable.md)).
4. ~~**Worker process shape.**~~ **Decided 2026-09-05 (William):** `api/src/worker/`, a second Bun process (`bun run worker`) from the same package, deployed as a second Railway service; imports only `api/src/db` and `api/src/lib`. the root `worker/` folder is removed (William, 2026-09-05) ([ADR](../decisions/2026-09-05-worker-in-api-and-auto-disable.md)).
5. ~~**CLI `listen --forward` transport.**~~ **Decided 2026-09-06 (William), [ADR](../decisions/2026-09-06-cli-transport-and-session.md):** one persistent `kind: cli` Webhook endpoint per Merchant per mode; the **API** streams its Deliveries to the CLI over SSE, signing each frame at send time with the endpoint's secret through this worker's `signPayload`, and the CLI's ack writes the attempt row (API FR-API-130–134). **This worker never claims `kind: cli` Deliveries** (`claimDue` excludes them; FR-WRK-001 amended below), never auto-disables a CLI endpoint (FR-WRK-050), and marks CLI Deliveries `queued` for more than 10 minutes as `skipped` on its tick (FR-API-134). The CLI endpoint receives a Delivery only while `cli_connected_until > now()`.

## Open

- Whether `X-Elapse-Delivery` (or an `Idempotency-Key`) header is worth adding to the docs; the SDK ignores it today.
- Whether "Send test event" ids should be `evt_test_…` or ordinary `evt_…` with `livemode: false` (Stripe uses ordinary ids).
- Rate limiting deliveries per endpoint (e.g. max 20 in flight) — not needed at MVP volume; note for post-hackathon.

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-04 | Claude (for William) | Dashboard decision 9 applied: FR-WRK-040 overlap window is chosen per roll (0 / 1 h / 24 h), Undecided 2 closed; FR-WRK-041 SDK change marked decided; FR-WRK-042 expiry and exhaustion notifications for the dashboard bell and emails (decision 14). |
| 2026-09-05 | Claude (for William) | Grill round: worker inside `api/` as a second process; attempts 6–8 repeat 1 h; auto-disable becomes time-based (3 days, 24 h warning, Stripe's rule) with `failing_since`; status model `skipped` + `manual` attempt flag confirmed as authoritative over the API FRD; build order table (Week 2 delivery only, keeper/heartbeat Week 3, notices/CLI Week 4). [ADR 2026-09-05](../decisions/2026-09-05-worker-in-api-and-auto-disable.md). Awaiting signature. |
| 2026-09-05 | William | Signed. Week 2 delivery loop build begins. |
| 2026-09-05 | Claude (for William) | Root `worker/` folder removed; the worker is only `api/src/worker/`. |
| 2026-09-05 | Claude (for William) | FR-WRK-070/071 keeper added and built in `api/src/worker/keeper.ts`, running inside the worker process (migration 0010 `last_settle_requested_at`). Post-signature addition derived from the signed contracts FRD (FR-CON-033/034/041, cadence 5 min); William to confirm. Cap end proven live. |
| 2026-09-06 | Claude (for William) | FR-WRK-060 built: `worker_heartbeat` row (migration 0011) written every 5 s with `attempts_last_minute`, `success_rate_1h`, `keeper_last_tick_at`; `GET /v1/status.worker` gains `alive` (seen within 15 s), `last_seen_at` and those counters. |
| 2026-09-06 | Claude (for William) | Undecided 5 closed by the CLI grill: `kind: cli` endpoints are streamed by the API, not delivered by this worker; `claimDue` excludes them, auto-disable skips them, stale CLI Deliveries expire to `skipped` (API FR-API-130–134). |
| 2026-09-06 | William | Confirmed the FR-WRK-001 amendment and Undecided 5 closure. |
| 2026-09-06 | Claude (for William) | Shutdown: the keeper, heartbeat and CLI-expiry loops slept unabortably, so SIGTERM took up to 60 s to stop the worker (found by the Quickstart CI script). Shared abortable `sleep(ms, signal)` in `worker/sleep.ts`; the worker now stops within a moment. Tests in `test/sleep.test.ts`. |
| 2026-09-06 | Claude (for William) | Found in William's first dashboard run: (1) every manual attempt was numbered 2 and the drawer's counter never moved; manual attempts are now numbered after every attempt so far (worker and CLI ack alike) and deliveries carry `attempts_made` (all rows) beside `attempt` (automatic only, the schedule); (2) FR-WRK-032 now also covers Resend: `POST /v1/deliveries/:id/resend` answers `400` on a disabled endpoint and the Event-level resend skips disabled endpoints. Dashboard drawer shows "N attempts" and disables Resend with the reason. |
| 2026-09-07 | Claude (for William) | FR-WRK-072 added ([ADR 2026-09-07 keeper gas](../decisions/2026-09-07-keeper-gas-per-stream-estimate.md)): a capped testnet stream drained 5 MON overnight through 225 no-op batch settles gassed by the node's estimate. Awaiting signature. |
| 2026-09-07 | William | Signed FR-WRK-072. |
| 2026-09-07 | Claude (for William) | Built FR-WRK-072: `ChainClient` gains `estimateSettle` (direct `settle()` estimate, reverts honestly), `settleBatch(…, gas)` and `receiptLogCount`; the keeper estimates every due stream, skips reverting ones (`skipped` log at most hourly per stream), sends the batch with `batchGas` = 25 000 + Σ × 1.25, and logs `keeper_batch_no_effect` at error level on a zero-log receipt. Proven live: the stuck testnet stream ended on the first tick (4 logs, 0.03 MON once); it is now skipped because the chain says canceled while the row still says active, since its events predate the current indexer — the reconcile pass (FR-IDX-024) is the remaining piece. Tests in `keeper.test.ts` (4 new); 283 pass. |
| 2026-09-07 | Claude (for William) | FR-WRK-073 reconcile added (option 1 of three: the platform pulls a diverged stream's own logs through ingest). Awaiting signature. |
| 2026-09-07 | William | Signed FR-WRK-073. |
| 2026-09-07 | Claude (for William) | Built FR-WRK-073: `src/worker/reconcile.ts` (`runReconcileOnce`, `ledgerFor` by the indexer's rules, `reconcileForever` hourly plus keeper-requested streams on a 30 s poll), `bun run reconcile`; `ChainClient` gains `readStreamState` (status, parties, `settledSeconds`) and `readStreamLogs`, which scans newest-first in 100-block windows (Monad's `eth_getLogs` cap, `LOG_WINDOW_BLOCKS`) and stops once the cancel and every settled second are in hand. Proven live: `bun run reconcile` closed the stuck testnet subscription through ingest (Settled + StreamCanceled, `invoice.settled`, `invoice.payment_failed`, `subscription.canceled`, row `canceled/cap_reached`, 300 s). Tests in `reconcile.test.ts` (4); 287 pass. |
| 2026-09-08 | William | Deployed keeper cadence is 1 hour (`KEEPER_CADENCE_S=3600` on Railway); FR-WRK-070 amended to say so. Reason and numbers in [ADR 2026-09-08](../decisions/2026-09-08-keeper-cadence-one-hour.md). |
| 2026-09-08 | Claude (for William) | FR-WRK-074 relayer gas sample added from the grill (runway alert; ADR 2026-09-08 keeper cadence, decision 2). **Awaiting William's signature.** |
| 2026-09-08 | William | Signed FR-WRK-074. |
| 2026-09-09 | Claude (for William) | Built FR-WRK-042: `expiryForever` runs `expirySweep` every minute beside the delivery loop, in its own try/catch so a sweep failure never stalls deliveries. Bands are 1 h–24 h and 0–1 h, each excluding the tighter, so a target thirty minutes from expiry gets the 1 h notice only; one row per (target, threshold) via `dedupe_key`. FR-WRK-050's auto-disable notice is now also emailed after the transaction commits. Tests in `worker-notify.test.ts`. |
| 2026-09-14 | Claude (for Furqaan) | **Awaiting sign-off.** FR-WRK-075 sweeps authorised-but-unstarted sessions and refunds them, bounding how long a merchant may hold a subscriber's escrow without starting the meter. Depends on API FR-API-127 and contracts FR-CON-056. |
| 2026-09-14 | Furqaan | **Signed** FR-WRK-075. |
| 2026-09-14 | Claude (for Furqaan) | **Built** FR-WRK-075 as `api/src/worker/unstarted.ts`, called from `keeperForever` inside its own try/catch so a failing sweep never stops settlement. The select leads with `status`/`start_mode` to ride the `subscriptions_unstarted_idx` partial index from `0019`. **Not in the signed text**, recorded for review: (1) the acceptance text says a row already `canceling` is skipped, but no such status exists — the enum stays `incomplete\|active\|paused\|canceled` — and `pending_tx` already holds the funding tx on every authorised row, so migration `0021_cancel_submitted` adds `subscriptions.cancel_submitted_at`, stamped only after the relayer accepts the cancel so a failed one is retried on the next tick rather than stranded; (2) the sweep also excludes rows whose `start_submitted_at` is set — the merchant has started those and they stay `incomplete` until `StreamStarted` ingests (FR-API-049), so sweeping them would refund a session that was legitimately started. |
