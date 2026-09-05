import { performance } from 'node:perf_hooks';

import type { BalanceConsumerInfrastructureConfig } from '../../infrastructure/config/infrastructure.config';
import { applicationObservability } from '../../infrastructure/observability';
import type { SqsQueueReceiptTransport } from '../../infrastructure/sqs/sqs-queue-receipt.port';
import type { JobProcessingResult, ReceivedQueueMessage } from '../../infrastructure/sqs/sqs.types';
import {
  BALANCE_SYNC_POLICY,
  BalanceSyncIndexerFailure,
  createDeterministicBalanceSyncJobEnvelope,
} from '../domain/balance-sync';
import type { BalanceJsonRpcTransport } from '../infrastructure/rpc/balance-json-rpc';
import { EthereumMainnetBalanceIndexerAdapter } from '../infrastructure/rpc/ethereum-mainnet-balance-indexer.adapter';
import { SolanaMainnetBalanceIndexerAdapter } from '../infrastructure/rpc/solana-mainnet-balance-indexer.adapter';
import { createBalanceSyncConsumerComposition } from './balance-sync-consumer.composition';
import { BalanceSyncConsumerService } from './balance-sync-consumer.service';
import { FailClosedBalanceSyncJobPort } from './fail-closed-balance-sync-job.port';
import {
  ETHEREUM_MAINNET_BALANCE_NETWORK_ID,
  MainnetBalanceIndexerRouter,
  SOLANA_MAINNET_BALANCE_NETWORK_ID,
} from './mainnet-balance-indexer.router';
import type {
  BalanceIndexerReadRequest,
  BalanceSyncCheckpointPort,
  BalanceSyncClockPort,
  BalanceSyncMetricsPort,
  BalanceSyncWalletAddressResolverPort,
} from './ports/balance-sync.ports';

function infrastructureConfig(
  workload: BalanceConsumerInfrastructureConfig['workload'] = 'balance-consumer',
): BalanceConsumerInfrastructureConfig {
  return {
    workload,
    database: {
      connectionString: 'postgresql://unused',
      connectionTimeoutMs: 100,
      idleTimeoutMs: 100,
      lockTimeoutMs: 100,
      maxLifetimeSeconds: 100,
      poolMax: 1,
      statementTimeoutMs: 100,
      ssl: false,
    },
    sqs: {
      region: 'us-east-1',
      balanceQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
      balanceDeadLetterQueueUrl:
        'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync-dlq',
      requestTimeoutMs: 1_000,
      sdkMaxAttempts: 1,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 5,
      retryMaxDelaySeconds: 60,
    },
  };
}

