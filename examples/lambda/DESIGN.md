---
name: Northwind Compute (example merchant)
description: A rugged field terminal. Charcoal casing, a phosphor screen inset, one amber run key — for the lambda demo merchant only.
colors:
  case: "#23262a"
  case-hi: "#31353a"
  case-lo: "#191b1e"
  bezel: "#0e1012"
  screen: "#07100b"
  screen-ink: "#7ef2a8"
  screen-dim: "#3f7a56"
  key: "#e8a33d"
  key-lo: "#c9852a"
  key-ink: "#231a08"
  ink: "#d7dbde"
  dim: "#8b9298"
  rule: "#3a3f45"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(26px, 8vw, 36px)"
    fontWeight: 700
    letterSpacing: "0.03em"
  screen:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.16em"
  fine:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
rounded:
  case: "10px"
  screen: "4px"
  key: "6px"
---

# Northwind Compute — the lambda example's own world

Per [ADR 2026-09-06](../../docs/decisions/2026-09-06-example-merchant-own-brand.md) an example
merchant has a look of its own, deliberately outside the root `DESIGN.md`, so the demo reads as
"a merchant's site hands me to Elapse Checkout" rather than two Elapse-looking pages in a row.
`examples/saas` is a colocation cage; this one is a different object entirely.

**The object.** A rugged handheld field terminal: a charcoal magnesium case with a machined
bezel, a phosphor-green screen inset where the code and its output live, and one amber run key.
Labels are engraved in mono caps. Nothing blinks.

**Why it fits.** The product is a live compute session you type into. A terminal is the honest
form: the screen is where your code goes, the key is the one control, and the meter is a small
engraved readout on the casing — always visible, never shouting.

**Rules.**
- Phone first, designed at 390px. One column; the screen never scrolls the page sideways.
- The meter uses tabular numerals and ticks at 100ms. It does not pulse, flash, or animate.
- There is **no Start control** — the session begins on the first Run. Since the 2026-09-21
  decision it does not end by itself while you are at the terminal, so the casing carries exactly
  two other controls: **End session**, engraved into the case at the far end of the key row, and
  the **Pause / Resume** pair the meter itself offers. Only Run is amber. A control that stops the
  money must not look like the control you press all day.
- No chain words anywhere: "session", "seconds", "$". Never a token, address or transaction.
- Two Google Fonts with system fallbacks; offline the pages still render.

**Design note.** This world was originally chosen and recorded directly, because `/impeccable` was
not installed in this repo when the pages were first built. The skill has since been installed and
run over these pages (2026-09-21, the End session and Pause/Resume controls); the world itself was
preserved rather than replaced.
