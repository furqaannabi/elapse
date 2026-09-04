# `@elapse/sdk` (TypeScript) and `elapse` (Python) — FRD

Status: **Draft — awaiting human sign-off** · Surface: Merchant SDK (server-side, Node 20+) · Sources: detailed doc §3, §4.1–§4.4, §5.1–§5.3, §9, §12 (Weeks 2, 5), §14, §15; current `sdk/ts/src/index.ts`, `sdk/ts/package.json`.

## Problem

A merchant engineer who already uses Stripe must be able to `npm install @elapse/sdk`, create a Product, create a Checkout session, and verify a signed webhook Event in one afternoon without learning chain vocabulary or building an HTTP client. The SDK surface is frozen (§4.2, §15): anything not listed here does not exist, and the docs may only show what the SDK has. Today `sdk/ts` ships only `constructEvent`, points `main` at a raw `.ts` file, and has no build, tsconfig, or tests.

## User stories

1. As a merchant engineer, I want `new Elapse({ secretKey })` and `products.create` / `checkout.sessions.create` to return typed objects, so that my IDE tells me the shape and I never hand-write REST calls.
2. As a merchant engineer, I want `webhooks.constructEvent(rawBody, header, secret)` to throw on any bad signature, so that a forged Event can never revoke or grant access.
3. As a merchant engineer, I want typed error classes, so that I can distinguish a bad key from a bad request from a platform outage.
4. As a merchant engineer, I want transient failures retried and idempotency keys honoured, so that a network blip never creates two Checkout sessions.
5. As a docs author, I want every SDK method to have exactly one REST equivalent, so that the cURL tab is always true.
6. As a Python merchant, I want `Elapse(secret_key=...)` and `webhooks.construct_event(...)` with the same nouns, so that Elapse is not TS-only.
7. As a judge, I want `npm install @elapse/sdk` from the README to work on 13 Oct.

## Functional requirements

### Client and resources (§4.2, §3)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-SDK-001 | `new Elapse({ secretKey, baseUrl? })` constructs a client; `baseUrl` defaults to `https://api.elapse.dev`; a missing or empty `secretKey` throws synchronously. | Unit: default `baseUrl` asserted; `new Elapse({} as any)` throws `ElapseInvalidRequestError`. |
| FR-SDK-002 | `products.create({ name, rateUsdPerSecond })` returns a Product with `id` prefixed `prod_`, `name`, `rate_usd_per_second`, `currency: "ausd"`. `rateUsdPerSecond` is a decimal **string** (e.g. `"0.004"`); a number is rejected. | Mock server records `POST /v1/products`; numeric rate throws before any request. |
| FR-SDK-003 | `products.retrieve(id)` and `products.list()` return one Product and a `{ object: "list", data: Product[] }` page respectively. | Mocked `GET /v1/products/:id`, `GET /v1/products`. |
| FR-SDK-004 | `checkout.sessions.create({ product, successUrl, cancelUrl })` returns a Checkout session with `id` prefixed `cs_`, `url` (hosted checkout), `status: "open" \| "complete" \| "expired"`, `success_url`, `cancel_url`, `product`. | Mocked `POST /v1/checkout/sessions`; `session.url` matches `/\/c\/cs_/`. |
| FR-SDK-005 | `subscriptions.retrieve(id)` returns a Subscription with `id` `sub_`, `status` in `incomplete \| active \| paused \| canceled`, `product`, `customer`, `started_at`, `canceled_at`, `rate_usd_per_second`; `subscriptions.cancel(id)` returns it with `status: "canceled"`, `seconds_elapsed`, `amount_settled`. | Mocked `GET`/`POST …/cancel`; status union is a TS type, not `string`. |
| FR-SDK-008 | `subscriptions.list({ customer?, product?, status?, limit?, startingAfter? })` returns a `{ object: "list", data: Subscription[], has_more }` page over `GET /v1/subscriptions` (API FR-API-041), newest first, following the cursor convention of FR-SDK-003. Filters are passed as the query string; an unknown `status` throws `ElapseInvalidRequestError` before any request. Added 2026-09-04 (William) so a merchant can render a customer's running meters inside their own product without keeping their own index of `sub_` ids — the gap recorded in the [ADR 2026-09-04 account page](../decisions/2026-09-04-account-page-cross-merchant.md). | Mocked `GET /v1/subscriptions?customer=cus_…&status=active`; filters appear in the query string; bad status throws locally; cursor test across two pages. |
| FR-SDK-006 | `customers.retrieve(id)` returns a Customer (`cus_`, `email`). `invoices.list({ subscription? })` returns Invoices (`period`, `seconds`, `amount_settled`, `currency`). | Mocked endpoints; list filters are passed as query string. |
| FR-SDK-007 | No other resource or method is exported. The public surface is exactly: `Elapse`, the six resource namespaces above, `webhooks.constructEvent`, the error classes, and the types. Ten methods: `products.create/retrieve/list`, `checkout.sessions.create`, `subscriptions.retrieve/list/cancel`, `customers.retrieve`, `invoices.list`, `webhooks.constructEvent`. Pause and resume are deliberately absent (dashboard decision 7; API FR-API-043). | Test snapshots `Object.keys` of the built module and of an `Elapse` instance against a frozen list. |

