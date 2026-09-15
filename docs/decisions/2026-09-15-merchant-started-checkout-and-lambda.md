# Merchant-started metering on the hosted checkout, `/account` and `examples/lambda`
2026-09-15 · Decided by Furqaan · Status: accepted

## Context

On 2026-09-14 Furqaan moved the start of the meter from the subscriber's authorisation to the merchant, with the mode on the Product (contracts FR-CON-019/055/056, API FR-API-049/127, worker FR-WRK-075, SDK FR-SDK-009). That work was built and deployed, but it left two surfaces unspecified: what the hosted checkout and `/account` show a subscriber whose money is held but not yet billed, and how the Lambda reference merchant decides its resource is ready.

Reading the code during the grill turned up four things that forced decisions:

- The checkout maps every `incomplete` subscription to the Start step (`web/src/lib/checkout/view.ts`), so a funded subscriber coming back would be offered Start again.
- `/account` lists only `active`, `paused` and `canceled` (`api/src/db/account.ts`), so held money is invisible to its owner.
- `examples/lambda` resolves `@elapse/sdk` 0.1.0 from npm, and no published version has `subscriptions.start` or `startMode`. The workspace SDK is also numbered 0.1.3 while differing from the published 0.1.3.
- The example reuses its product by name, so anyone who ran it before has a checkout-mode "Serverless runtime" that would silently keep checkout mode.

## Decision

Eight answers, each chosen over the alternatives listed:

1. **Return after funding confirms.** After authorising a merchant-mode session, the checkout waits until the funding is confirmed and then sends the subscriber to `success_url` on its own. Rejected: redirecting on submit, which lets the merchant's `subscriptions.start` hit `not_funded` for a few seconds; a Back button with no redirect, which adds a tap.
2. **Held state with Stop.** A subscriber who comes back sees the amount held and that nothing is charged, with Stop for a full refund, on the checkout and on `/account`. Rejected: held with no Stop, leaving only the sweep to refund; keeping it hidden.
3. **The example starts on the first Run.** Rejected: starting when the console opens, which bills time spent editing; starting on `subscription.created`, which is checkout mode with an extra hop.
4. **Publish `@elapse/sdk` 0.1.4** with `subscriptions.start`, `products.create({ startMode })` and `Product.start_mode`; the example pins `^0.1.4`. Rejected: a workspace link, which stops the example installing the SDK the way a merchant does.
5. **Reuse the product only when name and mode match**; otherwise create one and say the old one was skipped. Rejected: a new product name; refusing to boot.
6. **Auto-run on return; refund on leave.** The saved code runs by itself when the subscriber comes back, which starts the meter. A subscriber who leaves before it starts is cancelled at once for a full refund, with no idle timer before start. Rejected: waiting for a Run click; leaving it to the platform's 15-minute sweep.
7. **Invoke only once the meter is active**, with a 30-second timeout that cancels and refunds. Rejected: invoking on the `202`, which runs unmetered compute and can run code for a start that then fails; invoking and reconciling afterwards.
8. **Show the refund time.** The held state says by what clock time the money comes back if the merchant never starts. Rejected: saying it without a time; not mentioning it.

## Consequences

- The API exposes `start_mode` and a server-computed `start_by` to the checkout and `/account`, using the same rule as the FR-WRK-075 sweep, so the 15-minute window is defined once.
- A subscriber's Stop becomes valid on a funded, unstarted stream. The contract already allows it; FR-CON-056 gains a test for the subscriber's signed path. No money-movement code changes. A subscriber cancel stamps `cancel_submitted_at` so the sweep never sends a second cancel for the same stream.
- The example's first Run is a few seconds slower, waiting for `active`, in exchange for every second of compute being on the meter.
- The Lambda example's install and CI job cannot resolve `^0.1.4` until it is on npm. Publishing is a human step.
- Amended specs: checkout FR-CHK-032 and new FR-CHK-033–036; API FR-API-137/138; contracts FR-CON-056; SDK FR-SDK-042; examples-lambda FR-EXM-102/114/115 and new FR-EXM-125/126/133.
