# Contracts — Foundry

The meter itself. `StreamFactory` spawns one `AccrualStream` clone per subscription;
the clone holds the subscriber's escrow, pays the merchant whole seconds × rate
(minus the platform fee) on every settle, and ends at the exact second the cap
is reached. Nothing here needs a transaction per second: the UI ticks from
`ratePerSecond` and `startedAt`.

Spec: [`docs/specs/contracts-frd.md`](../docs/specs/contracts-frd.md) (signed 2026-09-05).
Money movement is reviewed by Furqaan on arrival.

## Setup

```sh
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts
forge install --no-git --shallow OpenZeppelin/openzeppelin-contracts@v5.1.0
forge install --no-git --shallow foundry-rs/forge-std
forge test
```

`lib/` is gitignored, so the two installs are needed once per clone.

## What is here

| File | Purpose |
| --- | --- |
| `src/AccrualStream.sol` | The meter: escrow with a hard cap, start / pause / resume / cancel, settle with fee split, cap end, relayed cancel by signature |
| `src/StreamFactory.sol` | Clones, fee and treasury knobs (10 % ceiling; 2 % deployed), `createWithPermit` (one signature, one transaction), `settleBatch` |
| `src/MockUSD.sol` | Foundry test double: six-decimal ERC-20 with `permit` and a public `mint`, same shape as AUSD. Never deployed (FR-CON-063, ADR 2026-09-13) |
| `script/Deploy.s.sol` | Deploys the factory and writes `deployments/<chainId>.json` |
| `test/` | 55 tests named after their FR ids, plus a six-invariant handler suite |

## The kill gate (FR-CON-073)

`test_FR_CON_073_kill_gate_83_seconds`: create → deposit → start → 83 s → cancel.
Merchant receives 83 × rate minus the platform fee, treasury receives the fee (1 % at
the time of the gate, 2 % since [ADR 2026-09-08](../docs/decisions/2026-09-08-platform-fee-two-percent.md)),
the subscriber gets the rest back, the stream is empty. Passing locally.

**Passed on Monad testnet 2026-09-05** against `MockUSD`, run with
`./killgate-testnet.sh start` / `cancel` (the meter ran 220 s):

