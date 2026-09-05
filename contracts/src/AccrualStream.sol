// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// The one factory read a clone makes at call time (FR-CON-004): who the keeper is right now.
interface IKeeperSource {
    function keeper() external view returns (address);
}

/// @title AccrualStream
/// @notice One per-second meter: one Merchant, one Subscriber, one product rate,
///         one escrow. The Subscriber can never be charged past the escrow, the
///         Merchant receives exactly whole seconds × rate (minus the platform
///         fee), and reaching the cap ends the stream at that exact second.
///
///         Deployed as an EIP-1167 clone by `StreamFactory`; `initialize` runs
///         once per clone. Nothing here requires a transaction per second: the
///         UI derives the live figure from `ratePerSecond` and `startedAt`.
///
/// @dev Spec: docs/specs/contracts-frd.md (FR-CON-010–072). Money movement:
///      SafeERC20 everywhere, checks-effects-interactions, nonReentrant on every
///      function that transfers. Money leaves only to `merchant` (settle, net),
///      `treasury` (settle, fee) or `subscriber` (refund) — BR-CON-006.
contract AccrualStream is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ──────────────────────────────────────────────────────────────

    /// FR-CON-020. `Created → Active → Paused ⇄ Active → Canceled`; `Created → Canceled`.
    enum Status {
        Created,
        Active,
        Paused,
        Canceled
    }

    // ─── Immutable-after-initialize (FR-CON-053) ────────────────────────────

    address public factory;
    address public merchant;
    address public subscriber;
    IERC20 public token;
    /// Token base units per second (BR-CON-005).
    uint256 public ratePerSecond;
    /// The Subscriber's maximum exposure, in token base units (FR-CON-015).
    uint256 public maxEscrow;
    /// Fee snapshotted at create (FR-CON-006, Undecided 9). Basis points.
    /// Packed with `treasury` and `_initialized` into one slot so `initialize`
    /// costs one SSTORE fewer on every checkout.
    uint16 public feeBps;
    /// Receives `feeBps` of every settlement (FR-CON-006).
    address public treasury;
    bool private _initialized;

    // ─── State ──────────────────────────────────────────────────────────────

    Status public status;
    /// Wall-clock start of the first active segment. 0 before start.
    uint256 public startedAt;
    /// Start of the current active segment (after a resume it moves forward).
    uint256 public segmentStart;
    /// Active seconds in closed segments (before the current one).
    uint256 public closedActiveSeconds;
    /// When the stream paused or ended. 0 while active.
    uint256 public pausedAt;
    /// Total pulled into escrow (FR-CON-010).
    uint256 public deposited;
    /// Whole seconds already paid for (FR-CON-030).
    uint256 public settledSeconds;
    /// Gross settled: net to merchant + fee to treasury (FR-CON-030).
    uint256 public settledAmount;
    /// The fee part of `settledAmount`.
    uint256 public settledFee;
    /// Replay protection for `cancelFor` (FR-CON-017).
    uint256 public cancelNonce;

    // ─── Events (the contract's API to the platform, BR-CON-008) ────────────

    event Deposited(address indexed from, uint256 amount, uint256 totalDeposited);
    event StreamStarted(address indexed merchant, address indexed subscriber, uint256 ratePerSecond, uint256 startedAt);
    event StreamPaused(uint256 at, uint8 reason);
    event StreamResumed(uint256 at);
    event Settled(uint256 seconds_, uint256 amount, uint256 fee);
    event StreamCanceled(uint256 at, uint256 secondsElapsed, uint256 amountSettled, uint256 amountRefunded);

    // ─── Errors ─────────────────────────────────────────────────────────────

    error NotParty();
    error NotFactory();
    error AlreadyInitialized();
    error InvalidState();
    error ZeroAmount();
    error InsufficientDeposit();
    error AlreadyCanceled();
    error CapExceeded();
    error BadSignature();

    // ─── Lifecycle of the implementation itself ─────────────────────────────

    /// The implementation is initialised with dead values so it can never be
    /// used directly (FR-CON-005). Clones start with zeroed storage and call
    /// `initialize`.
    constructor() {
        _initialized = true;
        status = Status.Canceled;
    }

    /// @notice Called once by the factory on a fresh clone (FR-CON-001, FR-CON-005).
    function initialize(
        address merchant_,
        address subscriber_,
        address token_,
        uint256 ratePerSecond_,
        uint256 maxEscrow_,
        uint16 feeBps_,
        address treasury_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        factory = msg.sender;
        merchant = merchant_;
        subscriber = subscriber_;
        token = IERC20(token_);
        ratePerSecond = ratePerSecond_;
        maxEscrow = maxEscrow_;
        feeBps = feeBps_;
        treasury = treasury_;
        // status is Created (0) by default in a clone.
    }

    // ─── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyParty() {
        if (msg.sender != subscriber && msg.sender != merchant) revert NotParty();
        _;
    }

    /// A party, or the factory's current keeper (FR-CON-054, decided 2026-09-05): the platform
    /// relayer may stop a meter on the merchant's behalf. Cancel can only pay elapsed seconds
    /// to the merchant and refund the rest, so this grants no power over funds.
    modifier onlyPartyOrKeeper() {
        if (msg.sender != subscriber && msg.sender != merchant && msg.sender != IKeeperSource(factory).keeper()) revert NotParty();
        _;
    }

    modifier notCanceled() {
        if (status == Status.Canceled) revert AlreadyCanceled();
        _;
    }

    // ─── Escrow (FR-CON-010–015) ────────────────────────────────────────────

    /// @notice Pull `amount` of `token` from the caller into escrow. Permissionless
    ///         within the cap (FR-CON-052); refunds always go to `subscriber`.
    function deposit(uint256 amount) external nonReentrant notCanceled {
        if (amount == 0) revert ZeroAmount();
        if (deposited + amount > maxEscrow) revert CapExceeded();
        deposited += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, deposited);
    }

    /// @notice Factory-only: the permit path pulled `amount` from `from` straight
    ///         into this clone (the factory is the permit's spender), so record
    ///         it and start in the same transaction (FR-CON-016).
    function fundAndStart(address from, uint256 amount) external nonReentrant {
        if (msg.sender != factory) revert NotFactory();
        if (status != Status.Created) revert InvalidState();
        if (amount == 0) revert ZeroAmount();
        if (deposited + amount > maxEscrow) revert CapExceeded();
        // The tokens must actually be here: balance grew by at least `amount`.
        if (token.balanceOf(address(this)) < deposited + amount) revert InsufficientDeposit();
        deposited += amount;
        emit Deposited(from, amount, deposited);
        _start();
    }

    /// @notice Seconds the escrow can pay for (FR-CON-013).
    function maxSeconds() public view returns (uint256) {
        return ratePerSecond == 0 ? 0 : deposited / ratePerSecond;
    }

    /// @notice What the Subscriber gets back on cancel: deposit minus gross settled (FR-CON-014).
    function refundable() public view returns (uint256) {
        return deposited - settledAmount;
    }

    // ─── Lifecycle (FR-CON-020–026) ─────────────────────────────────────────

    /// @notice Start the meter. Needs at least one affordable second (FR-CON-021).
    function start() external onlyParty {
        _start();
    }

    function _start() internal {
        if (status != Status.Created) revert InvalidState();
        if (deposited < ratePerSecond) revert InsufficientDeposit();
        status = Status.Active;
        startedAt = block.timestamp;
        segmentStart = block.timestamp;
        emit StreamStarted(merchant, subscriber, ratePerSecond, startedAt);
    }

    /// @notice Manual pause (reason 0). Paused time is never billed (FR-CON-022, BR-CON-003).
    ///         A pause that observes exhaustion ends the stream instead (FR-CON-041).
    function pause() external nonReentrant onlyParty {
        if (status != Status.Active) revert InvalidState();
        if (_exhausted()) {
            _endAtCap();
            return;
        }
        closedActiveSeconds += block.timestamp - segmentStart;
        pausedAt = block.timestamp;
        status = Status.Paused;
        emit StreamPaused(block.timestamp, 0);
    }

    /// @notice Resume a manually paused meter (FR-CON-023).
    function resume() external onlyParty {
        if (status != Status.Paused) revert InvalidState();
        if (maxSeconds() <= closedActiveSeconds) revert InsufficientDeposit();
        status = Status.Active;
        segmentStart = block.timestamp;
        pausedAt = 0;
        emit StreamResumed(block.timestamp);
    }

    /// @notice Stop the meter: settle unsettled whole seconds, refund the rest
    ///         (FR-CON-024, FR-CON-025). A stream past its cap ends at the cap
    ///         second instead (FR-CON-041).
    function cancel() external nonReentrant onlyPartyOrKeeper notCanceled {
        _cancel();
    }

    /// @notice Cancel on behalf of a party who signed for it, so the relayer can
    ///         submit and pay gas (FR-CON-017). Message: keccak256(stream, nonce, deadline).
    function cancelFor(uint256 deadline, bytes calldata signature) external nonReentrant notCanceled {
        if (block.timestamp > deadline) revert BadSignature();
        bytes32 digest = cancelDigest(cancelNonce, deadline);
        address signer = _recover(digest, signature);
        if (signer != subscriber && signer != merchant) revert BadSignature();
        cancelNonce += 1;
        _cancel();
    }

    /// @notice The message a party signs for `cancelFor` (EIP-191 personal sign).
    function cancelDigest(uint256 nonce, uint256 deadline) public view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode("ElapseCancel", block.chainid, address(this), nonce, deadline));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    function _cancel() internal {
        if (status == Status.Active && _exhausted()) {
            _endAtCap();
            return;
        }
        uint256 at = block.timestamp;
        if (status == Status.Active) {
            closedActiveSeconds += at - segmentStart;
        }
        status = Status.Canceled;
        pausedAt = at;
        _settleChunk();
        uint256 refund = refundable();
        emit StreamCanceled(at, closedActiveSeconds, settledAmount, refund);
        if (refund > 0) token.safeTransfer(subscriber, refund);
    }

    // ─── Settlement (FR-CON-030–034) ────────────────────────────────────────

    /// @notice Pull accrued whole seconds to the Merchant (net) and treasury (fee).
    ///         Permissionless (FR-CON-051); a no-op on idle streams (FR-CON-032).
    ///         The first settle that observes exhaustion ends the stream (FR-CON-041).
    function settle() external nonReentrant notCanceled {
        if (status == Status.Active && _exhausted()) {
            _endAtCap();
            return;
        }
        _settleChunk();
    }

    /// @dev Whole seconds only (BR-CON-002); fee rounds down in the merchant's favour.
    function _settleChunk() internal {
        uint256 secs = accruedSeconds() - settledSeconds;
        if (secs == 0) return;
        uint256 amount = secs * ratePerSecond;
        uint256 fee = (amount * feeBps) / 10_000;
        settledSeconds += secs;
        settledAmount += amount;
        settledFee += fee;
        emit Settled(secs, amount, fee);
        token.safeTransfer(merchant, amount - fee);
        if (fee > 0) token.safeTransfer(treasury, fee);
    }

    /// @notice Whole seconds of active time, capped by the escrow (FR-CON-031, FR-CON-040).
    function accruedSeconds() public view returns (uint256) {
        uint256 active = closedActiveSeconds;
        if (status == Status.Active) active += block.timestamp - segmentStart;
        uint256 cap = maxSeconds();
        return active > cap ? cap : active;
    }

    /// @notice Seconds accrued but not yet paid.
    function unsettledSeconds() external view returns (uint256) {
        return accruedSeconds() - settledSeconds;
    }

    /// @notice The instant the escrow runs out (FR-CON-040). 0 before start.
    function exhaustedAt() public view returns (uint256) {
        if (startedAt == 0) return 0;
        uint256 cap = maxSeconds();
        if (cap <= closedActiveSeconds) return pausedAt != 0 ? pausedAt : segmentStart;
        return segmentStart + (cap - closedActiveSeconds);
    }

    function _exhausted() internal view returns (bool) {
        return closedActiveSeconds + (block.timestamp - segmentStart) >= maxSeconds();
    }

    /// @dev FR-CON-041: reaching the cap ends the stream, back-dated to the exact
    ///      exhaustion second. Same events as a cancel; the platform tells a cap
    ///      end from a cancel by `secondsElapsed == maxSeconds()`.
    function _endAtCap() internal {
        uint256 at = exhaustedAt();
        closedActiveSeconds = maxSeconds();
        status = Status.Canceled;
        pausedAt = at;
        _settleChunk();
        uint256 refund = refundable(); // dust below one second of rate
        emit StreamCanceled(at, closedActiveSeconds, settledAmount, refund);
        if (refund > 0) token.safeTransfer(subscriber, refund);
    }

    // ─── Signature helper ───────────────────────────────────────────────────

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // EIP-2: reject high-s signatures.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        if (v != 27 && v != 28) revert BadSignature();
        address a = ecrecover(digest, v, r, s);
        if (a == address(0)) revert BadSignature();
        return a;
    }
}
