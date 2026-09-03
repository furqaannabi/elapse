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
