import type { ObservabilityPort } from '../../infrastructure/observability';
import type { PinnedSqsQueueReceiptPort } from '../../infrastructure/sqs/sqs-queue-receipt.port';
import type {
  BalanceConsumerInfrastructureConfig,
  DatabaseInfrastructureConfig,
} from '../../infrastructure/config/infrastructure.config';
import { activeWalletRegistrationKey } from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import { BALANCE_SYNC_POLICY } from '../domain/balance-sync';
import type { BalanceJsonRpcTransport } from '../infrastructure/rpc/balance-json-rpc';
import type { EnabledBalanceConsumerConfig } from '../infrastructure/config/balance-consumer.config';
import {
  createDormantBalanceConsumerPersistenceResource,
  type BalanceConsumerPersistenceResource,
} from '../infrastructure/postgres/balance-consumer-persistence.resource';
import {
  createDormantBalanceConsumerSqsReceiptResource,
  type BalanceConsumerSqsReceiptResource,
} from '../infrastructure/sqs/balance-consumer-sqs-receipt.resource';
import { createBalanceSyncConsumerComposition } from './balance-sync-consumer.composition';
import type {
  BalanceSyncCheckpointPort,
  BalanceSyncClockPort,
  BalanceSyncMetricsPort,
  BalanceSyncWalletAddressResolverPort,
} from './ports/balance-sync.ports';

const DEPENDENCY_KEYS = Object.freeze([
  'infrastructureConfig',
  'balanceConsumerConfig',
  'observability',
  'ethereumTransport',
  'solanaTransport',
  'clock',
  'metrics',
] as const);
const INFRASTRUCTURE_KEYS = Object.freeze(['workload', 'database', 'sqs'] as const);
const DATABASE_REQUIRED_KEYS = Object.freeze([
  'connectionString',
  'connectionTimeoutMs',
  'idleTimeoutMs',
  'lockTimeoutMs',
  'maxLifetimeSeconds',
  'poolMax',
  'statementTimeoutMs',
  'ssl',
  'sessionRole',
] as const);
const DATABASE_SSL_REQUIRED_KEYS = Object.freeze(['rejectUnauthorized'] as const);
const DATABASE_SSL_OPTIONAL_KEYS = Object.freeze(['ca'] as const);
const SQS_REQUIRED_KEYS = Object.freeze([
  'region',
  'requestTimeoutMs',
  'sdkMaxAttempts',
  'maxReceiveCount',
  'visibilityTimeoutSeconds',
  'retryBaseDelaySeconds',
  'retryMaxDelaySeconds',
  'balanceQueueUrl',
  'balanceDeadLetterQueueUrl',
] as const);
const SQS_OPTIONAL_KEYS = Object.freeze(['endpoint', 'credentialRelativeUri'] as const);
const BALANCE_SYNC_CONSUMER_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;

export interface DormantBalanceSyncConsumerResourceDependencies {
  readonly infrastructureConfig: BalanceConsumerInfrastructureConfig;
  readonly balanceConsumerConfig: EnabledBalanceConsumerConfig;
  readonly observability: ObservabilityPort;
  readonly ethereumTransport: BalanceJsonRpcTransport;
  readonly solanaTransport: BalanceJsonRpcTransport;
  readonly clock: BalanceSyncClockPort;
  readonly metrics: BalanceSyncMetricsPort;
}

export interface DormantBalanceSyncConsumerResource {
  readonly run: (signal: AbortSignal) => Promise<void>;
  readonly close: () => Promise<void>;
}

class BalanceSyncConsumerResourceConfigurationError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_CONFIGURATION_INVALID' as const;

  constructor() {
    super('Balance sync consumer resource configuration is invalid');
    this.name = 'BalanceSyncConsumerResourceConfigurationError';
  }
}

class BalanceSyncConsumerResourceConstructionError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_CONSTRUCTION_FAILED' as const;

  constructor() {
    super('Balance sync consumer resource construction failed');
    this.name = 'BalanceSyncConsumerResourceConstructionError';
  }
}

class BalanceSyncConsumerResourceRunError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_RUN_FAILED' as const;

  constructor() {
    super('Balance sync consumer resource run failed');
    this.name = 'BalanceSyncConsumerResourceRunError';
  }
}

class BalanceSyncConsumerResourceAlreadyStartedError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_ALREADY_STARTED' as const;

  constructor() {
    super('Balance sync consumer resource is already started');
    this.name = 'BalanceSyncConsumerResourceAlreadyStartedError';
  }
}

