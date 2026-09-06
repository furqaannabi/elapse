# Docs site — FRD

Status: **Signed 2026-09-06 (William)** · Surface: Merchant developer docs (public, desktop-first) · Sources: detailed doc §4.1–§4.4, §5.1–§5.3, §6, §9, §10 step 1, §11 (Agora page), §12 Weeks 3, 4, 6, §13, §14, §15; design brief (direction, Landing CTA "Read the docs"); `docs/README.md`; [ADR 2026-09-06 docs site](../decisions/2026-09-06-docs-site-mintlify-and-quickstart-ci.md); [ADR 2026-09-06 CLI](../decisions/2026-09-06-cli-transport-and-session.md) (test clocks out).

## Problem

The demo opens on the docs (§10, 0:00–0:35) and the judging bar is "clone `examples/saas` and receive a webhook" (§12 Week 6). The docs are therefore a product surface, not a README: a Quickstart a stranger completes in under 10 minutes, a webhook catalog, a signature page, and a generated API reference — hosted separately so a contract or app outage during judging cannot take them down (§13). The known risk is drift: the Quickstart must be executed by CI or "it is a lie" (§15). Nothing of this exists yet: `docs/` holds markdown only, the OpenAPI document lives only at runtime on the API, and `examples/saas` is a README stub. The published SDK defaults to a host that does not resolve (`api.elapse.dev`; the domain is now `elapse.finance`), so a merchant who follows a Quickstart without an explicit base URL fails at their first call.

## Solution

A Mintlify site under `docs/site/` with nine pages, an API reference rendered from a committed, filtered `api/openapi.json`, code samples synced from `examples/saas` source, and a GitHub Actions job that runs the Quickstart against a local API on every relevant PR and nightly. Every snippet constructs the client with an explicit `baseUrl` until the SDK default points at `api.elapse.finance` and that host resolves.

## User stories

1. As a merchant engineer, I want to install the SDK, create a Product, get a Checkout URL, and verify one webhook in under 10 minutes, so that I trust the rest of the platform.
2. As a merchant engineer, I want every code sample in TS and cURL (and Python when it ships), so that I can integrate from any stack.
3. As a merchant engineer, I want a catalog of every Event with its payload and my expected action, so that my handler is complete.
4. As a merchant engineer, I want the signature scheme spelled out with a verification snippet, so that I can verify by hand if the SDK is unavailable.
5. As a merchant engineer, I want an Authentication page that tells me which key to use, where it comes from, and what base URL to pass, so that my first request succeeds.
6. As a merchant engineer, I want an Errors page listing every error `type` with an example, so that my client handles each one.
7. As a merchant engineer, I want to paste a test key into the reference and call the API from the browser, so that I see a real `prod_` before writing code.
8. As a merchant engineer, I want a Testing page that explains test mode, a demo-rate Product, and local webhook forwarding, so that I can try the whole loop on my laptop.
9. As a judge, I want the Contracts page to show addresses, events, and settle semantics, so that I can verify the chain without judge mode.
10. As a judge, I want the reference to look and behave like Stripe's, so that I believe merchants can integrate in an afternoon.
11. As the team, I want the Quickstart to run in CI so that a stale snippet fails a build, not a demo.
12. As the team, I want the reference to contain only the frozen SDK surface, so that the docs never promise a route merchants cannot call.
13. As the team, I want the docs to build from committed files only, so that a platform outage cannot break a docs deploy.

## Functional requirements

