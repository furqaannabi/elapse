# The webhook worker lives inside `api/`; endpoints auto-disable after 3 days of continuous failure
2026-09-05 · Decided by William (grill with Claude) · Status: accepted

## Context
The worker FRD was being grilled before its Week 2 build. Two items overrode earlier drafts.

**Process shape.** The repo layout listed a separate `worker/` package; the technical design said "same codebase as `api/`, separate process". The worker needs the API's database client, event tables, secret encryption and signing helper. A separate package would either turn the API into a library or force an early `packages/db` extraction.

**Auto-disable.** The draft proposed disabling an endpoint after N consecutive exhausted deliveries (N = 3), a count chosen so the behaviour could be shown during the hackathon. Industry practice is time-based: Stripe disables after 3 days without a successful response and warns by email first; Shopify removes after 48 hours of failed retries; Svix after 5 days; GitHub and Twilio never disable. William does not need to demo this failure.

## Decision
The worker is `api/src/worker/`, started as a second Bun process (`bun run worker`) from the same package, deployed as a second Railway service. `worker/` keeps a README pointing there. Retry delays for attempts 6 to 8 repeat 1 h (cap 8). An endpoint is disabled when every delivery to it has failed for 3 continuous days, measured from the first failure of the streak; any 2xx resets the streak; the dashboard bell warns at 24 h of failure and again on disable, with a Re-enable action. Delivery statuses are `queued | retrying | succeeded | exhausted | skipped`; a Resend adds an attempt row flagged `manual` and never changes the delivery's status. Week 2 ships delivery only; the keeper loop, heartbeat, expiry notices and CLI transport follow in Weeks 3 and 4 as separate FRs.

## Consequences
One codebase, one migration set, one test suite for API and worker; the repo layout table changes. Disabling is invisible at hackathon volume, which is intended; the 24 h warning is the merchant's signal. The API FRD's `deliveries` status list is corrected to match. Anything under `api/src/worker/` must import only from `api/src/db` and `api/src/lib`, never from `api/src/routes`, so the two processes stay separable later.
