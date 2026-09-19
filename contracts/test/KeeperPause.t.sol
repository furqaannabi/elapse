// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {AccrualStream} from "../src/AccrualStream.sol";

/// FR-CON-074 (signed 2026-09-19, ADR 2026-09-19 keeper may pause): the factory's keeper may
/// pause and resume, so a merchant can bill only while its resource is working. The keeper gains
/// no power over money — paused time is never billed (BR-CON-003) — and FR-CON-057 is untouched.
contract KeeperPauseTest is BaseTest {
    uint256 constant SUB_KEY = 0xA11CE;
    address sub;
    address mer = makeAddr("keeper-pause-merchant");
    address keeper = makeAddr("keeper");

    function setUp() public override {
        super.setUp();
        sub = vm.addr(SUB_KEY);
        factory.setKeeper(keeper);
        usd.mint(sub, 10 * ESCROW);
    }

    /// A running checkout-mode stream (the subscriber's own meter).
    function stream() internal returns (AccrualStream s) {
        vm.prank(sub);
        usd.approve(address(factory), ESCROW);
        s = AccrualStream(
            factory.createWithPermit(
                mer, sub, address(usd), RATE, ESCROW, block.timestamp + 600, 0, bytes32(0), bytes32(0)
            )
        );
    }

    /// A merchant-started stream, started by the keeper on the merchant's behalf.
    function merchantStream() internal returns (AccrualStream s) {
        vm.prank(sub);
        usd.approve(address(factory), ESCROW);
        s = AccrualStream(
            factory.createWithPermitNoStart(
                mer, sub, address(usd), RATE, ESCROW, block.timestamp + 600, 0, bytes32(0), bytes32(0)
            )
        );
        vm.prank(keeper);
        s.start();
    }

    function test_FR_CON_074_keeper_pauses_and_resumes() public {
        AccrualStream s = stream();
        vm.warp(block.timestamp + 10);

        vm.prank(keeper);
        s.pause();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Paused), "paused");

        vm.warp(block.timestamp + 100); // paused wall time is never billed
        vm.prank(keeper);
        s.resume();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active), "active again");

        vm.warp(block.timestamp + 5);
        assertEq(s.accruedSeconds(), 15, "10s before the pause plus 5s after the resume");
    }

    function test_FR_CON_074_keeper_may_pause_a_merchant_started_meter() public {
        AccrualStream s = merchantStream();
        vm.warp(block.timestamp + 3);
        vm.prank(keeper);
        s.pause();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Paused));
        vm.prank(keeper);
        s.resume();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active));
    }

    function test_FR_CON_074_a_stranger_still_cannot_pause_or_resume() public {
        AccrualStream s = stream();
        vm.prank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.pause();

        vm.prank(keeper);
        s.pause();
        vm.prank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.resume();
    }

    /// FR-CON-057 is untouched: the subscriber still cannot pause a running merchant-started meter.
    function test_FR_CON_074_subscriber_still_refused_on_a_merchant_started_meter() public {
        AccrualStream s = merchantStream();
        vm.prank(sub);
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.pause();

        vm.prank(keeper);
        s.pause();
        vm.prank(sub);
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.resume();
    }

    /// The subscriber keeps pause and resume on their own checkout-mode meter.
    function test_FR_CON_074_subscriber_keeps_pause_on_a_checkout_stream() public {
        AccrualStream s = stream();
        vm.prank(sub);
        s.pause();
        vm.prank(sub);
        s.resume();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active));
    }

    /// BR-CON-003 / the money invariant: whoever drives pause and resume, the subscriber pays for
    /// the seconds the meter ran and not one more, and the rest comes back.
    function testFuzz_FR_CON_074_keeper_pauses_never_change_what_is_owed(uint8 runA, uint8 idle, uint8 runB) public {
        vm.assume(runA > 0 && runB > 0);
        uint256 before = usd.balanceOf(sub); // before the escrow leaves the wallet
        AccrualStream s = stream();

        vm.warp(block.timestamp + runA);
        vm.prank(keeper);
        s.pause();
        vm.warp(block.timestamp + idle);
        vm.prank(keeper);
        s.resume();
        vm.warp(block.timestamp + runB);

        uint256 ran = uint256(runA) + uint256(runB);
        assertEq(s.accruedSeconds(), ran, "only the seconds it ran");

        vm.prank(keeper);
        s.cancel();
        // What the wallet is out of pocket after the refund is exactly the seconds that ran.
        uint256 paid = before - usd.balanceOf(sub);
        assertEq(paid, ran * RATE, "charged exactly the seconds it ran");
        assertEq(usd.balanceOf(address(s)), 0, "nothing stranded in the stream");
    }
}