### Transport (§4.2 "REST under the hood", §9)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-SDK-010 | Every method is one HTTPS request to `{baseUrl}/v1/...` using `fetch` (Node 20 global), header `Authorization: Bearer {secretKey}`, `Content-Type: application/json`, `User-Agent: elapse-node/{version}`. No ORM, no persistent state. | Mock server asserts headers on every call. |
| FR-SDK-011 | Non-2xx responses throw one of: `ElapseAuthenticationError` (401/403), `ElapseInvalidRequestError` (400/404/422), `ElapseRateLimitError` (429), `ElapseAPIError` (5xx and unparseable bodies). All extend `ElapseError` with `status`, `code`, `message`, `requestId`. | One unit test per status code asserts class and fields. |
| FR-SDK-012 | Requests that fail with a network error, 429, or 5xx are retried with exponential backoff and jitter, up to `maxRetries` (default 2). 4xx other than 429 are never retried. | Mock returns 500,500,200 → resolves; 400 → one request only. |
| FR-SDK-013 | Every `create`/`cancel` call sends an `Idempotency-Key` header: caller-supplied via `{ idempotencyKey }` in the second argument, else a generated UUID reused across that call's retries. | Mock asserts the same key on all retry attempts. |
| FR-SDK-014 | Per-request options `{ idempotencyKey?, timeoutMs? }` are accepted as the last argument of every method; default timeout 30 s; timeout throws `ElapseAPIError` with `code: "timeout"`. | Mock delays past timeout → rejects with the right class. |

