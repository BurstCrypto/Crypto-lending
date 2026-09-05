import type { ObservabilityPort } from '../../infrastructure/observability';
import { BalanceSyncJobDispatcher } from '../../infrastructure/sqs/reviewed-job-dispatcher';
import { SqsJobWorker } from '../../infrastructure/sqs/sqs-job.worker';
import type { PinnedSqsQueueReceiptPort } from '../../infrastructure/sqs/sqs-queue-receipt.port';
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

export interface BalanceSyncConsumerReceiptPolicy {
  readonly visibilityTimeoutSeconds: number;
}

export interface BalanceSyncConsumerCompositionDependencies {
  readonly sqs: Readonly<PinnedSqsQueueReceiptPort>;
  readonly receiptPolicy: BalanceSyncConsumerReceiptPolicy;
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

function snapshotReceiptPolicy(
  value: BalanceSyncConsumerReceiptPolicy,
): Readonly<BalanceSyncConsumerReceiptPolicy> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('invalid receipt policy');
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('invalid receipt policy');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 1 ||
      keys[0] !== 'visibilityTimeoutSeconds' ||
      !descriptors.visibilityTimeoutSeconds?.enumerable ||
      !('value' in descriptors.visibilityTimeoutSeconds)
    ) {
      throw new Error('invalid receipt policy');
    }
    const visibilityTimeoutSeconds = descriptors.visibilityTimeoutSeconds.value as unknown;
    if (
      !Number.isSafeInteger(visibilityTimeoutSeconds) ||
      (visibilityTimeoutSeconds as number) < 1 ||
      (visibilityTimeoutSeconds as number) > 43_200
    ) {
      throw new Error('invalid receipt policy');
    }
    return Object.freeze({ visibilityTimeoutSeconds: visibilityTimeoutSeconds as number });
  } catch {
    throw new Error('Balance sync consumer receipt policy is invalid');
  }
}

/**
 * Inert object-graph factory for a future dedicated process. It deliberately
 * binds worker behavior to the already-pinned `balance` receipt capability.
 * Failed application dispositions retain the source receipt, so native SQS
 * visibility/redrive remains the only retry and DLQ authority. Nothing here is
 * registered with Nest or starts the consumer.
 */
export function createBalanceSyncConsumerComposition(
  dependencies: BalanceSyncConsumerCompositionDependencies,
): Readonly<BalanceSyncConsumerComposition> {
  const receiptPolicy = snapshotReceiptPolicy(dependencies.receiptPolicy);

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
  const dispatcher = new BalanceSyncJobDispatcher(async (job, context) => {
    await orchestrator.process(job, context);
  });
  const queueWorker = new SqsJobWorker(
    dependencies.sqs,
    Object.freeze({
      maxReceiveCount: BALANCE_SYNC_POLICY.maxAttempts,
      visibilityTimeoutSeconds: receiptPolicy.visibilityTimeoutSeconds,
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
