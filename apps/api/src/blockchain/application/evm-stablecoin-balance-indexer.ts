import {
  CHAIN_OBSERVATION_RESILIENCE_POLICY,
  chainObservationPolicyForNetwork,
  isExpectedChainIdentity,
  observationTierRule,
} from '../domain/chain-observation-policy';
import {
  EvmStablecoinPositionValidationError,
  createEvmBalanceObservationId,
  createEvmBalanceSnapshotId,
  createEvmStablecoinPositionId,
  normalizeEvmAddress,
  normalizeEvmAtomicBalance,
  normalizeEvmBlockHash,
  normalizeEvmBlockNumber,
  type EvmAddress,
  type EvmChain,
  type EvmNetworkId,
  type EvmSourceBlock,
  type EvmStablecoinBalanceSnapshot,
  type EvmStablecoinPosition,
} from '../domain/evm-stablecoin-position';
import {
  supportedAssetRegistryForEnvironment,
  type AssetRegistryEnvironment,
  type SupportedStablecoinAsset,
} from '../domain/supported-asset-registry';
import {
  EvmBalanceReadFailure,
  type EvmBalanceRetrySchedulerPort,
  type EvmBalanceSnapshotWriteDisposition,
  type EvmStablecoinBalanceReaderPort,
  type EvmStablecoinPositionStorePort,
  type EvmTokenBalanceBatchReadRequest,
} from './ports/evm-stablecoin-balance-indexer.ports';

const ZERO_BLOCK_HASH = `0x${'0'.repeat(64)}`;
const DEFAULT_MAX_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;

export type EvmStablecoinBalanceIndexerErrorCode =
  | 'INVALID_INDEXER_CONFIGURATION'
  | 'UNSUPPORTED_EVM_NETWORK'
  | 'REGISTRY_BINDING_MISMATCH'
  | 'INVALID_WALLET_ADDRESS'
  | 'EMPTY_CONTRACT_SET'
  | 'UNSUPPORTED_CONTRACT'
  | 'DUPLICATE_CONTRACT'
  | 'CHAIN_IDENTITY_MISMATCH'
  | 'INVALID_SOURCE_BLOCK'
  | 'INVALID_BALANCE_RESPONSE'
  | 'PROVIDER_READ_FAILED'
  | 'PROVIDER_RETRY_EXHAUSTED'
  | 'RATE_LIMIT_DELAY_EXCEEDS_BOUND'
  | 'INVALID_RETRY_JITTER'
  | 'RETRY_DELAY_FAILED'
  | 'POSITION_STORE_FAILED';

export class EvmStablecoinBalanceIndexerError extends Error {
  constructor(readonly code: EvmStablecoinBalanceIndexerErrorCode) {
    super(code);
    this.name = 'EvmStablecoinBalanceIndexerError';
  }
}

export interface EvmStablecoinBalanceIndexerConfig {
  readonly environment: AssetRegistryEnvironment;
  readonly networkId: string;
  readonly maxBatchSize?: number;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
}

export interface IndexEvmStablecoinBalancesInput {
  readonly walletAddress: string;
  /** Omit to index every active allowlisted EVM stablecoin on this network. */
  readonly contractAddresses?: readonly string[];
}

interface ValidatedIndexerConfig {
  readonly environment: AssetRegistryEnvironment;
  readonly chain: EvmChain;
  readonly networkId: EvmNetworkId;
  readonly maxBatchSize: number;
  readonly maxAttempts: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

/**
 * Local/provider-neutral EVM stablecoin balance indexer.
 *
 * This class deliberately has no concrete RPC, timer, randomness, or database
 * adapter and is not registered in `BlockchainModule`. Real provider wiring is
 * blocked until KAN-251 and KAN-231 are independently approved.
 */
export class EvmStablecoinBalanceIndexer {
  private readonly config: ValidatedIndexerConfig;

  constructor(
    config: EvmStablecoinBalanceIndexerConfig,
    private readonly reader: EvmStablecoinBalanceReaderPort,
    private readonly positionStore: EvmStablecoinPositionStorePort,
    private readonly retryScheduler: EvmBalanceRetrySchedulerPort,
  ) {
    this.config = validateConfig(config);
  }

