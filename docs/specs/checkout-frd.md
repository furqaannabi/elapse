# Hosted checkout (`/c/[session]`) — FRD

Status: **Signed 2026-09-03 (William)** — approved after review; built against the mock API. Decisions taken: Pause behind `allow_pause` default off; dollar presets with runtime shown; low-balance at 5 min; email receipt mocked; judge mode via `?judge=1` and triple-tap. May be revisited. **Surface 4 (`/account`, FR-CHK-016–026) added and signed 2026-09-04 (William).** · Surface: Operate (subscriber, mobile-first) · Sources: design brief Surface 2; detailed doc §3, §7, §10.

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
| FR-CHK-003 | Cap step (replaces the fund step, [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md)): presets **1 hour / 4 hours / custom** in runtime, each showing the dollar maximum it means at the rate ("Up to $14.40"), plus "You only pay the seconds you use. Anything unused comes back when you cancel." Start asks for one Face ID confirmation, which signs a permit for exactly that maximum; no separate funding action, no Add funds anywhere. The wallet already holds the subscriber's dollars (BR-CHK-007); a wallet with less than the chosen cap shows "You have $X available" and offers the largest preset it covers. Copy never says permit, approve, allowance, or token. | Selecting 1 hour at $0.004/s shows "Up to $14.40"; Start triggers one mock confirm; an insufficient wallet disables the preset with the available line. |
| FR-CHK-004 | Start opens a subscription (`incomplete → active`), records `started_at`, and switches to the meter view on the same URL. | State machine test. |
| FR-CHK-005 | Meter view: full-screen `Readout` (hero), rate reminder, "Started h:mm", one Cancel button; optional Pause if the product allows it. | Component test; tick at 100 ms. |
| FR-CHK-006 | Low-balance state: when remaining runtime < 5 min, an amber notice "About N minutes left of your {cap}" naming the cap the subscriber chose (“your 1 hour”). No Add funds: the cap is fixed for the session (FR-CHK-007). | Threshold test at rate × cap. |
| FR-CHK-007 | Reaching the cap ends the session (decided 2026-09-04, William; [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md) — the cap is the pot and cannot be raised mid-session). At the capped second the meter stops and the receipt appears exactly as after a cancel (FR-CHK-008) with one extra line, "Your 1 hour is up", and a "Start again" button that opens a fresh checkout session for the same product. Status is `canceled`, never `paused`; there is no "Add funds to resume" and no out-of-funds pause state. The merchant is told through `invoice.payment_failed` and `subscription.canceled` (API FR-API-051); the subscriber sees neither word. | State test: elapsed reaches cap → receipt with the cap line and Start again; no Add funds control exists in any state. |
| FR-CHK-008 | Cancel ends the meter, shows the receipt: "You paid N seconds · $X" hero line; breakdown of started, canceled, rate, total, refunded; "Back to {merchant}" and "Email receipt". | Settled = whole seconds × rate; refund = funded − settled. |
| FR-CHK-009 | "Back to {merchant}" navigates to `success_url?session_id=cs_…`. Abandoning before Start goes to `cancel_url`. | URL assertions. |
| FR-CHK-010 | Session states: loading skeleton, expired, already used, product archived, network error — each with copy naming the problem and the recovery. | One test per state. |
| FR-CHK-011 | Judge mode: hidden toggle (`?judge=1` or triple-tap on the footer) slides up a panel with chain id, contract address, block ticker (~300 ms), indexer status, and the live webhook delivery log for this session. | Panel renders from mocked data; hidden by default. |
| FR-CHK-012 | Mobile 390 first; one-handed; touch targets ≥ 44 px; Cancel reachable with the thumb. | Screenshot review at 390 and 1440. |
| FR-CHK-013 | Light and dark; reduced motion honoured; counter keeps ticking. | As landing. |
| FR-CHK-014 | Merchant branding renders from the session: business name, logo, accent colour (falls back to the default amber), support/terms link. Layout and copy are never merchant-controlled. | Session with branding shows logo + name + accent; session without shows defaults. |
| FR-CHK-015 | Until the API exists, the page runs against an in-memory mock that seeds sessions for every state (open, running, low balance, ended at the cap, canceled, expired, already used, archived) so each screen is reachable by URL. | `/c/cs_demo`, `/c/cs_expired`, `/c/cs_used`, `/c/cs_archived`, `/c/cs_lowbal`, `/c/cs_capped` render their states. |


