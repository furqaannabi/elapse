# Elapse specs

Spec-driven development for the frontend. **No code without a signed spec.**

## Hierarchy

1. `docs/elapse-detailed-document.pdf` — the product and build doc. What Elapse is, the frozen SDK surface, webhooks, architecture, six-week plan. Source of truth for product behaviour.
2. `docs/design-brief.md` — every surface, page, state, and rule for the frontend.
3. `docs/specs/*-frd.md` — **functional requirements per surface.** Numbered FRs and BRs that every feature, test, and PR maps to. Written by the agent from 1 and 2 (via `to-prd`), signed by the human before any build.
4. `DESIGN.md` — the recorded visual world. Tokens, type, components, motion. Every surface inherits it.

## Id scheme

| Prefix | Surface |
| --- | --- |
| `FR-LND-nnn` | Landing (`/`) |
| `FR-CHK-nnn` | Hosted checkout (`/c/[session]`) |
| `FR-DSH-nnn` | Merchant dashboard (`/dashboard/*`) |
| `FR-MTR-nnn` | Meter primitives (math, `useMeter`, `Readout`, `ChartStrip`) shared by all surfaces |
| `BR-xxx-nnn` | Business rules the surface must enforce (money, security, copy) |

FRs are user-facing behaviour ("As a subscriber I can…"). BRs are constraints ("Amounts never round up"). Both are testable.

## Status

| Spec | Status | Signed |
| --- | --- | --- |
| `2026-09-03-meter-frd.md` | Built (retro-documented) | — |
| `2026-09-03-landing-frd.md` | Built (retro-documented) | — |
| `2026-09-03-checkout-frd.md` | **Draft — awaiting human sign-off** | — |
| `2026-09-03-dashboard-frd.md` | Outline only | — |

## Process

1. Agent runs `grill-me` on the surface: developer questions, one at a time, with a recommended answer each.
2. Agent runs `to-prd` to write the FRD from the answers, the detailed doc, and the design brief. Every FR has an acceptance test in mind.
3. Human signs (edits the Status row above to "Signed" with the date).
4. Build: `tdd` per FR — failing test named after the FR id, then implementation. Visual work through `/impeccable`.
5. PR description lists the FR ids it closes.
