# Subscribers hold AUSD; the SDK signs the session with a merchant server-side key

2026-09-04 · Decided by Furqaan Nabi · Status: accepted

Replaces the card-funding line of thinking recorded earlier on 2026-09-04 in `2026-09-04-subscriber-funding-card-and-ausd-float.md` and `2026-09-04-session-cap-and-escrow-release.md`. Both were reverted in `fa22e7f` rather than left standing; they are readable in git history at `d292063` and `a19f534`.

## Context

The withdrawn ADRs solved "where does the AUSD come from" by putting Elapse in the middle: subscribers pay by card, Elapse holds fiat and an AUSD float, and Elapse's treasury deposits escrow on the subscriber's behalf. That bought a clean consumer UX and cost a great deal — Stripe integration, float sizing and low-water alarms, two-ledger reconciliation, chargeback exposure, and money-transmission / e-money licensing before real money could move. Six weeks to 13 October, and none of that is the protocol.

Furqaan's call is to delete the middle. The subscriber already holds AUSD. Elapse never touches fiat, never holds a balance, and never needs a licence.

## Decision

**No card payment anywhere in the product.** No Elapse fiat treasury, no AUSD float, no subscriber balance held by Elapse, no Stripe.

**The subscriber holds AUSD in their own wallet.** A session is opened directly against the contract and escrowed with the subscriber's own AUSD.

**`@elapse/sdk` accepts a signing key, server-side only.** The merchant runs the SDK on their own server with a funded key in the environment; that key signs the contract call that opens the `AccrualStream`.

```ts
const elapse = new Elapse({
  secretKey:  process.env.ELAPSE_SECRET_KEY, // platform API auth, unchanged
  privateKey: process.env.PRIVATE_KEY,       // signs the chain call, server only
})

await elapse.checkout.sessions.create({ product, customer })
```

This reverses two rules that were previously absolute, deliberately and with the risk understood:

- CLAUDE.md's security table said *"Merchants never paste a private key into the SDK."* They now do. The mitigations are that the key is server-side only, that the SDK already refuses to construct in a browser (BR-SDK-002), and that the key must never be logged, never appear in an error message or `toString()`, and never be sent anywhere — the same treatment `secretKey` already gets.
- FR-SDK-001 is part of the frozen SDK surface and gains an option. This is a surface change, made knowingly, not an accident.

## Consequences

- **What this deletes**, all of it work that would not have shipped by 13 October: Stripe, the treasury and its float sizing, the low-water check before session start, two-ledger reconciliation, the Elapse-internal treasury page, chargeback exposure, subscriber balances, "Return to card", and the money-transmission and e-money licensing questions. Elapse is a protocol and a developer platform again, which is the pitch.
- **What it costs.** The withdrawn ADR existed because a subscriber cannot easily *get* AUSD on Monad — no major on-ramp sells it, Ramp is the one that does and excludes the EU with a ~$20 minimum. That problem is not solved here, it is moved out of scope: subscribers arrive already holding AUSD. For the demo that is fine, because the testnet wallet is pre-funded. For a real launch it is the first thing a user hits.
- **Subscriber UX is now in tension with the locked rules.** "Subscribers never see chain words" and "subscribers never hold MON" survive only if the Privy embedded wallet holds the AUSD and signs invisibly with Face ID, with gas still sponsored by the relayer and the UI still speaking dollars. The moment a subscriber has to fund that wallet themselves, they see a token and a network. Whether the checkout keeps a fund step at all, and what it says, is an open product question for the human.
- **Contract.** Escrow is funded from the subscriber's own AUSD, which means an `approve` (or `permit`) from the subscriber before the merchant's signer calls `create` and the contract pulls with `transferFrom`. Two consequences to settle before any contract work: who pays gas for that approval, and whether the approval is exact-amount per session or a capped allowance. Money movement — Furqaan signs off before code.
- **Session cap still stands as a concept.** Escrow is bounded by what the subscriber deposits; the meter must stop when it is exhausted, and the low-balance warning at 5 minutes of runtime is unchanged. The `max_duration × rate` framing from the withdrawn record remains the honest way to describe that ceiling, independent of who funds it.
- **Stale spec markers to repair.** `checkout-frd.md` (FR-CHK-021, and the line at the subscriber-account section) and `api-frd.md` (FR-API-124) both say "pending the funding ADR" and link a file that no longer exists. FR-API-124's balance and top-up endpoints are cancelled outright. `sdk-frd.md` FR-SDK-001 and BR-SDK-002 need the `privateKey` option and its handling rules. `contracts-frd.md` needs the approve/transferFrom funding path.
