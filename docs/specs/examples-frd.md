# `examples/saas` (the merchant in the demo video) — FRD

Status: **Signed 2026-09-06 (William)** · Surface: Reference merchant (Node server, terminal) · Sources: detailed doc §4.2, §5.1–§5.3, §6, §7 step 5, §10 steps 1, 3, 4, §12 Weeks 3 and 6, §13, §14; `examples/saas/README.md`; [ADR 2026-09-06 docs site](../decisions/2026-09-06-docs-site-mintlify-and-quickstart-ci.md) (example-first build order, explicit `baseUrl`, local-API CI).

## Problem

The doc sets the judging bar as "Judges can clone `examples/saas` and receive a webhook" (§12 Week 6) and says the demo merchant "is that quickstart, not a special case" (§6). `examples/saas` is therefore three things at once: the code the Quickstart snippets are extracted from, the server on screen in demo steps 3–4 (§10), and the artefact a judge runs. It must create a Product, create a Checkout session, print the URL, receive Deliveries through `constructEvent`, and log "revoke access" when the meter stops or payment fails — with `git clone`, an env file, and one command.

## User stories

1. As a judge, I want to clone the repo, paste two keys, run one command, and see a Checkout URL, so that I can prove the platform works without reading code.
2. As a judge, I want to cancel on my phone and see `subscription.canceled` with `seconds_elapsed` and "revoke access" in the terminal, so that I see the webhook, not a cron job.
3. As a merchant engineer, I want the smallest correct webhook handler (raw body, `constructEvent`, dedupe, 2xx fast), so that I can copy it into my own server.
4. As a demo presenter, I want a fake product page with a Start button and a success page, so that the video has a merchant to cut back to.
5. As the docs author, I want the example to be the source of the Quickstart snippets, so that docs and code cannot drift.

## Functional requirements

### Setup and run (§12 Week 6, §13)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-001 | `examples/saas` is a standalone Node 20+ project (own `package.json`, TypeScript run via `tsx`) depending on the **published** `@elapse/sdk` pinned `^0.1.0`, not a workspace link, so `git clone` outside the monorepo works. An SDK change the example needs is published first (William 2026-09-06, Q2 a). | CI job copies the folder to a temp dir outside the workspace, `npm install && npm start` succeeds. |
| FR-EXM-002 | `.env.example` lists exactly `ELAPSE_SECRET_KEY`, `ELAPSE_WEBHOOK_SECRET`, `ELAPSE_API_URL`, `PORT=3000`, `BASE_URL=http://localhost:3000` with one comment each saying where to get it (dashboard; CLI startup line; the docs Authentication page). The client is constructed with `baseUrl: ELAPSE_API_URL` (docs BR-DOC-008); missing `ELAPSE_SECRET_KEY` or `ELAPSE_API_URL` exits 1 with a sentence naming the variable. | Unit test on config loader; exit code asserted for each. |
| FR-EXM-003 | `npm start` (a) creates or reuses a Product `"GPU · 4090"` at `"0.004"` USD/s (reuse by name via `products.list`), (b) creates a Checkout session with `successUrl = {BASE_URL}/ok` and `cancelUrl = {BASE_URL}/cancel`, (c) prints `Checkout: {session.url}` and `Webhooks: POST {BASE_URL}/webhooks`, (d) listens on `PORT`. Total under 3 s after install. | Mock API run asserts the two requests match §4.2 bodies; stdout snapshot. |
| FR-EXM-004 | The README has sections in this order: What this is · Prerequisites · Run it (four commands: clone, cp env, npm install, npm start; plus `npx @elapse/cli listen --forward localhost:3000/webhooks` in a second terminal) · What you will see · How the handler works · Files. It is written against the Quickstart and links to it. | README lint: headings snapshot; every command in it is executed by the CI job. |

### Fake product page (§7 step 5, §10 step 1)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-010 | `GET /` serves the merchant's HTML product page (Acme GPU's own look, [ADR 2026-09-06](../decisions/2026-09-06-example-merchant-own-brand.md); one HTML file per page plus a shared `/acme.css`, no framework): merchant name "Acme GPU", product "GPU · 4090", price "$0.004 / second · ~$14.40 / hour", and a **Start** button linking to the current `session.url`. Each page load creates a fresh Checkout session if the cached one is not `open`. | Playwright: page renders; link matches `/\/c\/cs_/`. |
| FR-EXM-011 | `GET /ok?session_id=cs_…` shows "Access granted for session cs_…" and the entitlement state for that session's Subscription (looked up from FR-EXM-023's map, or "pending webhook"). `GET /cancel` shows "Checkout canceled. Nothing was charged." | Route tests with both states. |
| FR-EXM-012 | `GET /access/:sub_id` returns `{ entitled: boolean, reason }` as JSON — the merchant's "is this customer allowed in" check. | Unit test before/after a canceled Event. |