class BalanceSyncConsumerResourceSignalError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_SIGNAL_INVALID' as const;

  constructor() {
    super('Balance sync consumer resource signal is invalid');
    this.name = 'BalanceSyncConsumerResourceSignalError';
  }
}

class BalanceSyncConsumerResourceClosedError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_CLOSED' as const;

  constructor() {
    super('Balance sync consumer resource is closed');
    this.name = 'BalanceSyncConsumerResourceClosedError';
  }
}

class BalanceSyncConsumerResourceCloseError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_CLOSE_FAILED' as const;

  constructor() {
    super('Balance sync consumer resource close failed');
    this.name = 'BalanceSyncConsumerResourceCloseError';
  }
}

class BalanceSyncConsumerResourceShutdownDrainTimeoutError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_SHUTDOWN_DRAIN_TIMEOUT' as const;

  constructor() {
    super('Balance sync consumer resource shutdown drain timed out');
    this.name = 'BalanceSyncConsumerResourceShutdownDrainTimeoutError';
  }
}

function invalidConfiguration(): never {
  throw new BalanceSyncConsumerResourceConfigurationError();
}

function exactDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidConfiguration();
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return invalidConfiguration();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const keys = Reflect.ownKeys(descriptors);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    keys.length < requiredKeys.length ||
    keys.length > allowed.size ||
    keys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
    requiredKeys.some((key) => !keys.includes(key))
  ) {
    return invalidConfiguration();
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalidConfiguration();
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotDatabase(value: unknown): Readonly<DatabaseInfrastructureConfig> {
  const record = exactDataRecord(value, DATABASE_REQUIRED_KEYS);
  if (record.sessionRole !== 'crypto_balance_consumer_runtime') return invalidConfiguration();
  let ssl: DatabaseInfrastructureConfig['ssl'];
  if (record.ssl === false) {
    ssl = false;
  } else {
    const sslRecord = exactDataRecord(
      record.ssl,
      DATABASE_SSL_REQUIRED_KEYS,
      DATABASE_SSL_OPTIONAL_KEYS,
    );
    ssl = Object.freeze({
      rejectUnauthorized: sslRecord.rejectUnauthorized as boolean,
      ...('ca' in sslRecord ? { ca: sslRecord.ca as string } : {}),
    });
  }
  return Object.freeze({
    connectionString: record.connectionString as string,
    connectionTimeoutMs: record.connectionTimeoutMs as number,
    idleTimeoutMs: record.idleTimeoutMs as number,
    lockTimeoutMs: record.lockTimeoutMs as number,
    maxLifetimeSeconds: record.maxLifetimeSeconds as number,
    poolMax: record.poolMax as number,
    statementTimeoutMs: record.statementTimeoutMs as number,
    ssl,
    sessionRole: 'crypto_balance_consumer_runtime',
  });
}

function snapshotInfrastructure(value: unknown): Readonly<BalanceConsumerInfrastructureConfig> {
  try {
    const infrastructure = exactDataRecord(value, INFRASTRUCTURE_KEYS);
    if (infrastructure.workload !== 'balance-consumer') return invalidConfiguration();
    const sqs = exactDataRecord(infrastructure.sqs, SQS_REQUIRED_KEYS, SQS_OPTIONAL_KEYS);
    if (
      'endpoint' in sqs === 'credentialRelativeUri' in sqs ||
      sqs.maxReceiveCount !== BALANCE_SYNC_POLICY.maxAttempts ||
      sqs.retryBaseDelaySeconds !== BALANCE_SYNC_POLICY.retryBaseDelaySeconds ||
      sqs.retryMaxDelaySeconds !== BALANCE_SYNC_POLICY.retryMaximumDelaySeconds
    ) {
      return invalidConfiguration();
    }
    return Object.freeze({
      workload: 'balance-consumer',
      database: snapshotDatabase(infrastructure.database),
      sqs: Object.freeze({
        region: sqs.region as string,
        ...('endpoint' in sqs ? { endpoint: sqs.endpoint as string } : {}),
        ...('credentialRelativeUri' in sqs
          ? { credentialRelativeUri: sqs.credentialRelativeUri as string }
          : {}),
        requestTimeoutMs: sqs.requestTimeoutMs as number,
        sdkMaxAttempts: sqs.sdkMaxAttempts as number,
        maxReceiveCount: sqs.maxReceiveCount as number,
        visibilityTimeoutSeconds: sqs.visibilityTimeoutSeconds as number,
        retryBaseDelaySeconds: sqs.retryBaseDelaySeconds as number,
        retryMaxDelaySeconds: sqs.retryMaxDelaySeconds as number,
        balanceQueueUrl: sqs.balanceQueueUrl as string,
        balanceDeadLetterQueueUrl: sqs.balanceDeadLetterQueueUrl as string,
      }),
    });
  } catch {
    return invalidConfiguration();
  }
}

interface ReviewedDependencies {
  readonly infrastructure: Readonly<BalanceConsumerInfrastructureConfig>;
  readonly balanceConsumer: EnabledBalanceConsumerConfig;
  readonly observability: ObservabilityPort;
  readonly ethereumTransport: BalanceJsonRpcTransport;
  readonly solanaTransport: BalanceJsonRpcTransport;
  readonly clock: BalanceSyncClockPort;
  readonly metrics: BalanceSyncMetricsPort;
}

function snapshotBalanceConsumerConfig(value: unknown): EnabledBalanceConsumerConfig {
  const record = exactDataRecord(value, ['mode', 'walletMetadataSealKeys']);
  if (record.mode !== 'enabled') return invalidConfiguration();
  const walletMetadataSealKeys = record.walletMetadataSealKeys as
    EnabledBalanceConsumerConfig['walletMetadataSealKeys'] | undefined;
  try {
    if (
      walletMetadataSealKeys === undefined ||
      activeWalletRegistrationKey(walletMetadataSealKeys).purpose !== 'metadata-seal'
    ) {
      return invalidConfiguration();
    }
  } catch {
    return invalidConfiguration();
  }
  return Object.freeze({ mode: 'enabled', walletMetadataSealKeys });
}

function isOpaqueCapability(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function reviewedDependencies(value: unknown): ReviewedDependencies {
  try {
    const dependencies = exactDataRecord(value, DEPENDENCY_KEYS);
    if (
      !isOpaqueCapability(dependencies.observability) ||
      !isOpaqueCapability(dependencies.ethereumTransport) ||
      !isOpaqueCapability(dependencies.solanaTransport) ||
      !isOpaqueCapability(dependencies.clock) ||
      !isOpaqueCapability(dependencies.metrics)
    ) {
      return invalidConfiguration();
    }
    return Object.freeze({
      infrastructure: snapshotInfrastructure(dependencies.infrastructureConfig),
      balanceConsumer: snapshotBalanceConsumerConfig(dependencies.balanceConsumerConfig),
      observability: dependencies.observability as ObservabilityPort,
      ethereumTransport: dependencies.ethereumTransport as BalanceJsonRpcTransport,
      solanaTransport: dependencies.solanaTransport as BalanceJsonRpcTransport,
      clock: dependencies.clock as BalanceSyncClockPort,
      metrics: dependencies.metrics as BalanceSyncMetricsPort,
    });
  } catch {
    return invalidConfiguration();
  }
}

function ownedFrozenNullPrototypeRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BalanceSyncConsumerResourceConstructionError();
  }
  if (Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) {
    throw new BalanceSyncConsumerResourceConstructionError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    throw new BalanceSyncConsumerResourceConstructionError();
  }
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      descriptor.configurable !== false ||
      descriptor.writable !== false
    ) {
      throw new BalanceSyncConsumerResourceConstructionError();
    }
    record[key] = descriptor.value;
  }
  return record;
}

