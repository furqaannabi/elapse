# The keeper may pause and resume, so a merchant can bill only while its resource is working
2026-09-19 · Decided by Furqaan · Status: accepted

## Context

`examples/lambda` sells per-second serverless compute. Run on the live testnet stack showed the problem in one line:

```
16:26:31  ▶ run sub_…  → "Hello, world!"  (0ms)   [1/20 today]
16:27:32  evt_…  subscription.canceled  → session closed · 62s · $0.12
```

The compute took 0 ms; the meter billed 62 seconds, because the session stays open and the example's idle timeout (FR-EXM-117) waits 60 s to see whether more code arrives. That is the session model working as designed, but to anyone watching it reads as "Elapse charged me for nothing", which is the opposite of "you only pay what elapsed". Furqaan chose per-invocation billing: the meter runs only while code runs.

What the stack could do today:

- **Cancel after each run.** `cancel()` refunds the escrow and ends the stream, so the next run needs a new permit — a Face ID per invocation. Rejected.
- **The merchant pauses with its own key.** `pause()` and `resume()` are `onlyParty` (subscriber or merchant). Merchants in Elapse never hold a key; the payout address is an address, not a signer. Rejected as a change to the whole trust model.
- **Tune the idle timeout**, or add an "End session" button the merchant's own UI owns. Cheapest, no contract change, but the subscriber still pays for a tail they did not use. Rejected for the demo's sake.
- **The keeper pauses.** The platform relayer already acts as the factory's keeper and may `cancel()` on the merchant's behalf (ADR 2026-09-05). `pause()`/`resume()` deliberately refuse it: *"The keeper gets no such power."*

## Decision

`pause()` and `resume()` become `onlyPartyOrKeeper`, exactly as `cancel()` already is. `_refuseSubscriber` and FR-CON-057 are untouched, so a subscriber still cannot pause, resume or stop a running merchant-started meter. The platform gains `POST /v1/subscriptions/:id/pause` and `/resume` for merchants, mirroring the cancel route; `@elapse/sdk` 0.3.0 gains `subscriptions.pause(id)` and `subscriptions.resume(id)`; `examples/lambda` resumes before each invocation and pauses after it, including when the run fails.

The honest limit, accepted with the decision: each run costs two transactions, so a 0 ms invocation bills roughly **1–3 seconds** of confirmation time. An on-chain time meter cannot be finer than a block. This is billing per invocation, not per millisecond.

## Consequences

- **A new keeper power.** A compromised relayer could pause a merchant's meters. No money moves on pause and paused time is never billed (BR-CON-003), so the exposure is a merchant's own revenue stopping, not a subscriber's funds — the same class of trust the keeper already holds through `cancel()`.
- **Redeploy.** New `AccrualStream` implementation means a new `StreamFactory` on testnet: `deployments/10143.json`, the API's `FACTORY` on EC2, and the Envio indexer's address and start block all change, and the indexer must re-sync before new streams appear. Streams created before the redeploy stay on the old factory and keep the old rules.
- **Gas.** Two relayer transactions per run instead of none. The relayer runway sample (FR-WRK-074) should be re-read after the example runs a while.
- **The example's idle timeout stops being a billing control** and becomes session cleanup only: idle time now costs the subscriber nothing, so the window can be generous.
- **Frozen SDK surface.** §4.2 of the detailed document gains two methods; that edit is Furqaan's (BR-SDK-001).
- Supersedes nothing. It narrows the comment on FR-CON-018 that the keeper gets no pause power.