| | |
| --- | --- |
| Factory | [`0x2A27160FC556819f2b3D293bbFA0aac5360E3C40`](https://testnet.monadscan.com/address/0x2A27160FC556819f2b3D293bbFA0aac5360E3C40) |
| Stream | [`0x86776c5bE46d01242285aaC66040B3bf0634cd8a`](https://testnet.monadscan.com/address/0x86776c5bE46d01242285aaC66040B3bf0634cd8a) |
| Start (mint, create, approve, deposit, start) | blocks 59876435–59876449 |
| Cancel | [`0x6ae9632f15b27f20d1cb234deefd6d2f7f1612e2b112a235c1b3addcbeb94576`](https://testnet.monadscan.com/tx/0x6ae9632f15b27f20d1cb234deefd6d2f7f1612e2b112a235c1b3addcbeb94576), block 59877161 |
| Result | `Settled(220, 880000, 8800)` then `StreamCanceled(…, 220, 880000, 13520000)`: merchant +0.871200, treasury +0.008800, subscriber +13.520000, stream 0 |

The gate ran on the mock because the team held no testnet AUSD that day. The team
holds it now and live mode escrows AUSD on testnet ([ADR 2026-09-07](../docs/decisions/2026-09-07-add-money-and-ausd-live-on-testnet.md));
the checkout's Add money screen is how a subscriber's wallet gets some. The "indexed by Envio" clause of
FR-CON-073 **passed 2026-09-05**: a fresh `envio dev` in `indexer/` synced from block
59873725 to head, registered the clone from `StreamCreated`, and GraphQL returned
`Stream.status == Canceled`, `settledSeconds 220`, `settledAmount 880000`, `settledFee 8800`,
`refunded 13520000`, four ledger rows, all five logs `ingestStatus: sent` to the local API.

## Current testnet deployment (2026-09-19, only the merchant stops a held meter)

| | |
| --- | --- |
| Factory | [`0xD5851fB58A875cEBabf6828F93416A062D737907`](https://testnet.monadscan.com/address/0xD5851fB58A875cEBabf6828F93416A062D737907) · Sourcify exact match |
| Implementation | `0x349A1B04161A217ba1A47983cBb681600787Ba74` · Sourcify exact match |
| Owner | `0x35134987bB541607Cd45e62Dd1feA4F587607817` (the `hackathons` keystore) |
| Keeper (relayer) | `0x54669B09A651a72Bd0367caB21cdAd0bEC0a7d35`, set in the deploy run |
| Fee | 200 bps from the constructor |
| Block | 63882987, tx `0xec94e7f6…ac3098` |
| Why | FR-CON-057 amended: a subscriber may not stop a merchant-started stream in **any** state, held included ([ADR 2026-09-19](../docs/decisions/2026-09-19-only-the-merchant-stops-a-held-meter.md)). Held money is released by the merchant or by the keeper's unstarted sweep |

Streams created on an earlier factory keep that factory's rules; nothing migrates. A held session
created before this cutover can still be stopped by its subscriber.

## Previous testnet deployment (2026-09-19, the keeper may pause)

| | |
| --- | --- |
| Factory | [`0x6D6A5E80Fbe09552f2B604D23e207A76B85C8695`](https://testnet.monadscan.com/address/0x6D6A5E80Fbe09552f2B604D23e207A76B85C8695) · Sourcify exact match |
| Implementation | `0x08066b4561065A8b132C9Ef6bF6749c98449195e` · Sourcify exact match |
| Owner | `0x35134987bB541607Cd45e62Dd1feA4F587607817` (the `hackathons` keystore) |
| Keeper (relayer) | `0x54669B09A651a72Bd0367caB21cdAd0bEC0a7d35`, set in the deploy run |
| Fee | 200 bps from the constructor — no `setFee` needed, unlike every deployment before it |
| Block | 63828958, tx `0x4cbee535…759143` |
| Why | FR-CON-074: `pause()` and `resume()` accept the factory's keeper, so a merchant can bill only while its resource is working ([ADR 2026-09-19](../docs/decisions/2026-09-19-keeper-may-pause.md)) |

## Previous testnet deployment (2026-09-17, only the merchant stops)

| | |
| --- | --- |
| Factory | [`0xc430C8EE28AaaCbaBFE06CdB6A6900cE616DD357`](https://testnet.monadscan.com/address/0xc430C8EE28AaaCbaBFE06CdB6A6900cE616DD357) · Sourcify exact match |
| Implementation | `0x58312Cd745B214Dcab5728c31204B1DEDF5B0B35` · Sourcify exact match |
| Owner | `0x35134987bB541607Cd45e62Dd1feA4F587607817` (the `hackathons` keystore) |
| Keeper (relayer) | `0x54669B09A651a72Bd0367caB21cdAd0bEC0a7d35`, set in the deploy run |
| Fee | 200 bps, set by `setFee` after deploy (this build predates the 2 % constructor default of `b324cdc`) |
| Block | 63259976, tx `0xa4866e6f…166b0c` |
| Why | FR-CON-057: a merchant-started stream refuses the subscriber's cancel, pause and resume once running ([ADR 2026-09-17](../docs/decisions/2026-09-17-merchant-started-meters-only-merchant-stops.md)) |

## Previous testnet deployment (2026-09-14, merchant-started metering)

| | |
| --- | --- |
| Factory | [`0x4C3526d71365064e24A755AAb161e00CfA243649`](https://testnet.monadscan.com/address/0x4C3526d71365064e24A755AAb161e00CfA243649) · Sourcify exact match |
| Implementation | `0x25968D476062C48e82235F1a4B413F7AEdf23826` · Sourcify exact match |
| Owner | `0x35134987bB541607Cd45e62Dd1feA4F587607817` (the `hackathons` keystore; `elapse-dev` owned the previous factory) |
| Keeper (relayer) | `0x54669B09A651a72Bd0367caB21cdAd0bEC0a7d35`, set in the deploy run |
| Fee | 200 bps, set by `setFee` after deploy — `Deploy.s.sol` leaves the 100 bps constructor default ([ADR 2026-09-08](../docs/decisions/2026-09-08-platform-fee-two-percent.md)) |
| Block | 62451503, tx `0xd6670974…d4ce7a` |
| Why | FR-CON-019/055/056: `createWithPermitNoStart` funds without starting; the keeper may `start()`; an unstarted stream refunds in full on cancel |

## Previous testnet deployment (2026-09-07, relayed pause/resume)

| | |
| --- | --- |
| Factory | [`0x4B768dA0D29C084145f23Cd06b3b5fc2e07a2840`](https://testnet.monadscan.com/address/0x4B768dA0D29C084145f23Cd06b3b5fc2e07a2840) |
| Implementation | `0x3Ccb83A576FD4f8b30b1E46441d89CD2AF4D5586` |
| MockUSD | `0xD9E7Fc7d58D97daC5dc5501404fc1073A8aBE6C1` |
| Keeper (relayer) | `0x54669B09A651a72Bd0367caB21cdAd0bEC0a7d35`, set in the deploy run |
| Block | 60525591, tx `0xe443fae1…4d2611` |
| Why | FR-CON-018: `pauseFor`/`resumeFor` signed relays, `relayNonce` shared with `cancelFor` ([ADR](../docs/decisions/2026-09-07-subscriber-pause-signed-relay.md)) |

## Previous testnet deployment (2026-09-05, keeper cancel)

| | |
| --- | --- |
| Factory | [`0x656fa8B348981602ACf36faD07804E806Cc15d5B`](https://testnet.monadscan.com/address/0x656fa8B348981602ACf36faD07804E806Cc15d5B) |
| Implementation | `0x537F2E3Abb4E4434FF01e7A572e72841b2C7E2f1` |
| MockUSD | `0xB162dFDe7073eb1b4DD6279eFcD0568e9C09A21c` |
| Block | 60009700, tx `0x24b558d2…9f08d` |
| Why | FR-CON-054: `cancel()` also accepts `factory.keeper()` ([ADR](../docs/decisions/2026-09-05-keeper-may-cancel.md)) |

Proven the same day through the product path: merchant `subscriptions.cancel` → relayer `cancel()` as keeper, tx
[`0x7826a0c5…f7d7a`](https://testnet.monadscan.com/tx/0x7826a0c5d4faf04d5acf607bb3e741ee3779bca186f56007c90014e4e32f7d7a):
19 s elapsed, merchant +0.07524, treasury +0.00076, subscriber refunded 1.124. The kill-gate table above records the first factory.

## Tokens

Verified on chain 2026-09-05, not from docs:

| Chain | AUSD | Decimals | `permit` |
| --- | --- | --- | --- |
| Monad testnet, 10143 | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | 6 | yes |
| Monad mainnet, 143 | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | 6 | yes |

## Deploy

```sh
TREASURY=0x... forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_KEY
```

Writes `deployments/10143.json` with `factory`, `implementation`, `treasury`,
`feeBps`, `ausd`, `mockUsd`, `deployedAtBlock`. The API, indexer and docs read
that file. Keys come from the environment or a keystore, never from code.

## Events (the contract's API to the platform)

```
StreamCreated(stream, merchant, subscriber, token, ratePerSecond, maxEscrow)   factory
Deposited(from, amount, totalDeposited)
StreamStarted(merchant, subscriber, ratePerSecond, startedAt)
StreamPaused(at, reason)          reason is always 0 (manual); the cap ends a stream, it never pauses it
StreamResumed(at)
Settled(seconds, amount, fee)     amount is gross; merchant received amount − fee
StreamCanceled(at, secondsElapsed, amountSettled, amountRefunded)   cumulative totals
FeeChanged(bps, treasury)         factory
```

A cap end emits the same `Settled` + `StreamCanceled` pair as a cancel, back-dated
to the exhaustion second. The platform tells them apart by
`secondsElapsed == maxEscrow / ratePerSecond`.