interface ReviewedPersistenceResource {
  readonly checkpoints: Readonly<BalanceSyncCheckpointPort>;
  readonly walletAddressResolver: Readonly<BalanceSyncWalletAddressResolverPort>;
  readonly close: () => Promise<void>;
}

function reviewedPersistenceResource(
  value: Readonly<BalanceConsumerPersistenceResource>,
  retainClose: (close: () => Promise<void>) => void,
): ReviewedPersistenceResource {
  const resource = ownedFrozenNullPrototypeRecord(value, [
    'checkpoints',
    'walletAddressResolver',
    'close',
  ]);
  if (typeof resource.close !== 'function') {
    throw new BalanceSyncConsumerResourceConstructionError();
  }
  const close = resource.close as () => Promise<void>;
  retainClose(close);
  const checkpoints = ownedFrozenNullPrototypeRecord(resource.checkpoints, [
    'load',
    'upsertCurrent',
    'replaceProvisionalAfterReorg',
    'preserveLastGoodAndMarkStale',
  ]);
  const walletAddressResolver = ownedFrozenNullPrototypeRecord(resource.walletAddressResolver, [
    'resolveActiveAddress',
  ]);
  if (
    Object.values(checkpoints).some((member) => typeof member !== 'function') ||
    typeof walletAddressResolver.resolveActiveAddress !== 'function'
  ) {
    throw new BalanceSyncConsumerResourceConstructionError();
  }
  return Object.freeze({
    checkpoints: resource.checkpoints as Readonly<BalanceSyncCheckpointPort>,
    walletAddressResolver:
      resource.walletAddressResolver as Readonly<BalanceSyncWalletAddressResolverPort>,
    close,
  });
}

