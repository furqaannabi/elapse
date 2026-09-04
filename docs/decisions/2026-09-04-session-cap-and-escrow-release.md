# Session cap = max duration × rate; cancel releases unused escrow, it does not refund

2026-09-04 · Decided by Furqaan Nabi · Status: accepted

Accepts and completes [ADR 2026-09-04 subscriber funding by card and an Elapse AUSD float](./2026-09-04-subscriber-funding-card-and-ausd-float.md), which was proposed and left four questions open for Furqaan. Read that record first; this one answers it and fixes one technical error in the thinking around it.

## Context

The funding ADR proposed that subscribers pay by card and that Elapse's own treasury deposits the matching AUSD into the subscription's escrow. It left open: the funder role in `AccrualStream`, whether the treasury deposits per session or pre-funds a pool, where unspent escrow goes on cancel, and whether unused money sits in a balance or returns to the card.

One idea in circulation was to use an ERC-20 allowance instead of an escrow deposit, on the theory that an allowance "locks" the subscriber's funds. **It does not.** `approve` grants a contract permission to spend up to an amount; the tokens stay in the holder's wallet and can be moved or spent elsewhere at any time. An allowance is a spending permission, not a reservation, so on its own it cannot back a meter that must be able to pay the merchant for elapsed time.

What actually backs a meter is a funded cap. Both the dollar presets already in the checkout (FR-CHK-003: $5 / $10 / $25, with the runtime shown beside each) and a maximum session duration describe the same number from opposite ends:

```
rate $0.004/sec × max duration 1 hour = session cap $14.40
```

## Decision

**The session model is `max_duration × rate = session_cap`.**

```
start → cap funded → meter runs → cancel → settle actual elapsed → release unused cap
```

Worked example at $0.004/sec, cancelled at 83 seconds against a $14.40 cap:

| | |
| --- | --- |
| Card payment at start | $14.40 |
| Deposited to escrow by the Elapse treasury | 14.40 AUSD |
| Elapsed cost `83 × $0.004` | $0.332 |
| To the merchant on settle | 0.332 AUSD |
| Released back | 14.068 AUSD |

Four answers to the open questions:

1. **Funder role.** The Elapse treasury (via the relayer) funds the escrow. The subscriber signs cancel with their Privy passkey; they never fund, never hold AUSD, never see an allowance screen. ERC-20 allowance is not exposed anywhere in the card-first flow.
2. **Per session or pooled.** Per-session deposit for the 13 October build. A pooled funding contract — one AUSD pool holding per-session reservations against a cap, rather than a separate transfer per session — is the intended next step because it makes the float requirement materially more efficient; not built for the hackathon.
3. **Where unused escrow goes.** Back to Elapse's float, credited to the subscriber's Elapse balance, instantly available for their next meter at any Elapse merchant. "Return to card" stays a Stripe refund on request, as the funding ADR proposed.
4. **Vocabulary.** This is not a refund and must not be called one anywhere in product, copy, or code. Cancel **releases unused escrow**. Elapse never charges back, because it never spends what did not elapse.

Crypto-native subscribers may later fund with `approve` / `permit` up to the cap, with the contract pulling as it settles. That path is post-submission and is not the demo path.

## Consequences

- **Every session needs a cap before it starts.** The checkout already picks one — the dollar preset *is* the cap. What changes is that the cap becomes an explicit, named session field rather than an incidental balance, and the product may want a `max_duration_seconds` so the cap can be expressed either way. The meter must stop at the cap, and the low-balance warning (5 minutes of runtime) is the warning that the cap is about to bind.
- **Contract.** `AccrualStream` needs a funder distinct from the subscriber, a cap the stream cannot accrue past, and release-of-unused to the funder. This is money-movement logic, so it lands in `contracts-frd.md` for Furqaan's sign-off alongside the settlement-fee change, not straight into code.
- **Float sizing is set by caps, not by usage.** A cap of $14.40 that only ever spends $0.33 still ties up $14.40 for the length of the session. Small caps and short maximum durations keep the float small; the pooled funding contract in (2) is the real fix, because a released reservation returns to pool liquidity immediately instead of waiting on a transfer.
- **Reconciliation gains a third number.** Dollars in via Stripe, AUSD out via settle, and now cap reserved versus cap released. The treasury view must show pool, reserved, and headroom.
- **Copy.** "We don't charge you back. We never spend what you didn't use." Subscriber-side: "Unused funds are instantly available for your next session." Neither line uses a chain word.
- **Everything the funding ADR flagged still stands**: chargeback exposure, money-transmission and e-money compliance before real money, depeg risk on the float, and Stripe in test mode with a testnet treasury for the 13 October submission.
- **Spec edits this triggers**, for the human to schedule: `contracts-frd.md` (funder role, cap, release), `checkout-frd.md` (cap as a session field, meter stops at cap, FR-CHK-021 unblocked), `api-frd.md` (FR-API-124 unblocked; cap on session create; treasury headroom check before start), `worker-frd.md` (Stripe webhook → credit → relayer deposit; reconciliation job).