### Site and navigation (§6, §9, §13; ADR Q1, Q5, Q6)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-001 | The site is a **Mintlify** project in `docs/site/` (`docs.json` + MDX), hosted by Mintlify from the GitHub repo and deploying independently of `web/`, `api/`, and `contracts/`. It is served on Mintlify's own subdomain until `docs.elapse.finance` is pointed at it (Open item); the hackathon write-up carries whichever URL is final. `mintlify dev` runs the site locally. | Deploy preview per PR from the Mintlify GitHub app; `web` outage does not affect docs (separate host). |
| FR-DOC-002 | Left nav has exactly these nine top-level entries in this order: Introduction, Quickstart, Checkout, Subscriptions, Webhooks, SDKs, API reference, Contracts, **Testing**. "Testing" replaces the detailed doc's "Test clocks" because no test-clock resource ships for 13 October (API FR-API-090/091 not built). | `docs.json` navigation snapshot test. |
| FR-DOC-003 | Every page has a title, a one-sentence description, and headings that appear in the right-hand "On this page" list; Mintlify search covers all pages. | Lint: MDX frontmatter `title` and `description` required on every page. |
| FR-DOC-004 | Light and dark themes from DESIGN.md tokens through `docs.json` (`colors`, `font`, logo per theme), tabular monospaced numerals in code and tables, the Elapse wordmark, and a footer with GitHub and npm links. Mintlify's own layout is accepted as is; no custom CSS beyond numerals. | Screenshot review at 1440 and 390. |

### Quickstart (§6, §10 step 1, §12 Week 3, §15; ADR Q3, Q4, Q6)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-010 | Quickstart has exactly these steps: 1 get a test secret key from the dashboard; 2 `npm install @elapse/sdk` and construct `new Elapse({ secretKey, baseUrl })` with the hosted API URL; 3 `products.create`; 4 `checkout.sessions.create` and print `session.url`; 5 handle `subscription.canceled` with `constructEvent`; 6 run `npx @elapse/cli listen --forward localhost:3000/webhooks`; 7 open the URL on a phone, Start, Cancel, see `seconds_elapsed`. | Page structure snapshot; each step has a code block. |
| FR-DOC-011 | Every Quickstart snippet is the text between `// region:<name>` / `// endregion` markers in `examples/saas` source, never hand-typed. Because Mintlify cannot include source files, a script `docs/scripts/sync-snippets.ts` writes them into committed `docs/site/snippets/*.mdx`, and a test fails when a committed snippet differs from its region or a referenced region is missing. | `pnpm --filter docs sync-snippets --check` green in CI; deleting a region fails it. |
| FR-DOC-012 | `docs/ci/quickstart.sh` runs steps 2–6 in GitHub Actions **against a local API**: a Postgres service, `bun run migrate`, the API and worker as background processes, `bun run seed-merchant` for the key, then the example's `npm install && npm start` with `ELAPSE_API_URL` pointing at the local API, a `POST /v1/webhook_endpoints` for `http://localhost:3000/webhooks`, that endpoint's `test` call (FR-API-063), and an assertion that the example logs the verified Event. Runs on every PR touching `sdk/`, `examples/`, `docs/`, or `api/`, and nightly. Fails on any error or wall time over 10 min. The chain is never touched; step 7 is not in CI. | GitHub Actions job green; time asserted; no secret in the workflow beyond the seeded key printed to the job. |
| FR-DOC-013 | The Quickstart states up front: "Takes about 10 minutes · you need Node 20 and a dashboard account." and ends with "Next: Webhooks catalog" and "Clone the finished merchant: examples/saas". | Text present. |
| FR-DOC-014 | Build order: `examples/saas` ships first in its own PR against the examples FRD (which needs its own grill and signature), because FR-DOC-011 reads from it; the docs site follows in a second PR. The examples FRD gains `ELAPSE_API_URL` in its env contract for the same reason as BR-DOC-008. | Two PRs; the docs PR contains no hand-typed snippet. |

