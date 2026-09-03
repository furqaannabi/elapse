# Webhook worker (`worker/` — Postgres-queued deliveries) — FRD

Status: **Draft — awaiting human sign-off** · Surface: Platform (Merchant webhook delivery) · Sources: detailed doc §2 "Not a webhook per second", §4.4 Signature, §5.1 catalog, §5.2 steps 3–5, §5.3 payload, §9 "Queue in Postgres + worker. No Kafka.", §10 step 3, §12 Week 2/4, §15; `worker/README.md`; `sdk/ts/src/index.ts` (`constructEvent`); design brief §3.9; API FRD FR-API-060–064, FR-API-073.

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
| FR-WRK-001 | When the API inserts an Event, in the same transaction it inserts one Delivery per Webhook endpoint of that Merchant where `livemode` matches, `disabled = false`, and `events[]` contains the type or `"*"`. `status = queued`, `attempt = 0`, `next_attempt_at = now()`. `Event.pending_webhooks` = number of Deliveries created. | 1 Event × 2 matching endpoints + 1 disabled → 2 Deliveries, `pending_webhooks: 2`. |
| FR-WRK-002 | Only the six §5.1 types can create Deliveries; an allowlist in the worker rejects anything else with an error log (defence in depth against a future `invoice.tick`). | Insert of `invoice.tick` → no Delivery, error logged. |
| FR-WRK-003 | Dedupe by Event id: `UNIQUE(event_id, endpoint_id)` on Deliveries; a second job-creation for the same Event (e.g. ingest replay that slipped through) is a no-op (doc §15 "worker dedupes evt ids"). | Double insert → one row. |
| FR-WRK-004 | "Send test event" (API FR-API-061) creates a synthetic Event (`type` chosen, sample `data.object`, id `evt_test_…`) and a Delivery to that endpoint only, using the same code path. | Test event verifies with `constructEvent`. |

### Queue and execution (doc §9 "Queue in Postgres + worker (good enough)")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-010 | The worker polls `SELECT … FROM deliveries WHERE status IN ('queued','retrying') AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now()) ORDER BY next_attempt_at LIMIT $batch FOR UPDATE SKIP LOCKED`, sets `locked_until = now() + 60s`, and processes rows concurrently (default 16). Poll interval 500 ms; idle backoff to 2 s. | Two worker processes never deliver the same attempt (test with 200 jobs). |
| FR-WRK-011 | Each attempt: `POST endpoint.url` with body = `events.raw_body` (the exact bytes stored at Event creation), headers `Content-Type: application/json`, `User-Agent: Elapse/1.0`, `X-Elapse-Signature` (FR-WRK-020), `X-Elapse-Delivery: dlv_…`. Timeout **10 s** total (connect + response). No redirects followed. | Mock server records identical bytes to `raw_body`. |
| FR-WRK-012 | Success = any `2xx` → `status = succeeded`, `Event.pending_webhooks −= 1`, `endpoint.consecutive_failures = 0`. Everything else (non-2xx, timeout, DNS/TLS/connection error) = failure. `3xx` is a failure (doc §5.2 "Merchant returns 2xx"). | Table-driven test over 200, 204, 301, 400, 500, timeout, ECONNREFUSED. |
| FR-WRK-013 | Retry schedule after a failed attempt n: `0s, 30s, 2m, 10m, 1h` for attempts 1–5, then Undecided 1 for 6–8; **cap 8 attempts**; after the 8th failure `status = exhausted`, `pending_webhooks −= 1`. | Assert `next_attempt_at` deltas; 8 failures → `exhausted`. |
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
| FR-WRK-040 | After `roll_secret`, for the overlap window (Undecided 2, default 24 h) the worker signs every request with **both** secrets: header `t=<t>,v1=<hmac_new>,v1=<hmac_old>`. After `previous_secret_expires_at` only the new secret is used and `previous_secret_enc` is nulled. | Header carries two `v1` entries during overlap; one after. |
| FR-WRK-041 | **SDK dependency (P1):** `constructEvent` currently builds `Object.fromEntries(...)`, so a second `v1` overwrites the first — during overlap it would verify only the *last* `v1`. `sdk/ts` must be changed to collect all `v1` values and accept if **any** matches (constant-time each) — already raised as SDK FRD Undecided 2 (FR-SDK-020/021). Until merged, the worker places the **old** secret's `v1` last so un-migrated merchants keep verifying. | SDK test: header with two `v1`s verifies against either secret; old SDK behaviour documented in CHANGELOG. |

