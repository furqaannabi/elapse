# Authorise happens in a modal frame on the merchant's page, with the popup as the escape hatch
2026-09-19 · Decided by Furqaan · Status: accepted

## Context

Since [ADR 2026-09-17](./2026-09-17-react-sdk-replaces-hosted-checkout.md) every signature happens in a window `@elapse/react` opens on `elapse.finance`. It works — a full session ran through it today — but it is a second window: the subscriber leaves the merchant's page, watches a separate tab, and comes back. Furqaan asked for Razorpay's shape instead: a dimmed overlay with Elapse inside it, no new tab.

What is actually at stake:

- **The security property is not.** A cross-origin iframe of `elapse.finance/authorize` still runs Privy, the embedded wallet and every signature on Elapse's origin. BR-RCT-003 holds either way; the merchant's page cannot read into the frame any more than it can read into the window.
- **Passkeys are.** `navigator.credentials.create()` — registering a Face ID passkey — is blocked in cross-origin iframes in current browsers. `get()` works only when the parent grants `allow="publickey-credentials-get"`. So a returning subscriber can very likely sign in inside the frame; a **first-time** one may not be able to enrol at all. Safari's storage partitioning is a second unknown for Privy's session in a third-party frame.
- **Clickjacking is.** A page that may be framed by anyone can be framed under an invisible overlay, and a subscriber tricked into authorising a session someone else created.

## Decision

`<Authorize>` opens a modal: a dimmed overlay over the merchant's page with `{elapse}/authorize` in an iframe, `allow="publickey-credentials-get"`. The result comes back through the same handshake as the popup — origin is the Elapse app, source is that frame's `contentWindow`, nonce matches the attempt.

The popup stays, as the escape hatch rather than a legacy path. The modal hands off to it, **carrying the same nonce**, in three cases: the framed page says it cannot run Face ID there, the frame fails to load, or the subscriber presses "Having trouble? Open a window". The first is automatic and is expected to be the common case for a subscriber who has never used Elapse — the fallback is the first-run path, not an afterthought.

`/authorize` sets `frame-ancestors` to the origin of the session's `success_url`, resolved with the publishable key that is already in the URL. A merchant can frame only the sessions it created; nobody else can frame the page at all.

## Consequences

- Two hosts to keep working for every signature — authorise, stop, pause, resume — and two to test on iOS Safari, where both passkeys and partitioned storage are at their most awkward.
- The handoff must not double-charge or double-sign: one nonce per attempt, and the modal stops listening the moment it hands off.
- `/authorize` gains a mode: framed pages report capability and show the "open a window" affordance; windowed pages do not.
- If Privy turns out to support enrolment in a frame, the fallback becomes rare rather than unnecessary — it stays, because browsers change their minds about this.
- Deadline risk: this is a new surface on the critical path 24 days before submission. The popup flow keeps working throughout, so the fallback is also the rollback.