  async indexWallet(input: IndexEvmStablecoinBalancesInput): Promise<EvmStablecoinBalanceSnapshot> {
    const walletAddress = parseWalletAddress(input.walletAddress);
    const assets = this.selectAssets(input.contractAddresses);

    const observedIdentity = await this.readWithRetry(() =>
      this.reader.readChainIdentity(Object.freeze({ expectedNetworkId: this.config.networkId })),
    );
    if (!isExpectedChainIdentity(this.config.networkId, observedIdentity)) {
      throw indexerError('CHAIN_IDENTITY_MISMATCH');
    }

    const sourceBlock = parseSourceBlock(
      await this.readWithRetry(() =>
        this.reader.readSourceBlock(
          Object.freeze({ expectedNetworkId: this.config.networkId, selector: 'latest' }),
        ),
      ),
    );

    const balancesByContract = new Map<EvmAddress, string>();
    for (const assetBatch of chunks(assets, this.config.maxBatchSize)) {
      const contractAddresses = Object.freeze(
        assetBatch.map(({ identity }) => normalizeEvmAddress(identity)),
      );
      const request: EvmTokenBalanceBatchReadRequest = Object.freeze({
        expectedNetworkId: this.config.networkId,
        walletAddress,
        contractAddresses,
        sourceBlock,
      });
      const response = await this.readWithRetry(() => this.reader.readTokenBalances(request));
      const batchBalances = parseBalanceResponse(response, request);
      for (const [contractAddress, balanceAtomic] of batchBalances) {
        if (balancesByContract.has(contractAddress)) {
          throw indexerError('INVALID_BALANCE_RESPONSE');
        }
        balancesByContract.set(contractAddress, balanceAtomic);
      }
    }

    const positions = Object.freeze(
      assets.map((asset) =>
        this.createPosition(
          walletAddress,
          asset,
          requiredBalance(balancesByContract, normalizeEvmAddress(asset.identity)),
          sourceBlock,
        ),
      ),
    );
    const snapshot = this.createSnapshot(walletAddress, sourceBlock, positions);

    let disposition: EvmBalanceSnapshotWriteDisposition;
    try {
      disposition = await this.positionStore.upsertWalletSnapshot(snapshot);
    } catch {
      throw indexerError('POSITION_STORE_FAILED');
    }
    if (!['CREATED', 'UNCHANGED', 'REPLACED'].includes(disposition)) {
      throw indexerError('POSITION_STORE_FAILED');
    }
    return snapshot;
  }

  private selectAssets(
    contractAddresses: readonly string[] | undefined,
  ): SupportedStablecoinAsset[] {
    const registry = supportedAssetRegistryForEnvironment(this.config.environment);
    const allNetworkAssets = registry.latest.assets
      .filter(
        (asset) =>
          asset.networkId === this.config.networkId &&
          asset.identityKind === 'EVM_CONTRACT' &&
          asset.activationState === 'ACTIVE',
      )
      .sort((left, right) => left.identity.localeCompare(right.identity));

    if (contractAddresses === undefined) {
      if (allNetworkAssets.length === 0) throw indexerError('EMPTY_CONTRACT_SET');
      return allNetworkAssets;
    }
    if (contractAddresses.length === 0) throw indexerError('EMPTY_CONTRACT_SET');

    const seen = new Set<EvmAddress>();
    const selected: SupportedStablecoinAsset[] = [];
    for (const contractAddressInput of contractAddresses) {
      let contractAddress: EvmAddress;
      try {
        contractAddress = normalizeEvmAddress(contractAddressInput);
      } catch {
        throw indexerError('UNSUPPORTED_CONTRACT');
      }
      if (seen.has(contractAddress)) throw indexerError('DUPLICATE_CONTRACT');
      seen.add(contractAddress);

      const asset = registry.normalizeAsset(this.config.networkId, contractAddress);
      if (!asset || asset.identityKind !== 'EVM_CONTRACT') {
        throw indexerError('UNSUPPORTED_CONTRACT');
      }
      selected.push(asset);
    }
    return selected.sort((left, right) => left.identity.localeCompare(right.identity));
  }

