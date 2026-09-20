# Authorise in a window only; the modal frame is withdrawn
2026-09-20 · Decided by Furqaan · Status: accepted · Supersedes [2026-09-19 authorise in an iframe modal](./2026-09-19-authorise-in-an-iframe-modal.md)

## Context

[ADR 2026-09-19](./2026-09-19-authorise-in-an-iframe-modal.md) put the signature in a dimmed modal frame on the merchant's page, with a window as the escape hatch for the one case a frame cannot serve: browsers refuse to **enrol** a passkey inside a cross-origin frame, so a subscriber who has never used Elapse is handed to a window mid-flow (FR-RCT-043).

Running the Lambda console showed what that costs in practice. Furqaan, watching the flow: "when authorise popup window open just before it another popup open i don't want it". The frame opens, the framed page reports `elapse:needs-window`, and the window opens — two things appear for one signature, the first of them a panel that flashes by. Enrolment is not the rare case in a demo: every new judge, every fresh device, takes that path.

The same day, `<Authorize cap>` removed the cap step so Run goes straight to the signature, which made the double appearance more obvious rather than less.

## Decision

`@elapse/react` asks for every signature in a **window**, for every merchant. The modal frame, its overlay, its focus trap and its `needs-window` handoff are removed: `useSignature` is now a thin wrapper over `requestSignature`, and the hooks no longer return a `modal` for components to render.

Rejected: keeping frame-first and opening the overlay only once the frame proves usable (still two windows when enrolling, merely without the flash); making the window opt-in per merchant (leaves two paths to test and document for a case that mostly fails).

## Consequences

- **One window, every time.** Nothing appears over the merchant's page first.
- **The window must be opened inside the user's click.** `request()` does no `await` before opening. A blocked window rejects with `blocked`, which the components already turn into a notice and a Try again — one click, and it opens. `<Authorize cap>`, which asks on mount rather than on a click, is the case most likely to meet the blocker.
- **FR-RCT-044 has nothing left to describe.** The focus trap, the labelled dialog and the body-scroll lock were the modal's; a window needs none of them. Its accessibility concern moves to the components' own cards.
- **Less to maintain and less to explain:** `signature.tsx` drops from 184 lines to about 45, `modal.test.tsx` (11 tests) goes, and the react docs no longer describe a handoff.
- **`success_url` no longer decides who may frame the Elapse page.** Framing is not used at all.
