// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {StreamFactory} from "../src/StreamFactory.sol";
import {AccrualStream} from "../src/AccrualStream.sol";

/// Shared fixture: a factory with a 1 % fee, a funded subscriber, and helpers
/// that mirror the checkout's happy path. Rate is $0.004 / s at 6 decimals.
abstract contract BaseTest is Test {
    MockUSD usd;
    StreamFactory factory;

    address owner = address(this);
    address merchant = makeAddr("merchant");
    address subscriber = makeAddr("subscriber");
    address treasury = makeAddr("treasury");
    address stranger = makeAddr("stranger");

    uint256 constant RATE = 4_000;
    uint256 constant CAP_SECONDS = 3_600;
    uint256 constant ESCROW = RATE * CAP_SECONDS; // 14_400_000

    function setUp() public virtual {
        usd = new MockUSD();
        factory = new StreamFactory(treasury);
        usd.mint(subscriber, 100 * ESCROW);
        vm.warp(1_756_800_000); // a real-looking timestamp so 0 never means "unset"
    }

    /// create + deposit the full cap as the subscriber; not started.
    function fundedStream() internal returns (AccrualStream s) {
        s = AccrualStream(factory.create(merchant, subscriber, address(usd), RATE, ESCROW));
        vm.startPrank(subscriber);
        usd.approve(address(s), ESCROW);
        s.deposit(ESCROW);
        vm.stopPrank();
    }

    /// create + deposit + start.
    function runningStream() internal returns (AccrualStream s) {
        s = fundedStream();
        vm.prank(subscriber);
        s.start();
    }

    function fee(uint256 gross) internal pure returns (uint256) {
        return gross / 100;
    }
}
