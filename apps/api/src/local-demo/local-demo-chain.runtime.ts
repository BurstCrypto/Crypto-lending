import { createHash } from 'node:crypto';

import {
  EvmStablecoinBalanceIndexer,
  type EvmStablecoinBalanceIndexerConfig,
} from '../blockchain/application/evm-stablecoin-balance-indexer';
import type {
  EvmBalanceRetrySchedulerPort,
  EvmStablecoinBalanceReaderPort,
  EvmStablecoinPositionStorePort,
  EvmTokenBalanceBatchReadRequest,
} from '../blockchain/application/ports/evm-stablecoin-balance-indexer.ports';
import type {
  SolanaDepositSourcePort,
  SolanaDepositSourceRequestContext,
  SolanaTokenAccountsByOwnerRequest,
} from '../blockchain/application/ports/solana-deposit-source.port';
import { SolanaDepositIndexerService } from '../blockchain/application/solana-deposit-indexer.service';
import {
  chainObservationPolicyForNetwork,
  type ChainObservationNetworkId,
} from '../blockchain/domain/chain-observation-policy';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoinAsset,
} from '../blockchain/domain/supported-asset-registry';
import {
  decodeSolanaPublicKey,
  normalizeSolanaPublicKey,
  SOLANA_TOKEN_PROGRAM_IDS,
  type SolanaTokenProgramId,
} from '../blockchain/domain/solana-token-account';
import {
  BalanceSyncOrchestrator,
  type BalanceSyncProcessingResult,
} from '../blockchain-sync/application/balance-sync-orchestrator';
import type {
  BalanceIndexerReadRequest,
  BalanceIndexerRescanRequest,
  BalanceSyncAlert,
  BalanceSyncCheckpoint,
  BalanceSyncCheckpointPort,
  BalanceSyncClockPort,
  BalanceSyncIndexerPort,
  BalanceSyncJobPort,
  BalanceSyncMetricEvent,
  BalanceSyncMetricsPort,
  BalanceSyncScope,
} from '../blockchain-sync/application/ports/balance-sync.ports';
import {
  BALANCE_SYNC_PAYLOAD_VERSION,
  BalanceSyncIndexerFailure,
  createDeterministicBalanceSyncJobEnvelope,
  type BalanceSyncObservation,
} from '../blockchain-sync/domain/balance-sync';

export const LOCAL_DEMO_PORTFOLIO_AS_OF = '2026-08-24T18:30:00.000Z';
const LOCAL_DEMO_RETRIEVED_AT = '2026-08-24T18:29:55.000Z';
const LOCAL_DEMO_MAINNET_SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const LOCAL_DEMO_EVM_TOTAL_CENTS = 700_000n;
const LOCAL_DEMO_SOLANA_TOTAL_CENTS = 400_000n;
const ATOMIC_UNITS_PER_CENT = 10_000n;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAINNET_EVM_NETWORKS = new Set(['eip155:1', 'eip155:8453', 'eip155:42161']);
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export interface LocalDemoChainWallet {
  readonly walletId: string;
  readonly namespace: 'EVM' | 'SOLANA';
  readonly chainId: string;
  readonly address: string;
}

interface FixtureWallet extends LocalDemoChainWallet {
  readonly accountId: string;
  readonly amountAtomic: string;
  readonly ordinal: number;
}

export class LocalDemoChainPipelineError extends Error {
  readonly code = 'LOCAL_DEMO_CHAIN_PIPELINE_UNAVAILABLE' as const;

  constructor() {
    super('Synthetic local demo balance pipeline is unavailable');
    this.name = 'LocalDemoChainPipelineError';
  }
}

/**
 * Request-local composition of the real KAN-63, KAN-64, and KAN-65 classes.
 * Every injected source is deterministic memory data; this type owns no
 * socket, timer, queue, database, provider, or process-global state.
 */
