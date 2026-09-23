# Merchant dashboard (`/dashboard/*`) — FRD

Status: **FR-DSH-144 (start mode is chosen in the drawer) Signed 2026-09-22 (William)** · **FR-DSH-023/090/091 amendments (an event nobody received says "Not sent") Signed 2026-09-22 (William)** · **Signed 2026-09-03 (William); FR-DSH-015/075 signed 2026-09-07 (William); FR-DSH-114–118 and the FR-DSH-103 amendment signed 2026-09-07 (William); FR-DSH-093 and the FR-DSH-023/090 amendments signed 2026-09-09 (William)** — approved after review; seventeen grill-me decisions recorded above. May be revisited. · Surface: Operate (merchant, desktop-first, reads on mobile) · Sources: design brief Surface 3; detailed doc §3, §5.2, §8, §12 Week 4; `api-frd.md`, `worker-frd.md`, `contracts-frd.md`; grill-me 2026-09-03.

## Problem

A merchant engineer has installed the SDK and wants to see the thing work: create a product, get a key, point a webhook at their server, watch a meter tick, and see the delivery land. Later the same person runs a business on it: revenue, customers, invoices, payout. Judges open it on a laptop during the video and on a phone afterwards. It must feel like Stripe's dashboard with one twist: the numbers move.

Scope note (2026-09-03): decisions 11–17 added the ledger, notifications, and activity log after the first ten. Everything in this spec is intended for 13 October except the off-ramp integration (decision 12, spec only). Build order is in Open; William cuts from the end of that list if the deadline bites.

## Decisions taken (grill-me, 2026-09-03)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Merchant sign-in | Email magic link. Passkey not offered for merchants in MVP. |
| 2 | Test / live | Toggle in the header, test mode default, every list scoped by mode. |
| 3 | Pages for 13 Oct | Core seven: Home, Products, Subscriptions, Customers, Invoices, Developers (keys, webhooks, deliveries, events), Settings (payout + branding). Team invites cut. |
| 4 | Payout model | No platform balance. `settle()` pays the merchant's payout address directly, minus a platform fee. Invoices page is the payout history. |
| 4b | Platform revenue | Percentage fee on every settlement, default 1 %, adjustable as a contract parameter by the platform owner. No fee on refunds. |
| 5 | Live data | Real state from the API, polled every 10 s; accrual ticks in the browser as `rate × (now − started_at)` between polls, reset from the server on every poll. No server push. |
| 6 | First run | Dashboard Home is a four-step checklist until the first successful delivery; every page also has an empty state. |
| 7 | Merchant actions on a meter | Cancel only, with confirmation; subscriber refunded exactly as if they cancelled. No merchant pause. |
| 8 | Mobile | Everything reads at 375 px as card stacks; forms are desktop-first and open in a full-screen sheet on mobile. |
| 9 | Key and secret rolling | Roll with a grace period the merchant picks: now, 1 h, 24 h. Old key shows "expires in …". Same for `whsec_`. |
| 10 | Dashboard ↔ API | Session cookie (HttpOnly, from the magic link) against a `/v1/dashboard/*` route group on the same Hono API. Never the merchant's `sk_` in the browser. Mock API until the backend exists. |
| 11 | Money-movement ledger | New "Balance & payouts" section with an immutable ledger: one row per deposit, settlement, fee, refund, from indexed contract events. Invoices stays the merchant-friendly settlements view. |
| 12 | Off-ramp | Spec only for 13 Oct. Balance & payouts shows the AUSD balance at the payout address and a "Withdraw to bank" button that opens a documented partner path; no integration built. |
| 13 | Merchant refunds | None in MVP. Subscribers only pay for elapsed seconds and unspent escrow returns on cancel; a merchant can send AUSD directly if they must. |
| 14 | Notifications | Email for webhook endpoint exhaustion and key expiry (on by default, settable). In-app bell in the top bar listing every kind including payment failures; notice bar on the affected page. |
| 15 | Audit log | Read-only "Activity" page under Settings from the API audit log, newest first, filter by action, CSV export. |
| 16 | Subscriber `/account` | Specced under the checkout FRD, built after the dashboard, first cut if the deadline bites. |
| 17 | Caps and trials | Escrow is the cap. No product-level spend caps or free seconds in MVP. |

## User stories

1. As a merchant engineer, I want to create a product and copy its Checkout URL in under a minute, so that the quickstart is real.
2. As a merchant engineer, I want my secret key shown once and rollable with a grace period, so that rotating never takes my server down.
3. As a merchant engineer, I want to add a webhook endpoint, send a test event, and read every delivery attempt with its signature and response, so that I can debug my handler without guessing.
4. As a merchant, I want to see every meter running right now with its live amount, so that the product proves itself on my own data.
5. As a merchant, I want to stop a meter I believe is abusive, so that I trust the product with real customers.
6. As a merchant, I want invoices with gross, fee, net, and a link to the settlement, so that I can reconcile payouts.
7. As a merchant, I want to set my payout address and brand the hosted checkout, so that subscribers see my name.
8. As a judge, I want to open the dashboard on a phone and read everything, so that the demo survives outside the video.
9. As a merchant's finance person, I want every movement of money in one immutable table with tx ids, so that I can audit a month without trusting a summary.
10. As a merchant, I want to know when a webhook endpoint has given up or a key is about to expire, without watching the dashboard, so that nothing breaks silently.
11. As a merchant, I want to see who changed a key, a secret, or the payout address and when, so that a security review takes minutes.

## Routes

| Route | Page |
| --- | --- |
| `/login` | Email entry, "check your inbox" state |
| `/login/verify?token=` | Consumes the magic link, sets the session cookie, redirects |
| `/dashboard` | Home (checklist or overview) |
| `/dashboard/products` | Products list; create/edit in a drawer |
| `/dashboard/subscriptions`, `/dashboard/subscriptions/[id]` | List and detail |
| `/dashboard/customers`, `/dashboard/customers/[id]` | List and detail |
| `/dashboard/invoices` | Settlement history |
| `/dashboard/balance` | Balance & payouts: AUSD balance at the payout address, withdraw path, ledger |
| `/dashboard/developers/keys` | API keys |
| `/dashboard/developers/webhooks`, `/dashboard/developers/webhooks/[id]` | Endpoints and endpoint detail with delivery log |
| `/dashboard/developers/events`, `/dashboard/developers/events/[id]` | Event log and payload |
| `/dashboard/settings` | Payout, branding, notifications, danger zone |
| `/dashboard/settings/activity` | Audit log (read-only) |

## Functional requirements

