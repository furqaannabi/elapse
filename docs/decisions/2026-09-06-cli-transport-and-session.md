# CLI `listen --forward` receives Deliveries over SSE from one persistent CLI endpoint per mode
2026-09-06 · Decided by William · Status: accepted

## Context
The Quickstart and demo step 3 run a merchant server on `localhost`, which the webhook worker
cannot reach. The CLI FRD left five items undecided and the worker FRD parked its transport
choice (Undecided 5) on this build. The CLI must forward the platform's real signature
byte-for-byte (BR-CLI-001), so whatever carries a Delivery to the CLI must carry the bytes the
platform signed, not a re-signed copy. Weighed: SSE, WebSocket, or long-poll for transport; a
temporary endpoint per session, a persistent CLI endpoint per merchant, or mirroring an existing
endpoint for signing; Event-level versus Delivery-level replay; a test-clock command; paste
versus device-code login; and what happens to CLI Deliveries when nobody is listening.

## Decision
Transport is **SSE** over the platform API with a per-Delivery **ack** carrying the local
server's status code and duration. Signing uses **one persistent CLI endpoint per merchant per
mode** (`kind: cli`), created on the first `listen`, whose `whsec_` the CLI prints at start; the
endpoint counts as enabled **only while a stream is open**, with a 60 s grace for reconnects, so
Events fired with no CLI running create no CLI Delivery. The worker skips `kind: cli` rows; the
API's stream handler signs each Delivery with the endpoint's secret using the same signing helper
the worker uses, and the ack writes the attempt row. Replay is **Event-level**:
`POST /v1/events/:id/resend` and `elapse events resend`, alongside the existing per-Delivery
resend the dashboard uses. **No test clocks**: the demo is a real 15-second cancel. `login`
**pastes** the secret key; `ELAPSE_SECRET_KEY` skips login.

## Consequences
- Stripe parity: `stripe listen` prints a stable CLI secret, `stripe events resend` replays an
  Event, and the dashboard's Resend button is per attempt. Merchants learn nothing new.
- No new dependency in the CLI (Node 20 `fetch` reads SSE), no new queue table in the API, and
  the worker changes by one `WHERE` clause.
- The dashboard's endpoints list shows a "CLI" endpoint with its Deliveries and local response
  codes, which is the observability the CLI FRD's Open item asked about; the CLI never mirrors
  other endpoints' Deliveries.
- Unacked CLI Deliveries expire to `skipped` after 10 minutes, so a crashed CLI never leaves a
  permanently failing endpoint.
- Test clocks are out for 13 October; the docs "Test clocks" page becomes "Testing". Device-code
  login is post-hackathon.
- Watch: the `@elapse` npm scope is unverified until someone logs in and checks; the bare
  `elapse` name is taken by an unrelated package.
