# Northwind learns a subscription from a verified claim, and reconciles its own meters on boot
2026-09-22 · Decided by William · Status: accepted

## Context

Running the Lambda example against the live stack, Run appeared to hang and the dashboard filled
with `incomplete` subscriptions. Three of them, each holding $7.20 of escrow:

```
13:48:19  subscription.created  sub_C38QKaBFwqtawB  incomplete  funded 7.2
13:48:42  subscription.created  sub_9d6VYVZG6KV5Ya  incomplete  funded 7.2
13:49:06  subscription.created  sub_lAF9mz8vPzBRTN  incomplete  funded 7.2
```

`elapse listen` was not running. The merchant's only webhook endpoint is the CLI one, and
FR-API-134 excludes a disconnected CLI endpoint from fan-out, so none of those events produced a
Delivery. Northwind therefore never learned the subscriptions existed — `/access` answered
`unknown session` for all three.

What turned a missing webhook into lost escrow is a single clause in the merchant's own server.
`/run` waits fifteen seconds for `subscription.created`, and when it does not arrive treats the
session as nonexistent and **opens a new Checkout session**, answering `409 needs_start`. The
console renders `<Authorize>` again, the subscriber signs again, and another $7.20 goes into
escrow that will not be delivered either. The events are twenty-three seconds apart — the fifteen
second wait plus one authorise round trip. That spacing is the loop, not three key presses.

The clause reads `state === undefined`, which means *"I do not know"*, and it answers not-knowing
by asking the subscriber to pay again. Nothing in the example ever cancels those sessions, so the
escrow strands: the unstarted sweep only knows sessions the server is holding.

Two things made this hard to see. The platform reports `delivery_state: "delivered"` for an event
with no Deliveries at all — the rollup falls through to its `ELSE` branch when the count is zero —
so the page a merchant opens to debug a missing webhook says everything arrived. And a fourth
subscription, `sub_IXTILbh3sZ3IJp`, has been `paused` since the previous evening, invisible to the
console because the session store is in memory and the process has restarted since. Nothing in the
example will ever end it.

A judge who clones this example and forgets one terminal meets all of it.

## Decision

**The webhook stays the source of truth.** Northwind still waits for `subscription.updated` before
it invokes anything, and a start that does not confirm within thirty seconds cancels and refunds
as FR-EXM-125 already promises. Polling the platform for lifecycle state was rejected: the example
exists to demonstrate *"your server finds out via webhook, not a cron job"*, and a reference
merchant with a polling loop in it argues the opposite.

**The console claims the subscription, and Northwind verifies the claim.** `<Authorize>` already
hands the page the `sub_` id. The console posts it; Northwind calls `subscriptions.retrieve` with
its own secret key and accepts it only if the subscription's `checkout_session` is a `cs_`
Northwind itself issued and has not consumed, and its product is Northwind's own. Retrieval alone
was rejected: it proves the subscription belongs to this merchant but not to *this* subscriber, so
anyone holding another subscriber's id — from a dashboard, a webhook payload, a shared screen —
could run code on a meter that person is paying for.

**A new Checkout session is opened only when Northwind has positively established there is no
usable meter**: no claimed subscription at all, or a claimed one the platform says is spent. A
claim that cannot be verified refuses with an honest sentence and changes nothing; a claim that is
positively not Northwind's refuses and does **not** cancel, since it may be someone else's running
meter.

**The claim may write only the `authorised` state**, exactly what `subscription.created` writes
today, so the claim and the webhook converge and whichever lands second is a no-op. Billing still
begins on the webhook.

**Northwind reconciles its own meters on boot** through `subscriptions.list`, re-adopting what
outlived the process. This is the one sanctioned place where live status is read from the platform
rather than received as an event: it is the merchant asking Elapse about the merchant's own
subscriptions, at a moment when there are no webhooks to have missed.

## Consequences

- **The escrow loop is gone.** The worst case when events stop is a Run that refuses and says why,
  with the authorisation intact and re-adopted as soon as the platform answers.
- **A restart no longer strands a meter.** It also means restarting the server is not free: the
  meter runs on chain while the process is down, and the subscriber pays for those seconds. The
  console says so when it re-adopts.
- **One `cs_` buys one session.** A second tab cannot adopt a session the first one opened; it
  opens its own. This is a behaviour change, and the intended one.
- **The example teaches the verification.** A merchant reading `src/` sees a browser-supplied id
  checked against a session the merchant issued, which is the lesson a reference integration
  should carry.
- **The platform's `delivery_state` still lies** for an event with no Deliveries. That is a
  separate defect on a separate surface and is not addressed here; until it is fixed, a merchant
  debugging this has no signal from the dashboard.
- **`elapse listen` is still required** for the example to do anything useful. Nothing here makes
  the demo work without it — it makes forgetting it cost a sentence instead of an escrow.
