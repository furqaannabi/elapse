# The subscriber never pauses a meter; they ask the merchant
2026-09-20 · Decided by Furqaan · Status: accepted · Narrows [2026-09-07 subscriber pause as a signed relay](./2026-09-07-subscriber-pause-signed-relay.md)

## Context

[ADR 2026-09-07](./2026-09-07-subscriber-pause-signed-relay.md) gave the subscriber pause and resume as signed relays, in the shape of cancel: `pauseFor`/`resumeFor` on the stream, `prepare` + submit routes under the session and on `/account`, and a Pause control beside Stop.

Two things have changed since. Merchant-started metering arrived (FR-CON-019/055/057): a meter the merchant starts is one only the merchant stops, enforced on chain by `_refuseSubscriber`. And `subscriptions.pause`/`resume` arrived for merchants (FR-API-141/142, FR-CON-074, SDK 0.3.0), so the merchant now has a first-class way to pause.

That left an asymmetry nobody chose: on a **merchant-started** product the subscriber already cannot pause, because `_refuseSubscriber` fires; on a **checkout-mode** product they still can. Furqaan, 2026-09-20: "remove pause for subscriber… user should ask merchant for pause no direct".

The money argument is the deciding one. A subscriber who pauses stops the meter while the merchant's resource keeps running — a GPU stays allocated, a seat stays held — so the merchant serves for free for as long as the pause lasts. Stopping is different: it ends the session, the merchant reclaims the resource, and the subscriber's unused escrow returns. Stop stays; pause goes.

## Decision

A subscriber cannot pause or resume a meter, on any product. Pausing is something they **ask the merchant for**, through the support link already shown beside their meter, and the merchant does it with `subscriptions.pause`.

- **Contract:** `pauseFor`, `resumeFor`, `pauseDigest` and `resumeDigest` are removed from `AccrualStream`. They existed only for the subscriber — merchants hold no key (ADR 2026-09-04) and pause through the keeper — so nothing else calls them. `pause()`/`resume()` (`onlyPartyOrKeeper`) are untouched, and `cancelFor` stays: the subscriber's Stop on a checkout-mode meter is the product's promise.
- **API:** FR-API-044/045/046/047 are withdrawn — the session and `/account` pause/resume routes, their `prepare` pairs and the pause rate limit.
- **Subscriber surfaces:** no Pause control on `/account` or in `<Meter>`.
- **`Product.allow_pause` stays**, now meaning only "the merchant may pause this".

Rejected: leaving the routes and hiding the buttons (the capability would still be one API call away); leaving the contract functions unused (a subscriber can sign a relay themselves, so the merchant could still be made to serve for free).

## Consequences

- **A fresh factory.** The bytecode changes, so the contract is redeployed and re-verified, the deployment record synced into `api/`, `web/` and `indexer/`, and a new Envio deployment made. All six streams on the outgoing factory are `Canceled`, so nothing is stranded.
- **Envio is at 3/3 deployment slots** and its CLI `deployment delete` is broken (returns `status: failed`), so a slot must be freed in the dashboard before the new indexer can deploy.
- **A subscriber who wants a pause waits for a human.** For the 13 Oct demo that is the honest trade: the alternative lets a subscriber freeze billing while consuming the merchant's resource.
- **`relayNonce` keeps its role** for `cancelFor` alone; the digest tag that told the three apart now distinguishes one.
