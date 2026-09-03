# Docs site (docs.elapse.dev) — FRD

Status: **Draft — awaiting human sign-off** · Surface: Merchant developer docs (public, desktop-first) · Sources: detailed doc §4.1–§4.4, §5.1–§5.3, §6, §9, §10 step 1, §11 (Agora page), §12 Weeks 3, 4, 6, §13, §14, §15; design brief (direction, Landing CTA "Read the docs"); `docs/README.md`.

## Problem

The demo opens on the docs (§10, 0:00–0:35) and the judging bar is "clone `examples/saas` and receive a webhook" (§12 Week 6). The docs are therefore a product surface, not a README: a Quickstart a stranger completes in under 10 minutes on testnet, a webhook catalog, a signature page, and a generated API reference — hosted separately so a contract or app outage during judging cannot take them down (§13). The known risk is drift: the Quickstart must be executed by CI against testnet or "it is a lie" (§15).

## User stories

1. As a merchant engineer, I want to install the SDK, create a Product, get a Checkout URL, and verify one webhook in under 10 minutes, so that I trust the rest of the platform.
2. As a merchant engineer, I want every code sample in TS and cURL (and Python when it ships), so that I can integrate from any stack.
3. As a merchant engineer, I want a catalog of every Event with its payload and my expected action, so that my handler is complete.
4. As a merchant engineer, I want the signature scheme spelled out with a verification snippet, so that I can verify by hand if the SDK is unavailable.
5. As a judge, I want the Contracts page to show addresses, events, and settle semantics, so that I can verify the chain without judge mode.
6. As the team, I want the Quickstart to run in CI so that a stale snippet fails a build, not a demo.

## Functional requirements

### Site and navigation (§6, §9, §13)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-001 | The site is served at `docs.elapse.dev` (fallback: the Vercel project URL) from `docs/` and deploys independently of `web/`, `api/`, and `contracts/`. | Deploy preview URL per PR; `web` outage does not affect docs (separate project). |
| FR-DOC-002 | Left nav has exactly these nine top-level entries in this order: Introduction, Quickstart, Checkout, Subscriptions, Webhooks, SDKs, API reference, Contracts, Test clocks. | Nav config snapshot test. |
| FR-DOC-003 | Every page has a title, a one-sentence summary, and headings that appear in a right-hand "On this page" list; search covers all pages. | Lint: frontmatter required; search index built in CI. |
| FR-DOC-004 | Light and dark themes, tabular monospaced numerals in code and tables, the Elapse wordmark, and a footer with GitHub, npm, and status links. | Screenshot review at 1440 and 390. |

### Quickstart (§6, §10 step 1, §12 Week 3, §15)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-010 | Quickstart has exactly these steps: 1 get a test secret key from the dashboard; 2 `npm install @elapse/sdk`; 3 `products.create`; 4 `checkout.sessions.create` and print `session.url`; 5 handle `subscription.canceled` with `constructEvent`; 6 run `npx @elapse/cli listen --forward localhost:3000/webhooks`; 7 open the URL on a phone, Start, Cancel, see `seconds_elapsed`. | Page structure snapshot; each step has a code block. |
| FR-DOC-011 | Every Quickstart snippet is extracted verbatim from `examples/saas` source files (include-by-region), never hand-copied. | Build fails if a referenced region is missing; diff test between page and source. |
| FR-DOC-012 | `docs/ci/quickstart.sh` runs steps 2–6 against testnet in CI on every PR and nightly: installs the published SDK, creates a Product and Checkout session, triggers a test Delivery, and asserts `constructEvent` accepts it. Fails the build on any error or if wall time > 10 min. | GitHub Actions job green; time asserted. |
| FR-DOC-013 | The Quickstart states up front: "Testnet · takes about 10 minutes · you need Node 20 and a dashboard account." and ends with "Next: Webhooks catalog" and "Clone the finished merchant: examples/saas". | Text present. |

### Guides (§6 items 1, 3, 4, 8, 9; §7; §11)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-020 | Introduction explains per-second money, why Monad (300 ms blocks), and the three surfaces (Protocol, Platform API, Checkout) in ≤ 400 words with the §5.3 payload as its hero code block. | Word count and code block asserted. |
| FR-DOC-021 | Checkout page documents the subscriber UX, `success_url?session_id=cs_…`, `cancel_url`, session states (open / complete / expired), and the "no chain words" promise. | Sections present; links to checkout FRD states. |
| FR-DOC-022 | Subscriptions page documents the state machine `incomplete → active → paused \| canceled`, start, pause/resume, cancel, and the elapsed-billing formula (whole seconds × rate) with a worked 83 s example. | Diagram + example present. |
| FR-DOC-023 | Contracts page lists the testnet (and, if live, mainnet) `StreamFactory` address, `AccrualStream` events (`StreamCreated, StreamStarted, StreamPaused, StreamCanceled, Settled(seconds, amount)`), and settle semantics. Addresses are read from `contracts/deployments/*.json` at build time. | Build fails on missing deployment file; addresses match. |
| FR-DOC-024 | Test clocks page documents how to fast-forward demo rates for the video. Content depends on Undecided 3. | Page exists with at least the "high-rate testnet product" recipe. |
| FR-DOC-025 | If Aurora lands (§11), a page "Accept any-chain, bill in dollars" is added under Checkout; otherwise it is absent (no "coming soon" pages). | Nav contains no placeholder pages. |

