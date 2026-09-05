import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Pool } from 'pg';

import type {
  DatabaseInfrastructureConfig,
  RuntimeInfrastructureConfig,
} from '../../../infrastructure/config/infrastructure.config';
import { loadBalanceConsumerInfrastructureConfig } from '../../../infrastructure/config/infrastructure.config';
import { PostgresService } from '../../../infrastructure/database/postgres.service';
import { createPostgresPool } from '../../../infrastructure/database/runtime-postgres-pool';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
} from '../../../wallets/infrastructure/crypto/wallet-registration-crypto';
import type {
  BalanceSyncCheckpointPort,
  BalanceSyncScope,
} from '../../application/ports/balance-sync.ports';
import {
  loadBalanceConsumerConfig,
  type BalanceConsumerConfig,
} from '../config/balance-consumer.config';
import { createDormantBalanceConsumerPersistenceResource } from './balance-consumer-persistence.resource';
import { PostgresBalanceSyncCheckpointRepository } from './postgres-balance-sync-checkpoint.repository';
import { PostgresBalanceSyncWalletAddressResolver } from './postgres-balance-sync-wallet-address.resolver';

jest.mock('../../../infrastructure/database/runtime-postgres-pool', () => ({
  createPostgresPool: jest.fn(),
}));
jest.mock('../../../infrastructure/database/postgres.service', () => ({
  PostgresService: jest.fn(),
}));
jest.mock('./postgres-balance-sync-checkpoint.repository', () => ({
  PostgresBalanceSyncCheckpointRepository: jest.fn(),
}));
jest.mock('./postgres-balance-sync-wallet-address.resolver', () => ({
  PostgresBalanceSyncWalletAddressResolver: jest.fn(),
}));

const mockedCreatePostgresPool = jest.mocked(createPostgresPool);
const MockedPostgresService = jest.mocked(PostgresService);
const MockedCheckpointRepository = jest.mocked(PostgresBalanceSyncCheckpointRepository);
const MockedWalletAddressResolver = jest.mocked(PostgresBalanceSyncWalletAddressResolver);

const SCOPE: BalanceSyncScope = Object.freeze({
  accountId: '77b020bf-b2c9-4500-b987-5fe341255ffd',
  walletId: '8b083aad-9aab-4f14-8cbc-100826bc1ac8',
  networkId: 'eip155:1',
});
const DATABASE_CONNECTION_STRING =
  'postgresql://crypto_balance_consumer_login_test:' +
  'test-placeholder@localhost:5432/crypto_lending';
const REMOTE_DATABASE_CONNECTION_STRING =
  'postgresql://crypto_balance_consumer_login_test:' +
  'test-placeholder@database.invalid:5432/crypto_lending';
const METADATA_KEY_RING = createWalletRegistrationKeyRing('metadata-seal', 1, [
  createWalletRegistrationKey(
    'metadata-seal',
    1,
    Buffer.alloc(32, 7).toString('base64url'),
    'balance-consumer-metadata-v1',
  ),
]);

function infrastructureConfig(
  sessionRole: string | null = 'crypto_balance_consumer_runtime',
  databaseOverrides: Partial<DatabaseInfrastructureConfig> = {},
): RuntimeInfrastructureConfig {
  return {
    workload: 'balance-consumer',
    database: {
      connectionString: DATABASE_CONNECTION_STRING,
      connectionTimeoutMs: 2_500,
      idleTimeoutMs: 45_000,
      lockTimeoutMs: 4_000,
      maxLifetimeSeconds: 900,
      poolMax: 4,
      statementTimeoutMs: 8_000,
      ssl: false,
      ...(sessionRole === null ? {} : { sessionRole }),
      ...databaseOverrides,
    },
    sqs: {
      region: 'us-east-1',
      requestTimeoutMs: 1_000,
      sdkMaxAttempts: 1,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 5,
      retryMaxDelaySeconds: 60,
      balanceQueueUrl: 'http://sqs.test/000000000000/balance-sync',
      balanceDeadLetterQueueUrl: 'http://sqs.test/000000000000/balance-sync-dlq',
    },
  };
}

function enabledBalanceConsumerConfig(): BalanceConsumerConfig {
  return Object.freeze({
    mode: 'enabled',
    walletMetadataSealKeys: METADATA_KEY_RING,
  });
}