export class LocalDemoChainPipeline {
  async synchronize(
    accountId: string,
    correlationId: string,
    inputWallets: readonly LocalDemoChainWallet[],
  ): Promise<readonly BalanceSyncObservation[]> {
    try {
      if (!UUID_V4.test(accountId) || !UUID_V4.test(correlationId) || inputWallets.length === 0) {
        throw new TypeError('invalid local demo synchronization scope');
      }
      const fixtures = buildFixtureWallets(accountId, inputWallets);
      const checkpoints = new RequestLocalCheckpointPort();
      const jobs = new RequestLocalJobPort();
      const metrics = new RequestLocalMetricsPort();
      const indexer = new LocalDemoBalanceSyncIndexer(fixtures);
      const clock: BalanceSyncClockPort = {
        now: () => new Date(LOCAL_DEMO_PORTFOLIO_AS_OF),
      };
      const orchestrator = new BalanceSyncOrchestrator(jobs, checkpoints, indexer, clock, metrics);
      const observations: BalanceSyncObservation[] = [];

      for (const fixture of fixtures) {
        const networkId = fixture.chainId as ChainObservationNetworkId;
        const job = createDeterministicBalanceSyncJobEnvelope(
          Object.freeze({
            schemaVersion: BALANCE_SYNC_PAYLOAD_VERSION,
            accountId,
            walletId: fixture.walletId,
            networkId,
            requiredTier: 'PROVISIONAL',
            cause: 'SCHEDULED',
            attempt: 1,
            rescanFromPosition: null,
          }),
          Object.freeze({
            id: `local-demo-sync:${digest(accountId, fixture.walletId, fixture.chainId)}`,
            occurredAt: LOCAL_DEMO_RETRIEVED_AT,
            correlation: Object.freeze({ correlationId }),
          }),
        );
        const outcome: BalanceSyncProcessingResult = await orchestrator.process(job);
        if (outcome.status !== 'COMPLETED') throw new LocalDemoChainPipelineError();
        const checkpoint = await checkpoints.load(
          Object.freeze({ accountId, walletId: fixture.walletId, networkId }),
        );
        if (checkpoint?.freshness !== 'CURRENT' || checkpoint.currentObservation === null) {
          throw new LocalDemoChainPipelineError();
        }
        observations.push(checkpoint.currentObservation);
      }

      if (jobs.dispositionCount !== 0) throw new LocalDemoChainPipelineError();
      return Object.freeze(
        observations.sort((left, right) => left.walletId.localeCompare(right.walletId)),
      );
    } catch (error) {
      if (error instanceof LocalDemoChainPipelineError) throw error;
      throw new LocalDemoChainPipelineError();
    }
  }
}

class LocalDemoBalanceSyncIndexer implements BalanceSyncIndexerPort {
  private readonly fixtures: ReadonlyMap<string, FixtureWallet>;

  constructor(fixtures: readonly FixtureWallet[]) {
    this.fixtures = new Map(
      fixtures.map(
        (fixture) =>
          [
            scopeKey({
              accountId: fixture.accountId,
              walletId: fixture.walletId,
              networkId: fixture.chainId as ChainObservationNetworkId,
            }),
            fixture,
          ] as const,
      ),
    );
  }

