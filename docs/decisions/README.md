# Decisions

Architecture and product decision records (ADRs). One file per decision, named `YYYY-MM-DD-short-title.md`, **never edited after the fact**: if a decision changes, write a new record that supersedes the old one and link both ways.

Specs in `docs/specs/` describe what we are building and change over time. Records here describe *why* something was chosen on a given day and who chose it, so a newcomer can tell a deliberate choice from an accident.

## Format

```
# Title
Date · Decided by · Status (accepted | superseded by <file>)

## Context
What was true, what was being weighed.

## Decision
One paragraph.

## Consequences
What this makes easier, what it rules out, what to watch.
```

## Index

| Date | Decision | By |
| --- | --- | --- |
| 2026-09-03 | [Bun + Hono for the platform API and worker; Foundry for contracts](./2026-09-03-bun-hono-backend.md) | Furqaan |
| 2026-09-03 | [Neutral dark default theme, amber as the only accent, no red](./2026-09-03-neutral-dark-palette.md) | William |
| 2026-09-03 | [Percentage platform fee taken inside settle, default 1 percent, owner-adjustable](./2026-09-03-settlement-fee.md) (contract change awaiting Furqaan) | William |
| 2026-09-03 | [Dashboard scope for 13 October](./2026-09-03-dashboard-scope.md) | William |
| 2026-09-04 | [Subscribers hold AUSD; subscriber authorizes by permit, Elapse relayer signs the session](./2026-09-04-subscriber-permit-relayer-signs.md) | Furqaan |
| 2026-09-04 | [The subscriber account page stays Elapse-branded across merchants](./2026-09-04-account-page-cross-merchant.md) | William |
| 2026-09-05 | [The webhook worker lives inside `api/`; endpoints auto-disable after 3 days of continuous failure](./2026-09-05-worker-in-api-and-auto-disable.md) | William |
| 2026-09-05 | [Indexer: Envio Hosted Service plus local `envio dev`; no rollback on reorg; one ingest POST per log](./2026-09-05-indexer-hosting-reorg-transport.md) | William |
| 2026-09-05 | [The factory's keeper may cancel a stream, so `subscriptions.cancel` works from a merchant's server](./2026-09-05-keeper-may-cancel.md) | William |
| 2026-09-06 | [CLI `listen --forward` receives Deliveries over SSE from one persistent CLI endpoint per mode](./2026-09-06-cli-transport-and-session.md) | William |
| 2026-09-06 | [Docs site on Mintlify; reference from a committed filtered OpenAPI file; Quickstart CI against a local API](./2026-09-06-docs-site-mintlify-and-quickstart-ci.md) | William |
| 2026-09-06 | ["Send test delivery" works on the CLI endpoint while `elapse listen` is connected](./2026-09-06-test-delivery-on-cli-endpoint.md) | William |
| 2026-09-06 | [The example merchant has its own brand, not Elapse's design system](./2026-09-06-example-merchant-own-brand.md) | William |
| 2026-09-07 | [Checkout `prepare` and `cancel/prepare` require a Privy identity token](./2026-09-07-privy-identity-token-on-prepare.md) | William |
| 2026-09-09 | [The Subscription carries `manage_url`; merchants link subscribers to the hosted meter page](./2026-09-09-subscription-manage-url.md) | William |
| 2026-09-09 | [Dashboard search shows results as you type, backed by one merchant-scoped search route](./2026-09-09-dashboard-search-as-you-type.md) | William |
| 2026-09-07 | [Payout address: optional at setup, required to create Checkout sessions and to go live](./2026-09-07-payout-address-gates-checkout-and-live-keys.md) | William |
| 2026-09-07 | [The keeper gasses `settleBatch` from per-stream estimates, never from the batch estimate](./2026-09-07-keeper-gas-per-stream-estimate.md) | William |
| 2026-09-07 | [The 13 October submission runs on Monad testnet; live mode points at testnet too; the relayer gets its own wallet now](./2026-09-07-submission-on-testnet-live-mode-mockusd.md) | William |
| 2026-09-07 | [The submission ships `@elapse/sdk` (TypeScript) only; the Python package waits](./2026-09-07-sdk-typescript-only-for-submission.md) | William |
| 2026-09-07 | [Forms hardening: rate read-only on edit, PNG-only logo in Postgres, type-to-confirm on live key revoke](./2026-09-07-forms-hardening-logo-png-revoke-confirm.md) | William |
| 2026-09-07 | [`/account` reads real data: both modes with a Test tag, receipts from canceled subscriptions, email receipt built, seeded mock gone from the route](./2026-09-07-account-page-on-real-data.md) | William |
| 2026-09-07 | [Start again is offered on every receipt and opens a copy of the ended session on the merchant's behalf](./2026-09-07-start-again-after-any-end.md) | William |
| 2026-09-07 | [Subscriber pause ships as a signed relay in the shape of cancel; "Stop" replaces "Cancel" on the subscriber side](./2026-09-07-subscriber-pause-signed-relay.md) | William |
| 2026-09-07 | [The support URL is one field, in the business profile; checkout branding no longer repeats it](./2026-09-07-support-url-one-field-in-profile.md) | William |
| 2026-09-07 | [Add money on the checkout when the wallet is short; live mode escrows AUSD on testnet](./2026-09-07-add-money-and-ausd-live-on-testnet.md) | William |
| 2026-09-08 | [Keeper cadence moves from 5 minutes to 1 hour; amount-based settlement is the mainnet question](./2026-09-08-keeper-cadence-one-hour.md) | William |
| 2026-09-08 | [Platform fee is 2 percent of each settlement](./2026-09-08-platform-fee-two-percent.md) | William, Furqaan |
| 2026-09-08 | [The landing speaks to founders and finance owners as well as engineers](./2026-09-08-landing-for-founders-and-finance.md) | William |
| 2026-09-11 | [Testnet AUSD comes from Agora's undocumented Monad faucet; team and demo wallets only](./2026-09-11-testnet-ausd-from-agora-faucet.md) | Furqaan |
| 2026-09-12 | [`examples/lambda` requires AWS and is exempt from the clone-and-run guarantee](./2026-09-12-examples-lambda-aws-only.md) | Furqaan |
| 2026-09-13 | [AUSD is the only escrow token; MockUSD becomes a test fixture; live mode is mainnet's mode](./2026-09-13-ausd-only-mockusd-to-test-fixture.md) | William |
| 2026-09-15 | [Merchant-started metering on the hosted checkout, `/account` and `examples/lambda`](./2026-09-15-merchant-started-checkout-and-lambda.md) | Furqaan |
| 2026-09-17 | [Once the merchant starts a merchant-mode meter, only the merchant can stop it](./2026-09-17-merchant-started-meters-only-merchant-stops.md) | Furqaan |
| 2026-09-17 | [`@elapse/react` replaces the hosted checkout; signatures happen in an Elapse popup](./2026-09-17-react-sdk-replaces-hosted-checkout.md) | Furqaan |
| 2026-09-17 | [Meter math moves to a shared workspace package, `@elapse/meter-core`](./2026-09-17-meter-math-shared-package.md) (superseded) | Furqaan |
| 2026-09-17 | [Delete the hosted checkout now, and fix what depended on it in the same change](./2026-09-17-delete-hosted-checkout-now.md) | Furqaan |
| 2026-09-17 | [Meter math lives inside `@elapse/react`; `@elapse/meter-core` is removed](./2026-09-17-meter-math-inside-react-sdk.md) | Furqaan |
| 2026-09-17 | [The examples bundle their browser pages with esbuild instead of loading `@elapse/react` from a CDN](./2026-09-17-examples-bundle-react-sdk.md) | Furqaan |
| 2026-09-18 | [The CDN build of `@elapse/react` carries its own React and exposes one `mount()`](./2026-09-18-react-cdn-mount-api.md) | Furqaan |
| 2026-09-19 | [The keeper may pause and resume, so a merchant can bill only while its resource is working](./2026-09-19-keeper-may-pause.md) | Furqaan |
