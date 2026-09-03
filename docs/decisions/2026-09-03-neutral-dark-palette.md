# Neutral dark default theme, amber as the only accent, no red

2026-09-03 · Decided by William · Status: accepted

## Context

The landing went through four palettes in one day. The first (cool green-grey chart paper, green "running" dot) read as clinical and uninviting. The second (warm cream, cobalt blue accent) read as plain and off-niche. The third (warm near-black "night", amber, coral) was chosen from four rendered variants but the warmth still read as "creamy brown". Throughout, the ruled graph-paper texture read as a lab or a spreadsheet, and red on Cancel and the pen trace read as alarm on a billing product.

The brief pinned Stripe / Linear / Vercel craft; the product targets merchant engineers and startup-minded judges, so the surface must feel like the tools they already trust.

## Decision

- **Default theme is neutral dark** (`#0a0a0a` ground, `#ededed` ink), the Vercel register. Light mode exists (neutral white) but is secondary.
- **One accent: amber.** It is the pen trace, the live meter amount, proof numbers, and copy confirmations. The pen and the live meter share it (`--pen` = `--live`).
- **No red on the landing or the subscriber checkout.** Cancel is a neutral outlined button; low-balance and out-of-funds notices are amber. A red `--destructive` token exists only for dashboard actions such as revoking a key.
- **No page-level grid textures.** Ruling appears only inside the instrument strip, one faint line per second.
- Primary actions are white-on-black inversions, never a colour; the closing section inverts to white.

## Consequences

- Every new surface (checkout, dashboard) inherits this; `DESIGN.md` records the tokens and rules.
- Status must be carried by words, not colour alone, since the palette has one hue.
- Merchant checkout branding may override the accent per session; layout and copy stay ours.
- Process learning: when the human dislikes a look, render three or four real variants of the actual page and let them pick; swatch descriptions did not land.