  async readCurrent(request: BalanceIndexerReadRequest): Promise<unknown> {
    try {
      const fixture = this.fixtures.get(scopeKey(request));
      if (
        fixture === undefined ||
        request.tier !== 'PROVISIONAL' ||
        request.selector !== (fixture.namespace === 'EVM' ? 'latest' : 'processed')
      ) {
        throw new TypeError('unknown local demo indexing scope');
      }
      return fixture.namespace === 'EVM'
        ? await this.readEvm(fixture)
        : await this.readSolana(fixture);
    } catch (error) {
      if (error instanceof BalanceSyncIndexerFailure) throw error;
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }

  async rescanFromCheckpoint(request: BalanceIndexerRescanRequest): Promise<unknown> {
    void request;
    throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
  }

  private async readEvm(fixture: FixtureWallet): Promise<unknown> {
    const reader = new LocalDemoEvmBalanceReader(fixture);
    const config: EvmStablecoinBalanceIndexerConfig = Object.freeze({
      environment: 'MAINNET',
      networkId: fixture.chainId,
      maxAttempts: 1,
    });
    const indexer = new EvmStablecoinBalanceIndexer(
      config,
      reader,
      new RequestLocalEvmPositionStore(),
      NO_WAIT_RETRY_SCHEDULER,
    );
    const snapshot = await indexer.indexWallet({ walletAddress: fixture.address });
    return Object.freeze({
      walletId: fixture.walletId,
      networkId: fixture.chainId,
      tier: 'PROVISIONAL',
      source: Object.freeze({
        position: snapshot.sourceBlock.number,
        hash: snapshot.sourceBlock.hash,
        parentHash: snapshot.sourceBlock.parentHash,
        selector: 'latest',
        retrievedAt: LOCAL_DEMO_RETRIEVED_AT,
        identityValidated: true,
      }),
      positions: Object.freeze(
        snapshot.positions
          .filter((position) => position.balanceAtomic !== '0')
          .map((position) =>
            Object.freeze({
              positionId: position.positionId,
              stablecoin: position.stablecoin,
              assetIdentity: position.contractAddress,
              amountAtomic: position.balanceAtomic,
            }),
          ),
      ),
    });
  }

  private async readSolana(fixture: FixtureWallet): Promise<unknown> {
    const source = new LocalDemoSolanaDepositSource(fixture);
    const indexed = await new SolanaDepositIndexerService(source).index({
      environment: 'MAINNET',
      networkId: fixture.chainId,
      ownerAddress: fixture.address,
      tier: 'PROVISIONAL',
    });
    const position = indexed.sourceSlot.toString();
    return Object.freeze({
      walletId: fixture.walletId,
      networkId: fixture.chainId,
      tier: 'PROVISIONAL',
      source: Object.freeze({
        position,
        hash: solanaHash('head', fixture.chainId, position),
        parentHash: solanaHash('parent', fixture.chainId, position),
        selector: 'processed',
        retrievedAt: LOCAL_DEMO_RETRIEVED_AT,
        identityValidated: true,
      }),
      positions: Object.freeze(
        indexed.balances
          .filter((balance) => balance.amountBaseUnits !== 0n)
          .map((balance) =>
            Object.freeze({
              positionId: digest(
                'local-demo-solana-position-v1',
                fixture.walletId,
                fixture.chainId,
                balance.mintAddress,
              ),
              stablecoin: balance.stablecoin,
              assetIdentity: balance.mintAddress,
              amountAtomic: balance.amountBaseUnits.toString(),
            }),
          ),
      ),
    });
  }
}

class LocalDemoEvmBalanceReader implements EvmStablecoinBalanceReaderPort {
  private readonly sourceBlock: Readonly<{
    number: string;
    hash: `0x${string}`;
    parentHash: `0x${string}`;
  }>;

  constructor(private readonly fixture: FixtureWallet) {
    const blockNumber = (20_765_432n + BigInt(fixture.ordinal)).toString();
    this.sourceBlock = Object.freeze({
      number: blockNumber,
      hash: `0x${digest('local-demo-evm-head-v1', fixture.chainId, blockNumber)}`,
      parentHash: `0x${digest('local-demo-evm-parent-v1', fixture.chainId, blockNumber)}`,
    });
  }

  async readChainIdentity(
    request: Parameters<EvmStablecoinBalanceReaderPort['readChainIdentity']>[0],
  ): Promise<unknown> {
    if (request.expectedNetworkId !== this.fixture.chainId) {
      throw new TypeError('unexpected local demo EVM network');
    }
    const expected = chainObservationPolicyForNetwork(this.fixture.chainId)?.identityProbe
      .expectedResult;
    if (expected === undefined) throw new TypeError('missing EVM chain identity');
    return expected;
  }

