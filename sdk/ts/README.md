# @elapse/sdk

Per-second billing on Monad, integrated like Stripe. **You only pay what elapsed.**

```sh
npm install @elapse/sdk
```

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

Send the subscriber to `session.url`. They start a meter, watch the counter tick, and cancel whenever. Your server finds out through a signed webhook, not a cron job.

## Surface

| Method | REST |
| --- | --- |
| `products.create / retrieve / list` | `POST /v1/products`, `GET /v1/products/:id`, `GET /v1/products` |
| `checkout.sessions.create` | `POST /v1/checkout/sessions` |
| `subscriptions.retrieve / list / cancel` | `GET /v1/subscriptions/:id`, `GET /v1/subscriptions`, `POST /v1/subscriptions/:id/cancel` |
| `customers.retrieve` | `GET /v1/customers/:id` |
| `invoices.list` | `GET /v1/invoices` |
| `webhooks.constructEvent(rawBody, header, secret)` | local |

Requests take the camelCase keys shown above. Responses are the API's objects as they come, snake_case, identical to the cURL tab and to webhook bodies.

## Webhooks

Six event types: `checkout.session.completed`, `subscription.created`, `subscription.updated`, `subscription.canceled`, `invoice.settled`, `invoice.payment_failed`. Never anything per second: compute a live meter from `rate_usd_per_second` and `started_at`.

Verify with the **raw** request body. If your framework parses JSON before your handler, disable that for the webhook route.

```ts
app.post("/webhooks/elapse", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = elapse.webhooks.constructEvent(req.body, req.header("x-elapse-signature"), process.env.ELAPSE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).end();
  }
  if (event.type === "subscription.canceled") {
    // event.data.object.seconds_elapsed, event.data.object.amount_settled
  }
  res.status(200).end();
});
```

`constructEvent` checks the timestamp is within 300 s and compares every signature in constant time. While you rotate a signing secret, pass both: `constructEvent(body, header, [newSecret, oldSecret])`.

## Errors

Everything thrown extends `ElapseError`: `ElapseAuthenticationError` (401/403), `ElapseInvalidRequestError` (400/404/422, and client-side validation), `ElapseRateLimitError` (429), `ElapseAPIError` (5xx, network, `code: "timeout"`), `ElapseSignatureVerificationError`. Network errors, 429 and 5xx are retried twice with backoff; every `create` and `cancel` carries an `Idempotency-Key`, so retries never double-create. Pass `{ idempotencyKey, timeoutMs }` as the last argument of any method.

## Keep the secret key server-side

`sk_…` keys authorise everything on your account. Read them from the server environment only. The SDK refuses to construct in a browser. Webhooks documentation: <https://docs.elapse.dev/webhooks>.

Node 20+. Zero runtime dependencies. MIT.
