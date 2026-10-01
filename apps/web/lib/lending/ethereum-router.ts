import { encodeFunctionData, parseAbi, type Address } from 'viem';
import type { LendingProvider } from './markets';

export const ROUTED_ETHEREUM_PROVIDERS = ['aave', 'morpho', 'compound', 'spark', 'euler', 'gearbox'] as const;
export const LENDING_ROUTER_ABI = parseAbi([
  'function usdc() view returns(address)', 'function treasury() view returns(address)',
  'function targets(uint256) view returns(address)', 'function supply(uint8 provider,uint256 principal)',
  'event Lent(address indexed user,address indexed target,uint256 principal,uint256 fee)',
]);
export function routedLendingCall(router: Address, provider: LendingProvider, principal: bigint) {
  const index = (ROUTED_ETHEREUM_PROVIDERS as readonly string[]).indexOf(provider);
  if (index < 0) throw new Error('Unsupported Ethereum lending destination.');
  return { to: router, data: encodeFunctionData({ abi: LENDING_ROUTER_ABI, functionName: 'supply', args: [index, principal] }) };
}
