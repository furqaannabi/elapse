// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title MockUSD
/// @notice Stand-in for AUSD in tests and on testnet when real AUSD cannot be
///         obtained. Same shape as AUSD on Monad: six decimals and ERC-2612
///         `permit`, so a test that passes here passes against the real token.
///         Public `mint` so nothing depends on a faucet.
/// @dev FR-CON-063. Never deployed to mainnet.
contract MockUSD is ERC20, ERC20Permit {
    constructor() ERC20("Mock USD", "mUSD") ERC20Permit("Mock USD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