### Shell (design brief 3 "Shell")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-001 | Sidebar with Home, Products, Subscriptions, Customers, Invoices, Balance & payouts, Developers (Keys, Webhooks, Events), Settings. Active item marked by weight and a bar, not colour alone. Below `md` the sidebar becomes a bottom sheet opened from a menu button in the top bar. | Component test: nav renders the eight sections; active state matches the route. |
| FR-DSH-002 | Top bar: merchant name, Test/Live toggle, search field (ids and emails), notifications bell with unread count (FR-DSH-130), docs link, user menu (email, sign out). No business switcher (one merchant per account in MVP). | Render test. |
| FR-DSH-003 | Test/Live toggle: test mode default. Switching is immediate and remembered per browser. In test mode a slim amber banner reads "Test mode. Data here comes from the Monad testnet and test keys." Live mode shows no banner. **Amended 2026-09-13** ([ADR 2026-09-13 AUSD only](../decisions/2026-09-13-ausd-only-mockusd-to-test-fixture.md)): live mode shows the FR-DSH-143 banner instead of none. | Toggle test: mode persists across reload; banner present only in test. |
| FR-DSH-004 | Every list, detail, count, and stat is scoped by the current mode; switching mode re-fetches everything. An id from the other mode returns a "not found in test mode / switch to live" state. | Mock has data in both modes; assertions per page. |
| FR-DSH-005 | Search shows results as you type ([ADR 2026-09-09 search as you type](../decisions/2026-09-09-dashboard-search-as-you-type.md), William). After two characters and a 200 ms pause the box asks FR-API-135 and lists up to five matches under the input: type word, id, and one line of context (email, product name, event type, or endpoint host). Arrow keys move, Enter opens the highlighted match, Esc closes, click opens. Enter with no list open resolves the query as before (a full id or an email opens the detail). No match: "No match in test mode" inline, no toast. Scoped to the current mode; never shows a key or secret. | Two characters trigger one request after the debounce; five rows render with list roles; keyboard path opens a row; empty state; the pre-list Enter path per prefix. |
| FR-DSH-006 | Loading skeleton, error state with retry, and empty state with a CTA exist on every page. Errors name the problem in plain words; no stack traces or status codes in copy. | One test per page per state. |
| FR-DSH-007 | Polling: list and detail pages re-fetch every 10 s while the tab is visible; stop when hidden; resume on focus. A fetch that fails keeps the last good data and shows a quiet "Reconnecting…" line. | Hook test with fake timers and `visibilitychange`. |
| FR-DSH-008 | Light and dark, reduced motion honoured. Motion is limited to drawer/sheet transitions, toasts, and meter start/stop; nothing pulses per second. | As landing. |
| FR-DSH-009 | Mobile: every table renders as a card stack below `md`; no horizontal scroll anywhere; touch targets ≥ 44 px. Forms open as full-screen sheets below `md`, centred dialogs or side drawers above. | Screenshot review at 375 and 1440 for every page. |

### Auth and first run (design brief 3.1, 3.2; decisions 1, 6, 10)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-010 | `/login` takes an email, posts to `POST /v1/dashboard/auth/magic_link`, shows "Check your inbox" with the address and a resend link (rate-limited to once per 30 s). Unknown emails create a merchant on first verify. | Form test; resend disabled for 30 s. |
| FR-DSH-011 | `/login/verify?token=` exchanges the token for an HttpOnly session cookie and redirects to `/dashboard`. Expired or used tokens show "This link has expired" with a button back to `/login`. Tokens are single-use and expire in 15 min. | Mock API: valid, expired, used token states. |
| FR-DSH-012 | Every `/dashboard/*` route requires the session; without it, redirect to `/login?next=`. The session is never readable from JavaScript. **Amended 2026-09-23 (built within the signed decision):** the loading frame depends on whether this browser has held a session before. The session cookie is the API host's, so the web origin cannot read it and cannot know before asking `me()` — and rendering the shell while it asks showed a signed-out visitor who followed the landing page's Dashboard link a dashboard they do not have. A returning merchant still gets the shell at once; anyone else gets the wordmark alone until the answer lands. What is remembered is a boolean, set on a successful `me()` and cleared on sign-out and on any 401 — never a token (BR-DSH-003). | Route guard test. **Amended:** with no remembered session, no banner and no section links render before the redirect; a successful load sets the flag and signing out clears it. |
| FR-DSH-013 | First-run capture on the first dashboard visit: business name (required) and payout address (optional, can be set later in Settings, with the helper "This is where settled funds arrive"). One screen, not a wizard. | Form test; skipping payout is allowed. |
| FR-DSH-015 | Payout banner ([ADR 2026-09-07 payout gate](../decisions/2026-09-07-payout-address-gates-checkout-and-live-keys.md)): while the merchant has no payout address, every `/dashboard/*` page shows one persistent banner under the header, "Set a payout address to create checkout links and go live", with a Settings link. It disappears the moment the address is saved. "Copy Checkout URL" (FR-DSH-032) and the Developers page's live-key actions show the API's `no_payout_address` sentence as their error. | Render test with and without the address; banner gone after save. |
| FR-DSH-014 | Sign out clears the cookie and returns to `/login`. | Test. |

### Home (design brief 3.3; decision 6)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-020 | Until the merchant has, in the current mode, ≥ 1 product, ≥ 1 secret key, ≥ 1 webhook endpoint, and ≥ 1 succeeded delivery, Home shows the four-step checklist. Each step links to its page and ticks itself from real data. Step 4 shows a copyable `curl`/SDK snippet that creates a checkout session. | Mock states: 0/4 … 4/4; checklist disappears at 4/4. |
| FR-DSH-021 | Overview (after the checklist): stat tiles for meters running now, accrued today, settled this week (net of fee), and failed payments this week. Numbers use tabular numerals; period labels are explicit. | Snapshot with mock data; tiles reflect mode. |
| FR-DSH-022 | "Running now" list: up to 10 active subscriptions with product, customer, and an inline `Readout` (tiny) ticking from `rate × (now − started_at)`; link to the subscription. | Uses `useMeter`; values match `accruedNano`. |
| FR-DSH-023 | Recent events: last 10 events with type, object id, the FR-DSH-093 context line (amount dropped, truncated to one line), time, and delivery state (pending / delivered / failed / **not sent**, amended 2026-09-22 for FR-API-146, signed 2026-09-22 (William): "Not sent" in the same muted treatment as Delivered, never the destructive one — nothing failed, and a merchant who has not configured an endpoint yet is not in error); links to the event. | Render test; context line truncates and carries no amount. |

