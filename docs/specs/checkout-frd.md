# Hosted checkout (`/c/[session]`) — FRD

Status: **Signed 2026-09-03 (William)** — approved after review; built against the mock API. Decisions taken: Pause behind `allow_pause` default off; dollar presets with runtime shown; low-balance at 5 min; email receipt mocked; judge mode via `?judge=1` and triple-tap. May be revisited. **Surface 4 (`/account`, FR-CHK-016–026) added 2026-09-04 — awaiting signature for that section only.** · Surface: Operate (subscriber, mobile-first) · Sources: design brief Surface 2; detailed doc §3, §7, §10.

## Problem

A subscriber is sent a link by a merchant. On a phone, with no account and no crypto knowledge, they must understand the price, start, watch a meter, cancel when they want, and see exactly what they paid. The judges watch this on a phone in the demo video.

## User stories

1. As a subscriber, I want to see who is charging me and at what rate per second (and per hour), so that the price reads like a price.
2. As a subscriber, I want to sign in with Face ID, so that I never see a wallet.
3. As a subscriber, I want to add funds with a preset, so that I know my maximum exposure before starting.
4. As a subscriber, I want a live counter and one Cancel button, so that stopping is instant and obvious.
5. As a subscriber, I want a receipt that says what I paid and what was returned, so that I trust the meter.
6. As a merchant, I want the subscriber redirected to my success URL with the session id, so that I can provision access.
7. As a judge, I want a hidden technical panel, so that I can verify the chain without it polluting the consumer UI.

## Functional requirements

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CHK-001 | The page loads a checkout session by id and shows merchant name/logo, product name, rate per second, and derived per-minute and per-hour figures. | Renders from mocked `GET /v1/checkout/sessions/:id`. |
| FR-CHK-002 | Sign in with Face ID / passkey (Privy) with an email fallback. Until Week 3 the wallet layer is a mock behind the same interface. | `AuthProvider` interface; mock resolves after a confirm sheet. |
| FR-CHK-003 | Fund step with presets ($5, $10, $25) and a custom amount; shows "Unused funds are returned when you cancel." and the runtime that amount buys at the rate. | Selecting $10 at $0.004/s shows "≈ 41 min". |
| FR-CHK-004 | Start opens a subscription (`incomplete → active`), records `started_at`, and switches to the meter view on the same URL. | State machine test. |
| FR-CHK-005 | Meter view: full-screen `Readout` (hero), rate reminder, "Started h:mm", one Cancel button; optional Pause if the product allows it. | Component test; tick at 100 ms. |
| FR-CHK-006 | Low-balance state: when remaining runtime < 5 min, an amber notice "About N minutes of funds left" with Add funds. | Threshold test at rate × balance. |
| FR-CHK-007 | Out-of-funds: meter pauses, filled amber notice "Add funds to resume"; status `paused` with reason `out_of_funds`. | State test. |
| FR-CHK-008 | Cancel ends the meter, shows the receipt: "You paid N seconds · $X" hero line; breakdown of started, canceled, rate, total, refunded; "Back to {merchant}" and "Email receipt". | Settled = whole seconds × rate; refund = funded − settled. |
| FR-CHK-009 | "Back to {merchant}" navigates to `success_url?session_id=cs_…`. Abandoning before Start goes to `cancel_url`. | URL assertions. |
| FR-CHK-010 | Session states: loading skeleton, expired, already used, product archived, network error — each with copy naming the problem and the recovery. | One test per state. |
| FR-CHK-011 | Judge mode: hidden toggle (`?judge=1` or triple-tap on the footer) slides up a panel with chain id, contract address, block ticker (~300 ms), indexer status, and the live webhook delivery log for this session. | Panel renders from mocked data; hidden by default. |
| FR-CHK-012 | Mobile 390 first; one-handed; touch targets ≥ 44 px; Cancel reachable with the thumb. | Screenshot review at 390 and 1440. |
| FR-CHK-013 | Light and dark; reduced motion honoured; counter keeps ticking. | As landing. |
| FR-CHK-014 | Merchant branding renders from the session: business name, logo, accent colour (falls back to the default amber), support/terms link. Layout and copy are never merchant-controlled. | Session with branding shows logo + name + accent; session without shows defaults. |
| FR-CHK-015 | Until the API exists, the page runs against an in-memory mock that seeds sessions for every state (open, running, low balance, out of funds, canceled, expired, already used, archived) so each screen is reachable by URL. | `/c/cs_demo`, `/c/cs_expired`, `/c/cs_used`, `/c/cs_archived`, `/c/cs_lowbal`, `/c/cs_empty` render their states. |


