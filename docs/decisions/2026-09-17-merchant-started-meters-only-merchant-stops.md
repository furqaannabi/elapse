# Once the merchant starts a merchant-mode meter, only the merchant can stop it
2026-09-17 · Decided by Furqaan · Status: accepted

## Context

Merchant-started metering (ADR 2026-09-15) lets a merchant fund a session at authorisation and start the meter when its resource is ready. Every signed spec still gave the subscriber Stop, and Pause where the product allowed it, on a running meter: FR-CHK-005 on the checkout, FR-CHK-018/019/030 on `/account`. Running the Lambda example, Furqaan decided that a subscriber must not be able to stop a meter the merchant has started.

Hiding Stop in the interface would only be a policy: the contract lets the subscriber `cancel()` directly and accepts a signed `cancelFor`, and a subscriber pause (`pause`/`pauseFor`) stops billing just as well. The contract does not know a stream's start mode; it knows how the stream was funded (`createWithPermit` funds and starts, `createWithPermitNoStart` funds and waits for `start()`).

## Decision

Four answers, each chosen over the alternatives listed:

1. **Enforce it in the contract.** A merchant-started stream that is `Active` or `Paused` rejects the subscriber's `cancel`, `cancelFor`, `pause`, `pauseFor`, `resume` and `resumeFor`. Rejected: hiding Stop in the UI only, which the contract would not honour; keeping Stop.
2. **Merchant-started streams only.** A stream funded through `createWithPermitNoStart` records that; streams created with `createWithPermit` (checkout mode) keep today's subscriber Stop. Before start (`Created`) the subscriber may still cancel for a full refund (FR-CON-056). Rejected: all streams, which would end "cancel at 83 seconds" for every product.
3. **Block pause too**, so there is no back door to stop billing. Rejected: allowing pause.
4. **The cap is the bound, said up front.** No on-chain escape if the merchant never stops: the meter ends itself at the cap the subscriber chose, and the cap step says so before Face ID. Rejected: a shorter maximum cap for merchant mode; a subscriber escape after the keeper has not settled for a while, which would turn keeper cadence into a liveness signal.

## Consequences

- A subscriber of a merchant-mode product can lose up to the whole cap if the merchant never stops the meter. The cap step names the merchant as the only one who can stop it.
- The merchant ends a meter with `subscriptions.cancel` (the keeper's `cancel()`, FR-CON-054), unchanged.
- The API refuses subscriber cancel and pause on these meters instead of relaying a transaction that would revert and burn relayer gas.
- **Money movement:** a new implementation and a fresh testnet factory, the indexer config and deployment copies re-synced, the Envio indexer redeployed. Streams already on the current factory keep today's rules.
- Supersedes the subscriber-Stop parts of checkout FR-CHK-005/018/019/030 for merchant-mode meters only; ADR 2026-09-07 (subscriber pause signed relay) stands for checkout-mode meters.
- Specs: contracts FR-CON-057, API FR-API-139, checkout FR-CHK-037.
