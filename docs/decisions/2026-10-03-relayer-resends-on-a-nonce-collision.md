# The relayer resends with a fresh nonce when a send collides
2026-10-03 · Decided by Furqaan · Status: accepted

## Context
`demo:seed` died on its third meter. On chain: the seed's `cancelFor` for meter 2 took relayer nonce 222 at 10:10:04 UTC, and the seed's next `createWithPermit`, sent within the same second, was signed with nonce 222 too and refused by the Monad testnet RPC — "An existing transaction had higher priority". viem asks the RPC for the pending nonce on every send, and the RPC had not yet counted the transaction it had just accepted. The worker's keeper played no part (its `settleBatch` took 223 at 10:10:42), but it signs with the same key from a second process with no coordination, so a subscriber's Authorise or Stop can collide with the keeper, or with another subscriber's action in the same second, the same way. A judge would see the action fail.

Three fixes were weighed: resend on a nonce collision with a freshly fetched nonce; one nonce counter in Postgres shared by the API and the worker; viem's per-process nonce manager. The shared counter is deterministic but a dropped transaction leaves a gap that stalls every later relayer transaction until someone intervenes. The per-process manager fixes the seed's case but not the API against the worker, and a failed send can leave a local gap.

## Decision
Every transaction the relayer key signs, in the API and in the worker, is resent with a freshly fetched nonce when the RPC refuses it as a nonce clash — "existing transaction had higher priority", "nonce too low", "replacement transaction underpriced" — after 0.6, 1.2 and 1.8 seconds, and the fourth refusal surfaces as any relayer failure does today. A refused send never entered the mempool, so resending cannot double-send. Every other error surfaces at once and is never retried: a send the RPC accepted, or one whose fate is unknown, is not sent again.

## Consequences
Collisions heal by themselves within a few seconds, whichever process caused them, with no shared state and no new failure mode. The cost is that an action that collides takes up to 3.6 seconds longer. Collisions are not prevented, only absorbed, so under heavy concurrent load the relayer can still exhaust its four tries; a dedicated sender queue is the upgrade if that ever shows up in the logs, where each resend is recorded with the call name and attempt (never the transaction or signature). The faucet's own key is unaffected: its drops already go out one at a time.

Specs: [api-frd](../specs/api-frd.md) FR-API-157.
