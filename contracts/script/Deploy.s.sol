// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StreamFactory} from "../src/StreamFactory.sol";
import {MockUSD} from "../src/MockUSD.sol";

/// Deploys the implementation + factory and, on testnet, a MockUSD, then
/// writes `deployments/<chainId>.json` for the API, indexer and docs
/// (FR-CON-062). The AUSD address per chain is recorded alongside so every
/// consumer reads one file (Undecided 7).
///
/// Usage:
///   TREASURY=0x... forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --account <keystore>
/// The deployer key comes from a keystore or `--private-key`; it is never in code.
contract Deploy is Script {
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC; // chain 10143
    address constant AUSD_MAINNET = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a; // chain 143

    function run() external {
        address treasury = vm.envAddress("TREASURY");
        uint256 chainId = block.chainid;

        vm.startBroadcast();
        StreamFactory factory = new StreamFactory(treasury);
        address mock = address(0);
        if (chainId != 143) {
            mock = address(new MockUSD());
        }
        vm.stopBroadcast();

        address ausd = chainId == 143 ? AUSD_MAINNET : chainId == 10143 ? AUSD_TESTNET : address(0);

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", chainId);
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "implementation", factory.implementation());
        vm.serializeAddress(json, "treasury", treasury);
        vm.serializeUint(json, "feeBps", factory.feeBps());
        vm.serializeAddress(json, "ausd", ausd);
        vm.serializeUint(json, "ausdDecimals", 6);
        vm.serializeUint(json, "deployedAtBlock", block.number);
        string memory out = vm.serializeAddress(json, "mockUsd", mock);

        string memory path = string.concat("deployments/", vm.toString(chainId), ".json");
        vm.writeJson(out, path);

        console.log("factory       ", address(factory));
        console.log("implementation", factory.implementation());
        console.log("mockUSD       ", mock);
        console.log("wrote         ", path);
    }
}
