import { performance } from 'node:perf_hooks';

import { applicationObservability } from '../../infrastructure/observability';
import type { PinnedSqsQueueReceiptPort } from '../../infrastructure/sqs/sqs-queue-receipt.port';
import type {
  JobEnvelope,
  JobProcessingResult,
  ReceivedQueueMessage,
} from '../../infrastructure/sqs/sqs.types';
import {
  BALANCE_SYNC_POLICY,
  BalanceSyncIndexerFailure,
  createDeterministicBalanceSyncJobEnvelope,
} from '../domain/balance-sync';
import type { BalanceJsonRpcTransport } from '../infrastructure/rpc/balance-json-rpc';
import { EthereumMainnetBalanceIndexerAdapter } from '../infrastructure/rpc/ethereum-mainnet-balance-indexer.adapter';
import { SolanaMainnetBalanceIndexerAdapter } from '../infrastructure/rpc/solana-mainnet-balance-indexer.adapter';
import {
  createBalanceSyncConsumerComposition,
  type BalanceSyncConsumerReceiptPolicy,
} from './balance-sync-consumer.composition';
import { BalanceSyncConsumerService } from './balance-sync-consumer.service';
import { FailClosedBalanceSyncJobPort } from './fail-closed-balance-sync-job.port';
import {
  ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
  MainnetBalanceIndexerRouter,
  SOLANA_MAINNET_BALANCE_NETWORK_ID,
} from './mainnet-balance-indexer.router';
import {
  createBalanceSyncExecutionContext,
  type BalanceIndexerReadRequest,
  type BalanceSyncCheckpointPort,
  type BalanceSyncClockPort,
  type BalanceSyncMetricsPort,
  type BalanceSyncWalletAddressResolverPort,
} from './ports/balance-sync.ports';

const TEST_EXECUTION = createBalanceSyncExecutionContext();

function receiptPolicy(visibilityTimeoutSeconds = 30): BalanceSyncConsumerReceiptPolicy {
  return { visibilityTimeoutSeconds };
}

function createHarness(
  configuredReceiptPolicy: BalanceSyncConsumerReceiptPolicy = receiptPolicy(),
  configuredClock: BalanceSyncClockPort = {
    now: () => new Date('2026-09-04T12:00:00.000Z'),
  },
  configuredSqs?: PinnedSqsQueueReceiptPort,
): Readonly<{
  composition: ReturnType<typeof createBalanceSyncConsumerComposition>;
  ethereumExchange: jest.Mock;
  solanaExchange: jest.Mock;
  ethereumTransport: BalanceJsonRpcTransport;
  solanaTransport: BalanceJsonRpcTransport;
  walletAddressResolver: BalanceSyncWalletAddressResolverPort;
  checkpoints: BalanceSyncCheckpointPort;
  clock: BalanceSyncClockPort;
  metrics: BalanceSyncMetricsPort;
  sqs: PinnedSqsQueueReceiptPort;
  receive: jest.Mock;
  deleteReceipt: jest.Mock;
  changeVisibility: jest.Mock;
}> {
  const ethereumExchange = jest.fn();
  const solanaExchange = jest.fn();
  const ethereumTransport: BalanceJsonRpcTransport = { exchange: ethereumExchange };
  const solanaTransport: BalanceJsonRpcTransport = { exchange: solanaExchange };
  const walletAddressResolver: BalanceSyncWalletAddressResolverPort = {
    resolveActiveAddress: jest.fn(),
  };
  const checkpoints: BalanceSyncCheckpointPort = {
    load: jest.fn(),
    upsertCurrent: jest.fn(),
    replaceProvisionalAfterReorg: jest.fn(),
    preserveLastGoodAndMarkStale: jest.fn(),
  };
  const clock = configuredClock;
  const metrics: BalanceSyncMetricsPort = { record: jest.fn(), alert: jest.fn() };
  const receive = jest.fn().mockResolvedValue([]);
  const deleteReceipt = jest.fn().mockResolvedValue(undefined);
  const changeVisibility = jest.fn().mockResolvedValue(undefined);
  const defaultSqs: PinnedSqsQueueReceiptPort = {
    receive,
    delete: deleteReceipt,
    changeVisibility,
    parseEnvelope: <Payload = unknown>(body: string): JobEnvelope<Payload> =>
      JSON.parse(body) as JobEnvelope<Payload>,
  };
  const sqs = configuredSqs ?? defaultSqs;
  const composition = createBalanceSyncConsumerComposition({
    sqs,
    receiptPolicy: configuredReceiptPolicy,
    observability: applicationObservability,
    ethereumTransport,
    solanaTransport,
    walletAddressResolver,
    checkpoints,
    clock,
    metrics,
  });
  return {
    composition,
    ethereumExchange,
    solanaExchange,
    ethereumTransport,
    solanaTransport,
    walletAddressResolver,
    checkpoints,
    clock,
    metrics,
    sqs,
    receive,
    deleteReceipt,
    changeVisibility,
  };
}

