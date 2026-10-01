// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestUsdc is ERC20, ERC20Permit {
    address public blocked;
    constructor() ERC20("Fixture USDC", "USDC") ERC20Permit("Fixture USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setBlocked(address to) external { blocked = to; }
    function decimals() public pure override returns (uint8) { return 6; }
    function _update(address from, address to, uint256 amount) internal override {
        require(to != blocked || to == address(0), "blocked transfer");
        super._update(from, to, amount);
    }
}

contract TestMessenger {
    bool public fail;
    bool public skipBurn;
    bytes32 public lastRecipient;
    uint256 public lastAmount;
    function setFailure(bool value) external { fail = value; }
    function setSkipBurn(bool value) external { skipBurn = value; }
    function depositForBurnWithHook(uint256 amount, uint32 domain, bytes32 recipient,
        address token, bytes32 caller, uint256 maxFee, uint32 finality, bytes calldata hookData) external {
        require(domain == 5 && caller == bytes32(0) && finality == 2000 && maxFee < amount, "bad bridge params");
        require(hookData.length == 36 && bytes4(hookData[:4]) == 0x424e5331, "bad route hook");
        lastRecipient = recipient;
        lastAmount = amount;
        if (!skipBurn) require(IERC20(token).transferFrom(msg.sender, address(this), amount));
        require(!fail, "bridge failed after transfer");
    }
}

contract TestPool {
    TestUsdc public immutable aToken;
    bool public fail;
    constructor(address token) { aToken = TestUsdc(token); }
    function setFailure(bool value) external { fail = value; }
    function supply(address token, uint256 amount, address recipient, uint16 referral) external {
        require(!fail && referral == 0, "pool failed");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount));
        aToken.mint(recipient, amount);
    }
}

// Protocol double only: this is deliberately not an attestation verifier.
contract TestMessageTransmitter {
    TestUsdc public immutable usdc;
    mapping(bytes32 => bool) public used;
    constructor(address token) { usdc = TestUsdc(token); }
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool) {
        require(attestation.length == 1 && attestation[0] == 0x01, "invalid fixture attestation");
        (address recipient, uint256 amount, bytes32 nonce) = abi.decode(message, (address, uint256, bytes32));
        require(!used[nonce], "nonce already used");
        used[nonce] = true;
        usdc.mint(recipient, amount);
        return true;
    }
}
