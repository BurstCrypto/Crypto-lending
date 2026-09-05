import { BalanceSyncIndexerFailure } from '../domain/balance-sync';
import {
  ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
  MainnetBalanceIndexerRouter,
  SOLANA_MAINNET_BALANCE_NETWORK_ID,
} from './mainnet-balance-indexer.router';
import type {
  BalanceIndexerReadRequest,
  BalanceIndexerRescanRequest,
  BalanceSyncIndexerPort,
} from './ports/balance-sync.ports';

function readRequest(
  networkId: BalanceIndexerReadRequest['networkId'] = ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
): BalanceIndexerReadRequest {
  return Object.freeze({
    accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    networkId,
    tier: 'PROVISIONAL',
    selector: networkId === ETHEREUM_MAINNET_BALANCE_NETWORK_ID ? 'latest' : 'confirmed',
  });
}

function rescanRequest(
  networkId: BalanceIndexerReadRequest['networkId'] = ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
): BalanceIndexerRescanRequest {
  return Object.freeze({
    ...readRequest(networkId),
    fromFinalizedSource: Object.freeze({
      position: '100',
      hash: 'source-hash',
      parentHash: 'parent-hash',
      selector: 'finalized',
      retrievedAt: '2026-09-04T12:00:00.000Z',
    }),
    maximumReadUnits: 128,
  });
}

function harness(): Readonly<{
  router: MainnetBalanceIndexerRouter;
  ethereumRead: jest.Mock;
  ethereumRescan: jest.Mock;
  solanaRead: jest.Mock;
  solanaRescan: jest.Mock;
}> {
  const ethereumRead = jest.fn(async () => 'ethereum-read');
  const ethereumRescan = jest.fn(async () => 'ethereum-rescan');
  const solanaRead = jest.fn(async () => 'solana-read');
  const solanaRescan = jest.fn(async () => 'solana-rescan');
  const ethereum: BalanceSyncIndexerPort = {
    readCurrent: ethereumRead,
    rescanFromCheckpoint: ethereumRescan,
  };
  const solana: BalanceSyncIndexerPort = {
    readCurrent: solanaRead,
    rescanFromCheckpoint: solanaRescan,
  };
  return {
    router: new MainnetBalanceIndexerRouter(ethereum, solana),
    ethereumRead,
    ethereumRescan,
    solanaRead,
    solanaRescan,
  };
}

