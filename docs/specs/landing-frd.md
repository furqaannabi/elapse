# Landing (`/`) — FRD

Status: **FR-LND-014 amendment (`See the demo` → the live examples) Signed 2026-09-26 (Furqaan)** · **Built · FR-LND-014–019 signed and built 2026-09-08** · Surface: Persuade · Sources: design brief Surface 1; detailed doc §1, §5.3, §16.

## Problem

A merchant engineer, or a judge, arrives with no context and must understand per-second billing, believe it works, and copy `npm install` within one viewport.

## User stories

1. As a merchant engineer, I want to see a meter accrue and cancel it myself, so that I believe the product before reading.
2. As a merchant engineer, I want the webhook payload I would receive, so that I can judge the integration in seconds.
3. As a merchant engineer, I want the install command and the SDK surface, so that I can start in an afternoon.
4. As a judge, I want to see how this differs from monthly billing, so that I can articulate why it is a startup.
5. As a founder or investor judging the project, I want to see who pays, what Elapse keeps and when money lands, so that I can tell whether this becomes a company ([ADR 2026-09-08 landing audience](../decisions/2026-09-08-landing-for-founders-and-finance.md)).
6. As the finance owner at a merchant, I want to know payouts are in dollars as they accrue, refunds are automatic and there are no chargebacks, so that I can approve the integration without a call.

## Functional requirements

