# Subscribers hold AUSD; the subscriber authorizes money by permit; the Elapse relayer signs the session

2026-09-04 · Decided by Furqaan Nabi · Status: accepted

The single standing record of how a session gets funded. It replaces three withdrawn 2026-09-04 records — subscriber funding by card with an Elapse AUSD float, the session-cap acceptance of it, and the merchant-server-side-key signing model — all readable in git history at `d292063`, `a19f534` and `a225a7d`.

## Context

Two models were written down and discarded on the way here.

**Card funding with an Elapse float.** Subscribers would pay by card; Elapse would hold fiat plus an AUSD float and deposit escrow on their behalf. It bought a clean consumer UX and cost Stripe integration, float sizing and low-water alarms, two-ledger reconciliation, chargeback exposure, subscriber balances, and money-transmission / e-money licensing before a cent could move. Six weeks to 13 October, and none of it is the protocol.

**A merchant server-side signing key.** With the float gone and subscribers holding their own AUSD, `@elapse/sdk` was briefly given a `privateKey` that signed the call opening the stream. That conflates two authorizations belonging to two different parties: *which product a session is for* is the merchant's business decision, *whose money moves and how much* is the subscriber's. One key doing both makes the merchant's key capable of initiating onchain sessions and of touching customer funds through allowances — an awkward trust model to ask a developer to accept, and the reason CLAUDE.md says merchants never paste a private key into the SDK.

## Decision

**No card payment anywhere in the product.** No Elapse fiat treasury, no AUSD float, no subscriber balance held by Elapse, no Stripe, no custody. **The subscriber holds AUSD in their own wallet** and the session is escrowed from it directly.

**The merchant never holds a signing key.** `@elapse/sdk` keeps its frozen surface — `new Elapse({ secretKey })`, an Elapse API key, nothing more. The merchant authorizes which product and which session through the Elapse API, exactly as with Stripe.

**The subscriber authorizes the money movement**, as an ERC-2612-style signed `permit` rather than a separate approval transaction.

**The Elapse relayer submits the transaction**, settling contracts FRD undecided #5 as option (a), the platform relayer calls `StreamFactory.create` at checkout.

```
Subscriber signs permit          (Face ID, a signature, no gas, no tx)
        ↓
Elapse relayer submits           (relayer pays gas)
        ↓
permit()
        ↓
createStream()
        ↓
transferFrom(subscriber → escrow)
```

One signature, one transaction, gas sponsored. This is the UX the card model was reaching for — **Face ID → Start → the meter begins** — without Elapse holding a cent of anyone's money.

**The session cap is a protocol primitive, not a UI convention.**

```
rate        = $0.004/sec
maxDuration = 3600 sec
maxEscrow   = rate × maxDuration = $14.40
```

The contract guarantees the subscriber's maximum exposure is `maxEscrow`. The permit is signed for exactly that amount, so the subscriber's signature never authorizes more than the cap. At 83 seconds elapsed: $0.332 earned by the merchant, $14.068 released. The meter stops automatically when escrow reaches zero — the contract enforces the ceiling, the UI merely displays it.

## Consequences

- **What this deletes**, none of which would have shipped by 13 October: Stripe, the treasury and its float sizing, the low-water check before session start, two-ledger reconciliation, the Elapse-internal treasury page, chargeback exposure, subscriber balances, "Return to card", and the money-transmission and e-money licensing questions. Elapse is a protocol and a developer platform again, which is the pitch.
- **Getting AUSD onto a subscriber's wallet is deliberately outside Elapse.** No major on-ramp sells AUSD on Monad — Ramp is the one that does, excludes the EU, and has a ~$20 minimum. This is knowingly unsolved, not overlooked: the demo wallet is pre-funded on testnet, and solving it drags back exactly the complexity just removed. **Elapse is the billing protocol, not the payment processor.**
- **Depends on AUSD implementing ERC-2612 `permit`. This is unverified** and must be checked on Monad before any contract work — the token's actual interface decides it, not our preference. If AUSD has no `permit`, the fallback is a conventional `approve` transaction signed by the subscriber, which needs gas and therefore the Privy smart wallet plus paymaster from contracts FRD undecided #4(a). That fallback costs a second signature and one more moving part; it does not change who authorizes what.
- **The relayer becomes load-bearing.** It holds MON for gas, it is the only party that can open a stream, and it is a single point of failure for starting sessions. It never holds AUSD and can never move subscriber funds beyond what a signed permit authorizes, which is the point — compromise of the relayer key stalls new sessions, it does not drain anyone.
- **Permit replay and expiry** need handling: nonce, deadline, and the exact `maxEscrow` value bound into the signed message, so a captured permit cannot be resubmitted or reused for a larger amount.
- **The subscriber still needs a wallet holding a token.** "Subscribers never see chain words" survives only if the Privy embedded wallet holds the AUSD and signs the permit invisibly with Face ID, with the UI speaking dollars. The moment a subscriber funds that wallet themselves, they see a token and a network. Whether the checkout keeps a fund step at all, and what it says, is an open product question for the human.
- **Trust model, stated plainly for the pitch.** The merchant authorizes the session. The subscriber authorizes the money. Elapse authorizes neither and only submits.
- **Spec work this triggers**, for the human to schedule and sign: `contracts-frd.md` (permit path, `maxEscrow` ceiling enforced onchain, meter stops at zero, relayer as `create` caller, undecided #5 closed as (a), nonce/deadline handling — money movement, so Furqaan signs before code); `sdk-frd.md` (no change; the `privateKey` option is cancelled before it was built); `checkout-frd.md` (FR-CHK-003 fund step becomes cap selection and one permit signature; the stale "pending the funding ADR" marker at FR-CHK-021 to be repaired); `api-frd.md` (FR-API-124 balance and top-up endpoints cancelled; session create carries `max_duration_seconds` and returns the permit payload to sign).
