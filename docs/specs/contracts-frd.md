# Contracts (`contracts/` — StreamFactory + AccrualStream) — FRD

Status: **Draft — awaiting human sign-off** · Fee split (FR-CON-006, FR-CON-024, FR-CON-030, FR-CON-072, BR-CON-006) added 2026-09-04 from [ADR 2026-09-03 settlement fee](../decisions/2026-09-03-settlement-fee.md); it touches money movement, so Furqaan reviews before build. · Surface: Protocol (Solidity 0.8.24, Foundry, Monad) · Sources: detailed doc §2 "What Elapse is / is not", §3 Objects, §9 Architecture + "Contracts", §12 Week 1 (kill gate) and Week 5, §14, §15; `contracts/src/AccrualStream.sol`; `contracts/foundry.toml`; checkout FRD BR-CHK-002/003; meter FRD FR-MTR-004.

> **P0 — funding gap in the current contract.** `AccrualStream.cancel()` calls `token.transfer(merchant, amount)` but nothing ever moves tokens *into* the contract: there is no deposit/escrow function and no `approve`/`transferFrom` path. On any real token `cancel()` reverts (or silently returns `false`, which is not checked). There is also no `settle()`, no `pause`/`resume`, no refund, no `StreamFactory`, no SafeERC20, and no tests. The Week-1 kill gate (start → cancel mid-stream → settle elapsed on testnet, doc §12) cannot pass on this code. FR-CON-010–014 and FR-CON-030 close the gap.

## Problem

The protocol is the meter. A Subscriber must be able to fund a per-Subscription Escrow in AUSD, start, cancel at any second, and get back exactly what did not elapse; the Merchant must receive exactly whole-seconds × rate, no more; nobody may be charged past the pot. Everything downstream (indexer, events, webhooks, receipts) trusts these numbers, and no transaction may be needed per second (doc §2, §9).

## User stories

1. As a Subscriber, I want to deposit a fixed amount and know that is my maximum exposure, so that I never pay more than I funded (BR-CHK-002).
2. As a Subscriber, I want cancel to work mid-second and return unspent funds in the same transaction, so that "you paid 83 seconds · $0.33" is literally true.
3. As a Merchant, I want accrued AUSD pulled to my payout address in batches and on cancel, so that I book revenue without a transaction per second.
4. As the platform (keeper/relayer), I want to create Streams cheaply and settle many of them periodically, so that gas stays negligible on Monad.
5. As a Subscriber whose pot runs dry, I want the meter to stop at the exact second the funds ran out, so that I am never in debt and the Merchant learns via `invoice.payment_failed`.
6. As a judge, I want to read the contract address, events and settle semantics in the docs and verify a cancel on-chain (doc §6 item 8, §7 judge mode).

## Functional requirements

### Factory (doc §9 "StreamFactory.create(merchant, subscriber, token, ratePerSecond) → clone")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CON-001 | `StreamFactory.create(merchant, subscriber, token, ratePerSecond) returns (address stream)` deploys an EIP-1167 minimal-proxy clone of a single `AccrualStream` implementation and calls `initialize` on it. | Forge test: two `create` calls return distinct addresses whose `merchant/subscriber/token/ratePerSecond` getters match the arguments; clone gas < 1/5 of a full deploy. |
| FR-CON-002 | `create` reverts on `merchant == 0`, `subscriber == 0`, `token == 0`, `ratePerSecond == 0`. | Four revert tests. |
| FR-CON-003 | The factory emits `StreamCreated(address indexed stream, address indexed merchant, address indexed subscriber, address token, uint256 ratePerSecond)`. This is the event the indexer uses to discover clones (indexer FRD FR-IDX-002). | `vm.expectEmit` test. |
| FR-CON-004 | The factory exposes `implementation()`, `keeper()` and `owner()`; `setKeeper` is owner-only. Clones read `keeper` from the factory at call time. | Owner test; non-owner `setKeeper` reverts. |
| FR-CON-005 | `initialize` can be called once per clone and never on the implementation. | Re-init reverts `AlreadyInitialized`; implementation is initialised with dead values in its constructor. |
| FR-CON-006 | The factory holds the platform fee: `feeBps()` (default **100** = 1 %) and `treasury()` (the address that receives fees), both set by `setFee(uint16 bps, address treasury)`, owner-only, `bps ≤ MAX_FEE_BPS` (Undecided 8), `treasury != 0`. Clones read both from the factory at settle time (ADR 2026-09-03 settlement fee; see Undecided 9 for snapshot-at-create). Emits `FeeChanged(bps, treasury)`. | Owner test; non-owner `setFee` reverts; `bps > MAX_FEE_BPS` reverts; default `feeBps() == 100`. |

