// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {StreamFactory} from "../src/StreamFactory.sol";
import {AccrualStream} from "../src/AccrualStream.sol";

/// The Week 1 kill gate (FR-CON-073): create → deposit → start → 83 s → cancel.
/// Merchant receives 83 × rate minus the fee, treasury receives the fee,
/// subscriber gets everything else back. If this cannot pass, nothing else matters.
contract KillGateTest is Test {
    MockUSD usd;
    StreamFactory factory;
    address merchant = makeAddr("merchant");
    address subscriber = makeAddr("subscriber");
    address treasury = makeAddr("treasury");

    uint256 constant RATE = 4_000; // $0.004 / s in 6-decimal units
    uint256 constant CAP = 3_600; // seconds
    uint256 constant ESCROW = RATE * CAP; // $14.40

    function setUp() public {
        usd = new MockUSD();
        factory = new StreamFactory(treasury);
        usd.mint(subscriber, ESCROW);
    }

    function test_FR_CON_073_kill_gate_83_seconds() public {
        address streamAddr = factory.create(merchant, subscriber, address(usd), RATE, ESCROW);
        AccrualStream stream = AccrualStream(streamAddr);

        vm.startPrank(subscriber);
        usd.approve(streamAddr, ESCROW);
        stream.deposit(ESCROW);
        stream.start();
        vm.stopPrank();

        vm.warp(block.timestamp + 83);

        vm.prank(subscriber);
        stream.cancel();

        uint256 gross = 83 * RATE; // 332_000
        uint256 fee = gross / 100; // 1 % = 3_320
        assertEq(usd.balanceOf(merchant), gross - fee, "merchant gets 83 s minus fee");
        assertEq(usd.balanceOf(treasury), fee, "treasury gets the fee");
        assertEq(usd.balanceOf(subscriber), ESCROW - gross, "subscriber gets the rest back");
        assertEq(usd.balanceOf(streamAddr), 0, "stream is empty after cancel");
        assertEq(uint8(stream.status()), uint8(AccrualStream.Status.Canceled));
    }
}
