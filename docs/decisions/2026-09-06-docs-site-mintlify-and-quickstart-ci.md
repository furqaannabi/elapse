# Docs site on Mintlify, reference from a committed filtered OpenAPI file, Quickstart CI against a local API
2026-09-06 · Decided by William · Status: accepted

## Context
Week 4 item "OpenAPI into the docs site" found no docs site at all: `docs/` holds markdown, the
OpenAPI document exists only at runtime on the API with 52 operations (dashboard, subscriber,
CLI, key and endpoint management included), `examples/saas` is a README stub, and the repo has
no CI. The docs FRD left five items undecided. Two facts shaped the answers: the published
`@elapse/sdk@0.1.0` defaults to `https://api.elapse.dev`, which does not resolve, because
William owns only `elapse-monad.vercel.app` today; and Quickstart steps 2–6 (install, create a
Product, create a Checkout session, receive one Delivery, verify it) never touch the chain, so
they can run without testnet funds or a shared key. Weighed: Mintlify against Fumadocs/Nextra
in-repo against a bare Scalar reference; a filtered committed file against the full spec against
fetching at build time; CI against the hosted testnet API against a local API against deferral;
one PR against example-first; keeping the detailed doc's "Test clocks" nav entry; and whether
the reference's try-it panel is on.

## Decision
The docs site is a **Mintlify** project in `docs/site/`, hosted by Mintlify from the repo and
served on their subdomain until a domain exists. The API reference renders from a **committed
`api/openapi.json` filtered to the nine public SDK operations** by a `public` marker on route
definitions, with tests that the file is fresh and that its operation set equals the SDK's
exports. The **Quickstart runs in GitHub Actions against a local API and Postgres** (seeded key,
HTTP endpoint at the example server, the endpoint's test call, worker delivers), on PRs touching
`sdk/`, `examples/`, `docs/`, `api/` and nightly; step 7 (the phone) is not in CI. Build order is
**`examples/saas` first, docs second**, so no docs snippet is hand-typed; Mintlify cannot include
source files, so a sync script writes committed snippet MDX with a freshness check. The nav entry
**"Test clocks" becomes "Testing"** (test mode, demo-rate recipe, CLI forwarding, test delivery).
Every snippet **passes `baseUrl` explicitly**; `api.elapse.dev` and `docs.elapse.dev` are never
written as live URLs until registered. The reference's **try-it panel is on** with bearer test
keys; the API adds CORS for the docs origin and refuses live keys from a browser origin.

## Consequences
- A Stripe-shaped three-column reference in about a day; the hosting connect is William's step,
  as with Envio. Content is MDX plus `docs.json`, so leaving Mintlify is a nav rewrite, not a
  content rewrite. Confirm the custom-domain tier before relying on it.
- One file, `api/openapi.json`, feeds the reference, the surface check, and the try-it panel;
  a public route change that is not regenerated fails `bun test`, not a demo.
- No testnet funds, relayer balance, or long-lived key in CI; the trade is that CI proves the
  snippets run, not that the hosted API is up, which is monitoring's job.
- The examples FRD must be grilled and signed before PR 1; it gains `ELAPSE_API_URL`.
- The nine-entry nav deviates from the detailed doc by one name; the page's purpose is kept.
- Watch: the hosted API URL is unknown on this date and blocks going live; when `elapse.dev`
  lands, a new SDK release restores the default and the explicit `baseUrl` leaves the snippets.
- Supplements [ADR 2026-09-06 CLI](./2026-09-06-cli-transport-and-session.md), which took
  test clocks out and foresaw the "Testing" rename.
