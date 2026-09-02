// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AccrualStream
/// @notice Per-second AUSD (or ERC-20) meter. Cancel mid-stream; settle elapsed only.
/// @dev Week 1 target: start → cancel → settle elapsed. No tx per second; UI ticks from rate math.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract AccrualStream {
    address public merchant;
    address public subscriber;
    IERC20 public token;
    uint256 public ratePerSecond;
    uint256 public startedAt;
    uint256 public pausedAt;
    uint256 public settledSeconds;
    bool public canceled;

    event StreamStarted(address indexed merchant, address indexed subscriber, uint256 ratePerSecond, uint256 startedAt);
    event StreamPaused(uint256 at);
    event StreamCanceled(uint256 at, uint256 secondsElapsed, uint256 amount);
    event Settled(uint256 secondsAccounted, uint256 amount);

    error NotParty();
    error AlreadyCanceled();
    error NotStarted();
    error AlreadyStarted();

    constructor(address merchant_, address subscriber_, IERC20 token_, uint256 ratePerSecond_) {
        merchant = merchant_;
        subscriber = subscriber_;
        token = token_;
        ratePerSecond = ratePerSecond_;
    }

    function start() external {
        if (msg.sender != subscriber && msg.sender != merchant) revert NotParty();
        if (startedAt != 0) revert AlreadyStarted();
        startedAt = block.timestamp;
        emit StreamStarted(merchant, subscriber, ratePerSecond, startedAt);
    }

    function elapsedSeconds() public view returns (uint256) {
        if (startedAt == 0) return 0;
        uint256 end = canceled ? pausedAt : (pausedAt != 0 ? pausedAt : block.timestamp);
        if (end < startedAt) return 0;
        return end - startedAt;
    }

    function unsettledSeconds() public view returns (uint256) {
        uint256 e = elapsedSeconds();
        return e > settledSeconds ? e - settledSeconds : 0;
    }

    function cancel() external {
        if (msg.sender != subscriber && msg.sender != merchant) revert NotParty();
        if (canceled) revert AlreadyCanceled();
        if (startedAt == 0) revert NotStarted();
        pausedAt = block.timestamp;
        canceled = true;
        uint256 secs = unsettledSeconds();
        uint256 amount = secs * ratePerSecond;
        settledSeconds += secs;
        if (amount > 0) {
            token.transfer(merchant, amount);
        }
        emit StreamCanceled(pausedAt, elapsedSeconds(), amount);
        emit Settled(secs, amount);
    }
}
