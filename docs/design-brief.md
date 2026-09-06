# Elapse — Design brief

## What Elapse is

Elapse is **Stripe Billing for things that should charge by the second** — GPU time, API calls, live streams, SaaS seats. A subscriber starts a meter, watches a live dollar counter tick, cancels whenever they want, and pays only the seconds that elapsed. Merchants integrate with an npm package, a hosted checkout URL, and signed webhooks — exactly like they already do with Stripe.

Tagline: **You only pay what elapsed.**
Demo line: *"Cancel at 83 seconds. Pay 83 seconds. Your server finds out via webhook, not a cron job."*

It runs on the Monad blockchain and settles in AUSD (a dollar stablecoin), but **the subscriber must never see chain words**: no "wallet", "gas", "seed phrase", "0x…", "Monad", "connect". Subscribers see Face ID, dollars, and a ticking counter. The chain is only exposed in an explicit "Judge mode" overlay for technical audiences.

Audience: (1) developers/merchants who already know Stripe; (2) their end customers on a phone; (3) hackathon judges — protocol founders and investors — deciding whether this looks like a real startup.

## Design direction

- **Feel:** Stripe / Linear / Vercel. Calm, dense, precise, developer-trusted. Not "crypto": no neon gradients, no glassmorphism, no glowing orbs, no coin imagery.
- **The hero element is time.** The live counter (seconds elapsed + dollars accrued) should be the most beautiful thing in the product. Tabular monospaced numerals, smooth 100ms ticks, no jitter. Treat it like a stopwatch made by a watchmaker.
- **Typography:** one clean sans plus a mono for numbers, ids, and code.
- **Color:** near-white and near-black neutrals, one restrained accent, semantic green/amber/red for status. Full light and dark mode.
- **Density:** dashboard is compact and table-heavy like Stripe; checkout is spacious and mobile-first.
- **Copy tone:** short, plain, confident. "You paid 83 seconds · $0.33". Never "Transaction confirmed on-chain".
- **Motion:** purposeful and orchestrated — landing reveals, meter start/stop, drawers, toasts. The meter ticks; the UI never blinks or pulses per second. Respect reduced-motion.
- Deliver desktop 1440 and mobile 390 for every page; light + dark for checkout and dashboard shell.

## Brand assets needed

- Wordmark "Elapse" and a simple mark that reads as elapsed time (an arc, a partial ring, a tick — not a clock-face cliché)
- Favicon, OG image, npm/GitHub avatar

---

## Surface 1 — Landing page (elapse.finance)

Single page, marketing, developer-facing.

1. **Hero:** "You only pay what elapsed." Sub: per-second subscriptions for APIs, GPUs, streams, SaaS. CTAs: "Read the docs" (primary), "Open dashboard". Right side: a live ticking meter demo (rate $0.004/s) with a Cancel button that stops it and shows "You paid 83 s · $0.33".
2. **Install strip:** `npm install @elapse/sdk` with copy button, three-line code sample.
3. **How it works — three steps:** Create a product → Send customer to Checkout → Receive `subscription.canceled` with `seconds_elapsed`.
4. **Problem/solution split:** "Cancel on day 3, pay for 30. The meter is a lie." vs the per-second meter.
5. **Webhook showcase:** a rendered JSON event card (`subscription.canceled`, `seconds_elapsed: 83`, `amount_settled: "0.33"`) — the product's hero artifact.
6. **Use cases grid:** GPU rental, API metering, live streaming, SaaS seats, coworking/desk time.
7. **"Feels like Stripe":** SDK, hosted checkout, signed webhooks, test/live mode, dashboard.
8. **Footer:** docs, GitHub, status, X, "Built on Monad" (small — the one place chain is allowed on marketing).

---

## Surface 2 — Subscriber Checkout (pay.elapse.finance) — mobile-first, no accounts, no chain words

**2.1 Checkout** `/c/:session_id`
- Merchant logo + name, product name, **live rate in USD per second** plus per minute/hour ("$0.004 / second · ~$14.40 / hour")
- Sign in with Face ID / passkey (Privy). Optional email fallback.
- Fund step: presets ($5, $10, $25, custom). "Unused funds are returned when you cancel."
- Primary button: **Start**
- Footer: "Powered by Elapse" + lock icon. Merchant's terms link.
- States: loading, session expired, session already used, product archived, error.