### Products (design brief 3.4)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-030 | Table: name, rate per second, ≈ per hour, active subscriptions, status (Active / Archived). Filter by status. Archived hidden by default. | Table renders; filter toggles. |
| FR-DSH-031 | Create/edit drawer: name, rate per second (decimal string; per-minute and per-hour computed live from `perMinute`/`perHour`), description, allow pause (default off), status. **Amended 2026-09-22** (FR-DSH-144): the create drawer also chooses the start mode. Rate is validated as a positive decimal with ≤ 9 fraction digits; never parsed as a float. | Validation tests; "0.004" shows "$0.24 / min · $14.40 / hour". |
| FR-DSH-032 | Each product row and its drawer expose "Copy Checkout URL", which creates a test checkout session via the API and copies `session.url`. In live mode the button is present but asks for confirmation ("This creates a real checkout link"). | Mock call asserted; toast "Copied". |
| FR-DSH-033 | Archive with confirmation. An archived product cannot start new subscriptions; running ones continue. Unarchive allowed. | State test; checkout for an archived product shows FR-CHK-010's archived state. |

### Subscriptions (design brief 3.6; decisions 5, 7)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-040 | Table: status chip (word: Incomplete / Active / Paused / Canceled), product, customer, elapsed and accrued (live for Active, frozen for Paused, final for Canceled), started. Filters by status and product; sort by started. | Table test; live rows tick. |
| FR-DSH-041 | Detail: `Readout` (panel size) with the live amount, rate reminder, funded / settled / remaining runtime, customer link, checkout session id, and a timeline of lifecycle events (`subscription.created`, `invoice.settled`, `subscription.updated`, `subscription.canceled`) with times. | Renders from mock; timeline order test. |
| FR-DSH-042 | Settlements list on the detail: every invoice for this subscription with seconds, gross, fee, net, and a short tx id linking to the explorer. | Render test. |
| FR-DSH-043 | Cancel from the detail: confirmation dialog states what will happen ("The meter stops now. The subscriber is charged N seconds so far and refunded the rest.") with the live figures. Confirm calls `POST /v1/dashboard/subscriptions/:id/cancel`; the row shows Canceled within the next poll. No merchant pause or resume. | Dialog copy test; mock call; status flips. |
| FR-DSH-044 | Copy id on every subscription, product, customer, event, and delivery row. | Toast "Copied". |

### Customers (design brief 3.5)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-050 | Table: email (or "Passkey user" when none), subscriptions count, total settled, created. Search by email. | Table test. |
| FR-DSH-051 | Detail: subscriptions for this customer with status and accrued/settled, and their events. No wallet address is shown outside the chain detail line (BR-DSH-005). | Render test. |

### Invoices (design brief 3.7; decision 4)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-060 | Table: settled at, subscription, customer, seconds, gross, fee, net, short tx id with external link. Filter by date range and subscription. Totals row for the filtered range. | Table test; totals equal the sum of rows. |
| FR-DSH-061 | The page header explains the payout model in one line: "Settled funds go straight to your payout address. Elapse keeps 1 %." with a link to Balance & payouts. The fee rate is read from the API, never hard-coded in copy. | Copy renders the mock's fee rate. |
| FR-DSH-062 | Export CSV of the filtered rows (client-side, same columns). | File contents test. |

### Developers → API keys (design brief 3.8; decision 9)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-070 | Publishable key for the current mode shown in full with Copy. Secret keys table: name, prefix + last 4, created, last used, status (Active / Expires in … / Revoked). | Render test. |
| FR-DSH-071 | Create secret key: name → reveal-once dialog with the full key, Copy, and "I have saved it" to close. After closing, the key is never displayed again. | Dialog test; list shows `sk_test_…abcd` only. |
| FR-DSH-072 | Roll: choose "Expire the old key now / in 1 hour / in 24 hours" → new key revealed once; old key row shows "Expires in 23 h 59 m". | State test with fake timers. |
| FR-DSH-073 | Revoke with confirmation naming the key; the row shows Revoked and stays for the audit trail. | Test. |
| FR-DSH-074 | Test keys and live keys are separate lists, selected by the mode toggle. | Mode switch test. |
| FR-DSH-075 | Live keys gated ([ADR 2026-09-07 payout gate](../decisions/2026-09-07-payout-address-gates-checkout-and-live-keys.md)): in live mode without a payout address, the Developers page replaces the publishable key and the Create secret key button with one sentence, "Set a payout address before going live", linking to Settings. Test mode is unchanged. | Mode switch test without the address. |

### Developers → Webhooks and deliveries (design brief 3.9; worker FRD FR-WRK-030–041)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-080 | Endpoints table: URL, subscribed events (count or "All"), status (Enabled / Disabled), success rate over the last 7 days. | Render test. |
| FR-DSH-081 | Add endpoint: URL (https required outside localhost), event picker from the catalog or "All events" → reveal-once dialog with `whsec_`. | Validation; dialog test. |
| FR-DSH-082 | Endpoint detail: edit URL and events, enable/disable, roll signing secret with the same grace choices as keys (old secret honoured until expiry; worker signs with both, FR-WRK-040), "Send test event" with a type picker. | Mock calls asserted. |
| FR-DSH-083 | Delivery log on the endpoint detail: event type, event id, status (Pending / Succeeded / Failed / Exhausted / Skipped), attempt n / 8, last response code, time. Filter by status. | Table test. |
| FR-DSH-084 | Delivery row drawer: request headers including `X-Elapse-Signature`, request body (JSON viewer), response status and body (truncated at 4 KB with "show all"), every attempt with its time and result, and a Resend button. Resend creates a fresh manual attempt (FR-WRK-030) and the drawer updates on the next poll. | Drawer test; resend mock call. |
| FR-DSH-085 | A disabled endpoint shows a notice on its detail and its deliveries show Skipped; re-enabling does not replay them (FR-WRK-032). | State test. |

### Developers → Events (design brief 3.10)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-090 | Event log: type, object id, the FR-DSH-093 context line, created, pending-webhooks count. Filter by type (catalog) and date. **Amended 2026-09-22 (signed 2026-09-22, William; FR-API-146):** the delivery state reads "Not sent" for `not_sent`, muted. This is the page a merchant opens when a webhook did not arrive, and until now it told them every one of those events was delivered. | Table test; context line present; a `not_sent` event reads "Not sent" and is not styled as a failure. |
| FR-DSH-091 | Event detail: full payload in a JSON viewer with Copy, and the deliveries this event produced with links to their endpoints. **Amended 2026-09-22 (signed 2026-09-22, William; FR-API-146):** a `not_sent` event carries one sentence under its state — "No endpoint was listening when this event was created." — and the actionable half: check Developers → Webhooks, and if you forward with `elapse listen`, that it was running. The sentence is fixed rather than inferred from the merchant's endpoints today: a diagnostic that changes its story once you fix the problem is worse than none, and this one reads true whether the merchant has no endpoint, a disabled one, or a CLI that was not connected. | Render test: the sentence appears for `not_sent` and for no other state; the deliveries list is empty rather than absent. |
| FR-DSH-093 | **Event context line** (William, 2026-09-09): every event row on the home feed (FR-DSH-023), the event log (FR-DSH-090) and the event detail under its title (FR-DSH-091) shows one line from the API's dashboard-only `context` field (FR-API-136): product name · customer email, or the customer's short `cus_` id when it has no email; invoice events append ` · $amount_settled` (what the customer paid, matching the receipt copy). The home feed drops the amount and truncates to one line with an ellipsis; the log and the detail show the full line. When `context` is null (product deleted, unresolvable object) the row renders exactly as before, id only. No product filter on events; filtering by product stays on Subscriptions (FR-DSH-040). | Mock rows render all three shapes (email, no-email id, invoice with amount); home feed truncates and omits the amount; detail shows the line; null context renders the id alone. |

