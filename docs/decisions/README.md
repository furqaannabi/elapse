# Decisions

Architecture and product decision records (ADRs). One file per decision, named `YYYY-MM-DD-short-title.md`, **never edited after the fact**: if a decision changes, write a new record that supersedes the old one and link both ways.

Specs in `docs/specs/` describe what we are building and change over time. Records here describe *why* something was chosen on a given day and who chose it, so a newcomer can tell a deliberate choice from an accident.

## Format

```
# Title
Date · Decided by · Status (accepted | superseded by <file>)

## Context
What was true, what was being weighed.

## Decision
One paragraph.

## Consequences
What this makes easier, what it rules out, what to watch.
```

## Index

| Date | Decision | By |
| --- | --- | --- |
| 2026-09-03 | [Bun + Hono for the platform API and worker; Foundry for contracts](./2026-09-03-bun-hono-backend.md) | Furqaan |
| 2026-09-03 | [Neutral dark default theme, amber as the only accent, no red](./2026-09-03-neutral-dark-palette.md) | William |
| 2026-09-03 | [Percentage platform fee taken inside settle, default 1 percent, owner-adjustable](./2026-09-03-settlement-fee.md) (contract change awaiting Furqaan) | William |
| 2026-09-03 | [Dashboard scope for 13 October](./2026-09-03-dashboard-scope.md) | William |
| 2026-09-04 | [Subscribers hold AUSD; subscriber authorizes by permit, Elapse relayer signs the session](./2026-09-04-subscriber-permit-relayer-signs.md) | Furqaan |
| 2026-09-04 | [The subscriber account page stays Elapse-branded across merchants](./2026-09-04-account-page-cross-merchant.md) | William |
| 2026-09-05 | [The webhook worker lives inside `api/`; endpoints auto-disable after 3 days of continuous failure](./2026-09-05-worker-in-api-and-auto-disable.md) | William |
| 2026-09-05 | [Indexer: Envio Hosted Service plus local `envio dev`; no rollback on reorg; one ingest POST per log](./2026-09-05-indexer-hosting-reorg-transport.md) | William |
| 2026-09-05 | [The factory's keeper may cancel a stream, so `subscriptions.cancel` works from a merchant's server](./2026-09-05-keeper-may-cancel.md) | William |
| 2026-09-06 | [CLI `listen --forward` receives Deliveries over SSE from one persistent CLI endpoint per mode](./2026-09-06-cli-transport-and-session.md) | William |
| 2026-09-06 | [Docs site on Mintlify; reference from a committed filtered OpenAPI file; Quickstart CI against a local API](./2026-09-06-docs-site-mintlify-and-quickstart-ci.md) | William |
| 2026-09-06 | ["Send test delivery" works on the CLI endpoint while `elapse listen` is connected](./2026-09-06-test-delivery-on-cli-endpoint.md) | William |
| 2026-09-06 | [The example merchant has its own brand, not Elapse's design system](./2026-09-06-example-merchant-own-brand.md) | William |
