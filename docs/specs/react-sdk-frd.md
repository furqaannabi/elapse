# React SDK (`@elapse/react`) — FRD

Status: **Signed 2026-09-17 (Furqaan)** · Surface: Merchant front end (`sdk/react/`) · Sources: [ADR 2026-09-17 React SDK replaces hosted checkout](../decisions/2026-09-17-react-sdk-replaces-hosted-checkout.md); [ADR 2026-09-17 merchant stops](../decisions/2026-09-17-merchant-started-meters-only-merchant-stops.md); checkout FRD (copy, meter, held view, receipt, BR-CHK-001–007); meter FRD (math, `useMeter`); API FR-API-031/137/140; `DESIGN.md`.

## Problem

Subscribers leave the merchant's app for a hosted page to authorise and watch a meter, then come back. Merchants want authorisation, the live meter, start and stop, and proof of each step inside their own app, looking and sounding as good as the hosted page, without ever touching the subscriber's wallet.

## User stories

1. As a merchant, I want to drop `<Authorize session>` into my React app so a subscriber authorises a session without leaving it.
2. As a merchant, I want `<Meter session>` to show the live meter with the right controls for the product's start mode.
3. As a merchant, I want every step as an event carrying its transaction hash, and a `<TxLink>` I can place where I choose.
4. As a merchant, I want the components to match my brand through a theme, or to build my own markup from hooks.
5. As a subscriber, I want to confirm with Face ID in a window that is clearly Elapse's, and hear and see when my meter starts and stops.

## Functional requirements

