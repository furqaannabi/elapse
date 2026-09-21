// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {AccrualStream} from "../src/AccrualStream.sol";

/// FR-CON-057 (signed 2026-09-17): once the merchant starts a merchant-started stream,
/// only the merchant or the keeper can stop it. The subscriber can still stop before start.
contract MerchantControlledTest is BaseTest {
    uint256 constant SUB_KEY = 0xA11CE;
    uint256 constant MER_KEY = 0xB0B;
    address sub;
    address mer;
    address keeper = makeAddr("keeper");

    function setUp() public override {
        super.setUp();
        sub = vm.addr(SUB_KEY);
        mer = vm.addr(MER_KEY);
        factory.setKeeper(keeper);
        usd.mint(sub, 10 * ESCROW);
    }

    /// Funded through createWithPermitNoStart (merchant mode); started by the keeper when `start_` is true.
    function merchantStream(bool start_) internal returns (AccrualStream s) {
        vm.prank(sub);
        usd.approve(address(factory), ESCROW);
        s = AccrualStream(factory.createWithPermitNoStart(mer, sub, address(usd), RATE, ESCROW, block.timestamp + 600, 0, bytes32(0), bytes32(0)));
        if (start_) {
            vm.prank(keeper);
            s.start();
        }
    }

    function sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(key, digest);
        return abi.encodePacked(r, s_, v);
    }

    // ─── The flag ───────────────────────────────────────────────────────────

    function test_FR_CON_057_only_the_no_start_path_marks_a_stream_merchant_started() public {
        assertTrue(merchantStream(false).merchantStarted(), "createWithPermitNoStart");
        vm.prank(sub);
        usd.approve(address(factory), ESCROW);
        AccrualStream checkout = AccrualStream(factory.createWithPermit(mer, sub, address(usd), RATE, ESCROW, block.timestamp + 600, 0, bytes32(0), bytes32(0)));
        assertFalse(checkout.merchantStarted(), "createWithPermit");
    }

    // ─── The subscriber cannot stop a held meter either (FR-CON-057, amended 2026-09-19) ───

    function test_FR_CON_057_subscriber_cannot_cancel_before_start() public {
        AccrualStream s = merchantStream(false);
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Created), "held, not started");

        vm.prank(sub);
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.cancel();

        uint256 deadline = block.timestamp + 300;
        bytes memory sig = sign(SUB_KEY, s.cancelDigest(s.relayNonce(), deadline));
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.cancelFor(deadline, sig);
    }

    function test_FR_CON_057_the_merchant_and_the_keeper_still_release_a_held_meter() public {
        uint256 before = usd.balanceOf(sub);
        AccrualStream s = merchantStream(false);
        assertEq(usd.balanceOf(sub), before - ESCROW, "escrowed");

        vm.prank(keeper);
        s.cancel(); // the platform's unstarted sweep, on the subscriber's behalf
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
        assertEq(usd.balanceOf(sub), before, "the whole deposit comes back");

        // And the merchant can do it directly.
        AccrualStream other = merchantStream(false);
        vm.prank(mer);
        other.cancel();
        assertEq(uint8(other.status()), uint8(AccrualStream.Status.Canceled));
    }

    // ─── The subscriber cannot stop a started meter ─────────────────────────

    function test_FR_CON_057_subscriber_cancel_and_cancelFor_revert_once_started() public {
        AccrualStream s = merchantStream(true);
        vm.warp(block.timestamp + 60);

        vm.prank(sub);
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.cancel();

        uint256 deadline = block.timestamp + 300;
        bytes memory sig = sign(SUB_KEY, s.cancelDigest(s.relayNonce(), deadline));
        vm.prank(stranger); // the relayer
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.cancelFor(deadline, sig);

        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active), "still running");
    }

    function test_FR_CON_057_subscriber_pause_reverts_once_started() public {
        AccrualStream s = merchantStream(true);

        vm.prank(sub);
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.pause();
    }

    function test_FR_CON_057_a_paused_merchant_started_meter_is_still_the_merchants() public {
        AccrualStream s = merchantStream(true);
        vm.prank(mer);
        s.pause(); // the merchant may pause its own meter

        vm.prank(sub);
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.resume();

        vm.prank(sub);
        vm.expectRevert(AccrualStream.MerchantControlled.selector);
        s.cancel(); // paused is not a way out either

        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Paused));
    }

    // ─── The merchant and the keeper still can ──────────────────────────────

    function test_FR_CON_057_keeper_cancel_settles_elapsed_seconds_and_refunds_the_rest() public {
        AccrualStream s = merchantStream(true);
        vm.warp(block.timestamp + 83);
        uint256 before = usd.balanceOf(sub);

        vm.prank(keeper);
        s.cancel();

        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
        assertEq(s.settledSeconds(), 83, "whole elapsed seconds");
        assertEq(usd.balanceOf(sub) - before, ESCROW - s.settledAmount(), "the rest comes back");
    }

    function test_FR_CON_057_merchant_cancel_and_a_merchant_signed_cancelFor_still_work() public {
        AccrualStream a = merchantStream(true);
        vm.prank(mer);
        a.cancel();
        assertEq(uint8(a.status()), uint8(AccrualStream.Status.Canceled), "merchant cancel");

        AccrualStream b = merchantStream(true);
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = sign(MER_KEY, b.cancelDigest(b.relayNonce(), deadline));
        vm.prank(stranger);
        b.cancelFor(deadline, sig); // the rule follows who signed, not which function
        assertEq(uint8(b.status()), uint8(AccrualStream.Status.Canceled), "merchant-signed relay");
    }

    // ─── Unchanged: before start, and checkout mode ─────────────────────────

    function test_FR_CON_057_a_checkout_mode_stream_keeps_subscriber_stop() public {
        vm.prank(sub);
        usd.approve(address(factory), ESCROW);
        AccrualStream s = AccrualStream(factory.createWithPermit(mer, sub, address(usd), RATE, ESCROW, block.timestamp + 600, 0, bytes32(0), bytes32(0)));
        vm.warp(block.timestamp + 30);
        vm.prank(sub);
        s.cancel();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
    }

    function testFuzz_FR_CON_057_keeper_cancel_never_overcharges(uint32 elapsed) public {
        uint256 secs = bound(uint256(elapsed), 0, 2 * (ESCROW / RATE));
        AccrualStream s = merchantStream(true);
        vm.warp(block.timestamp + secs);
        uint256 before = usd.balanceOf(sub);

        vm.prank(keeper);
        s.cancel();

        uint256 billed = secs > ESCROW / RATE ? ESCROW / RATE : secs;
        assertEq(s.settledSeconds(), billed, "capped at the escrow");
        assertEq(s.settledAmount(), billed * RATE, "whole seconds x rate");
        assertEq(usd.balanceOf(sub) - before, ESCROW - s.settledAmount(), "the rest comes back");
    }
}
