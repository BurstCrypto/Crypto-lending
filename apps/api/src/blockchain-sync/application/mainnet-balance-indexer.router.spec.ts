import { BalanceSyncIndexerFailure } from '../domain/balance-sync';
import {
  ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
  MainnetBalanceIndexerRouter,
  SOLANA_MAINNET_BALANCE_NETWORK_ID,
} from './mainnet-balance-indexer.router';
import {
  INERT_BALANCE_SYNC_EXECUTION_CONTEXT,
  type BalanceIndexerReadRequest,
  type BalanceIndexerRescanRequest,
  type BalanceSyncExecutionContext,
  type BalanceSyncIndexerPort,
} from './ports/balance-sync.ports';

interface TestRouter {
  readonly readCurrent: (
    request: BalanceIndexerReadRequest,
    context?: BalanceSyncExecutionContext,
  ) => Promise<unknown>;
  readonly rescanFromCheckpoint: (
    request: BalanceIndexerRescanRequest,
    context?: BalanceSyncExecutionContext,
  ) => Promise<unknown>;
}

function testRouter(runtime: MainnetBalanceIndexerRouter): Readonly<TestRouter> {
  return Object.freeze({
    readCurrent: (
      request: BalanceIndexerReadRequest,
      context: BalanceSyncExecutionContext = INERT_BALANCE_SYNC_EXECUTION_CONTEXT,
    ) => runtime.readCurrent(request, context),
    rescanFromCheckpoint: (
      request: BalanceIndexerRescanRequest,
      context: BalanceSyncExecutionContext = INERT_BALANCE_SYNC_EXECUTION_CONTEXT,
    ) => runtime.rescanFromCheckpoint(request, context),
  });
}

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
  router: TestRouter;
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
    router: testRouter(new MainnetBalanceIndexerRouter(ethereum, solana)),
    ethereumRead,
    ethereumRescan,
    solanaRead,
    solanaRescan,
  };
}

function expectFixedConfigurationFailure(operation: () => unknown): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    name: 'MainnetBalanceIndexerRouterConfigurationError',
    code: 'MAINNET_BALANCE_INDEXER_ROUTER_CONFIGURATION_INVALID',
    message: 'Mainnet balance indexer router configuration is invalid',
  });
  expect(typeof caught === 'object' && caught !== null && Object.isFrozen(caught)).toBe(true);
}

function restoreDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, key);
  } else {
    Object.defineProperty(target, key, descriptor);
  }
}