### Escrow deposit (doc §9 "Escrow per subscription is simpler for MVP: cancel refunds unspent")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CON-010 | `deposit(uint256 amount)` pulls `amount` of `token` from `msg.sender` into the stream via `safeTransferFrom` and increments `deposited`. Allowed in states `Created`, `Active`, `Paused`. | Balance of stream == `deposited` after any sequence of deposits. |
| FR-CON-011 | `deposit` reverts with `ZeroAmount` on 0 and with `Canceled` after cancel. | Two revert tests. |
| FR-CON-012 | `deposit` emits `Deposited(address indexed from, uint256 amount, uint256 totalDeposited)`. | `expectEmit`. |
| FR-CON-013 | `maxSeconds()` = `deposited / ratePerSecond` (integer division). Accrual is capped at `maxSeconds` (see FR-CON-040). | Fuzz: `accruedSeconds() <= maxSeconds()` always. |
| FR-CON-014 | `refundable()` = `deposited − settledAmount`; paid to the Subscriber on cancel (FR-CON-024). Dust below one second of rate is refunded, never kept. | Fuzz over `deposited`, `rate`, `elapsed`: `settledAmount + refund == deposited` after cancel. |
| FR-CON-015 | **Cap as a primitive** ([ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md)): `initialize` takes `maxEscrow`; `deposit` reverts `CapExceeded` when `deposited + amount > maxEscrow`; `maxSeconds()` is therefore bounded by `maxEscrow / ratePerSecond` and the Subscriber's exposure can never exceed `maxEscrow`. `maxEscrow` is immutable after `initialize` (FR-CON-053). `StreamCreated` carries `maxEscrow`. | Fuzz: `deposited ≤ maxEscrow` always; deposit over the cap reverts; `accruedSeconds() ≤ maxEscrow / rate`. |
| FR-CON-016 | **Permit path**: `StreamFactory.createWithPermit(merchant, subscriber, token, ratePerSecond, maxEscrow, deadline, v, r, s)` calls `IERC20Permit(token).permit(subscriber, factory, maxEscrow, deadline, v, r, s)`, creates the clone, pulls exactly `maxEscrow` from `subscriber` into it with `safeTransferFrom`, and starts it — one transaction, one signature, submitted by the relayer which pays gas. The permit's `value` must equal `maxEscrow` (never more), `deadline` is enforced by the token, and the token's nonce prevents replay. If `permit` reverts (already used, expired, wrong signer) the whole call reverts and no clone exists. Requires the token to implement ERC-2612 — **unverified for AUSD on Monad; check first** (Undecided 10). | Test with a permit-capable mock: one tx → clone exists, `deposited == maxEscrow`, `status == Active`; replayed permit reverts; `value ≠ maxEscrow` reverts `PermitMismatch`. |
| FR-CON-017 | **Relayed cancel**: `cancelFor(bytes signature)` accepts an EIP-712 authorisation `{stream, nonce, deadline}` signed by `subscriber` (or `merchant`) so the relayer can submit cancel on their behalf without the party holding MON; a per-stream nonce prevents replay. Direct `cancel()` from a party (FR-CON-050) stays. | Test: signed cancel from a stranger's tx settles and refunds correctly; replay reverts; expired reverts. |