  async readSourceBlock(
    request: Parameters<EvmStablecoinBalanceReaderPort['readSourceBlock']>[0],
  ): Promise<unknown> {
    if (request.expectedNetworkId !== this.fixture.chainId || request.selector !== 'latest') {
      throw new TypeError('unexpected local demo EVM block request');
    }
    return this.sourceBlock;
  }

  async readTokenBalances(request: EvmTokenBalanceBatchReadRequest): Promise<unknown> {
    if (
      request.expectedNetworkId !== this.fixture.chainId ||
      request.walletAddress !== this.fixture.address ||
      request.sourceBlock.number !== this.sourceBlock.number ||
      request.sourceBlock.hash !== this.sourceBlock.hash
    ) {
      throw new TypeError('unexpected local demo EVM balance request');
    }
    return Object.freeze({
      sourceBlockNumber: this.sourceBlock.number,
      sourceBlockHash: this.sourceBlock.hash,
      balances: Object.freeze(
        request.contractAddresses.map((contractAddress) => {
          const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(
            this.fixture.chainId,
            contractAddress,
          );
          if (asset?.identityKind !== 'EVM_CONTRACT') {
            throw new TypeError('unsupported local demo EVM contract');
          }
          return Object.freeze({
            contractAddress,
            balanceAtomic: asset.stablecoin === 'USDC' ? this.fixture.amountAtomic : '0',
          });
        }),
      ),
    });
  }
}

class RequestLocalEvmPositionStore implements EvmStablecoinPositionStorePort {
  private readonly snapshotIds = new Set<string>();

  async upsertWalletSnapshot(
    snapshot: Parameters<EvmStablecoinPositionStorePort['upsertWalletSnapshot']>[0],
  ): Promise<'CREATED' | 'UNCHANGED'> {
    if (this.snapshotIds.has(snapshot.snapshotId)) return 'UNCHANGED';
    this.snapshotIds.add(snapshot.snapshotId);
    return 'CREATED';
  }
}

const NO_WAIT_RETRY_SCHEDULER: EvmBalanceRetrySchedulerPort = Object.freeze({
  nextJitterMs: () => 0,
  wait: async () => {
    throw new TypeError('local demo fixture reads must not retry or wait');
  },
});

class LocalDemoSolanaDepositSource implements SolanaDepositSourcePort {
  private readonly sourceSlot: bigint;
  private readonly tokenAccount: Readonly<{
    address: string;
    programId: SolanaTokenProgramId;
    data: Uint8Array;
  }>;

  constructor(private readonly fixture: FixtureWallet) {
    this.sourceSlot = 900n + BigInt(fixture.ordinal);
    const usdc = requireMainnetUsdc(fixture.chainId);
    const data = new Uint8Array(165);
    data.set(decodeSolanaPublicKey(usdc.identity), 0);
    data.set(decodeSolanaPublicKey(normalizeSolanaPublicKey(fixture.address)), 32);
    new DataView(data.buffer).setBigUint64(64, BigInt(fixture.amountAtomic), true);
    data[108] = 1;
    this.tokenAccount = Object.freeze({
      address: encodeBase58(
        hashBytes('local-demo-solana-token-account-v1', fixture.walletId, fixture.chainId),
      ),
      programId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      data,
    });
  }

  async getGenesisHash(context: SolanaDepositSourceRequestContext): Promise<unknown> {
    void context;
    const expected = chainObservationPolicyForNetwork(this.fixture.chainId)?.identityProbe
      .expectedResult;
    if (expected === undefined) throw new TypeError('missing Solana chain identity');
    return expected;
  }

  async getTokenAccountsByOwner(request: SolanaTokenAccountsByOwnerRequest): Promise<unknown> {
    if (
      request.ownerAddress !== this.fixture.address ||
      request.commitment !== 'processed' ||
      (request.minContextSlot !== undefined && request.minContextSlot > this.sourceSlot)
    ) {
      throw new TypeError('unexpected local demo Solana balance request');
    }
    const accounts =
      request.tokenProgramId === SOLANA_TOKEN_PROGRAM_IDS.LEGACY
        ? [this.tokenAccount]
        : request.tokenProgramId === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022
          ? []
          : (() => {
              throw new TypeError('unexpected Solana token program');
            })();
    return Object.freeze({ contextSlot: this.sourceSlot, accounts: Object.freeze(accounts) });
  }
}

class RequestLocalCheckpointPort implements BalanceSyncCheckpointPort {
  private readonly states = new Map<string, BalanceSyncCheckpoint>();

