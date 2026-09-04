# Subscribers fund by card; Elapse funds escrow from its own AUSD float

2026-09-04 · Proposed by William (with the agent's research) · Status: proposed, awaiting Furqaan's review

## Context

The product rule is that subscribers never see chain words. The hosted checkout (FR-CHK-003) has a fund step with $5 / $10 / $25 presets, but the signed spec never said where the money comes from. Escrow is AUSD on Monad, so somebody has to buy AUSD, and whoever does sees a token, a network, and usually a verification screen.

Research on 2026-09-04:

- **Privy funding.** Privy's native funding modal (card, Apple Pay, Google Pay, bank, exchange) routes US and EU purchases through Stripe's crypto on-ramp and the rest through MoonPay or Meld. Stripe's on-ramp delivers BTC, ETH, SOL, USDC and XLM on Bitcoin, Ethereum, Solana, Polygon, Base, Avalanche and Stellar. Neither Monad nor AUSD is listed, so the default route would land the subscriber on the wrong chain with the wrong token.
- **Ramp Network** is the only provider found that sells and buys AUSD on Monad with cards and Apple Pay. AUSD is excluded in the EU. The widget can be styled but its copy ("Buy AUSD on Monad") and its phone, email and ID verification are Ramp's.
- **Coinbase Onramp** is retiring hosted guest checkout on 30 June 2026 for a US-only headless API; Monad is not listed.
- On-ramp fees run roughly 1 to 4 percent and minimums are typically $20 to $30, so no provider can honour a $5 preset.
- **Off-ramp** for merchants: Ramp Network's AUSD sell flow today; Stripe's Bridge stablecoin accounts once they support AUSD on Monad (currently USDC on Tempo in the Privy recipe).

Options weighed:

| | A. Card in, Elapse float funds escrow | B. Embedded on-ramp (Ramp) in checkout | C. Bring your own AUSD |
| --- | --- | --- | --- |
| Subscriber sees | Card / Apple Pay, dollars only | "Buy AUSD on Monad", KYC, fee, $20+ minimum | Wallet and token |
| Money custody | Elapse holds fiat and an AUSD float | None | None |
| Regions | Wherever Stripe cards work | AUSD not in EU | Anyone with AUSD |
| Fits "no chain words" | Yes | No, at the moment that matters most | No |
| Startup story | Stripe's seat between two rails | Wallet-funding wrapper | Crypto-native only |

## Decision

**Option A.** The fund step is an ordinary Stripe card payment in dollars (card, Apple Pay, Google Pay). On success, Elapse credits the customer and Elapse's relayer deposits the same amount of AUSD from an Elapse-owned treasury wallet into the subscription's escrow on Monad. Settlement pays the merchant in AUSD per settle as already specified. Cancel returns unspent AUSD to the treasury, not to the subscriber's wallet.

Privy stays as subscriber identity and signing key only (passkey / Face ID signs the cancel). The embedded wallet never holds money, so the subscriber never funds it, never sees an address, and never needs gas.

Refunds, proposed: unused funds land in the subscriber's Elapse balance instantly ("$9.67 returned to your balance") and fund their next meter at any Elapse merchant. A "Return to card" action issues a Stripe refund on request. Per-cancel card refunds were rejected because Stripe keeps the original processing fee on every refund, which at $5 presets exceeds the platform's 1 percent take, and card refunds take days. Authorise-and-capture is noted as a later optimisation for short sessions.

Option C stays available only behind judge mode for the demo. Option B is recorded as the alternative for regions or merchants that opt out of Elapse custody; not built.

For the 13 October submission: Stripe runs in test mode with a test card, the treasury is a testnet wallet holding test AUSD, and every other part of the loop is real code.

## Consequences

- **Float.** The treasury covers open escrows plus the Stripe payout lag, not total volume. Every settle and cancel recycles AUSD back into it. Rough sizing at launch: 200 open meters × $10 plus a $500 buffer, about $2,500. A session must not start unless the pool can cover its escrow; a low-water alarm is required. At scale the lag is financed by a credit line and the float can be outsourced to Bridge once it supports AUSD on Monad.
- **Reconciliation.** Two ledgers (dollars in via Stripe, AUSD out via the contract) must match daily. The dashboard ledger already has the shape; Elapse needs its own treasury view (pool, open escrow, headroom) hidden from merchants.
- **Chargebacks.** A disputed card payment after the merchant was paid in AUSD is Elapse's loss. Small presets and mid-session top-ups bound the exposure. Merchant-of-record risk; standard for a processor.
- **Compliance.** Holding subscriber balances is money transmission in the US and e-money in the EU. Licence or partner before real money; flagged, not solved. Stablecoin issuer / depeg risk sits on the float; keep it small.
- **Pitch line.** "Subscribers pay by card. Merchants receive AUSD on Monad the second it settles."
- **Spec edits this triggers** (after Furqaan's review):
  - `checkout-frd.md`: FR-CHK-003 fund step becomes a Stripe payment; FR-CHK-008 receipt copy "returned to your balance"; subscriber `/account` gains balance and "Return to card", which moves it up the cut order.
  - `contracts-frd.md`: escrow is deposited by a funder role (Elapse relayer/treasury) distinct from the subscriber who signs cancel; refunds go to the funder. This is a contract change for Furqaan to confirm alongside the settlement-fee change.
  - `api-frd.md` / `worker-frd.md`: Stripe webhook → credit → relayer deposit; treasury low-water check before session start; balance and refund endpoints; reconciliation job.
  - `dashboard-frd.md`: no merchant-facing change; an Elapse-internal treasury page is new scope for the human to place.
- **Open for Furqaan:** the funder role in `AccrualStream`; whether the treasury deposits per session or pre-funds a pooled escrow contract; refund destination on cancel; and whether refunds sit in a balance (proposed) or go straight back to the card.
