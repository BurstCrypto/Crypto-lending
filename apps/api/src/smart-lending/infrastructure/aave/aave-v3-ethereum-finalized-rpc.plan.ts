import { createHash } from 'node:crypto';

import { CHAIN_OBSERVATION_REGISTRY_BINDINGS } from '../../../blockchain/domain/chain-observation-policy';
import type { AaveV3EthereumFinalizedRpcReadPlan } from './aave-v3-ethereum-finalized-rpc.source';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from './aave-v3-ethereum-deployment.manifest';

function abiAddressArgument(address: string): `0x${string}` {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function calldata(selector: string, address?: string): `0x${string}` {
  return address === undefined
    ? (selector as `0x${string}`)
    : (`${selector}${abiAddressArgument(address).slice(2)}` as `0x${string}`);
}

function deepFreeze<const Value>(value: Value): Readonly<Value> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function operation(
  operationId: string,
  method: 'eth_call' | 'eth_getCode',
  target: string,
  operationCalldata?: `0x${string}`,
  from?: string,
): Readonly<{
  operationId: string;
  method: 'eth_call' | 'eth_getCode';
  target: `0x${string}`;
  blockParameter: Readonly<{
    blockHash: 'CAPTURED_FINALIZED_BLOCK_HASH';
    requireCanonical: true;
  }>;
  calldata?: `0x${string}`;
  from?: `0x${string}`;
}> {
  const base = {
    operationId,
    method,
    target: target.toLowerCase() as `0x${string}`,
    blockParameter: Object.freeze({
      blockHash: 'CAPTURED_FINALIZED_BLOCK_HASH' as const,
      requireCanonical: true as const,
    }),
  };
  if (operationCalldata !== undefined && from !== undefined) {
    return Object.freeze({
      ...base,
      calldata: operationCalldata,
      from: from.toLowerCase() as `0x${string}`,
    });
  }
  if (operationCalldata !== undefined)
    return Object.freeze({ ...base, calldata: operationCalldata });
  return Object.freeze(base);
}

const manifest = AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST;

export const AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN = deepFreeze({
  schemaVersion: 1,
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  blockAcquisition: {
    initialMethod: 'eth_getBlockByNumber',
    initialSelector: 'finalized',
    includeTransactions: false,
    stateReadParameter: 'CAPTURED_BLOCK_HASH_REQUIRE_CANONICAL',
    consistencyRecheckMethod: 'eth_getBlockByNumber',
    consistencyRecheckSelector: 'CAPTURED_BLOCK_NUMBER',
  },
  manifestFingerprintSha256: manifest.manifestFingerprintSha256,
  assetRegistryFingerprintSha256: CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256,
  maximumAggregateResponseBytes: 1_048_576,
  expectedRpcCallCount: 19,
  requiredMethods: ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'],
  operations: [
    operation(
      'code:pool-addresses-provider',
      'eth_getCode',
      manifest.contracts.poolAddressesProvider,
    ),
    operation('code:pool-proxy', 'eth_getCode', manifest.contracts.poolProxy),
    operation('code:pool-implementation', 'eth_getCode', manifest.contracts.poolImplementation),
    operation(
      'code:protocol-data-provider',
      'eth_getCode',
      manifest.contracts.protocolDataProvider,
    ),
    operation('code:usdc-atoken', 'eth_getCode', manifest.assets.USDC.aToken),
    operation(
      'code:usdc-variable-debt-token',
      'eth_getCode',
      manifest.assets.USDC.variableDebtToken,
    ),
    operation('code:usdt-atoken', 'eth_getCode', manifest.assets.USDT.aToken),
    operation(
      'code:usdt-variable-debt-token',
      'eth_getCode',
      manifest.assets.USDT.variableDebtToken,
    ),
    operation(
      'call:provider-get-pool',
      'eth_call',
      manifest.contracts.poolAddressesProvider,
      calldata(manifest.selectors.getPool),
    ),
    operation(
      'call:provider-get-data-provider',
      'eth_call',
      manifest.contracts.poolAddressesProvider,
      calldata(manifest.selectors.getPoolDataProvider),
    ),
    operation(
      'call:pool-addresses-provider',
      'eth_call',
      manifest.contracts.poolProxy,
      calldata(manifest.selectors.addressesProvider),
    ),
    operation(
      'call:data-provider-addresses-provider',
      'eth_call',
      manifest.contracts.protocolDataProvider,
      calldata(manifest.selectors.addressesProvider),
    ),
    operation(
      'call:data-provider-pool',
      'eth_call',
      manifest.contracts.protocolDataProvider,
      calldata(manifest.selectors.pool),
    ),
    operation(
      'call:pool-implementation-from-admin',
      'eth_call',
      manifest.contracts.poolProxy,
      calldata(manifest.selectors.implementation),
      manifest.contracts.poolAddressesProvider,
    ),
    operation(
      'call:usdc-reserve-tokens',
      'eth_call',
      manifest.contracts.protocolDataProvider,
      calldata(manifest.selectors.getReserveTokensAddresses, manifest.assets.USDC.underlyingAsset),
    ),
    operation(
      'call:usdt-reserve-tokens',
      'eth_call',
      manifest.contracts.protocolDataProvider,
      calldata(manifest.selectors.getReserveTokensAddresses, manifest.assets.USDT.underlyingAsset),
    ),
  ],
} as const satisfies AaveV3EthereumFinalizedRpcReadPlan);

export const AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256 = createHash('sha256')
  .update(JSON.stringify(AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN), 'utf8')
  .digest('hex');
