# Elapse

**You only pay what elapsed.**

Per-second subscriptions on Monad: protocol, merchant SDK, docs, and signed webhooks. Cancel at 83 seconds, pay 83 seconds. Your server finds out via webhook — not a cron job.

Track 2 · Monad Metropolis · Consumer Products & Payments.

## Surfaces

| Piece | Path | Job |
|---|---|---|
| Protocol | `contracts/` | Accrue AUSD per second; cancel; settle elapsed only |
| API | `api/` | Products, checkout sessions, webhook endpoints |
| Checkout | `checkout/` | Face ID, live USD ticker, no chain words |
| SDK | `sdk/ts` | `@elapse/sdk` |
| CLI | `cli/` | `elapse listen --forward` |
| Indexer | `indexer/` | Envio HyperIndex → platform ingest |
| Docs | `docs/` | Quickstart, webhooks, OpenAPI |
| Example | `examples/saas/` | Merchant in the demo video |

## SDK (target)

```ts
import { Elapse } from "@elapse/sdk";

const elapse = new Elapse({ secretKey: process.env.ELAPSE_SECRET_KEY });

const product = await elapse.products.create({
  name: "GPU · 4090",
  rateUsdPerSecond: "0.004",
});

const session = await elapse.checkout.sessions.create({
  product: product.id,
  successUrl: "https://merchant.example/ok",
  cancelUrl: "https://merchant.example/cancel",
});

const event = elapse.webhooks.constructEvent(
  rawBody,
  headers["x-elapse-signature"],
  process.env.ELAPSE_WEBHOOK_SECRET
);
```

No per-second webhooks. Accrue onchain; notify on `subscription.created`, `subscription.canceled`, `invoice.settled`, `invoice.payment_failed`.

## Week 1 kill

Start → cancel mid-stream → settle elapsed seconds on Monad testnet. If that does not work, the rest of the platform is theatre.

## Stack

Foundry · viem · Next.js · Privy · Envio · AUSD · pnpm

## License

MIT