### Settings (design brief 3.11; decisions 3, 4)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-100 | Business profile: name, support email, support URL. | Form test. |
| FR-DSH-101 | Payout address: shown shortened with Copy; change requires re-typing the new address and confirming; a change writes the audit log and takes effect for the next settlement. Helper: "Settled funds arrive here automatically. Elapse never holds your balance." | Form test; confirm copy. |
| FR-DSH-102 | Fee: read-only line "Platform fee: 1 % of every settlement" from the API, with "Contact us for volume pricing". | Renders mock fee. |
| FR-DSH-103 | Checkout branding: display name, logo upload (PNG/SVG ≤ 200 KB), accent colour, support URL, with a live preview that renders the real `CheckoutFrame` at 390 px. Layout and copy of the checkout are not editable. | Preview updates on change; accent contrast warning below 3:1 against paper. | **Amended 2026-09-07 ([ADR 2026-09-07 forms hardening](../decisions/2026-09-07-forms-hardening-logo-png-revoke-confirm.md)):** logo is PNG only, ≤ 50 KB, checked client-side by signature bytes before upload; the preview shows the file only once the upload succeeded; a Remove control clears it (FR-API-104).
| FR-DSH-105 | Notifications block: two email switches, "Webhook endpoint stopped retrying" and "API key or signing secret about to expire", on by default; recipient is the account email. | Form test; mock call on toggle. |
| FR-DSH-104 | Danger zone: delete test data (confirm by typing the business name). No account deletion in MVP; a mailto for that. | Confirm test. |

