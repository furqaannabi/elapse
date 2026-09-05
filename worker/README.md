# Webhook worker

The worker code lives in [`api/src/worker/`](../api/src/worker/) and runs as a second Bun
process from the `api/` package (`bun run worker`), sharing its database client, migrations
and tests. Decided 2026-09-05: [ADR](../docs/decisions/2026-09-05-worker-in-api-and-auto-disable.md).
Spec: [`docs/specs/worker-frd.md`](../docs/specs/worker-frd.md).

Rules in one line: idempotent on `evt_` id; retries `0s, 30s, 2m, 10m, 1h, 1h, 1h, 1h` (cap 8);
10 s timeout; any `2xx` is success; signed `X-Elapse-Signature: t=<unix>,v1=<hex>` over
`{t}.{raw_body}`, verified by `@elapse/sdk` `constructEvent`.