async function capturedRejection(
  action: () => Promise<unknown>,
): Promise<Error & { readonly code?: string }> {
  try {
    await action();
  } catch (error) {
    return error as Error & { readonly code?: string };
  }
  throw new Error('Expected action to reject');
}

function expectSanitizedConfigurationError(error: Error & { readonly code?: string }): void {
  expect(error).toMatchObject({
    name: 'BalanceConsumerPersistenceConfigurationError',
    code: 'BALANCE_CONSUMER_PERSISTENCE_CONFIGURATION_INVALID',
    message: 'Balance consumer persistence configuration is invalid',
  });
  expect(error).not.toHaveProperty('cause');
}

describe('createDormantBalanceConsumerPersistenceResource', () => {
  const poolEnd = jest.fn();
  const poolQuery = jest.fn();
  const poolConnect = jest.fn();
  const postgresQuery = jest.fn();
  const postgresHealthCheck = jest.fn();
  const checkpointLoad = jest.fn();
  const checkpointUpsertCurrent = jest.fn();
  const checkpointReplaceAfterReorg = jest.fn();
  const checkpointMarkStale = jest.fn();
  const resolveActiveAddress = jest.fn();

  const pool = {
    end: poolEnd,
    query: poolQuery,
    connect: poolConnect,
  } as unknown as Pool;
  const postgres = {
    query: postgresQuery,
    healthCheck: postgresHealthCheck,
  } as unknown as PostgresService;
  const checkpointRepository = {
    load: checkpointLoad,
    upsertCurrent: checkpointUpsertCurrent,
    replaceProvisionalAfterReorg: checkpointReplaceAfterReorg,
    preserveLastGoodAndMarkStale: checkpointMarkStale,
  } as unknown as PostgresBalanceSyncCheckpointRepository;
  const walletAddressResolver = {
    resolveActiveAddress,
  } as unknown as PostgresBalanceSyncWalletAddressResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    poolEnd.mockResolvedValue(undefined);
    checkpointLoad.mockResolvedValue(null);
    checkpointUpsertCurrent.mockResolvedValue(undefined);
    checkpointReplaceAfterReorg.mockResolvedValue(undefined);
    checkpointMarkStale.mockResolvedValue(undefined);
    resolveActiveAddress.mockResolvedValue('0x1111111111111111111111111111111111111111');
    mockedCreatePostgresPool.mockReturnValue(pool);
    MockedPostgresService.mockImplementation(() => postgres);
    MockedCheckpointRepository.mockImplementation(() => checkpointRepository);
    MockedWalletAddressResolver.mockImplementation(() => walletAddressResolver);
  });

  it('creates the lazy graph in order without touching the database', async () => {
    const infrastructure = infrastructureConfig();
    const balanceConsumer = enabledBalanceConsumerConfig();

    await createDormantBalanceConsumerPersistenceResource(infrastructure, balanceConsumer);

    const poolConfig = mockedCreatePostgresPool.mock.calls[0]?.[0];
    if (!poolConfig) throw new Error('Expected a pool configuration snapshot');
    expect(poolConfig).toEqual({
      workload: 'balance-consumer',
      database: infrastructure.database,
    });
    expect(poolConfig).not.toBe(infrastructure);
    expect(poolConfig.database).not.toBe(infrastructure.database);
    expect(Reflect.ownKeys(poolConfig)).toEqual(['workload', 'database']);
    expect(Object.isFrozen(poolConfig)).toBe(true);
    expect(Object.isFrozen(poolConfig.database)).toBe(true);
    expect(MockedPostgresService).toHaveBeenCalledWith(pool);
    expect(MockedCheckpointRepository).toHaveBeenCalledWith(postgres);
    const resolverConfig = MockedWalletAddressResolver.mock.calls[0]?.[1];
    if (!resolverConfig) throw new Error('Expected a resolver configuration snapshot');
    expect(resolverConfig).toEqual(balanceConsumer);
    expect(resolverConfig).not.toBe(balanceConsumer);
    expect(Object.isFrozen(resolverConfig)).toBe(true);
    expect(MockedWalletAddressResolver).toHaveBeenCalledWith(postgres, resolverConfig);
    expect(mockedCreatePostgresPool.mock.invocationCallOrder[0]).toBeLessThan(
      MockedPostgresService.mock.invocationCallOrder[0] as number,
    );
    expect(MockedPostgresService.mock.invocationCallOrder[0]).toBeLessThan(
      MockedCheckpointRepository.mock.invocationCallOrder[0] as number,
    );
    expect(MockedCheckpointRepository.mock.invocationCallOrder[0]).toBeLessThan(
      MockedWalletAddressResolver.mock.invocationCallOrder[0] as number,
    );
    expect(poolConnect).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
    expect(poolEnd).not.toHaveBeenCalled();
    expect(postgresQuery).not.toHaveBeenCalled();
    expect(postgresHealthCheck).not.toHaveBeenCalled();
    expect(checkpointLoad).not.toHaveBeenCalled();
    expect(checkpointUpsertCurrent).not.toHaveBeenCalled();
    expect(checkpointReplaceAfterReorg).not.toHaveBeenCalled();
    expect(checkpointMarkStale).not.toHaveBeenCalled();
    expect(resolveActiveAddress).not.toHaveBeenCalled();
  });

  it('accepts snapshots produced by the dedicated current configuration loaders', async () => {
    const infrastructure = loadBalanceConsumerInfrastructureConfig({
      APPLICATION_WORKLOAD: 'balance-consumer',
      DATABASE_RUNTIME_URL: DATABASE_CONNECTION_STRING,
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      SQS_BALANCE_QUEUE_URL: 'http://sqs.test/000000000000/balance-sync',
      SQS_BALANCE_DEAD_LETTER_QUEUE_URL: 'http://sqs.test/000000000000/balance-sync-dlq',
    });
    const balanceConsumer = loadBalanceConsumerConfig({
      BALANCE_CONSUMER_MODE: 'enabled',
      BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: JSON.stringify({
        activeWriteVersion: 1,
        keys: [
          {
            keyId: 'balance-consumer-loader-v1',
            purpose: 'metadata-seal',
            version: 1,
            material: Buffer.alloc(32, 9).toString('base64url'),
          },
        ],
      }),
    });

    const resource = await createDormantBalanceConsumerPersistenceResource(
      infrastructure,
      balanceConsumer,
    );
    const poolConfig = mockedCreatePostgresPool.mock.calls[0]?.[0];
    if (!poolConfig) throw new Error('Expected a loader-compatible pool snapshot');

    expect(poolConfig.workload).toBe('balance-consumer');
    expect(poolConfig.database.connectionString).toBe(DATABASE_CONNECTION_STRING);
    expect(poolConfig.database.sessionRole).toBe('crypto_balance_consumer_runtime');
    expect(MockedWalletAddressResolver).toHaveBeenCalledTimes(1);
    await resource.close();
  });

  it('returns only frozen null-prototype closure facades', async () => {
    const resource = await createDormantBalanceConsumerPersistenceResource(
      infrastructureConfig(),
      enabledBalanceConsumerConfig(),
    );
    const upsertInput = Object.freeze({}) as Parameters<
      BalanceSyncCheckpointPort['upsertCurrent']
    >[0];
    const reorgInput = Object.freeze({}) as Parameters<
      BalanceSyncCheckpointPort['replaceProvisionalAfterReorg']
    >[0];
    const staleInput = Object.freeze({}) as Parameters<
      BalanceSyncCheckpointPort['preserveLastGoodAndMarkStale']
    >[0];

    expect(Reflect.ownKeys(resource)).toEqual(['checkpoints', 'walletAddressResolver', 'close']);
    expect(Reflect.ownKeys(resource.checkpoints)).toEqual([
      'load',
      'upsertCurrent',
      'replaceProvisionalAfterReorg',
      'preserveLastGoodAndMarkStale',
    ]);
    expect(Reflect.ownKeys(resource.walletAddressResolver)).toEqual(['resolveActiveAddress']);
    for (const facade of [resource, resource.checkpoints, resource.walletAddressResolver]) {
      expect(Object.getPrototypeOf(facade)).toBeNull();
      expect(Object.isFrozen(facade)).toBe(true);
    }
    expect(resource.checkpoints).not.toBe(checkpointRepository);
    expect(resource.walletAddressResolver).not.toBe(walletAddressResolver);
    expect(resource).not.toHaveProperty('pool');
    expect(resource).not.toHaveProperty('postgres');
    expect(resource).not.toHaveProperty('config');

    await resource.checkpoints.load.call(null, SCOPE);
    await resource.checkpoints.upsertCurrent.call(null, upsertInput);
    await resource.checkpoints.replaceProvisionalAfterReorg.call(null, reorgInput);
    await resource.checkpoints.preserveLastGoodAndMarkStale.call(null, staleInput);
    await resource.walletAddressResolver.resolveActiveAddress.call(null, SCOPE);

    expect(checkpointLoad).toHaveBeenCalledWith(SCOPE);
    expect(checkpointUpsertCurrent).toHaveBeenCalledWith(upsertInput);
    expect(checkpointReplaceAfterReorg).toHaveBeenCalledWith(reorgInput);
    expect(checkpointMarkStale).toHaveBeenCalledWith(staleInput);
    expect(resolveActiveAddress).toHaveBeenCalledWith(SCOPE);
  });

  it.each([
    [
      'non-consumer workload',
      { ...infrastructureConfig(), workload: 'worker' } as unknown as RuntimeInfrastructureConfig,
      enabledBalanceConsumerConfig(),
    ],
    ['missing session role', infrastructureConfig(null), enabledBalanceConsumerConfig()],
    [
      'wrong session role',
      infrastructureConfig('crypto_worker_runtime'),
      enabledBalanceConsumerConfig(),
    ],
    ['disabled balance config', infrastructureConfig(), Object.freeze({ mode: 'disabled' })],
  ] as const)(
    'rejects %s before pool allocation',
    async (_label, infrastructure, balanceConsumer) => {
      const error = await capturedRejection(() =>
        createDormantBalanceConsumerPersistenceResource(infrastructure, balanceConsumer),
      );

      expectSanitizedConfigurationError(error);
      expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
    },
  );

  it('reads data descriptors without invoking hostile property access', async () => {
    let propertyReads = 0;
    const infrastructure = new Proxy(infrastructureConfig(), {
      get: () => {
        propertyReads += 1;
        throw new Error('sensitive property access detail');
      },
    });

    await createDormantBalanceConsumerPersistenceResource(
      infrastructure,
      enabledBalanceConsumerConfig(),
    );

    expect(propertyReads).toBe(0);
    expect(mockedCreatePostgresPool).toHaveBeenCalledTimes(1);
  });

  it('rejects infrastructure, database, SSL, and balance-config accessors without invoking them', async () => {
    const cases: Array<Readonly<{ infrastructure: RuntimeInfrastructureConfig; config: unknown }>> =
      [];
    let accessorInvocations = 0;

    const workloadAccessor = infrastructureConfig();
    Object.defineProperty(workloadAccessor, 'workload', {
      enumerable: true,
      get: () => {
        accessorInvocations += 1;
        return 'balance-consumer';
      },
    });
    cases.push({ infrastructure: workloadAccessor, config: enabledBalanceConsumerConfig() });

    const connectionAccessorDatabase = { ...infrastructureConfig().database };
    Object.defineProperty(connectionAccessorDatabase, 'connectionString', {
      enumerable: true,
      get: () => {
        accessorInvocations += 1;
        return DATABASE_CONNECTION_STRING;
      },
    });
    cases.push({
      infrastructure: {
        ...infrastructureConfig(),
        database: connectionAccessorDatabase,
      },
      config: enabledBalanceConsumerConfig(),
    });

    const sslAccessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(sslAccessor, {
      rejectUnauthorized: {
        enumerable: true,
        get: () => {
          accessorInvocations += 1;
          return true;
        },
      },
      ca: { enumerable: true, value: 'reviewed CA' },
    });
    cases.push({
      infrastructure: infrastructureConfig('crypto_balance_consumer_runtime', {
        connectionString: REMOTE_DATABASE_CONNECTION_STRING,
        ssl: sslAccessor as DatabaseInfrastructureConfig['ssl'],
      }),
      config: enabledBalanceConsumerConfig(),
    });

    const modeAccessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(modeAccessor, {
      mode: {
        enumerable: true,
        get: () => {
          accessorInvocations += 1;
          return 'enabled';
        },
      },
      walletMetadataSealKeys: { enumerable: true, value: METADATA_KEY_RING },
    });
    cases.push({ infrastructure: infrastructureConfig(), config: modeAccessor });

    for (const candidate of cases) {
      jest.clearAllMocks();
      const error = await capturedRejection(() =>
        createDormantBalanceConsumerPersistenceResource(
          candidate.infrastructure,
          candidate.config as BalanceConsumerConfig,
        ),
      );
      expectSanitizedConfigurationError(error);
      expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
    }
    expect(accessorInvocations).toBe(0);
  });

  it('snapshots stateful descriptors once and ignores all later input mutation', async () => {
    const databaseTarget = { ...infrastructureConfig().database };
    let poolMaxDescriptorReads = 0;
    const statefulDatabase = new Proxy(databaseTarget, {
      getOwnPropertyDescriptor: (target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property !== 'poolMax' || !descriptor) return descriptor;
        poolMaxDescriptorReads += 1;
        return {
          ...descriptor,
          value: poolMaxDescriptorReads === 1 ? 4 : 99,
        };
      },
    });
    const infrastructure = {
      ...infrastructureConfig(),
      database: statefulDatabase,
    };
    const balanceConsumer = {
      mode: 'enabled' as const,
      walletMetadataSealKeys: METADATA_KEY_RING,
    };

    const construction = createDormantBalanceConsumerPersistenceResource(
      infrastructure,
      balanceConsumer,
    );
    databaseTarget.poolMax = 88;
    infrastructure.workload = 'worker' as never;
    (balanceConsumer as { mode: string }).mode = 'disabled';
    const resource = await construction;
    const poolConfig = mockedCreatePostgresPool.mock.calls[0]?.[0];
    const resolverConfig = MockedWalletAddressResolver.mock.calls[0]?.[1];
    if (!poolConfig || !resolverConfig) throw new Error('Expected stable snapshots');

    expect(poolMaxDescriptorReads).toBe(1);
    expect(poolConfig.workload).toBe('balance-consumer');
    expect(poolConfig.database.poolMax).toBe(4);
    expect(resolverConfig.mode).toBe('enabled');
    if (resolverConfig.mode !== 'enabled') throw new Error('Expected enabled resolver snapshot');
    expect(resolverConfig.walletMetadataSealKeys).toBe(METADATA_KEY_RING);
    expect(Object.isFrozen(poolConfig.database)).toBe(true);
    expect(Object.isFrozen(resolverConfig)).toBe(true);
    await resource.close();
  });

  it('does not inspect or retain the generic SQS configuration', async () => {
    const infrastructure = infrastructureConfig();
    let sqsReads = 0;
    Object.defineProperty(infrastructure, 'sqs', {
      enumerable: true,
      get: () => {
        sqsReads += 1;
        throw new Error('generic SQS configuration must remain inaccessible');
      },
    });

    const resource = await createDormantBalanceConsumerPersistenceResource(
      infrastructure,
      enabledBalanceConsumerConfig(),
    );
    const poolConfig = mockedCreatePostgresPool.mock.calls[0]?.[0];
    if (!poolConfig) throw new Error('Expected a database-only pool snapshot');

    expect(sqsReads).toBe(0);
    expect(Reflect.ownKeys(poolConfig)).toEqual(['workload', 'database']);
    expect(poolConfig).not.toHaveProperty('sqs');
    await resource.close();
  });

  it.each([
    ['empty', ''],
    ['ambient database name', 'crypto_lending'],
    ['invalid URL', 'not-a-url'],
    ['role override', `${DATABASE_CONNECTION_STRING}?options=-c%20role%3Dcrypto_api_runtime`],
    ['TLS override', `${DATABASE_CONNECTION_STRING}?sslmode=disable`],
    ['arbitrary query', `${DATABASE_CONNECTION_STRING}?application_name=unreviewed`],
    ['empty query delimiter', `${DATABASE_CONNECTION_STRING}?`],
    ['fragment', `${DATABASE_CONNECTION_STRING}#unreviewed`],
    [
      'generic login',
      DATABASE_CONNECTION_STRING.replace(
        'crypto_balance_consumer_login_test',
        'crypto_api_login_test',
      ),
    ],
    ['missing password', DATABASE_CONNECTION_STRING.replace(':test-placeholder@', '@')],
    ['missing port', DATABASE_CONNECTION_STRING.replace(':5432/', '/')],
    ['zero port', DATABASE_CONNECTION_STRING.replace(':5432/', ':0/')],
    ['invalid port', DATABASE_CONNECTION_STRING.replace(':5432/', ':not-a-port/')],
    ['out-of-range port', DATABASE_CONNECTION_STRING.replace(':5432/', ':65536/')],
    ['missing database', DATABASE_CONNECTION_STRING.replace('/crypto_lending', '/')],
  ] as const)('rejects %s connection strings before pool allocation', async (_label, value) => {
    const error = await capturedRejection(() =>
      createDormantBalanceConsumerPersistenceResource(
        infrastructureConfig('crypto_balance_consumer_runtime', { connectionString: value }),
        enabledBalanceConsumerConfig(),
      ),
    );

    expectSanitizedConfigurationError(error);
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it.each([
    ['plaintext remote connection', false],
    ['disabled verification', { rejectUnauthorized: false, ca: 'reviewed CA' }],
    ['missing CA', { rejectUnauthorized: true }],
  ] as const)('rejects %s before pool allocation', async (_label, ssl) => {
    const error = await capturedRejection(() =>
      createDormantBalanceConsumerPersistenceResource(
        infrastructureConfig('crypto_balance_consumer_runtime', {
          connectionString: REMOTE_DATABASE_CONNECTION_STRING,
          ssl,
        }),
        enabledBalanceConsumerConfig(),
      ),
    );

    expectSanitizedConfigurationError(error);
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it('copies and freezes verified remote TLS settings', async () => {
    const ssl = { rejectUnauthorized: true, ca: 'reviewed test CA' };
    const infrastructure = infrastructureConfig('crypto_balance_consumer_runtime', {
      connectionString: REMOTE_DATABASE_CONNECTION_STRING,
      ssl,
    });

    const construction = createDormantBalanceConsumerPersistenceResource(
      infrastructure,
      enabledBalanceConsumerConfig(),
    );
    ssl.ca = 'mutated after construction began';
    const resource = await construction;
    const poolConfig = mockedCreatePostgresPool.mock.calls[0]?.[0];
    if (!poolConfig) throw new Error('Expected a pool configuration snapshot');

    expect(poolConfig.database.ssl).toEqual({
      rejectUnauthorized: true,
      ca: 'reviewed test CA',
    });
    expect(poolConfig.database.ssl).not.toBe(ssl);
    expect(Object.isFrozen(poolConfig.database.ssl)).toBe(true);
    await resource.close();
  });

  it('requires an authentic immutable metadata-seal key ring', async () => {
    const identityRing = createWalletRegistrationKeyRing('identity-hmac', 1, [
      createWalletRegistrationKey(
        'identity-hmac',
        1,
        Buffer.alloc(32, 8).toString('base64url'),
        'balance-consumer-identity-v1',
      ),
    ]);
    const forgedRing = Object.freeze({
      purpose: 'metadata-seal',
      activeWriteVersion: 1,
      keys: Object.freeze([]),
    });

    for (const walletMetadataSealKeys of [identityRing, forgedRing]) {
      const error = await capturedRejection(() =>
        createDormantBalanceConsumerPersistenceResource(
          infrastructureConfig(),
          Object.freeze({
            mode: 'enabled',
            walletMetadataSealKeys,
          }) as BalanceConsumerConfig,
        ),
      );
      expectSanitizedConfigurationError(error);
      expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
    }
  });

  it('closes a partially constructed pool once and sanitizes construction failure', async () => {
    MockedCheckpointRepository.mockImplementationOnce(() => {
      throw new Error('sensitive repository detail');
    });

    const error = await capturedRejection(() =>
      createDormantBalanceConsumerPersistenceResource(
        infrastructureConfig(),
        enabledBalanceConsumerConfig(),
      ),
    );

    expect(error).toMatchObject({
      name: 'BalanceConsumerPersistenceConstructionError',
      code: 'BALANCE_CONSUMER_PERSISTENCE_CONSTRUCTION_FAILED',
      message: 'Balance consumer persistence construction failed',
    });
    expect(String(error)).not.toContain('sensitive');
    expect(error).not.toHaveProperty('cause');
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('waits for partial-construction cleanup before rejecting', async () => {
    let resolveEnd: (() => void) | undefined;
    poolEnd.mockReturnValueOnce(
      new Promise<void>((resolvePromise) => {
        resolveEnd = resolvePromise;
      }),
    );
    MockedCheckpointRepository.mockImplementationOnce(() => {
      throw new Error('private repository detail');
    });
    let settled = false;

    const construction = createDormantBalanceConsumerPersistenceResource(
      infrastructureConfig(),
      enabledBalanceConsumerConfig(),
    );
    void construction.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();

    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    resolveEnd?.();
    const error = await capturedRejection(() => construction);

    expect(error.message).toBe('Balance consumer persistence construction failed');
    expect(settled).toBe(true);
  });

  it.each(['rejects', 'throws'] as const)(
    'suppresses a cleanup that %s and reports only a sanitized construction failure',
    async (failureMode) => {
      if (failureMode === 'rejects') {
        poolEnd.mockRejectedValueOnce(new Error('private database close detail'));
      } else {
        poolEnd.mockImplementationOnce(() => {
          throw new Error('private database close detail');
        });
      }
      MockedWalletAddressResolver.mockImplementationOnce(() => {
        throw new Error('private repository detail');
      });

      const error = await capturedRejection(() =>
        createDormantBalanceConsumerPersistenceResource(
          infrastructureConfig(),
          enabledBalanceConsumerConfig(),
        ),
      );

      expect(error.message).toBe('Balance consumer persistence construction failed');
      expect(String(error)).not.toContain('private');
      expect(error).not.toHaveProperty('cause');
      expect(poolEnd).toHaveBeenCalledTimes(1);
    },
  );

  it('sanitizes pool-factory failures without attempting unavailable cleanup', async () => {
    mockedCreatePostgresPool.mockImplementationOnce(() => {
      throw new Error('sensitive pool factory detail');
    });

    const error = await capturedRejection(() =>
      createDormantBalanceConsumerPersistenceResource(
        infrastructureConfig(),
        enabledBalanceConsumerConfig(),
      ),
    );

    expect(error.message).toBe('Balance consumer persistence construction failed');
    expect(String(error)).not.toContain('sensitive');
    expect(error).not.toHaveProperty('cause');
    expect(poolEnd).not.toHaveBeenCalled();
  });

  it('memoizes one close promise across concurrent and repeated calls', async () => {
    let resolveEnd: (() => void) | undefined;
    poolEnd.mockReturnValueOnce(
      new Promise<void>((resolvePromise) => {
        resolveEnd = resolvePromise;
      }),
    );
    const resource = await createDormantBalanceConsumerPersistenceResource(
      infrastructureConfig(),
      enabledBalanceConsumerConfig(),
    );

    const first = resource.close();
    const concurrent = resource.close();

    expect(concurrent).toBe(first);
    expect(poolEnd).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(poolEnd).toHaveBeenCalledTimes(1);
    resolveEnd?.();
    await first;
    expect(resource.close()).toBe(first);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('closes synchronously to all five operation facades before ending the pool', async () => {
    const resource = await createDormantBalanceConsumerPersistenceResource(
      infrastructureConfig(),
      enabledBalanceConsumerConfig(),
    );
    const closing = resource.close();
    const operationResults = [
      resource.checkpoints.load(SCOPE),
      resource.checkpoints.upsertCurrent(
        Object.freeze({}) as Parameters<BalanceSyncCheckpointPort['upsertCurrent']>[0],
      ),
      resource.checkpoints.replaceProvisionalAfterReorg(
        Object.freeze({}) as Parameters<
          BalanceSyncCheckpointPort['replaceProvisionalAfterReorg']
        >[0],
      ),
      resource.checkpoints.preserveLastGoodAndMarkStale(
        Object.freeze({}) as Parameters<
          BalanceSyncCheckpointPort['preserveLastGoodAndMarkStale']
        >[0],
      ),
      resource.walletAddressResolver.resolveActiveAddress(SCOPE),
    ];

    expect(poolEnd).not.toHaveBeenCalled();
    expect(checkpointLoad).not.toHaveBeenCalled();
    expect(checkpointUpsertCurrent).not.toHaveBeenCalled();
    expect(checkpointReplaceAfterReorg).not.toHaveBeenCalled();
    expect(checkpointMarkStale).not.toHaveBeenCalled();
    expect(resolveActiveAddress).not.toHaveBeenCalled();
    const errors = await Promise.all(
      operationResults.map((result) =>
        result.catch((error: unknown) => error as Error & { readonly code?: string }),
      ),
    );
    for (const error of errors) {
      expect(error).toMatchObject({
        name: 'BalanceConsumerPersistenceClosedError',
        code: 'BALANCE_CONSUMER_PERSISTENCE_CLOSED',
        message: 'Balance consumer persistence is closed',
      });
      expect(error).not.toHaveProperty('cause');
    }
    await closing;
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('memoizes the close promise before a synchronous end implementation can re-enter', async () => {
    const resource = await createDormantBalanceConsumerPersistenceResource(
      infrastructureConfig(),
      enabledBalanceConsumerConfig(),
    );
    let reentrant: Promise<void> | undefined;
    let reentrantOperation: Promise<unknown> | undefined;
    poolEnd.mockImplementationOnce(() => {
      reentrant = resource.close();
      reentrantOperation = resource.checkpoints.load(SCOPE);
      return Promise.resolve();
    });

    const first = resource.close();
    await first;
    const operationError = await reentrantOperation?.catch((error: unknown) => error);

    expect(reentrant).toBe(first);
    expect(operationError).toMatchObject({
      code: 'BALANCE_CONSUMER_PERSISTENCE_CLOSED',
      message: 'Balance consumer persistence is closed',
    });
    expect(checkpointLoad).not.toHaveBeenCalled();
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it.each(['rejects', 'throws'] as const)(
    'memoizes and sanitizes a pool close that %s',
    async (failureMode) => {
      if (failureMode === 'rejects') {
        poolEnd.mockRejectedValueOnce(new Error('private database close detail'));
      } else {
        poolEnd.mockImplementationOnce(() => {
          throw new Error('private database close detail');
        });
      }
      const resource = await createDormantBalanceConsumerPersistenceResource(
        infrastructureConfig(),
        enabledBalanceConsumerConfig(),
      );

      let first: Promise<void> | undefined;
      expect(() => {
        first = resource.close();
      }).not.toThrow();
      const repeated = resource.close();
      const error = await (first as Promise<void>).catch(
        (reason: unknown) =>
          reason as Error & {
            readonly code?: string;
          },
      );

      expect(repeated).toBe(first);
      expect(error).toMatchObject({
        name: 'BalanceConsumerPersistenceCloseError',
        code: 'BALANCE_CONSUMER_PERSISTENCE_CLOSE_FAILED',
        message: 'Balance consumer persistence close failed',
      });
      expect(String(error)).not.toContain('private');
      expect(error).not.toHaveProperty('cause');
      expect(poolEnd).toHaveBeenCalledTimes(1);
    },
  );

  it('stays dormant, decorator-free, unexported, and unreferenced by launch paths', () => {
    const source = readFileSync(
      resolve(__dirname, 'balance-consumer-persistence.resource.ts'),
      'utf8',
    );
    const blockchainSyncIndex = readFileSync(resolve(__dirname, '../../index.ts'), 'utf8');
    const launchSources = [
      '../../application/balance-sync-consumer.runtime.ts',
      '../../application/balance-sync-consumer.cli.ts',
      '../../application/balance-sync-consumer.composition.ts',
      '../../blockchain-sync.module.ts',
      '../../../app.module.ts',
      '../../../main.ts',
      '../../../local-development-app.module.ts',
      '../../../infrastructure/outbox/outbox-worker.cli.ts',
      '../../../infrastructure/outbox/outbox-worker-health.cli.ts',
      '../../../infrastructure/redis/redis-session-revocation.cli.ts',
      '../../../infrastructure/database/migration.cli.ts',
    ].map((relativePath) => readFileSync(resolve(__dirname, relativePath), 'utf8'));

    expect(source).not.toMatch(
      /@nestjs|PostgresModule|InfrastructureConfigModule|MigrationRunner|process\.env|\.connect\s*\(|\.query\s*\(|healthCheck\s*\(/u,
    );
    expect(blockchainSyncIndex).not.toContain('balance-consumer-persistence.resource');
    for (const launchSource of launchSources) {
      expect(launchSource).not.toContain('createDormantBalanceConsumerPersistenceResource');
      expect(launchSource).not.toContain('balance-consumer-persistence.resource');
    }
  });
});
