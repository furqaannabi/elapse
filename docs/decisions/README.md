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
| 2026-09-04 | [Subscribers fund by card; Elapse funds escrow from its own AUSD float](./2026-09-04-subscriber-funding-card-and-ausd-float.md) (accepted 2026-09-04 by the record below) | William |
| 2026-09-04 | [Session cap = max duration × rate; cancel releases unused escrow](./2026-09-04-session-cap-and-escrow-release.md) | Furqaan |
