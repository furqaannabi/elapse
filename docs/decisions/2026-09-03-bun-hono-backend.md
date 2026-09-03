# Bun + Hono for the platform API and worker; Foundry for contracts

2026-09-03 · Decided by Furqaan (relayed by William) · Status: accepted

## Context

The detailed doc left the API framework open ("Hono or Next.js Route Handlers"). The technical design listed the trade-off: a separate Hono service keeps API, worker, and ingest independent of the frontend build and lets the worker share the API's schema package; route handlers inside `web/` mean one fewer deploy but couple money-moving code to UI releases. Runtime was also open (Node vs Bun).

## Decision

`api/` and `worker/` run on **Bun** using **Hono**, as a service separate from `web/`. The worker is a second Bun process on the same codebase. Contracts stay on **Foundry** (Solidity 0.8.24). `web/` and `@elapse/sdk` stay on Node 20+ so the SDK matches what merchants run.

## Consequences

- OpenAPI is generated from Hono route schemas (`@hono/zod-openapi`) and published into the docs.
- The docs quickstart CI and the worker run on Bun; the SDK's tests run on Node so they prove what merchants will see.
- Deployment target for the Bun services is still undecided (technical design §6).
- William is the likely builder of `api/` and `worker/` after the frontend, so the FRDs are written to be buildable without Furqaan present.
