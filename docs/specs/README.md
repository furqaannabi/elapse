# Elapse specs

Spec-driven development for the whole project. **No code without a signed spec.**

## Hierarchy

1. `docs/elapse-detailed-document.pdf` — the product and build doc. What Elapse is, the frozen SDK surface, webhooks, architecture, six-week plan. Source of truth for product behaviour.
2. `docs/design-brief.md` — every surface, page, state, and rule for the frontend.
3. `docs/specs/*-frd.md` — **functional requirements per package or surface**, plus `…-technical-design.md` for the platform's data model, API, auth, webhook pipeline and environments. Numbered FRs and BRs that every feature, test, and PR maps to. Written by the agent from 1 and 2 (via `to-prd`), signed by the human before any build.
4. `DESIGN.md` — the recorded visual world. Tokens, type, components, motion. Every surface inherits it.

## Id scheme

| Prefix | Surface |
| --- | --- |
| `FR-LND-nnn` | Landing (`/`) |
| `FR-CHK-nnn` | Hosted checkout (`/c/[session]`) |
| `FR-DSH-nnn` | Merchant dashboard (`/dashboard/*`) |
| `FR-MTR-nnn` | Meter primitives (math, `useMeter`, `Readout`, `ChartStrip`) shared by all surfaces |
| `FR-CON-nnn` | Contracts (`StreamFactory`, `AccrualStream`) |
| `FR-API-nnn` | Platform API |
| `FR-IDX-nnn` | Indexer (Envio HyperIndex → ingest) |
| `FR-WRK-nnn` | Webhook worker and keeper |
| `FR-SDK-nnn` | `@elapse/sdk` TypeScript (and `elapse` Python stretch) |
| `FR-CLI-nnn` | `@elapse/cli` (`listen --forward`, login, resend) |
| `FR-DOC-nnn` | Docs site (docs.elapse.dev) |
| `FR-EXM-nnn` | `examples/saas` reference merchant |
| `BR-xxx-nnn` | Business rules the surface must enforce (money, security, copy) |

**Naming.** Specs are living documents, so file names carry no date: `checkout-frd.md`, `technical-design.md`. Each ends with a Revision table (date, who, change). Dated files belong in `docs/decisions/` (ADRs), which never change after they are written.

FRs are user-facing behaviour ("As a subscriber I can…"). BRs are constraints ("Amounts never round up"). Both are testable.

## Status

| Spec | Status | Signed |
| --- | --- | --- |
| `technical-design.md` | Draft — aligned 2026-09-05 with the signed API FRD, which is authoritative where they differ | — |
| `meter-frd.md` | Built (retro-documented) | — |
| `landing-frd.md` | Built (retro-documented) | — |
| `checkout-frd.md` | **Signed** · built against the mock API · Surface 4 `/account` (FR-CHK-016–026) **signed 2026-09-04**, not yet built | William, 2026-09-03 and 2026-09-04 |
| `dashboard-frd.md` | **Signed** · built against the mock API (all FR-DSH except the subscriber `/account` which lives in the checkout spec) | William, 2026-09-03 |
| `contracts-frd.md` | **Signed** · built and **deployed to Monad testnet 2026-09-05**; 51 tests + invariants green; kill gate FR-CON-073 passed on chain (indexer clause pending Week 3). Furqaan reviews money movement on arrival | William, 2026-09-05 |
| `api-frd.md` | **Signed** · grilled 2026-09-05 · not yet built | William, 2026-09-05 |
| `indexer-frd.md` | Draft — awaiting human sign-off (Furqaan) · ledger entity added 2026-09-04 | — |
| `worker-frd.md` | **Signed** · Week 2 delivery loop first; keeper/heartbeat Week 3, notices/CLI Week 4 | William, 2026-09-05 |
| `sdk-frd.md` | Draft — awaiting human sign-off (Furqaan) · multi-signature verify decided 2026-09-04 | — |
| `cli-frd.md` | Draft — awaiting human sign-off | — |
| `docs-site-frd.md` | Draft — awaiting human sign-off | — |
| `examples-frd.md` | Draft — awaiting human sign-off | — |

## Process

1. Agent runs `grill-me` on the surface: developer questions, one at a time, with a recommended answer each.
2. Agent runs `to-prd` to write the FRD from the answers, the detailed doc, and the design brief. Every FR has an acceptance test in mind.
3. Human signs (edits the Status row above to "Signed" with the date).
4. Build: `tdd` per FR — failing test named after the FR id, then implementation. Visual work through `/impeccable`.
5. PR description lists the FR ids it closes.