### Webhook handler (§4.2, §4.4, §5.1–§5.3, §10 steps 3–4)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-020 | `POST /webhooks` reads the **raw** request body (no JSON middleware before it) and calls `elapse.webhooks.constructEvent(rawBody, req.headers["x-elapse-signature"], ELAPSE_WEBHOOK_SECRET)`. | Test: a body re-serialised with different whitespace would fail; raw passes. |
| FR-EXM-021 | Verification failure responds `400 {"error":"invalid signature"}` and logs one line `✗ rejected: <reason>`; nothing else happens. | Tests: missing, tampered, expired header → 400, map unchanged. |
| FR-EXM-022 | A verified Event responds `200` within 100 ms **before** doing merchant work, and is deduplicated by `evt_` id (in-memory set) so redeliveries (§5.2 retries) log `↺ duplicate evt_…` and change nothing. | Same Event twice → one action log line. |
| FR-EXM-023 | The handler keeps an in-memory entitlement map `sub_ → { entitled, customer, updated_at }` and applies §5.1 merchant actions: `checkout.session.completed` → log `provision access`; `subscription.created` → `entitled=true`, log `mark entitled`; `subscription.updated` → log `sync entitlement (status)`; `subscription.canceled` → `entitled=false`, log `revoke access · {seconds_elapsed}s · ${amount_settled}`; `invoice.settled` → log `book revenue ${amount_settled}`; `invoice.payment_failed` → `entitled=false`, log `revoke access (payment failed)`. Unknown types log `ignored`. | One test per type asserts the map and the exact log line. |
| FR-EXM-024 | Each received Event is printed as: header line `evt_… subscription.canceled` then the pretty JSON body (`LOG_JSON=0` suppresses), so the terminal in the demo shows `seconds_elapsed`. | Snapshot on §5.3 payload. |
| FR-EXM-025 | The handler code lives in one file `src/webhooks.ts` under 80 lines with `// region:` markers (`verify`, `handle`) used by the docs include (docs FRD FR-DOC-011). | Line count test; region markers present. |

### Demo readiness (§10 steps 3–4, §12 Week 6)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-030 | `npm run demo:check` sends a locally signed `subscription.canceled` (using `ELAPSE_WEBHOOK_SECRET`) to `POST /webhooks` and exits 0 only if the server logs `revoke access`. Used before recording and in CI. | Script exit code test. |
| FR-EXM-031 | The full judge path is the docs Quickstart CI job (docs FR-DOC-012): a local API and worker in GitHub Actions, the example started with `ELAPSE_API_URL` pointing at it, an HTTP Webhook endpoint registered for `POST {BASE_URL}/webhooks`, that endpoint's test call (API FR-API-063), and an assertion on the example's log line, under 2 minutes. No testnet, no chain. | GitHub Actions job green on relevant PRs and nightly. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-EXM-001 | Every API call goes through `@elapse/sdk`; the example contains no hand-written `fetch` to the platform and uses only frozen methods (BR-SDK-001). |
| BR-EXM-002 | Always verify before acting: no code path touches the entitlement map without a successfully constructed Event. |
| BR-EXM-003 | Respond 2xx first, work second; the handler never awaits merchant logic before responding (10 s worker timeout, §5.2). |
| BR-EXM-004 | Idempotent on `evt_` id; a redelivered Event is a no-op. |
| BR-EXM-005 | Secrets come only from env; `.env` is gitignored; the README shows `sk_test_…` placeholders only. |
| BR-EXM-006 | Money and rates are decimal strings as received; the example never does arithmetic on `amount_settled` (it prints it). |
| BR-EXM-007 | No chain vocabulary in the product page or logs; "revoke access" and "you paid N seconds" are the copy. |
| BR-EXM-008 | Dependencies: `@elapse/sdk`, `tsx`, `dotenv` at most; no framework unless Undecided 1 chooses one. |

## Interfaces