### Lifecycle (doc §3 status machine, §9 "start, pause, cancel, settle")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CON-020 | States: `Created → Active → Paused ⇄ Active → Canceled`; `Created → Canceled` is allowed (abandoned funded session, checkout FRD FR-CHK-009); `Active → Canceled` also happens automatically at the cap (FR-CON-041). `Paused` is only ever a manual pause (`reason = 0`, FR-CON-022) for products with `allow_pause`. Exposed via `status()` enum. | State-machine test covers every legal edge and one illegal edge per state. |
| FR-CON-021 | `start()` requires `Created` and `deposited >= ratePerSecond` (at least one affordable second); sets `startedAt = block.timestamp`; emits `StreamStarted(merchant, subscriber, ratePerSecond, startedAt)`. | `start` with empty pot reverts `InsufficientDeposit`. |
| FR-CON-022 | `pause()` requires `Active`; accrual stops at `block.timestamp`; emits `StreamPaused(uint256 at, uint8 reason)` with `reason = 0` (manual — the only reason that exists since FR-CON-041). A `pause()` that observes exhaustion ends the stream instead (FR-CON-041). | `accruedSeconds()` is constant across `vm.warp` while paused; pause after exhaustion → `Canceled`. |
| FR-CON-023 | `resume()` requires `Paused` and remaining affordable seconds ≥ 1; starts a new active segment; paused wall-time is not billed. Emits `StreamResumed(uint256 at)` (see Undecided 3). | Pause 10 s, warp 100 s, resume, warp 5 s → `accruedSeconds() == 15`. |
| FR-CON-024 | `cancel()` from `Active`, `Paused` or `Created`: settles unsettled whole seconds (FR-CON-030: net to the Merchant, fee to the treasury), refunds `refundable()` to the Subscriber, sets `Canceled`; emits `Settled(secs, amount, fee)` (chunk) then `StreamCanceled(uint256 at, uint256 secondsElapsed, uint256 amountSettled)` with **cumulative gross** totals (matches the §5.3 payload `seconds_elapsed: 83, amount_settled: "0.33"`; the merchant's net is derivable from `Settled`). Current code emits the chunk, not the total — fix. | Deposit 1 000 000, rate 4 000, fee 100 bps, warp 83 s, cancel → merchant +328 680, treasury +3 320, subscriber +668 000, `StreamCanceled` args (83, 332 000). |
| FR-CON-025 | Cancel from `Created` refunds the full deposit and emits `StreamCanceled(at, 0, 0)`; no `Settled` event. | Test. |
| FR-CON-026 | All functions are no-ops-by-revert after `Canceled` (`AlreadyCanceled`). | One test per function. |

### Settlement (doc §9 "settle() batched by keeper every K seconds or on cancel"; §3 Invoice "settle() pull")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CON-030 | `settle()` computes `secs = accruedSeconds() − settledSeconds`, `amount = secs × ratePerSecond` (gross), `fee = amount × feeBps / 10 000` (integer division, rounds down in the merchant's favour), transfers `amount − fee` to `merchant` and `fee` to `treasury` with `safeTransfer` (the fee transfer is skipped when `fee == 0`), updates `settledSeconds`/`settledAmount` (gross)/`settledFee`, emits `Settled(uint256 seconds, uint256 amount, uint256 fee)`. Callable in `Active`, `Paused`, and (as part of) cancel. The fee is a share of settled seconds only; refunds (FR-CON-014) carry no fee. | After `settle`, `settledSeconds == accruedSeconds()`; merchant balance +`amount − fee`, treasury +`fee`; fuzz: `fee ≤ amount`, `(amount − fee) + fee == amount`. |
| FR-CON-031 | `accruedSeconds()` counts **whole seconds** of active time only: `min(activeSeconds, maxSeconds())`, where `activeSeconds` = sum of closed active segments + current open segment. Never negative; 0 before start. | Fuzz (`vm.warp` sequences of pause/resume) against a reference model in the test. |
| FR-CON-032 | `settle()` with `secs == 0` is a no-op that still succeeds (keeper batches must not revert on idle streams) and emits nothing. | Test. |
| FR-CON-033 | `StreamFactory.settleBatch(address[] streams)` calls `settle()` on each, continuing past individual failures (`try/catch`), so one bad stream cannot block a batch. | Batch of 3 with one canceled stream: two `Settled` events, no revert. |
| FR-CON-034 | The keeper cadence K is off-chain (worker/cron) and not enforced by the contract; the contract only guarantees the pull math. | Documented in `contracts/README.md`; no on-chain timer. |

### Cap reached (doc §3 "if the pot cannot settle"; §10 step 4 — reshaped 2026-09-04 by [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md) and William's cap-end decision)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CON-040 | When `activeSeconds >= maxSeconds()`, accrual is frozen at `maxSeconds()`; the exhaustion instant `exhaustedAt = segmentStart + (maxSeconds − closedActiveSeconds)` is computable in a view. | Deposit for 60 s, warp 1 000 s → `accruedSeconds() == 60`, `exhaustedAt() == startedAt + 60`. |
| FR-CON-041 | Reaching the cap **ends** the stream. The first `settle()`, `cancel()` or `pause()` that observes exhaustion on an `Active` stream settles the last whole seconds (FR-CON-030), refunds `refundable()` (dust below one second) to the Subscriber, sets `Canceled` with `canceledAt = exhaustedAt`, and emits `Settled` then `StreamCanceled(exhaustedAt, secondsElapsed, amountSettled)` — the same events as a subscriber cancel, back-dated to the exhaustion second. There is no `PotEmpty` pause: `maxEscrow` is immutable (FR-CON-015), so a paused stream could never be resumed. The platform distinguishes a cap end from a cancel by `secondsElapsed == maxSeconds()`, so no event signature changes (see Open). | `expectEmit` order test; `status() == Canceled`; `canceledAt == exhaustedAt`; a settle 1 000 s after exhaustion settles the same amount as one at the exhaustion second. |
| FR-CON-042 | Withdrawn 2026-09-04 (cap end, FR-CON-041): there is no resume after exhaustion and no "Add funds to resume". A subscriber who wants more time starts a new session, which is a new permit and a new cap (checkout FR-CHK-007). `deposit` above the cap already reverts `CapExceeded` (FR-CON-015). | No `resume` path from a cap-ended stream exists; every call after `Canceled` reverts `AlreadyCanceled` (FR-CON-026). |

### Access control (doc §2 "Not a wallet"; §9 relayer)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CON-050 | `start`, `pause`, `resume`, `cancel`: `msg.sender ∈ {subscriber, merchant}`; else `NotParty`. | Test per function with a stranger. |
| FR-CON-051 | `settle` and `settleBatch` are permissionless (they can only move accrued funds to the Merchant and the fee to the treasury); the keeper role is a convenience, not a gate. | Stranger can `settle`; funds still go to `merchant` and `treasury`. |
| FR-CON-052 | `deposit` is permissionless within the cap (FR-CON-015); refunds always go to `subscriber` regardless of who deposited (supports Aurora/any-chain deposits landing from a bridge address, doc §11). | Third party deposits; cancel refunds `subscriber`. |
| FR-CON-053 | No admin can withdraw, change `ratePerSecond`, `maxEscrow`, `merchant`, `subscriber` or `token` after `initialize`. No upgradeability. | Storage layout review; no setter exists. |

### Token safety, gas, chain (doc §9 "Gas: Relayer/paymaster so subscribers never hold MON"; "Money: AUSD")

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CON-060 | All token movements use OpenZeppelin `SafeERC20`; state is updated before any external transfer (checks-effects-interactions); `nonReentrant` on `deposit`, `settle`, `cancel`. | Test with a token that returns `false`; test with a reentrant token. |
| FR-CON-061 | Fee-on-transfer or rebasing tokens are out of scope; `deposited` is the amount *requested*, and `initialize` documents the assumption. AUSD is a plain, non-yield-bearing ERC-20 (doc §9). | Documented; a mock fee token test is `skip`ped with the reason. |
| FR-CON-062 | `contracts/script/Deploy.s.sol` deploys implementation + factory to Monad testnet (chain id **10143**) and, in Week 5, mainnet (**143**); addresses are written to `contracts/deployments/<chainId>.json` and consumed by API, indexer and docs. | `forge script --rpc-url monad_testnet` succeeds; JSON present; `foundry.toml` gains `monad_mainnet`. |
| FR-CON-063 | A `MockUSD` (6 decimals, public `mint`) ships for tests and for testnet if no AUSD testnet address exists (doc §12 "stand-in test USD"). | Deployed alongside the factory on 10143. |
| FR-CON-064 | Gas sponsorship: the contract makes no assumption that a relayer is `msg.sender`; sponsorship happens at the wallet layer (see Undecided 4). Subscriber calls remain callable directly by the Subscriber EOA/smart account. | No `trustedForwarder` logic in Week 1. |

### Tests and the Week-1 kill gate (doc §12)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-CON-070 | Foundry unit tests for every FR above, named `test_FR_CON_nnn_*`. | `forge test` green; coverage ≥ 90 % lines on `AccrualStream`, `StreamFactory`. |
| FR-CON-071 | Fuzz tests over `deposited ∈ [0, 1e30]`, `rate ∈ [1, 1e24]`, warp sequences of up to 16 pause/resume/settle steps: elapsed math against a Solidity reference model in the test. | `forge test --fuzz-runs 10000` green. |
| FR-CON-072 | Invariant test (`forge invariant`): `settledAmount ≤ accruedSeconds() × rate ≤ deposited`, `settledFee ≤ settledAmount × feeBps / 10 000`, `tokenBalance(stream) == deposited − settledAmount` before cancel (`settledAmount` is gross: merchant net + treasury fee), `== 0` after; `merchantReceived + treasuryReceived == settledAmount`. | Handler contract with random actor actions, including `setFee` between steps. |
| FR-CON-073 | **Kill-gate milestone (end of Week 1):** on Monad testnet 10143 with MockUSD or AUSD: `create → deposit → start → warp/wait ≥ 83 s → cancel` yields Merchant balance == `83 × rate` (± the seconds actually elapsed) and Subscriber refund == remainder; `StreamCanceled` and `Settled` visible in the explorer and indexed by Envio (indexer FRD FR-IDX-050). | Recorded tx hashes in `contracts/README.md`; if this fails, doc §12: do not pivot to a monthly wrapper. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-CON-001 | The Subscriber can never owe more than `deposited`; accrual is capped by the pot, not by whoever calls `settle` (BR-CHK-002). |
| BR-CON-002 | Settlement is whole seconds × rate; there is no fractional-second charge anywhere on-chain (BR-CHK-003, FR-MTR-004). |
| BR-CON-003 | Paused time is never billed; pot-empty pauses are back-dated to the exhaustion second, not to the settling block. |
| BR-CON-004 | No transaction per second: nothing in the protocol requires periodic on-chain writes; the UI derives the live figure from `ratePerSecond` and `startedAt`. |
| BR-CON-005 | `ratePerSecond` is in token base units per second (doc §3 "ratePerSecond wei"); the API must refuse a `rate_usd_per_second` that is not exactly representable in the token's decimals rather than round (API FRD BR-API-004). |
| BR-CON-006 | Money leaves a stream only to `merchant` (settle, net), `treasury` (settle, fee) or `subscriber` (refund). There is no owner sweep: the fee is only ever a share of settled seconds, never of the deposit, and the owner cannot move escrow (ADR 2026-09-03 settlement fee). |
| BR-CON-007 | Escrow earns no yield and is never lent (doc §9, §14 "Yield on escrow: OUT"). |
| BR-CON-008 | Events are the contract's API to the platform: every state change emits exactly one lifecycle event, and `Settled` is emitted for every non-zero pull. |

## Data / interfaces

```
StreamFactory
  create(merchant, subscriber, token, ratePerSecond, maxEscrow) → stream      event StreamCreated(stream, merchant, subscriber, token, ratePerSecond, maxEscrow)
  createWithPermit(merchant, subscriber, token, ratePerSecond, maxEscrow, deadline, v, r, s) → stream   (permit → create → transferFrom → start; relayer submits)
  settleBatch(address[] streams)                                     setKeeper(address) · keeper() · implementation()
  setFee(uint16 bps, address treasury) · feeBps() · treasury()        event FeeChanged(bps, treasury)
AccrualStream (clone)
  storage: merchant, subscriber, token, ratePerSecond, maxEscrow, cancelNonce, status, startedAt, segmentStart, closedActiveSeconds,
           pausedAt, pauseReason, deposited, settledSeconds, settledAmount (gross), settledFee
  views:   status() accruedSeconds() unsettledSeconds() maxSeconds() exhaustedAt() refundable()
  writes:  initialize deposit start pause resume settle cancel cancelFor(signature)
  events:  Deposited(from, amount, total) StreamStarted(merchant, subscriber, ratePerSecond, startedAt)
           StreamPaused(at, reason) StreamResumed(at) Settled(seconds, amount, fee) StreamCanceled(at, secondsElapsed, amountSettled)
  errors:  NotParty AlreadyInitialized InvalidState ZeroAmount InsufficientDeposit AlreadyCanceled CapExceeded PermitMismatch BadSignature
```

Dependencies: `forge install OpenZeppelin/openzeppelin-contracts` (Clones, SafeERC20, ReentrancyGuard, Ownable). `foundry.toml` keeps `evm_version = "prague"` unless Monad tooling objects (verify in Week 1).

## Undecided (human)

1. **Escrow model.** Doc offers per-Subscription Escrow or a shared customer-balance contract. Options: (a) per-Subscription Escrow in the clone, (b) `CustomerBalance` contract with pull-from-balance, (c) both. **Recommend (a)** — the doc calls it simpler and it makes "cancel refunds unspent" a one-liner.
2. ~~**Pot-empty signalling.**~~ **Decided 2026-09-04 (William):** the cap ends the stream and emits the ordinary `Settled` + `StreamCanceled` pair back-dated to the exhaustion second (FR-CON-041). No `reason = 1`, no sixth event.
3. **Resume event.** The doc lists no resume event. (a) add `StreamResumed(at)`; (b) re-emit `StreamStarted`; (c) no event, indexer infers from next `Settled`. **Recommend (a)** — the platform needs it for `subscription.updated`.
4. **Gas sponsorship mechanism (Week 3).** Narrowed by [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md): the subscriber signs (permit, cancel authorisation) and the relayer submits, so no subscriber transaction exists on the happy path. (a) Privy smart wallet + paymaster stays the fallback only if AUSD lacks `permit` (Undecided 10); (c) EIP-2771 is out.
5. ~~**Who calls `StreamFactory.create`.**~~ **Decided 2026-09-04 (Furqaan, [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md)): (a)** the platform relayer at checkout via `createWithPermit` (FR-CON-016). Whether plain `create` stays permissionless for (b)/(c) is Undecided 11.
6. **Keeper cadence K.** 60 s, 5 min, or only on cancel for the demo. **Recommend 5 min** on testnet; the demo relies on cancel-time settlement.
7. **AUSD testnet address and decimals.** Unknown from the doc; confirm on Monad testnet in Week 1, else `MockUSD` (FR-CON-063).
8. **Fee cap `MAX_FEE_BPS`.** (a) 1 000 (10 %); (b) 500 (5 %); (c) no cap. **Recommend (a)** — a cap bounds the damage of a compromised owner key; the dashboard copy "Contact us for volume pricing" only ever lowers the rate.
9. **When the fee rate binds.** (a) read from the factory at each settle, as the [fee ADR](../decisions/2026-09-03-settlement-fee.md) says, so a rate change applies to running streams at their next settle; (b) snapshot `feeBps` into the clone at `create`, so a running stream keeps the rate it started under and a change applies to new streams only. William and Furqaan decide; (a) stands until then.
10. **AUSD ERC-2612 support on Monad.** Must be verified on chain before contract work (the ADR's own condition). If absent: (a) `approve` transaction signed by the subscriber through a Privy smart wallet + paymaster; (b) a wrapper token with `permit`; (c) MockUSD with `permit` on testnet and decide for mainnet in Week 5. Furqaan decides after checking.
11. **Plain `create` exposure.** (a) keep `create` permissionless alongside `createWithPermit`; (b) `create` callable by the factory keeper only. **Recommend (a)** per the ADR's "never a gate" spirit for settle, but Furqaan owns the relayer trust model.

## Open

- Doc §5.2 names the first event `StreamOpened`; §9 and the code say `StreamStarted`. This FRD uses `StreamStarted`; docs must be corrected.
- Merchant-initiated pause (doc §5.1 "Pause / resume / rate change") — rate change is **out** (FR-CON-053); confirm.
- Whether `StreamCanceled` should also carry `amountRefunded` for the receipt (would extend the §5.3 payload).
- Cap end and the frozen event catalog: **decided 2026-09-04 (William)** — the platform derives a cap end from `secondsElapsed == maxSeconds()` and fires `invoice.payment_failed` alongside `subscription.canceled` (API FR-API-051/071), so all six §5.1 types survive and no contract event changes. Nothing further is required of the contract.

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-04 | Claude (for William) | Fee split from [ADR 2026-09-03 settlement fee](../decisions/2026-09-03-settlement-fee.md) (dashboard decision 4b): FR-CON-006 factory `feeBps`/`treasury`, FR-CON-024/030 net + fee transfers, FR-CON-051, FR-CON-072 invariant, BR-CON-006, `Settled` gains `fee`, Undecided 8–9. Awaiting Furqaan's review. |
| 2026-09-04 | Claude (for William) | [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md) applied: FR-CON-015 `maxEscrow` cap primitive, FR-CON-016 `createWithPermit` relayed path, FR-CON-017 relayed cancel by signature, FR-CON-052/053, Data block, Undecided 4 narrowed, 5 closed, 10–11 added, Open on out-of-funds. Furqaan signs before code. |
| 2026-09-04 | Claude (for William) | Cap end decided (William, 2026-09-04): FR-CON-041 ends the stream at the cap with the ordinary Settled + StreamCanceled pair, FR-CON-042 withdrawn, FR-CON-020/022 adjusted, Undecided 2 closed. Money movement — Furqaan signs before code. |
