import { encodeFunctionData, maxUint256, parseAbi, type Address, type Hex } from 'viem';
import { ETH_USDC, ETHEREUM, MARKETS, MORPHO, type LendingProvider } from './markets';

export const COMET_ABI = parseAbi([
  'function baseToken() view returns(address)',
  'function getUtilization() view returns(uint256)',
  'function getSupplyRate(uint256) view returns(uint64)',
  'function isSupplyPaused() view returns(bool)',
  'function isWithdrawPaused() view returns(bool)',
  'function borrowBalanceOf(address) view returns(uint256)',
  'function balanceOf(address) view returns(uint256)',
  'function supply(address,uint256)',
  'function withdraw(address,uint256)',
  'event Supply(address indexed from,address indexed dst,uint256 amount)',
  'event Withdraw(address indexed src,address indexed to,uint256 amount)',
]);
export const VAULT_ABI = parseAbi([
  'function asset() view returns(address)',
  'function totalAssets() view returns(uint256)',
  'function totalSupply() view returns(uint256)',
  'function balanceOf(address) view returns(uint256)',
  'function maxDeposit(address) view returns(uint256)',
  'function maxRedeem(address) view returns(uint256)',
  'function previewDeposit(uint256) view returns(uint256)',
  'function previewRedeem(uint256) view returns(uint256)',
  'function convertToAssets(uint256) view returns(uint256)',
  'function deposit(uint256,address) returns(uint256)',
  'function redeem(uint256,address,address) returns(uint256)',
  'event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)',
  'event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)',
]);
export const BLUE_ABI = parseAbi([
  'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
  'struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }',
  'function idToMarketParams(bytes32) view returns(MarketParams)',
  'function market(bytes32) view returns(uint128,uint128,uint128,uint128,uint128,uint128)',
  'function position(bytes32,address) view returns(uint256,uint128,uint128)',
  'function borrowRateView(MarketParams,Market) view returns(uint256)',
  'function supply(MarketParams,uint256,uint256,address,bytes) returns(uint256,uint256)',
  'function withdraw(MarketParams,uint256,uint256,address,address) returns(uint256,uint256)',
  'event Supply(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets,uint256 shares)',
  'event Withdraw(bytes32 indexed id,address caller,address indexed onBehalf,address indexed receiver,uint256 assets,uint256 shares)',
]);
export const SPARK_ABI = parseAbi([
  'function supply(address,uint256,address,uint16)',
  'function withdraw(address,uint256,address) returns(uint256)',
  'function getUserAccountData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256)',
  'function getReserveData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)',
  'function getReserveCaps(address) view returns(uint256,uint256)',
  'function getReserveConfigurationData(address) view returns(uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)',
  'function getPaused(address) view returns(bool)',
  'function getReserveTokensAddresses(address) view returns(address,address,address)',
  'event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)',
]);
export const blueParams = () => ({
  loanToken: MORPHO.loanToken,
  collateralToken: MORPHO.collateralToken,
  oracle: MORPHO.oracle,
  irm: MORPHO.irm,
  lltv: MORPHO.lltv,
});
export function marketCall(
  provider: LendingProvider,
  wallet: Address,
  action: 'supply' | 'withdraw',
  amount: bigint,
  shares = 0n,
): { to: Address; data: Hex } {
  const market = MARKETS[provider];
  if (market.network !== ETHEREUM || provider === 'aave')
    throw new Error('Unsupported additional Ethereum market.');
  let data: Hex;
  if (provider === 'morpho')
    data =
      action === 'supply'
        ? encodeFunctionData({
            abi: BLUE_ABI,
            functionName: 'supply',
            args: [blueParams(), amount, 0n, wallet, '0x'],
          })
        : encodeFunctionData({
            abi: BLUE_ABI,
            functionName: 'withdraw',
            args: [blueParams(), 0n, shares, wallet, wallet],
          });
  else if (provider === 'compound')
    data = encodeFunctionData({
      abi: COMET_ABI,
      functionName: action === 'supply' ? 'supply' : 'withdraw',
      args: [ETH_USDC, action === 'supply' ? amount : maxUint256],
    });
  else if (provider === 'spark')
    data =
      action === 'supply'
        ? encodeFunctionData({
            abi: SPARK_ABI,
            functionName: 'supply',
            args: [ETH_USDC, amount, wallet, 0],
          })
        : encodeFunctionData({
            abi: SPARK_ABI,
            functionName: 'withdraw',
            args: [ETH_USDC, maxUint256, wallet],
          });
  else
    data =
      action === 'supply'
        ? encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit', args: [amount, wallet] })
        : encodeFunctionData({
            abi: VAULT_ABI,
            functionName: 'redeem',
            args: [shares, wallet, wallet],
          });
  return { to: market.target as Address, data };
}