interface ReviewedSqsReceiptResource {
  readonly receipt: Readonly<PinnedSqsQueueReceiptPort>;
  readonly close: () => Promise<void>;
}

function reviewedSqsReceiptResource(
  value: Readonly<BalanceConsumerSqsReceiptResource>,
  retainClose: (close: () => Promise<void>) => void,
): ReviewedSqsReceiptResource {
  const resource = ownedFrozenNullPrototypeRecord(value, ['receipt', 'close']);
  if (typeof resource.close !== 'function') {
    throw new BalanceSyncConsumerResourceConstructionError();
  }
  const close = resource.close as () => Promise<void>;
  retainClose(close);
  const receipt = ownedFrozenNullPrototypeRecord(resource.receipt, [
    'receive',
    'delete',
    'changeVisibility',
    'parseEnvelope',
  ]);
  if (Object.values(receipt).some((member) => typeof member !== 'function')) {
    throw new BalanceSyncConsumerResourceConstructionError();
  }
  return Object.freeze({ receipt: resource.receipt as Readonly<PinnedSqsQueueReceiptPort>, close });
}

interface ReviewedAbortSignal {
  readonly aborted: () => boolean;
  readonly addAbortListener: (listener: () => void) => void;
  readonly removeAbortListener: (listener: () => void) => void;
}

