# `examples/saas` (the merchant in the demo video) — FRD

Status: **Draft — awaiting human sign-off** · Surface: Reference merchant (Node server, terminal) · Sources: detailed doc §4.2, §5.1–§5.3, §6, §7 step 5, §10 steps 1, 3, 4, §12 Weeks 3 and 6, §13, §14; `examples/saas/README.md`.

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
| FR-EXM-001 | `examples/saas` is a standalone Node 20+ project (own `package.json`, TypeScript run via `tsx`) depending on the **published** `@elapse/sdk`, not a workspace link, so `git clone` outside the monorepo works. | CI job copies the folder to a temp dir, `npm install && npm start` succeeds. |
| FR-EXM-002 | `.env.example` lists exactly `ELAPSE_SECRET_KEY`, `ELAPSE_WEBHOOK_SECRET`, `PORT=3000`, `BASE_URL=http://localhost:3000` with one comment each saying where to get it (dashboard; CLI startup line). Missing `ELAPSE_SECRET_KEY` exits 1 with that sentence. | Unit test on config loader; exit code asserted. |
| FR-EXM-003 | `npm start` (a) creates or reuses a Product `"GPU · 4090"` at `"0.004"` USD/s (reuse by name via `products.list`), (b) creates a Checkout session with `successUrl = {BASE_URL}/ok` and `cancelUrl = {BASE_URL}/cancel`, (c) prints `Checkout: {session.url}` and `Webhooks: POST {BASE_URL}/webhooks`, (d) listens on `PORT`. Total under 3 s after install. | Mock API run asserts the two requests match §4.2 bodies; stdout snapshot. |
| FR-EXM-004 | The README has sections in this order: What this is · Prerequisites · Run it (four commands: clone, cp env, npm install, npm start; plus `npx @elapse/cli listen --forward localhost:3000/webhooks` in a second terminal) · What you will see · How the handler works · Files. It is written against the Quickstart and links to it. | README lint: headings snapshot; every command in it is executed by the CI job. |

### Fake product page (§7 step 5, §10 step 1)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-010 | `GET /` serves a one-file HTML product page: merchant name "Acme GPU", product "GPU · 4090", price "$0.004 / second · ~$14.40 / hour", and a **Start** button linking to the current `session.url`. Each page load creates a fresh Checkout session if the cached one is not `open`. | Playwright: page renders; link matches `/\/c\/cs_/`. |
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
| FR-EXM-031 | The full judge path is a CI job: start server against testnet, run the platform's test-delivery (or `demo:check`), assert 200 and the revoke line, under 2 minutes. | GitHub Actions job green nightly. |

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
  public/index.html  fake product page
Log format:  HH:MM:SS  evt_1S2…  subscription.canceled  → revoke access · 83s · $0.33
```

Example terminal (demo steps 3–4, §10):

```
$ npm start
Product:  prod_9f2…  GPU · 4090  $0.004/s
Checkout: https://pay.elapse.dev/c/cs_7Ha…
Webhooks: POST http://localhost:3000/webhooks
Listening on :3000

14:02:11  evt_1S2a…  subscription.created    → mark entitled sub_4Qe…
14:02:26  evt_1S2b…  subscription.canceled   → revoke access · 83s · $0.33
14:02:26  ↺ duplicate evt_1S2b…
14:03:40  evt_1S2c…  invoice.payment_failed  → revoke access (payment failed) sub_8Lm…
```

## Undecided (human)

1. **HTTP layer.** Options: (a) **`node:http`** — zero deps, raw body is the default, ~40 lines; (b) Hono — matches the API stack (§9), `c.req.text()` gives raw body, one dep; (c) Express — most familiar to Stripe users but JSON middleware is the classic raw-body footgun. **Recommend (a)** for the example (nothing to explain), with a Hono snippet in the docs Webhooks page.
2. **`invoice.payment_failed` log line.** §5.1 says "Pause product access"; §10 step 4 says the server logs "revoke access". **Recommend "revoke access (payment failed)"** to match the video script; the map field is boolean either way.
3. **Product reuse across restarts.** Create a new Product each `npm start` (simple, litters the dashboard) vs reuse by name via `products.list`. **Recommend reuse by name.**
4. **Triggering `payment_failed` for the demo.** Real empty escrow on testnet vs a platform "send test event" button (dashboard FR-DSH-060s). **Recommend both exist; the video uses the real one.**
5. **Language.** TypeScript via `tsx` (matches SDK types) vs plain JS (`node index.js`, no build). **Recommend TypeScript**; the docs snippets are TS.

## Open

- Whether the platform offers a "send test Delivery" endpoint the CI job (FR-EXM-031) can call, or CI relies on `demo:check` only.
- Merchant display name/logo in the checkout for this example ("Acme GPU") — needs dashboard branding (FR-DSH-080s).
- Publish the example as a GitHub template repo in addition to the monorepo folder.
