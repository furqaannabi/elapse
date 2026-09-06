# `@elapse/cli` (`elapse listen --forward`) — FRD

Status: **Signed 2026-09-06 (William)** · Surface: Merchant developer tooling (terminal, Node 20+) · Sources: detailed doc §5.2, §6 (Quickstart, Webhooks nav), §10 step 3, §12 Week 4, §13, §14; `cli/README.md`.

## Problem

A merchant following the Quickstart runs a server on `localhost:3000`; the platform's webhook worker cannot reach it. Without a forwarder the quickstart needs ngrok and the demo needs a public box. `npx @elapse/cli listen --forward localhost:3000/webhooks` must receive the merchant's Events, print the signed body and headers, deliver them to the local URL unchanged, and show the response code — the terminal that is on screen in demo step 3 (§10) next to the merchant server.

## User stories

1. As a merchant engineer, I want one `npx` command that receives my Events locally, so that the Quickstart finishes in under 10 minutes with no tunnel service.
2. As a merchant engineer, I want each Event printed as pretty JSON with its `X-Elapse-Signature` header, so that I can see `seconds_elapsed` and the signature the doc describes.
3. As a merchant engineer, I want the CLI to forward byte-for-byte, so that `constructEvent` in my server verifies the real signature, not a CLI re-signature.
4. As a merchant engineer, I want to see the status code my server returned, so that a 500 in my handler is visible immediately.
5. As a demo presenter, I want to replay a Delivery, so that a missed webhook does not stall the recording.
6. As a judge cloning `examples/saas`, I want the CLI to explain in one line how to authenticate, so that I am not searching the docs.

## Functional requirements

### Authentication (§2 "publishable key + secret key, Stripe-style", §8 API keys)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CLI-001 | The CLI authenticates with a merchant secret key read from `ELAPSE_SECRET_KEY`, then `--api-key`, then a saved profile (`~/.config/elapse/config.json`, mode 0600). Missing key exits 2 with: `Set ELAPSE_SECRET_KEY or run: elapse login`. | Unit test for precedence; exit code and message asserted. |
| FR-CLI-002 | `elapse login` prompts for a secret key (hidden input), validates it with `products.list()`, stores it in the profile, and prints the merchant name and mode (test/live). An invalid key prints the API error and stores nothing. | Mock API; file contents and permissions asserted. |
| FR-CLI-003 | `elapse logout` deletes the stored profile. `--base-url` / `ELAPSE_BASE_URL` override the API host for testnet/staging. | File removed; mock receives requests at the override host. |

### `listen --forward` (§6, §10 step 3, §12 Week 4)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CLI-010 | `elapse listen --forward <url>` calls `POST /v1/cli/sessions` (API FR-API-130), which returns the merchant's persistent CLI endpoint for this mode (created on first use, `kind: cli`) with its signing secret and a stream URL, then reads that SSE stream (FR-API-131) until Ctrl-C. Every Event that matches the CLI endpoint while the stream is open arrives as one Delivery frame. `<url>` without a scheme is `http://`. | Integration test with a mock platform: 3 emitted Events arrive within 1 s. |
| FR-CLI-011 | On start the CLI prints the signing secret the forwarded Deliveries are signed with (`whsec_…`) once, with `Ready. Forwarding to http://localhost:3000/webhooks`. | Snapshot of startup output. |
| FR-CLI-012 | For each Delivery it prints: timestamp, `evt_` id, `type`, the full `X-Elapse-Signature` header, and the JSON body pretty-printed (`--compact` for one line). | Snapshot test on a §5.3 payload. |
| FR-CLI-013 | The CLI POSTs the **exact raw body bytes** and all `X-Elapse-*` headers plus `Content-Type: application/json` to the forward URL; it never parses-and-reserialises the body and never re-signs. | Test: body with unusual whitespace/unicode arrives byte-identical; header equal. |
| FR-CLI-014 | After forwarding it prints the local response code and duration (`→ 200 OK (12 ms)`); connection refused / timeout (10 s, matching §5.2) prints `→ failed: ECONNREFUSED` and continues listening. Either way it acks the Delivery (`POST …/deliveries/:id/ack {status_code \| error, duration_ms}`, FR-API-132) so the dashboard Delivery log shows what the local server returned; `--no-forward` acks with `status_code: 200` and `printed_only: true`. An ack that fails is retried once and then dropped (the Delivery expires per FR-CLI-018). | One test per outcome; ack body asserted. |
| FR-CLI-015 | `--events subscription.canceled,invoice.payment_failed` filters what is forwarded (still printed as skipped). Default: all six MVP types (§5.1). | Filter test. |
| FR-CLI-016 | The CLI reconnects with backoff (1 s → 30 s) when the platform connection drops and prints one line per attempt; Events emitted during the gap are delivered after reconnect. | Mock drops the connection; count of delivered Events equals emitted. |
| FR-CLI-017 | `--print-secret` re-prints the signing secret; `--no-forward` prints only (works without a local server). | Output tests. |
| FR-CLI-018 | Session lifetime (William 2026-09-06, Q6 option a): the CLI endpoint counts as enabled only while a stream is open. The stream carries a heartbeat every 15 s and the platform treats the endpoint as connected for 60 s after the last frame or heartbeat, so a reconnect (FR-CLI-016) drains what queued in the gap. An Event fired while no stream is connected creates **no** CLI Delivery. A CLI Delivery not acked within 10 minutes is marked `skipped` by the platform. The CLI endpoint is never auto-disabled for failures (worker FR-WRK-050 excludes `kind: cli`). | Mock: Event after Ctrl-C creates no Delivery; Event during a 5 s drop is delivered after reconnect; unacked row is `skipped` after 10 min (clock injected). |

