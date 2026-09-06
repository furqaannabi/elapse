# "Send test delivery" works on the CLI endpoint while `elapse listen` is connected
2026-09-06 · Decided by William · Status: accepted (amends one clause of [2026-09-06 CLI transport](./2026-09-06-cli-transport-and-session.md))

## Context
The CLI decision made the CLI endpoint read-only through the endpoint routes: no update, roll,
delete or test. William's first run of the Quickstart showed the cost. A merchant on day one has
no Events yet, so `elapse events resend` has nothing to replay, and the dashboard's "Send test
delivery" answered "cannot be changed here" on the only endpoint their laptop was listening on.
The alternatives were an HTTP endpoint at `localhost`, which only works when the API runs on the
same machine, or the example's own local signature check, which never touches the platform.

## Decision
`POST /v1/webhook_endpoints/:id/test` is allowed on a `kind: cli` endpoint **while
`cli_connected_until` is in the future**. It creates the synthetic Event and one queued Delivery
for that endpoint, which the open stream picks up like any other. While nothing is connected it
answers `400`: "Nothing is listening on the CLI endpoint. Start `elapse listen` first." Update,
roll and delete on the CLI endpoint stay refused.

## Consequences
- The dashboard button gives a first-day merchant a real signed delivery through the CLI, which
  is what Stripe's `stripe trigger` does; a future `elapse trigger` command has the same path.
- No new state: the connected flag and the stream's queued-row poll already existed.
- An unconnected CLI endpoint still never accumulates Deliveries that would only expire.
