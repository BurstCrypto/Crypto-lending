import type {
  EvmAddress,
  EvmNetworkId,
  EvmSourceBlock,
  EvmStablecoinBalanceSnapshot,
} from '../../domain/evm-stablecoin-position';

export type EvmBalanceReadFailureCode =
  'RATE_LIMITED' | 'TIMEOUT' | 'TEMPORARY_UNAVAILABLE' | 'PERMANENT_FAILURE';

export class EvmBalanceReadFailure extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly code: EvmBalanceReadFailureCode,
    options: Readonly<{ retryAfterMs?: number }> = {},
  ) {
    super(code);
    this.name = 'EvmBalanceReadFailure';
    if (
      code !== 'RATE_LIMITED' &&
      code !== 'TIMEOUT' &&
      code !== 'TEMPORARY_UNAVAILABLE' &&
      code !== 'PERMANENT_FAILURE'
    ) {
      throw new TypeError('code must be a recognized EVM balance read failure code');
    }
    if (
      options.retryAfterMs !== undefined &&
      (!Number.isSafeInteger(options.retryAfterMs) || options.retryAfterMs < 0)
    ) {
      throw new TypeError('retryAfterMs must be a non-negative safe integer');
    }
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface EvmChainIdentityReadRequest {
  /** Trusted immutable connector configuration, never a provider-supplied label. */
  readonly expectedNetworkId: EvmNetworkId;
}

export interface EvmSourceBlockReadRequest {
  readonly expectedNetworkId: EvmNetworkId;
  readonly selector: 'latest';
}

export interface EvmTokenBalanceBatchReadRequest {
  readonly expectedNetworkId: EvmNetworkId;
  readonly walletAddress: EvmAddress;
  readonly contractAddresses: readonly EvmAddress[];
  /** Every balance call must be pinned to both values by the concrete adapter. */
  readonly sourceBlock: EvmSourceBlock;
}

/**
 * Provider-neutral normalized read boundary. A future adapter is responsible
 * for standard `eth_chainId`, `eth_getBlockByNumber`, and batched `eth_call`
 * requests. Unknown return values are validated again by the indexer.
 */
export interface EvmStablecoinBalanceReaderPort {
  readChainIdentity(request: EvmChainIdentityReadRequest): Promise<unknown>;
  readSourceBlock(request: EvmSourceBlockReadRequest): Promise<unknown>;
  readTokenBalances(request: EvmTokenBalanceBatchReadRequest): Promise<unknown>;
}

export type EvmBalanceSnapshotWriteDisposition = 'CREATED' | 'UNCHANGED' | 'REPLACED';

/**
 * The adapter must atomically upsert by snapshot/position IDs. Replaying the
 * same snapshot must return `UNCHANGED`, never append duplicate positions.
 */
export interface EvmStablecoinPositionStorePort {
  upsertWalletSnapshot(
    snapshot: EvmStablecoinBalanceSnapshot,
  ): Promise<EvmBalanceSnapshotWriteDisposition>;
}

/** Injected so local tests never use wall-clock sleeps or nondeterministic randomness. */
export interface EvmBalanceRetrySchedulerPort {
  nextJitterMs(maximumInclusiveMs: number): number;
  wait(delayMs: number): Promise<void>;
}