### Replay and helpers (§5.2 "resend", §10 step 4)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CLI-020 | `elapse events resend <evt_…>` calls `POST /v1/events/:id/resend` (API FR-API-133, Event-level, Stripe's `events resend`): the platform requests a manual attempt on every existing Delivery of that Event, including the CLI endpoint's when a stream is connected, and the command prints one line per Delivery (`dlv_… → endpoint url/CLI → queued`). | Mock API receives the call; output asserted; unknown id exits 1 with the API error. |
| FR-CLI-021 | `elapse events list [--limit 20] [--type …]` prints recent Events as a table (`id, type, created, pending_webhooks`). | Table snapshot. |
| FR-CLI-022 | `elapse products create --name "GPU · 4090" --rate 0.004` calls `products.create` and prints the `prod_` id; `elapse checkout create --product prod_… --success-url … --cancel-url …` prints `session.url`. | Mock asserts request bodies equal the §4.2 snippet. |
| FR-CLI-023 | `--json` on every command emits machine-readable output to stdout and human text to stderr. | `jq` parses output in test. |
| FR-CLI-024 | `elapse --help` and `elapse <cmd> --help` list every command above; there are no others. | Snapshot; hidden commands fail the test. |

### Packaging (§13, §14)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CLI-030 | Published as `@elapse/cli` with a `bin: { elapse }`; runs via `npx @elapse/cli listen …` on a clean machine with Node 20+ in under 15 s cold. | CI job runs `npx` from the packed tarball. |
| FR-CLI-031 | Depends on `@elapse/sdk` for all API calls (no second HTTP client) plus one argument parser; total install size < 5 MB. | `npm ls --prod` snapshot; size check. |
| FR-CLI-032 | Exit codes: 0 success, 1 runtime error, 2 usage/auth error. | Asserted per command. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-CLI-001 | The CLI never re-signs, rewrites, or reorders a Delivery body or its signature; the merchant's `constructEvent` must verify the platform's original signature. |
| BR-CLI-002 | The secret key is never printed, never written to logs, and stored only in the 0600 profile; `--json` output redacts it. The signing secret is printed only at start and on `--print-secret`. |
| BR-CLI-003 | Live-mode keys print a red `LIVE` banner on every command; `listen` in live mode requires `--live` to proceed. |
| BR-CLI-004 | The CLI receives Deliveries from the platform only; it never talks to the indexer or chain (§5.2: indexer must not know merchant secrets). |
| BR-CLI-005 | Output uses domain words — Event, Delivery, endpoint — never "tx", "block", or "0x". |
| BR-CLI-006 | Forward timeout is 10 s, identical to the worker (§5.2), so local behaviour predicts production. |
| BR-CLI-007 | `listen` receives only the CLI endpoint's own Deliveries. It never mirrors Deliveries addressed to the merchant's other endpoints; those are observed in the dashboard. |