describe('MainnetBalanceIndexerRouter', () => {
  it('routes both operations to exactly the Ethereum mainnet indexer', async () => {
    const test = harness();
    const read = readRequest();
    const rescan = rescanRequest();

    await expect(test.router.readCurrent(read)).resolves.toBe('ethereum-read');
    await expect(test.router.rescanFromCheckpoint(rescan)).resolves.toBe('ethereum-rescan');

    expect(test.ethereumRead).toHaveBeenCalledWith(read);
    expect(test.ethereumRescan).toHaveBeenCalledWith(rescan);
    expect(test.solanaRead).not.toHaveBeenCalled();
    expect(test.solanaRescan).not.toHaveBeenCalled();
  });

  it('routes both operations to exactly the Solana mainnet indexer', async () => {
    const test = harness();
    const read = readRequest(SOLANA_MAINNET_BALANCE_NETWORK_ID);
    const rescan = rescanRequest(SOLANA_MAINNET_BALANCE_NETWORK_ID);

    await expect(test.router.readCurrent(read)).resolves.toBe('solana-read');
    await expect(test.router.rescanFromCheckpoint(rescan)).resolves.toBe('solana-rescan');

    expect(test.solanaRead).toHaveBeenCalledWith(read);
    expect(test.solanaRescan).toHaveBeenCalledWith(rescan);
    expect(test.ethereumRead).not.toHaveBeenCalled();
    expect(test.ethereumRescan).not.toHaveBeenCalled();
  });

  it.each([
    'eip155:8453',
    'eip155:11155111',
    'eip155:42161',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  ] as const)(
    'rejects unsupported network %s for both operations before either indexer is called',
    async (networkId) => {
      const test = harness();
      const typedNetwork = networkId as BalanceIndexerReadRequest['networkId'];

      await expect(test.router.readCurrent(readRequest(typedNetwork))).rejects.toMatchObject({
        code: 'PERMANENT_PROVIDER_FAILURE',
      });
      await expect(
        test.router.rescanFromCheckpoint(rescanRequest(typedNetwork)),
      ).rejects.toMatchObject({ code: 'PERMANENT_PROVIDER_FAILURE' });

      expect(test.ethereumRead).not.toHaveBeenCalled();
      expect(test.ethereumRescan).not.toHaveBeenCalled();
      expect(test.solanaRead).not.toHaveBeenCalled();
      expect(test.solanaRescan).not.toHaveBeenCalled();
    },
  );

  it('does not fall back across chains after an indexer failure', async () => {
    const test = harness();
    test.ethereumRead.mockRejectedValueOnce(new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE'));

    await expect(test.router.readCurrent(readRequest())).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });

    expect(test.ethereumRead).toHaveBeenCalledTimes(1);
    expect(test.solanaRead).not.toHaveBeenCalled();
  });

  it('does not fall back across chains after a rescan failure', async () => {
    const test = harness();
    test.solanaRescan.mockRejectedValueOnce(new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED'));

    await expect(
      test.router.rescanFromCheckpoint(rescanRequest(SOLANA_MAINNET_BALANCE_NETWORK_ID)),
    ).rejects.toMatchObject({ code: 'REORG_RECOVERY_FAILED' });

    expect(test.solanaRescan).toHaveBeenCalledTimes(1);
    expect(test.ethereumRescan).not.toHaveBeenCalled();
  });

  it.each([0, -1, 2_049, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid recovery read-unit bound %s before either indexer is called',
    async (maximumReadUnits) => {
      const test = harness();
      const candidate = { ...rescanRequest(), maximumReadUnits };

      await expect(test.router.rescanFromCheckpoint(candidate)).rejects.toMatchObject({
        code: 'PERMANENT_PROVIDER_FAILURE',
      });

      expect(test.ethereumRescan).not.toHaveBeenCalled();
      expect(test.solanaRescan).not.toHaveBeenCalled();
    },
  );

  it('rejects accessor, symbol, custom-prototype, and nested-accessor inputs without reading them', async () => {
    const test = harness();
    let reads = 0;
    const accessor = { ...readRequest() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'networkId', {
      enumerable: true,
      get: () => {
        reads += 1;
        return ETHEREUM_MAINNET_BALANCE_NETWORK_ID;
      },
    });
    const symbolBearing = { ...readRequest(), [Symbol('hidden')]: 'forbidden' };
    const customPrototype = Object.assign(Object.create({ polluted: true }), readRequest());
    const nestedAccessor = { ...rescanRequest() } as Record<string, unknown>;
    const source = { ...rescanRequest().fromFinalizedSource } as Record<string, unknown>;
    Object.defineProperty(source, 'hash', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'source-hash';
      },
    });
    nestedAccessor.fromFinalizedSource = source;

    for (const candidate of [accessor, symbolBearing, customPrototype]) {
      await expect(
        test.router.readCurrent(candidate as BalanceIndexerReadRequest),
      ).rejects.toMatchObject({ code: 'PERMANENT_PROVIDER_FAILURE' });
    }
    await expect(
      test.router.rescanFromCheckpoint(nestedAccessor as unknown as BalanceIndexerRescanRequest),
    ).rejects.toMatchObject({ code: 'PERMANENT_PROVIDER_FAILURE' });

    expect(reads).toBe(0);
    expect(test.ethereumRead).not.toHaveBeenCalled();
    expect(test.ethereumRescan).not.toHaveBeenCalled();
    expect(test.solanaRead).not.toHaveBeenCalled();
    expect(test.solanaRescan).not.toHaveBeenCalled();
  });
});