## Surface 4 — Subscriber account (`/account`)

Decided 2026-09-04 (grill round, William): specced here per dashboard decision 16; built after the dashboard, first cut if the deadline bites. Same rules as the checkout: no chain words, no red, mobile first. The grill's funds answer (an Elapse balance) was overtaken the same day by [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md): the subscriber's own wallet holds the money, so FR-CHK-021 is withdrawn and the page has no funds block.

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CHK-016 | Sign-in is the same passkey / Face ID identity the subscriber created at their first checkout (Privy), with the same email fallback as FR-CHK-002 and no separate credential. Signed-out `/account` shows one sentence and a Sign in button; after sign-in the page loads in place. | `AuthProvider` reused; signed-out state test; mock resolves after the confirm sheet. |
| FR-CHK-017 | Entry points: a "Manage your meters" link in the checkout footer once signed in, on the receipt (FR-CHK-008), and in the email receipt. No other navigation to `/account` exists. | Link present in meter and receipt states, absent before sign-in; email template carries the URL. |
| FR-CHK-018 | Running meters: a list across merchants of every `active` or `paused` subscription for this identity (API FR-API-121): merchant logo and name, product, an inline `Readout` ticking at 100 ms from `rate × (now − started_at)`, remaining runtime ("≈ 41 min left"), the cap line from FR-CHK-021, and Cancel. Sorted by started time, newest first. Low-balance rows reuse FR-CHK-006 copy; a meter that reached its cap has already moved to the receipts list (FR-CHK-007). | Two merchants in the mock render two rows; ticker math shares `lib/meter/math`. |
| FR-CHK-019 | Cancel from the list opens a confirm sheet: "Stop the meter at {merchant}?" with "You'll pay N seconds so far · $X" live, a neutral Cancel meter button and a Keep running button. Confirming calls the same cancel path as the checkout; the row becomes its receipt line in place. Checkout's own Cancel stays one tap (FR-CHK-008). | Sheet names the merchant; confirm produces the receipt; dismiss leaves the meter running. |
| FR-CHK-020 | Receipts: every settled or canceled subscription, newest first, one line each: merchant, "You paid N seconds · $X", date. Tapping opens the FR-CHK-008 receipt with "Email receipt". Per-second detail only; never a fee line (subscribers pay gross). | List from mock invoices; detail matches the checkout receipt component. |
| FR-CHK-021 | Withdrawn 2026-09-04 ([ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md)): no Elapse balance, no card, no Return to card. The account page shows no funds block. Each meter row shows its cap and how much of it is used ("$0.33 of $14.40"), read from the subscription; unused escrow returns to the subscriber's wallet on cancel and the receipt says "$14.07 returned". | Row renders used/cap; no balance component exists on the route. |
| FR-CHK-022 | Identity: meters are grouped by the passkey wallet address (API FR-API-121). The address itself is never displayed. No new object or id prefix. | Render test asserts no `0x` string. |
| FR-CHK-023 | Empty state: "No meters yet. When a merchant sends you a link, your meters show up here." with nothing else. | Empty mock renders the sentence only. |
| FR-CHK-024 | Mobile 390 first, one hand, ≥ 44 px targets; the list is a card stack, never a table. Light and dark; reduced motion honoured; tickers keep ticking. | Screenshot review at 390 and 1440. |
| FR-CHK-025 | Runs against the same in-memory mock as the checkout (FR-CHK-015) with seeded identities: `/account?as=two-merchants`, `?as=empty`, `?as=low-balance`, `?as=signed-out`. | Each seed reachable by URL. |
| FR-CHK-026 | No judge mode on `/account` for 13 Oct; the panel lives on the checkout only (FR-CHK-011). | No `?judge=1` handling on the route. |

