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
| `src/StreamFactory.sol` | Clones, fee and treasury knobs (10 % ceiling), `createWithPermit` (one signature, one transaction), `settleBatch` |
| `src/MockUSD.sol` | Six-decimal ERC-20 with `permit` and a public `mint`; same shape as AUSD, for tests and for testnet until real AUSD can be obtained |
| `script/Deploy.s.sol` | Deploys factory (+ MockUSD off mainnet) and writes `deployments/<chainId>.json` |
| `test/` | 51 tests named after their FR ids, plus a six-invariant handler suite |

## The kill gate (FR-CON-073)

`test_FR_CON_073_kill_gate_83_seconds`: create → deposit → start → 83 s → cancel.
Merchant receives 83 × rate minus 1 %, treasury receives the 1 %, the subscriber
gets the rest back, the stream is empty. Passing locally.

**Passed on Monad testnet 2026-09-05** against `MockUSD`, run with
`./killgate-testnet.sh start` / `cancel` (the meter ran 220 s):

| | |
| --- | --- |
| Factory | [`0x2A27160FC556819f2b3D293bbFA0aac5360E3C40`](https://testnet.monadscan.com/address/0x2A27160FC556819f2b3D293bbFA0aac5360E3C40) |
| Stream | [`0x86776c5bE46d01242285aaC66040B3bf0634cd8a`](https://testnet.monadscan.com/address/0x86776c5bE46d01242285aaC66040B3bf0634cd8a) |
| Start (mint, create, approve, deposit, start) | blocks 59876435–59876449 |
| Cancel | [`0x6ae9632f15b27f20d1cb234deefd6d2f7f1612e2b112a235c1b3addcbeb94576`](https://testnet.monadscan.com/tx/0x6ae9632f15b27f20d1cb234deefd6d2f7f1612e2b112a235c1b3addcbeb94576), block 59877161 |
| Result | `Settled(220, 880000, 8800)` then `StreamCanceled(…, 220, 880000, 13520000)`: merchant +0.871200, treasury +0.008800, subscriber +13.520000, stream 0 |

Testnet AUSD exists but cannot be minted by us and no faucet dispenses it, so the
gate ran on the mock. Repeat against real AUSD before 13 Oct once someone at Agora
or Monad sends testnet AUSD to the deployer. The "indexed by Envio" clause of
FR-CON-073 **passed 2026-09-05**: a fresh `envio dev` in `indexer/` synced from block
59873725 to head, registered the clone from `StreamCreated`, and GraphQL returned
`Stream.status == Canceled`, `settledSeconds 220`, `settledAmount 880000`, `settledFee 8800`,
`refunded 13520000`, four ledger rows, all five logs `ingestStatus: sent` to the local API.

## Current testnet deployment (2026-09-05, keeper cancel)

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