function createHarness(
  configuredInfrastructure: BalanceConsumerInfrastructureConfig = infrastructureConfig(),
  configuredClock: BalanceSyncClockPort = {
    now: () => new Date('2026-09-04T12:00:00.000Z'),
  },
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
  receive: jest.Mock;
  deleteReceipt: jest.Mock;
  changeVisibility: jest.Mock;
  sendMessage: jest.Mock;
  directDeadLetter: jest.Mock;
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
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  const directDeadLetter = jest.fn().mockResolvedValue(undefined);
  const sqs = {
    receive,
    delete: deleteReceipt,
    changeVisibility,
    parseEnvelope: (body: string) => JSON.parse(body) as unknown,
    sendMessage,
    directDeadLetter,
  } as unknown as SqsQueueReceiptTransport;
  const composition = createBalanceSyncConsumerComposition({
    sqs,
    infrastructureConfig: configuredInfrastructure,
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
    receive,
    deleteReceipt,
    changeVisibility,
    sendMessage,
    directDeadLetter,
  };
}

describe('createBalanceSyncConsumerComposition', () => {
  it('rejects a forged non-consumer workload before constructing the dormant consumer graph', () => {
    const ethereumExchange = jest.fn();
    const solanaExchange = jest.fn();
    const receive = jest.fn();

    expect(() =>
      createBalanceSyncConsumerComposition({
        sqs: { receive } as unknown as SqsQueueReceiptTransport,
        infrastructureConfig: {
          ...infrastructureConfig(),
          workload: 'worker',
        } as unknown as BalanceConsumerInfrastructureConfig,
        observability: applicationObservability,
        ethereumTransport: { exchange: ethereumExchange },
        solanaTransport: { exchange: solanaExchange },
        walletAddressResolver: { resolveActiveAddress: jest.fn() },
        checkpoints: {
          load: jest.fn(),
          upsertCurrent: jest.fn(),
          replaceProvisionalAfterReorg: jest.fn(),
          preserveLastGoodAndMarkStale: jest.fn(),
        },
        clock: { now: () => new Date('2026-09-04T12:00:00.000Z') },
        metrics: { record: jest.fn(), alert: jest.fn() },
      }),
    ).toThrow('Balance sync consumer composition requires the balance-consumer workload');
    expect(receive).not.toHaveBeenCalled();
    expect(ethereumExchange).not.toHaveBeenCalled();
    expect(solanaExchange).not.toHaveBeenCalled();
  });

  it.each([
    ['maxReceiveCount', 2],
    ['retryBaseDelaySeconds', 1],
    ['retryMaxDelaySeconds', 59],
  ] as const)('rejects forged balance receipt policy field %s', (field, value) => {
    const configuredInfrastructure = infrastructureConfig();

    expect(() =>
      createHarness({
        ...configuredInfrastructure,
        sqs: { ...configuredInfrastructure.sqs, [field]: value },
      }),
    ).toThrow('Balance-consumer SQS receipt redrive policy must exactly match BALANCE_SYNC_POLICY');
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
    const test = createHarness();
    const ethereumRead = jest
      .spyOn(test.composition.ethereumIndexer, 'readCurrent')
      .mockResolvedValue('ethereum');
    const solanaRead = jest
      .spyOn(test.composition.solanaIndexer, 'readCurrent')
      .mockResolvedValue('solana');
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
      test.composition.indexer.readCurrent(request(ETHEREUM_MAINNET_BALANCE_NETWORK_ID)),
    ).resolves.toBe('ethereum');
    await expect(
      test.composition.indexer.readCurrent(request(SOLANA_MAINNET_BALANCE_NETWORK_ID)),
    ).resolves.toBe('solana');

    expect(ethereumRead).toHaveBeenCalledTimes(1);
    expect(solanaRead).toHaveBeenCalledTimes(1);
    expect(test.ethereumExchange).not.toHaveBeenCalled();
    expect(test.solanaExchange).not.toHaveBeenCalled();
  });

  it('binds SqsJobWorker to only the physical balance queue', async () => {
    const test = createHarness();

    await expect(test.composition.queueWorker.processOne(async () => undefined)).resolves.toEqual({
      status: 'idle',
    });

    expect(test.receive).toHaveBeenCalledTimes(1);
    expect(test.receive).toHaveBeenCalledWith(
      'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
    );
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
      test.changeVisibility.mock.calls.map(([message, delaySeconds, queueUrl]) => ({
        messageId: (message as ReceivedQueueMessage).messageId,
        delaySeconds,
        queueUrl,
      })),
    ).toEqual([
      {
        messageId: 'balance-message-1',
        delaySeconds: 5,
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
      },
      {
        messageId: 'balance-message-2',
        delaySeconds: 10,
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
      },
      {
        messageId: 'balance-message-3',
        delaySeconds: 0,
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
      },
    ]);
    expect(handler).toHaveBeenCalledTimes(BALANCE_SYNC_POLICY.maxAttempts);
    expect(test.deleteReceipt).not.toHaveBeenCalled();
    expect(test.sendMessage).not.toHaveBeenCalled();
    expect(test.directDeadLetter).not.toHaveBeenCalled();
  });

  it('carries a validated provider rate-limit floor through the composed native receipt path', async () => {
    const times = [
      '2026-09-04T12:00:01.000Z',
      '2026-09-04T12:00:02.000Z',
      '2026-09-04T12:00:03.000Z',
    ];
    let clockIndex = 0;
    const test = createHarness(infrastructureConfig(), {
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
      test.composition.dispatcher.dispatch(candidate),
    );

    expect(result).toMatchObject({
      status: 'retry-scheduled',
      errorCode: 'JOB_HANDLER_FAILED',
      receiveCount: 1,
      retryDelaySeconds: 30,
    });
    expect(test.changeVisibility).toHaveBeenCalledWith(
      message,
      30,
      infrastructureConfig().sqs.balanceQueueUrl,
      expect.any(AbortSignal),
    );
    expect(test.checkpoints.preserveLastGoodAndMarkStale).toHaveBeenCalledTimes(1);
    expect(test.deleteReceipt).not.toHaveBeenCalled();
    expect(test.sendMessage).not.toHaveBeenCalled();
    expect(test.directDeadLetter).not.toHaveBeenCalled();
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

    await test.composition.dispatcher.dispatch(job);

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(job);
  });
});
