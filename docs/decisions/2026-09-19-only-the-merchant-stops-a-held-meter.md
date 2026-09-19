# Only the merchant stops a merchant-started meter, including before it starts
2026-09-19 · Decided by Furqaan · Status: accepted · Supersedes the subscriber clause of [ADR 2026-09-17](./2026-09-17-merchant-started-meters-only-merchant-stops.md)

## Context

A merchant-started meter is the merchant's to stop once it runs (FR-CON-057). Before it starts, the subscriber kept a Stop: their AUSD was escrowed and earning nobody anything, so FR-CON-056 let them take it back, `/account` offered the button (FR-CHK-034), and the platform accepted the relayed cancel (FR-API-137).

Seeing that button in the Lambda console, Furqaan asked first for it to be hidden, then — told that hiding the button leaves the power — for the power to go too, from the contract and the platform.

The objection was put and overruled: after this, a subscriber who authorises and is never started cannot release their own money. That is a real change in who holds the risk.

## Decision

`_refuseSubscriber` stops caring what state the stream is in. On a `merchantStarted` stream the subscriber may not cancel, pause or resume at any point — held, running or paused. The merchant and the factory's keeper keep every one of those powers.

Everything that releases a held session now runs through someone else:

- the merchant, whenever it likes, through `subscriptions.cancel`;
- the platform's unstarted sweep (worker FR-WRK-075), which cancels a funded, never-started session past `min(max_duration, 15 min)` and refunds it in full;
- the merchant's own server, which in `examples/lambda` ends abandoned sessions within seconds.

Checkout-mode streams are untouched: those start at authorisation and were never held, and their subscriber keeps Stop.

## Consequences

- **A subscriber's escrow can be locked for up to fifteen minutes with no self-service exit.** The unstarted sweep is now the only guarantee they have, which makes the worker's health a consumer-protection matter and not just an operational one. If the worker is down, only the merchant can free the money.
- The subscriber-facing surfaces lose a promise they were making: `/account`'s held view no longer offers Stop, and says when the money returns instead. The wording matters more than it did, because it is now the only answer a subscriber has.
- `@elapse/react` follows `subscriber_can_stop`, which the API already computes, so the SDK needs no new flag for this — `controls={false}` stays as a merchant's own choice on top.
- Another testnet redeploy and a new factory address, with everything that drags behind it: the deployment record, the API image, the indexer's address and start block, and a re-sync. Streams on the previous factory keep the previous rules, so a held session created before the cutover can still be stopped by its subscriber.
- Reversing this later is a further redeploy. It is a rule in the contract now, not a flag.