```
examples/saas/
  README.md          FR-EXM-004
  .env.example       FR-EXM-002
  package.json       scripts: start, demo:check, test
  src/index.ts       boot: product, session, http server, routes / , /ok, /cancel, /access/:id, /webhooks
  src/webhooks.ts    // region:verify … // region:handle  (≤ 80 lines)
  src/entitlements.ts in-memory map + dedupe set
  public/index.html  product page; ok.html, cancel.html; acme.css (Acme GPU's own look, examples/saas/DESIGN.md)
Log format:  HH:MM:SS  evt_1S2…  subscription.canceled  → revoke access · 83s · $0.33
```

Example terminal (demo steps 3–4, §10):

```
$ npm start
Product:  prod_9f2…  GPU · 4090  $0.004/s
Checkout: https://elapse.finance/c/cs_7Ha…
Webhooks: POST http://localhost:3000/webhooks
Listening on :3000

14:02:11  evt_1S2a…  subscription.created    → mark entitled sub_4Qe…
14:02:26  evt_1S2b…  subscription.canceled   → revoke access · 83s · $0.33
14:02:26  ↺ duplicate evt_1S2b…
14:03:40  evt_1S2c…  invoice.payment_failed  → revoke access (payment failed) sub_8Lm…
```

## Undecided (human)

1. ~~**HTTP layer.**~~ **Decided 2026-09-06 (William): (a) `node:http`.** Zero dependencies, raw body by default; the docs Webhooks page carries Hono and Express snippets for the raw-body detail.
2. ~~**`invoice.payment_failed` log line.**~~ **Decided 2026-09-06: "revoke access (payment failed)"**, matching the video script (FR-EXM-023).
3. ~~**Product reuse across restarts.**~~ **Decided 2026-09-06: reuse by name** via `products.list` (FR-EXM-003).
4. ~~**Triggering `payment_failed` for the demo.**~~ **Decided 2026-09-06: the real cap end** (proven live 2026-09-05, API FR-API-051) for the video; the dashboard test-delivery button exists for rehearsal.
5. ~~**Language.**~~ **Decided 2026-09-06: TypeScript via `tsx`**; the docs snippets are TS.

## Open

- ~~Whether the platform offers a "send test Delivery" endpoint~~ **Yes**: `POST /v1/webhook_endpoints/:id/test` (FR-API-063), used by FR-EXM-031; `demo:check` stays for pre-recording.
- Merchant display name/logo in the checkout for this example ("Acme GPU") — needs dashboard branding (FR-DSH-080s).
- Publish the example as a GitHub template repo in addition to the monorepo folder.

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-06 | Claude (for William) | Grill applied ([ADR 2026-09-06 docs site](../decisions/2026-09-06-docs-site-mintlify-and-quickstart-ci.md)): `node:http`; published SDK pinned `^0.1.0`; `ELAPSE_API_URL` and explicit `baseUrl` (FR-EXM-002); CI is the docs Quickstart job against a local API (FR-EXM-031); Undecided 1–5 closed; test-delivery open item closed. Awaiting signature. |
| 2026-09-06 | William | Signed. Builds now, before the docs site. |
| 2026-09-06 | Claude (for William) | Built FR-EXM-001–004, 010–012, 020–025, 030 (29 tests, `pnpm --filter elapse-example-saas test`; typecheck clean). Proven on the local platform from a copy outside the workspace with `npm install` from npm: Product created, Checkout URL printed, two Events forwarded by `elapse listen` verified and logged, Event-level resend logged as duplicate, `/access` denied, `demo:check` green. Two details beyond the text: a listen failure (port in use) rejects with a readable message instead of an unhandled error; the session printed at start is the one the product page hands out first, so start creates one session, not two. FR-EXM-031 (CI job) lands with the docs-site PR that creates the first workflow. |
| 2026-09-06 | Claude (for William) | FR-EXM-031 built: `docs-site/ci/quickstart.sh` in the `quickstart` job of `.github/workflows/ci.yml`; proven locally in under a minute (copy outside the workspace, SDK from npm, Product, Checkout URL, worker-delivered signed event → "revoke access", `demo:check`). Regions in `boot.ts`/`webhooks.ts` now read standalone (`secretKey`, `secret`, `log`) because they are the docs' snippets. |
| 2026-09-06 | Claude (for William) | Acme GPU's own look ([ADR 2026-09-06](../decisions/2026-09-06-example-merchant-own-brand.md)): `public/{index,ok,cancel}.html` + `public/acme.css`, served by the example; FR-EXM-010 wording amended. The success page's meter status follows the entitlement ("Meter running" / "Meter stopped"). Tests 31; pinned copy unchanged. |
