# `examples/saas` (the merchant in the demo video) — FRD

Status: **FR-EXM-036/037, BR-EXM-011 (both examples on one subdomain, under path prefixes) Signed 2026-09-26 (Furqaan)** · **FR-EXM-032 amendment (bundle the page with esbuild) Signed 2026-09-17 (Furqaan)** · **FR-EXM-032 and the FR-EXM-003 amendment (`@elapse/react`) Signed 2026-09-17 (Furqaan)** · **Signed 2026-09-06 (William)** · Surface: Reference merchant (Node server, terminal) · Sources: detailed doc §4.2, §5.1–§5.3, §6, §7 step 5, §10 steps 1, 3, 4, §12 Weeks 3 and 6, §13, §14; `examples/saas/README.md`; [ADR 2026-09-06 docs site](../decisions/2026-09-06-docs-site-mintlify-and-quickstart-ci.md) (example-first build order, explicit `baseUrl`, local-API CI).

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
| FR-EXM-003 | `npm start` (a) creates or reuses a Product `"GPU · 4090"` at `"0.004"` USD/s (reuse by name via `products.list`), (b) creates a Checkout session with `successUrl = {BASE_URL}/ok` and `cancelUrl = {BASE_URL}/cancel`, (c) prints `Checkout: {session.url}` and `Webhooks: POST {BASE_URL}/webhooks`, (d) listens on `PORT`. Total under 3 s after install. **Amended 2026-09-17 (signed 2026-09-17, FR-EXM-032):** boot prints the product page, not a Checkout URL. **Amended 2026-09-21 (signed 2026-09-21, FR-EXM-033):** the Product is created with `allowPause: true`, and reuse requires it — the match is name **and** `active` **and** `allow_pause`, so a Product created before this amendment is left alone and a new one is created beside it. The SDK has no `products.update` and this amendment does not add one (BR-SDK-001, frozen surface §4.2). | Mock API run asserts the two requests match §4.2 bodies; stdout snapshot. A listed Product with `allow_pause: false` is not reused. |
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
| FR-EXM-032 | **`@elapse/react` in the SaaS example** ([ADR 2026-09-17](../decisions/2026-09-17-react-sdk-replaces-hosted-checkout.md)). The product page renders `<ElapseProvider publishableKey>` with `<Authorize session>`, `<Meter session>` and `<Receipt>` from `@elapse/react`'s browser build; the server creates the Checkout session and hands the page only its `cs_` id. No redirect to a hosted page. The example shows one `<TxLink>` on its own "Activity" line to demonstrate events. The CI path (FR-EXM-031) runs the Playwright flow authorise → meter → stop → receipt. **Amended 2026-09-17 (signed, [ADR 2026-09-17 examples bundle](../decisions/2026-09-17-examples-bundle-react-sdk.md)):** the page is bundled by `npm run build:web` (esbuild, `react`, `react-dom` and `@elapse/react` from `node_modules`), not loaded from a CDN; `npm start` builds first, then serves; the bundle folder is gitignored. **Amended 2026-09-21 (signed 2026-09-21, Furqaan):** `<Meter>` renders as the instrument card in the page at the existing `#elapse` mount — the layout the meter on elapse.finance wears: placard head (`merchant · product`, rate), readout, footer. The `dock="bottom-right"` capsule is withdrawn. `acme.css`'s `.push-mount --elapse-*` overrides stay, so the instrument wears Acme's plate-and-yellow rather than Elapse's colours: one instrument, themed by whoever embeds it. | Playwright in CI; no `url` read anywhere in the example. The rendered meter carries the placard head and is not `.elapse-dock`. |
| FR-EXM-033 | **Pause is asked for, not taken** ([ADR 2026-09-20](../decisions/2026-09-20-subscriber-cannot-pause.md)). `<Meter>` is passed `onPauseRequest` and `onResumeRequest`, so it renders Pause and Resume as requests: the button calls Acme's page, nothing is signed, and nothing reaches Elapse from the browser. Each handler posts `{ session }` to Acme's own `POST /pause` or `POST /resume`. The server maps the `cs_` id to its Subscription through FR-EXM-023's map (the browser never names a `sub_` id), answers `202 {status:"requested"}`, and `409 {error}` when that session has no running Subscription. | Route tests for both verbs: 202 with a running Subscription, 409 without, and 409 for an unknown session. |
| FR-EXM-034 | **Acme decides, at once.** On a `202` the server calls `subscriptions.pause` (or `resume`) through `@elapse/sdk` immediately — no approval queue — and logs one line in FR-EXM-020's format: `subscriber asked to pause · Acme approved → subscriptions.pause sub_…`. The decision is Acme's and is visible as Acme's, which is the point of the example. A platform refusal is logged and answered `502`; the meter is unchanged and the subscriber may ask again. The SDK call is injected like FR-EXM-003's `createSession`, so tests need no API. | Unit test on the injected dep: approve calls it once with the mapped `sub_` id; a rejection logs and answers 502 without touching entitlements. |
| FR-EXM-035 | ~~**The wait belongs to Acme's page.**~~ **Withdrawn 2026-09-21 (Furqaan: "sdk should have the meter ui not example"), superseded by React FR-RCT-046 before it shipped.** The waiting line is `<Meter>`'s, so every merchant gets it and none writes it. Acme passes `onPauseRequest`/`onResumeRequest` that return the promise of its own `POST /pause`, and renders nothing else. | The example contains no pause-status UI of its own; the promise it returns is what the meter reports. |
| FR-EXM-036 | **The saas page works under any path prefix** (new 2026-09-26, signed 2026-09-26, [ADR 2026-09-26](../decisions/2026-09-26-examples-on-one-subdomain.md)). Every URL the browser requests is relative — assets, links, and the `fetch` calls in `src/web`. The example behaves identically at `/` and under a prefix ending in `/`. Server routes are unchanged; the proxy strips the prefix. | A test fails on any root-absolute `src`/`href` in `public/*.html` or root-absolute `fetch` in `src/web`. |
| FR-EXM-037 | **Both examples on `examples.elapse.finance`** (new 2026-09-26, signed 2026-09-26, [ADR 2026-09-26](../decisions/2026-09-26-examples-on-one-subdomain.md)). `examples/deploy/` holds one nginx server block (`/saas/` → `127.0.0.1:3007`, `/lambda/` → `127.0.0.1:3006` with `proxy_read_timeout 120s`, a 301 from each no-slash path), two systemd units, and a root page linking both. `BASE_URL` carries the prefix (`https://examples.elapse.finance/saas`). Webhook endpoints are registered in the dashboard at `…/saas/webhooks` and `…/lambda/webhooks`; no CLI listener in production. Installs use `npm ci`. | `nginx -t` accepts the server block; the root page links both prefixes; the units start `npm start` in each example directory. |

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
| BR-EXM-009 | FR-EXM-033's routes are **unauthenticated**, exactly like FR-EXM-012's `/access/:sub`: anyone holding a `cs_` id can ask Acme to pause that meter. Harmless in the example — a pause only stops Acme's own service and saves the subscriber money, and it can never move money or reveal anything — but the README and the route's comment must say in one line that a production merchant authenticates the subscriber before acting on the ask. |
| BR-EXM-010 | Entitlements are untouched by this feature: FR-EXM-023 already sets `entitled: false, reason: "paused"` from `subscription.updated`, which is correct — a paused meter stops the billing and the serving together. No pause path writes to the entitlement map directly (BR-EXM-002). |
| BR-EXM-011 | **One origin, two merchants** (2026-09-26). Both pages share `https://examples.elapse.finance`, so neither may treat origin-scoped storage as its own. Today nothing does — `@elapse/react` keeps only the mute preference there. The Elapse window's `frame-ancestors` resolves to the shared origin, which is correct for both. |

