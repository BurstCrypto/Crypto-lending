import type { Pool } from 'pg';

import type {
  DatabaseInfrastructureConfig,
  RuntimeInfrastructureConfig,
} from '../../../infrastructure/config/infrastructure.config';
import { BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS } from '../../../infrastructure/config/infrastructure.config';
import { PostgresService } from '../../../infrastructure/database/postgres.service';
import {
  createPostgresPool,
  type RuntimePostgresPoolConfig,
} from '../../../infrastructure/database/runtime-postgres-pool';
import {
  activeWalletRegistrationKey,
  type WalletRegistrationKeyRing,
} from '../../../wallets/infrastructure/crypto/wallet-registration-crypto';
import type {
  BalanceSyncCheckpointPort,
  BalanceSyncWalletAddressResolverPort,
} from '../../application/ports/balance-sync.ports';
import type {
  BalanceConsumerConfig,
  EnabledBalanceConsumerConfig,
} from '../config/balance-consumer.config';
import { PostgresBalanceSyncCheckpointRepository } from './postgres-balance-sync-checkpoint.repository';
import { PostgresBalanceSyncWalletAddressResolver } from './postgres-balance-sync-wallet-address.resolver';

const BALANCE_CONSUMER_SESSION_ROLE = 'crypto_balance_consumer_runtime' as const;
const DATABASE_KEYS = Object.freeze([
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

export interface BalanceConsumerPersistenceResource {
  readonly checkpoints: Readonly<BalanceSyncCheckpointPort>;
  readonly walletAddressResolver: Readonly<BalanceSyncWalletAddressResolverPort>;
  readonly close: () => Promise<void>;
}

interface ReviewedPersistenceConfiguration {
  readonly infrastructure: RuntimePostgresPoolConfig;
  readonly balanceConsumer: EnabledBalanceConsumerConfig;
}

class BalanceConsumerPersistenceConfigurationError extends Error {
  readonly code = 'BALANCE_CONSUMER_PERSISTENCE_CONFIGURATION_INVALID' as const;

  constructor() {
    super('Balance consumer persistence configuration is invalid');
    this.name = 'BalanceConsumerPersistenceConfigurationError';
  }
}

class BalanceConsumerPersistenceConstructionError extends Error {
  readonly code = 'BALANCE_CONSUMER_PERSISTENCE_CONSTRUCTION_FAILED' as const;

  constructor() {
    super('Balance consumer persistence construction failed');
    this.name = 'BalanceConsumerPersistenceConstructionError';
  }
}

class BalanceConsumerPersistenceCloseError extends Error {
  readonly code = 'BALANCE_CONSUMER_PERSISTENCE_CLOSE_FAILED' as const;

  constructor() {
    super('Balance consumer persistence close failed');
    this.name = 'BalanceConsumerPersistenceCloseError';
  }
}

class BalanceConsumerPersistenceClosedError extends Error {
  readonly code = 'BALANCE_CONSUMER_PERSISTENCE_CLOSED' as const;

  constructor() {
    super('Balance consumer persistence is closed');
    this.name = 'BalanceConsumerPersistenceClosedError';
  }
}

function invalidConfiguration(): never {
  throw new BalanceConsumerPersistenceConfigurationError();
}

function selectedDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalidConfiguration();
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return invalidConfiguration();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalidConfiguration();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return invalidConfiguration();
  }
}

function exactDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalidConfiguration();
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return invalidConfiguration();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
    if (
      keys.length < requiredKeys.length ||
      keys.length > allowedKeys.size ||
      keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key)) ||
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
  } catch {
    return invalidConfiguration();
  }
}

function boundedInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    return invalidConfiguration();
  }
  return value as number;
}

interface ReviewedConnectionString {
  readonly value: string;
  readonly loopback: boolean;
}

function connectionString(value: unknown): ReviewedConnectionString {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 16_384 ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    return invalidConfiguration();
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') ||
      parsed.toString() !== value ||
      value.includes('?') ||
      value.includes('#') ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      !parsed.hostname ||
      !/^[1-9][0-9]{0,4}$/u.test(parsed.port) ||
      Number(parsed.port) > 65_535 ||
      !/^crypto_balance_consumer_login_[a-z0-9]{1,32}$/u.test(
        decodeURIComponent(parsed.username),
      ) ||
      decodeURIComponent(parsed.password).length < 1 ||
      /[\0\r\n]/u.test(decodeURIComponent(parsed.password)) ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(decodeURIComponent(parsed.pathname))
    ) {
      return invalidConfiguration();
    }
    return Object.freeze({
      value,
      loopback:
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]',
    });
  } catch {
    return invalidConfiguration();
  }
}