  private createPosition(
    walletAddress: EvmAddress,
    asset: SupportedStablecoinAsset,
    balanceAtomic: string,
    sourceBlock: EvmSourceBlock,
  ): EvmStablecoinPosition {
    const contractAddress = normalizeEvmAddress(asset.identity);
    const identity = Object.freeze({
      environment: this.config.environment,
      networkId: this.config.networkId,
      walletAddress,
      contractAddress,
      registryVersion: this.config.registryVersion,
      registryFingerprintSha256: this.config.registryFingerprintSha256,
    });
    const positionId = createEvmStablecoinPositionId(identity);
    return Object.freeze({
      positionId,
      observationId: createEvmBalanceObservationId(positionId, sourceBlock),
      environment: this.config.environment,
      chain: this.config.chain,
      networkId: this.config.networkId,
      walletAddress,
      stablecoin: asset.stablecoin,
      contractAddress,
      decimals: asset.decimals,
      balanceAtomic: normalizeEvmAtomicBalance(balanceAtomic),
      sourceBlock,
      registryVersion: this.config.registryVersion,
      registryFingerprintSha256: this.config.registryFingerprintSha256,
      observationTier: 'PROVISIONAL',
      authority: 'DISPLAY_ONLY',
    });
  }

  private createSnapshot(
    walletAddress: EvmAddress,
    sourceBlock: EvmSourceBlock,
    positions: readonly EvmStablecoinPosition[],
  ): EvmStablecoinBalanceSnapshot {
    return Object.freeze({
      snapshotId: createEvmBalanceSnapshotId(
        this.config.environment,
        this.config.networkId,
        walletAddress,
        sourceBlock,
        this.config.registryVersion,
        this.config.registryFingerprintSha256,
      ),
      environment: this.config.environment,
      networkId: this.config.networkId,
      walletAddress,
      sourceBlock,
      registryVersion: this.config.registryVersion,
      registryFingerprintSha256: this.config.registryFingerprintSha256,
      positions,
    });
  }

  private async readWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof EvmBalanceReadFailure) || error.code === 'PERMANENT_FAILURE') {
          throw indexerError('PROVIDER_READ_FAILED');
        }
        if (attempt === this.config.maxAttempts) {
          throw indexerError('PROVIDER_RETRY_EXHAUSTED');
        }

        const maximumJitterMs = Math.min(
          this.config.retryBaseDelayMs * 2 ** (attempt - 1),
          this.config.retryMaxDelayMs,
        );
        let jitterMs: number;
        try {
          jitterMs = this.retryScheduler.nextJitterMs(maximumJitterMs);
        } catch {
          throw indexerError('INVALID_RETRY_JITTER');
        }
        if (!Number.isSafeInteger(jitterMs) || jitterMs < 0 || jitterMs > maximumJitterMs) {
          throw indexerError('INVALID_RETRY_JITTER');
        }
        if (error.retryAfterMs !== undefined && error.retryAfterMs > this.config.retryMaxDelayMs) {
          throw indexerError('RATE_LIMIT_DELAY_EXCEEDS_BOUND');
        }
        const delayMs = Math.max(jitterMs, error.retryAfterMs ?? 0);
        try {
          await this.retryScheduler.wait(delayMs);
        } catch {
          throw indexerError('RETRY_DELAY_FAILED');
        }
      }
    }
    throw indexerError('PROVIDER_RETRY_EXHAUSTED');
  }
}

function validateConfig(input: EvmStablecoinBalanceIndexerConfig): ValidatedIndexerConfig {
  let registry: ReturnType<typeof supportedAssetRegistryForEnvironment>;
  try {
    registry = supportedAssetRegistryForEnvironment(input.environment);
  } catch {
    throw indexerError('INVALID_INDEXER_CONFIGURATION');
  }
  const network = registry.latest.networks.find(({ networkId }) => networkId === input.networkId);
  const policy = chainObservationPolicyForNetwork(input.networkId);
  if (
    !network ||
    network.activationState !== 'ACTIVE' ||
    network.identityKind !== 'EVM_CONTRACT' ||
    !policy ||
    policy.environment !== input.environment ||
    policy.chain === 'SOLANA' ||
    !input.networkId.startsWith('eip155:') ||
    policy.monotonicReadConstraint !== 'PIN_BLOCK_NUMBER_AND_HASH'
  ) {
    throw indexerError('UNSUPPORTED_EVM_NETWORK');
  }
  if (
    policy.registryVersion !== registry.latest.version ||
    policy.registryFingerprintSha256 !== registry.latest.fingerprintSha256
  ) {
    throw indexerError('REGISTRY_BINDING_MISMATCH');
  }
  const provisionalRule = observationTierRule(input.networkId, 'PROVISIONAL');
  if (
    provisionalRule?.selector !== 'latest' ||
    provisionalRule.state !== 'ALLOWED' ||
    provisionalRule.authority !== 'DISPLAY_ONLY'
  ) {
    throw indexerError('REGISTRY_BINDING_MISMATCH');
  }

  const maxBatchSize = input.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  const maxAttempts = input.maxAttempts ?? CHAIN_OBSERVATION_RESILIENCE_POLICY.reads.maxAttempts;
  const retryBaseDelayMs = input.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const retryMaxDelayMs = input.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  if (
    !integerBetween(maxBatchSize, 1, MAX_BATCH_SIZE) ||
    !integerBetween(maxAttempts, 1, CHAIN_OBSERVATION_RESILIENCE_POLICY.reads.maxAttempts) ||
    !integerBetween(retryBaseDelayMs, 1, MAX_RETRY_DELAY_MS) ||
    !integerBetween(retryMaxDelayMs, retryBaseDelayMs, MAX_RETRY_DELAY_MS)
  ) {
    throw indexerError('INVALID_INDEXER_CONFIGURATION');
  }

  return Object.freeze({
    environment: input.environment,
    chain: policy.chain,
    networkId: input.networkId as EvmNetworkId,
    maxBatchSize,
    maxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
    registryVersion: registry.latest.version,
    registryFingerprintSha256: registry.latest.fingerprintSha256,
  });
}

