# Elapse — docs

**Start here if you are new.** This folder is the project's memory: what we are building, why, how, and what is decided versus open. Read in this order.

| # | Read | Time | Why |
| --- | --- | --- | --- |
| 1 | [`elapse-detailed-document.pdf`](./elapse-detailed-document.pdf) | 15 min | The product and build doc by Furqaan. Objects, frozen SDK surface, webhooks, architecture, bounties, the six-week plan. **Source of truth for product behaviour.** |
| 2 | [`architecture.md`](./architecture.md) | 10 min | How the pieces fit: contract → indexer → API → worker → merchant, and where the frontend sits. |
| 3 | [`glossary.md`](./glossary.md) | 3 min | The words we use, exactly. |
| 4 | [`specs/README.md`](./specs/README.md) | 5 min | How we work: spec-driven, FR ids, sign-off, TDD. Then the FRD for the piece you are picking up. |
| 5 | [`specs/2026-09-03-technical-design.md`](./specs/2026-09-03-technical-design.md) | 15 min | Data model, API shape, auth, webhook pipeline, environments. |
| 6 | [`design-brief.md`](./design-brief.md) and [`../DESIGN.md`](../DESIGN.md) | 10 min | Frontend only: every page and state, and the recorded visual system. |
| 7 | [`onboarding.md`](./onboarding.md) | 10 min | Local setup, commands, conventions, who owns what. |

## One-paragraph version

Elapse is Stripe Billing for things that should charge by the second. A merchant installs `@elapse/sdk`, creates a product with a rate in USD per second, and sends their customer to a hosted checkout. The customer signs in with Face ID, adds funds, presses Start, watches a live counter, and presses Cancel whenever they like; they pay only the seconds that elapsed and the rest comes back. Accrual happens onchain in an `AccrualStream` contract on Monad, settled in AUSD; the merchant never sees a chain, only six lifecycle webhooks signed the way Stripe signs them. Submission for Monad Metropolis Track 2 is **13 October 2026**.

## Status board

| Piece | Path | Spec | State (2026-09-03) |
| --- | --- | --- | --- |
| Contracts | `contracts/` | `specs/…-contracts-frd.md` | Early draft; no funding path, no settle, no tests. **Week-1 kill gate not met.** |
| Platform API | `api/` | `specs/…-api-frd.md` | Empty |
| Indexer | `indexer/` | `specs/…-indexer-frd.md` | Empty |
| Webhook worker | `worker/` | `specs/…-worker-frd.md` | Empty |
| SDK (TS) | `sdk/ts/` | `specs/…-sdk-frd.md` | `constructEvent` only; no build, no tests |
| CLI | `cli/` | `specs/…-cli-frd.md` | Empty |
| Web (landing, checkout, dashboard) | `web/` | `specs/…-landing-frd.md`, `…-checkout-frd.md`, `…-dashboard-frd.md` | Landing built and reviewed; checkout next |
| Docs site | (separate deploy) | `specs/…-docs-site-frd.md` | Not started |
| Example merchant | `examples/saas/` | `specs/…-examples-frd.md` | Empty |

## Decisions log

Locked decisions live in the detailed doc and are restated in `architecture.md`. Anything marked **Undecided (human)** in a spec needs Furqaan or William to decide; do not guess. Record the decision in the spec and the date.