function sslSnapshot(value: unknown, loopback: boolean): DatabaseInfrastructureConfig['ssl'] {
  if (value === false) {
    if (!loopback) return invalidConfiguration();
    return false;
  }
  const record = exactDataRecord(value, ['rejectUnauthorized', 'ca']);
  if (record.rejectUnauthorized !== true) return invalidConfiguration();
  if (
    typeof record.ca !== 'string' ||
    record.ca.length < 1 ||
    record.ca.length > 1_048_576 ||
    record.ca.includes('\0')
  ) {
    return invalidConfiguration();
  }
  return Object.freeze({
    rejectUnauthorized: true,
    ca: record.ca,
  });
}

function databaseSnapshot(value: unknown): Readonly<DatabaseInfrastructureConfig> {
  const record = exactDataRecord(value, DATABASE_KEYS);
  if (record.sessionRole !== BALANCE_CONSUMER_SESSION_ROLE) return invalidConfiguration();
  const reviewedConnectionString = connectionString(record.connectionString);
  return Object.freeze({
    connectionString: reviewedConnectionString.value,
    connectionTimeoutMs: boundedInteger(
      record.connectionTimeoutMs,
      BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS.connectionTimeoutMs,
    ),
    idleTimeoutMs: boundedInteger(record.idleTimeoutMs, 600_000),
    lockTimeoutMs: boundedInteger(
      record.lockTimeoutMs,
      BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS.lockTimeoutMs,
    ),
    maxLifetimeSeconds: boundedInteger(record.maxLifetimeSeconds, 86_400),
    poolMax: boundedInteger(record.poolMax, 100),
    statementTimeoutMs: boundedInteger(
      record.statementTimeoutMs,
      BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS.statementTimeoutMs,
    ),
    ssl: sslSnapshot(record.ssl, reviewedConnectionString.loopback),
    sessionRole: BALANCE_CONSUMER_SESSION_ROLE,
  });
}

function balanceConsumerSnapshot(value: unknown): EnabledBalanceConsumerConfig {
  const record = exactDataRecord(value, ['mode', 'walletMetadataSealKeys']);
  if (record.mode !== 'enabled') return invalidConfiguration();
  const ringRecord = exactDataRecord(record.walletMetadataSealKeys, [
    'purpose',
    'activeWriteVersion',
    'keys',
  ]);
  if (ringRecord.purpose !== 'metadata-seal') return invalidConfiguration();
  const ring = record.walletMetadataSealKeys as WalletRegistrationKeyRing<'metadata-seal'>;
  try {
    if (activeWalletRegistrationKey(ring).purpose !== 'metadata-seal') {
      return invalidConfiguration();
    }
  } catch {
    return invalidConfiguration();
  }
  return Object.freeze({
    mode: 'enabled',
    walletMetadataSealKeys: ring,
  });
}

