// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICctpTokenMessengerV2 {
    function depositForBurnWithHook(
        uint256 amount, uint32 destinationDomain, bytes32 mintRecipient,
        address burnToken, bytes32 destinationCaller, uint256 maxFee,
        uint32 minFinalityThreshold, bytes calldata hookData
    ) external;
}

/// @notice Collects the platform fee on Ethereum atomically with a CCTP burn for Solana.
/// @dev Destination minting and lending are later transactions. No destination completion is asserted.
///      Non-upgradeable: token, bridge, treasury and quote authority are immutable.
contract BonsaiCctpSourceRouter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct BridgeIntent {
        bytes32 intentId;
        address user;
        bytes32 mintRecipient; // Solana USDC token account, NOT the wallet address.
        uint256 principal;
        uint256 maxBridgeFee;
        uint256 minimumDestinationAmount;
        uint16 feeBps;
        uint256 deadline;
    }

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "BridgeIntent(bytes32 intentId,address user,bytes32 mintRecipient,uint256 principal,uint256 maxBridgeFee,uint256 minimumDestinationAmount,uint16 feeBps,uint256 deadline)"
    );
    uint32 public constant SOLANA_DOMAIN = 5;
    uint32 public constant STANDARD_FINALITY = 2000;
    uint256 public constant MAX_QUOTE_LIFETIME = 5 minutes;
    IERC20 public immutable usdc;
    ICctpTokenMessengerV2 public immutable messenger;
    address public immutable treasury;
    address public immutable quoteAuthority;
    mapping(bytes32 => bool) public consumed;

    error InvalidConfiguration();
    error InvalidIntent();
    error InvalidAuthorization();
    error IntentAlreadyUsed();
    error UnsupportedTokenBehavior();

    event SourceBridgeInitiated(
        bytes32 indexed intentId, address indexed user, address indexed treasury,
        bytes32 mintRecipient, uint256 principal, uint256 platformFee,
        uint256 maxBridgeFee, uint256 minimumDestinationAmount
    );

    constructor(address token_, address messenger_, address treasury_, address quoteAuthority_)
        EIP712("BonsaiCctpSourceRouter", "1")
    {
        if (token_.code.length == 0 || messenger_.code.length == 0 ||
            treasury_ == address(0) || quoteAuthority_ == address(0) ||
            treasury_ == address(this) || treasury_ == token_ || treasury_ == messenger_) {
            revert InvalidConfiguration();
        }
        usdc = IERC20(token_);
        messenger = ICctpTokenMessengerV2(messenger_);
        treasury = treasury_;
        quoteAuthority = quoteAuthority_;
    }

    /// @notice Same half-even atomic-unit rounding as the application's version 1 policy.
    function platformFee(uint256 principal, uint16 feeBps) public pure returns (uint256) {
        if (feeBps != 20 && feeBps != 12 && feeBps != 8) revert InvalidIntent();
        // Division first avoids overflowing principal * feeBps.
        uint256 fee = (principal / 10_000) * feeBps;
        uint256 remainderProduct = (principal % 10_000) * feeBps;
        fee += remainderProduct / 10_000;
        uint256 remainder = remainderProduct % 10_000;
        if (remainder > 5000 || (remainder == 5000 && fee % 2 == 1)) ++fee;
        return fee;
    }

    function hashIntent(BridgeIntent calldata intent) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(INTENT_TYPEHASH, intent)));
    }

    function bridge(BridgeIntent calldata intent, bytes calldata quoteSignature)
        external nonReentrant
    {
        _bridge(intent, quoteSignature);
    }

    /// @notice Optional USDC-native permit removes the separate ERC-20 approval transaction.
    /// @dev A front-run permit is harmless: an existing sufficient allowance can still be used.
    function bridgeWithPermit(
        BridgeIntent calldata intent, bytes calldata quoteSignature,
        uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s
    ) external nonReentrant {
        _validate(intent, quoteSignature);
        uint256 total = intent.principal + platformFee(intent.principal, intent.feeBps);
        try IERC20Permit(address(usdc)).permit(
            msg.sender, address(this), total, permitDeadline, v, r, s
        ) {} catch {}
        _bridge(intent, quoteSignature);
    }

    function _validate(BridgeIntent calldata intent, bytes calldata signature) private view {
        if (intent.intentId == bytes32(0) || intent.user != msg.sender ||
            intent.user == treasury || intent.mintRecipient == bytes32(0) ||
            intent.principal == 0 || intent.principal > type(uint64).max || intent.maxBridgeFee >= intent.principal ||
            intent.minimumDestinationAmount == 0 ||
            intent.minimumDestinationAmount > intent.principal - intent.maxBridgeFee ||
            intent.deadline <= block.timestamp || intent.deadline > block.timestamp + MAX_QUOTE_LIFETIME) {
            revert InvalidIntent();
        }
        if (consumed[intent.intentId]) revert IntentAlreadyUsed();
        if (!SignatureChecker.isValidSignatureNow(quoteAuthority, hashIntent(intent), signature)) {
            revert InvalidAuthorization();
        }
    }

    function _bridge(BridgeIntent calldata intent, bytes calldata signature) private {
        _validate(intent, signature);
        uint256 fee = platformFee(intent.principal, intent.feeBps);
        uint256 total = intent.principal + fee;
        uint256 balanceBefore = usdc.balanceOf(address(this));
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        consumed[intent.intentId] = true;
        usdc.safeTransferFrom(msg.sender, address(this), total);
        if (usdc.balanceOf(address(this)) != balanceBefore + total) revert UnsupportedTokenBehavior();
        if (fee != 0) usdc.safeTransfer(treasury, fee);
        usdc.forceApprove(address(messenger), intent.principal);
        _burn(intent);
        usdc.forceApprove(address(messenger), 0);
        if (usdc.balanceOf(address(this)) != balanceBefore ||
            usdc.balanceOf(treasury) != treasuryBefore + fee) revert UnsupportedTokenBehavior();
        emit SourceBridgeInitiated(
            intent.intentId, intent.user, treasury, intent.mintRecipient, intent.principal,
            fee, intent.maxBridgeFee, intent.minimumDestinationAmount
        );
    }

    function _burn(BridgeIntent calldata intent) private {
        messenger.depositForBurnWithHook(
            intent.principal, SOLANA_DOMAIN, intent.mintRecipient, address(usdc),
            bytes32(0), intent.maxBridgeFee, STANDARD_FINALITY,
            abi.encodePacked(bytes4(0x424e5331), intent.intentId)
        );
    }
}