### Webhooks (§4.4, §5.1–§5.3, §6 item 5)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-030 | Event catalog page: a table of the six MVP types with "When" and "Merchant action" copied from §5.1, followed by one full example payload per type. It states explicitly that there are no per-second events. | Six payloads validate against the OpenAPI `Event` schema in CI. |
| FR-DOC-031 | Signature page: header format `t=unix,v1=hmac_sha256`, signed payload `{t}.{raw_body}`, 300 s window, `whsec_` secret, constant-time compare; a TS snippet using `constructEvent` and a "verify by hand" snippet (Node crypto and cURL/openssl) that produce the same digest for a published test vector. | Test vector (secret, t, body, v1) is checked by SDK unit tests. |
| FR-DOC-032 | Delivery page: retry schedule `0 s, 30 s, 2 m, 10 m, 1 h` capped at 8 tries, 10 s timeout, 2xx = success, idempotent handling by `evt_` id, and the dashboard resend button. | Numbers match §5.2 and the worker config file (build-time include). |
| FR-DOC-033 | Local development page: `npx @elapse/cli listen --forward …`, sample terminal output, and the printed signing secret. | Output block is a snapshot from the CLI test suite. |

### SDKs and API reference (§4, §6 items 6–7, §12 Week 4)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-040 | SDKs page has tabs TypeScript · cURL (· Python only if `elapse` is published) for each of the frozen methods; the TS tab is the §4.2 snippet. | Tab set snapshot; Python tab gated by a build flag. |
| FR-DOC-041 | API reference is generated from `api/openapi.json` at build time; hand-written reference pages are forbidden. | Build fails if the spec is missing or invalid. |
| FR-DOC-042 | Every SDK method in the docs maps to one operation in the OpenAPI spec and vice versa for the frozen surface; a CI check diffs the SDK's exported method list against the docs' method list and the spec's `operationId`s. | `docs/ci/surface-check.ts` passes; adding a doc for a non-SDK method fails. |
| FR-DOC-043 | Every TS snippet has a cURL equivalent beside it (tab or adjacent block) showing the same request. | Lint rule: TS block without cURL sibling fails. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-DOC-001 | If a method is not in `@elapse/sdk`, it is not in the docs (§6). No "beta", "coming soon", or roadmap pages. |
| BR-DOC-002 | Docs are written against the SDK, not the other way around: an SDK change opens a docs PR in the same change set. |
| BR-DOC-003 | Code samples are executed, not typed: Quickstart from `examples/saas` (FR-DOC-011), CLI output from CLI tests, payloads from the OpenAPI schema. |
| BR-DOC-004 | Secret keys, webhook secrets, and merchant ids in samples are obvious placeholders (`sk_test_…`, `whsec_…`); never a real key, even a test one. |
| BR-DOC-005 | Chain vocabulary is confined to Introduction (why Monad) and Contracts. Checkout and Quickstart pages describe the subscriber experience in dollars and seconds. |
| BR-DOC-006 | Money in prose and samples is a decimal string with the unit (`"0.004"` USD/second), never a float. |
| BR-DOC-007 | The docs build never depends on `web/` or `api/` being up; only on committed files (`openapi.json`, deployments, example source). |

## Interfaces

```
docs/                     site source (framework per Undecided 1)
docs/ci/quickstart.sh     CI script: steps 2–6 of the Quickstart against testnet (secrets from CI env)
docs/ci/surface-check.ts  SDK exports ⇄ docs method list ⇄ OpenAPI operationIds
api/openapi.json          input to API reference (owned by api/)
contracts/deployments/    input to Contracts page (owned by contracts/)
examples/saas/src/*.ts    include-by-region source for Quickstart snippets
```

## Undecided (human)

1. **Framework.** Options: (a) **Mintlify** — hosted, OpenAPI reference and tabs built in, fastest to look Stripe-grade, but hosted build and a paid tier for custom domain features; (b) Nextra — in-repo Next.js, full control, OpenAPI needs a plugin (e.g. `scalar`), more work; (c) Docusaurus — mature OpenAPI plugin, heavier look. **Recommend (a) Mintlify** for six weeks solo; move to Nextra after if lock-in hurts.
2. **Domain.** `docs.elapse.dev` vs the Vercel/Mintlify default URL until DNS is ready. **Recommend** claim the subdomain in Week 3; the write-up must carry the final URL.
3. **Test clocks content.** Options: real test-clock API resource; a "demo rate" recipe (high-rate testnet product so 15 s shows dollars); drop the page. **Recommend the recipe**, and keep the page because §6 lists it.
4. **Python tab when Python slips** (§4.3). Hide entirely vs show "cURL instead" note. **Recommend hide**; BR-DOC-001 forbids promises.
5. **Quickstart CI cadence.** Every PR (slow, uses testnet funds) vs nightly + release. **Recommend nightly + on PRs touching `sdk/`, `examples/`, `docs/`**.

## Open

- OpenAPI ownership and location (`api/openapi.json` assumed; API FRD to confirm).
- Testnet faucet/funding for the CI merchant account.
- Whether the docs site also hosts the status page link target.
