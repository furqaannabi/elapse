# Indexer: Envio Hosted Service plus local `envio dev`; no rollback on reorg; one ingest POST per log
2026-09-05 · Decided by William (grill run by Claude) · Status: accepted

## Context
Week 3 opens the indexer (`indexer/`, Envio HyperIndex on Monad). The draft FRD left four
architecture choices open and carried more scope than one week allows. Facts checked the same
day: Envio HyperSync lists both Monad testnet (10143) and mainnet (143); Envio ≥ 2.32 renamed
`experimental_createEffect` to `createEffect` and made `rateLimit` a required option; the
contracts FRD had just added `amountRefunded` to `StreamCanceled` (FR-CON-024).

## Decision
1. **Hosting (c):** the indexer runs on the Envio Hosted Service for the demo and video, and as
   `pnpm envio dev` (the CLI's own Docker Postgres + Hasura) for development and CI. No
   hand-written `docker compose`.
2. **Reorgs (b):** `rollback_on_reorg: false`. Every ingest carries `block_hash`, which the
   platform stores, so a reorg can be audited and reversed by hand. Revisit after 13 October.
3. **Transport (a):** one HTTP POST per log from a `createEffect` with `cache: false` and
   `rateLimit: false` to `POST /internal/ingest`, which is idempotent on
   `(chain_id, tx_hash, log_index)`.
4. **Judge mode (b):** the browser never calls Envio. The API reads Envio's GraphQL server-side
   and returns `indexed.*` in the public checkout session projection and lag in `GET /v1/status`;
   the judge panel links out to the hosted explorer.
5. **Week 3 scope (b):** config, dynamic clone registration, all handlers, the four entities plus
   `LedgerEntry`, the ingest Effect with retries, handler and Effect unit tests, hosted deploy.
   **Deferred to Week 4:** the `reconcile` script (FR-IDX-024) and the anvil end-to-end test
   (FR-IDX-062).

## Consequences
- The Week 3 proof of "Envio → ingest → worker" is the real testnet kill-gate script against the
  hosted indexer with a Merchant webhook landing, not an anvil harness.
- A reorg after ingest would require manual reversal (FR-IDX-033) until `reconcile` exists; on
  MonadBFT this is treated as a chain failure, not a normal path.
- `rateLimit: false` is safe only because the Effect targets our own API; any future Effect that
  calls a third party must set a real limit.
- Two API-side env vars are implied: `INDEXER_GRAPHQL_URL` and `INDEXER_PUBLIC_EXPLORER_URL`.
- William asked to be reminded of the Week 4 remainder: FR-IDX-024 and FR-IDX-062.
