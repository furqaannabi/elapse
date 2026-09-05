// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccrualStream} from "./AccrualStream.sol";

/// @title StreamFactory
/// @notice Spawns `AccrualStream` clones and holds the platform's few knobs:
///         the keeper address, the fee rate and the treasury that receives it.
///         Anyone may `create`; only a signed permit moves money, so an
///         unfunded stream is harmless (Undecided 11). `createWithPermit` is the
///         one-signature path the checkout uses: permit → create → pull escrow →
///         start, submitted by the relayer who pays gas (FR-CON-016).
///
/// @dev Spec: docs/specs/contracts-frd.md FR-CON-001–006, 016, 033.
contract StreamFactory is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Hard ceiling on the fee the owner may set: 10 % (Undecided 8).
    uint16 public constant MAX_FEE_BPS = 1_000;

    address public immutable implementation;
    address public keeper;
    /// Basis points of every settlement paid to `treasury`. Default 1 %.
    uint16 public feeBps = 100;
    address public treasury;

    event StreamCreated(
        address indexed stream,
        address indexed merchant,
        address indexed subscriber,
        address token,
        uint256 ratePerSecond,
        uint256 maxEscrow
    );
    event FeeChanged(uint16 bps, address treasury);
    event KeeperChanged(address keeper);

    error ZeroAddress();
    error ZeroRate();
    error ZeroCap();
    error FeeTooHigh();

    constructor(address treasury_) Ownable(msg.sender) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        keeper = msg.sender;
        implementation = address(new AccrualStream());
    }

    // ─── Platform knobs (FR-CON-004, FR-CON-006) ────────────────────────────

    function setKeeper(address keeper_) external onlyOwner {
        if (keeper_ == address(0)) revert ZeroAddress();
        keeper = keeper_;
        emit KeeperChanged(keeper_);
    }

    /// @notice Set the fee for streams created from now on. Running streams keep
    ///         the rate they were created under (Undecided 9).
    function setFee(uint16 bps, address treasury_) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        if (treasury_ == address(0)) revert ZeroAddress();
        feeBps = bps;
        treasury = treasury_;
        emit FeeChanged(bps, treasury_);
    }

    // ─── Creation (FR-CON-001–003, FR-CON-015) ──────────────────────────────

    /// @notice Deploy a stream. Permissionless; the stream holds nothing until
    ///         someone deposits into it.
    function create(address merchant, address subscriber, address token, uint256 ratePerSecond, uint256 maxEscrow)
        public
        returns (address stream)
    {
        if (merchant == address(0) || subscriber == address(0) || token == address(0)) revert ZeroAddress();
        if (ratePerSecond == 0) revert ZeroRate();
        if (maxEscrow == 0) revert ZeroCap();
        stream = Clones.clone(implementation);
        AccrualStream(stream).initialize(merchant, subscriber, token, ratePerSecond, maxEscrow, feeBps, treasury);
        emit StreamCreated(stream, merchant, subscriber, token, ratePerSecond, maxEscrow);
    }

    /// @notice The checkout path (FR-CON-016): one transaction, one signature.
    ///         The subscriber signed an ERC-2612 permit for exactly `maxEscrow`
    ///         with this factory as spender; the relayer submits. The permit is
    ///         applied inside try/catch so a front-runner who consumes the same
    ///         signature first cannot grief the call — the allowance check below
    ///         is what actually gates the transfer.
    function createWithPermit(
        address merchant,
        address subscriber,
        address token,
        uint256 ratePerSecond,
        uint256 maxEscrow,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (address stream) {
        try IERC20Permit(token).permit(subscriber, address(this), maxEscrow, deadline, v, r, s) {} catch {}
        stream = create(merchant, subscriber, token, ratePerSecond, maxEscrow);
        // Reverts here if the permit did not land and no allowance exists.
        IERC20(token).safeTransferFrom(subscriber, stream, maxEscrow);
        AccrualStream(stream).fundAndStart(subscriber, maxEscrow);
    }

    // ─── Keeper batch (FR-CON-033) ──────────────────────────────────────────

    /// @notice Settle many streams; one bad stream never blocks the batch.
    function settleBatch(address[] calldata streams) external {
        for (uint256 i = 0; i < streams.length; i++) {
            try AccrualStream(streams[i]).settle() {} catch {}
        }
    }
}