## Surface 4 — Subscriber account (`/account`)

Decided 2026-09-04 (grill round, William): specced here per dashboard decision 16; built after the dashboard, first cut if the deadline bites. Same rules as the checkout: no chain words, no red, mobile first. Funds (FR-CHK-021) follow the [funding ADR](../decisions/2026-09-04-subscriber-funding-card-and-ausd-float.md), which is proposed and awaiting Furqaan; that requirement is marked **proposed** and its mock shapes may change.

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CHK-016 | Sign-in is the same passkey / Face ID identity the subscriber created at their first checkout (Privy), with the same email fallback as FR-CHK-002 and no separate credential. Signed-out `/account` shows one sentence and a Sign in button; after sign-in the page loads in place. | `AuthProvider` reused; signed-out state test; mock resolves after the confirm sheet. |
| FR-CHK-017 | Entry points: a "Manage your meters" link in the checkout footer once signed in, on the receipt (FR-CHK-008), and in the email receipt. No other navigation to `/account` exists. | Link present in meter and receipt states, absent before sign-in; email template carries the URL. |
| FR-CHK-018 | Running meters: a list across merchants of every `active` or `paused` subscription for this identity (API FR-API-121): merchant logo and name, product, an inline `Readout` ticking at 100 ms from `rate × (now − started_at)`, remaining runtime ("≈ 41 min left"), Add funds, and Cancel. Sorted by started time, newest first. Low-balance and out-of-funds states reuse FR-CHK-006/007 copy per row. | Two merchants in the mock render two rows; ticker math shares `lib/meter/math`. |
| FR-CHK-019 | Cancel from the list opens a confirm sheet: "Stop the meter at {merchant}?" with "You'll pay N seconds so far · $X" live, a neutral Cancel meter button and a Keep running button. Confirming calls the same cancel path as the checkout; the row becomes its receipt line in place. Checkout's own Cancel stays one tap (FR-CHK-008). | Sheet names the merchant; confirm produces the receipt; dismiss leaves the meter running. |
| FR-CHK-020 | Receipts: every settled or canceled subscription, newest first, one line each: merchant, "You paid N seconds · $X", date. Tapping opens the FR-CHK-008 receipt with "Email receipt". Per-second detail only; never a fee line (subscribers pay gross). | List from mock invoices; detail matches the checkout receipt component. |
| FR-CHK-021 | **Proposed (funding ADR).** Balance block at the top: "Your balance $9.67", Add funds (card / Apple Pay / Google Pay via Stripe in dollars), Return to card (Stripe refund on request, "usually 5–10 days"). Add funds on a meter row moves money from the balance into that meter's escrow; if the balance is short it offers the card first. Unused escrow on cancel lands in the balance: "$9.67 returned to your balance". | Mock balance math: cancel refund increments the balance; Return to card decrements it; no chain words in any copy. |
| FR-CHK-022 | Identity: meters are grouped by the passkey wallet address (API FR-API-121). The address itself is never displayed. No new object or id prefix. | Render test asserts no `0x` string. |
| FR-CHK-023 | Empty state: "No meters yet. When a merchant sends you a link, your meters show up here." with nothing else. | Empty mock renders the sentence only. |
| FR-CHK-024 | Mobile 390 first, one hand, ≥ 44 px targets; the list is a card stack, never a table. Light and dark; reduced motion honoured; tickers keep ticking. | Screenshot review at 390 and 1440. |
| FR-CHK-025 | Runs against the same in-memory mock as the checkout (FR-CHK-015) with seeded identities: `/account?as=two-merchants`, `?as=empty`, `?as=low-balance`, `?as=signed-out`. | Each seed reachable by URL. |
| FR-CHK-026 | No judge mode on `/account` for 13 Oct; the panel lives on the checkout only (FR-CHK-011). | No `?judge=1` handling on the route. |

