# The factory's keeper may cancel a stream, so `subscriptions.cancel` works from a merchant's server
2026-09-05 · Decided by William · Status: accepted

## Context
`AccrualStream.cancel()` accepted only the two on-chain parties, the subscriber's wallet and the
merchant's payout address (contracts FR-CON-050). The frozen SDK surface has
`elapse.subscriptions.cancel(id)`, called from a merchant's server holding an API key and no
wallet. API FR-API-042 said the relayer submits the cancel "as the merchant party", but the
relayer is not that party and the contract would reject it. Three ways out were weighed: (a) let
the factory's keeper cancel, (b) have the merchant sign in the dashboard with the payout wallet,
which removes the SDK method, (c) defer merchant cancel past 13 October.

## Decision
(a). `cancel()` accepts `msg.sender` equal to `factory.keeper()`, read at call time, alongside the
two parties (new FR-CON-054). `start`, `pause`, `resume` stay party-only. The platform relayer is
the keeper. William waives Furqaan's review for this change: it adds no new money path, because
a cancel can only pay the merchant the elapsed whole seconds minus the fee and refund the rest
to the subscriber.

## Consequences
- `subscriptions.cancel` in the SDK stays exactly as frozen and is honoured on chain.
- Trust widens by one bounded power: Elapse can end any stream early. It cannot redirect or keep
  funds. A rotated keeper loses the right immediately (tested).
- Testnet redeploy on 2026-09-05: factory `0x656fa8B348981602ACf36faD07804E806Cc15d5B`, block
  60009700 (`contracts/deployments/10143.json`). The API and indexer records are copied from it.
  Streams on the old factory (`0x2A27160F…0E3C40`) are ended and no longer indexed.
- Possible narrowing later, if wanted: keeper cancel only for streams past their cap or paused
  longer than N days. Not needed for 13 October.