function parseWalletAddress(value: unknown): EvmAddress {
  try {
    return normalizeEvmAddress(value);
  } catch {
    throw indexerError('INVALID_WALLET_ADDRESS');
  }
}

function parseSourceBlock(value: unknown): EvmSourceBlock {
  try {
    const record = exactRecord(value, ['number', 'hash', 'parentHash']);
    const number = normalizeEvmBlockNumber(record.number);
    const hash = normalizeEvmBlockHash(record.hash);
    const parentHash = normalizeEvmBlockHash(record.parentHash);
    if (hash === ZERO_BLOCK_HASH || hash === parentHash) {
      throw new EvmStablecoinPositionValidationError('INVALID_EVM_BLOCK_HASH');
    }
    return Object.freeze({ number, hash, parentHash, selector: 'latest' });
  } catch {
    throw indexerError('INVALID_SOURCE_BLOCK');
  }
}

function parseBalanceResponse(
  value: unknown,
  request: EvmTokenBalanceBatchReadRequest,
): ReadonlyMap<EvmAddress, string> {
  try {
    const response = exactRecord(value, ['sourceBlockNumber', 'sourceBlockHash', 'balances']);
    const sourceBlockNumber = normalizeEvmBlockNumber(response.sourceBlockNumber);
    const sourceBlockHash = normalizeEvmBlockHash(response.sourceBlockHash);
    if (
      sourceBlockNumber !== request.sourceBlock.number ||
      sourceBlockHash !== request.sourceBlock.hash ||
      !Array.isArray(response.balances) ||
      response.balances.length !== request.contractAddresses.length
    ) {
      throw new Error('invalid response');
    }

    const requested = new Set<EvmAddress>(request.contractAddresses);
    const balances = new Map<EvmAddress, string>();
    for (const valueBalance of response.balances) {
      const balance = exactRecord(valueBalance, ['contractAddress', 'balanceAtomic']);
      const contractAddress = normalizeEvmAddress(balance.contractAddress);
      const balanceAtomic = normalizeEvmAtomicBalance(balance.balanceAtomic);
      if (!requested.has(contractAddress) || balances.has(contractAddress)) {
        throw new Error('invalid response');
      }
      balances.set(contractAddress, balanceAtomic);
    }
    return balances;
  } catch {
    throw indexerError('INVALID_BALANCE_RESPONSE');
  }
}

function requiredBalance(
  balancesByContract: ReadonlyMap<EvmAddress, string>,
  contractAddress: EvmAddress,
): string {
  const balance = balancesByContract.get(contractAddress);
  if (balance === undefined) throw indexerError('INVALID_BALANCE_RESPONSE');
  return balance;
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected record');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('expected data record');
  const keys = Object.keys(value);
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((expectedKey) => !Object.prototype.hasOwnProperty.call(value, expectedKey))
  ) {
    throw new TypeError('unexpected record shape');
  }
  return value as Record<string, unknown>;
}

function chunks<Value>(values: readonly Value[], maximumSize: number): readonly Value[][] {
  const result: Value[][] = [];
  for (let index = 0; index < values.length; index += maximumSize) {
    result.push(values.slice(index, index + maximumSize));
  }
  return result;
}

function integerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

function indexerError(
  code: EvmStablecoinBalanceIndexerErrorCode,
): EvmStablecoinBalanceIndexerError {
  return new EvmStablecoinBalanceIndexerError(code);
}