### Balance & payouts (decisions 4, 11, 12)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-120 | Header: AUSD balance at the payout address shown as USD (read from chain via the API, refreshed with the poll), the shortened address with Copy and explorer link, and "Settled this month, net". If no payout address is set, the header is an empty state linking to Settings. | Renders mock balance; empty state without address. |
| FR-DSH-121 | "Withdraw to bank" button opens a sheet that explains the funds are already the merchant's, names the documented off-ramp path (docs page), and has no integration behind it for 13 Oct. Copy never says "coming soon"; it says what to do today. | Sheet copy test. Spec-only integration. |
| FR-DSH-122 | Ledger table: one row per money movement from contract events. Kind (Deposit / Settlement / Fee / Refund), amount (signed from the merchant's view: settlement positive, fee negative, deposit and refund informational), subscription, customer, tx id with explorer link, block time. Newest first. | Table test; four kinds seeded. |
| FR-DSH-123 | Filters by kind, subscription, and date range; running totals for the filtered range per kind; CSV export with the same columns. | Totals equal sum of rows; CSV test. |
| FR-DSH-124 | The ledger is append-only in the UI: no edit, delete, or hide. A row that the indexer later re-orgs is marked "Reversed" with a link to the replacing row, never removed. | State test with a reversed fixture. |
| FR-DSH-125 | Every Invoice row links to its Settlement and Fee ledger rows, and every ledger Settlement row links back to its Invoice. | Link test. |
| FR-DSH-126 | **Every list pages** (judge pass 2026-09-09): products, subscriptions, customers, invoices, events, deliveries and the ledger fetch 50 rows a page with the API's `starting_after` cursor (FR-API-080/107). A **Load more** button under the table (card stack below `md`) appends the next page in place, keeping scroll position; beside it "50 shown · more available" while `has_more`, and the button disappears when the last page arrives. Totals rows (FR-DSH-060/123) and CSV export (FR-DSH-062) cover the loaded rows and say so, "of 50 shown", while more exist; a full-range export is a follow-up. Polling (FR-DSH-007) re-fetches only the first page and merges by id at the top, so loaded pages stay and nothing jumps. Filters and mode switches reset to page one. | Mock with 120 rows: first render shows 50 and the label; Load more → 100; third → 120 and no button; polling after Load more keeps 100 rows; totals label present while `has_more`; export row count equals rows shown. |

### Notifications (decision 14)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-130 | Bell in the top bar with an unread count; opens a list of notifications newest first: kind, one-line summary, time, link to the object. Kinds: endpoint exhausted, key expiring (24 h and 1 h before), secret expiring, payment failed, first delivery succeeded. "Mark all read". | List renders mock kinds; count clears. |
| FR-DSH-131 | Notice bar on the affected page while the condition holds: a disabled or exhausted endpoint on Webhooks, an expiring key on Keys, a paused-for-funds subscription on its detail. Dismissable per session; returns on the next visit if unresolved. | Per-page test. |
| FR-DSH-132 | Email is sent by the API for endpoint exhaustion and key/secret expiry only, per FR-DSH-105; the dashboard shows "Emailed you at hh:mm" on the corresponding notification. | Mock flag rendered. |
| FR-DSH-133 | Notifications are scoped by mode like everything else; the bell count is for the current mode and the list has a "N in live mode" line when the other mode has unread items. | Mode test. |

### Activity (decision 15)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-140 | Read-only audit table under Settings: time, actor (email), action (key created / rolled / revoked, secret revealed / rolled, endpoint added / changed / disabled, payout address changed, delivery resent, test data deleted, sign-in), target id, IP. Newest first. | Table test. |
| FR-DSH-141 | Filter by action and date range; CSV export. | Test. |
| FR-DSH-142 | Never shows secret values, only the key or endpoint id and last 4. | Render test asserts no `sk_`/`whsec_` beyond the prefix. |
| FR-DSH-143 | **Live-mode mainnet banner** ([ADR 2026-09-13 AUSD only](../decisions/2026-09-13-ausd-only-mockusd-to-test-fixture.md)): in live mode, the slot the test banner uses (FR-DSH-003) shows a slim banner reading "Live mode settles real AUSD. Until mainnet launch it runs on Monad testnet; at launch it moves to mainnet AUSD with no integration change." Not dismissible; present on every dashboard page while the mode is live **and the platform's live chain is not 143** (read from the profile/status payload, never hardcoded); it disappears with the mainnet record, no copy change needed. Merchant vocabulary — this is the merchant surface, so naming the chain is allowed and deliberate. | Component test: live mode + live chain 10143 → banner; live chain 143 → none; test mode → the FR-DSH-003 test banner, never both. |
| FR-DSH-144 | **Start mode is chosen in the drawer, not only over the API.** `products.create` has always accepted `start_mode`, but the drawer never sent it, so every product created in the dashboard was `checkout` and a merchant-start product could be made only with a secret key — the gap that stopped `examples/lambda`'s product being created in the UI. On **create**, two radio cards in the bordered treatment the Allow pause row already uses: **At checkout** (default) — "The meter starts the moment the subscriber authorises." — and **When your code starts it** — "The meter waits for `subscriptions.start`. A session you never start refunds in full after 15 minutes." The behaviour is in the label; `checkout` and `merchant` stay API words and never appear on the surface. The second card names the method because the merchant must call it, and names the refund (FR-API-127 / FR-WRK-075, `min(max_duration_seconds, 15 min)`) because that is what a forgotten start costs the subscriber. On **edit** the mode is read-only and carries the rate's pointer — "To change this, create a new product" — because `UpdateProduct` does not accept `start_mode` and the server would ignore it. The products list gains **no column**: a merchant-start product shows one quiet line under its name, "Starts when your code starts it", since `checkout` is the default and only the exception is worth seeing at a glance. | Component tests: an untouched create submits `checkout`; choosing the second card submits `merchant`; edit renders no control, the read-only line and the pointer; a merchant-start row shows the line and a checkout row does not. Client tests: `createProduct` sends `start_mode`, the product mapper carries it back, and the mock stores and returns it. |

### Data and mock (decision 10)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-DSH-110 | Until the API exists, the dashboard runs against an in-memory mock behind a `DashboardApi` interface with the same shapes as `/v1/dashboard/*`, seeded for both modes with a merchant at every checklist stage, products, ~30 subscriptions across all statuses, invoices, endpoints with succeeded/failed/exhausted deliveries, events, a ledger with all four kinds and one reversed row, notifications of every kind, and an activity log. Swapping to the real API is one line in `src/lib/dashboard/client.ts`. | Every page is reachable with mock data; `pnpm test` covers the mock's state transitions. |
| FR-DSH-111 | A typed client in `src/lib/api/` mirrors the route group; components never hard-code paths. | Lint rule / grep test: no `/v1/` literals in `components/`. |
| FR-DSH-112 | Every mutating call from the dashboard (create product, create/roll/revoke key, add/change endpoint, roll secret, send test event, resend, cancel meter, create checkout link, change payout address, delete test data) sends an `Idempotency-Key` generated once per user action and reused on automatic retry. A submit button is disabled while its request is in flight. A retry after a timeout therefore replays the same result instead of creating a second product, key, or checkout link (API FR-API-081). The mock honours the header. | Test: double submit and timeout-retry produce one object; mock returns the stored response for a repeated key. |
| FR-DSH-113 | Reads are naturally idempotent; the poll (FR-DSH-007) reconciles by object id, so a list never shows duplicates when a poll overlaps a mutation. Ledger, events, and deliveries key on their ids; the ingest side dedupes on `txHash + logIndex` (API FR-API-070), so a re-org or a re-run indexer never double-counts a movement. | Poll test: overlapping responses merge by id. |
| FR-DSH-114 | Shared field rules ([ADR 2026-09-07 forms hardening](../decisions/2026-09-07-forms-hardening-logo-png-revoke-confirm.md)): one module in `src/lib/forms/` holds every rule the API enforces (business name 1–80, key name 1–100, product name 1–200, description ≤ 1000, rate `^\d+(\.\d+)?$` with ≤ 6 decimals and > 0, address `^0x[0-9a-fA-F]{40}$`, email ≤ 254 with one `@` and a dot after it, URL `http(s)` ≤ 2048, accent `#rrggbb`, endpoint URL `http(s)` ≤ 2048, cap 60 s–30 d). Every input carries the matching `maxLength`, `inputMode`, `autoComplete` and `pattern` where one exists; values are trimmed before validation and before send; every form is `noValidate` and disables submit until valid, with the rule shown as a hint next to the field, never only as a dead button. | Unit test per rule; each form's test asserts the disabled state on an invalid value and the enabled state on a valid one. |
| FR-DSH-115 | Server rejections land on the field ([ADR 2026-09-07 forms hardening](../decisions/2026-09-07-forms-hardening-logo-png-revoke-confirm.md)): the API client keeps `error.param` (FR-API-082) and each form maps it to its input (`aria-invalid`, `role="alert"` text under the field); only a rejection without `param` falls back to the toast. The message shown is the form's own copy for that rule, not the API's developer string. | Form test with a mocked 400 carrying `param`: the text appears under that input and no toast fires. |
| FR-DSH-116 | Product rate on edit ([ADR 2026-09-07 forms hardening](../decisions/2026-09-07-forms-hardening-logo-png-revoke-confirm.md), FR-API-011): the drawer shows the rate read-only when editing, with "To change the rate, create a new product." Create still validates the rate live and blocks submit on an empty name or an invalid rate. | Drawer test: edit mode renders the rate as text with the line; create mode disables Save on `abc` and on `0.0000001`. |
| FR-DSH-117 | Revoke a live key by typing its name ([ADR 2026-09-07 forms hardening](../decisions/2026-09-07-forms-hardening-logo-png-revoke-confirm.md)): the revoke dialog in live mode has a field "Type the key's name to confirm" and enables Revoke only on an exact match; test mode keeps the single confirm. | Dialog test in both modes. |
| FR-DSH-118 | Search is encoded ([ADR 2026-09-07 forms hardening](../decisions/2026-09-07-forms-hardening-logo-png-revoke-confirm.md)): the typed query is URL-encoded before it enters a request path or the router; a query with `/`, `?`, `#` or whitespace inside an id resolves to "No match" rather than a rewritten request. | Client test: `sub_x/../me` → `GET /v1/subscriptions/sub_x%2F..%2Fme`. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-DSH-001 | Secrets (`sk_`, `whsec_`) are shown once; the UI never stores, logs, or re-displays them. Reveal dialogs are not screenshot-proof, so copy says "Store it now". |
| BR-DSH-002 | Test and live data never mix; the mode is always visible; every request carries the mode. |
| BR-DSH-003 | Status is carried by a word in a chip, never colour alone. Red (`--destructive`) is used only for Revoke, Cancel meter, Delete test data, and Failed/Exhausted chips. |
| BR-DSH-004 | Tables become card stacks below `md`; never horizontal scroll. |
| BR-DSH-005 | Chain detail on the merchant side is understated: a short tx id with an external explorer link on invoices and settlements, chain name in the test-mode banner. No addresses, gas, or raw tx data anywhere else. No separate judge mode on the dashboard. |
| BR-DSH-006 | The merchant's secret key never enters the browser; the dashboard authenticates with the session cookie only. |
| BR-DSH-007 | All money is displayed from decimal strings via the meter math (`formatUsd`); live accrual is `accruedNano`; nothing shown ever exceeds what the contract would settle plus the current fractional second. |
| BR-DSH-008 | Merchant cancel uses the same contract path as subscriber cancel: settle whole seconds, refund the rest. The dashboard never triggers a charge beyond what elapsed. |
| BR-DSH-009 | Fee is shown as a separate column everywhere money is listed; net is what the merchant received. Copy never hides the fee. |
| BR-DSH-010 | Every destructive action (revoke, roll-now, cancel meter, archive, delete test data, change payout address) has a confirmation naming the object and the consequence. |
| BR-DSH-011 | The ledger and the activity log are append-only and derived from the chain and the API audit table respectively; the dashboard has no write path to either. |
| BR-DSH-012 | Elapse never holds merchant funds. No page shows an "Elapse balance" for the merchant; the only balance is what sits at the merchant's own payout address. |
| BR-DSH-013 | The dashboard never says "coming soon". The off-ramp sheet describes what a merchant can do today. |
| BR-DSH-014 | No dashboard action can create a duplicate money-relevant object (key, endpoint, checkout link, cancel, resend) through a double click, a retry, or a slow network. |

## Data (mocked until the API exists)

```
Merchant        { id: mrc_…, name, email, supportEmail?, supportUrl?, payoutAddress?, feeBps: 100,
                  branding: { name, logoUrl?, accent?, supportUrl? }, livemode }
ApiKey          { id: key_…, livemode, kind: "pk"|"sk", name, prefix, last4, createdAt, lastUsedAt?, revokedAt?, expiresAt? }
Product         { id: prod_…, livemode, name, description?, rateUsdPerSecond, allowPause, status, activeSubscriptions }
Customer        { id: cus_…, livemode, email?, createdAt, totalSettledUsd }
Subscription    { id: sub_…, livemode, status, product, customer, rateUsdPerSecond, startedAt, pausedAt, canceledAt,
                  pauseReason?, fundedUsd, settledUsd, checkoutSession, txId? }
Invoice         { id: inv_…, livemode, subscription, customer, settledAt, seconds, grossUsd, feeUsd, netUsd, txId }
WebhookEndpoint { id: wh_…, livemode, url, events: string[] | "*", disabled, successRate7d, previousSecretExpiresAt? }
Event           { id: evt_…, livemode, type, objectId, createdAt, pendingWebhooks, payload }
Delivery        { id: dlv_…, event, endpoint, status, attempt, maxAttempts: 8, lastResponseCode?, attempts: Attempt[] }
Attempt         { at, manual, requestHeaders, requestBody, responseCode?, responseBody?, error? }
ChecklistState  { hasProduct, hasSecretKey, hasEndpoint, hasSucceededDelivery }
LedgerEntry     { id: led_…, livemode, kind: "deposit"|"settlement"|"fee"|"refund", amountUsd, subscription, customer,
                  txId, blockTime, reversedBy?, invoice? }
Balance         { payoutAddress?, ausdUsd, settledThisMonthNetUsd, asOf }
Notification    { id: ntf_…, livemode, kind, summary, objectId, createdAt, readAt?, emailedAt? }
AuditEntry      { id: aud_…, at, actor, action, target, ip }
```

## Dependencies on other specs

| Spec | Change needed | Owner |
| --- | --- | --- |
| `contracts-frd.md` | Decision 4b: `settle()` and cancel pay `amount − fee` to `merchant` and `fee` to a platform treasury address; `feeBps` set by the factory owner, default 100; `Settled` event carries `fee`. This conflicts with BR-CON-006 ("money leaves a stream only to merchant or subscriber") and changes FR-CON-030 and the invariant FR-CON-072. William signs as builder; Furqaan reviews on arrival. | William (Furqaan reviews) |
| `api-frd.md` | Add the `/v1/dashboard/*` route group with cookie auth (magic link endpoints, checklist, stats, cancel, roll with grace choice, fee rate, branding upload, ledger, balance read, notifications + email sends, activity log). Roll grace becomes merchant-chosen (0 / 1 h / 24 h) instead of a fixed window (Undecided 5). Invoice object gains `gross/fee/net`. FR-API-043 pause/resume routes stay but the dashboard does not call them. | William |
| `worker-frd.md` | Secret overlap window becomes the merchant's choice per roll (Undecided 2). | William |
| `sdk-frd.md` | Multi-`v1=` verification (FR-WRK-041) must land before roll-with-grace is demoed. | William (Furqaan reviews) |
| `indexer-frd.md` | Ledger needs `Deposited`, `Settled` (with fee), `StreamCanceled` refund amounts ingested as ledger rows; re-org handling marks rows reversed. | William |
| `checkout-frd.md` | Add Surface 4 `/account` (decision 16) as FR-CHK-016+: passkey sign-in, subscriptions across merchants, receipts, Cancel. Built after the dashboard. | William |

## Grill-me questions (settled 2026-09-03)

1. Merchant sign-in: magic link / passkey / both. **Magic link.**
2. Test vs live: header toggle now / test-only until Week 5 / separate accounts. **Header toggle, test default.**
3. Pages for 13 Oct: core seven / demo path only / all nine. **Core seven.**
4. Payout: direct on settle / platform balance with withdraw / direct now, balance later. **Direct on settle.** Follow-up on platform revenue: **percentage fee, default 1 %, adjustable.**
5. Live data: tick + 10 s poll / server push / static with refresh. **Tick + poll.**
6. First run: Home checklist / wizard / empty states only. **Home checklist.**
7. Merchant actions on a meter: cancel only / cancel + pause / read-only. **Cancel only.**
8. Mobile: reads everywhere, forms desktop-first / full parity / desktop only. **Reads everywhere.**
9. Key roll: grace period chosen per roll / immediate / unlimited keys. **Grace period.**
10. Dashboard ↔ API: cookie on a Hono route group / Next.js proxy / separate backend. **Cookie on Hono.**

Second round ("we missed something"):

11. Ledger: own page / fold into Invoices / export only. **Own page under Balance & payouts.**
12. Off-ramp: spec only with a documented path / integrate a partner / say nothing. **Spec only.**
13. Merchant refunds: from payout address / through Elapse / none. **None in MVP**; per-second billing removes the usual reason.
14. Notifications: email for exhaustion + expiry with in-app notice / email everything / in-app only. **Email for two kinds, plus a bell.**
15. Audit log: Activity page under Settings / merge with ledger / API only. **Activity page.**
16. Subscriber `/account`: spec now, build after dashboard / build before dashboard / not before 13 Oct. **Spec now, build after.**
17. Caps and trials: escrow is the cap / free seconds / merchant cap. **Escrow is the cap.**

## Open

- Magic-link email delivery provider (Resend, Postmark) is an API decision; the dashboard only needs the two endpoints.
- Logo upload storage (API-side) for FR-DSH-103; the mock keeps a data URL.
- Explorer base URL per chain for the tx links (technical design §6).
- Off-ramp partner choice and the docs page the withdraw sheet links to.
- Email provider for magic links and notifications (one provider for both).
- Build order within the dashboard, for William to set: shell + auth → Developers (keys, webhooks, deliveries, events) → Products → Home → Subscriptions → Invoices → Balance & payouts (ledger) → Settings (incl. Activity) → Notifications → Customers → subscriber `/account`. Cut from the end.

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief (outline). |
| 2026-09-03 | Claude (for William) | Full FRD from the ten grill-me answers; FR-DSH-001–111, BR-DSH-001–010, dependencies on contracts/API/worker/SDK specs. Awaiting signature. |
| 2026-09-03 | Claude (for William) | Second grill round (decisions 11–17): Balance & payouts with ledger (FR-DSH-120–125), notifications (FR-DSH-130–133), Activity (FR-DSH-140–142), FR-DSH-105, idempotency FR-DSH-112–113, BR-DSH-011–014, indexer and checkout dependencies, build order. |
| 2026-09-03 | William | Reviewed and signed ("I approve the spec"). |
| 2026-09-04 | Claude (for William) | Built on `feat/web-dashboard` against `createMockDashboardApi`: sign-in, first run, shell, Home, Products, Subscriptions, Customers, Invoices, Balance & payouts, Developers (keys, webhooks, events), Settings, Activity, notifications, search. Structure roll 1fb0c5d3 chose split list + detail; two finish-review rounds. Off-ramp is spec-only as decided (FR-DSH-121). |
| 2026-09-04 | Claude (for William) | Decisions recorded as ADRs: [settlement fee](../decisions/2026-09-03-settlement-fee.md) (decision 4b) and [dashboard scope](../decisions/2026-09-03-dashboard-scope.md) (decisions 1–17). No requirement changed. |
| 2026-09-06 | Claude (for William) | **Wired to the real API, slice 1** (`web/src/lib/dashboard/real-api.ts` behind the unchanged `DashboardApi`; `NEXT_PUBLIC_ELAPSE_API_URL` selects it, `NEXT_PUBLIC_DASHBOARD_MOCK=1` forces the mock): sign-in by magic link (dev token shown on the page when mail is stdout-only), first-run capture, home checklist, Keys (FR-DSH-070..074), Webhooks and deliveries (FR-DSH-080..085), Events (FR-DSH-090..092), profile and notification switches. Proven headless: sign-in → first run → key revealed once → endpoint with `whsec_` once → test event delivered to a local receiver with a valid signature → delivery row. Pages whose routes do not exist yet (overview, products, subscriptions, customers, invoices, ledger, balance, notifications, activity, search) throw `NotWired` and show the FR-DSH-006 error state. Next slices in the build order: Products → Home overview → Subscriptions → Invoices → Balance → Settings/Activity → Notifications → Customers. |
| 2026-09-06 | Claude (for William) | Slice 2: Products (FR-DSH-030..033) on the real API. `active_subscriptions` added to the product object; archived products filtered client-side; "Copy Checkout URL" creates a real session whose success and cancel URLs are the dashboard's own Subscriptions and Products pages. Proven headless: create product → copy link → a real `/c/cs_…` URL. Dashboard CORS precedence fixed for the shared dev origin. |
| 2026-09-06 | Claude (for William) | Slice 3: Home overview (FR-DSH-021..023) via `GET /v1/dashboard/overview` (tiles: running now, accrued since midnight UTC for active meters, settled net this week by `period_end`, failed this week; ten running meters; ten recent events); Subscriptions list/detail/cancel (FR-DSH-040..044: detail joins events by object id and invoices by subscription; cancel submits then polls to `canceled` and builds the receipt from the chain's totals); Invoices list (FR-DSH-060, paid only). Subscription object gains `product_name`/`customer_email`. Verified headless on William's real run. Remaining `NotWired`: ledger, balance, notifications, activity, customers, search, delete test data, payout change. |
| 2026-09-06 | Claude (for William) | Slice 4: the rest of the dashboard on the real API — Customers (FR-DSH-050/051), Balance & payouts with the ledger and CSV (FR-DSH-120..124), payout address change (FR-DSH-101), Settings profile/branding/notification switches, Notifications (FR-DSH-130..132), Activity (FR-DSH-140), search (FR-DSH-005), delete test data (FR-DSH-105). No `NotWired` methods remain. Verified headless on William's merchant: balance reads the payout address's token balance from the chain ($0.52668 = his 133 s net of fee). |
| 2026-09-07 | Claude (for William) | FR-DSH-015 payout banner and FR-DSH-075 live keys gated ([ADR 2026-09-07 payout gate](../decisions/2026-09-07-payout-address-gates-checkout-and-live-keys.md)). Awaiting signature. |
| 2026-09-07 | William | Signed FR-DSH-015/075. |
| 2026-09-07 | Claude (for William) | Built FR-DSH-015 (`payout-banner.tsx` in the shell, gone once `merchant.payoutAddress` is set) and FR-DSH-075 (`keys-page.tsx` shows the gate in live mode without an address; test mode unchanged). Tests in `shell.test.tsx` and `keys-page.test.tsx`; web 263 pass. Example README's prerequisites name the address. |
| 2026-09-07 | Claude (for William) | FR-DSH-101 tightened after William's run: the payout dialog validates live. The button is disabled until the address is `0x` + 40 hex and the second field matches; a hint names the problem while typing ("An address is 0x followed by 40 hex characters.", "The two addresses don't match."). Test in `settings-page.test.tsx`. |
| 2026-09-07 | Claude (for William) | Forms hardening ([ADR 2026-09-07 forms hardening](../decisions/2026-09-07-forms-hardening-logo-png-revoke-confirm.md)): FR-DSH-114 shared field rules, FR-DSH-115 server `param` to field, FR-DSH-116 rate read-only on edit, FR-DSH-117 live key revoke by name, FR-DSH-118 encoded search; FR-DSH-103 amended to PNG-only ≤ 50 KB. Awaiting signature. |
| 2026-09-07 | William | Signed FR-DSH-114–118 and the FR-DSH-103 amendment. |
| 2026-09-07 | Claude (for William) | Built FR-DSH-114–118 and the FR-DSH-103 amendment: `web/src/lib/forms/rules.ts` (every rule the API enforces, with the input attributes) and `field-error.ts` (server `param` → field), `ui/field-hint.tsx`; product drawer (create validates live, edit shows the rate read-only), profile (blank support fields go as null, so the name saves alone), payout dialog, danger zone, notification switches (one write at a time), branding (PNG-only logo uploaded on pick through the new API, Remove control, accent and URL rules, only well-formed values reach the preview), first run, key dialogs (live revoke by name), endpoint dialog (URL and at-least-one-event rules, server URL rejections in the form's words), search (encoded ids, capped), login. Tests per form; 296 web tests pass. |
| 2026-09-07 | Claude (for William) | FR-DSH-114 refined after William typed letters into the rate field: numeric rules (`rate`, `capMinutes`, `code`) carry an `accept` prefix pattern and the inputs refuse the keystroke (`accepted()` in `lib/forms/rules`) instead of accepting it and showing an error; a paste keeps its usable characters. Applies to the product rate, the checkout custom minutes and the one-time code. |
| 2026-09-07 | Claude (for William) | FR-DSH-103 amended ([ADR 2026-09-07 support URL](../decisions/2026-09-07-support-url-one-field-in-profile.md)): the Support URL is asked for once, in Business profile; the branding form drops its copy and the preview reads the profile value; the client no longer sends `branding.support_url`. Built. |
| 2026-09-08 | William | FR-DSH-121 label: the button reads **Cash out** (was "Withdraw to bank", which promised an action the sheet does not perform); sheet title "Cash out to your bank"; its link "Read the payouts guide" → `docs.elapse.finance/payouts`, which now exists (docs FR-DOC-046). Copy no longer claims a provider list. |
| 2026-09-09 | Claude (for William) | FR-DSH-126 every list pages with Load more (grilled: 50 a page appended in place; totals and export over loaded rows, labelled; the ledger gains the common cursor). Found on the judge pass: lists fetched one page of 100 and hid the rest. **Awaiting William's signature.** |
| 2026-09-09 | William | Signed FR-DSH-126. |
| 2026-09-09 | Claude (for William) | Built FR-DSH-126: `use-paged-list.ts` (page one polled, Load more by cursor, page-one rows carried across a refresh so none fall between pages), `load-more.tsx`; all seven lists moved over, each with a 120-row page test. Ledger totals come from the API's range summary; invoice totals and both CSV exports cover loaded rows and say "of N shown". Server-side filters added for invoices (FR-API-052) and products (FR-API-011) so filters hold across pages. |
| 2026-09-09 | William | Signed the FR-DSH-005 amendment (search as you type; ADR 2026-09-09). |
| 2026-09-09 | Claude (for William) | Built the FR-DSH-005 amendment: `search-box.tsx` is a combobox with a listbox (200 ms debounce after two characters, five rows with label, type word and one line of context, arrows/Enter/Esc/click, stale answers dropped, "No match in test mode" inline); `lib/dashboard/search.ts` maps a hit to its page; mock `search()` mirrors FR-API-135. Checked at 375 px in the drawer and at 1280 px. |
| 2026-09-09 | Claude (for William) | FR-DSH-093 event context line and the FR-DSH-023/090 amendments, from William's note that event rows show only an id (grill-me: API resolves names, dashboard-session only, `amount_settled` on invoices, home feed truncates). Awaiting William's signature. |
| 2026-09-09 | William | Signed FR-DSH-093 and the FR-DSH-023/090 amendments. |
| 2026-09-09 | Claude (for William) | Built FR-DSH-093: `lib/dashboard/event-context.ts` (`eventContextLine`, unit-tested for email, short-id fallback, invoice amount, `amount: false`, null) shared by `events-list.tsx`, the home feed and `event-detail.tsx`; `real-api.ts` maps the wire `context`; the mock seeds one per meter and none on test events. Verified at 1440 and 375 against the mock. |
| 2026-09-13 | Claude (for William) | [ADR 2026-09-13 AUSD only](../decisions/2026-09-13-ausd-only-mockusd-to-test-fixture.md) applied: FR-DSH-003 amended and FR-DSH-143 added — permanent live-mode banner naming testnet AUSD until the live chain is 143. **Awaiting signature.** |
| 2026-09-13 | William | Signed the AUSD-only amendments. |
| 2026-09-22 | Claude (for William) | **FR-DSH-023/090/091 amendments, awaiting sign-off** (FR-API-146). The delivery-state column has three words and needed a fourth: an event that reached nobody reported as Delivered, so the page a merchant opens when a webhook did not arrive was the page telling them it had. "Not sent" is muted rather than destructive — the commonest reason to see it is having no endpoint configured yet — and the event detail carries one fixed sentence rather than a reason inferred from today's endpoints, which would rewrite itself the moment the merchant fixed the problem. |
| 2026-09-22 | William | **Signed** the FR-DSH-023/090/091 amendments. |
| 2026-09-22 | Claude (for William) | **FR-DSH-144 added. Signed 2026-09-22 (William).** Grilled with William the same day after the demo plan hit the gap: he wants the recording to show a merchant using the app, and a merchant using the app cannot create the product `examples/lambda` needs. Six decisions — visible to every merchant rather than behind an Advanced disclosure, because hiding it is what created the hole and a wrong pick is bounded by the 15-minute unstarted refund; two radio cards matching the Allow pause row; read-only on edit like the rate; no new list column, one line under the name for the exception; six tests; a new id rather than an FR-DSH-031 amendment, so the tests have a name. No API work — `CreateProduct` already accepts `start_mode` and `serializeProduct` already returns it, so `api/openapi.json` does not move. |
| 2026-09-23 | Claude (for William) | **FR-DSH-012 loading frame fixed within the signed decision.** Found by William while recording: the landing page's Dashboard link gave a signed-out visitor a glimpse of the shell — wordmark, sections, top bar — before `/login` replaced it. Nothing of anyone's was on screen (the shell renders with `merchant: null`), but a dashboard they do not have was. The obvious server-side gate is not available: `elapse_session` is set by the API on its own host with no `domain`, so the web origin cannot read it in middleware or a server component, and re-scoping an auth cookie is not a fix to make in passing. The gate now remembers a boolean — someone has signed in in this browser — set on a successful `me()`, cleared on sign-out and on any 401, and guarded for browsers that refuse storage. Returning merchant: the shell, as before. Anyone else: the wordmark alone. Four tests, including the one that matters most: the layout is a server component, so the gate is server-rendered before it hydrates and the flag must be read **after** mount — reading it during render made a returning merchant's first client render disagree with the HTML it was hydrating. 363 web tests green. |
