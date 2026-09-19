# Acme GPU — an Elapse merchant in one file

## What this is

The smallest correct Elapse merchant. It creates a Product billed at $0.004 per second and serves one product page where the subscriber authorises and watches the meter **without leaving the page** — `<Authorize>` and `<Meter>` from [`@elapse/react`](../../sdk/react), with Face ID in a frame Elapse opens over the page. When the subscriber stops, the server receives `subscription.canceled` and revokes access. No cron job: the webhook tells it.

It is the code the [Quickstart](https://docs.elapse.finance/quickstart) is built from, and the server in the demo video.

## Prerequisites

- Node 20 or newer.
- An Elapse dashboard account with a test secret key (Dashboard → Developers → API keys).
- A payout address on that account (Dashboard → Settings). Without one, `npm start` stops at "Set a payout address in Settings before creating checkout links."
- Nothing else: `npm start` bundles the page (esbuild) before it serves, so there is no CDN script and no build step to remember.

## Run it

```sh
git clone https://github.com/furqaannabi/elapse
cd elapse/examples/saas
cp .env.example .env        # paste ELAPSE_SECRET_KEY and ELAPSE_PUBLISHABLE_KEY
npm install
npm start
```

In a second terminal, forward your webhooks to this server. The first line it prints is your signing secret; put it in `.env` as `ELAPSE_WEBHOOK_SECRET` and restart `npm start`:

```sh
npx @elapse/cli listen --forward localhost:3000/webhooks
```

The CLI registers a `cli://` endpoint for you on the dashboard. In production you add your own `https://` URL under Developers → Webhooks instead, put the secret it shows once in `ELAPSE_WEBHOOK_SECRET`, and Elapse delivers straight to it with retries; `src/webhooks.ts` does not change.

## What you will see

```
Product:  prod_9f2…  GPU · 4090  $0.004/s
Session:  cs_7Ha…  (authorised on the product page with @elapse/react)
Webhooks: POST http://localhost:3000/webhooks
Listening on :3000

14:02:11  evt_1S2a…  subscription.created    → mark entitled sub_4Qe…
14:02:26  evt_1S2b…  subscription.canceled   → revoke access · 83s · $0.33
14:02:26  ↺ duplicate evt_1S2b…
```

Open http://localhost:3000 on your phone, choose how long the meter may run, press Authorise, wait a few seconds, press Stop — all on Acme’s own page. The second line appears in your terminal with the seconds that elapsed and what was paid. `GET /access/sub_…` now answers `{"entitled":false,"reason":"canceled"}`.

Before recording, `npm run demo:check` signs a canceled event with your own secret and confirms the server revokes access.

## How the handler works

`src/webhooks.ts`, under 50 lines:

1. Read the raw request body. Never parse it first; the signature covers the exact bytes.
2. `elapse.webhooks.constructEvent(rawBody, signature, secret)`. Anything that fails is a 400 and nothing else happens.
3. Answer 200 immediately, then do the work: skip Event ids seen before, apply the action for the type, log one line.

Six types, six actions: provision on `checkout.session.completed`, entitle on `subscription.created`, sync on `subscription.updated`, revoke on `subscription.canceled` and `invoice.payment_failed`, book revenue on `invoice.settled`.

## Files

| File | What |
| --- | --- |
| `src/index.ts` | `npm start`: reads `.env`, boots, prints |
| `src/boot.ts` | Product find-or-create, first checkout session, server |
| `src/server.ts` | Node `http` routes: `/`, `/ok`, `/cancel`, `/access/:sub`, `/webhooks` |
| `src/webhooks.ts` | Verify, respond, act |
| `src/entitlements.ts` | In-memory dedupe set and entitlement map; replace with your database |
| `src/demo-check.ts` | `npm run demo:check` |
| `src/web/mount.tsx` | The page's island: `<ElapseProvider>`, then `<Authorize>` and `<Meter dock="bottom-right" proof>` |
| `scripts/build-web.mjs` | `npm run build:web`: esbuild bundles that island and the components' stylesheet into `dist/` |
| `public/index.html` | The product page and its `#elapse` mount point; `ok.html` and `cancel.html` are where the success and cancel URLs land; `acme.css` is Acme GPU's own look — including the CSS variables that re-dress the Elapse components |
