import { EVM_STABLECOIN_BALANCE_FIXTURE } from '../../../test/fixtures/evm-stablecoin-balances.fixture';
import type {
  EvmStablecoinBalanceSnapshot,
  EvmStablecoinPosition,
} from '../domain/evm-stablecoin-position';
import {
  EvmStablecoinBalanceIndexer,
  EvmStablecoinBalanceIndexerError,
  type EvmStablecoinBalanceIndexerConfig,
} from './evm-stablecoin-balance-indexer';
import {
  EvmBalanceReadFailure,
  type EvmBalanceRetrySchedulerPort,
  type EvmBalanceSnapshotWriteDisposition,
  type EvmStablecoinBalanceReaderPort,
  type EvmStablecoinPositionStorePort,
  type EvmTokenBalanceBatchReadRequest,
} from './ports/evm-stablecoin-balance-indexer.ports';

const fixture = EVM_STABLECOIN_BALANCE_FIXTURE;
type RecordedBalance = (typeof fixture.recordedBalances)[number];

function recordedBalance(stablecoin: 'PYUSD' | 'USDC' | 'USDT'): RecordedBalance {
  const recorded = fixture.recordedBalances.find(
    (candidate) => candidate.stablecoin === stablecoin,
  );
  if (!recorded) throw new Error(`missing ${stablecoin} fixture`);
  return recorded;
}

interface FixtureBalanceResponse {
  readonly sourceBlockNumber: string;
  readonly sourceBlockHash: string;
  readonly balances: readonly Readonly<{
    contractAddress: string;
    balanceAtomic: string;
  }>[];
}

function fixtureBalanceResponse(request: EvmTokenBalanceBatchReadRequest): FixtureBalanceResponse {
  return {
    sourceBlockNumber: request.sourceBlock.number,
    sourceBlockHash: request.sourceBlock.hash,
    balances: request.contractAddresses.map((contractAddress) => {
      const recorded = fixture.recordedBalances.find(
        (candidate) => candidate.contractAddress === contractAddress,
      );
      if (!recorded) throw new Error('fixture contract missing');
      return {
        contractAddress,
        balanceAtomic: recorded.balanceAtomic,
      };
    }),
  };
}

function requiredContract(request: EvmTokenBalanceBatchReadRequest, index: number): string {
  const contractAddress = request.contractAddresses[index];
  if (!contractAddress) throw new Error('fixture request contract missing');
  return contractAddress;
}

interface Harness {
  readonly indexer: EvmStablecoinBalanceIndexer;
  readonly reader: jest.Mocked<EvmStablecoinBalanceReaderPort>;
  readonly store: jest.Mocked<EvmStablecoinPositionStorePort>;
  readonly scheduler: jest.Mocked<EvmBalanceRetrySchedulerPort>;
  readonly persistedPositions: Map<string, EvmStablecoinPosition>;
  readonly writeDispositions: EvmBalanceSnapshotWriteDisposition[];
}

function createHarness(config: Partial<EvmStablecoinBalanceIndexerConfig> = {}): Harness {
  const reader: jest.Mocked<EvmStablecoinBalanceReaderPort> = {
    readChainIdentity: jest.fn().mockResolvedValue(fixture.chainIdentity),
    readSourceBlock: jest.fn().mockResolvedValue(fixture.sourceBlock),
    readTokenBalances: jest.fn(async (request) => fixtureBalanceResponse(request)),
  };
  const persistedPositions = new Map<string, EvmStablecoinPosition>();
  const snapshotByScope = new Map<string, EvmStablecoinBalanceSnapshot>();
  const writeDispositions: EvmBalanceSnapshotWriteDisposition[] = [];
  const store: jest.Mocked<EvmStablecoinPositionStorePort> = {
    upsertWalletSnapshot: jest.fn(async (snapshot) => {
      const scope = `${snapshot.networkId}/${snapshot.walletAddress}`;
      const existing = snapshotByScope.get(scope);
      const disposition =
        existing?.snapshotId === snapshot.snapshotId
          ? 'UNCHANGED'
          : existing
            ? 'REPLACED'
            : 'CREATED';
      snapshotByScope.set(scope, snapshot);
      persistedPositions.clear();
      for (const position of snapshot.positions) {
        persistedPositions.set(position.positionId, position);
      }
      writeDispositions.push(disposition);
      return disposition;
    }),
  };
  const scheduler: jest.Mocked<EvmBalanceRetrySchedulerPort> = {
    nextJitterMs: jest.fn((maximumInclusiveMs) => maximumInclusiveMs),
    wait: jest.fn().mockResolvedValue(undefined),
  };
  const indexer = new EvmStablecoinBalanceIndexer(
    {
      environment: 'MAINNET',
      networkId: 'eip155:1',
      maxBatchSize: 2,
      ...config,
    },
    reader,
    store,
    scheduler,
  );
  return {
    indexer,
    reader,
    store,
    scheduler,
    persistedPositions,
    writeDispositions,
  };
}

