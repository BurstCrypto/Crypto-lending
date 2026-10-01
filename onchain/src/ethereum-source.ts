import { encodeFunctionData, getAddress, isAddress, parseAbi, type Address, type Hex } from 'viem';
import {
  ETHEREUM,
  assertSourceBridgePlan,
  ethereumBridgeIntent,
  type SourceBridgePlan,
} from './source-plan.ts';

export const CCTP_SOURCE_ROUTER_ABI = parseAbi([
  'struct BridgeIntent { bytes32 intentId; address user; bytes32 mintRecipient; uint256 principal; uint256 maxBridgeFee; uint256 minimumDestinationAmount; uint16 feeBps; uint256 deadline; }',
  'function bridge(BridgeIntent intent, bytes quoteSignature)',
  'function bridgeWithPermit(BridgeIntent intent, bytes quoteSignature, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s)',
  'function usdc() view returns (address)',
  'function messenger() view returns (address)',
  'function treasury() view returns (address)',
  'function quoteAuthority() view returns (address)',
  'event SourceBridgeInitiated(bytes32 indexed intentId, address indexed user, address indexed treasury, bytes32 mintRecipient, uint256 principal, uint256 platformFee, uint256 maxBridgeFee, uint256 minimumDestinationAmount)',
]);

export interface EthereumSourceTransaction {
  readonly from: Address;
  readonly to: Address;
  readonly data: Hex;
  readonly value: '0x0';
  readonly chainId: '0x1';
}

export function checkedEthereumAddress(address: Address): Address {
  if (!isAddress(address) || /^0x0{40}$/iu.test(address))
    throw new Error('INVALID_ETHEREUM_ADDRESS');
  return getAddress(address);
}

/** Unsigned mainnet transaction for the user's browser wallet; never sends or signs a transaction. */
export function prepareEthereumSourceBridge(input: {
  plan: SourceBridgePlan;
  router: Address;
  quoteSignature: Hex;
  permit?: { deadline: bigint; v: number; r: Hex; s: Hex };
}): EthereumSourceTransaction {
  assertSourceBridgePlan(input.plan);
  if (input.plan.sourceNetwork !== ETHEREUM) throw new Error('WRONG_SOURCE_CHAIN');
  const intent = ethereumBridgeIntent(input.plan);
  const data = input.permit
    ? encodeFunctionData({
        abi: CCTP_SOURCE_ROUTER_ABI,
        functionName: 'bridgeWithPermit',
        args: [
          intent,
          input.quoteSignature,
          input.permit.deadline,
          input.permit.v,
          input.permit.r,
          input.permit.s,
        ],
      })
    : encodeFunctionData({
        abi: CCTP_SOURCE_ROUTER_ABI,
        functionName: 'bridge',
        args: [intent, input.quoteSignature],
      });
  return Object.freeze({
    from: intent.user,
    to: checkedEthereumAddress(input.router),
    data,
    value: '0x0',
    chainId: '0x1',
  });
}

/** Destination lending is separately authorized after mint verification and takes no additional platform fee. */
export function prepareEthereumAaveSupply(input: {
  user: Address;
  supplyRouter: Address;
  principal: bigint;
  minimumATokens: bigint;
}): EthereumSourceTransaction {
  if (input.principal <= 0n || input.minimumATokens <= 0n || input.minimumATokens > input.principal)
    throw new Error('INVALID_SUPPLY');
  return Object.freeze({
    from: checkedEthereumAddress(input.user),
    to: checkedEthereumAddress(input.supplyRouter),
    value: '0x0',
    chainId: '0x1',
    data: encodeFunctionData({
      abi: parseAbi(['function supply(uint256 principal, uint256 minimumATokens)']),
      functionName: 'supply',
      args: [input.principal, input.minimumATokens],
    }),
  });
}