### Webhook signatures (§4.4, §5.3, §12 Week 2)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-SDK-020 | `webhooks.constructEvent(rawBody, header, secret)` parses `X-Elapse-Signature` of the form `t=<unix>,v1=<hex>[,v1=<hex>]` collecting **every** `v1` value (never `Object.fromEntries`), computes `HMAC-SHA256(s, "{t}.{raw_body}")` for each secret `s` in `secret` (`string \| string[]`), and accepts if **any** (secret, `v1`) pair matches under constant-time equality; every pair is compared (no early exit) so timing does not reveal which matched. Returns the parsed Event typed as `ElapseEvent`. `rawBody` is the unparsed `string \| Buffer`. Needed by the worker's secret-rotation overlap (worker FRD FR-WRK-040/041). | Golden test: known secret + body + t → passes; header with two `v1`s verifies against either secret; `secret: [old, new]` verifies a single-`v1` header signed with either. |
| FR-SDK-021 | Throws `ElapseSignatureVerificationError` (extends `ElapseError`) when: header missing; header malformed (no `t`, no `v1`, non-numeric `t`, non-hex `v1`, more than 4 `v1` values); `\|now − t\| > 300 s`; no (secret, `v1`) pair matches (tampered body, wrong secret, wrong `t`); `secret` is an empty array. The message names the reason; the body is never returned. | One failing test per case: missing, malformed ×5, expired (+301 s and −301 s), tampered body, wrong secret, two `v1`s neither matching, empty secret array. |
| FR-SDK-022 | A fourth optional argument `{ tolerance?: number, now?: () => number }` overrides the 300 s window and the clock for tests only; default behaviour unchanged. | Expired case passes with `tolerance: Infinity`. |
| FR-SDK-023 | `ElapseEvent` is a discriminated union over the six MVP types (`checkout.session.completed`, `subscription.created`, `subscription.updated`, `subscription.canceled`, `invoice.settled`, `invoice.payment_failed`) with `id` `evt_`, `object: "event"`, `created`, `data.object`; `subscription.canceled` narrows to `{ id: sub_, status: "canceled", seconds_elapsed, amount_settled, currency: "ausd", product, customer }` per §5.3. | Type test (`tsd`/`expect-type`): switching on `event.type` narrows `data.object`. |
| FR-SDK-024 | `constructEvent` is also exported as a standalone function (as today) so it works without a client instance. | Import test. |

### Packaging, tests, publishing (§9, §12 Weeks 2 and 6, §14)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-SDK-030 | Builds to `dist/` as ESM (`index.js`) and CJS (`index.cjs`) with a single `index.d.ts`; `package.json` `exports` maps `import`/`require`/`types`; `files` limits the tarball to `dist` and `README.md`; `engines.node >= 20`. | `npm pack --dry-run` lists only those files; `node -e "require('@elapse/sdk')"` and ESM import both resolve. |
| FR-SDK-031 | Zero runtime dependencies; uses `node:crypto` and global `fetch` only. | `package.json` has no `dependencies`. |
| FR-SDK-032 | Unit tests (Vitest) cover FR-SDK-001–024 with a local mock HTTP server; `pnpm test` runs in CI on Node 20 and 22. | CI workflow green; coverage of `webhooks.ts` 100 % lines. |
| FR-SDK-033 | Published to npm as `@elapse/sdk` (fallback: GitHub Packages, documented in README) with `0.x` semver; the README code sample is the §4.2 snippet verbatim. | `npm view @elapse/sdk version` succeeds before 13 Oct; README snippet compiles under `tsc --noEmit`. |
| FR-SDK-034 | The package README states "secret key server-side only" and links the docs Webhooks page. | Text present. |

### Python `elapse` (§4.1, §4.3, §12 Week 5 — stretch)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-SDK-040 | `sdk/python/` publishes `elapse` for Python 3.11+ with `Elapse(secret_key=..., base_url=None)`, `webhooks.construct_event(payload, sig, secret)` implementing FR-SDK-020/021 identically, and at minimum `products.create`, `checkout.sessions.create`, `subscriptions.retrieve/cancel`. | Same signature test vectors as TS pass in `pytest`. |
| FR-SDK-041 | If Python slips, the package is not published and the docs SDKs page shows TS + cURL only (see docs FRD). | Decision recorded in Week 5 by the human. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-SDK-001 | The frozen surface (FR-SDK-007) may only change by editing this spec and §4.2; PRs adding methods without a signed spec change are rejected. |
| BR-SDK-002 | The secret key is never sent anywhere but `baseUrl`, never logged, and never appears in error messages or `toString()`. The SDK refuses to run in a browser (`typeof window !== "undefined"` throws at construction). |
| BR-SDK-003 | Signature verification always uses the raw bytes; the SDK never re-serialises JSON before hashing. Docs and examples must read the raw body (no parsed-JSON middleware ahead of it). |
| BR-SDK-004 | Comparison of digests is constant-time (`timingSafeEqual`); length mismatch is handled without short-circuiting on secret material. |
| BR-SDK-005 | Money fields (`rate_usd_per_second`, `amount_settled`) are decimal strings end to end; the SDK never parses them to `number`. |
| BR-SDK-006 | Id prefixes are validated on the client for `retrieve`/`cancel` arguments (`prod_`, `cus_`, `sub_`, `cs_`, `wh_`, `evt_`); a wrong prefix throws `ElapseInvalidRequestError` before any request. |
| BR-SDK-007 | The SDK never emits or expects per-second webhooks; a live meter is computed by the merchant from `rate_usd_per_second` and `started_at` (§5.1). |

