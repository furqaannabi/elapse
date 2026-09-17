# Delete the hosted checkout now, and fix what depended on it in the same change
2026-09-17 · Decided by Furqaan · Status: accepted

## Context

ADR 2026-09-17 (React SDK replaces the hosted checkout), decision 8, set the order: build `@elapse/react`, move both examples onto it, and only then retire `/c/[session]` (checkout FR-CHK-040: "once `@elapse/react` is proven end to end in both examples"). The Elapse popup (`/authorize`), public-session CORS and `<Authorize>` are built. Furqaan decided not to wait: "delete checkout from fe and put meter to react sdk", then "fix breaking changes".

An inventory on 2026-09-17 found `/c/`, `url` or `manage_url` in: the checkout page and root, receipt and account receipt links, the landing's how-it-works demo links, the dashboard home, the checkout, account and dashboard mocks; the API's session `url`, `manage_url` and sample objects; `@elapse/sdk` event types; the CLI; both examples (server, boot, pages, tests, README); and the docs (Quickstart, Checkout, Subscriptions, SDKs pages, OpenAPI copy, payload snippets).

## Decision

Retire `/c/[session]` now rather than after the examples move. In the same body of work, fix everything that depended on it, so nothing is left pointing at a deleted page:

1. `/c/[session]` renders only the notice: "This checkout link is no longer used." with **Return to {merchant}**. The page-only code goes: `CheckoutPage` and its root, the meter, held and authorised views, and the demo seeds. Shared pieces the popup uses stay (frame, Face ID sheet, Add funds, receipt formatting).
2. `<Meter>`, controls and `<Receipt>` are built in `@elapse/react` (signed FR-RCT-020–023).
3. Both examples move to `@elapse/react` (signed FR-EXM-032, FR-EXM-152).
4. API drops `url` and `manage_url` points to `/account` (signed FR-API-140(a)/(b)); `@elapse/sdk` 0.2.0 (signed FR-SDK-043); the CLI and sample objects follow.
5. Web links to `/c/…` (landing demo, dashboard, receipts, account) are repointed to `/account` or removed; the docs pages, snippets and Quickstart move to the components (signed FR-DOC-047).

## Consequences

- Between the notice going live and the examples moving, the examples cannot take a subscriber; the work is sequenced to keep that window short, and nothing is deployed with dangling links.
- Supersedes the order in decision 8 of ADR 2026-09-17 React SDK and the condition in checkout FR-CHK-040. All other decisions in that record stand.