  async load(scope: BalanceSyncScope): Promise<BalanceSyncCheckpoint | null> {
    return this.states.get(scopeKey(scope)) ?? null;
  }

  async upsertCurrent(
    input: Parameters<BalanceSyncCheckpointPort['upsertCurrent']>[0],
  ): Promise<void> {
    const existing = this.states.get(scopeKey(input.scope));
    assertRevision(existing, input.expectedRevision);
    if (
      input.mode === 'UNCHANGED' &&
      existing?.currentObservation?.observationId !== input.observation.observationId
    ) {
      throw new TypeError('unchanged local demo observation mismatch');
    }
    this.states.set(
      scopeKey(input.scope),
      Object.freeze({
        revision: (existing?.revision ?? -1) + 1,
        scope: input.scope,
        currentObservation: input.observation,
        lastFinalizedSource: existing?.lastFinalizedSource ?? null,
        freshness: 'CURRENT',
        staleSince: null,
        lastFailureCode: null,
      }),
    );
  }

  async replaceProvisionalAfterReorg(
    input: Parameters<BalanceSyncCheckpointPort['replaceProvisionalAfterReorg']>[0],
  ): Promise<void> {
    const existing = this.states.get(scopeKey(input.scope));
    assertRevision(existing, input.expectedRevision);
    if (existing === undefined) throw new TypeError('missing local demo checkpoint');
    this.states.set(
      scopeKey(input.scope),
      Object.freeze({
        revision: existing.revision + 1,
        scope: input.scope,
        currentObservation: input.replacement,
        lastFinalizedSource: input.lastFinalizedSource,
        freshness: 'CURRENT',
        staleSince: null,
        lastFailureCode: null,
      }),
    );
  }

  async preserveLastGoodAndMarkStale(
    input: Parameters<BalanceSyncCheckpointPort['preserveLastGoodAndMarkStale']>[0],
  ): Promise<void> {
    const existing = this.states.get(scopeKey(input.scope));
    assertRevision(existing, input.expectedRevision);
    this.states.set(
      scopeKey(input.scope),
      Object.freeze({
        revision: (existing?.revision ?? -1) + 1,
        scope: input.scope,
        currentObservation: existing?.currentObservation ?? null,
        lastFinalizedSource: existing?.lastFinalizedSource ?? null,
        freshness: existing?.currentObservation ? 'STALE' : 'UNAVAILABLE',
        staleSince: input.failedAt,
        lastFailureCode: input.failureCode,
      }),
    );
  }
}

class RequestLocalJobPort implements BalanceSyncJobPort {
  dispositionCount = 0;

  async scheduleRetry(input: Parameters<BalanceSyncJobPort['scheduleRetry']>[0]): Promise<void> {
    void input;
    this.dispositionCount += 1;
  }

  async deadLetter(input: Parameters<BalanceSyncJobPort['deadLetter']>[0]): Promise<void> {
    void input;
    this.dispositionCount += 1;
  }
}

class RequestLocalMetricsPort implements BalanceSyncMetricsPort {
  record(event: BalanceSyncMetricEvent): void {
    void event;
  }