describe('MainnetBalanceIndexerRouter', () => {
  it('captures dependency methods once, preserves their receivers, and ignores later redirection', async () => {
    const receivers: unknown[] = [];
    const ethereumRead = jest.fn(function (this: unknown): Promise<unknown> {
      receivers.push(this);
      return Promise.resolve('captured-ethereum');
    });
    const ethereumRescan = jest.fn(function (this: unknown): Promise<unknown> {
      receivers.push(this);
      return Promise.resolve('captured-ethereum-rescan');
    });
    const solanaRead = jest.fn(function (this: unknown): Promise<unknown> {
      receivers.push(this);
      return Promise.resolve('captured-solana');
    });
    const solanaRescan = jest.fn(function (this: unknown): Promise<unknown> {
      receivers.push(this);
      return Promise.resolve('captured-solana-rescan');
    });
    const ethereum: BalanceSyncIndexerPort = {
      readCurrent: ethereumRead,
      rescanFromCheckpoint: ethereumRescan,
    };
    const solana: BalanceSyncIndexerPort = {
      readCurrent: solanaRead,
      rescanFromCheckpoint: solanaRescan,
    };
    const router = testRouter(new MainnetBalanceIndexerRouter(ethereum, solana));
    const redirectedEthereumRead = jest.fn(async () => 'redirected-ethereum');
    const redirectedSolanaRescan = jest.fn(async () => 'redirected-solana-rescan');
    let lateGetterReads = 0;
    Object.defineProperty(ethereum, 'readCurrent', {
      configurable: true,
      get: () => {
        lateGetterReads += 1;
        return redirectedEthereumRead;
      },
    });
    Object.defineProperty(solana, 'rescanFromCheckpoint', {
      configurable: true,
      get: () => {
        lateGetterReads += 1;
        return redirectedSolanaRescan;
      },
    });

    await expect(router.readCurrent(readRequest())).resolves.toBe('captured-ethereum');
    await expect(
      router.rescanFromCheckpoint(rescanRequest(SOLANA_MAINNET_BALANCE_NETWORK_ID)),
    ).resolves.toBe('captured-solana-rescan');

    expect(receivers).toEqual([ethereum, solana]);
    expect(ethereumRead).toHaveBeenCalledTimes(1);
    expect(solanaRescan).toHaveBeenCalledTimes(1);
    expect(redirectedEthereumRead).not.toHaveBeenCalled();
    expect(redirectedSolanaRescan).not.toHaveBeenCalled();
    expect(lateGetterReads).toBe(0);
  });

  it('rejects missing, accessor-backed, aliased, and hostile indexer dependencies with one fixed error', () => {
    const valid: BalanceSyncIndexerPort = {
      readCurrent: async () => undefined,
      rescanFromCheckpoint: async () => undefined,
    };
    let getterReads = 0;
    const accessorBacked = {
      rescanFromCheckpoint: async () => undefined,
    } as Record<string, unknown>;
    Object.defineProperty(accessorBacked, 'readCurrent', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return async () => undefined;
      },
    });
    let hostileErrorInspections = 0;
    const hostileThrown = new Proxy(Object.create(null) as object, {
      getPrototypeOf: () => {
        hostileErrorInspections += 1;
        throw new Error('hostile error inspection must not run');
      },
    });
    const hostileDependency = new Proxy(Object.create(null) as object, {
      getOwnPropertyDescriptor: () => {
        throw hostileThrown;
      },
    });

    expectFixedConfigurationFailure(
      () => new MainnetBalanceIndexerRouter(accessorBacked as never, valid),
    );
    expectFixedConfigurationFailure(
      () => new MainnetBalanceIndexerRouter({ readCurrent: async () => undefined } as never, valid),
    );
    expectFixedConfigurationFailure(() => new MainnetBalanceIndexerRouter(valid, valid));
    expectFixedConfigurationFailure(
      () => new MainnetBalanceIndexerRouter(hostileDependency as never, valid),
    );

    expect(getterReads).toBe(0);
    expect(hostileErrorInspections).toBe(0);
  });

  it('never sources indexer methods from polluted terminal prototypes', () => {
    const valid: BalanceSyncIndexerPort = {
      readCurrent: async () => undefined,
      rescanFromCheckpoint: async () => undefined,
    };
    const objectRead = Object.getOwnPropertyDescriptor(Object.prototype, 'readCurrent');
    const objectRescan = Object.getOwnPropertyDescriptor(Object.prototype, 'rescanFromCheckpoint');
    const functionRead = Object.getOwnPropertyDescriptor(Function.prototype, 'readCurrent');
    const functionRescan = Object.getOwnPropertyDescriptor(
      Function.prototype,
      'rescanFromCheckpoint',
    );
    Object.defineProperties(Object.prototype, {
      readCurrent: { configurable: true, value: async () => 'polluted-object-read' },
      rescanFromCheckpoint: { configurable: true, value: async () => 'polluted-object-rescan' },
    });
    Object.defineProperties(Function.prototype, {
      readCurrent: { configurable: true, value: async () => 'polluted-function-read' },
      rescanFromCheckpoint: { configurable: true, value: async () => 'polluted-function-rescan' },
    });
    try {
      expectFixedConfigurationFailure(() => new MainnetBalanceIndexerRouter({} as never, valid));
      expectFixedConfigurationFailure(
        () => new MainnetBalanceIndexerRouter((() => undefined) as never, valid),
      );
    } finally {
      restoreDescriptor(Object.prototype, 'readCurrent', objectRead);
      restoreDescriptor(Object.prototype, 'rescanFromCheckpoint', objectRescan);
      restoreDescriptor(Function.prototype, 'readCurrent', functionRead);
      restoreDescriptor(Function.prototype, 'rescanFromCheckpoint', functionRescan);
    }
  });

  it('routes both operations to exactly the Ethereum mainnet indexer', async () => {
    const test = harness();
    const read = readRequest();
    const rescan = rescanRequest();

    await expect(test.router.readCurrent(read)).resolves.toBe('ethereum-read');
    await expect(test.router.rescanFromCheckpoint(rescan)).resolves.toBe('ethereum-rescan');

    expect(test.ethereumRead).toHaveBeenCalledWith(read, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);
    expect(test.ethereumRescan).toHaveBeenCalledWith(rescan, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);
    expect(test.solanaRead).not.toHaveBeenCalled();
    expect(test.solanaRescan).not.toHaveBeenCalled();
  });

  it('routes both operations to exactly the Solana mainnet indexer', async () => {
    const test = harness();
    const read = readRequest(SOLANA_MAINNET_BALANCE_NETWORK_ID);
    const rescan = rescanRequest(SOLANA_MAINNET_BALANCE_NETWORK_ID);

    await expect(test.router.readCurrent(read)).resolves.toBe('solana-read');
    await expect(test.router.rescanFromCheckpoint(rescan)).resolves.toBe('solana-rescan');

    expect(test.solanaRead).toHaveBeenCalledWith(read, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);
    expect(test.solanaRescan).toHaveBeenCalledWith(rescan, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);
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

  it('rejects a structurally similar but unminted execution context before routing', async () => {
    const test = harness();
    const counterfeit = Object.freeze({ signal: new AbortController().signal });

    await expect(test.router.readCurrent(readRequest(), counterfeit)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    await expect(
      test.router.rescanFromCheckpoint(rescanRequest(), counterfeit),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    expect(test.ethereumRead).not.toHaveBeenCalled();
    expect(test.ethereumRescan).not.toHaveBeenCalled();
    expect(test.solanaRead).not.toHaveBeenCalled();
    expect(test.solanaRescan).not.toHaveBeenCalled();
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

  it.each([
    ['accountId', 'not-a-uuid'],
    ['accountId', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'],
    ['accountId', 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa'],
    ['accountId', 'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa'],
    ['accountId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\0suffix'],
    ['walletId', 'not-a-uuid'],
    ['walletId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\0suffix'],
  ] as const)('rejects invalid %s value before either indexer is called', async (field, value) => {
    const test = harness();
    const candidate = { ...readRequest(), [field]: value } as BalanceIndexerReadRequest;
    const rescanCandidate = {
      ...rescanRequest(),
      [field]: value,
    } as BalanceIndexerRescanRequest;

    await expect(test.router.readCurrent(candidate)).rejects.toMatchObject({
      code: 'PERMANENT_PROVIDER_FAILURE',
      message: 'PERMANENT_PROVIDER_FAILURE',
    });
    await expect(test.router.rescanFromCheckpoint(rescanCandidate)).rejects.toMatchObject({
      code: 'PERMANENT_PROVIDER_FAILURE',
      message: 'PERMANENT_PROVIDER_FAILURE',
    });

    expect(test.ethereumRead).not.toHaveBeenCalled();
    expect(test.ethereumRescan).not.toHaveBeenCalled();
    expect(test.solanaRead).not.toHaveBeenCalled();
    expect(test.solanaRescan).not.toHaveBeenCalled();
  });

  it('passes owned exact frozen request snapshots to the selected indexer', async () => {
    let observedRead: BalanceIndexerReadRequest | undefined;
    let observedRescan: BalanceIndexerRescanRequest | undefined;
    let observedReadContext: BalanceSyncExecutionContext | undefined;
    let observedRescanContext: BalanceSyncExecutionContext | undefined;
    const ethereum: BalanceSyncIndexerPort = {
      readCurrent: async (request, context) => {
        observedRead = request;
        observedReadContext = context;
      },
      rescanFromCheckpoint: async (request, context) => {
        observedRescan = request;
        observedRescanContext = context;
      },
    };
    const solana: BalanceSyncIndexerPort = {
      readCurrent: async () => undefined,
      rescanFromCheckpoint: async () => undefined,
    };
    const router = testRouter(new MainnetBalanceIndexerRouter(ethereum, solana));
    const mutableRead = { ...readRequest() };
    const mutableSource = { ...rescanRequest().fromFinalizedSource };
    const mutableRescan = {
      ...readRequest(),
      fromFinalizedSource: mutableSource,
      maximumReadUnits: 128,
    };

    await router.readCurrent(mutableRead);
    await router.rescanFromCheckpoint(mutableRescan);
    mutableRead.accountId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mutableRescan.maximumReadUnits = 64;
    mutableSource.hash = 'mutated';

    expect(observedRead).not.toBe(mutableRead);
    expect(Reflect.ownKeys(observedRead ?? {})).toEqual([
      'accountId',
      'walletId',
      'networkId',
      'tier',
      'selector',
    ]);
    expect(Object.getPrototypeOf(observedRead)).toBeNull();
    expect(Object.isFrozen(observedRead)).toBe(true);
    expect(observedRead?.accountId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(observedReadContext).toBe(INERT_BALANCE_SYNC_EXECUTION_CONTEXT);

    expect(observedRescan).not.toBe(mutableRescan);
    expect(Reflect.ownKeys(observedRescan ?? {})).toEqual([
      'accountId',
      'walletId',
      'networkId',
      'tier',
      'selector',
      'fromFinalizedSource',
      'maximumReadUnits',
    ]);
    expect(Object.getPrototypeOf(observedRescan)).toBeNull();
    expect(Object.isFrozen(observedRescan)).toBe(true);
    expect(observedRescan?.maximumReadUnits).toBe(128);
    expect(observedRescan?.fromFinalizedSource).not.toBe(mutableSource);
    expect(Object.getPrototypeOf(observedRescan?.fromFinalizedSource)).toBeNull();
    expect(Object.isFrozen(observedRescan?.fromFinalizedSource)).toBe(true);
    expect(observedRescan?.fromFinalizedSource.hash).toBe('source-hash');
    expect(observedRescanContext).toBe(INERT_BALANCE_SYNC_EXECUTION_CONTEXT);
  });

  it('maps hostile values thrown during request reflection without inspecting them', async () => {
    const test = harness();
    let hostileErrorInspections = 0;
    const hostileThrown = new Proxy(Object.create(null) as object, {
      getPrototypeOf: () => {
        hostileErrorInspections += 1;
        throw new Error('hostile error inspection must not run');
      },
      get: () => {
        hostileErrorInspections += 1;
        throw new Error('hostile error property must not be read');
      },
    });
    const hostileRequest = new Proxy(
      { ...readRequest() },
      {
        ownKeys: () => {
          throw hostileThrown;
        },
      },
    );

    await expect(
      test.router.readCurrent(hostileRequest as BalanceIndexerReadRequest),
    ).rejects.toMatchObject({
      name: 'BalanceSyncIndexerFailure',
      code: 'PERMANENT_PROVIDER_FAILURE',
      message: 'PERMANENT_PROVIDER_FAILURE',
    });

    expect(hostileErrorInspections).toBe(0);
    expect(test.ethereumRead).not.toHaveBeenCalled();
    expect(test.solanaRead).not.toHaveBeenCalled();
  });

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
