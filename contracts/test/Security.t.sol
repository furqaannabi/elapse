// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {AccrualStream} from "../src/AccrualStream.sol";
import {StreamFactory} from "../src/StreamFactory.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// FR-CON-016, 017, 050–053, 060: who may do what, and what a hostile token can do.
contract SecurityTest is BaseTest {
    // ─── Access (FR-CON-050–053) ────────────────────────────────────────────

    function test_FR_CON_050_lifecycle_calls_are_party_only_and_merchant_may_pause() public {
        AccrualStream s = fundedStream();
        vm.startPrank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.start();
        vm.stopPrank();

        vm.prank(merchant);
        s.start();

        vm.prank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.pause();
        vm.prank(merchant);
        s.pause(); // decided 2026-09-05: contract allows either party

        vm.prank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.resume();
        vm.prank(merchant);
        s.resume();

        vm.prank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.cancel();
        vm.prank(merchant);
        s.cancel();
    }

    /// Decided 2026-09-05 (William, ADR keeper-may-cancel): the factory's keeper is a third
    /// canceller so the platform can honour `subscriptions.cancel` from a merchant's server,
    /// which holds an API key, not the payout wallet. Cancel only ever pays elapsed seconds to
    /// the merchant and refunds the rest, so the keeper cannot take anything. It still may not
    /// start, pause or resume.
    /// FR-CON-055 (signed 2026-09-14) widened `start` to the keeper so the relayer can start
    /// a meter on a merchant's behalf, and FR-CON-074 (signed 2026-09-19) widened `pause` and
    /// `resume` for the same reason: a merchant that bills only while its resource works holds
    /// an API key, not the payout wallet. Cancel can still only pay elapsed seconds out and
    /// refund the rest, and a stranger is still nobody. Keeper pause and resume have their own
    /// suite in `KeeperPause.t.sol`.
    function test_FR_CON_054_keeper_may_cancel_start_pause_and_resume_but_take_nothing() public {
        address keeper = makeAddr("keeper");
        factory.setKeeper(keeper);
        AccrualStream s = fundedStream();

        vm.prank(keeper);
        s.start();
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active), "keeper may start (FR-CON-055)");

        vm.warp(block.timestamp + 83);

        // FR-CON-074: the keeper pauses and resumes, and the paused seconds are not billed.
        vm.prank(keeper);
        s.pause();
        vm.warp(block.timestamp + 500);
        vm.prank(keeper);
        s.resume();
        assertEq(s.accruedSeconds(), 83, "the 500s pause cost nothing");

        vm.prank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.cancel();

        uint256 gross = 83 * RATE;
        vm.prank(keeper);
        s.cancel();
        assertEq(usd.balanceOf(merchant), gross - fee(gross));
        assertEq(usd.balanceOf(treasury), fee(gross));
        assertEq(usd.balanceOf(subscriber), 100 * ESCROW - gross);
        assertEq(usd.balanceOf(keeper), 0);
        assertEq(usd.balanceOf(address(s)), 0);
    }

    function test_FR_CON_054_a_replaced_keeper_loses_the_right() public {
        address oldKeeper = makeAddr("oldKeeper");
        factory.setKeeper(oldKeeper);
        AccrualStream s = runningStream();
        factory.setKeeper(makeAddr("newKeeper"));
        vm.prank(oldKeeper);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.cancel();
    }

    function test_FR_CON_051_settle_is_permissionless_and_funds_still_go_to_merchant() public {
        AccrualStream s = runningStream();
        vm.warp(block.timestamp + 10);
        vm.prank(stranger);
        s.settle();
        uint256 gross = 10 * RATE;
        assertEq(usd.balanceOf(merchant), gross - fee(gross));
        assertEq(usd.balanceOf(treasury), fee(gross));
        assertEq(usd.balanceOf(stranger), 0);
    }

    function test_FR_CON_052_third_party_deposit_is_refunded_to_the_subscriber() public {
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        usd.mint(stranger, ESCROW);
        vm.startPrank(stranger);
        usd.approve(address(s), ESCROW);
        s.deposit(ESCROW);
        vm.stopPrank();

        vm.prank(subscriber);
        s.cancel();
        assertEq(usd.balanceOf(subscriber), 100 * ESCROW + ESCROW, "refund goes to subscriber, not depositor");
        assertEq(usd.balanceOf(stranger), 0);
    }

    function test_FR_CON_053_no_setters_exist_after_initialize() public {
        // Compile-time property: the contract exposes no function that changes
        // merchant, subscriber, token, ratePerSecond, maxEscrow, feeBps or
        // treasury after initialize. We assert the observable half: a second
        // initialize is rejected, and the values are what create set.
        AccrualStream s = fundedStream();
        vm.expectRevert(AccrualStream.AlreadyInitialized.selector);
        s.initialize(stranger, stranger, address(usd), 1, 1, 1, stranger);
        assertEq(s.merchant(), merchant);
        assertEq(s.ratePerSecond(), RATE);
        assertEq(s.maxEscrow(), ESCROW);
    }

    function test_fundAndStart_is_factory_only() public {
        AccrualStream s = fundedStream();
        vm.prank(subscriber);
        vm.expectRevert(AccrualStream.NotFactory.selector);
        s.fundAndStart(subscriber, 1);
    }

    // ─── Token safety (FR-CON-060) ──────────────────────────────────────────

    function test_FR_CON_060_false_returning_token_reverts_instead_of_silently_losing_money() public {
        FalseToken bad = new FalseToken();
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(bad), RATE, ESCROW));
        bad.mint(subscriber, ESCROW);
        vm.startPrank(subscriber);
        bad.approve(address(s), ESCROW);
        s.deposit(ESCROW);
        s.start();
        vm.stopPrank();
        vm.warp(block.timestamp + 10);
        bad.setFail(true);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        s.settle();
        // State was not advanced by the failed settle.
        assertEq(s.settledSeconds(), 0);
    }

    function test_FR_CON_060_reentrant_token_cannot_double_settle() public {
        ReentrantToken evil = new ReentrantToken();
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(evil), RATE, ESCROW));
        evil.mint(subscriber, ESCROW);
        vm.startPrank(subscriber);
        evil.approve(address(s), ESCROW);
        s.deposit(ESCROW);
        s.start();
        vm.stopPrank();
        vm.warp(block.timestamp + 10);
        evil.arm(s);
        s.settle(); // the token re-enters settle(); the guard makes that a revert the token swallows
        assertEq(s.settledSeconds(), 10, "settled exactly once");
        assertEq(evil.balanceOf(merchant) + evil.balanceOf(treasury), 10 * RATE);
        assertTrue(evil.reentryBlocked(), "the re-entrant call was rejected");
    }

    // ─── Permit path (FR-CON-016) ───────────────────────────────────────────

    uint256 constant SUB_KEY = 0xA11CE;

    function _permitSig(address spender, uint256 value, uint256 deadline, uint256 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address owner_ = vm.addr(SUB_KEY);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner_,
                spender,
                value,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usd.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(SUB_KEY, digest);
    }

    function test_FR_CON_016_createWithPermit_is_one_transaction_from_signature_to_running() public {
        address sub = vm.addr(SUB_KEY);
        usd.mint(sub, ESCROW);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s_) = _permitSig(address(factory), ESCROW, deadline, 0);

        // The relayer submits; the subscriber never sends a transaction.
        vm.prank(stranger);
        address streamAddr = factory.createWithPermit(merchant, sub, address(usd), RATE, ESCROW, deadline, v, r, s_);
        AccrualStream stream = AccrualStream(streamAddr);

        assertEq(uint8(stream.status()), uint8(AccrualStream.Status.Active));
        assertEq(stream.deposited(), ESCROW);
        assertEq(usd.balanceOf(streamAddr), ESCROW);
        assertEq(usd.balanceOf(sub), 0);
        assertEq(usd.allowance(sub, address(factory)), 0, "permit consumed exactly");
    }

    function test_FR_CON_016_replayed_permit_reverts_and_creates_no_funded_stream() public {
        address sub = vm.addr(SUB_KEY);
        usd.mint(sub, 2 * ESCROW);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s_) = _permitSig(address(factory), ESCROW, deadline, 0);
        factory.createWithPermit(merchant, sub, address(usd), RATE, ESCROW, deadline, v, r, s_);

        // Same signature again: permit fails (nonce moved), allowance is gone → transferFrom reverts.
        vm.expectRevert();
        factory.createWithPermit(merchant, sub, address(usd), RATE, ESCROW, deadline, v, r, s_);
        assertEq(usd.balanceOf(sub), ESCROW, "second call moved nothing");
    }

    function test_FR_CON_016_permit_for_less_than_the_cap_cannot_fund_it() public {
        address sub = vm.addr(SUB_KEY);
        usd.mint(sub, ESCROW);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s_) = _permitSig(address(factory), ESCROW - 1, deadline, 0);
        vm.expectRevert();
        factory.createWithPermit(merchant, sub, address(usd), RATE, ESCROW, deadline, v, r, s_);
    }

    function test_FR_CON_016_front_run_permit_does_not_grief() public {
        // Someone else consumes the permit first; the allowance still exists, so our call succeeds.
        address sub = vm.addr(SUB_KEY);
        usd.mint(sub, ESCROW);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s_) = _permitSig(address(factory), ESCROW, deadline, 0);
        vm.prank(stranger);
        usd.permit(sub, address(factory), ESCROW, deadline, v, r, s_);

        address streamAddr = factory.createWithPermit(merchant, sub, address(usd), RATE, ESCROW, deadline, v, r, s_);
        assertEq(uint8(AccrualStream(streamAddr).status()), uint8(AccrualStream.Status.Active));
    }

    // ─── Relayed cancel (FR-CON-017) ────────────────────────────────────────

    function test_FR_CON_017_cancelFor_with_subscriber_signature_settles_and_refunds() public {
        address sub = vm.addr(SUB_KEY);
        usd.mint(sub, ESCROW);
        AccrualStream s = AccrualStream(factory.create(merchant, sub, address(usd), RATE, ESCROW));
        vm.startPrank(sub);
        usd.approve(address(s), ESCROW);
        s.deposit(ESCROW);
        s.start();
        vm.stopPrank();
        vm.warp(block.timestamp + 83);

        uint256 deadline = block.timestamp + 300;
        bytes32 digest = s.cancelDigest(s.relayNonce(), deadline);
        (uint8 v, bytes32 r, bytes32 sig_s) = vm.sign(SUB_KEY, digest);
        bytes memory sig = abi.encodePacked(r, sig_s, v);

        vm.prank(stranger); // the relayer
        s.cancelFor(deadline, sig);

        uint256 gross = 83 * RATE;
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
        assertEq(usd.balanceOf(merchant), gross - fee(gross));
        assertEq(usd.balanceOf(sub), ESCROW - gross);
        assertEq(s.relayNonce(), 1);
    }

    function test_FR_CON_017_cancelFor_rejects_replay_expiry_and_strangers() public {
        address sub = vm.addr(SUB_KEY);
        usd.mint(sub, 2 * ESCROW);
        AccrualStream a = AccrualStream(factory.create(merchant, sub, address(usd), RATE, ESCROW));
        AccrualStream b = AccrualStream(factory.create(merchant, sub, address(usd), RATE, ESCROW));
        vm.startPrank(sub);
        usd.approve(address(a), ESCROW);
        a.deposit(ESCROW);
        a.start();
        usd.approve(address(b), ESCROW);
        b.deposit(ESCROW);
        b.start();
        vm.stopPrank();

        uint256 deadline = block.timestamp + 300;

        // Expired.
        bytes32 d1 = a.cancelDigest(0, block.timestamp - 1);
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(SUB_KEY, d1);
        vm.expectRevert(AccrualStream.BadSignature.selector);
        a.cancelFor(block.timestamp - 1, abi.encodePacked(r, s_, v));

        // Signed by a stranger.
        bytes32 d2 = a.cancelDigest(0, deadline);
        (v, r, s_) = vm.sign(0xBAD, d2);
        vm.expectRevert(AccrualStream.BadSignature.selector);
        a.cancelFor(deadline, abi.encodePacked(r, s_, v));

        // A signature for stream a does not cancel stream b (address is in the digest).
        (v, r, s_) = vm.sign(SUB_KEY, d2);
        vm.expectRevert(AccrualStream.BadSignature.selector);
        b.cancelFor(deadline, abi.encodePacked(r, s_, v));

        // Valid once; the same bytes cannot be replayed (already canceled, nonce moved).
        a.cancelFor(deadline, abi.encodePacked(r, s_, v));
        vm.expectRevert(AccrualStream.AlreadyCanceled.selector);
        a.cancelFor(deadline, abi.encodePacked(r, s_, v));
    }

    // ─── Relayed pause / resume (FR-CON-018) ────────────────────────────────

    function _startedStream(address sub) internal returns (AccrualStream s) {
        usd.mint(sub, ESCROW);
        s = AccrualStream(factory.create(merchant, sub, address(usd), RATE, ESCROW));
        vm.startPrank(sub);
        usd.approve(address(s), ESCROW);
        s.deposit(ESCROW);
        s.start();
        vm.stopPrank();
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(key, digest);
        return abi.encodePacked(r, s_, v);
    }

    function test_FR_CON_018_pauseFor_freezes_and_resumeFor_restarts_without_billing_the_gap() public {
        address sub = vm.addr(SUB_KEY);
        AccrualStream s = _startedStream(sub);
        vm.warp(block.timestamp + 10);

        uint256 deadline = block.timestamp + 300;
        bytes memory pauseSig = _sign(SUB_KEY, s.pauseDigest(s.relayNonce(), deadline));
        vm.prank(stranger); // the relayer
        s.pauseFor(deadline, pauseSig);
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Paused));
        assertEq(s.relayNonce(), 1);
        assertEq(usd.balanceOf(merchant), 0); // no money moved
        assertEq(usd.balanceOf(sub), 0);

        vm.warp(block.timestamp + 100);
        assertEq(s.accruedSeconds(), 10);

        deadline = block.timestamp + 300;
        bytes memory resumeSig = _sign(SUB_KEY, s.resumeDigest(s.relayNonce(), deadline));
        vm.prank(stranger);
        s.resumeFor(deadline, resumeSig);
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Active));
        assertEq(s.relayNonce(), 2);

        vm.warp(block.timestamp + 5);
        assertEq(s.accruedSeconds(), 15);
    }

    function test_FR_CON_018_relayed_pause_rejects_cross_action_replay_expiry_and_strangers() public {
        address sub = vm.addr(SUB_KEY);
        AccrualStream s = _startedStream(sub);
        uint256 deadline = block.timestamp + 300;

        // A cancel signature does not pause (tag is in the digest).
        bytes memory cancelSig = _sign(SUB_KEY, s.cancelDigest(0, deadline));
        vm.expectRevert(AccrualStream.BadSignature.selector);
        s.pauseFor(deadline, cancelSig);

        // A pause signature does not resume, nor cancel.
        bytes memory pauseSig = _sign(SUB_KEY, s.pauseDigest(0, deadline));
        vm.expectRevert(AccrualStream.BadSignature.selector);
        s.resumeFor(deadline, pauseSig);
        vm.expectRevert(AccrualStream.BadSignature.selector);
        s.cancelFor(deadline, pauseSig);

        // Expired.
        bytes memory expired = _sign(SUB_KEY, s.pauseDigest(0, block.timestamp - 1));
        vm.expectRevert(AccrualStream.BadSignature.selector);
        s.pauseFor(block.timestamp - 1, expired);

        // A stranger's signature.
        bytes memory strangerSig = _sign(0xBAD, s.pauseDigest(0, deadline));
        vm.expectRevert(AccrualStream.BadSignature.selector);
        s.pauseFor(deadline, strangerSig);

        // FR-CON-074: the keeper needs no signature to pause; a *stranger* still does, which is
        // what this suite is about. (Left here so the contrast stays visible.)
        vm.prank(stranger);
        vm.expectRevert(AccrualStream.NotParty.selector);
        s.pause();

        // Valid once; replay fails because the nonce moved.
        s.pauseFor(deadline, pauseSig);
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Paused));
        vm.expectRevert(AccrualStream.BadSignature.selector);
        s.pauseFor(deadline, pauseSig);

        // Resume needs Paused; a second valid resume reverts InvalidState.
        bytes memory resumeSig = _sign(SUB_KEY, s.resumeDigest(1, deadline));
        s.resumeFor(deadline, resumeSig);
        bytes memory resumeAgain = _sign(SUB_KEY, s.resumeDigest(2, deadline));
        vm.expectRevert(AccrualStream.InvalidState.selector);
        s.resumeFor(deadline, resumeAgain);
    }

    function test_FR_CON_018_pauseFor_at_the_cap_ends_the_stream_like_pause() public {
        address sub = vm.addr(SUB_KEY);
        AccrualStream s = _startedStream(sub);
        vm.warp(block.timestamp + s.maxSeconds() + 50);
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _sign(SUB_KEY, s.pauseDigest(0, deadline));
        s.pauseFor(deadline, sig);
        assertEq(uint8(s.status()), uint8(AccrualStream.Status.Canceled));
        assertEq(usd.balanceOf(merchant) + usd.balanceOf(factory.treasury()) + usd.balanceOf(sub), ESCROW);
    }
}

/// A token whose transfers return false on demand (FR-CON-060).
contract FalseToken is ERC20 {
    bool public fail;

    constructor() ERC20("False", "FALSE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFail(bool f) external {
        fail = f;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (fail) return false;
        return super.transfer(to, amount);
    }
}

/// A token that re-enters `settle()` from inside `transfer` (FR-CON-060).
contract ReentrantToken is ERC20 {
    AccrualStream public target;
    bool public reentryBlocked;
    bool private armed;

    constructor() ERC20("Evil", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(AccrualStream t) external {
        target = t;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            try target.settle() {}
            catch {
                reentryBlocked = true;
            }
        }
        return super.transfer(to, amount);
    }
}
