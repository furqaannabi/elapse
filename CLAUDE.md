# Elapse

## Authority

**Human is architect. Agent is senior engineer.**

- **Spec-driven. No code without a signed spec.** Check `docs/specs/` before every task. Doc hierarchy: `docs/elapse-detailed-document.pdf` (what to build, the six-week plan, the frozen SDK surface) → `docs/design-brief.md` (every page, state, and rule for the frontend) → `docs/specs/*-frd.md` (numbered FRs/BRs per surface; the human signs before build) → `DESIGN.md` (the recorded visual world) → `README.md` (repo map).
- Every feature maps to an FR id. Know which one before writing code. Tests are named after the FR. PRs list the FRs they close.
- Before starting any feature: invoke `grill-me` skill to stress-test requirements as developer questions, one at a time, with a recommended answer each.
- Then invoke `to-prd` to turn the answers into (or update) the surface's FRD in `docs/specs/`, and stop for the human's sign-off. Update the Status table in `docs/specs/README.md`.
- **A spec is signed only when the human says "signed" or "approve the spec" after seeing it.** "Proceed", "continue", "go", or an answer to a question is not a signature. Before recording a signature, quote the spec's Status line back and wait for the yes. The agent never writes "Signed" on the human's behalf.
- Before building anything visual: invoke `/impeccable`. Brief wins over taste. Mockups from the human override both. New surfaces inherit `DESIGN.md`; no new direction rolls.
- Before debugging: invoke `diagnose` skill.
- Every feature is test-driven: write failing test first, then implementation. Invoke `tdd` skill before any feature work. Components get tests too, not only pure functions.
- Never make architecture decisions autonomously — present 2–3 options with trade-offs, human chooses.
- When the human (or Furqaan) makes an architecture or product decision, record it as a dated ADR in `docs/decisions/` (`YYYY-MM-DD-title.md`, format in that folder's README) and link it from the affected spec's Revision table. Never edit an existing record; write a new one that supersedes it.
- Never bulk-generate code. One page, one component, one contract function at a time.
- **Before writing more than one document, show the human the list of files and what each will contain, and wait for a yes.** Scope is theirs to set; a broad request ("write the docs") is not consent for a specific list.
- **Every commit and every push needs its own explicit ask.** "Commit and push" once does not carry forward to later work. A push is additionally gated by a hook in `.claude/settings.json` that prompts the human before any `git push` runs.
- Remind human to commit after each meaningful change.
- If stuck or ambiguous: ask. Never guess on product behaviour.
- Flag risks — security, money movement, cost, hackathon-deadline — immediately and explicitly.

---

## Project

Elapse is **Stripe Billing for things that should charge by the second** — GPU time, API calls, live streams, SaaS seats. A subscriber starts a meter, watches a live USD counter tick, cancels whenever, and pays only the seconds that elapsed. Merchants integrate with `npm install @elapse/sdk`, a hosted Checkout URL, and signed webhooks — exactly like Stripe.

Tagline: **You only pay what elapsed.**
Hook: *"Cancel at 83 seconds. Pay 83 seconds. Your server finds out via webhook, not a cron job."*

Runs on Monad (chain 143 mainnet / 10143 testnet), settles in AUSD. **Subscribers never see chain words.** Judges are protocol founders and investors looking for projects that can become startups.

**Deadline:** Monad Metropolis Track 2 submission, **13 October 2026**. Six-week plan in the detailed doc; Week 1 kill gate is start → cancel mid-stream → settle elapsed on testnet.

### Key Docs

| Doc | Path | Purpose |
| --- | --- | --- |
| Detailed doc | `docs/elapse-detailed-document.pdf` | Product, objects, SDK surface (frozen), webhooks, architecture, six-week plan — source of truth |
| Design brief | `docs/design-brief.md` | Every frontend surface, page, state, component, and the "do not" list |
| Specs | `docs/specs/` | Technical design + FRDs per package (`FR-LND`, `FR-CHK`, `FR-DSH`, `FR-MTR`, `FR-CON`, `FR-API`, `FR-IDX`, `FR-WRK`, `FR-SDK`, `FR-CLI`, `FR-DOC`, `FR-EXM`); status table in `docs/specs/README.md` |
| Decisions | `docs/decisions/` | Dated ADRs (`YYYY-MM-DD-title.md`), never edited after the fact; specs in `docs/specs/` carry no dates and end with a Revision table |
| Design system | `DESIGN.md` | Recorded visual world: tokens, type, components, motion. All surfaces inherit it |
| Repo map | `README.md` | Surfaces and paths |

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend (landing + checkout + dashboard) | Next.js 16 App Router, TypeScript, Tailwind v4, shadcn, Motion, `web/` |
| Motion | Motion (framer-motion successor) — purposeful, orchestrated, no per-second blinking |
| Subscriber auth / wallet | Privy (embedded wallet, passkey / Face ID) |
| Chain client | viem |
| Contracts | Solidity 0.8.24, Foundry — `AccrualStream` + `StreamFactory` (Furqaan's call) |
| Platform API + worker | **Bun + Hono** (Furqaan's call) + Postgres, OpenAPI, API keys hashed at rest |
| Indexer | Envio HyperIndex on Monad |
| Webhook delivery | Postgres queue + worker (retry 0s, 30s, 2m, 10m, 1h — cap 8). No Kafka. |
| SDK | `@elapse/sdk` (TypeScript, Node 20+); Python if Week 5 allows |
| Docs | Mintlify / Nextra, deployed separately from the app |
| Money | AUSD. Display USD. Not yield-bearing. |
| Gas | Relayer / paymaster — subscribers never hold MON |
| Package manager | pnpm workspaces |

---

## Repository Layout

```
elapse/
├── contracts/        # Foundry — AccrualStream, StreamFactory
├── api/              # Platform REST (Bun + Hono + Postgres)
├── indexer/          # Envio HyperIndex → platform ingest
├── worker/           # Webhook deliveries
├── sdk/ts/           # @elapse/sdk
├── sdk/python/       # elapse (later)
├── web/              # Next.js: landing (/), checkout (/c/:session), dashboard (/dashboard)
├── cli/              # elapse listen --forward
├── docs/             # Product docs + design brief (Mintlify site lives separately)
└── examples/saas/    # The merchant in the demo video
```

`checkout/` in the original scaffold is superseded by `web/`.

---

## Architecture Decisions (locked)

Decided in the detailed doc. Do not re-open without explicit human instruction.

| Decision | Choice | Reason |
| --- | --- | --- |
| Product shape | Protocol + developer platform, not a consumer app | Merchants integrate in an afternoon; that is how Stripe/Privy got distribution |
| SDK surface | Frozen at §4.2 of the doc. If a method is not in the SDK, it is not in the docs | "Building Stripe in six weeks" risk |
| Webhooks | Lifecycle events only. **Never per-second webhooks** | DDoS-es merchants, burns Envio |
| Accrual | Onchain, UI ticks from `rate × (now − started_at)` — no tx per second | Monad 300ms blocks make it honest; no spam |
| Settlement | `settle()` batched by keeper every K seconds or on cancel | UI ticks without a tx per second |
| Escrow | Per-subscription escrow; cancel refunds unspent | Simpler than customer balance for MVP |
| Subscriber wallet | Privy only. Revisit Mera after submission | Time sink |
| Subscriber UI | No chain words, ever. Judge mode is the one exception | Consumer product bar |
| Signature | `X-Elapse-Signature: t=unix,v1=hmac_sha256`, payload `{t}.{raw_body}`, reject if age > 300s, constant-time compare | Stripe clone, on purpose |
| Object ids | `prod_`, `cus_`, `sub_`, `wh_`, `evt_` | Mirror Stripe so merchants learn nothing new |
| Subscription status | `incomplete → active → paused | canceled`. No `past_due` in MVP | If pot cannot settle: `invoice.payment_failed` + pause |
| Frontend app | One Next.js app in `web/` for landing, checkout, dashboard | Shared components; doc says checkout + dashboard share an app |

---

## Security First

Elapse moves money. Every decision starts with security.

| Concern | Rule |
| --- | --- |
| Secrets | Secret keys server-side only. Publishable key only for Checkout.js if added. Merchants never paste a private key into the SDK. Zero secrets in code or logs. `.env` gitignored. |
| Webhooks | Signature verified before payload parsed. Unverified = 400 + log. Worker dedupes on `evt_` id. Ingest idempotent on `txHash + logIndex`. |
| Indexer | Must never know merchant secrets. Envio posts to **our** ingest URL, not the merchant's. |
| API keys | Hashed at rest. Reveal once. Roll/revoke. Separate test and live keys. |
| Money | Contract `transfer` return values checked (SafeERC20). Settle math must never over-charge: `unsettled = elapsed − settled`. Cancel refunds unspent escrow. |
| Subscriber UI | Never expose private keys, seed phrases, hex addresses, or raw tx data outside judge mode. |
| Frontend auth | Merchant tokens: HttpOnly cookies, never localStorage. Subscriber: Privy session only. |
| Input | Validate every request body (zod). Rates are decimal strings, never floats, until converted to wei. |
| Logging | Never log secret keys, webhook secrets, signatures, or full payloads. Log `evt_` / `sub_` ids only. |

When in doubt: **deny by default, log the denial, surface to human if ambiguous.**

---

## Frontend Code Standards (`web/`)

### Rendering

| Route | Strategy | Reason |
| --- | --- | --- |
| `/` landing | Server Component, static | SEO, fast |
| `/c/[session]` checkout | Client Component (Privy, live ticker) | Interactive, mobile |
| `/dashboard/*` | Client Component behind auth | Interactive, auth-gated |

### Mobile-First (Non-Negotiable)

- Base Tailwind styles target mobile; `sm:`/`md:`/`lg:` only enhance upward. Desktop-first classes are banned.
- Touch targets ≥ 44×44px. No hover-only interactions.
- Checkout is designed at 390px first — it is what judges see on a phone.
- Dashboard tables become card stacks on mobile; never horizontal-scroll a data table.
- Modals full-screen on mobile, centered on `md:` and up.
- Test every new component at 375px before committing.
- Default Tailwind breakpoints; do not customise. Content max width `max-w-[1280px]`.

### The meter

- Elapsed and accrued are computed client-side from `rate_per_second × (now − started_at)`, ticking at 100ms. Use tabular monospaced numerals. No layout shift, no jitter, no blinking.
- Rates are decimal strings; use a decimal library or integer micro-dollars for display math. Never `parseFloat` a rate for money.
- The meter has unit tests for elapsed/accrued math, rounding, pause, and cancel.

### Copy

- Subscriber side: "You paid 83 seconds · $0.33". Never "transaction confirmed on-chain".
- Merchant side: Stripe vocabulary. Chain detail understated (short tx id + external link).

### Components

- `src/components/ui/` — primitives, no business logic.
- `src/components/meter/`, `src/components/dashboard/`, `src/components/checkout/` — feature components.
- No God components. Over ~200 lines, split.
- Every exported component and utility has a JSDoc block: what it renders, params, which doc section it maps to.

### API calls

- Never hardcode API paths in components. Typed client in `src/lib/api/` generated from `api/openapi.yaml` once it exists; until then a hand-written client with the same shape, mocked via MSW.

### Motion

- Motion is material, not decoration. Orchestrated reveals on landing, meter start/stop transitions, drawer/modal transitions, toast. Respect `prefers-reduced-motion`.
- Nothing pulses per second. The meter ticks; the UI does not blink.

---

## Test-Driven Development — Mandatory

**No feature ships without tests.**

```
1. Write failing test (red)
2. Minimum code to pass (green)
3. Refactor, keep green
4. Repeat per behaviour
```

| Layer | Tool |
| --- | --- |
| Contracts | `forge test` — start/cancel/settle/refund, fuzz the elapsed math |
| SDK | `vitest` — HMAC construct/verify, expired, malformed, tampered |
| Frontend unit | `vitest` + `@testing-library/react` |
| Frontend API mocking | `msw` |
| E2E | `playwright` — checkout: start → cancel → receipt; dashboard: create product → checkout URL → webhook delivery shown |

Coverage target: ≥ 70% on `web/src/components/**` and `web/src/lib/**`. CI blocks merge on any failing test.

---

## Build Sequence

Follows the doc's six-week plan. Frontend can run ahead of backend against mocks, but nothing ships "coming soon".

| Week | Gate |
| --- | --- |
| 1 | Meter is real: AccrualStream + Factory on testnet; start → cancel → settle elapsed. One HTML page: merchant counter + subscriber cancel. |
| 2 | API keys, `products.create`, `checkout.sessions.create`. Event log + signed POST. `constructEvent` unit-tested. |
| 3 | Hosted checkout with Privy, Face ID, ticker, cancel, success URL. Docs shell. Envio → ingest → worker. |
| 4 | Dashboard: keys, webhook deliveries, resend. CLI listen/forward. Full event catalog. OpenAPI into docs. |
| 5 | Mainnet factory, real AUSD. Python SDK or freeze TS-only. |
| 6 | Video = demo script. Judges can clone `examples/saas` and receive a webhook. Submit 13 Oct. |

Frontend order (human decides re-prioritisation): design system + meter component → checkout → landing → dashboard shell + developers (keys, webhooks, deliveries) → products → subscriptions → settings/payout → customers → invoices → subscriber account.

---

## Workflow Rules

1. **Read the doc first.** Every feature maps to a section of the detailed doc or the design brief. Know which one.
2. **One feature, one PR.** Don't bundle.
3. **Test-driven, always.** Failing test first.
4. **Options, not assumptions.** Unclear behaviour → 2–3 options, human decides.
5. **Small diffs.** Surgical edits. No refactor-while-fixing.
6. **Explain the why.** After each change, what changed and why — not a diff summary.
7. **No "coming soon".** A page either exists at production quality or is behind a flag.
8. **Justify every dependency:** what it replaces, why it is needed, bundle cost.

---

## Domain Language (use exactly)

| Term | Meaning |
| --- | --- |
| **Merchant** | The developer/business integrating Elapse. Has keys, products, webhook endpoints, a payout address. |
| **Subscriber** / **Customer** | End user paying per second. `cus_` id. Never "wallet user". |
| **Product** | Something billed at `rate_usd_per_second`. `prod_` id. |
| **Subscription** | A running meter for one customer on one product. `sub_` id. Maps to one `AccrualStream`. |
| **Meter** | UI word for a subscription's live counter. |
| **Checkout session** | Hosted page a subscriber is sent to. `cs_` id. |
| **Invoice** / **Settlement** | A `settle()` pull of accrued AUSD for a period. |
| **Webhook endpoint** | Merchant URL + signing secret (`whsec_`). `wh_` id. |
| **Event** | `evt_` id. Types: `checkout.session.completed`, `subscription.created/updated/canceled`, `invoice.settled`, `invoice.payment_failed`. |
| **Delivery** | One attempt to POST an event to an endpoint. |
| **Escrow** | AUSD deposited per subscription; unspent portion refunded on cancel. |
| **Judge mode** | The only place chain words appear on the subscriber side. |

Never abbreviate these. Never invent synonyms.

---

## What the Agent Cannot Do

- Deploy anything (Vercel, contracts to mainnet, Envio).
- Change the confirmed stack or the frozen SDK surface without explicit human approval.
- Make product decisions — scope, pricing, page priority, what gets cut for 13 Oct is the human's call.
- Ship per-second webhooks, or any chain vocabulary on the subscriber side outside judge mode.
- Modify contract money-movement logic without human sign-off.
- Add dependencies without justifying them.
- Commit or push without being asked, each time. Push is also blocked by the `.claude/settings.json` hook until the human approves the prompt.
- Write a batch of documents without first showing the file list and getting a yes.