### Endpoint health and auto-disable (design brief §3.9 "Disabled-endpoint state")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-050 | `endpoint.consecutive_failures` increments when a Delivery becomes `exhausted` and resets on any success. When it reaches N (Undecided 3), the worker sets `disabled = true`, `disabled_reason = "auto:consecutive_failures"`, writes an audit row, and the dashboard shows the disabled state with a Re-enable action. | N exhausted Deliveries → disabled; the next Event creates no Delivery for it. |
| FR-WRK-051 | Per-endpoint success rate for the endpoints list (design brief §3.9) = succeeded / (succeeded + exhausted) over the last 7 days, computed by a SQL view. | View test. |

### Observability (doc §7 judge mode "webhook delivery log"; API FR-API-074)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-WRK-060 | Worker reports `queued`, `retrying`, `oldest_queued_age_s`, `attempts_last_minute`, `success_rate_1h` to `GET /v1/status` (via a `worker_heartbeat` row updated every 5 s). | Status reflects a stalled worker within 15 s. |
| FR-WRK-061 | Judge mode's "live webhook delivery log for this session" (checkout FRD FR-CHK-011) is `GET /v1/deliveries?subscription=sub_…` filtered through the session's Events; the worker adds nothing beyond attempt rows. | Panel shows the `subscription.canceled` attempt with `200` within 5 s of cancel in the demo. |
| FR-WRK-062 | Structured log per attempt: `delivery_id, event_id, type, endpoint_id, n, status_code, duration_ms, outcome`. Never the body, never the secret. | Log snapshot. |

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
deliveries(id dlv_…, event_id, endpoint_id, status queued|retrying|succeeded|exhausted|skipped, attempt, next_attempt_at, locked_until, created_at)
    UNIQUE(event_id, endpoint_id)
delivery_attempts(id, delivery_id, n, manual bool, actor, sent_at, duration_ms, status_code, error, request_headers jsonb, response_excerpt text)
webhook_endpoints(+ consecutive_failures, disabled_reason, previous_secret_enc, previous_secret_expires_at)
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

1. **Delays for attempts 6–8.** The doc lists five delays and a cap of eight. (a) repeat `1h` (total ≈ 4 h 13 m); (b) `2h, 4h, 8h` (≈ 15 h); (c) cap at 5 and ignore "8". **Recommend (a)** — matches the README literally and finishes within a demo day.
2. **Secret-rotation overlap window.** 1 h / 24 h / until the Merchant confirms. **Recommend 24 h** (Stripe's default), contingent on the SDK fix in FR-WRK-041.
3. **Auto-disable threshold N.** (a) 3 consecutive exhausted Deliveries; (b) 10; (c) time-based, 3 days of failures (Stripe). **Recommend (a)** — at hackathon volume, time-based never triggers.
4. **Worker process shape.** (a) separate `worker/` Node process sharing the API's DB package; (b) in-process loop inside the API; (c) cron-invoked. **Recommend (a)** for isolation; (b) is acceptable for Week 2's "retry once" skeleton.
5. **CLI `listen --forward` transport (Week 4; CLI FRD FR-CLI-010–013 requires byte-identical forwarding with the platform's real signature).** (a) CLI registers a temporary test-mode Webhook endpoint whose URL is a platform relay; the worker delivers to the relay normally and the CLI long-polls `GET /v1/cli/deliveries`; (b) WebSocket push of the same Deliveries; (c) CLI runs a public tunnel itself. **Recommend (a)** — reuses this worker unchanged and the CLI prints that endpoint's `whsec_`.

## Open

- Whether `X-Elapse-Delivery` (or an `Idempotency-Key`) header is worth adding to the docs; the SDK ignores it today.
- Whether "Send test event" ids should be `evt_test_…` or ordinary `evt_…` with `livemode: false` (Stripe uses ordinary ids).
- Rate limiting deliveries per endpoint (e.g. max 20 in flight) — not needed at MVP volume; note for post-hackathon.

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
