// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {AccrualStream} from "../src/AccrualStream.sol";

/// Merchant-started metering (FR-CON-019/055/056, signed 2026-09-14).
contract MerchantStartTest is BaseTest {
    // ─── FR-CON-056: a stream that never started refunds in full ────────────

    function test_FR_CON_056_cancel_from_created_refunds_everything() public {
        AccrualStream s = fundedStream();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Created), "should not be started");

        uint256 before = usd.balanceOf(subscriber);
        vm.prank(subscriber);
        s.cancel();

        assertEq(s.settledAmount(), 0, "nothing may be settled");
        assertEq(usd.balanceOf(subscriber) - before, ESCROW, "full refund");
        assertEq(usd.balanceOf(merchant), 0, "merchant paid nothing");
        assertEq(usd.balanceOf(address(s)), 0, "stream drained");
    }

    function test_FR_CON_056_keeper_can_refund_an_unstarted_stream() public {
        address keeper = makeAddr("keeper");
        factory.setKeeper(keeper);
        AccrualStream s = fundedStream();

        uint256 before = usd.balanceOf(subscriber);
        vm.prank(keeper);
        s.cancel(); // the expiry sweep (worker FR-WRK-075) runs as keeper

        assertEq(usd.balanceOf(subscriber) - before, ESCROW, "full refund");
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
    }

    function testFuzz_FR_CON_056_unstarted_refund_is_always_the_whole_deposit(uint96 amount) public {
        uint256 dep = bound(uint256(amount), RATE, ESCROW);
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        vm.startPrank(subscriber);
        usd.approve(address(s), dep);
        s.deposit(dep);
        uint256 before = usd.balanceOf(subscriber);
        s.cancel();
        vm.stopPrank();

        assertEq(s.settledAmount(), 0);
        assertEq(usd.balanceOf(subscriber) - before, dep);
    }

    // ─── FR-CON-055: the relayer may start on the merchant's behalf ─────────

    function test_FR_CON_055_keeper_can_start() public {
        address keeper = makeAddr("keeper");
        factory.setKeeper(keeper);
        AccrualStream s = fundedStream();

        vm.prank(keeper);
        s.start();

        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active));
        assertEq(s.startedAt(), block.timestamp);
    }

    function test_FR_CON_055_a_stranger_still_cannot_start() public {
        AccrualStream s = fundedStream();
        vm.prank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.start();
    }

    // ─── FR-CON-019: fund without starting, through the permit path ─────────

    function test_FR_CON_019_createWithPermitNoStart_funds_but_does_not_start() public {
        vm.prank(subscriber);
        usd.approve(address(factory), ESCROW); // permit is applied best-effort; allowance is the gate

        address streamAddr = factory.createWithPermitNoStart(
            merchant, subscriber, address(usd), RATE, ESCROW, block.timestamp + 600, 0, bytes32(0), bytes32(0)
        );
        AccrualStream s = AccrualStream(streamAddr);

        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Created), "must not be started");
        assertEq(s.deposited(), ESCROW, "escrow is held");
        assertEq(s.accruedSeconds(), 0, "no second accrues before start");

        vm.warp(block.timestamp + 120);
        assertEq(s.accruedSeconds(), 0, "still nothing while unstarted");
    }
}
