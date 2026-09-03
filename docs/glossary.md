# Glossary

Use these words exactly, in code, docs, UI copy, and conversation. Never abbreviate; never invent synonyms.

| Term | Meaning | Id prefix |
| --- | --- | --- |
| **Merchant** | The developer or business integrating Elapse. Owns API keys, products, webhook endpoints, a payout address. | — |
| **Subscriber** / **Customer** | The merchant's end user paying per second. "Customer" in API objects, "subscriber" in prose. Never "wallet user". | `cus_` |
| **Product** | Something billed at `rate_usd_per_second`. | `prod_` |
| **Rate** | USD per second, as a decimal string (`"0.004"`). Never a float. | — |
| **Checkout session** | The hosted page a subscriber is sent to; carries product, success and cancel URLs. | `cs_` |
| **Subscription** | A running meter for one customer on one product. Maps 1:1 to an `AccrualStream`. Status `incomplete → active → paused \| canceled`. | `sub_` |
| **Meter** | UI word for a subscription's live counter. | — |
| **Escrow** | AUSD deposited per subscription; unspent portion refunded on cancel. | — |
| **Accrued** | Live amount owed so far: rate × elapsed, millisecond resolution, floored. | — |
| **Settled** | Amount actually pulled to the merchant: whole seconds × rate. Always ≤ accrued. | — |
| **Invoice** / **Settlement** | One `settle()` pull for a period (keeper or cancel). | `in_` |
| **Keeper** | The service that calls `settle()` on running streams every K seconds. | — |
| **Relayer** / **Paymaster** | Pays gas so subscribers never hold MON. | — |
| **Webhook endpoint** | A merchant URL plus signing secret. | `wh_`, secret `whsec_` |
| **Event** | Something that happened, in Stripe shape. Six types in MVP. | `evt_` |
| **Delivery** | One attempt to POST an event to an endpoint. Up to 8 per event per endpoint. | — |
| **Ingest** | The API endpoint the indexer posts chain events to. Idempotent on `txHash + logIndex`. | — |
| **Test mode** / **Live mode** | Separate keys and data. `sk_test_` / `sk_live_`. | — |
| **Test clock** | Test-mode feature to fast-forward a subscription for demos. | — |
| **Judge mode** | Hidden panel on the checkout showing chain detail. The only place chain words appear on the subscriber side. | — |
| **AccrualStream** | The per-subscription contract: start, pause, resume, cancel, settle. | — |
| **StreamFactory** | Deploys `AccrualStream` clones. | — |

## Event types (MVP)

`checkout.session.completed` · `subscription.created` · `subscription.updated` · `subscription.canceled` · `invoice.settled` · `invoice.payment_failed`

## Words we do not use on the subscriber side

wallet, connect, gas, seed phrase, 0x…, Monad, transaction, on-chain, token, AUSD. Say: sign in with Face ID, add funds, start, cancel, you paid $0.33.
