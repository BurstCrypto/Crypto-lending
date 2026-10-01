// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILendingMorpho} from "../../contracts/BonsaiLendingRouter.sol";

contract TestLendingMarket {
    IERC20 public immutable token;
    mapping(address => uint256) public supplied;
    bool public fail;
    constructor(address asset) { token = IERC20(asset); }
    function setFailure(bool value) external { fail = value; }
    function record(address asset, uint256 amount, address user) internal {
        require(asset == address(token), "WRONG_ASSET");
        require(token.transferFrom(msg.sender, address(this), amount));
        supplied[user] += amount;
        require(!fail, "LENDING_FAILED");
    }
    function supply(address asset, uint256 amount, address user, uint16) external { record(asset, amount, user); }
    function supplyTo(address user, address asset, uint256 amount) external { record(asset, amount, user); }
    function deposit(uint256 amount, address user) external returns(uint256) { record(address(token), amount, user); return amount; }
    function supply(ILendingMorpho.MarketParams calldata params, uint256 amount, uint256 shares, address user, bytes calldata data) external returns(uint256, uint256) {
        require(shares == 0 && data.length == 0 && params.lltv == 860000000000000000, "WRONG_MARKET");
        record(params.loanToken, amount, user); return (amount, amount);
    }
}