### Guides (§6 items 1, 3, 4, 8, 9; §7; §11)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-020 | Introduction explains per-second money, why Monad (300 ms blocks), and the three surfaces (Protocol, Platform API, Checkout) in ≤ 400 words with the §5.3 payload as its hero code block. | Word count and code block asserted. |
| FR-DOC-021 | Checkout page documents the subscriber UX, `success_url?session_id=cs_…`, `cancel_url`, session states (open / complete / expired), and the "no chain words" promise. | Sections present; links to checkout FRD states. |
| FR-DOC-022 | Subscriptions page documents the state machine `incomplete → active → paused \| canceled`, start, pause/resume, cancel, and the elapsed-billing formula (whole seconds × rate) with a worked 83 s example. | Diagram + example present. |
| FR-DOC-023 | Contracts page lists the testnet (and, if live, mainnet) `StreamFactory` address, `AccrualStream` events (`StreamCreated, StreamStarted, StreamPaused, StreamCanceled, Settled(seconds, amount)`), and settle semantics. Addresses are read from `contracts/deployments/*.json` by `sync-snippets` into a committed snippet. | Missing deployment file fails the sync check; addresses match. |
| FR-DOC-024 | **Testing** page (was "Test clocks"): test vs live keys and what test mode is (real streams on testnet, MockUSD minted at checkout); the demo-rate recipe (a high-rate testnet Product so 15 seconds shows dollars); `npx @elapse/cli listen --forward …` with sample terminal output and the printed signing secret; the dashboard's "send test delivery" button; and one sentence that there is no test-clock API. Absorbs FR-DOC-033. | Page exists with all five sections; CLI output block is a snapshot from the CLI test suite. |
| FR-DOC-025 | If Aurora lands (§11), a page "Accept any-chain, bill in dollars" is added under Checkout; otherwise it is absent (no "coming soon" pages). | Nav contains no placeholder pages. |
| FR-DOC-026 | Subscriptions page carries a "Build the meter in your own product" section: `subscriptions.list` to find a customer's running meters, `subscriptions.retrieve` for `rate_usd_per_second` and `started_at`, the client-side tick, and `subscriptions.cancel` behind the merchant's own button — with the note that a merchant-initiated cancel refunds the subscriber exactly as their own cancel would (dashboard decision 7). It also states plainly that Elapse hosts one page in the flow, the checkout, and that the subscriber account page is optional for merchants and Elapse-branded across merchants ([ADR 2026-09-04 account page](../decisions/2026-09-04-account-page-cross-merchant.md)). | Section present; snippets compile; no per-second polling shown. |

### Webhooks (§4.4, §5.1–§5.3, §6 item 5)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-030 | Event catalog page: a table of the six MVP types with "When" and "Merchant action" copied from §5.1, followed by one full example payload per type. It states explicitly that there are no per-second events. | Six payloads validate against the committed OpenAPI `Event` schema in CI. |
| FR-DOC-031 | Signature page: header format `t=unix,v1=hmac_sha256`, signed payload `{t}.{raw_body}`, 300 s window, `whsec_` secret, constant-time compare; a TS snippet using `constructEvent` and a "verify by hand" snippet (Node crypto and cURL/openssl) that produce the same digest for a published test vector. | Test vector (secret, t, body, v1) is checked by SDK unit tests. |
| FR-DOC-032 | Delivery page: retry schedule `0 s, 30 s, 2 m, 10 m, 1 h` capped at 8 tries, 10 s timeout, 2xx = success, idempotent handling by `evt_` id, auto-disable after 3 days of failure, and the dashboard resend button. | Numbers match §5.2 and the worker's schedule constant (synced snippet). |
| FR-DOC-033 | Folded into FR-DOC-024 (Testing page). | — |

