// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {AccrualStream} from "../src/AccrualStream.sol";

/// FR-CON-010–042: escrow, lifecycle, settlement, and the cap end.
contract StreamTest is BaseTest {
    // ─── Escrow deposit (FR-CON-010–015) ────────────────────────────────────

    function test_FR_CON_010_deposit_pulls_tokens_and_tracks_total() public {
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        vm.startPrank(subscriber);
        usd.approve(address(s), ESCROW);
        s.deposit(ESCROW / 2);
        s.deposit(ESCROW / 2);
        vm.stopPrank();
        assertEq(s.deposited(), ESCROW);
        assertEq(usd.balanceOf(address(s)), ESCROW);
    }

    function test_FR_CON_010_deposit_allowed_while_active_and_paused_within_cap() public {
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        vm.startPrank(subscriber);
        usd.approve(address(s), ESCROW);
        s.deposit(ESCROW / 2);
        s.start();
        s.deposit(ESCROW / 4); // active
        s.pause();
        s.deposit(ESCROW / 4); // paused
        vm.stopPrank();
        assertEq(s.deposited(), ESCROW);
    }

    function test_FR_CON_011_deposit_rejects_zero_and_after_cancel() public {
        AccrualStream s = runningStream();
        vm.prank(subscriber);
        vm.expectRevert(AccrualStream.ZeroAmount.selector);
        s.deposit(0);

        vm.prank(subscriber);
        s.cancel();
        vm.prank(subscriber);
        vm.expectRevert(AccrualStream.AlreadyCanceled.selector);
        s.deposit(1);
    }

    function test_FR_CON_012_deposit_emits_Deposited() public {
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        vm.startPrank(subscriber);
        usd.approve(address(s), ESCROW);
        vm.expectEmit();
        emit AccrualStream.Deposited(subscriber, 1_000, 1_000);
        s.deposit(1_000);
        vm.stopPrank();
    }

    function test_FR_CON_013_maxSeconds_is_deposit_over_rate() public {
        AccrualStream s = fundedStream();
        assertEq(s.maxSeconds(), CAP_SECONDS);
    }

    function testFuzz_FR_CON_013_accrued_never_exceeds_maxSeconds(uint32 elapsed) public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + elapsed);
        assertLe(s.accruedSeconds(), s.maxSeconds());
    }

    function test_FR_CON_014_refund_plus_settled_equals_deposit_and_dust_is_returned() public {
        // Rate 7 does not divide the escrow: dust below one second must come back.
        uint256 rate = 7;
        uint256 cap = 1_000; // 1000 / 7 = 142 s, dust 6
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(usd), rate, cap));
        vm.startPrank(subscriber);
        usd.approve(address(s), cap);
        s.deposit(cap);
        s.start();
        vm.stopPrank();
        vm.warp(block.timestamp + 10_000); // way past the cap
        s.settle(); // ends at cap
        assertEq(s.settledAmount() + (cap - s.settledAmount()), cap);
        assertEq(usd.balanceOf(subscriber), 100 * ESCROW - cap + 6, "dust of 6 returned");
        assertEq(usd.balanceOf(address(s)), 0);
    }

    function test_FR_CON_015_deposit_above_cap_reverts_and_cap_is_immutable() public {
        AccrualStream s = fundedStream();
        vm.startPrank(subscriber);
        usd.approve(address(s), 1);
        vm.expectRevert(AccrualStream.CapExceeded.selector);
        s.deposit(1);
        vm.stopPrank();
        assertEq(s.maxEscrow(), ESCROW);
    }

    // ─── Lifecycle (FR-CON-020–026) ─────────────────────────────────────────

    function test_FR_CON_020_state_machine_edges() public {
        AccrualStream s = fundedStream();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Created));

        vm.startPrank(subscriber);
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.pause(); // Created → Paused is illegal
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.resume(); // Created → resume is illegal

        s.start();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active));
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.start(); // Active → start is illegal
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.resume(); // Active → resume is illegal

        s.pause();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Paused));
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.pause(); // Paused → pause is illegal

        s.resume();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active));

        s.cancel();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
        vm.stopPrank();
    }

    function test_FR_CON_020_created_to_canceled_is_allowed() public {
        AccrualStream s = fundedStream();
        vm.prank(subscriber);
        s.cancel();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
    }

    function test_FR_CON_021_start_needs_one_affordable_second_and_emits() public {
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        vm.prank(subscriber);
        vm.expectRevert(AccrualStream.InsufficientDeposit.selector);
        s.start();

        vm.startPrank(subscriber);
        usd.approve(address(s), RATE);
        s.deposit(RATE);
        vm.expectEmit();
        emit AccrualStream.StreamStarted(merchant, subscriber, RATE, block.timestamp);
        s.start();
        vm.stopPrank();
        assertEq(s.startedAt(), block.timestamp);
    }

    function test_FR_CON_022_pause_freezes_accrual_and_emits_reason_zero() public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 10);
        vm.prank(subscriber);
        vm.expectEmit();
        emit AccrualStream.StreamPaused(block.timestamp, 0);
        s.pause();
        uint256 frozen = s.accruedSeconds();
        vm.warp(block.timestamp + 1_000);
        assertEq(s.accruedSeconds(), frozen);
        assertEq(frozen, 10);
    }

    function test_FR_CON_023_resume_does_not_bill_paused_time() public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 10);
        vm.prank(subscriber);
        s.pause();
        vm.warp(block.timestamp + 100);
        vm.prank(subscriber);
        vm.expectEmit();
        emit AccrualStream.StreamResumed(block.timestamp);
        s.resume();
        vm.warp(block.timestamp + 5);
        assertEq(s.accruedSeconds(), 15);
    }

    function test_FR_CON_024_cancel_settles_refunds_and_emits_cumulative_totals() public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 83);
        uint256 gross = 83 * RATE;

        vm.prank(subscriber);
        vm.expectEmit();
        emit AccrualStream.Settled(83, gross, fee(gross));
        vm.expectEmit();
        emit AccrualStream.StreamCanceled(block.timestamp, 83, gross, ESCROW - gross);
        s.cancel();

        assertEq(usd.balanceOf(merchant), gross - fee(gross));
        assertEq(usd.balanceOf(treasury), fee(gross));
        assertEq(usd.balanceOf(subscriber), 100 * ESCROW - gross);
    }

    function test_FR_CON_024_cancel_after_earlier_settle_reports_cumulative() public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 50);
        s.settle();
        vm.warp(block.timestamp + 33);
        vm.prank(subscriber);
        vm.expectEmit();
        emit AccrualStream.Settled(33, 33 * RATE, fee(33 * RATE)); // the chunk
        vm.expectEmit();
        emit AccrualStream.StreamCanceled(block.timestamp, 83, 83 * RATE, ESCROW - 83 * RATE); // the total
        s.cancel();
    }

    function test_FR_CON_025_cancel_from_created_refunds_everything_no_Settled() public {
        AccrualStream s = fundedStream();
        vm.prank(subscriber);
        vm.recordLogs();
        vm.expectEmit();
        emit AccrualStream.StreamCanceled(block.timestamp, 0, 0, ESCROW);
        s.cancel();
        assertEq(usd.balanceOf(subscriber), 100 * ESCROW);
        assertEq(usd.balanceOf(merchant), 0);
    }

    function test_FR_CON_026_everything_reverts_after_cancel() public {
        AccrualStream s = runningStream();
        vm.startPrank(subscriber);
        s.cancel();
        vm.expectRevert(AccrualStream.AlreadyCanceled.selector);
        s.deposit(1);
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.start();
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.pause();
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.resume();
        vm.expectRevert(AccrualStream.AlreadyCanceled.selector);
        s.cancel();
        vm.expectRevert(AccrualStream.AlreadyCanceled.selector);
        s.settle();
        vm.stopPrank();
    }

    // ─── Settlement (FR-CON-030–034) ────────────────────────────────────────

    function test_FR_CON_030_settle_splits_net_and_fee_and_updates_counters() public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 100);
        uint256 gross = 100 * RATE;
        vm.expectEmit();
        emit AccrualStream.Settled(100, gross, fee(gross));
        s.settle();
        assertEq(s.settledSeconds(), s.accruedSeconds());
        assertEq(s.settledAmount(), gross);
        assertEq(s.settledFee(), fee(gross));
        assertEq(usd.balanceOf(merchant), gross - fee(gross));
        assertEq(usd.balanceOf(treasury), fee(gross));
    }

    function testFuzz_FR_CON_030_fee_never_exceeds_amount_and_sums_exactly(uint16 bps, uint32 secs) public {
        bps = uint16(bound(bps, 0, 1_000));
        secs = uint32(bound(secs, 1, CAP_SECONDS - 1));
        factory.setFee(bps, treasury);
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + secs);
        s.settle();
        uint256 gross = uint256(secs) * RATE;
        uint256 f = (gross * bps) / 10_000;
        assertLe(f, gross);
        assertEq(usd.balanceOf(merchant) + usd.balanceOf(treasury), gross);
        assertEq(usd.balanceOf(treasury), f);
    }

    function test_FR_CON_030_settle_bills_whole_seconds_only() public {
        // Fractional seconds cannot exist on chain; two settles 1 s apart bill 1 s each.
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 1);
        s.settle();
        assertEq(s.settledSeconds(), 1);
    }

    function test_FR_CON_032_settle_with_nothing_accrued_is_a_silent_noop() public {
        AccrualStream s = runningStream();
        vm.recordLogs();
        s.settle();
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(s.settledSeconds(), 0);
    }

    function test_FR_CON_033_settleBatch_continues_past_a_failing_stream() public {
        AccrualStream a = runningStream();
        AccrualStream b = runningStream();
        AccrualStream dead = runningStream();
        vm.prank(subscriber);
        dead.cancel();

        vm.warp(block.timestamp + 10);
        address[] memory list = new address[](3);
        list[0] = address(a);
        list[1] = address(dead);
        list[2] = address(b);
        factory.settleBatch(list);
        assertEq(a.settledSeconds(), 10);
        assertEq(b.settledSeconds(), 10);
    }

    function test_FR_CON_031_accrued_counts_only_active_time() public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 20);
        vm.prank(subscriber);
        s.pause();
        vm.warp(block.timestamp + 500);
        vm.prank(subscriber);
        s.resume();
        vm.warp(block.timestamp + 30);
        vm.prank(subscriber);
        s.pause();
        vm.warp(block.timestamp + 500);
        assertEq(s.accruedSeconds(), 50);
    }

    // ─── Cap reached (FR-CON-040–042) ───────────────────────────────────────

    function test_FR_CON_040_accrual_freezes_at_cap_and_exhaustedAt_is_exact() public {
        AccrualStream s = runningStream();
        uint256 started = block.timestamp;
        vm.warp(block.timestamp + 10_000);
        assertEq(s.accruedSeconds(), CAP_SECONDS);
        assertEq(s.exhaustedAt(), started + CAP_SECONDS);
    }

    function test_FR_CON_041_first_settle_past_cap_ends_the_stream_backdated() public {
        AccrualStream s = runningStream();
        uint256 started = block.timestamp;
        vm.warp(block.timestamp + 10_000);

        vm.expectEmit();
        emit AccrualStream.Settled(CAP_SECONDS, ESCROW, fee(ESCROW));
        vm.expectEmit();
        emit AccrualStream.StreamCanceled(started + CAP_SECONDS, CAP_SECONDS, ESCROW, 0);
        s.settle();

        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
        assertEq(s.pausedAt(), started + CAP_SECONDS);
        assertEq(usd.balanceOf(merchant), ESCROW - fee(ESCROW));
        assertEq(usd.balanceOf(address(s)), 0);
    }

    function test_FR_CON_041_settling_late_costs_the_same_as_settling_at_the_cap() public {
        AccrualStream a = runningStream();
        AccrualStream b = runningStream();
        vm.warp(block.timestamp + CAP_SECONDS);
        a.settle();
        uint256 atCap = usd.balanceOf(merchant);
        vm.warp(block.timestamp + 1_000);
        b.settle();
        assertEq(usd.balanceOf(merchant), 2 * atCap);
    }

    function test_FR_CON_041_cancel_and_pause_past_cap_also_end_it() public {
        AccrualStream a = runningStream();
        AccrualStream b = runningStream();
        vm.warp(block.timestamp + 10_000);
        vm.prank(subscriber);
        a.cancel();
        vm.prank(subscriber);
        b.pause();
        assertEq(uint8(a.status()), uint8(AccrualStream.Status.Canceled));
        assertEq(uint8(b.status()), uint8(AccrualStream.Status.Canceled));
    }

    function test_FR_CON_042_no_resume_after_the_cap() public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 10_000);
        s.settle();
        vm.prank(subscriber);
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.resume();
    }
}