Business rule: BR-CHK-008 — `/account` inherits BR-CHK-001 to BR-CHK-007 unchanged.

Account data (mocked until the API exists):

```
AccountMeter    { subscription: sub_…, merchant: { name, logo_url, support_url }, product: { name, rate_usd_per_second },
                  status, started_at, paused_at, funded_usd, settled_usd }
AccountReceipt  { invoice: in_…, merchant: { name }, seconds, amount_settled, settled_at, subscription: sub_… }
```

Grill-me questions (settled 2026-09-04): sign-in same passkey as checkout · entry via checkout links and the email receipt · contents are meters, receipts, and funds · funds shape was "one Elapse balance plus per-meter escrow", withdrawn the same day by [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md) · cancel through a confirm sheet naming the merchant · identity is the passkey wallet address, no new object.

## Business rules

| Id | Rule |
| --- | --- |
| BR-CHK-001 | No chain vocabulary anywhere on the subscriber surface except inside the judge panel: no wallet, gas, seed, 0x, Monad, connect, transaction. |
| BR-CHK-002 | The subscriber can never be charged more than funded; the meter pauses at zero. |
| BR-CHK-003 | Settled amount is whole seconds × rate (matches the contract); the live counter may show fractional accrual but the receipt never exceeds settled. |
| BR-CHK-004 | No red on the subscriber surface (human's call, 2026-09-03). One accent: amber for the live meter, low-balance and out-of-funds notices (the latter with stronger copy and a filled notice, not a new colour). Cancel is a neutral outline button. |
| BR-CHK-005 | The merchant's secret key never reaches this page; it is driven by a session id and a publishable key only. |
| BR-CHK-006 | "Powered by Elapse" and a lock icon appear in the footer of every state. |
| BR-CHK-007 | The subscriber's money lives in their own wallet (the Privy embedded wallet holds AUSD, shown as dollars); Elapse never holds a balance for them and there is no card payment in the product ([ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md)). How a subscriber gets dollars into that wallet is outside Elapse for 13 Oct; the demo wallet is pre-funded on testnet. |

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
- `/account` is built after the dashboard and is the first cut if the deadline bites (dashboard decision 16).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-03 | William | Reviewed and signed; five open questions settled with the agent's recommendations; FR-CHK-014/015 added. |
| 2026-09-04 | Claude (for William) | Surface 4 subscriber account from the 2026-09-04 grill round: FR-CHK-016–026, BR-CHK-007, account data shapes. FR-CHK-021 marked proposed pending the funding ADR. Awaiting signature. |
| 2026-09-04 | Claude (for William) | [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md) applied: FR-CHK-003 becomes the cap step with one Face ID signature; FR-CHK-021 withdrawn (no balance, no card); FR-CHK-018 cap line; BR-CHK-007 wallet rule; account balance shape removed; open items on out-of-funds and rebuilding the fund step. |
| 2026-09-04 | Claude (for William) | Cap end decided (William, 2026-09-04): FR-CHK-007 becomes "the session ends at the cap" with a receipt and Start again, replacing the out-of-funds pause; FR-CHK-006 drops Add funds; FR-CHK-015 seed renamed; FR-CHK-018 adjusted. |
| 2026-09-04 | Claude (for William) | Built the cap model in `web/`: cap step replaces the fund step, the meter ends at the cap with a receipt and Start again, no Add funds anywhere; `CapStep`, `MeterView` and `Receipt` gained component tests. 196 tests green. |
| 2026-09-04 | William | Reviewed and signed Surface 4 (`/account`, FR-CHK-016–026). |
