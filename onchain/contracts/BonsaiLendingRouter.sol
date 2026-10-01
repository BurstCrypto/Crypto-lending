// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILendingPool { function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external; }
interface ILendingComet { function supplyTo(address dst, address asset, uint256 amount) external; }
interface ILendingVault { function deposit(uint256 assets, address receiver) external returns (uint256); }
interface ILendingMorpho {
    struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }
    function supply(MarketParams calldata params, uint256 assets, uint256 shares, address onBehalf, bytes calldata data) external returns (uint256, uint256);
}

/// Fee and deposit succeed together. Positions belong directly to the calling wallet.
contract BonsaiLendingRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable usdc;
    address public immutable treasury;
    address[6] public targets;
    event Lent(address indexed user, address indexed target, uint256 principal, uint256 fee);

    constructor(address token, address recipient, address[6] memory markets) {
        require(token != address(0) && recipient != address(0), "ZERO_ADDRESS");
        usdc = IERC20(token);
        treasury = recipient;
        for (uint256 i; i < 6; i++) require(markets[i] != address(0), "ZERO_MARKET");
        targets = markets;
    }

    function supply(uint8 provider, uint256 principal) external nonReentrant {
        require(provider < 6 && principal > 0 && msg.sender != treasury, "INVALID_DEPOSIT");
        // 10 bps (0.10%), rounded half to even in six-decimal USDC units.
        uint256 fee = principal / 1000;
        uint256 remainder = principal % 1000;
        if (remainder > 500 || (remainder == 500 && fee % 2 == 1)) fee++;
        address target = targets[provider];
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), principal + fee);
        if (fee > 0) usdc.safeTransfer(treasury, fee);
        usdc.forceApprove(target, principal);
        if (provider == 0 || provider == 3) ILendingPool(target).supply(address(usdc), principal, msg.sender, 0);
        else if (provider == 1) {
            ILendingMorpho.MarketParams memory params = ILendingMorpho.MarketParams({
                loanToken: address(usdc),
                collateralToken: 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf,
                oracle: 0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a,
                irm: 0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC,
                lltv: 860000000000000000
            });
            (uint256 assets, uint256 shares) = ILendingMorpho(target).supply(params, principal, 0, msg.sender, "");
            require(assets == principal && shares > 0, "INVALID_SHARES");
        } else if (provider == 2) ILendingComet(target).supplyTo(msg.sender, address(usdc), principal);
        else require(ILendingVault(target).deposit(principal, msg.sender) > 0, "INVALID_SHARES");
        usdc.forceApprove(target, 0);
        require(usdc.balanceOf(address(this)) == beforeBalance, "INVALID_DEBIT");
        emit Lent(msg.sender, target, principal, fee);
    }
}
