# Acme GPU — an Elapse merchant in one file

## What this is

The smallest correct Elapse merchant. It creates a Product billed at $0.004 per second, prints a Checkout URL, and when the subscriber cancels it receives `subscription.canceled` and revokes access. No cron job: the webhook tells it.

It is the code the [Quickstart](https://docs.elapse.finance/quickstart) is built from, and the server in the demo video.

## Prerequisites

- Node 20 or newer.
- An Elapse dashboard account with a test secret key (Dashboard → Developers → API keys).

## Run it

```sh
git clone https://github.com/Codypharm/elapse
cd elapse/examples/saas
cp .env.example .env        # paste ELAPSE_SECRET_KEY and ELAPSE_API_URL
npm install
npm start
```

In a second terminal, forward your webhooks to this server. The first line it prints is your signing secret; put it in `.env` as `ELAPSE_WEBHOOK_SECRET` and restart `npm start`:

```sh
npx @elapse/cli listen --forward localhost:3000/webhooks
```

## What you will see

```
Product:  prod_9f2…  GPU · 4090  $0.004/s
Checkout: https://elapse.finance/c/cs_7Ha…
Webhooks: POST http://localhost:3000/webhooks
Listening on :3000

14:02:11  evt_1S2a…  subscription.created    → mark entitled sub_4Qe…
14:02:26  evt_1S2b…  subscription.canceled   → revoke access · 83s · $0.33
14:02:26  ↺ duplicate evt_1S2b…
```

Open the Checkout URL on your phone, press Start, wait a few seconds, press Cancel. The second line appears in your terminal with the seconds that elapsed and what was paid. `GET /access/sub_…` now answers `{"entitled":false,"reason":"canceled"}`.

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
| `src/boot.ts` | Product find-or-create, first Checkout session, server |
| `src/server.ts` | Node `http` routes: `/`, `/ok`, `/cancel`, `/access/:sub`, `/webhooks` |
| `src/webhooks.ts` | Verify, respond, act |
| `src/entitlements.ts` | In-memory dedupe set and entitlement map; replace with your database |
| `src/demo-check.ts` | `npm run demo:check` |
| `public/index.html` | The product page with the Start button; `ok.html` and `cancel.html` are where Checkout returns to; `acme.css` is Acme GPU's own look, not Elapse's |
