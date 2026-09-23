# Elapse — docs

**Start here if you are new.** This folder is the project's memory: what we are building, why, how, and what is decided versus open. Read in this order.

| # | Read | Time | Why |
| --- | --- | --- | --- |
| 1 | [`elapse-detailed-document.pdf`](./elapse-detailed-document.pdf) | 15 min | The product and build doc by Furqaan. Objects, frozen SDK surface, webhooks, architecture, bounties, the six-week plan. **Source of truth for product behaviour.** |
| 2 | [`architecture.md`](./architecture.md) | 10 min | How the pieces fit: contract → indexer → API → worker → merchant, and where the frontend sits. |
| 3 | [`glossary.md`](./glossary.md) | 3 min | The words we use, exactly. |
| 4 | [`specs/README.md`](./specs/README.md) | 5 min | How we work: spec-driven, FR ids, sign-off, TDD. Then the FRD for the piece you are picking up. |
| 5 | [`specs/technical-design.md`](./specs/technical-design.md) | 15 min | Data model, API shape, auth, webhook pipeline, environments. |
| 6 | [`design-brief.md`](./design-brief.md) and [`../DESIGN.md`](../DESIGN.md) | 10 min | Frontend only: every page and state, and the recorded visual system. |
| 7 | [`onboarding.md`](./onboarding.md) | 10 min | Local setup, commands, conventions, who owns what. |
| 8 | [`decisions/`](./decisions/README.md) | 5 min | Dated decision records: why something was chosen, by whom. Never edited after the fact. |
| 9 | [`post-hackathon.md`](./post-hackathon.md) | 3 min | What we knowingly left for after 13 October: deferred defects, decisions that parked work, and operational follow-ups. |

## One-paragraph version

Elapse is Stripe Billing for things that should charge by the second. A merchant installs `@elapse/sdk`, creates a product with a rate in USD per second, and renders `<Authorize>` and `<Meter>` from `@elapse/react` in their own page. The customer signs in with Face ID and authorises in a window Elapse opens, adds funds, watches a live counter without leaving the merchant's page, and stops whenever they like; they pay only the seconds that elapsed and the rest comes back. Accrual happens onchain in an `AccrualStream` contract on Monad, settled in AUSD; the merchant never sees a chain, only six lifecycle webhooks signed the way Stripe signs them. Submission for Monad Metropolis Track 2 is **13 October 2026**.

## Status board

| Piece | Path | Spec | State (2026-09-21) |
| --- | --- | --- | --- |
| Contracts | `contracts/` | `specs/contracts-frd.md` | Built and deployed on Monad testnet 10143 (factory `0x9Df0…8052`, 20 Sep, Sourcify-verified): escrow, start, cancel, settle with 2 % fee, cap end, pause and resume for the merchant and the keeper only. Kill gate passed 5 Sep. Mainnet record pending (William deploys). |
| Platform API | `api/` | `specs/api-frd.md` | Hosted at api.elapse.finance (EC2, Docker Compose behind nginx; `docker-compose.ec2.yml`). Every FR-API built including dashboard routes, account routes, CLI sessions, search. Auth audit of all routes clean 9 Sep. |
| Indexer | `indexer/` | `specs/indexer-frd.md` | Hosted on Envio Cloud, endpoint `fd175e5` on the 20 Sep factory, synced and ingesting into the API. `pnpm reconcile` still deferred. |
| Webhook worker | `api/src/worker/` | `specs/worker-frd.md` | Hosted as the second process beside the API: deliveries with retries and auto-disable, keeper (hourly settle, cap ends), reconcile, heartbeat, CLI sweep, expiry notices and emails. |
| SDK (TS) | `sdk/ts/` | `specs/sdk-frd.md` | `@elapse/sdk@0.3.0` on npm: `manage_url`, invoice and product filters, and the merchant's `subscriptions.start / pause / resume / cancel`. |
| SDK (React) | `sdk/react/` | `specs/react-sdk-frd.md` | `@elapse/react@0.3.0` on npm: `<Authorize>`, `<Meter>` in the homepage's instrument UI, `useAuthorize` / `useMeter`, pause as a request to the merchant. |
| CLI | `cli/` | `specs/cli-frd.md` | `@elapse/cli@0.1.3` on npm: `listen --forward`, `events`, `products`, `checkout`. |
| Web (landing, checkout, account, dashboard) | `web/` | `specs/landing-frd.md`, `specs/checkout-frd.md`, `specs/dashboard-frd.md` | Hosted at elapse.finance (Vercel) on the real API: landing, checkout with Privy and add money, account page, full dashboard with paging, search as you type, notifications. |
| Docs site | `docs-site/` (Mintlify, site in `docs-site/site/`) | `specs/docs-site-frd.md` | Hosted at docs.elapse.finance: Quickstart, guides, generated API reference, snippets synced from code, CI. |
| Example merchant | `examples/saas/` | `specs/examples-frd.md` | Proven against production twice on 9 Sep: through the CLI and through a dashboard-added endpoint via a tunnel. |
| Example (merchant-started) | `examples/lambda/` | `specs/examples-lambda-frd.md` | The Northwind console: a merchant-started meter that runs only while the invocation does. Runs locally against production through `elapse listen --forward`; hosting undecided. |

Judge pass on the hosted app in test mode completed 9 Sep. Remaining before 13 Oct: a checkout against the 20 Sep factory end to end, credential rotation, `examples/lambda` hosting, demo video, mainnet decision, submission.

## Decisions log

Locked decisions live in the detailed doc and are restated in `architecture.md`; decisions made since are dated records in `decisions/`. Anything marked **Undecided (human)** in a spec needs Furqaan or William to decide; do not guess. Record the decision in the spec and the date.
