# `@elapse/react` replaces the hosted checkout; signatures happen in an Elapse popup
2026-09-17 · Decided by Furqaan · Status: accepted

## Context

Merchants integrate with `@elapse/sdk` on the server and send subscribers to a hosted Checkout page at `elapse.finance/c/cs_…`, which also serves as the page a subscriber returns to (`manage_url`, ADR 2026-09-09). Furqaan asked for a React SDK that puts authorisation, the running meter, start and stop, and transaction hashes inside the merchant's own app with animation and sound, and for the hosted checkout to be removed.

Constraints found while deciding:
- The API accepts Privy identity tokens from one Privy app, Elapse's (FR-API-120). `/account` spans merchants (ADR 2026-09-04) because every subscriber has one wallet across merchants.
- The embedded wallet holds the subscriber's AUSD and signs the permit that moves it. Whoever runs Privy on a page controls that wallet there.
- `url` on the Checkout session and `manage_url` on the Subscription are in the frozen SDK surface (§4.2, BR-SDK-001).
- BR-CHK-001: no chain words on the subscriber side outside judge mode.
- Browsers allow audio only after a user gesture; the design rules forbid anything that pulses per second.

## Decision

Eight answers, each chosen over the alternatives listed:

1. **Replace the hosted checkout.** Rejected: adding the React SDK beside it; wrapping the hosted page in an iframe or popup.
2. **Every signature happens in an Elapse-origin popup** (`elapse.finance/authorize`). The components render in the merchant app; sign-in, Face ID, Add funds and each signature run on Elapse's origin, so the wallet never runs under merchant code. Rejected: Elapse's Privy app mounted on merchant origins; each merchant's own Privy app, which breaks the cross-merchant wallet and `/account`.
3. **Drop `url`; `manage_url` points to `/account`.** Merchants pass the `cs_` id to `<Authorize>`. `@elapse/sdk` 0.2.0, since removing a field breaks callers. Rejected: removing both; keeping `url` for the popup, which keeps a second checkout surface alive.
4. **The transaction hash is on every event, and `<TxLink>` is opt-in.** Default components show no chain words, so BR-CHK-001 holds unless the merchant chooses otherwise. Rejected: showing it by default; only behind a debug flag.
5. **Styled, themeable components plus headless hooks.** Default look from DESIGN.md, themed through CSS variables; `useAuthorize` and `useMeter` for custom markup; no Tailwind needed in the merchant app; Motion is a peer dependency. Rejected: hooks only; Tailwind classes.
6. **Synthesised sound cues, on by default.** Web Audio tones on authorised, started, stopped and cap reached; `sound={false}` for merchants and a remembered mute toggle for subscribers; never per second. Rejected: bundled audio files; off by default.
7. **The popup does every signature; old links get a notice.** Authorise permit, and checkout-mode Stop, Pause and Resume signatures, plus sign-in, Face ID and Add funds, run in the popup. `/c/[session]` is replaced by a one-line page: "This checkout link is no longer used. Return to {merchant}." `/account`, the landing and the dashboard stay. Rejected: popup for authorise only; deleting `/c` with no notice.
8. **Order:** the merchant-stop contract change first (ADR 2026-09-17 merchant stops), then the popup and `@elapse/react`, then both examples on `@elapse/react` with `/c` removed and SDK 0.2.0, then docs and CI. Nothing is deleted until its replacement works end to end. Rejected: React first; both at once.

## Consequences

- A merchant integration becomes: `checkout.sessions.create` on the server, then `<ElapseProvider publishableKey>` with `<Authorize session>` and `<Meter session>` in the browser. The popup posts its result only to the origin of the session's `success_url`.
- `success_url` stays on the session: it names the merchant origin the popup trusts.
- Read-only public session routes accept publishable-key calls from any origin (CORS); every mutation happens in the popup on Elapse's origin.
- Superseded by this record: the hosted-page purpose of `manage_url` in ADR 2026-09-09 (the field stays and now points to `/account`); checkout Surface 1 (`/c/[session]`) once `@elapse/react` is proven.
- Frozen surface: §4.2 of the detailed document is Furqaan's to edit (BR-SDK-001).
- Deadline risk for 13 October: a new package, a popup surface, two example rewrites and docs.
- Specs: new `react-sdk-frd.md` (FR-RCT); API FR-API-140; checkout FR-CHK-038–040; SDK FR-SDK-043; examples FR-EXM-032 and FR-EXM-152; docs FR-DOC-047.