## Interfaces

Method → REST (path prefix `/v1`; only `GET /v1/subscriptions/:id` appears in the doc, the rest mirror Stripe and must be confirmed by the API FRD):

```
products.create            POST /v1/products                     { name, rate_usd_per_second }
products.retrieve(id)      GET  /v1/products/:id
products.list()            GET  /v1/products
checkout.sessions.create   POST /v1/checkout/sessions            { product, success_url, cancel_url }
subscriptions.retrieve(id) GET  /v1/subscriptions/:id
subscriptions.list(params)  GET  /v1/subscriptions?customer=cus_…&product=prod_…&status=active
subscriptions.cancel(id)   POST /v1/subscriptions/:id/cancel
customers.retrieve(id)     GET  /v1/customers/:id
invoices.list(params)      GET  /v1/invoices?subscription=sub_…
webhooks.constructEvent    (local) X-Elapse-Signature: t=unix,v1=hex(hmac_sha256(secret, `${t}.${rawBody}`))
```

Errors: `ElapseError > { ElapseAuthenticationError, ElapseInvalidRequestError, ElapseRateLimitError, ElapseAPIError, ElapseSignatureVerificationError }`.

## Undecided (human)

1. **Request/response casing.** Frozen requests are camelCase (`rateUsdPerSecond`); wire objects are snake_case (`seconds_elapsed`). Options: (a) SDK translates both ways to camelCase; (b) requests camelCase, responses returned as raw API objects (snake_case); (c) snake_case everywhere. **Recommend (b):** the §4.2 request shape stays frozen, the cURL tab and webhook payload match responses byte-for-byte.
2. ~~**Multiple `v1=` values during secret rotation.**~~ **Decided 2026-09-04 (William): (a) + (c)** — accept any matching `v1` and allow `secret: string \| string[]` (FR-SDK-020/021). Required by the dashboard's roll-with-grace (dashboard decision 9, FR-DSH-080s) and the worker's dual-signed header (FR-WRK-040).
3. **Retry policy numbers.** Options: 2 retries / 3 retries / configurable only. **Recommend** default `maxRetries: 2`, backoff 500 ms × 2^n ± 25 % jitter, honour `Retry-After` on 429.
4. **Idempotency header name and server support.** `Idempotency-Key` (Stripe) vs `X-Idempotency-Key`. **Recommend `Idempotency-Key`**; API FRD must implement 24 h key storage or the SDK feature is cosmetic.
5. **`ElapseEvent` for unknown types.** Fail closed (throw) or return `type: string`. **Recommend** return with `type: string` fallback so new events never break verification.

## Open

- API FRD must confirm the `/v1` paths, auth header, and error body shape (`{ error: { type, code, message, request_id } }` assumed).
- npm org `@elapse` availability; GitHub Packages fallback config.
- Whether `sdk/ts` moves to the pnpm workspace root `package.json` (§13 monorepo).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-04 | Claude (for William) | Undecided 2 closed from dashboard decision 9: FR-SDK-020/021 accept multiple `v1` values and an array of secrets, constant-time over every pair. |
| 2026-09-04 | Claude (for William) | FR-SDK-008 `subscriptions.list` added to the frozen surface, approved by William; FR-SDK-007 restated as ten methods and records that pause/resume stay out. Follows [ADR 2026-09-04 account page](../decisions/2026-09-04-account-page-cross-merchant.md). |
