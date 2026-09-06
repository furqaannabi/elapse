# The example merchant has its own brand, not Elapse's design system
2026-09-06 · Decided by William · Status: accepted

## Context
`examples/saas` is the merchant in the demo video and the project a judge clones. Its product
page was a bare system-font card. Two ways to improve it: inherit `DESIGN.md` (the
Strip-Chart Recorder world of the landing, checkout and dashboard), or give the fictional
merchant "Acme GPU" a look of its own. In the video the judge should read "a merchant's site
hands me to Elapse Checkout", which two Elapse-looking pages in a row would blur.

## Decision
Acme GPU gets its own visual world, deliberately outside `DESIGN.md`. From a dealt hand of
directions William chose **"rack rail and rating plates"**: a colocation cage under cold white
light, brushed-aluminium ground, a numbered U-strip down the rail, black engraved laminate
plates, one safety-yellow rating label, red embossed tape, and a steel push plate with a status
LED. Three pages (product, success, cancel) share one stylesheet served by the example itself;
no framework, phone first. The example's world is recorded in `examples/saas/DESIGN.md`;
the root `DESIGN.md` is untouched and still governs every Elapse surface.

## Consequences
- The video's handoff is legible: merchant look → Elapse Checkout look.
- FR-EXM-010's "one-file product page" becomes three HTML files plus `/acme.css`; the pinned
  copy (`Acme GPU`, `GPU · 4090`, the price line, `Start`, the success and cancel sentences)
  is unchanged, so the tests and the Quickstart still hold.
- The example's stylesheet loads two Google Fonts with system fallbacks; offline the pages
  still render.
- Anyone forking the example replaces `public/` wholesale; the handler code is untouched.