**2.2 Active meter** (same URL after Start)
- Full-screen counter: elapsed (`00:01:23`) and accrued (`$0.33`) ticking live
- Rate reminder, "Started 2:14 PM"
- One button: **Cancel**. Optional "Pause" if merchant allows.
- Low-balance (amber): "About 4 minutes of funds left. Add funds"
- Out-of-funds (red): meter paused, "Add funds to resume"

**2.3 Canceled / receipt**
- "You paid 83 seconds · $0.33" as hero line
- Breakdown: started, canceled, rate, total, refunded unused funds
- "Back to {merchant}" (success_url) and "Email receipt"

**2.4 Cancel-out / abandon page** (cancel_url return, before starting) — minimal.

**2.5 Judge mode** — hidden toggle (tap footer 3× or `?judge=1`) sliding up a technical panel: chain 143, contract address, ~300ms block ticker, Envio status, live webhook delivery log. Serious observability panel, not a block explorer.

---

## Surface 3 — Merchant Dashboard (app.elapse.finance) — Stripe-density, desktop-first but responsive

**Shell:** sidebar (Home, Products, Customers, Subscriptions, Invoices, Developers ▸ API keys / Webhooks / Events, Settings), top bar with business switcher, **Test / Live toggle** (test mode = orange banner), search, docs, user menu.

**3.1 Auth:** sign up, log in (email magic link or passkey), verify email.

**3.2 Onboarding (3 steps):** business name → payout address (helper: this is where AUSD settles automatically) → first API key reveal-once. Ends on "Make your first meter tick" quickstart card.

**3.3 Home:** stat tiles (active meters, accrued today, settled this week, failed payments), live "meters running" list with tiny tickers, recent events, quickstart checklist for new accounts.

**3.4 Products:** table (name, rate/s, ~per hour, active subs, status). Create/edit drawer: name, rate per second (auto-shows per minute/hour), description, allow pause, status. Archive with confirm.

**3.5 Customers:** table (email/passkey id, subscriptions, total settled, created). Detail with subscriptions and events.

**3.6 Subscriptions:** table with status chips (`incomplete`, `active`, `paused`, `canceled`), live elapsed & accrued for active, product, customer, started. Detail: big live meter, event timeline, settlements, actions (Cancel, Pause/Resume, Copy id). Filters.

**3.7 Invoices / Settlements:** table (period, seconds, amount settled, short tx id + external link).

**3.8 Developers → API keys:** publishable key (visible, copyable), secret keys (name, last used, created), create → reveal-once modal, roll/revoke with confirm. Separate test and live keys.

**3.9 Developers → Webhooks:** endpoints list (URL, events, status, success rate). Detail: signing secret reveal-once + roll, event picker, "Send test event", **delivery log** (event, type, status code, attempt n/8, time) with row drawer showing headers (incl. `X-Elapse-Signature`), body, response, **Resend**. Disabled-endpoint state.

**3.10 Developers → Events:** full event log with type filter, JSON viewer, pending-webhooks indicator.

**3.11 Settings:** business profile, payout address (change confirmation), checkout branding (logo, accent — live preview), team (later), danger zone.

**Global states for every dashboard page:** empty state with CTA, loading skeleton, error, mobile layout.

---

## Surface 4 — Subscriber account (later) `/account`
Active meters across merchants, cancel from here, balance & add funds, receipts. Same no-chain-words rule.

---

## Components

Live meter (large / inline / tiny), stat tile, status chip, key/secret field with reveal-once + copy, code block with copy, JSON viewer, data table with filters, drawer, modal, toast, test-mode banner, empty state, sidebar nav, mobile nav, buttons, form fields, merchant logo/avatar, judge-mode panel.

## Do not

- No wallet-connect buttons, seed phrases, gas prompts, hex addresses, or "Monad" in the subscriber checkout.
- No per-second flashing/pulsing; the meter ticks, the UI does not blink.
- No stock crypto or finance illustrations.
- No "coming soon" placeholders — a designed page looks complete.
