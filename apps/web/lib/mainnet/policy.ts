import { getAddress, parseAbi, type Address, type Hex } from 'viem';

// Aave Ethereum Core V3. Checked against the Aave DAO address book on 2026-09-14.
// https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Ethereum.sol
export const MAINNET_TEST = Object.freeze({
  origin: 'http://127.0.0.1:3000',
  chainId: '0x1',
  pool: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2' as Address,
  provider: '0x2f39d218133afab8f2b819b1066c7e434ad94e9e' as Address,
  implementation: '0x728a138a4823392c2efa55e028d434f526fe03cf' as Address,
  dataProvider: '0x0a16f2fcc0d44fae41cc54e079281d84a363becd' as Address,
  usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Address,
  aToken: '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c' as Address,
  // Serialization ceiling below Number.MAX_SAFE_INTEGER, not a deposit budget.
  // Actual deposits are bounded by the selected wallet balance and protocol capacity.
  maxAmount: 9_000_000_000_000_000n,
  gasReserve: 1_000_000_000_000_000n,
});

export const TOKEN_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function UNDERLYING_ASSET_ADDRESS() view returns (address)',
  'function POOL() view returns (address)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
export const POOL_ABI = parseAbi([
  'function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)',
  'function withdraw(address asset,uint256 amount,address to) returns (uint256)',
  'function ADDRESSES_PROVIDER() view returns (address)',
  'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
  'event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)',
]);
export const BINDING_ABI = parseAbi([
  'function getPool() view returns (address)',
  'function implementation() view returns (address)',
  'function getReserveTokensAddresses(address) view returns (address,address,address)',
  'function getReserveConfigurationData(address) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)',
  'function getPaused(address) view returns (bool)',
]);

export interface MainnetTestSnapshot {
  wallet: Address;
  blockNumber: string;
  blockHash: Hex;
  observedAt: number;
  usdc: string;
  supplied: string;
  allowance: string;
  eth: string;
  totalDebt: string;
}

export class MainnetTestError extends Error {}
export function fail(message: string): never {
  throw new MainnetTestError(message);
}
export function address(value: unknown): Address {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    return fail('Enter a nonzero Ethereum wallet address.');
  }
  try {
    return getAddress(value).toLowerCase() as Address;
  } catch {
    return fail('The Ethereum address checksum is invalid.');
  }
}
export function usdcAmount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(value)) {
    return fail('Enter a positive USDC amount with up to six decimals.');
  }
  const [whole, decimal = ''] = value.split('.');
  const units = BigInt(whole!) * 1_000_000n + BigInt(decimal.padEnd(6, '0'));
  if (units <= 0n || units > MAINNET_TEST.maxAmount)
    return fail('The USDC amount is outside the supported numeric range.');
  return units;
}
