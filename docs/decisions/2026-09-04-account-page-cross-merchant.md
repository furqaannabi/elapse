# The subscriber account page stays Elapse-branded across merchants

2026-09-04 · Decided by William · Status: accepted

## Context

`/account` (checkout FRD Surface 4, FR-CHK-016–026) lists a subscriber's running meters and receipts across every merchant they use, signed in with the passkey they created at their first checkout. Two shapes were weighed: keep it cross-merchant and Elapse-branded, or scope it to one merchant and dress it in that merchant's branding the way the checkout is.

The question only matters because of what it implies for merchants. If the account page were the only way a subscriber could stop a meter, every merchant would be forced to send their customer to a page listing their competitors. The decision was taken on the understanding that it is not: the merchant can build the same actions into their own product through `@elapse/sdk`, and the account page is a convenience the subscriber finds from their own receipt, never a step the merchant has to link to.

Nothing is paid on the page. Since the cap decision of the same day, a session's money is authorised once at checkout and cannot be topped up, so there is no balance and no funding action anywhere in the subscriber surface.

## Decision

One `/account`, Elapse-branded, listing meters and receipts across all merchants, as specced. It is optional for merchants: the SDK exposes `subscriptions.retrieve` (rate and `started_at`, enough to draw a live meter locally), `subscriptions.cancel`, `invoices.list` and `customers.retrieve`, so a merchant can run the whole post-checkout experience inside their own product without mentioning Elapse.

Merchant branding stays where it belongs: the hosted checkout, per session (dashboard FR-DSH-103). A cross-merchant page cannot honestly wear one merchant's colours.

## Consequences

- **The subscriber gets one place** to see everything they are paying by the second, which is the network effect the page exists for and something no single merchant's UI can give them.
- **A merchant who wants their customer to stay inside their app can have that today**, except for the checkout itself, which is Elapse-hosted because the passkey signature happens there (see [2026-09-04 subscriber permit](./2026-09-04-subscriber-permit-relayer-signs.md)). Whether an embedded checkout ever exists is still open.
- **Merchant privacy.** A subscriber on `/account` sees the names of the other merchants they subscribe to. That is their own data, not a leak between merchants, but a merchant cannot prevent it. Worth stating plainly in the docs rather than discovering in a support ticket.
- **Gap in the frozen SDK surface.** There is no `subscriptions.list`: a merchant building "your running meters" inside their own product can retrieve one subscription at a time but cannot list a customer's. The REST route exists (`api-frd.md` FR-API-041). Adding the method needs a signed change to the frozen §4.2 surface; recorded here as a question for the human, not taken.
- **No merchant-facing change** in the dashboard, and no change to what was built.
