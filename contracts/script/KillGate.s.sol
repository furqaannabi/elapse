// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StreamFactory} from "../src/StreamFactory.sol";
import {AccrualStream} from "../src/AccrualStream.sol";
import {MockUSD} from "../src/MockUSD.sol";

/// The Week 1 kill gate on a live network (FR-CON-073), in two steps because a
/// script cannot wait 83 seconds on chain:
///
///   forge script script/KillGate.s.sol --sig "start()" ...   → creates, funds, starts
///   (wait at least 83 s)
///   forge script script/KillGate.s.sol --sig "cancel()" ...  → cancels, prints the split
///
/// The broadcaster is the Subscriber. The Merchant is a fixed address nobody
/// holds, so its balance is a clean readout of what was paid.
///
/// By default the gate runs on the deployment's MockUSD and mints what it
/// needs. Set TOKEN=0x... to run on a real token the broadcaster already holds
/// (AUSD, USDC): nothing is minted and the balance must cover the escrow.
contract KillGate is Script {
    address constant MERCHANT = address(uint160(0xE1A5E));
    uint256 constant RATE = 4_000; // $0.004 / s at 6 decimals
    uint256 constant CAP_SECONDS = 3_600;
    uint256 constant ESCROW = RATE * CAP_SECONDS; // $14.40

    function _deployments() internal view returns (address factory, address mockUsd) {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        factory = vm.parseJsonAddress(json, ".factory");
        mockUsd = vm.parseJsonAddress(json, ".mockUsd");
    }

    function _statePath() internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), ".killgate.json");
    }

    function start() external {
        (address factoryAddr, address mockUsd) = _deployments();
        StreamFactory factory = StreamFactory(factoryAddr);
        address tokenAddr = vm.envOr("TOKEN", mockUsd);
        bool isMock = tokenAddr == mockUsd;
        MockUSD usd = MockUSD(tokenAddr);
        vm.startBroadcast();
        // The broadcaster is the Subscriber. Read it after startBroadcast:
        // before that point msg.sender is Foundry's placeholder, not the keystore.
        (, address subscriber,) = vm.readCallers();
        if (isMock) {
            usd.mint(subscriber, ESCROW);
        } else {
            require(usd.balanceOf(subscriber) >= ESCROW, "wallet does not hold enough of TOKEN for the escrow");
        }
        address streamAddr = factory.create(MERCHANT, subscriber, tokenAddr, RATE, ESCROW);
        usd.approve(streamAddr, ESCROW);
        AccrualStream(streamAddr).deposit(ESCROW);
        AccrualStream(streamAddr).start();
        vm.stopBroadcast();

        string memory json = "killgate";
        vm.serializeAddress(json, "stream", streamAddr);
        vm.serializeAddress(json, "subscriber", subscriber);
        vm.serializeAddress(json, "merchant", MERCHANT);
        vm.serializeAddress(json, "token", tokenAddr);
        vm.serializeUint(json, "rate", RATE);
        vm.serializeUint(json, "escrow", ESCROW);
        string memory out = vm.serializeUint(json, "startedAt", block.timestamp);
        vm.writeJson(out, _statePath());

        console.log("stream    ", streamAddr);
        console.log("started at", block.timestamp);
        console.log("now wait at least 83 seconds, then run cancel()");
    }

    function cancel() external {
        string memory json = vm.readFile(_statePath());
        AccrualStream stream = AccrualStream(vm.parseJsonAddress(json, ".stream"));
        MockUSD usd = MockUSD(address(stream.token()));
        address treasury = stream.treasury();

        uint256 merchantBefore = usd.balanceOf(MERCHANT);
        uint256 treasuryBefore = usd.balanceOf(treasury);
        vm.startBroadcast();
        (, address subscriber,) = vm.readCallers();
        uint256 subBefore = usd.balanceOf(subscriber);
        stream.cancel();
        vm.stopBroadcast();

        uint256 secs = stream.settledSeconds();
        uint256 gross = stream.settledAmount();
        console.log("seconds elapsed      ", secs);
        console.log("gross settled (units)", gross);
        console.log("merchant received    ", usd.balanceOf(MERCHANT) - merchantBefore);
        console.log("treasury received    ", usd.balanceOf(treasury) - treasuryBefore);
        console.log("subscriber refunded  ", usd.balanceOf(subscriber) - subBefore);
        console.log("stream balance       ", usd.balanceOf(address(stream)));
    }
}
