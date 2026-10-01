// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
}

interface ICctpMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/// @notice Supplies USDC to one configured Aave market for the calling user.
/// @dev Direct-compatible supplies have zero platform fee under the current policy.
contract BonsaiAaveSupplyRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable usdc;
    IAaveV3Pool public immutable pool;
    IERC20 public immutable aToken;
    ICctpMessageTransmitterV2 public immutable messageTransmitter;
    event Supplied(address indexed user, uint256 principal);
    error InvalidSupply();

    constructor(address token_, address pool_, address aToken_, address messageTransmitter_) {
        if (token_.code.length == 0 || pool_.code.length == 0 || aToken_.code.length == 0 ||
            messageTransmitter_.code.length == 0 || token_ == aToken_) {
            revert InvalidSupply();
        }
        usdc = IERC20(token_);
        pool = IAaveV3Pool(pool_);
        aToken = IERC20(aToken_);
        messageTransmitter = ICctpMessageTransmitterV2(messageTransmitter_);
    }

    function supply(uint256 principal, uint256 minimumATokens) external nonReentrant {
        _supply(principal, minimumATokens);
    }

    /// @notice CCTP mints directly to the caller; this router supplies only the exact newly minted amount.
    /// @dev A failed supply rolls back the destination mint. A previously relayed mint uses supply() instead.
    function mintAndSupply(
        bytes calldata message, bytes calldata attestation,
        uint256 principal, uint256 minimumATokens
    ) external nonReentrant {
        _mint(message, attestation, principal);
        _supply(principal, minimumATokens);
    }

    function mintAndSupplyWithPermit(
        bytes calldata message, bytes calldata attestation,
        uint256 principal, uint256 minimumATokens,
        uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s
    ) external nonReentrant {
        _mint(message, attestation, principal);
        try IERC20Permit(address(usdc)).permit(
            msg.sender, address(this), principal, permitDeadline, v, r, s
        ) {} catch {}
        _supply(principal, minimumATokens);
    }

    function _mint(bytes calldata message, bytes calldata attestation, uint256 principal) private {
        uint256 beforeBalance = usdc.balanceOf(msg.sender);
        if (principal == 0 || !messageTransmitter.receiveMessage(message, attestation) ||
            usdc.balanceOf(msg.sender) != beforeBalance + principal) revert InvalidSupply();
    }

    function _supply(uint256 principal, uint256 minimumATokens) private {
        if (principal == 0 || minimumATokens == 0 || minimumATokens > principal) revert InvalidSupply();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        uint256 beforePosition = aToken.balanceOf(msg.sender);
        usdc.safeTransferFrom(msg.sender, address(this), principal);
        if (usdc.balanceOf(address(this)) != beforeBalance + principal) revert InvalidSupply();
        usdc.forceApprove(address(pool), principal);
        pool.supply(address(usdc), principal, msg.sender, 0);
        usdc.forceApprove(address(pool), 0);
        if (usdc.balanceOf(address(this)) != beforeBalance ||
            aToken.balanceOf(msg.sender) < beforePosition + minimumATokens) revert InvalidSupply();
        emit Supplied(msg.sender, principal);
    }
}