### Packaging

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-RCT-001 | `sdk/react/` publishes `@elapse/react`: ESM and CJS builds with types, and a browser ESM build loadable from `cdn.jsdelivr.net` for pages without a bundler. Peer dependencies: `react` 18 or 19 and `motion`. Styles ship as `@elapse/react/styles.css`; no Tailwind is required in the merchant app. | `pnpm pack` contains `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, `styles.css`; a Vite app and a CDN `<script type="module">` page both render `<Meter>`. |
| FR-RCT-002 | The package stays under 25 KB minified and gzipped, excluding peers. | Size check in CI fails above 25 KB. |
| FR-RCT-003 | `<ElapseProvider publishableKey baseUrl? theme? sound?>` wraps the components. A key that does not start with `pk_` throws at render; a key starting with `sk_` throws with "Never put a secret key in the browser." | Unit: `sk_test_…` throws that sentence; `pk_test_…` renders children. |

### Authorise

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-RCT-010 | `<Authorize session="cs_…">` reads the public session (API FR-API-031) and shows the cap step: 1 hour, 4 hours, custom, each with "Up to $X" at the product's rate, the checkout FR-CHK-003 line, the FR-CHK-035 line for merchant-mode products and the FR-CHK-037 line, then a primary **Authorise**. | Component test for both modes against a mocked API. |
| FR-RCT-011 | **Authorise** opens the popup `{elapse}/authorize?session=cs_…&action=authorise&cap=<s>&nonce=<n>` synchronously inside the click handler, 480×720 centred. If the browser blocks it, the component shows "Your browser blocked the Elapse window. Allow pop-ups and try again." with **Try again**. | Fake `window.open` returning `null` → the sentence and button; a window → no message. |
| FR-RCT-012 | The component accepts a popup message only when `event.origin` is the Elapse origin, `event.source` is the popup it opened, and the message's `nonce` equals the one it generated for that attempt. Anything else is ignored. | Handshake test: wrong origin, wrong source and wrong nonce each ignored; the correct message accepted once. |
| FR-RCT-013 | On `authorised`: in checkout mode the meter view follows (`onStarted`); in merchant mode the held view follows (checkout FR-CHK-034 copy, with the refund-by time) and `onAuthorised` fires. | Component test per mode. |
| FR-RCT-014 | If the popup closes without a result, the component returns to the cap step with "Nothing was charged." and no error event. | Fake popup `closed = true` → back to the cap step. |

### Meter, controls, receipt

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-RCT-020 | `<Meter session="cs_…">` shows the running meter: elapsed and accrued from `rate × (now − started_at)` ticking at 100 ms in tabular numerals with no layout shift, what is left of the cap, and the low-balance notice (FR-CHK-006). It re-reads the session every 5 s and on focus (FR-CHK-032). | Fake timers: readout advances; a server flip to `canceled` shows the receipt within 5 s. |
| FR-RCT-021 | Controls follow the start mode. Checkout mode: **Stop**, and **Pause**/**Resume** when the product allows pause; each opens the popup with `action=cancel\|pause\|resume`. Merchant mode: held → **Stop**; started → no Stop and no Pause, with "{merchant} stops this meter. It ends by itself at your {cap}." (FR-CHK-037). | Component test for the four states. |
| FR-RCT-022 | `<Receipt>` appears when the meter ends: "You paid for N seconds · $X", what came back, and no start time for a meter that never started. | Component test with server totals (BR-CHK-003). |
| FR-RCT-023 | `<TxLink hash>` renders `0x` plus the first 4 and last 4 hex digits, linked to the chain's explorer, opening in a new tab. No default component renders it (BR-RCT-001). | Unit: text, `href` for chain 10143, `rel="noopener noreferrer"`. |

### Hooks and events

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-RCT-030 | `useAuthorize(session)` returns `{ session, state, authorise(capSeconds), error }`; `useMeter(session)` returns `{ elapsed, accrued, running, state, canStop, canPause, stop, pause, resume, receipt }`. The components are built only from these hooks. | Hook tests with `renderHook`; no component calls the API directly. |
| FR-RCT-031 | Events: `onAuthorised`, `onStarted`, `onStopped`, `onPaused`, `onResumed`, `onCapReached`, `onError`. Each carries `{ subscription, txHash?, explorerUrl? }`; `txHash` is the relayer's `pending_tx` for that step. | Each event fires once per transition with the hash from the mocked API. |

### Theme, motion, sound

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-RCT-040 | Theming through CSS variables (`--elapse-accent`, `--elapse-radius`, `--elapse-font`, `--elapse-bg`, `--elapse-fg`, `--elapse-muted`), set from `theme={{ accent, radius, font, mode }}` with `mode` `dark`, `light` or `system`. Defaults come from DESIGN.md: neutral dark, amber for the live meter, no red. | Snapshot of computed variables for the default and a custom theme. |
| FR-RCT-041 | Motion: the cap step gives way to the meter, start and stop transitions, and the receipt appearing. With `prefers-reduced-motion` there are no transform or position animations. Nothing animates per second. | Test with a reduced-motion media mock: no transform styles applied. |
| FR-RCT-050 | Sound: short Web Audio cues synthesised in code (no audio files) for authorised, started, stopped and cap reached. The audio context is created only after a user gesture. On by default; `sound={false}` on the provider turns it off; a mute toggle on `<Meter>` persists in `localStorage` under `elapse:sound`. Never a sound per second. Audio failures are silent. | Injected fake `AudioContext`: one cue per transition, none per tick, none when muted or disabled; storage failure does not throw. |

### Quality

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-RCT-060 | Mobile first at 390 px, touch targets at least 44 px, keyboard operable, and state changes announced through `aria-live`. | Component tests at 390 px; axe check without violations. |
| FR-RCT-061 | Tests: vitest and Testing Library for every component and hook, the popup handshake with fakes, and a Playwright run in `examples/saas`: authorise → meter → stop → receipt. | CI job for `sdk/react`. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-RCT-001 | Default components show no chain words (checkout BR-CHK-001). Transaction hashes reach the page only through events and `<TxLink>`, which the merchant places. |
| BR-RCT-002 | The package accepts only publishable keys. It never holds, requests or forwards a secret key. |
| BR-RCT-003 | The subscriber's wallet, identity token and signatures never run under the merchant's origin. Every signature happens in the Elapse popup. |
| BR-RCT-004 | Popup messages are checked for origin, source window and nonce, and never contain a signature, token or key: only the step, the subscription id and the transaction hash. |
| BR-RCT-005 | Money math uses the meter's integer nano-dollars; rates are never parsed as floats. |
| BR-RCT-006 | No red anywhere; Stop is a neutral outline (BR-CHK-004). |

## Open

- Popups inside installed web apps and some in-app browsers (Instagram, X) are unreliable; decide whether to fall back to a full-page redirect to the popup URL there.
- Privy must list `elapse.finance` for the popup; confirm passkey behaviour inside a popup on iOS Safari before building on it.
- §4.2 of the detailed document gains `@elapse/react` and loses `url` (BR-SDK-001): Furqaan's edit.

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-17 | Claude (for Furqaan) | **Created from the grill, awaiting sign-off.** Popup for every signature, events plus opt-in `<TxLink>`, styled and themeable components with hooks, synthesised sound on by default, hosted checkout replaced after this is proven ([ADR 2026-09-17](../decisions/2026-09-17-react-sdk-replaces-hosted-checkout.md)). |
| 2026-09-17 | Furqaan | **Signed** Draft —. |
