import {
  assertBalanceConsumerSqsReceiptRedrivePolicy,
  type BalanceConsumerInfrastructureConfig,
} from '../../infrastructure/config/infrastructure.config';
import type { ObservabilityPort } from '../../infrastructure/observability';
import { BalanceSyncJobDispatcher } from '../../infrastructure/sqs/reviewed-job-dispatcher';
import { SqsJobWorker } from '../../infrastructure/sqs/sqs-job.worker';
import {
  PinnedSqsQueueReceiptAdapter,
  type SqsQueueReceiptTransport,
} from '../../infrastructure/sqs/sqs-queue-receipt.port';
import { BALANCE_SYNC_POLICY } from '../domain/balance-sync';
import { EthereumMainnetBalanceIndexerAdapter } from '../infrastructure/rpc/ethereum-mainnet-balance-indexer.adapter';
import type { BalanceJsonRpcTransport } from '../infrastructure/rpc/balance-json-rpc';
import { SolanaMainnetBalanceIndexerAdapter } from '../infrastructure/rpc/solana-mainnet-balance-indexer.adapter';
import { BalanceSyncOrchestrator } from './balance-sync-orchestrator';
import {
  BalanceSyncConsumerService,
  DEFAULT_BALANCE_SYNC_CONSUMER_POLICY,
  type BalanceSyncConsumerPolicy,
  type BalanceSyncConsumerWait,
} from './balance-sync-consumer.service';
import { FailClosedBalanceSyncJobPort } from './fail-closed-balance-sync-job.port';
import { MainnetBalanceIndexerRouter } from './mainnet-balance-indexer.router';
import type {
  BalanceSyncCheckpointPort,
  BalanceSyncClockPort,
  BalanceSyncMetricsPort,
  BalanceSyncWalletAddressResolverPort,
} from './ports/balance-sync.ports';

export interface BalanceSyncConsumerCompositionDependencies {
  readonly sqs: SqsQueueReceiptTransport;
  readonly infrastructureConfig: BalanceConsumerInfrastructureConfig;
  readonly observability: ObservabilityPort;
  readonly ethereumTransport: BalanceJsonRpcTransport;
  readonly solanaTransport: BalanceJsonRpcTransport;
  readonly walletAddressResolver: BalanceSyncWalletAddressResolverPort;
  readonly checkpoints: BalanceSyncCheckpointPort;
  readonly clock: BalanceSyncClockPort;
  readonly metrics: BalanceSyncMetricsPort;
  readonly policy?: BalanceSyncConsumerPolicy;
  readonly wait?: BalanceSyncConsumerWait;
}

export interface BalanceSyncConsumerComposition {
  readonly ethereumIndexer: EthereumMainnetBalanceIndexerAdapter;
  readonly solanaIndexer: SolanaMainnetBalanceIndexerAdapter;
  readonly indexer: MainnetBalanceIndexerRouter;
  readonly jobDisposition: FailClosedBalanceSyncJobPort;
  readonly orchestrator: BalanceSyncOrchestrator;
  readonly dispatcher: BalanceSyncJobDispatcher;
  readonly queueWorker: SqsJobWorker;
  readonly consumer: BalanceSyncConsumerService;
}

/**
 * Inert object-graph factory for a future dedicated process. It deliberately
 * fixes queue selection to `balance`. Failed application dispositions retain
 * the source receipt, so native SQS visibility/redrive remains the only retry
 * and DLQ authority. Nothing here is registered with Nest or starts the
 * consumer.
 */
export function createBalanceSyncConsumerComposition(
  dependencies: BalanceSyncConsumerCompositionDependencies,
): Readonly<BalanceSyncConsumerComposition> {
  if (dependencies.infrastructureConfig.workload !== 'balance-consumer') {
    throw new Error('Balance sync consumer composition requires the balance-consumer workload');
  }
  assertBalanceConsumerSqsReceiptRedrivePolicy(dependencies.infrastructureConfig.sqs);

  const ethereumIndexer = new EthereumMainnetBalanceIndexerAdapter(
    dependencies.ethereumTransport,
    dependencies.walletAddressResolver,
    dependencies.clock,
  );
  const solanaIndexer = new SolanaMainnetBalanceIndexerAdapter(
    dependencies.solanaTransport,
    dependencies.walletAddressResolver,
    dependencies.clock,
  );
  const indexer = new MainnetBalanceIndexerRouter(ethereumIndexer, solanaIndexer);
  const jobDisposition = new FailClosedBalanceSyncJobPort();
  const orchestrator = new BalanceSyncOrchestrator(
    jobDisposition,
    dependencies.checkpoints,
    indexer,
    dependencies.clock,
    dependencies.metrics,
  );
  const dispatcher = new BalanceSyncJobDispatcher(async (job) => {
    await orchestrator.process(job);
  });
  const balanceQueueReceipt = new PinnedSqsQueueReceiptAdapter(
    dependencies.sqs,
    dependencies.infrastructureConfig.sqs.balanceQueueUrl,
  );
  const queueWorker = new SqsJobWorker(
    balanceQueueReceipt,
    Object.freeze({
      maxReceiveCount: BALANCE_SYNC_POLICY.maxAttempts,
      visibilityTimeoutSeconds: dependencies.infrastructureConfig.sqs.visibilityTimeoutSeconds,
      retryBaseDelaySeconds: BALANCE_SYNC_POLICY.retryBaseDelaySeconds,
      retryMaxDelaySeconds: BALANCE_SYNC_POLICY.retryMaximumDelaySeconds,
    }),
    dependencies.observability,
    'balance',
  );
  const consumer = new BalanceSyncConsumerService(
    queueWorker,
    dispatcher,
    dependencies.policy ?? DEFAULT_BALANCE_SYNC_CONSUMER_POLICY,
    dependencies.wait,
  );

  return Object.freeze({
    ethereumIndexer,
    solanaIndexer,
    indexer,
    jobDisposition,
    orchestrator,
    dispatcher,
    queueWorker,
    consumer,
  });
}