Business rule: BR-CHK-007 — `/account` inherits BR-CHK-001 to BR-CHK-006 unchanged.

Account data (mocked until the API exists):

```
AccountMeter    { subscription: sub_…, merchant: { name, logo_url, support_url }, product: { name, rate_usd_per_second },
                  status, started_at, paused_at, funded_usd, settled_usd }
AccountReceipt  { invoice: in_…, merchant: { name }, seconds, amount_settled, settled_at, subscription: sub_… }
AccountBalance  { balance_usd }                                 // proposed, FR-CHK-021
```

Grill-me questions (settled 2026-09-04): sign-in same passkey as checkout · entry via checkout links and the email receipt · contents are meters, receipts, and funds · funds shape is one Elapse balance plus per-meter escrow (proposed) · cancel through a confirm sheet naming the merchant · identity is the passkey wallet address, no new object.

## Business rules

| Id | Rule |
| --- | --- |
| BR-CHK-001 | No chain vocabulary anywhere on the subscriber surface except inside the judge panel: no wallet, gas, seed, 0x, Monad, connect, transaction. |
| BR-CHK-002 | The subscriber can never be charged more than funded; the meter pauses at zero. |
| BR-CHK-003 | Settled amount is whole seconds × rate (matches the contract); the live counter may show fractional accrual but the receipt never exceeds settled. |
| BR-CHK-004 | No red on the subscriber surface (human's call, 2026-09-03). One accent: amber for the live meter, low-balance and out-of-funds notices (the latter with stronger copy and a filled notice, not a new colour). Cancel is a neutral outline button. |
| BR-CHK-005 | The merchant's secret key never reaches this page; it is driven by a session id and a publishable key only. |
| BR-CHK-006 | "Powered by Elapse" and a lock icon appear in the footer of every state. |

## Data (mocked until the API exists)

```
CheckoutSession { id: cs_…, merchant: { name, logo_url, success_url, cancel_url },
                  product: { id: prod_…, name, rate_usd_per_second, allow_pause },
                  status: "open" | "complete" | "expired", subscription?: sub_… }
Subscription    { id: sub_…, status, started_at, paused_at, canceled_at, funded_usd, rate_usd_per_second }
```

## Grill-me questions (settled 2026-09-03 with the recommendations)

1. Pause: in MVP or not? Doc lists `subscription.updated` for pause/resume but the checkout flow in §7 has no Pause. **Recommend: hide Pause behind `product.allow_pause`, default off.**
2. Fund presets: fixed dollars, or runtime-based ("1 hour", "4 hours")? **Recommend: dollars with the runtime shown beside each.**
3. Low-balance threshold: minutes or percent? **Recommend: 5 minutes of runtime.**
4. Email receipt: real send (needs backend) or copy-to-clipboard for MVP? **Recommend: button present, posts to a mocked endpoint, toast "Sent".**
5. Judge-mode trigger: `?judge=1` only, or also a gesture? **Recommend: both; the gesture is for the live demo on a phone.**

## Open

- Privy app id and bounty requirements (Week 3).
- `/account` is built after the dashboard and is the first cut if the deadline bites (dashboard decision 16). FR-CHK-021 waits on the funding ADR.

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-03 | William | Reviewed and signed; five open questions settled with the agent's recommendations; FR-CHK-014/015 added. |
| 2026-09-04 | Claude (for William) | Surface 4 subscriber account from the 2026-09-04 grill round: FR-CHK-016–026, BR-CHK-007, account data shapes. FR-CHK-021 marked proposed pending the funding ADR. Awaiting signature. |
