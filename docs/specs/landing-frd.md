# Landing (`/`) — FRD

Status: **Built (retro-documented)** · Surface: Persuade · Sources: design brief Surface 1; detailed doc §1, §5.3, §16.

## Problem

A merchant engineer, or a judge, arrives with no context and must understand per-second billing, believe it works, and copy `npm install` within one viewport.

## User stories

1. As a merchant engineer, I want to see a meter accrue and cancel it myself, so that I believe the product before reading.
2. As a merchant engineer, I want the webhook payload I would receive, so that I can judge the integration in seconds.
3. As a merchant engineer, I want the install command and the SDK surface, so that I can start in an afternoon.
4. As a judge, I want to see how this differs from monthly billing, so that I can articulate why it is a startup.

## Functional requirements

| Id | Requirement | Status |
| --- | --- | --- |
| FR-LND-001 | The demo meter starts automatically ~1 s after load at the demo rate; the strip's pen drops. | Built |
| FR-LND-002 | Pressing Cancel lifts the pen, locks the readout, and shows "You paid N seconds · $X" with the settled (whole-second) amount. | Built |
| FR-LND-003 | The `subscription.canceled` webhook card is visible at rest with the canonical example (83 s / $0.33, labelled example) and swaps to the visitor's numbers on cancel. | Built |
| FR-LND-004 | "Start again" opens a new session; the strip keeps the gap. | Built |
| FR-LND-005 | The install row copies `npm install @elapse/sdk` on click and confirms for 1.6 s. | Built |
| FR-LND-006 | Three-step integrate section shows only methods from the frozen SDK surface (§4.2). | Built |
| FR-LND-007 | Monthly-vs-per-second comparison draws itself once when scrolled into view. | Built |
| FR-LND-008 | Event catalog lists exactly the six MVP events (§5.1). | Built |
| FR-LND-009 | Tariff shows per-second and derived per-hour figures via meter math, labelled illustrative. | Built |
| FR-LND-010 | Header: Docs, GitHub, Dashboard, theme toggle. Footer: Docs, GitHub, Dashboard, Status, X, "Built on Monad". | Built |
| FR-LND-011 | Light and dark themes; preference persisted; no flash on load. | Built |
| FR-LND-012 | Mobile 390: the readout and Cancel appear in the first viewport; tables stack; nothing scrolls sideways. | Built |
| FR-LND-013 | Reduced motion: reveals and strip scroll stop; the counter keeps ticking. | Built |

## Business rules

| Id | Rule |
| --- | --- |
| BR-LND-001 | No chain vocabulary above the fold. "Built on Monad" appears once, in the footer. |
| BR-LND-002 | No customers, logos, testimonials, or benchmarks; demo merchant is labelled "demo". |
| BR-LND-003 | Red is used only for the pen trace and Cancel; live state is blue. |

## Open

- Docs, dashboard, status, X URLs are placeholders in `web/src/lib/site.ts`.
- FR-LND-001–005 have no automated tests yet (Playwright e2e planned: load → cancel → card shows numbers).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-03 | Claude | Retro-documented from the built landing. |