| Id | Requirement | Status |
| --- | --- | --- |
| FR-LND-001 | The demo meter starts automatically ~1 s after load at the demo rate; the strip's pen drops. | Built |
| FR-LND-002 | Pressing Cancel lifts the pen, locks the readout, and shows "You paid for N seconds · $X" with the settled (whole-second) amount. | Built |
| FR-LND-003 | The `subscription.canceled` webhook card is visible at rest with the canonical example (83 s / $0.33, labelled example) and swaps to the visitor's numbers on cancel. | Built |
| FR-LND-004 | "Start again" opens a new session; the strip keeps the gap. | Built |
| FR-LND-005 | The install row copies `npm install @elapse/sdk` on click and confirms for 1.6 s. | Built |
| FR-LND-006 | Three-step integrate section shows only methods from the frozen SDK surface (§4.2). | Built |
| FR-LND-007 | Monthly-vs-per-second comparison draws itself once when scrolled into view. | Built |
| FR-LND-008 | Event catalog lists exactly the six MVP events (§5.1). | Built |
| FR-LND-009 | ~~Tariff~~ Folded into FR-LND-016 on 2026-09-08: the illustrative rate line lives on each merchant row. | Superseded |
| FR-LND-010 | Header: Docs, GitHub, Dashboard, theme toggle. Footer: Docs, GitHub, Dashboard, Status, X, "Built on Monad". | Built |
| FR-LND-011 | Light and dark themes; preference persisted; no flash on load. | Built |
| FR-LND-012 | Mobile 390: the readout and Cancel appear in the first viewport; tables stack; nothing scrolls sideways. | Built |
| FR-LND-013 | Reduced motion: reveals and strip scroll stop; the counter keeps ticking. | Built |
| FR-LND-014 | **Hero for both readers.** Headline stays `You only pay what elapsed.` The subline speaks for the merchant: earns per second of use, paid out in dollars as it accrues, integrated like Stripe (SDK, hosted checkout, signed webhooks). Buttons: primary `Start integrating` → docs quickstart; secondary `See the demo` → scrolls to the merchant section (FR-LND-016) until the video exists, then the video. **Amended 2026-09-26 (signed, Furqaan):** `See the demo` → `https://examples.elapse.finance/`, the page linking both live examples (examples FRD FR-EXM-037), instead of scrolling to the merchant section. The video, when it exists, sits beside the examples rather than replacing them. | Built; amendment built 2026-09-26, shipped once the examples' root page answers 200 |
| FR-LND-015 | **Merchant readout beside the meter.** When the demo session is running or locked, a strip under the meter shows the same session from the merchant's side: `Merchant receives $X · Elapse keeps $Y` computed from the meter's settled amount and the fee (FR-LND-018 source), whole seconds only, integer micro-dollar math, no floats. At rest it shows the canonical 83 s example labelled as such. Unit test: 83 s at 0.004 with 200 bps → paid 0.332, merchant 0.32536, fee 0.00664, displayed to the cent with the fee to three places when under a cent. | Built |
| FR-LND-016 | **Merchant section replaces the tariff.** Heading in the merchant's voice ("Built for anything that runs while someone uses it"). Four cards: GPU and inference clouds, metered APIs, live streaming and events, SaaS seats. Each card: who they are today (what they sell and how they bill now), what changes with a second as the unit (one sentence), and the illustrative rate line the tariff carried (per second, derived per hour via meter math, labelled illustrative, FR-LND-009 folded in). Section id `merchants` is the FR-LND-014 demo target. BR-LND-002 holds: categories, not customers. | Built |
| FR-LND-017 | **The money.** A section after FR-LND-016, four statements with one number or one fact each: paid out to the merchant's address as it accrues (hourly settle, at once on stop); Elapse keeps the fee as a share of settled seconds only, the number rendered from FR-LND-018; unused funds return to the subscriber on stop automatically; no chargebacks, because every meter is prefunded. Then one sentence, the only chain words on the page above the footer: settles in AUSD on Monad, dollars in and dollars out, a block every 400 ms is what makes a second an honest unit. BR-LND-001 holds (below the fold). | Built |
| FR-LND-018 | **Fee from the record, not from copy.** The percentage shown in FR-LND-015 and FR-LND-017 is read at build from the deployment record the API serves `fee_bps` from (`deployments/10143.json`, `pnpm sync-deployments` extended to copy into `web/`), never typed into copy. Test: the rendered figure equals the record's `feeBps / 100`. | Built |
| FR-LND-019 | **Meter-versus-month reframed.** Drawing unchanged (FR-LND-007). Heading and copy speak to the merchant: nobody churns from a meter they can stop; no commitment means more people start; revenue grows with use instead of resetting at renewal. The 27 unused days are named as the reason customers leave. | Built |

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
| 2026-09-06 | Claude (for William) | Closing plate stays near-black in dark mode (William: a white band defeats dark mode). Tokens `--plate`/`--plate-ink` in `globals.css`; light mode keeps the ink inversion. Test `stripe-shaped.test.tsx`. |
| 2026-09-08 | Claude (for William) | FR-LND-014–019 from the grill: hero subline and buttons for founders and finance owners, merchant readout beside the meter, merchant section replacing the tariff, The money section with the fee from the deployment record and one Monad sentence, meter-versus-month reframed ([ADR 2026-09-08 landing audience](../decisions/2026-09-08-landing-for-founders-and-finance.md)). **Awaiting William's signature.** |
| 2026-09-08 | William | Signed FR-LND-014–019. |
| 2026-09-08 | Claude (for William) | Built FR-LND-014–019: `hero.tsx` subline, `Start integrating` → quickstart, `See the demo` → `#merchants`, `MerchantReadout` in the panel; `merchants.tsx` (ledger, four categories, `id="merchants"`) replaces `tariff.tsx`; `the-money.tsx`; `meter-vs-month.tsx` copy; `lib/fee.ts` reads `lib/deployments/10143.json` (sync script extended). One amendment to FR-LND-015 found in the visual round: all three readout figures share one precision (4 places under a tenth of a cent, 3 under a cent, else 2) so the ledger adds up on the page; the earlier "paid to the cent" read `$0.00` beside `$0.007` in the first seconds. Tests: `fee.test.ts` (3), `merchant-readout.test.tsx` (4), `hero.test.tsx` (3), `merchants.test.tsx` (2), `the-money.test.tsx` (2), `meter-vs-month.test.tsx` (1). |
| 2026-09-26 | Claude (for Furqaan) | **FR-LND-014 amendment written:** the hero's `See the demo` stops being a placeholder scroll and opens the live examples at `examples.elapse.finance`. The merchant section's "until the video exists" note goes with it. |
| 2026-09-26 | Furqaan | **Signed** the FR-LND-014 amendment. |
