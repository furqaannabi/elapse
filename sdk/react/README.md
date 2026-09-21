# @elapse/react

Authorise, meter and receipt components for [Elapse](https://elapse.finance) — per-second billing.
Your subscriber authorises, watches a live counter, and stops, **inside your own app**. Elapse never
asks you to touch their wallet: every signature happens in a window Elapse opens.

```
npm install @elapse/react
```

Peers: `react` 18 or 19, `react-dom`, and `motion`.

## Quickstart

**1. Create a session on your server** with [`@elapse/sdk`](https://www.npmjs.com/package/@elapse/sdk)
and your secret key. Never put a secret key in the browser.

```ts
const session = await elapse.checkout.sessions.create({
  product: "prod_…",
  successUrl: "https://acme.com/ok",
  cancelUrl: "https://acme.com/cancel",
});
// send session.id to the page
```

**2. Render the components** with your publishable key (`pk_…`).

```tsx
import { Authorize, ElapseProvider, Meter } from "@elapse/react";
import "@elapse/react/styles.css";

function Billing({ session }: { session: string }) {
  const [started, setStarted] = useState(false);
  return (
    <ElapseProvider publishableKey={process.env.NEXT_PUBLIC_ELAPSE_KEY!}>
      {started ? (
        <Meter session={session} onStopped={(e) => console.log("stopped", e.txHash)} />
      ) : (
        <Authorize session={session} onAuthorised={() => setStarted(true)} onStarted={() => setStarted(true)} />
      )}
    </ElapseProvider>
  );
}
```

That is the whole integration. `<Authorize>` shows how long the meter may run and what that can
cost, then opens Elapse in a window for Face ID. `<Meter>` ticks the elapsed time and the amount,
shows the controls the product allows, and turns into the receipt when the meter ends.

One window, every time. It used to open in a frame over your page and hand off to a window when the
passkey needed enrolling — which browsers refuse inside a cross-origin frame, so the handoff was the
common path and the subscriber saw a panel flash by first. Call `authorise` (or the components'
buttons) straight from a click: browsers only allow a window inside the user's own gesture, and a
blocked one shows a notice and a Try again.

## No bundler? One script tag

```html
<div id="elapse"></div>
<script type="module">
  import { mount } from "https://cdn.jsdelivr.net/npm/@elapse/react/dist/elapse.browser.js";
  mount("#elapse", {
    publishableKey: "pk_test_…",
    session: "cs_…",            // created on your server
    onStopped: (e) => console.log("stopped", e.txHash),
  });
</script>
```

This build carries its own React (~65 KB gzipped), so the page needs nothing else. If your app already
runs React, install the package instead and use the components — you keep one React.

## Components

| Component | What it renders |
| --- | --- |
| `<ElapseProvider publishableKey baseUrl? appOrigin? sound?>` | Configuration for everything below it. A key starting with `sk_` throws. |
| `<Authorize session onAuthorised onStarted onError>` | The cap step, then the Elapse window. |
| `<Meter session dock? controls? proof? onStopped onPauseRequest? onResumeRequest? onError>` | The live meter, its controls, and the receipt. |
| `<TxLink hash chainId?>` | A transaction as `0x4cbe…9143`, linked to the explorer. Nothing renders it for you. |

### `<Meter>` options

| Prop | Default | What it does |
| --- | --- | --- |
| `dock` | *(none)* | `"bottom-right"` or `"bottom-left"` floats the meter as a small capsule — a live dot, the clock, the amount — instead of a card in your layout. On a phone it spans the gutter. |
| `controls` | `true` | `false` hides Stop and the pause requests entirely, for a meter only you stop. |
| `proof` | `false` | Drops a card when the meter starts and when it ends, carrying that transaction. Off by default: most subscribers should never see a hash. |
| `onPauseRequest`, `onResumeRequest` | — | Show Pause and Resume as **requests to you**. A subscriber cannot pause a meter (only the merchant can), so the button calls your handler — nothing is signed, nothing reaches Elapse — and your server pauses with `subscriptions.pause`. Pause renders only on a Product that allows pausing; omit the props and neither control renders. |

Sound is on by default: two short synthesised notes when a meter starts and when it stops, never
one per second, with a mute the subscriber controls and the browser remembers. `sound={false}` on
the provider turns it off for everyone.

Every event carries `{ subscription, txHash?, explorerUrl? }`.

## Hooks

`useAuthorize(session)` and `useMeter(session)` return the same state the components render, for when
you want your own markup:

```tsx
const { elapsed, accrued, running, canStop, stop, receipt } = useMeter(session);
```

`@elapse/react/math` exports the meter's money math (`accruedNano`, `formatAmount`, …) on its own, for
a server or a test.

## Styling

`@elapse/react/styles.css` is plain CSS scoped to `.elapse`; no Tailwind needed. Change what you want
with CSS variables:

```css
.elapse {
  --elapse-accent: #7c3aed;
  --elapse-radius: 1rem;
  --elapse-font: "Inter", sans-serif;
  --elapse-bg: #ffffff;
  --elapse-fg: #101010;
  --elapse-muted: #6b7280;
}
```

The components follow the system's colour scheme; `data-elapse-theme="light"` or `"dark"` on a wrapper
pins one.

Every animation stops under `prefers-reduced-motion`, and the meter never animates per second.

## Two things this package will not do

- It never takes a secret key. Sessions are created on your server.
- It never shows your subscriber a hash, an address, or any other chain word unless you ask for it
  with `proof` or place a `<TxLink>` yourself. Otherwise those stay on your side, in the events.

MIT © Elapse