describe('createBalanceSyncConsumerComposition', () => {
  const invalidReceiptPolicyError = 'Balance sync consumer receipt policy is invalid';

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['above SQS maximum', 43_201],
    ['fractional', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['string', '30'],
    ['undefined', undefined],
    ['null', null],
  ])('rejects a %s visibility timeout with a fixed error', (_label, value) => {
    expect(() =>
      createHarness({ visibilityTimeoutSeconds: value } as BalanceSyncConsumerReceiptPolicy),
    ).toThrow(invalidReceiptPolicyError);
  });

  it('rejects accessor, symbol, surplus, missing, non-enumerable, array, and non-plain policies', () => {
    let accessorReads = 0;
    const accessorPolicy = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorPolicy, 'visibilityTimeoutSeconds', {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorReads += 1;
        throw new Error('secret accessor detail');
      },
    });
    const symbolPolicy = { visibilityTimeoutSeconds: 30 } as Record<PropertyKey, unknown>;
    symbolPolicy[Symbol('unreviewed')] = true;
    const nonEnumerablePolicy = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(nonEnumerablePolicy, 'visibilityTimeoutSeconds', {
      enumerable: false,
      value: 30,
    });

    const candidates: unknown[] = [
      accessorPolicy,
      symbolPolicy,
      { visibilityTimeoutSeconds: 30, maxReceiveCount: 3 },
      {},
      nonEnumerablePolicy,
      [30],
      Object.assign(Object.create({ inherited: true }) as object, {
        visibilityTimeoutSeconds: 30,
      }),
      new (class ReceiptPolicy {
        readonly visibilityTimeoutSeconds = 30;
      })(),
    ];

    for (const candidate of candidates) {
      expect(() => createHarness(candidate as BalanceSyncConsumerReceiptPolicy)).toThrow(
        invalidReceiptPolicyError,
      );
    }
    expect(accessorReads).toBe(0);
  });

  it('sanitizes hostile and revoked policy proxies without constructing the graph', () => {
    const secret = 'private-policy-proxy-detail';
    const exchange = jest.fn();
    const throwingPolicy = new Proxy(
      { visibilityTimeoutSeconds: 30 },
      {
        getPrototypeOf: () => {
          throw new Error(secret);
        },
      },
    );
    const revocable = Proxy.revocable({ visibilityTimeoutSeconds: 30 }, {});
    revocable.revoke();

    for (const candidate of [throwingPolicy, revocable.proxy]) {
      let thrown: unknown;
      try {
        createBalanceSyncConsumerComposition({
          sqs: {} as PinnedSqsQueueReceiptPort,
          receiptPolicy: candidate,
          observability: applicationObservability,
          ethereumTransport: { exchange },
          solanaTransport: { exchange },
          walletAddressResolver: { resolveActiveAddress: jest.fn() },
          checkpoints: {
            load: jest.fn(),
            upsertCurrent: jest.fn(),
            replaceProvisionalAfterReorg: jest.fn(),
            preserveLastGoodAndMarkStale: jest.fn(),
          },
          clock: { now: jest.fn() },
          metrics: { record: jest.fn(), alert: jest.fn() },
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toEqual(new Error(invalidReceiptPolicyError));
      expect(String(thrown)).not.toContain(secret);
    }
    expect(exchange).not.toHaveBeenCalled();
  });

  it('snapshots the exact policy once before graph construction and derives other values from the domain', () => {
    const target = { visibilityTimeoutSeconds: 30 };
    let ordinaryReads = 0;
    let descriptorReads = 0;
    const configuredPolicy = new Proxy(target, {
      get: () => {
        ordinaryReads += 1;
        throw new Error('ordinary property reads are forbidden');
      },
      getOwnPropertyDescriptor: (candidate, property) => {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(candidate, property);
      },
    });

    const test = createHarness(configuredPolicy);
    target.visibilityTimeoutSeconds = 60;
    type WorkerWiring = Readonly<{
      sqs: PinnedSqsQueueReceiptPort;
      policy: Readonly<{
        maxReceiveCount: number;
        visibilityTimeoutSeconds: number;
        retryBaseDelaySeconds: number;
        retryMaxDelaySeconds: number;
      }>;
    }>;
    const worker = test.composition.queueWorker as unknown as WorkerWiring;

    expect(descriptorReads).toBe(1);
    expect(ordinaryReads).toBe(0);
    expect(worker.sqs).toBe(test.sqs);
    expect(worker.policy).toEqual({
      maxReceiveCount: BALANCE_SYNC_POLICY.maxAttempts,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: BALANCE_SYNC_POLICY.retryBaseDelaySeconds,
      retryMaxDelaySeconds: BALANCE_SYNC_POLICY.retryMaximumDelaySeconds,
    });
    expect(Object.isFrozen(worker.policy)).toBe(true);
    expect(worker.policy).not.toBe(configuredPolicy);
  });

  it('accepts an exact null-prototype receipt policy', () => {
    const configuredPolicy = Object.assign(Object.create(null) as object, {
      visibilityTimeoutSeconds: 43_200,
    }) as BalanceSyncConsumerReceiptPolicy;

    expect(() => createHarness(configuredPolicy)).not.toThrow();
  });

  it('does not inspect an opaque receipt capability until worker execution', async () => {
    const receiveArguments: unknown[][] = [];
    const receive: PinnedSqsQueueReceiptPort['receive'] = async (...args) => {
      receiveArguments.push(args);
      return [];
    };
    const portTarget: PinnedSqsQueueReceiptPort = {
      receive,
      delete: async () => undefined,
      changeVisibility: async () => undefined,
      parseEnvelope: <Payload = unknown>(body: string): JobEnvelope<Payload> =>
        JSON.parse(body) as JobEnvelope<Payload>,
    };
    let receiveAccessorReads = 0;
    Object.defineProperty(portTarget, 'receive', {
      configurable: true,
      enumerable: true,
      get: () => {
        receiveAccessorReads += 1;
        return receive;
      },
    });
    const traps: PropertyKey[] = [];
    const sqs = new Proxy(portTarget, {
      get: (target, property, receiver) => {
        traps.push(property);
        return Reflect.get(target, property, receiver) as unknown;
      },
      getOwnPropertyDescriptor: (target, property) => {
        traps.push(property);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf: (target) => {
        traps.push('[[Prototype]]');
        return Reflect.getPrototypeOf(target);
      },
      ownKeys: (target) => {
        traps.push('[[OwnKeys]]');
        return Reflect.ownKeys(target);
      },
    });
    Object.defineProperty(portTarget, 'queueUrl', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error('queue URL must remain unread');
      },
    });

    const test = createHarness(receiptPolicy(), undefined, sqs);
    const worker = test.composition.queueWorker as unknown as Readonly<{
      sqs: PinnedSqsQueueReceiptPort;
    }>;

    expect(traps).toEqual([]);
    expect(receiveAccessorReads).toBe(0);
    expect(receiveArguments).toEqual([]);
    expect(worker.sqs).toBe(sqs);

    await expect(test.composition.queueWorker.processOne(async () => undefined)).resolves.toEqual({
      status: 'idle',
    });
    expect(traps).toEqual(['receive']);
    expect(receiveAccessorReads).toBe(1);
    expect(receiveArguments).toEqual([[]]);
  });

  it('constructs an inert, transparent, fail-closed object graph', () => {
    const test = createHarness();

    expect(Object.isFrozen(test.composition)).toBe(true);
    expect(test.composition.ethereumIndexer).toBeInstanceOf(EthereumMainnetBalanceIndexerAdapter);
    expect(test.composition.solanaIndexer).toBeInstanceOf(SolanaMainnetBalanceIndexerAdapter);
    expect(test.composition.indexer).toBeInstanceOf(MainnetBalanceIndexerRouter);
    expect(test.composition.jobDisposition).toBeInstanceOf(FailClosedBalanceSyncJobPort);
    expect(test.composition.consumer).toBeInstanceOf(BalanceSyncConsumerService);
    expect(test.ethereumExchange).not.toHaveBeenCalled();
    expect(test.solanaExchange).not.toHaveBeenCalled();
    expect(test.receive).not.toHaveBeenCalled();
    expect(test.checkpoints.load).not.toHaveBeenCalled();
    expect(test.walletAddressResolver.resolveActiveAddress).not.toHaveBeenCalled();
  });

  it('shares only the resolver and clock while keeping chain transports distinct', () => {
    const test = createHarness();
    type AdapterWiring = Readonly<{
      transport: BalanceJsonRpcTransport;
      addresses: BalanceSyncWalletAddressResolverPort;
      clock: BalanceSyncClockPort;
    }>;
    const ethereum = test.composition.ethereumIndexer as unknown as AdapterWiring;
    const solana = test.composition.solanaIndexer as unknown as AdapterWiring;

    expect(ethereum.transport).toBe(test.ethereumTransport);
    expect(solana.transport).toBe(test.solanaTransport);
    expect(ethereum.transport).not.toBe(solana.transport);
    expect(ethereum.addresses).toBe(test.walletAddressResolver);
    expect(solana.addresses).toBe(test.walletAddressResolver);
    expect(ethereum.clock).toBe(test.clock);
    expect(solana.clock).toBe(test.clock);
  });

  it('wires the two chain adapters into the closed mainnet router', async () => {
    const ethereumRead = jest
      .spyOn(EthereumMainnetBalanceIndexerAdapter.prototype, 'readCurrent')
      .mockResolvedValue('ethereum');
    const solanaRead = jest
      .spyOn(SolanaMainnetBalanceIndexerAdapter.prototype, 'readCurrent')
      .mockResolvedValue('solana');
    const test = createHarness();
    const request = (
      networkId: BalanceIndexerReadRequest['networkId'],
    ): BalanceIndexerReadRequest =>
      Object.freeze({
        accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        networkId,
        tier: 'PROVISIONAL' as const,
        selector:
          networkId === ETHEREUM_MAINNET_BALANCE_NETWORK_ID
            ? ('latest' as const)
            : ('confirmed' as const),
      });

    await expect(
      test.composition.indexer.readCurrent(
        request(ETHEREUM_MAINNET_BALANCE_NETWORK_ID),
        TEST_EXECUTION.context,
      ),
    ).resolves.toBe('ethereum');
    await expect(
      test.composition.indexer.readCurrent(
        request(SOLANA_MAINNET_BALANCE_NETWORK_ID),
        TEST_EXECUTION.context,
      ),
    ).resolves.toBe('solana');

    expect(ethereumRead).toHaveBeenCalledTimes(1);
    expect(solanaRead).toHaveBeenCalledTimes(1);
    expect(ethereumRead.mock.calls[0]?.[1]).toBe(TEST_EXECUTION.context);
    expect(solanaRead.mock.calls[0]?.[1]).toBe(TEST_EXECUTION.context);
    expect(test.ethereumExchange).not.toHaveBeenCalled();
    expect(test.solanaExchange).not.toHaveBeenCalled();
    ethereumRead.mockRestore();
    solanaRead.mockRestore();
  });

  it('receives only through the already-pinned capability without queue coordinates', async () => {
    const test = createHarness();

    await expect(test.composition.queueWorker.processOne(async () => undefined)).resolves.toEqual({
      status: 'idle',
    });

    expect(test.receive).toHaveBeenCalledTimes(1);
    expect(test.receive).toHaveBeenCalledWith();
  });

  it('uses only pinned receipt visibility and native redrive for three bounded failures', async () => {
    const test = createHarness();
    const handler = jest.fn().mockRejectedValue(new Error('private provider failure'));
    const job = createDeterministicBalanceSyncJobEnvelope(
      {
        schemaVersion: 1,
        accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        networkId: ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
        requiredTier: 'PROVISIONAL',
        cause: 'SCHEDULED',
        attempt: 1,
        rescanFromPosition: null,
      },
      {
        id: 'balance-receipt-job-1',
        occurredAt: '2026-09-04T12:00:00.000Z',
        correlation: { correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      },
    );
    const messages = [1, 2, 3].map((receiveCount): ReceivedQueueMessage => ({
      messageId: `balance-message-${receiveCount}`,
      receiptHandle: `balance-receipt-${receiveCount}`,
      body: JSON.stringify(job),
      receiveCount,
      receivedAtMonotonicMs: performance.now(),
    }));
    test.receive
      .mockResolvedValueOnce([messages[0]])
      .mockResolvedValueOnce([messages[1]])
      .mockResolvedValueOnce([messages[2]]);

    const results: JobProcessingResult[] = [];
    for (let attempt = 0; attempt < messages.length; attempt += 1) {
      results.push(await test.composition.queueWorker.processOne(handler));
    }

    expect(results.map((result) => result.status)).toEqual([
      'retry-scheduled',
      'retry-scheduled',
      'awaiting-dead-letter',
    ]);
    expect(
      results.map((result) =>
        'retryDelaySeconds' in result ? result.retryDelaySeconds : undefined,
      ),
    ).toEqual([
      BALANCE_SYNC_POLICY.retryBaseDelaySeconds,
      BALANCE_SYNC_POLICY.retryBaseDelaySeconds * 2,
      0,
    ]);
    expect(
      test.changeVisibility.mock.calls.map(([message, delaySeconds, abortSignal]) => ({
        messageId: (message as ReceivedQueueMessage).messageId,
        delaySeconds,
        hasAbortSignal: abortSignal instanceof AbortSignal,
      })),
    ).toEqual([
      {
        messageId: 'balance-message-1',
        delaySeconds: 5,
        hasAbortSignal: true,
      },
      {
        messageId: 'balance-message-2',
        delaySeconds: 10,
        hasAbortSignal: true,
      },
      {
        messageId: 'balance-message-3',
        delaySeconds: 0,
        hasAbortSignal: true,
      },
    ]);
    expect(handler).toHaveBeenCalledTimes(BALANCE_SYNC_POLICY.maxAttempts);
    expect(test.deleteReceipt).not.toHaveBeenCalled();
  });

  it('carries a validated provider rate-limit floor through the composed native receipt path', async () => {
    const times = [
      '2026-09-04T12:00:01.000Z',
      '2026-09-04T12:00:02.000Z',
      '2026-09-04T12:00:03.000Z',
    ];
    let clockIndex = 0;
    const test = createHarness(receiptPolicy(), {
      now: () => new Date(times[Math.min(clockIndex++, times.length - 1)] ?? Number.NaN),
    });
    const job = createDeterministicBalanceSyncJobEnvelope(
      {
        schemaVersion: 1,
        accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        networkId: ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
        requiredTier: 'PROVISIONAL',
        cause: 'SCHEDULED',
        attempt: 1,
        rescanFromPosition: null,
      },
      {
        id: 'balance-rate-limited-job-1',
        occurredAt: '2026-09-04T12:00:00.000Z',
        correlation: { correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      },
    );
    const message: ReceivedQueueMessage = {
      messageId: 'balance-rate-limited-message-1',
      receiptHandle: 'balance-rate-limited-receipt-1',
      body: JSON.stringify(job),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    test.receive.mockResolvedValueOnce([message]);
    (test.checkpoints.load as jest.Mock).mockResolvedValue(null);
    jest.spyOn(test.composition.indexer, 'readCurrent').mockRejectedValue(
      new BalanceSyncIndexerFailure('RATE_LIMITED', {
        retryAfterSeconds: 30,
      }),
    );

    const result = await test.composition.queueWorker.processOne((candidate) =>
      test.composition.dispatcher.dispatch(candidate, TEST_EXECUTION.context),
    );

    expect(result).toMatchObject({
      status: 'retry-scheduled',
      errorCode: 'JOB_HANDLER_FAILED',
      receiveCount: 1,
      retryDelaySeconds: 30,
    });
    expect(test.changeVisibility).toHaveBeenCalledWith(message, 30, expect.any(AbortSignal));
    expect(test.checkpoints.preserveLastGoodAndMarkStale).toHaveBeenCalledTimes(1);
    expect(test.deleteReceipt).not.toHaveBeenCalled();
  });

  it('settles an accepted hung RPC on shutdown and retains the source receipt', async () => {
    const test = createHarness();
    const job = createDeterministicBalanceSyncJobEnvelope(
      {
        schemaVersion: 1,
        accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        networkId: ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
        requiredTier: 'PROVISIONAL',
        cause: 'SCHEDULED',
        attempt: 1,
        rescanFromPosition: null,
      },
      {
        id: 'balance-hung-rpc-job-1',
        occurredAt: '2026-09-04T11:59:59.000Z',
        correlation: { correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      },
    );
    const message: ReceivedQueueMessage = {
      messageId: 'balance-hung-rpc-message-1',
      receiptHandle: 'balance-hung-rpc-receipt-1',
      body: JSON.stringify(job),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    test.receive.mockResolvedValueOnce([message]);
    (test.checkpoints.load as jest.Mock).mockResolvedValue(null);
    let markTransportStarted: (() => void) | undefined;
    const transportStarted = new Promise<void>((resolve) => {
      markTransportStarted = resolve;
    });
    let receivedSignal: AbortSignal | undefined;
    test.ethereumExchange.mockImplementation(
      async (_request: unknown, signal: AbortSignal): Promise<unknown> =>
        new Promise((_resolve, reject) => {
          receivedSignal = signal;
          markTransportStarted?.();
          signal.addEventListener('abort', () => reject(new Error('raw transport abort')), {
            once: true,
          });
        }),
    );
    const controller = new AbortController();

    const running = test.composition.consumer.run(controller.signal);
    await transportStarted;
    controller.abort('raw lifecycle reason');
    await expect(running).resolves.toBeUndefined();

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal).not.toBe(controller.signal);
    expect(test.changeVisibility).toHaveBeenCalledWith(
      message,
      BALANCE_SYNC_POLICY.retryBaseDelaySeconds,
      expect.any(AbortSignal),
    );
    expect(test.checkpoints.preserveLastGoodAndMarkStale).toHaveBeenCalledTimes(1);
    expect(test.deleteReceipt).not.toHaveBeenCalled();
  });

  it('dispatches an exact launch-network job only through the composed orchestrator', async () => {
    const test = createHarness();
    const process = jest.spyOn(test.composition.orchestrator, 'process').mockResolvedValue({
      status: 'DEAD_LETTERED',
      jobId: 'balance-job-1',
      failureCode: 'PERMANENT_PROVIDER_FAILURE',
      reason: 'NON_RETRYABLE_FAILURE',
    });
    const job = createDeterministicBalanceSyncJobEnvelope(
      {
        schemaVersion: 1,
        accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        networkId: ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
        requiredTier: 'PROVISIONAL',
        cause: 'SCHEDULED',
        attempt: 1,
        rescanFromPosition: null,
      },
      {
        id: 'balance-job-1',
        occurredAt: '2026-09-04T12:00:00.000Z',
        correlation: { correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      },
    );

    await test.composition.dispatcher.dispatch(job, TEST_EXECUTION.context);

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(job, TEST_EXECUTION.context);
  });
});