function reviewedConfiguration(
  infrastructure: RuntimeInfrastructureConfig,
  balanceConsumer: BalanceConsumerConfig,
): ReviewedPersistenceConfiguration {
  const infrastructureRecord = selectedDataRecord(infrastructure, ['workload', 'database']);
  if (infrastructureRecord.workload !== 'balance-consumer') return invalidConfiguration();
  return Object.freeze({
    infrastructure: Object.freeze({
      workload: 'balance-consumer',
      database: databaseSnapshot(infrastructureRecord.database),
    }),
    balanceConsumer: balanceConsumerSnapshot(balanceConsumer),
  });
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function closePool(
  pool: Pool,
  failure: () => BalanceConsumerPersistenceConstructionError | BalanceConsumerPersistenceCloseError,
): Promise<void> {
  return Promise.resolve()
    .then(() => pool.end())
    .then(
      () => undefined,
      () => {
        throw failure();
      },
    );
}

/**
 * Builds a dormant persistence capsule without opening a connection, running a
 * query, checking health, or applying migrations. Only closure-backed port
 * facades escape; the pool, service, repositories, and configuration remain
 * private to this resource.
 */
export async function createDormantBalanceConsumerPersistenceResource(
  infrastructureConfig: RuntimeInfrastructureConfig,
  balanceConsumerConfig: BalanceConsumerConfig,
): Promise<Readonly<BalanceConsumerPersistenceResource>> {
  const reviewed = reviewedConfiguration(infrastructureConfig, balanceConsumerConfig);
  let pool: Pool | undefined;
  let postgres: PostgresService | undefined;

  try {
    pool = createPostgresPool(reviewed.infrastructure);
    postgres = new PostgresService(pool);
    const resourcePostgres = postgres;
    const checkpointRepository = new PostgresBalanceSyncCheckpointRepository(resourcePostgres);
    const walletAddressResolverRepository = new PostgresBalanceSyncWalletAddressResolver(
      resourcePostgres,
      reviewed.balanceConsumer,
    );

    let closed = false;
    const operationGates = new Set<Promise<void>>();
    const whileOpen = <Result>(operation: () => Promise<Result>): Promise<Result> => {
      if (closed) return Promise.reject(new BalanceConsumerPersistenceClosedError());
      let finishGate: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        finishGate = resolve;
      });
      operationGates.add(gate);
      const result = Promise.resolve().then(operation);
      void result.then(
        () => finishGate?.(),
        () => finishGate?.(),
      );
      void gate.then(
        () => operationGates.delete(gate),
        () => operationGates.delete(gate),
      );
      return result;
    };
    const drainOperations = async (): Promise<void> => {
      while (operationGates.size > 0) {
        await Promise.allSettled([...operationGates]);
      }
    };
    const checkpoints = frozenNullPrototype<BalanceSyncCheckpointPort>({
      load: (scope, context) => whileOpen(() => checkpointRepository.load(scope, context)),
      upsertCurrent: (input, context) =>
        whileOpen(() => checkpointRepository.upsertCurrent(input, context)),
      replaceProvisionalAfterReorg: (input, context) =>
        whileOpen(() => checkpointRepository.replaceProvisionalAfterReorg(input, context)),
      preserveLastGoodAndMarkStale: (input, context) =>
        whileOpen(() => checkpointRepository.preserveLastGoodAndMarkStale(input, context)),
    });
    const walletAddressResolver = frozenNullPrototype<BalanceSyncWalletAddressResolverPort>({
      resolveActiveAddress: (scope, context) =>
        whileOpen(() => walletAddressResolverRepository.resolveActiveAddress(scope, context)),
    });
    const resourcePool = pool;
    let closePromise: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closePromise !== undefined) return closePromise;
      closed = true;
      let finish: (() => void) | undefined;
      let fail: ((error: BalanceConsumerPersistenceCloseError) => void) | undefined;
      closePromise = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      let postgresDrain: Promise<void>;
      try {
        postgresDrain = resourcePostgres.closeCancellableQueries();
      } catch {
        postgresDrain = Promise.reject(new BalanceConsumerPersistenceCloseError());
      }
      void Promise.allSettled([postgresDrain, drainOperations()])
        .then(async (drainSettlements) => {
          const [poolSettlement] = await Promise.allSettled([
            closePool(resourcePool, () => new BalanceConsumerPersistenceCloseError()),
          ]);
          if (
            drainSettlements.some(({ status }) => status === 'rejected') ||
            poolSettlement?.status === 'rejected'
          ) {
            throw new BalanceConsumerPersistenceCloseError();
          }
        })
        .then(
          () => finish?.(),
          () => fail?.(new BalanceConsumerPersistenceCloseError()),
        );
      return closePromise;
    };

    return frozenNullPrototype<BalanceConsumerPersistenceResource>({
      checkpoints,
      walletAddressResolver,
      close,
    });
  } catch {
    if (postgres !== undefined) {
      try {
        await Promise.allSettled([postgres.closeCancellableQueries()]);
      } catch {
        // The fixed construction error below remains authoritative.
      }
    }
    if (pool !== undefined) {
      await closePool(pool, () => new BalanceConsumerPersistenceConstructionError()).catch(
        () => undefined,
      );
    }
    throw new BalanceConsumerPersistenceConstructionError();
  }
}