### SDKs and API reference (§4, §6 items 6–7, §12 Week 4; ADR Q2, Q7)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DOC-040 | SDKs page has tabs TypeScript · cURL for each of the ten frozen methods (SDK FR-SDK-007, including `subscriptions.list`); the TS tab is the §4.2 snippet. Python is hidden entirely until `elapse` is published (BR-DOC-001). | Tab set snapshot; the ten methods match the SDK export list. |
| FR-DOC-041 | API reference is rendered by Mintlify from the committed `api/openapi.json` (API FR-API-085), referenced by relative path in `docs.json`; hand-written reference pages are forbidden. The file contains only the nine public operations, grouped by tag (Products, Checkout, Subscriptions, Customers, Invoices). | Build fails if the file is missing or invalid; nav under "API reference" is generated, not authored. |
| FR-DOC-042 | Every SDK method in the docs maps to one operation in the committed OpenAPI file and vice versa; `docs/ci/surface-check.ts` diffs the SDK's exported method list, the SDKs page's method list, and the file's `operationId`s. | Check passes; adding a doc for a non-SDK method fails it. |
| FR-DOC-043 | Every TS snippet has a cURL equivalent beside it (tab or adjacent block) showing the same request, with `-H "Authorization: Bearer sk_test_…"` and the hosted API URL. | Lint rule: TS block without cURL sibling fails. |
| FR-DOC-044 | **Authentication** page above the reference: `Authorization: Bearer sk_test_…`, where keys come from (dashboard → Developers), test vs live, the `baseUrl` to pass and why (the SDK default resolves only once `api.elapse.finance` is live and a new SDK release points at it), and that secret keys never go in a browser or a client app. **Errors** page: the error envelope and each `type` from FR-API-082 with one example and the merchant's expected handling. | Both pages present; error types equal the API's enum (synced snippet). |
| FR-DOC-045 | The reference's try-it panel is **enabled** with bearer auth so a merchant pastes a test key and calls the hosted API from the browser. The panel states that live keys are refused from the browser; the API enforces it (FR-API-086). | Manual: a `products.create` from the panel returns a `prod_`; a live key from the panel returns `401`. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-DOC-001 | If a method is not in `@elapse/sdk`, it is not in the docs (§6). No "beta", "coming soon", or roadmap pages. |
| BR-DOC-002 | Docs are written against the SDK, not the other way around: an SDK change opens a docs PR in the same change set. |
| BR-DOC-003 | Code samples are synced, not typed: Quickstart and handler from `examples/saas` regions, CLI output from CLI tests, payloads and error types from the OpenAPI file, addresses from deployments, the retry schedule from the worker. A committed snippet that differs from its source fails CI. |
| BR-DOC-004 | Secret keys, webhook secrets, and merchant ids in samples are obvious placeholders (`sk_test_…`, `whsec_…`); never a real key, even a test one. |
| BR-DOC-005 | Chain vocabulary is confined to Introduction (why Monad), Contracts, and the one sentence on the Testing page about MockUSD. Checkout and Quickstart pages describe the subscriber experience in dollars and seconds. |
| BR-DOC-006 | Money in prose and samples is a decimal string with the unit (`"0.004"` USD/second), never a float. |
| BR-DOC-007 | The docs build never depends on `web/` or `api/` being up; only on committed files (`api/openapi.json`, synced snippets). |
| BR-DOC-008 | Every snippet that constructs a client passes `baseUrl` explicitly (from `ELAPSE_API_URL` in the example) until the SDK's default host exists; `api.elapse.finance` and `docs.elapse.finance` are written as live URLs only once they resolve. The old `elapse.dev` names never appear. |
| BR-DOC-009 | The OpenAPI file published to docs contains no dashboard, subscriber, CLI, API-key, webhook-endpoint, ingest, or internal operation. |

## Implementation decisions

Modules, each testable alone:

- **OpenAPI export** (in `api/`): a `public` marker on the nine public route definitions, a script that writes the filtered document to `api/openapi.json` with the bearer security scheme, resource tags, and the hosted server URL, and a test that the committed file is fresh and its operation set equals the SDK's exported methods (FR-API-085). This is the deep module: the docs, the surface check, and the try-it panel all consume one file.
- **Snippet sync** (in `docs/`): region extraction from `examples/saas`, deployments, the worker schedule constant, the API error enum, and the CLI test snapshot into `docs/site/snippets/*.mdx`; `--check` mode for CI.
- **Surface check** (in `docs/ci/`): three sets compared, SDK exports, SDKs page, `operationId`s.
- **Site** (`docs/site/`): `docs.json` (nav, theme, openapi path), nine MDX pages, snippet imports.
- **CI** (`.github/workflows/`): first workflow in the repo; `quickstart` job (FR-DOC-012), `docs-checks` job (snippet sync check, surface check, frontmatter lint, OpenAPI validity, payload validation), unit-test jobs for the packages the PR touches.
- **API CORS for the docs origin** (FR-API-086): `DOCS_ORIGIN` env; live keys refused from that origin.

## Testing decisions

A good test asserts external behaviour, not structure: the committed file equals the generator's output; the operation set equals the SDK's methods; a region edit changes the snippet; the Quickstart job ends with the example's "revoke access" or "mark entitled" line. Tested: OpenAPI export (bun test in `api/`, prior art `api/test/*.test.ts`), snippet sync and surface check (vitest in `docs/`, prior art `cli/test`), `docs.json` navigation snapshot and frontmatter lint (vitest in `docs/`). Not unit-tested: Mintlify's rendering; that is the screenshot review in FR-DOC-004.

