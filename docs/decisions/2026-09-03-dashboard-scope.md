# Dashboard scope for 13 October

2026-09-03 · Decided by William · Status: accepted

## Context

The merchant dashboard is the second thing a judge sees after the checkout and the surface a merchant engineer lives in. The design brief lists nine sections; the six-week plan gives the dashboard Week 4. Two grill-me rounds on 2026-09-03 (seventeen questions, recorded in `docs/specs/dashboard-frd.md`) fixed what ships, what is spec-only, and what is cut, so the frontend could be built against a mock API before the backend exists.

## Decision

For the 13 October submission the dashboard is:

- **Sign-in** by email magic link only; no merchant passkeys. Session is an HttpOnly cookie against a `/v1/dashboard/*` route group on the same Hono API; the merchant's secret key never reaches the browser.
- **Test / live** toggle in the header, test mode by default, every list and count scoped by mode.
- **Pages:** Home (a four-step checklist until the first successful delivery, then overview), Products, Subscriptions, Customers, Invoices, Developers (API keys, webhooks with deliveries, events), Settings (payout address, checkout branding, Activity log), Balance & payouts (immutable ledger from contract events), and an in-app notifications bell. Team invites are cut.
- **Live data** is real state from the API polled every 10 seconds, with accrual ticking in the browser between polls. No server push.
- **Merchant actions on a meter:** cancel only, with confirmation, refunding the subscriber exactly as a self-cancel would. No merchant pause, no merchant refunds, no spend caps, no free seconds; escrow is the cap.
- **Key and secret rolling** with a merchant-chosen grace period of now, one hour, or 24 hours.
- **Notifications:** email for webhook endpoint exhaustion and key expiry, on by default; the bell lists every kind including payment failures.
- **Off-ramp** is spec only: the balance page shows AUSD at the payout address and a "Withdraw to bank" button that opens a documented partner path.
- **Mobile:** every page reads at 375 px as card stacks; forms are desktop-first and open full-screen on mobile.
- **Subscriber `/account`** is specced under the checkout FRD, built after the dashboard, and is the first cut if the deadline bites.

Build order, cut from the end: shell and auth, Developers, Products, Home, Subscriptions, Invoices, Balance & payouts, Settings with Activity, Notifications, Customers, then `/account`.

## Consequences

- The dashboard was built in full on 2026-09-04 against the mock; only `/account` remains from the list.
- Rules out for the submission: team members and roles, merchant-initiated refunds, pause from the dashboard, product-level caps and trials, any integrated off-ramp, and server push.
- Creates work in other specs: the `/v1/dashboard/*` route group and magic-link endpoints in `api-frd.md`, per-roll overlap windows in `worker-frd.md`, ledger ingestion in `indexer-frd.md`, multi-signature verification in `sdk-frd.md`, and the account page in `checkout-frd.md`.
- Watch: the polling model means a cancel confirmed on chain can take up to 10 seconds to reach a second open tab; acceptable for the demo, revisit if merchants ask for push.
- The payout model this scope assumes is recorded separately in [2026-09-03 settlement fee](./2026-09-03-settlement-fee.md).