## Interfaces

```
elapse login | logout
elapse listen --forward <url> [--events a,b] [--compact] [--no-forward] [--print-secret] [--live]
elapse events list [--limit n] [--type t] | elapse events resend <evt_id>
elapse products create --name <s> --rate <decimal-string>
elapse checkout create --product <prod_id> --success-url <u> --cancel-url <u>
Global: --api-key, --base-url, --json, --help, --version
Env:    ELAPSE_SECRET_KEY, ELAPSE_BASE_URL, NO_COLOR
Platform endpoints (API FRD FR-API-130–133, decided 2026-09-06):
  POST /v1/cli/sessions                                → { id: clis_…, endpoint_id: wh_…, signing_secret: whsec_…, stream_url, livemode, merchant_name }
  GET  /v1/cli/sessions/:id/stream   (text/event-stream, sk_ bearer)
        event: delivery   data: { id: dlv_…, event_id, type, created, headers: { "X-Elapse-Signature": …, "X-Elapse-Delivery": dlv_…, "Content-Type": "application/json" }, raw_body }
        event: heartbeat  data: { at }                  every 15 s
  POST /v1/cli/sessions/:id/deliveries/:dlv/ack        { status_code?: int, error?: string, duration_ms: int, printed_only?: bool }
  POST /v1/events/:id/resend                           → { object: "list", data: [Delivery summary…] }
Transport: SSE, reconnect with Last-Event-ID = last dlv id so the platform replays unacked frames (FR-CLI-016).
```

Example session (demo step 3, §10):

```
$ npx @elapse/cli listen --forward localhost:3000/webhooks
Elapse CLI 0.1.0 · test mode · merchant Acme GPU
Your webhook signing secret is whsec_3k9…  (put it in ELAPSE_WEBHOOK_SECRET)
Ready. Forwarding to http://localhost:3000/webhooks

14:02:11  evt_1S2a…  subscription.created    → 200 OK (9 ms)
14:02:26  evt_1S2b…  subscription.canceled   → 200 OK (11 ms)
          X-Elapse-Signature: t=1756800146,v1=5f1c…e2
          { "id": "evt_1S2b…", "type": "subscription.canceled", "data": { "object": { "seconds_elapsed": 83, "amount_settled": "0.33", … } } }
14:03:40  evt_1S2c…  invoice.payment_failed  → 500 Internal Server Error (3 ms)
^C  3 received · 2 forwarded OK · 1 failed
```

## Undecided (human)

1. ~~**Transport platform → CLI.**~~ **Decided 2026-09-06 (William): (a) SSE** with a per-Delivery ack carrying the local status code and duration (FR-CLI-014, API FR-API-131/132). Settles worker FRD Undecided 5 the same way. [ADR](../decisions/2026-09-06-cli-transport-and-session.md).
2. ~~**How the CLI session is signed.**~~ **Decided 2026-09-06 (William): (a) one persistent CLI endpoint per merchant per mode**, `kind: cli`, created on the first `listen`, its `whsec_` stable across runs and printed at start (FR-CLI-010/011). Shown in the dashboard endpoints list as "CLI" with its Deliveries.
3. ~~**Replay scope.**~~ **Decided 2026-09-06 (William): (a) ship**, Event-level: `POST /v1/events/:id/resend` + `elapse events resend` (FR-CLI-020), alongside the dashboard's per-Delivery resend, as Stripe does.
4. ~~**Test-clock helpers.**~~ **Decided 2026-09-06 (William): none.** The demo is a real 15-second cancel; the docs "Test clocks" page becomes "Testing" (docs-site FRD to follow). API FR-API-13x test clocks stay unbuilt.
5. ~~**`login` method.**~~ **Decided 2026-09-06 (William): paste** the secret key at a hidden prompt (FR-CLI-002); `ELAPSE_SECRET_KEY` skips login. Device-code flow is post-hackathon.
6. ~~**CLI Deliveries when nobody is listening.**~~ **Decided 2026-09-06 (William): (a)** the endpoint is enabled only while a stream is open, 60 s grace, unacked rows `skipped` after 10 min (FR-CLI-018).

