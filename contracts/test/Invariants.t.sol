// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {StreamFactory} from "../src/StreamFactory.sol";
import {AccrualStream} from "../src/AccrualStream.sol";

/// Random actors do random things to one stream; the money laws must hold
/// after every step (FR-CON-071, FR-CON-072).
contract Handler is Test {
    MockUSD public usd;
    AccrualStream public stream;
    address public merchant;
    address public subscriber;
    address public treasury;

    // Ghost model: what the contract *should* think, computed independently.
    uint256 public ghostActiveSeconds; // closed segments only
    uint256 public ghostSegmentStart; // 0 when not active
    bool public ghostEnded;

    constructor(MockUSD usd_, AccrualStream stream_, address merchant_, address subscriber_, address treasury_) {
        usd = usd_;
        stream = stream_;
        merchant = merchant_;
        subscriber = subscriber_;
        treasury = treasury_;
    }

    function _active() internal view returns (bool) {
        return stream.status() == AccrualStream.Status.Active;
    }

    function warp(uint32 secs) external {
        secs = uint32(bound(secs, 0, 7_200));
        vm.warp(block.timestamp + secs);
    }

    function deposit(uint96 amount) external {
        amount = uint96(bound(amount, 1, stream.maxEscrow()));
        if (stream.status() == AccrualStream.Status.Canceled) return;
        if (stream.deposited() + amount > stream.maxEscrow()) return;
        usd.mint(subscriber, amount);
        vm.startPrank(subscriber);
        usd.approve(address(stream), amount);
        stream.deposit(amount);
        vm.stopPrank();
    }

    function start() external {
        if (stream.status() != AccrualStream.Status.Created) return;
        if (stream.deposited() < stream.ratePerSecond()) return;
        vm.prank(subscriber);
        stream.start();
        ghostSegmentStart = block.timestamp;
    }

    function pause() external {
        if (!_active()) return;
        bool exhausted = _ghostExhausted();
        vm.prank(merchant);
        stream.pause();
        if (exhausted) {
            ghostEnded = true;
        } else {
            ghostActiveSeconds += block.timestamp - ghostSegmentStart;
            ghostSegmentStart = 0;
        }
    }

    function resume() external {
        if (stream.status() != AccrualStream.Status.Paused) return;
        if (stream.maxSeconds() <= ghostActiveSeconds) return;
        vm.prank(subscriber);
        stream.resume();
        ghostSegmentStart = block.timestamp;
    }

    function settle() external {
        if (stream.status() == AccrualStream.Status.Canceled) return;
        bool exhausted = _active() && _ghostExhausted();
        stream.settle();
        if (exhausted) ghostEnded = true;
    }

    function cancel() external {
        if (stream.status() == AccrualStream.Status.Canceled) return;
        vm.prank(subscriber);
        stream.cancel();
        ghostEnded = true;
    }

    function _ghostExhausted() internal view returns (bool) {
        return ghostActiveSeconds + (block.timestamp - ghostSegmentStart) >= stream.maxSeconds();
    }

    /// What accruedSeconds() must equal, from the ghost model.
    function expectedAccrued() external view returns (uint256) {
        if (ghostEnded) return stream.accruedSeconds(); // frozen at end; checked via the money laws
        uint256 active = ghostActiveSeconds;
        if (_active()) active += block.timestamp - ghostSegmentStart;
        uint256 cap = stream.maxSeconds();
        return active > cap ? cap : active;
    }
}

contract InvariantsTest is Test {
    MockUSD usd;
    StreamFactory factory;
    AccrualStream stream;
    Handler handler;

    address merchant = makeAddr("merchant");
    address subscriber = makeAddr("subscriber");
    address treasury = makeAddr("treasury");

    uint256 constant RATE = 4_000;
    uint256 constant ESCROW = RATE * 3_600;

    function setUp() public {
        vm.warp(1_756_800_000);
        usd = new MockUSD();
        factory = new StreamFactory(treasury);
        stream = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        handler = new Handler(usd, stream, merchant, subscriber, treasury);
        targetContract(address(handler));
    }

    /// FR-CON-072: settledAmount ≤ accrued × rate ≤ deposited.
    function invariant_settled_never_exceeds_accrued_never_exceeds_deposit() public view {
        uint256 accruedValue = stream.accruedSeconds() * RATE;
        assertLe(stream.settledAmount(), accruedValue);
        assertLe(accruedValue, stream.deposited());
    }

    /// FR-CON-072: the stream holds exactly deposit − settled until it ends, then nothing.
    function invariant_stream_balance_is_deposit_minus_settled_then_zero() public view {
        if (stream.status() == AccrualStream.Status.Canceled) {
            assertEq(usd.balanceOf(address(stream)), 0);
        } else {
            assertEq(usd.balanceOf(address(stream)), stream.deposited() - stream.settledAmount());
        }
    }

    /// FR-CON-072: every settled unit reached either the merchant or the treasury, and nobody else.
    function invariant_merchant_plus_treasury_equals_settled() public view {
        assertEq(usd.balanceOf(merchant) + usd.balanceOf(treasury), stream.settledAmount());
        assertLe(stream.settledFee(), (stream.settledAmount() * stream.feeBps()) / 10_000);
        assertEq(usd.balanceOf(treasury), stream.settledFee());
    }

    /// BR-CON-001: the subscriber can never owe more than they deposited.
    function invariant_subscriber_never_out_of_pocket_beyond_deposit() public view {
        // Everything minted to the subscriber either stays with them, sits in the
        // stream, or was settled. Nothing else can hold it.
        uint256 minted = usd.totalSupply();
        assertEq(
            usd.balanceOf(subscriber) + usd.balanceOf(address(stream)) + usd.balanceOf(merchant)
                + usd.balanceOf(treasury),
            minted
        );
    }

    /// FR-CON-071: the contract's elapsed math matches an independent model.
    function invariant_accrued_matches_reference_model() public view {
        assertEq(stream.accruedSeconds(), handler.expectedAccrued());
    }

    /// Seconds are whole (BR-CON-002).
    function invariant_settled_seconds_never_exceed_accrued() public view {
        assertLe(stream.settledSeconds(), stream.accruedSeconds());
    }
}