function reviewedAbortSignal(value: unknown): ReviewedAbortSignal {
  try {
    const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
    if (!abortedGetter) throw new BalanceSyncConsumerResourceSignalError();
    const aborted = (): boolean => abortedGetter.call(value) as boolean;
    aborted();
    return Object.freeze({
      aborted,
      addAbortListener: (listener: () => void): void => {
        EventTarget.prototype.addEventListener.call(value, 'abort', listener, { once: true });
      },
      removeAbortListener: (listener: () => void): void => {
        EventTarget.prototype.removeEventListener.call(value, 'abort', listener);
      },
    });
  } catch {
    throw new BalanceSyncConsumerResourceSignalError();
  }
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

async function attemptClose(close: (() => Promise<void>) | undefined): Promise<boolean> {
  if (close === undefined) return true;
  try {
    await Promise.resolve().then(close);
    return true;
  } catch {
    return false;
  }
}

/**
 * Owns the still-dormant balance-consumer capsules without registering a
 * runtime, starting a poll, opening a database connection, or issuing an SQS
 * request. A future gated runtime must explicitly invoke `run`.
 */
export async function createDormantBalanceSyncConsumerResource(
  dependencies: DormantBalanceSyncConsumerResourceDependencies,
): Promise<Readonly<DormantBalanceSyncConsumerResource>> {
  const reviewed = reviewedDependencies(dependencies);
  let persistenceClose: (() => Promise<void>) | undefined;
  let sqsClose: (() => Promise<void>) | undefined;

  try {
    const persistence = reviewedPersistenceResource(
      await createDormantBalanceConsumerPersistenceResource(
        reviewed.infrastructure,
        reviewed.balanceConsumer,
      ),
      (close) => {
        persistenceClose = close;
      },
    );
    const sqs = reviewedSqsReceiptResource(
      await createDormantBalanceConsumerSqsReceiptResource(reviewed.infrastructure),
      (close) => {
        sqsClose = close;
      },
    );
    const composition = createBalanceSyncConsumerComposition({
      sqs: sqs.receipt,
      receiptPolicy: Object.freeze({
        visibilityTimeoutSeconds: reviewed.infrastructure.sqs.visibilityTimeoutSeconds,
      }),
      observability: reviewed.observability,
      ethereumTransport: reviewed.ethereumTransport,
      solanaTransport: reviewed.solanaTransport,
      walletAddressResolver: persistence.walletAddressResolver,
      checkpoints: persistence.checkpoints,
      clock: reviewed.clock,
      metrics: reviewed.metrics,
    });
    const scheduleShutdownTimeout = globalThis.setTimeout.bind(globalThis);
    const clearShutdownTimeout = globalThis.clearTimeout.bind(globalThis);

    let closed = false;
    let started = false;
    let activeRun: Promise<void> | undefined;
    let activeRunController: AbortController | undefined;
    let closePromise: Promise<void> | undefined;

    const run = (signal: AbortSignal): Promise<void> => {
      if (closed) return Promise.reject(new BalanceSyncConsumerResourceClosedError());
      if (started) {
        return Promise.reject(new BalanceSyncConsumerResourceAlreadyStartedError());
      }

      let supplied: ReviewedAbortSignal;
      try {
        supplied = reviewedAbortSignal(signal);
      } catch {
        return Promise.reject(new BalanceSyncConsumerResourceSignalError());
      }
      const controller = new AbortController();
      let listening = false;
      const relayAbort = (): void => {
        controller.abort(new Error('Balance sync consumer run aborted'));
      };
      try {
        if (supplied.aborted()) {
          relayAbort();
        } else {
          supplied.addAbortListener(relayAbort);
          listening = true;
          if (supplied.aborted()) relayAbort();
        }
      } catch {
        if (listening) {
          try {
            supplied.removeAbortListener(relayAbort);
          } catch {
            // The fixed signal error below remains the only boundary detail.
          }
        }
        return Promise.reject(new BalanceSyncConsumerResourceSignalError());
      }
      started = true;

      let startRun: () => void = () => undefined;
      const startGate = new Promise<void>((resolve) => {
        startRun = resolve;
      });
      const operation = startGate
        .then(() => composition.consumer.run(controller.signal))
        .then(
          () => undefined,
          () => {
            throw new BalanceSyncConsumerResourceRunError();
          },
        )
        .finally(() => {
          if (listening) {
            try {
              supplied.removeAbortListener(relayAbort);
            } catch {
              // Listener cleanup cannot replace the fixed run outcome.
            }
          }
          if (activeRun === operation) {
            activeRun = undefined;
            activeRunController = undefined;
          }
        });
      activeRunController = controller;
      activeRun = operation;
      startRun();
      return operation;
    };

    const resourceSqsClose = sqs.close;
    const resourcePersistenceClose = persistence.close;
    const close = (): Promise<void> => {
      closed = true;
      if (closePromise !== undefined) return closePromise;
      const acceptedRun = activeRun;
      const acceptedRunController = activeRunController;
      let resolveClose!: () => void;
      let rejectClose!: (error: Error) => void;
      const publicClose = new Promise<void>((resolve, reject) => {
        resolveClose = resolve;
        rejectClose = reject;
      });
      closePromise = publicClose;

      let startCleanup: () => void = () => undefined;
      const cleanup = new Promise<void>((resolve) => {
        startCleanup = resolve;
      }).then(async () => {
        if (acceptedRun !== undefined) await Promise.allSettled([acceptedRun]);
        const sqsClosed = await attemptClose(resourceSqsClose);
        const persistenceClosed = await attemptClose(resourcePersistenceClose);
        if (!sqsClosed || !persistenceClosed) {
          throw new BalanceSyncConsumerResourceCloseError();
        }
      });
      let publicCloseSettled = false;
      let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;
      const clearWatchdog = (): void => {
        if (shutdownTimeout === undefined) return;
        try {
          clearShutdownTimeout(shutdownTimeout);
        } catch {
          // Cleanup settlement remains authoritative even if timer cleanup fails.
        }
      };
      try {
        shutdownTimeout = scheduleShutdownTimeout(() => {
          if (publicCloseSettled) return;
          publicCloseSettled = true;
          rejectClose(new BalanceSyncConsumerResourceShutdownDrainTimeoutError());
        }, BALANCE_SYNC_CONSUMER_SHUTDOWN_DRAIN_TIMEOUT_MS);
        try {
          shutdownTimeout.unref?.();
        } catch {
          // The watchdog still enforces the fixed deadline when unref is unavailable.
        }
      } catch {
        publicCloseSettled = true;
        rejectClose(new BalanceSyncConsumerResourceCloseError());
      }

      void cleanup.then(
        () => {
          clearWatchdog();
          if (publicCloseSettled) return;
          publicCloseSettled = true;
          resolveClose();
        },
        () => {
          clearWatchdog();
          if (publicCloseSettled) return;
          publicCloseSettled = true;
          rejectClose(new BalanceSyncConsumerResourceCloseError());
        },
      );
      try {
        acceptedRunController?.abort(new Error('Balance sync consumer resource closed'));
      } catch {
        // Cleanup still starts and reports only the fixed close outcome.
      } finally {
        startCleanup();
      }
      return publicClose;
    };

    return frozenNullPrototype<DormantBalanceSyncConsumerResource>({ run, close });
  } catch {
    await attemptClose(sqsClose);
    await attemptClose(persistenceClose);
    throw new BalanceSyncConsumerResourceConstructionError();
  }
}
