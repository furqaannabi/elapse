// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {StreamFactory} from "../src/StreamFactory.sol";
import {AccrualStream} from "../src/AccrualStream.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// FR-CON-001–006: the factory, its knobs, and the snapshot of the fee into each clone.
contract FactoryTest is BaseTest {
    function test_FR_CON_001_create_returns_distinct_clones_with_matching_getters() public {
        address a = factory.create(merchant, subscriber, address(usd), RATE, ESCROW);
        address b = factory.create(merchant, subscriber, address(usd), RATE, ESCROW);
        assertTrue(a != b);
        AccrualStream s = AccrualStream(a);
        assertEq(s.merchant(), merchant);
        assertEq(s.subscriber(), subscriber);
        assertEq(address(s.token()), address(usd));
        assertEq(s.ratePerSecond(), RATE);
        assertEq(s.maxEscrow(), ESCROW);
        assertEq(s.factory(), address(factory));
    }

    /// Foundry's in-test gas metering does not charge code deposit on CREATE,
    /// so a full deploy cannot be measured here directly. Code deposit alone is
    /// 200 gas per byte on the EVM, which is a floor for a full deploy; the
    /// clone plus its initialisation must come in under a fifth of that floor.
    function test_FR_CON_001_clone_is_cheap() public {
        uint256 g = gasleft();
        factory.create(merchant, subscriber, address(usd), RATE, ESCROW);
        uint256 cloneGas = g - gasleft();

        // A per-session full deploy would pay code deposit *and* the same
        // storage writes the clone's initialize pays, so that is the fair total.
        uint256 codeDeposit = factory.implementation().code.length * 200;
        uint256 fullDeploy = codeDeposit + cloneGas;
        emit log_named_uint("clone + initialize gas", cloneGas);
        emit log_named_uint("full deploy (code deposit + same init)", fullDeploy);
        assertLt(cloneGas, fullDeploy / 5, "clone must cost under a fifth of a full deploy");
    }

    function test_FR_CON_002_create_rejects_zero_arguments() public {
        vm.expectRevert(StreamFactory.ZeroAddress.selector);
        factory.create(address(0), subscriber, address(usd), RATE, ESCROW);
        vm.expectRevert(StreamFactory.ZeroAddress.selector);
        factory.create(merchant, address(0), address(usd), RATE, ESCROW);
        vm.expectRevert(StreamFactory.ZeroAddress.selector);
        factory.create(merchant, subscriber, address(0), RATE, ESCROW);
        vm.expectRevert(StreamFactory.ZeroRate.selector);
        factory.create(merchant, subscriber, address(usd), 0, ESCROW);
        vm.expectRevert(StreamFactory.ZeroCap.selector);
        factory.create(merchant, subscriber, address(usd), RATE, 0);
    }

    function test_FR_CON_003_emits_StreamCreated_with_cap() public {
        vm.expectEmit(false, true, true, true);
        emit StreamFactory.StreamCreated(address(0), merchant, subscriber, address(usd), RATE, ESCROW);
        factory.create(merchant, subscriber, address(usd), RATE, ESCROW);
    }

    function test_FR_CON_004_keeper_is_owner_only() public {
        assertEq(factory.owner(), owner);
        assertEq(factory.keeper(), owner);
        assertTrue(factory.implementation() != address(0));

        factory.setKeeper(stranger);
        assertEq(factory.keeper(), stranger);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setKeeper(stranger);
    }

    function test_FR_CON_005_initialize_once_and_never_on_implementation() public {
        AccrualStream s = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        vm.expectRevert(AccrualStream.AlreadyInitialized.selector);
        s.initialize(merchant, subscriber, address(usd), RATE, ESCROW, 100, treasury);

        AccrualStream impl = AccrualStream(factory.implementation());
        vm.expectRevert(AccrualStream.AlreadyInitialized.selector);
        impl.initialize(merchant, subscriber, address(usd), RATE, ESCROW, 100, treasury);
        assertEq(uint8(impl.status()), uint8(AccrualStream.Status.Canceled), "implementation is dead");
    }

    function test_FR_CON_006_fee_defaults_caps_and_is_owner_only() public {
        assertEq(factory.feeBps(), 100);
        assertEq(factory.treasury(), treasury);
        assertEq(factory.MAX_FEE_BPS(), 1_000);

        vm.expectRevert(StreamFactory.FeeTooHigh.selector);
        factory.setFee(1_001, treasury);
        vm.expectRevert(StreamFactory.ZeroAddress.selector);
        factory.setFee(50, address(0));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setFee(50, treasury);

        vm.expectEmit();
        emit StreamFactory.FeeChanged(1_000, stranger);
        factory.setFee(1_000, stranger);
        assertEq(factory.feeBps(), 1_000);
    }

    /// Undecided 9: a running stream keeps the rate it was created under.
    function test_FR_CON_006_fee_is_snapshotted_at_create() public {
        AccrualStream before = runningStream();
        factory.setFee(500, treasury);
        AccrualStream after_ = runningStream();

        assertEq(before.feeBps(), 100);
        assertEq(after_.feeBps(), 500);

        vm.warp(block.timestamp + 100);
        before.settle();
        after_.settle();
        uint256 gross = 100 * RATE;
        // merchant received (gross - 1 %) + (gross - 5 %)
        assertEq(usd.balanceOf(merchant), (gross - gross / 100) + (gross - gross / 20));
        assertEq(usd.balanceOf(treasury), gross / 100 + gross / 20);
    }
}

