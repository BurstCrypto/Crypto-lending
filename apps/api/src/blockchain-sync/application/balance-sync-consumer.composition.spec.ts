import type { InfrastructureConfig } from '../../infrastructure/config/infrastructure.config';
import { applicationObservability } from '../../infrastructure/observability';
import type { SqsService } from '../../infrastructure/sqs/sqs.service';
import { createDeterministicBalanceSyncJobEnvelope } from '../domain/balance-sync';
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

function infrastructureConfig(): InfrastructureConfig {
  return {
    workload: 'worker',
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
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs',
      deadLetterQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs-dlq',
      balanceQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
      balanceDeadLetterQueueUrl:
        'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync-dlq',
      requestTimeoutMs: 1_000,
      sdkMaxAttempts: 1,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 1,
      retryMaxDelaySeconds: 60,
    },
  };
}

function createHarness(): Readonly<{
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
  const clock: BalanceSyncClockPort = { now: () => new Date('2026-09-04T12:00:00.000Z') };
  const metrics: BalanceSyncMetricsPort = { record: jest.fn(), alert: jest.fn() };
  const receive = jest.fn().mockResolvedValue([]);
  const sqs = { receive } as unknown as SqsService;
  const composition = createBalanceSyncConsumerComposition({
    sqs,
    infrastructureConfig: infrastructureConfig(),
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
  };
}

describe('createBalanceSyncConsumerComposition', () => {
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