## Interfaces

```
docs/site/docs.json          nav (FR-DOC-002), theme (FR-DOC-004), "openapi": "../../api/openapi.json"
docs/site/*.mdx              nine pages
docs/site/snippets/*.mdx     synced, committed, never edited by hand
docs/scripts/sync-snippets.ts  regions + deployments + constants → snippets; --check
docs/ci/quickstart.sh        FR-DOC-012 against a local API
docs/ci/surface-check.ts     SDK exports ⇄ SDKs page ⇄ operationIds
api/openapi.json             committed by `bun run openapi` (FR-API-085)
contracts/deployments/       input to the Contracts snippet
examples/saas/src/*.ts       region source
.github/workflows/ci.yml     quickstart + docs-checks + package tests
```

## Undecided (human)

1. ~~**Framework.**~~ **Decided 2026-09-06 (William): Mintlify.** Stripe-grade reference in a day; the hosting connect is William's five-minute step; content is portable MDX.
2. ~~**Domain.**~~ **Decided 2026-09-06: `elapse.finance`** (William, later the same day; the app had been on `elapse-monad.vercel.app` only). Mintlify subdomain until `docs.elapse.finance` is pointed at it; snippets pass `baseUrl` (BR-DOC-008) until the SDK default is re-released; the write-up carries the final URL.
3. ~~**Test clocks content.**~~ **Decided 2026-09-06: the page is "Testing"** with the demo-rate recipe (FR-DOC-024); no test-clock resource.
4. ~~**Python tab when Python slips.**~~ **Decided: hide** (BR-DOC-001).
5. ~~**Quickstart CI cadence.**~~ **Decided 2026-09-06: local API in the Actions job**, on PRs touching `sdk/`, `examples/`, `docs/`, `api/`, and nightly (FR-DOC-012).
6. ~~**Reference auth and try-it.**~~ **Decided 2026-09-06: bearer test keys, try-it enabled**, live keys refused from the browser (FR-DOC-045, FR-API-086).

## Open

- **Hosted API URL (William).** Needed before the site goes live: it goes into the OpenAPI `servers` entry, the Authentication page, and every cURL sample. Unknown on 2026-09-06.
- DNS for `elapse.finance`: which hosts exist (`api.`, `docs.`, the app at the root or `app.`) and when; then a new SDK release moves the default to `api.elapse.finance` and the explicit `baseUrl` leaves the snippets.
- Mintlify custom-domain tier: confirm on their pricing page before relying on it.
- Whether the docs footer links a status page (`GET /v1/status` exists; no page yet).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-04 | Claude (for William) | FR-DOC-026 "build the meter in your own product" section; FR-DOC-040 counts ten frozen methods after `subscriptions.list`. |
| 2026-09-06 | Claude (for William) | Grill applied ([ADR 2026-09-06 docs site](../decisions/2026-09-06-docs-site-mintlify-and-quickstart-ci.md)): Mintlify in `docs/site/`; committed filtered `api/openapi.json` (FR-DOC-041, FR-API-085); Quickstart CI against a local API (FR-DOC-012); example-first build order (FR-DOC-014); "Testing" replaces "Test clocks" and absorbs FR-DOC-033 (FR-DOC-024); explicit `baseUrl` everywhere (BR-DOC-008); Authentication and Errors pages (FR-DOC-044); try-it enabled with live keys refused from the browser (FR-DOC-045, FR-API-086); snippet sync replaces include-by-region (FR-DOC-011, BR-DOC-003); Undecided 1–6 closed; hosted API URL opened. Awaiting signature. |
| 2026-09-06 | William | Signed. Build order: examples FRD grill and signature, then `examples/saas`, then the docs site. |
| 2026-09-06 | Claude (for William) | Domain is `elapse.finance` (William): Undecided 2, FR-DOC-001, FR-DOC-044, BR-DOC-008 and the Open list now name `api.elapse.finance` / `docs.elapse.finance`; the explicit-`baseUrl` rule stands until the SDK default is re-released. |
