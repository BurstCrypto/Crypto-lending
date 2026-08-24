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
    readTokenBalances: jest.fn(async (request) => ({
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
    })),
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
});
