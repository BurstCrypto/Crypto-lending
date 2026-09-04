import { Injectable } from '@nestjs/common';

export const AAVE_V3_ETHEREUM_FINALIZED_RPC_SOURCE = Symbol(
  'AAVE_V3_ETHEREUM_FINALIZED_RPC_SOURCE',
);

export type AaveV3EthereumDeploymentReadOperation = Readonly<{
  operationId: string;
  method: 'eth_call' | 'eth_getCode';
  target: `0x${string}`;
  blockParameter: Readonly<{
    blockHash: 'CAPTURED_FINALIZED_BLOCK_HASH';
    requireCanonical: true;
  }>;
  calldata?: `0x${string}`;
  from?: `0x${string}`;
}>;

export interface AaveV3EthereumFinalizedRpcReadPlan {
  readonly schemaVersion: 1;
  readonly networkId: 'eip155:1';
  readonly expectedChainId: '0x1';
  readonly blockSelector: 'finalized';
  readonly blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL';
  readonly blockAcquisition: Readonly<{
    initialMethod: 'eth_getBlockByNumber';
    initialSelector: 'finalized';
    includeTransactions: false;
    stateReadParameter: 'CAPTURED_BLOCK_HASH_REQUIRE_CANONICAL';
    consistencyRecheckMethod: 'eth_getBlockByNumber';
    consistencyRecheckSelector: 'CAPTURED_BLOCK_NUMBER';
  }>;
  readonly manifestFingerprintSha256: string;
  readonly assetRegistryFingerprintSha256: string;
  readonly maximumAggregateResponseBytes: 1_048_576;
  readonly expectedRpcCallCount: 19;
  readonly requiredMethods: readonly [
    'eth_chainId',
    'eth_getBlockByNumber',
    'eth_getCode',
    'eth_call',
  ];
  readonly operations: readonly AaveV3EthereumDeploymentReadOperation[];
}

export interface ReadAaveV3EthereumFinalizedRpcObservationRequest {
  readonly correlationId: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly plan: AaveV3EthereumFinalizedRpcReadPlan;
}

/**
 * Port boundary for one separately approved RPC source. Implementations must
 * execute exactly the supplied closed plan, enforce its cumulative
 * response-byte and deadline bounds before parsing, reject redirects or
 * endpoint changes, never log raw RPC payloads, and return the untrusted response
 * bundle for validation by the adapter. The request intentionally contains no
 * endpoint or credential. A concrete transport candidate exists in an adjacent
 * internal file but is deliberately not registered; the default implementation
 * below remains the runtime binding and always fails closed.
 */
export interface AaveV3EthereumFinalizedRpcSource {
  readFinalizedDeployment(
    request: ReadAaveV3EthereumFinalizedRpcObservationRequest,
  ): Promise<unknown>;
}

@Injectable()
export class UnavailableAaveV3EthereumFinalizedRpcSource implements AaveV3EthereumFinalizedRpcSource {
  readFinalizedDeployment(
    request: ReadAaveV3EthereumFinalizedRpcObservationRequest,
  ): Promise<unknown> {
    void request;
    return Promise.reject(new Error('Aave V3 Ethereum finalized RPC source is unavailable'));
  }
}