## Interfaces

```
examples/saas/
  README.md          FR-EXM-004
  .env.example       FR-EXM-002
  package.json       scripts: start, demo:check, test
  src/index.ts       boot: product, session, http server, routes / , /ok, /cancel, /access/:id, /pause, /resume, /webhooks
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
6. **Basic auth on `/lambda/`** (open 2026-09-26). The runner executes arbitrary JavaScript with outbound internet, and its own header says not to expose it to untrusted users as-is. Checkout, `DAILY_RUN_LIMIT` and the invoke-only IAM scope bound the damage but don't prevent use as an outbound proxy. Built without auth until Furqaan decides.

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
| 2026-09-07 | Claude (for William) | FR-EXM-010 gap from the first full run: a subscriber who cancels on the meter never visits `/ok`, so the product page kept handing out the finished session and Start showed its receipt. The cache now also treats a session as used once `checkout.session.completed` has arrived for it (the SDK surface has no session retrieve; the webhook is the signal). Test in `server.test.ts`; 31 pass. |
| 2026-09-17 | Claude (for Furqaan) | **FR-EXM-032, awaiting sign-off** ([ADR](../decisions/2026-09-17-react-sdk-replaces-hosted-checkout.md)): the SaaS example authorises and meters in its own page with `@elapse/react`. |
| 2026-09-17 | Furqaan | **Signed** FR-EXM-032 and the FR-EXM-003 amendment (`@elapse/react`). |
| 2026-09-17 | Claude (for Furqaan) | **FR-EXM-032 amendment, awaiting sign-off** ([ADR](../decisions/2026-09-17-examples-bundle-react-sdk.md)): the SaaS page is bundled with esbuild by `build:web`, run by `npm start`, instead of loading `@elapse/react` from a CDN. |
| 2026-09-17 | Furqaan | **Signed** the FR-EXM-032 amendment (esbuild bundle). |
| 2026-09-21 | Claude (for Furqaan) | **FR-EXM-033/034/035 + BR-EXM-009/010 and the FR-EXM-003 and FR-EXM-032 amendments, awaiting sign-off** ([ADR 2026-09-20](../decisions/2026-09-20-subscriber-cannot-pause.md)): the subscriber asks Acme to pause and Acme approves at once; the Product must allow pausing, so boot no longer reuses one that does not; the meter stops docking and renders as the instrument in the page, wearing Acme's brand. Grilled 2026-09-21 (Furqaan): auto-approve, tighten the Product match rather than add `products.update`, two flat routes keyed by `cs_` id, the waiting line is the merchant's own UI, and "the homepage design" means its structure, not its paint. |
| 2026-09-21 | Furqaan | **Signed** FR-EXM-033/034/035, BR-EXM-009/010, and the FR-EXM-003 and FR-EXM-032 amendments. |
| 2026-09-21 | Claude (for Furqaan) | **FR-EXM-035 withdrawn, awaiting sign-off** (React FR-RCT-046): the waiting line moves out of the example and into `<Meter>`. Acme's handlers just return the promise of its own request. FR-EXM-033/034 are unaffected and built. |
| 2026-09-21 | Furqaan | **Signed** the FR-EXM-035 withdrawal; the waiting line is React FR-RCT-046's. |
| 2026-09-26 | Claude (for Furqaan) | **FR-EXM-036/037, BR-EXM-011 written** ([ADR 2026-09-26](../decisions/2026-09-26-examples-on-one-subdomain.md)): the saas page becomes prefix-safe and both examples move onto `examples.elapse.finance`. Undecided 6 records the open question of basic auth on `/lambda/`. |
| 2026-09-26 | Furqaan | **Signed** FR-EXM-036/037 and BR-EXM-011. |
| 2026-09-26 | Furqaan | FR-EXM-037's ports changed to fit the host: saas on `127.0.0.1:3007`, lambda on `127.0.0.1:3006` ("lambda port 3006 sas 7"). Nothing else in the requirement moves. |