  alert(alert: BalanceSyncAlert): void {
    void alert;
  }
}

function buildFixtureWallets(
  accountId: string,
  inputWallets: readonly LocalDemoChainWallet[],
): readonly FixtureWallet[] {
  if (inputWallets.length > 32) throw new TypeError('too many local demo wallets');
  const wallets = [...inputWallets].sort((left, right) =>
    left.walletId.localeCompare(right.walletId),
  );
  const walletIds = new Set<string>();
  const identities = new Set<string>();
  for (const wallet of wallets) {
    assertWallet(wallet);
    if (walletIds.has(wallet.walletId)) throw new TypeError('duplicate local demo wallet');
    walletIds.add(wallet.walletId);
    const identity = `${wallet.namespace}\0${wallet.address}`;
    if (identities.has(identity)) throw new TypeError('duplicate local demo wallet identity');
    identities.add(identity);
  }

  const allocations = new Map<string, bigint>();
  for (const namespace of ['EVM', 'SOLANA'] as const) {
    const matching = wallets.filter((wallet) => wallet.namespace === namespace);
    if (matching.length === 0) continue;
    const total = namespace === 'EVM' ? LOCAL_DEMO_EVM_TOTAL_CENTS : LOCAL_DEMO_SOLANA_TOTAL_CENTS;
    const count = BigInt(matching.length);
    const quotient = total / count;
    let remainder = total % count;
    for (const wallet of matching) {
      const cents = quotient + (remainder > 0n ? 1n : 0n);
      if (remainder > 0n) remainder -= 1n;
      allocations.set(wallet.walletId, cents * ATOMIC_UNITS_PER_CENT);
    }
  }

  return Object.freeze(
    wallets.map((wallet, ordinal) =>
      Object.freeze({
        ...wallet,
        accountId,
        amountAtomic: requiredAllocation(allocations, wallet.walletId).toString(),
        ordinal,
      }),
    ),
  );
}

function assertWallet(wallet: LocalDemoChainWallet): void {
  if (!UUID_V4.test(wallet.walletId)) throw new TypeError('invalid local demo wallet id');
  if (wallet.namespace === 'EVM') {
    if (!MAINNET_EVM_NETWORKS.has(wallet.chainId) || !/^0x[0-9a-f]{40}$/u.test(wallet.address)) {
      throw new TypeError('invalid local demo EVM wallet');
    }
    return;
  }
  if (
    wallet.namespace !== 'SOLANA' ||
    wallet.chainId !== LOCAL_DEMO_MAINNET_SOLANA ||
    normalizeSolanaPublicKey(wallet.address) !== wallet.address
  ) {
    throw new TypeError('invalid local demo Solana wallet');
  }
}

function requireMainnetUsdc(networkId: string): SupportedStablecoinAsset {
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets.find(
    (candidate) =>
      candidate.networkId === networkId &&
      candidate.stablecoin === 'USDC' &&
      candidate.activationState === 'ACTIVE',
  );
  if (asset === undefined) throw new TypeError('missing local demo USDC identity');
  return asset;
}

function requiredAllocation(allocations: ReadonlyMap<string, bigint>, walletId: string): bigint {
  const allocation = allocations.get(walletId);
  if (allocation === undefined) throw new TypeError('missing local demo allocation');
  return allocation;
}

function assertRevision(
  existing: BalanceSyncCheckpoint | undefined,
  expectedRevision: number | null,
): void {
  if ((existing?.revision ?? null) !== expectedRevision) {
    throw new TypeError('local demo checkpoint revision conflict');
  }
}

function scopeKey(scope: Pick<BalanceSyncScope, 'accountId' | 'walletId' | 'networkId'>): string {
  return `${scope.accountId}\0${scope.walletId}\0${scope.networkId}`;
}

function digest(...parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
}

function hashBytes(...parts: readonly string[]): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(JSON.stringify(parts), 'utf8').digest());
}

function solanaHash(...parts: readonly string[]): string {
  return encodeBase58(hashBytes(...parts));
}

function encodeBase58(bytes: Uint8Array): string {
  let numeric = 0n;
  for (const byte of bytes) numeric = numeric * 256n + BigInt(byte);
  let encoded = '';
  while (numeric > 0n) {
    encoded = `${BASE58_ALPHABET[Number(numeric % 58n)]}${encoded}`;
    numeric /= 58n;
  }
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return `${'1'.repeat(leadingZeroes)}${encoded}`;
}