describe('EvmStablecoinBalanceIndexer', () => {
  it('indexes every allowlisted fixture balance in exact units at one recorded block', async () => {
    const harness = createHarness();

    const snapshot = await harness.indexer.indexWallet({
      walletAddress: fixture.walletAddress.toUpperCase().replace('0X', '0x'),
    });

    expect(snapshot).toMatchObject({
      environment: fixture.environment,
      networkId: fixture.networkId,
      walletAddress: fixture.walletAddress,
      sourceBlock: { ...fixture.sourceBlock, selector: 'latest' },
      registryVersion: 1,
    });
    expect(snapshot.registryFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshot.positions).toEqual(
      fixture.recordedBalances.map((recorded) =>
        expect.objectContaining({
          stablecoin: recorded.stablecoin,
          contractAddress: recorded.contractAddress,
          balanceAtomic: recorded.balanceAtomic,
          sourceBlock: snapshot.sourceBlock,
          observationTier: 'PROVISIONAL',
          authority: 'DISPLAY_ONLY',
          decimals: 6,
        }),
      ),
    );
    expect(snapshot.positions.find(({ stablecoin }) => stablecoin === 'USDT')?.balanceAtomic).toBe(
      '0',
    );
    expect(new Set(snapshot.positions.map(({ positionId }) => positionId)).size).toBe(3);
    expect(new Set(snapshot.positions.map(({ observationId }) => observationId)).size).toBe(3);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.positions)).toBe(true);
    expect(snapshot.positions.every((position) => Object.isFrozen(position))).toBe(true);

    expect(harness.reader.readChainIdentity).toHaveBeenCalledWith({
      expectedNetworkId: fixture.networkId,
    });
    expect(harness.reader.readSourceBlock).toHaveBeenCalledWith({
      expectedNetworkId: fixture.networkId,
      selector: 'latest',
    });
    expect(
      harness.reader.readTokenBalances.mock.calls.map(([request]) => ({
        contracts: request.contractAddresses,
        sourceBlock: request.sourceBlock,
      })),
    ).toEqual([
      {
        contracts: fixture.recordedBalances
          .slice(0, 2)
          .map(({ contractAddress }) => contractAddress),
        sourceBlock: snapshot.sourceBlock,
      },
      {
        contracts: fixture.recordedBalances.slice(2).map(({ contractAddress }) => contractAddress),
        sourceBlock: snapshot.sourceBlock,
      },
    ]);
    expect(harness.store.upsertWalletSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.persistedPositions.size).toBe(3);
    expect(harness.writeDispositions).toEqual(['CREATED']);
  });

  it('indexes an explicit allowlisted subset after canonical address normalization', async () => {
    const harness = createHarness();
    const usdc = recordedBalance('USDC');

    const snapshot = await harness.indexer.indexWallet({
      walletAddress: fixture.walletAddress,
      contractAddresses: [usdc.contractAddress.toUpperCase().replace('0X', '0x')],
    });

    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]).toMatchObject(usdc);
    expect(harness.reader.readTokenBalances).toHaveBeenCalledTimes(1);
  });

  it.each([
    { contractAddresses: [] as string[], error: 'EMPTY_CONTRACT_SET' },
    {
      contractAddresses: ['0x2222222222222222222222222222222222222222'],
      error: 'UNSUPPORTED_CONTRACT',
    },
    {
      contractAddresses: [
        recordedBalance('PYUSD').contractAddress,
        recordedBalance('PYUSD').contractAddress.toUpperCase().replace('0X', '0x'),
      ],
      error: 'DUPLICATE_CONTRACT',
    },
  ])(
    'rejects a non-allowlisted contract selection with $error',
    async ({ contractAddresses, error }) => {
      const harness = createHarness();

      await expect(
        harness.indexer.indexWallet({ walletAddress: fixture.walletAddress, contractAddresses }),
      ).rejects.toEqual(new EvmStablecoinBalanceIndexerError(error as never));
      expect(harness.reader.readChainIdentity).not.toHaveBeenCalled();
      expect(harness.store.upsertWalletSnapshot).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid wallet before any read or write', async () => {
    const harness = createHarness();

    await expect(harness.indexer.indexWallet({ walletAddress: '0x1234' })).rejects.toEqual(
      new EvmStablecoinBalanceIndexerError('INVALID_WALLET_ADDRESS'),
    );
    expect(harness.reader.readChainIdentity).not.toHaveBeenCalled();
    expect(harness.store.upsertWalletSnapshot).not.toHaveBeenCalled();
  });

  it('replays the same recorded block as one unchanged snapshot without duplicate positions', async () => {
    const harness = createHarness();

    const first = await harness.indexer.indexWallet({ walletAddress: fixture.walletAddress });
    const replay = await harness.indexer.indexWallet({ walletAddress: fixture.walletAddress });

    expect(replay).toEqual(first);
    expect(harness.writeDispositions).toEqual(['CREATED', 'UNCHANGED']);
    expect(harness.persistedPositions.size).toBe(3);
    expect(harness.store.upsertWalletSnapshot).toHaveBeenCalledTimes(2);
  });

  it('retries a rate-limited batch, respects Retry-After, and writes the completed snapshot once', async () => {
    const harness = createHarness();
    harness.reader.readTokenBalances.mockRejectedValueOnce(
      new EvmBalanceReadFailure('RATE_LIMITED', { retryAfterMs: 400 }),
    );

    const snapshot = await harness.indexer.indexWallet({ walletAddress: fixture.walletAddress });

    expect(snapshot.positions).toHaveLength(3);
    expect(harness.scheduler.nextJitterMs).toHaveBeenCalledWith(250);
    expect(harness.scheduler.wait).toHaveBeenCalledWith(400);
    expect(harness.reader.readTokenBalances).toHaveBeenCalledTimes(3);
    expect(harness.store.upsertWalletSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.persistedPositions.size).toBe(3);
  });

  it.each([
    ['MAINNET', 'eip155:1'],
    ['MAINNET', 'eip155:8453'],
    ['MAINNET', 'eip155:42161'],
    ['TESTNET', 'eip155:11155111'],
    ['TESTNET', 'eip155:84532'],
    ['TESTNET', 'eip155:421614'],
  ] as const)('accepts the reviewed %s EVM registry binding for %s', (environment, networkId) => {
    expect(() => createHarness({ environment, networkId })).not.toThrow();
  });

  it.each([
    { environment: 'MAINNET' as const, networkId: 'eip155:11155111' },
    { environment: 'TESTNET' as const, networkId: 'eip155:1' },
    {
      environment: 'MAINNET' as const,
      networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    },
    { environment: 'MAINNET' as const, networkId: 'eip155:999999' },
  ])('rejects an unsupported or cross-environment network %#', (config) => {
    expect(() => createHarness(config)).toThrow(
      new EvmStablecoinBalanceIndexerError('UNSUPPORTED_EVM_NETWORK'),
    );
  });

  it.each([
    { maxBatchSize: 0 },
    { maxBatchSize: 101 },
    { maxBatchSize: 1.5 },
    { maxAttempts: 0 },
    { maxAttempts: 4 },
    { retryBaseDelayMs: 0 },
    { retryBaseDelayMs: 5_001, retryMaxDelayMs: 5_000 },
    { retryMaxDelayMs: 60_001 },
  ])('rejects invalid bounded-work configuration %#', (config) => {
    expect(() => createHarness(config)).toThrow(
      new EvmStablecoinBalanceIndexerError('INVALID_INDEXER_CONFIGURATION'),
    );
  });

  it('fails closed when the connector reports a different chain identity', async () => {
    const harness = createHarness();
    harness.reader.readChainIdentity.mockResolvedValue('0xaa36a7');

    await expect(
      harness.indexer.indexWallet({ walletAddress: fixture.walletAddress }),
    ).rejects.toEqual(new EvmStablecoinBalanceIndexerError('CHAIN_IDENTITY_MISMATCH'));
    expect(harness.reader.readSourceBlock).not.toHaveBeenCalled();
    expect(harness.reader.readTokenBalances).not.toHaveBeenCalled();
    expect(harness.store.upsertWalletSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    { number: '01', hash: fixture.sourceBlock.hash, parentHash: fixture.sourceBlock.parentHash },
    {
      number: fixture.sourceBlock.number,
      hash: `0x${'0'.repeat(64)}`,
      parentHash: fixture.sourceBlock.parentHash,
    },
    {
      number: fixture.sourceBlock.number,
      hash: fixture.sourceBlock.hash,
      parentHash: fixture.sourceBlock.hash,
    },
    { number: fixture.sourceBlock.number, hash: fixture.sourceBlock.hash },
    { ...fixture.sourceBlock, unexpected: true },
  ])('rejects invalid or ambiguous source-block lineage %#', async (sourceBlock) => {
    const harness = createHarness();
    harness.reader.readSourceBlock.mockResolvedValue(sourceBlock);

    await expect(
      harness.indexer.indexWallet({ walletAddress: fixture.walletAddress }),
    ).rejects.toEqual(new EvmStablecoinBalanceIndexerError('INVALID_SOURCE_BLOCK'));
    expect(harness.reader.readTokenBalances).not.toHaveBeenCalled();
    expect(harness.store.upsertWalletSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wrong source height',
      (request: EvmTokenBalanceBatchReadRequest): unknown => ({
        ...fixtureBalanceResponse(request),
        sourceBlockNumber: '20765431',
      }),
    ],
    [
      'wrong source hash',
      (request: EvmTokenBalanceBatchReadRequest): unknown => ({
        ...fixtureBalanceResponse(request),
        sourceBlockHash: `0x${'ef'.repeat(32)}`,
      }),
    ],
    [
      'missing result',
      (request: EvmTokenBalanceBatchReadRequest): unknown => ({
        ...fixtureBalanceResponse(request),
        balances: fixtureBalanceResponse(request).balances.slice(0, 1),
      }),
    ],
    [
      'duplicate result',
      (request: EvmTokenBalanceBatchReadRequest): unknown => ({
        ...fixtureBalanceResponse(request),
        balances: [
          {
            contractAddress: requiredContract(request, 0),
            balanceAtomic: '1',
          },
          {
            contractAddress: requiredContract(request, 0),
            balanceAtomic: '2',
          },
        ],
      }),
    ],
    [
      'unexpected contract',
      (request: EvmTokenBalanceBatchReadRequest): unknown => ({
        ...fixtureBalanceResponse(request),
        balances: [
          fixtureBalanceResponse(request).balances[0],
          {
            contractAddress: '0x2222222222222222222222222222222222222222',
            balanceAtomic: '1',
          },
        ],
      }),
    ],
    [
      'non-canonical atomic units',
      (request: EvmTokenBalanceBatchReadRequest): unknown => ({
        ...fixtureBalanceResponse(request),
        balances: [
          {
            contractAddress: requiredContract(request, 0),
            balanceAtomic: '01',
          },
          fixtureBalanceResponse(request).balances[1],
        ],
      }),
    ],
    [
      'unexpected response field',
      (request: EvmTokenBalanceBatchReadRequest): unknown => ({
        ...fixtureBalanceResponse(request),
        provider: 'not-trusted',
      }),
    ],
  ] as const)('rejects a %s without retrying or persisting', async (_label, responseFactory) => {
    const harness = createHarness();
    harness.reader.readTokenBalances.mockImplementationOnce(async (request) =>
      responseFactory(request),
    );

    await expect(
      harness.indexer.indexWallet({ walletAddress: fixture.walletAddress }),
    ).rejects.toEqual(new EvmStablecoinBalanceIndexerError('INVALID_BALANCE_RESPONSE'));
    expect(harness.reader.readTokenBalances).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.wait).not.toHaveBeenCalled();
    expect(harness.store.upsertWalletSnapshot).not.toHaveBeenCalled();
  });

  it('exhausts the three-attempt policy without creating a partial snapshot', async () => {
    const harness = createHarness();
    harness.reader.readTokenBalances.mockRejectedValue(new EvmBalanceReadFailure('TIMEOUT'));

    await expect(
      harness.indexer.indexWallet({ walletAddress: fixture.walletAddress }),
    ).rejects.toEqual(new EvmStablecoinBalanceIndexerError('PROVIDER_RETRY_EXHAUSTED'));
    expect(harness.reader.readTokenBalances).toHaveBeenCalledTimes(3);
    expect(harness.scheduler.nextJitterMs).toHaveBeenNthCalledWith(1, 250);
    expect(harness.scheduler.nextJitterMs).toHaveBeenNthCalledWith(2, 500);
    expect(harness.scheduler.wait.mock.calls).toEqual([[250], [500]]);
    expect(harness.store.upsertWalletSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    new EvmBalanceReadFailure('PERMANENT_FAILURE'),
    new Error('unclassified adapter failure'),
  ])('does not retry a permanent or unclassified provider failure %#', async (failure) => {
    const harness = createHarness();
    harness.reader.readTokenBalances.mockRejectedValue(failure);

    await expect(
      harness.indexer.indexWallet({ walletAddress: fixture.walletAddress }),
    ).rejects.toEqual(new EvmStablecoinBalanceIndexerError('PROVIDER_READ_FAILED'));
    expect(harness.reader.readTokenBalances).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.wait).not.toHaveBeenCalled();
    expect(harness.store.upsertWalletSnapshot).not.toHaveBeenCalled();
  });

  it('fails instead of sleeping beyond the configured Retry-After bound', async () => {
    const harness = createHarness();
    harness.reader.readTokenBalances.mockRejectedValue(
      new EvmBalanceReadFailure('RATE_LIMITED', { retryAfterMs: 5_001 }),
    );

    await expect(
      harness.indexer.indexWallet({ walletAddress: fixture.walletAddress }),
    ).rejects.toEqual(new EvmStablecoinBalanceIndexerError('RATE_LIMIT_DELAY_EXCEEDS_BOUND'));
    expect(harness.reader.readTokenBalances).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.nextJitterMs).not.toHaveBeenCalled();
    expect(harness.scheduler.wait).not.toHaveBeenCalled();
  });

  it.each([
    {
      expected: 'INVALID_RETRY_JITTER',
      arrange: (harness: Harness): void => {
        harness.scheduler.nextJitterMs.mockReturnValue(251);
      },
    },
    {
      expected: 'INVALID_RETRY_JITTER',
      arrange: (harness: Harness): void => {
        harness.scheduler.nextJitterMs.mockImplementation(() => {
          throw new Error('random source failed');
        });
      },
    },
    {
      expected: 'RETRY_DELAY_FAILED',
      arrange: (harness: Harness): void => {
        harness.scheduler.wait.mockRejectedValue(new Error('timer failed'));
      },
    },
  ] as const)('maps scheduler failure to $expected', async ({ expected, arrange }) => {
    const harness = createHarness();
    arrange(harness);
    harness.reader.readTokenBalances.mockRejectedValue(new EvmBalanceReadFailure('TIMEOUT'));

    await expect(
      harness.indexer.indexWallet({ walletAddress: fixture.walletAddress }),
    ).rejects.toEqual(new EvmStablecoinBalanceIndexerError(expected));
    expect(harness.store.upsertWalletSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    {
      arrange: (harness: Harness): void => {
        harness.store.upsertWalletSnapshot.mockRejectedValue(new Error('persistence failed'));
      },
    },
    {
      arrange: (harness: Harness): void => {
        harness.store.upsertWalletSnapshot.mockResolvedValue('APPENDED' as never);
      },
    },
  ])('maps a failed or invalid store result without retrying the write %#', async ({ arrange }) => {
    const harness = createHarness();
    arrange(harness);

    await expect(
      harness.indexer.indexWallet({ walletAddress: fixture.walletAddress }),
    ).rejects.toEqual(new EvmStablecoinBalanceIndexerError('POSITION_STORE_FAILED'));
    expect(harness.store.upsertWalletSnapshot).toHaveBeenCalledTimes(1);
  });

  it('replaces a later block while keeping stable position IDs and one current position per asset', async () => {
    const harness = createHarness();
    const nextBlock = Object.freeze({
      ...fixture.sourceBlock,
      number: '20765433',
      hash: `0x${'ef'.repeat(32)}`,
    });
    harness.reader.readSourceBlock
      .mockResolvedValueOnce(fixture.sourceBlock)
      .mockResolvedValue(nextBlock);

    const first = await harness.indexer.indexWallet({ walletAddress: fixture.walletAddress });
    const next = await harness.indexer.indexWallet({ walletAddress: fixture.walletAddress });

    expect(next.snapshotId).not.toBe(first.snapshotId);
    expect(next.positions.map(({ positionId }) => positionId)).toEqual(
      first.positions.map(({ positionId }) => positionId),
    );
    expect(next.positions.map(({ observationId }) => observationId)).not.toEqual(
      first.positions.map(({ observationId }) => observationId),
    );
    expect(harness.writeDispositions).toEqual(['CREATED', 'REPLACED']);
    expect(harness.persistedPositions.size).toBe(3);
  });

  it('validates Retry-After at the adapter error boundary', () => {
    expect(() => new EvmBalanceReadFailure('RATE_LIMITED', { retryAfterMs: -1 })).toThrow(
      TypeError,
    );
    expect(() => new EvmBalanceReadFailure('RATE_LIMITED', { retryAfterMs: 1.5 })).toThrow(
      TypeError,
    );
  });
});
