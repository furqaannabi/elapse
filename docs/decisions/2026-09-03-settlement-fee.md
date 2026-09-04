# Percentage platform fee taken inside settle, default 1 percent, owner-adjustable

2026-09-03 · Decided by William · Status: accepted (contract change awaiting Furqaan's review)

## Context

The dashboard grill round settled the payout model: there is no platform balance and no withdraw step. `settle()` pays the merchant's payout address directly, and the Invoices page is the payout history. With money going straight from the stream to the merchant, the only place Elapse can take revenue is inside the settle path itself.

The signed contracts spec at that point said the opposite. BR-CON-006 reads "money leaves a stream only to `merchant` (settle) or `subscriber` (refund); there is no owner sweep", FR-CON-030 transfers the whole settled amount to the merchant, and the FR-CON-072 invariant assumes `tokenBalance(stream) == deposited − settledAmount`. Three shapes were weighed: a flat per-settlement fee, a percentage fee, and no fee until after the submission. A flat fee punishes short meters, which are the product's whole point. Deferring the fee would leave the contract's settle path to be reopened after the kill gate, when it should be frozen.

## Decision

Every settlement carries a percentage fee. `settle()` and the settle chunk inside `cancel()` pay `amount − fee` to `merchant` and `fee` to a platform treasury address. The rate lives on `StreamFactory` as `feeBps`, set by the factory owner, default 100 (1 percent), and clones read it at call time. The `Settled` event carries the fee. Refunds of unspent escrow carry no fee: the fee is a share of elapsed seconds, never of the deposit.

## Consequences

- **Contracts spec.** BR-CON-006 gains the treasury as a third destination, FR-CON-030 splits the transfer, FR-CON-072's invariant becomes `tokenBalance(stream) == deposited − settledAmount` where `settledAmount` is gross, and `Settled` gains a `fee` argument. William signs as builder; Furqaan reviews on arrival because this touches money movement.
- **Indexer and API.** The ledger ingests the fee as its own row kind, and the Invoice object gains gross, fee, and net.
- **Dashboard.** Fee is a separate column everywhere money is listed and net is what the merchant received (BR-DSH-009). The rate is read from the API and never hard-coded in copy (FR-DSH-061, FR-DSH-102).
- **What it rules out.** No owner sweep of escrow, no fee on cancel refunds, no per-merchant rates in the MVP. "Contact us for volume pricing" is copy, not a feature.
- **Watch.** The treasury address is a privileged parameter; who holds the factory owner key is an operational decision still open. If the funding model in [2026-09-04](./2026-09-04-subscriber-funding-card-and-ausd-float.md) is accepted, the treasury that receives fees and the treasury that funds escrow should be distinct addresses so fee income and float are never mixed.
