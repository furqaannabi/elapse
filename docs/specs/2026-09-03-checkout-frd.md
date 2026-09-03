# Hosted checkout (`/c/[session]`) — FRD

Status: **Draft — awaiting human sign-off** · Surface: Operate (subscriber, mobile-first) · Sources: design brief Surface 2; detailed doc §3, §7, §10.

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
| FR-CHK-007 | Out-of-funds: meter pauses, red notice "Add funds to resume"; status `paused`. | State test. |
| FR-CHK-008 | Cancel ends the meter, shows the receipt: "You paid N seconds · $X" hero line; breakdown of started, canceled, rate, total, refunded; "Back to {merchant}" and "Email receipt". | Settled = whole seconds × rate; refund = funded − settled. |
| FR-CHK-009 | "Back to {merchant}" navigates to `success_url?session_id=cs_…`. Abandoning before Start goes to `cancel_url`. | URL assertions. |
| FR-CHK-010 | Session states: loading skeleton, expired, already used, product archived, network error — each with copy naming the problem and the recovery. | One test per state. |
| FR-CHK-011 | Judge mode: hidden toggle (`?judge=1` or triple-tap on the footer) slides up a panel with chain id, contract address, block ticker (~300 ms), indexer status, and the live webhook delivery log for this session. | Panel renders from mocked data; hidden by default. |
| FR-CHK-012 | Mobile 390 first; one-handed; touch targets ≥ 44 px; Cancel reachable with the thumb. | Screenshot review at 390 and 1440. |
| FR-CHK-013 | Light and dark; reduced motion honoured; counter keeps ticking. | As landing. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-CHK-001 | No chain vocabulary anywhere on the subscriber surface except inside the judge panel: no wallet, gas, seed, 0x, Monad, connect, transaction. |
| BR-CHK-002 | The subscriber can never be charged more than funded; the meter pauses at zero. |
| BR-CHK-003 | Settled amount is whole seconds × rate (matches the contract); the live counter may show fractional accrual but the receipt never exceeds settled. |
| BR-CHK-004 | Red appears only on Cancel and the out-of-funds notice; live state is blue; low balance is amber. |
| BR-CHK-005 | The merchant's secret key never reaches this page; it is driven by a session id and a publishable key only. |
| BR-CHK-006 | "Powered by Elapse" and a lock icon appear in the footer of every state. |

## Data (mocked until the API exists)

```
CheckoutSession { id: cs_…, merchant: { name, logo_url, success_url, cancel_url },
                  product: { id: prod_…, name, rate_usd_per_second, allow_pause },
                  status: "open" | "complete" | "expired", subscription?: sub_… }
Subscription    { id: sub_…, status, started_at, paused_at, canceled_at, funded_usd, rate_usd_per_second }
```

## Grill-me questions to settle before build

1. Pause: in MVP or not? Doc lists `subscription.updated` for pause/resume but the checkout flow in §7 has no Pause. **Recommend: hide Pause behind `product.allow_pause`, default off.**
2. Fund presets: fixed dollars, or runtime-based ("1 hour", "4 hours")? **Recommend: dollars with the runtime shown beside each.**
3. Low-balance threshold: minutes or percent? **Recommend: 5 minutes of runtime.**
4. Email receipt: real send (needs backend) or copy-to-clipboard for MVP? **Recommend: button present, posts to a mocked endpoint, toast "Sent".**
5. Judge-mode trigger: `?judge=1` only, or also a gesture? **Recommend: both; the gesture is for the live demo on a phone.**

## Open

- Privy app id and bounty requirements (Week 3).
- Whether the subscriber `/account` page ships before 13 Oct.