## Implementation decisions (Claude, 2026-09-06, from the code)

- **Who signs.** The worker's claim query excludes `kind: cli` endpoints. The API's stream handler signs each frame with the CLI endpoint's decrypted secret through the same `signPayload` helper the worker uses, so the signature is the platform's real one (BR-CLI-001). The ack writes the `delivery_attempts` row (`status_code`, `duration_ms`, `request_headers` with the signature, `actor: "cli"`) and sets the Delivery `succeeded` (2xx) or `exhausted` (anything else, one attempt, no retries; the merchant fixes and resends).
- **Connected flag.** `webhook_endpoints.cli_connected_until` is bumped by the stream on every frame and heartbeat; Event creation (FR-API-073) matches a `kind: cli` endpoint only when that column is in the future. No sweeper needed; expiry of unacked rows runs inside the stream handler and the worker's existing tick.
- **Frame source.** The stream polls the CLI endpoint's `queued` Deliveries (and rows with a pending manual resend) every 500 ms, like the worker, and sends each once per connection; `Last-Event-ID` on reconnect re-sends anything still unacked.

## Open

- ~~**npm scope.**~~ Resolved 2026-09-06: William published `@elapse/sdk@0.1.0`, so the `@elapse` scope is ours. `@elapse/cli` publishes in Week 6 with `pnpm publish` (rewrites the `workspace:*` SDK dependency to a real version).
- Package manager for the CLI build: `bun build --target=node` from `cli/` into a single `dist/elapse.js` with a shebang, or `tsc`. Decide at build.

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-06 | Claude (for William) | Grill round: Undecided 1–5 closed (SSE + ack; persistent CLI endpoint per mode; Event-level resend; no test clocks; paste login) and Q6 session lifetime added as FR-CLI-018; FR-CLI-010/014/020 rewritten against API FR-API-130–133; BR-CLI-007; implementation decisions recorded; npm-name check done. [ADR 2026-09-06](../decisions/2026-09-06-cli-transport-and-session.md). Awaiting signature. |
| 2026-09-06 | William | Signed. Week 4 CLI build begins: API FR-API-130–134 first, then `cli/`. |
| 2026-09-06 | Claude (for William) | Built `cli/` (FR-CLI-001–003, 010–018, 020–024, 030–032): `src/config.ts` (key precedence, 0600 profile), `src/sse.ts` (parser + reconnect with `Last-Event-ID`), `src/forward.ts` (exact bytes, 10 s timeout), `src/platform.ts` (SDK for the frozen calls; one `fetch` helper for the CLI-only routes, so FR-CLI-031 reads "no second HTTP library"), `src/commands/listen.ts`, `src/main.ts` (Node `util.parseArgs`, no parser dependency). 27 vitest tests against a mock platform and a local receiver. **Proven on the real local API, worker and built binary**: two Events emitted → streamed, forwarded byte-for-byte, verified by `constructEvent` with the printed secret, acked 200, attempt rows visible on `GET /v1/deliveries/:id`; `--events` skip, `--compact`, `events list`, `events resend` (manual attempt n=2 recorded), Ctrl-C summary, exit codes. Bun's 10 s idle timeout cut the first stream; the API now sets `idleTimeout: 60`. Chain-backed proof deferred: the relayer holds 0.02 MON. |
| 2026-09-06 | Claude (for William) | Found during William's first run: `login` saves the `--base-url` it was given (`base_url` in the profile; precedence flag → `ELAPSE_BASE_URL` → saved → default), so later commands need no flag; a network failure names the host tried and the way to change it instead of "fetch failed"; the delivery body is printed before the ack. |
| 2026-09-06 | William | The dashboard's "Send test delivery" now reaches the CLI endpoint while `listen` is connected ([ADR](../decisions/2026-09-06-test-delivery-on-cli-endpoint.md)); a first-day merchant needs no prior Event to see one arrive. |
