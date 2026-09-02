# Elapse docs

You only pay what elapsed.

## Quickstart (Week 2+)

1. Create a product at `rateUsdPerSecond`.
2. Create a Checkout session. Send the subscriber to `session.url`.
3. Handle `subscription.canceled` with `seconds_elapsed`.

Signature header: `X-Elapse-Signature: t=unix,v1=hmac_sha256`

See the [product spec](https://github.com/furqaannabi/elapse) README and `examples/saas`.
