import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import { applicationObservability } from '../../infrastructure/observability';
import type { BalanceConsumerInfrastructureConfig } from '../../infrastructure/config/infrastructure.config';
import type { PinnedSqsQueueReceiptPort } from '../../infrastructure/sqs/sqs-queue-receipt.port';
import type { JobEnvelope, ReceivedQueueMessage } from '../../infrastructure/sqs/sqs.types';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
} from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import { createDeterministicBalanceSyncJobEnvelope } from '../domain/balance-sync';
import type { EnabledBalanceConsumerConfig } from '../infrastructure/config/balance-consumer.config';
import type { BalanceJsonRpcTransport } from '../infrastructure/rpc/balance-json-rpc';
import {
  createDormantBalanceConsumerPersistenceResource,
  type BalanceConsumerPersistenceResource,
} from '../infrastructure/postgres/balance-consumer-persistence.resource';
import {
  createDormantBalanceConsumerSqsReceiptResource,
  type BalanceConsumerSqsReceiptResource,
} from '../infrastructure/sqs/balance-consumer-sqs-receipt.resource';
import type * as BalanceSyncConsumerCompositionModule from './balance-sync-consumer.composition';
import { createBalanceSyncConsumerComposition } from './balance-sync-consumer.composition';
import {
  createDormantBalanceSyncConsumerResource,
  type DormantBalanceSyncConsumerResourceDependencies,
} from './balance-sync-consumer.resource';
import { ETHEREUM_MAINNET_BALANCE_NETWORK_ID } from './mainnet-balance-indexer.router';
import type {
  BalanceSyncCheckpointPort,
  BalanceSyncClockPort,
  BalanceSyncMetricsPort,
  BalanceSyncWalletAddressResolverPort,
} from './ports/balance-sync.ports';

jest.mock('../infrastructure/postgres/balance-consumer-persistence.resource', () => ({
  createDormantBalanceConsumerPersistenceResource: jest.fn(),
}));
jest.mock('../infrastructure/sqs/balance-consumer-sqs-receipt.resource', () => ({
  createDormantBalanceConsumerSqsReceiptResource: jest.fn(),
}));
jest.mock('./balance-sync-consumer.composition', () => ({
  ...jest.requireActual<typeof BalanceSyncConsumerCompositionModule>(
    './balance-sync-consumer.composition',
  ),
  createBalanceSyncConsumerComposition: jest.fn(),
}));

const mockedCreatePersistence = jest.mocked(createDormantBalanceConsumerPersistenceResource);
const mockedCreateSqsReceipt = jest.mocked(createDormantBalanceConsumerSqsReceiptResource);
const mockedCreateComposition = jest.mocked(createBalanceSyncConsumerComposition);
const actualCreateComposition = jest.requireActual<typeof BalanceSyncConsumerCompositionModule>(
  './balance-sync-consumer.composition',
).createBalanceSyncConsumerComposition;

const METADATA_KEY_RING = createWalletRegistrationKeyRing('metadata-seal', 1, [
  createWalletRegistrationKey(
    'metadata-seal',
    1,
    Buffer.alloc(32, 9).toString('base64url'),
    'balance-consumer-aggregate-test-v1',
  ),
]);

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function infrastructureConfig(): BalanceConsumerInfrastructureConfig {
  return {
    workload: 'balance-consumer',
    database: {
      connectionString:
        'postgresql://crypto_balance_consumer_login_test:test-placeholder@localhost:5432/crypto_lending',
      connectionTimeoutMs: 2_500,
      idleTimeoutMs: 45_000,
      lockTimeoutMs: 4_000,
      maxLifetimeSeconds: 900,
      poolMax: 4,
      statementTimeoutMs: 8_000,
      ssl: false,
      sessionRole: 'crypto_balance_consumer_runtime',
    },
    sqs: {
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:4566',
      requestTimeoutMs: 15_000,
      sdkMaxAttempts: 3,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 5,
      retryMaxDelaySeconds: 60,
      balanceQueueUrl: 'http://127.0.0.1:4566/000000000000/crypto-lending-test-balance-sync',
      balanceDeadLetterQueueUrl:
        'http://127.0.0.1:4566/000000000000/crypto-lending-test-balance-sync-dlq',
    },
  };
}

function balanceConsumerConfig(): EnabledBalanceConsumerConfig {
  return Object.freeze({ mode: 'enabled', walletMetadataSealKeys: METADATA_KEY_RING });
}

function dependencies(
  infrastructure: BalanceConsumerInfrastructureConfig = infrastructureConfig(),
): DormantBalanceSyncConsumerResourceDependencies {
  const ethereumExchange = jest.fn();
  const solanaExchange = jest.fn();
  return {
    infrastructureConfig: infrastructure,
    balanceConsumerConfig: balanceConsumerConfig(),
    observability: applicationObservability,
    ethereumTransport: { exchange: ethereumExchange },
    solanaTransport: { exchange: solanaExchange },
    clock: { now: jest.fn(() => new Date('2026-09-05T12:00:00.000Z')) },
    metrics: { record: jest.fn(), alert: jest.fn() },
  };
}

interface CapsuleHarness {
  readonly receipt: Readonly<PinnedSqsQueueReceiptPort>;
  readonly receive: jest.Mock;
  readonly deleteReceipt: jest.Mock;
  readonly changeVisibility: jest.Mock;
  readonly parseEnvelope: jest.Mock;
  readonly sqsClose: jest.Mock;
  readonly sqsResource: Readonly<BalanceConsumerSqsReceiptResource>;
  readonly checkpoints: Readonly<BalanceSyncCheckpointPort>;
  readonly checkpointLoad: jest.Mock;
  readonly checkpointUpsert: jest.Mock;
  readonly checkpointReplace: jest.Mock;
  readonly checkpointPreserve: jest.Mock;
  readonly walletAddressResolver: Readonly<BalanceSyncWalletAddressResolverPort>;
  readonly resolveActiveAddress: jest.Mock;
  readonly persistenceClose: jest.Mock;
  readonly persistenceResource: Readonly<BalanceConsumerPersistenceResource>;
}

function arrangeCapsules(): CapsuleHarness {
  const receive = jest.fn().mockResolvedValue([]);
  const deleteReceipt = jest.fn().mockResolvedValue(undefined);
  const changeVisibility = jest.fn().mockResolvedValue(undefined);
  const parseEnvelope = jest.fn((body: string) => JSON.parse(body) as JobEnvelope);
  const receipt = frozenNullPrototype<PinnedSqsQueueReceiptPort>({
    receive,
    delete: deleteReceipt,
    changeVisibility,
    parseEnvelope: <Payload = unknown>(body: string): JobEnvelope<Payload> =>
      parseEnvelope(body) as JobEnvelope<Payload>,
  });
  const sqsClose = jest.fn().mockResolvedValue(undefined);
  const sqsResource = frozenNullPrototype<BalanceConsumerSqsReceiptResource>({
    receipt,
    close: sqsClose,
  });

  const checkpointLoad = jest.fn().mockResolvedValue(null);
  const checkpointUpsert = jest.fn().mockResolvedValue(undefined);
  const checkpointReplace = jest.fn().mockResolvedValue(undefined);
  const checkpointPreserve = jest.fn().mockResolvedValue(undefined);
  const checkpoints = frozenNullPrototype<BalanceSyncCheckpointPort>({
    load: checkpointLoad,
    upsertCurrent: checkpointUpsert,
    replaceProvisionalAfterReorg: checkpointReplace,
    preserveLastGoodAndMarkStale: checkpointPreserve,
  });
  const resolveActiveAddress = jest.fn();
  const walletAddressResolver = frozenNullPrototype<BalanceSyncWalletAddressResolverPort>({
    resolveActiveAddress,
  });
  const persistenceClose = jest.fn().mockResolvedValue(undefined);
  const persistenceResource = frozenNullPrototype<BalanceConsumerPersistenceResource>({
    checkpoints,
    walletAddressResolver,
    close: persistenceClose,
  });

  mockedCreatePersistence.mockResolvedValue(persistenceResource);
  mockedCreateSqsReceipt.mockResolvedValue(sqsResource);
  return {
    receipt,
    receive,
    deleteReceipt,
    changeVisibility,
    parseEnvelope,
    sqsClose,
    sqsResource,
    checkpoints,
    checkpointLoad,
    checkpointUpsert,
    checkpointReplace,
    checkpointPreserve,
    walletAddressResolver,
    resolveActiveAddress,
    persistenceClose,
    persistenceResource,
  };
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

function expectFixedError(
  error: Error & { readonly code?: string },
  kind: 'Configuration' | 'Construction' | 'Run' | 'AlreadyStarted' | 'Signal' | 'Closed' | 'Close',
): void {
  const expected = {
    Configuration: {
      code: 'BALANCE_SYNC_CONSUMER_RESOURCE_CONFIGURATION_INVALID',
      message: 'Balance sync consumer resource configuration is invalid',
    },
    Construction: {
      code: 'BALANCE_SYNC_CONSUMER_RESOURCE_CONSTRUCTION_FAILED',
      message: 'Balance sync consumer resource construction failed',
    },
    Run: {
      code: 'BALANCE_SYNC_CONSUMER_RESOURCE_RUN_FAILED',
      message: 'Balance sync consumer resource run failed',
    },
    AlreadyStarted: {
      code: 'BALANCE_SYNC_CONSUMER_RESOURCE_ALREADY_STARTED',
      message: 'Balance sync consumer resource is already started',
    },
    Signal: {
      code: 'BALANCE_SYNC_CONSUMER_RESOURCE_SIGNAL_INVALID',
      message: 'Balance sync consumer resource signal is invalid',
    },
    Closed: {
      code: 'BALANCE_SYNC_CONSUMER_RESOURCE_CLOSED',
      message: 'Balance sync consumer resource is closed',
    },
    Close: {
      code: 'BALANCE_SYNC_CONSUMER_RESOURCE_CLOSE_FAILED',
      message: 'Balance sync consumer resource close failed',
    },
  } as const;
  expect(error).toMatchObject(expected[kind]);
  expect(error.name).toBe(`BalanceSyncConsumerResource${kind}Error`);
  expect(error).not.toHaveProperty('cause');
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
  }
  throw new Error('Condition did not settle');
}

describe('createDormantBalanceSyncConsumerResource', () => {
  beforeEach(() => {
    mockedCreatePersistence.mockReset();
    mockedCreateSqsReceipt.mockReset();
    mockedCreateComposition.mockReset().mockImplementation(actualCreateComposition);
  });

  it('builds an inert exact facade from one deep frozen infrastructure snapshot', async () => {
    const capsules = arrangeCapsules();
    const configuredInfrastructure = infrastructureConfig();
    configuredInfrastructure.database.ssl = {
      rejectUnauthorized: true,
      ca: 'test-only-ca-snapshot',
    };
    const configured = dependencies(configuredInfrastructure);

    const resource = await createDormantBalanceSyncConsumerResource(configured);

    expect(Object.getPrototypeOf(resource)).toBeNull();
    expect(Object.isFrozen(resource)).toBe(true);
    expect(Reflect.ownKeys(resource)).toEqual(['run', 'close']);
    for (const key of ['run', 'close'] as const) {
      expect(Object.getOwnPropertyDescriptor(resource, key)).toMatchObject({
        enumerable: true,
        configurable: false,
        writable: false,
        value: expect.any(Function),
      });
    }
    expect(mockedCreatePersistence.mock.invocationCallOrder[0]).toBeLessThan(
      mockedCreateSqsReceipt.mock.invocationCallOrder[0]!,
    );
    const persistenceInfrastructure = mockedCreatePersistence.mock.calls[0]![0];
    const sqsInfrastructure = mockedCreateSqsReceipt.mock.calls[0]![0];
    expect(persistenceInfrastructure).toBe(sqsInfrastructure);
    expect(persistenceInfrastructure).not.toBe(configuredInfrastructure);
    expect(Object.isFrozen(persistenceInfrastructure)).toBe(true);
    expect(Object.isFrozen(persistenceInfrastructure.database)).toBe(true);
    expect(Object.isFrozen(persistenceInfrastructure.database.ssl)).toBe(true);
    expect(Object.isFrozen(persistenceInfrastructure.sqs)).toBe(true);
    expect(mockedCreatePersistence.mock.calls[0]![1]).not.toBe(configured.balanceConsumerConfig);
    expect(
      (mockedCreatePersistence.mock.calls[0]![1] as EnabledBalanceConsumerConfig)
        .walletMetadataSealKeys,
    ).toBe(configured.balanceConsumerConfig.walletMetadataSealKeys);

    configuredInfrastructure.sqs.visibilityTimeoutSeconds = 120;
    configuredInfrastructure.database.connectionTimeoutMs = 9_999;
    (configuredInfrastructure.database.ssl as { ca?: string }).ca = 'mutated-ca';
    expect(persistenceInfrastructure.sqs.visibilityTimeoutSeconds).toBe(30);
    expect(persistenceInfrastructure.database.connectionTimeoutMs).toBe(2_500);
    expect(persistenceInfrastructure.database.ssl).toEqual({
      rejectUnauthorized: true,
      ca: 'test-only-ca-snapshot',
    });

    const compositionInput = mockedCreateComposition.mock.calls[0]![0];
    expect(compositionInput.sqs).toBe(capsules.receipt);
    expect(compositionInput.checkpoints).toBe(capsules.checkpoints);
    expect(compositionInput.walletAddressResolver).toBe(capsules.walletAddressResolver);
    expect(compositionInput.ethereumTransport).toBe(configured.ethereumTransport);
    expect(compositionInput.solanaTransport).toBe(configured.solanaTransport);
    expect(compositionInput.observability).toBe(configured.observability);
    expect(compositionInput.clock).toBe(configured.clock);
    expect(compositionInput.metrics).toBe(configured.metrics);
    expect(compositionInput.receiptPolicy).toEqual({ visibilityTimeoutSeconds: 30 });
    expect(Object.isFrozen(compositionInput.receiptPolicy)).toBe(true);

    expect(capsules.receive).not.toHaveBeenCalled();
    expect(capsules.deleteReceipt).not.toHaveBeenCalled();
    expect(capsules.changeVisibility).not.toHaveBeenCalled();
    expect(capsules.parseEnvelope).not.toHaveBeenCalled();
    expect(capsules.checkpointLoad).not.toHaveBeenCalled();
    expect(capsules.resolveActiveAddress).not.toHaveBeenCalled();
    expect(configured.ethereumTransport.exchange).not.toHaveBeenCalled();
    expect(configured.solanaTransport.exchange).not.toHaveBeenCalled();
    expect(configured.clock.now).not.toHaveBeenCalled();
    expect(configured.metrics.record).not.toHaveBeenCalled();
    expect(configured.metrics.alert).not.toHaveBeenCalled();
    expect(capsules.sqsClose).not.toHaveBeenCalled();
    expect(capsules.persistenceClose).not.toHaveBeenCalled();
  });

  it('finishes the infrastructure snapshot before awaiting the first child factory', async () => {
    const capsules = arrangeCapsules();
    const configuredInfrastructure = infrastructureConfig();
    let resolvePersistence: (value: Readonly<BalanceConsumerPersistenceResource>) => void = () =>
      undefined;
    const pendingPersistence = new Promise<Readonly<BalanceConsumerPersistenceResource>>(
      (resolvePending) => {
        resolvePersistence = resolvePending;
      },
    );
    mockedCreatePersistence.mockReturnValueOnce(pendingPersistence);

    const construction = createDormantBalanceSyncConsumerResource(
      dependencies(configuredInfrastructure),
    );
    const snapshot = mockedCreatePersistence.mock.calls[0]![0];
    expect(mockedCreateSqsReceipt).not.toHaveBeenCalled();

    configuredInfrastructure.database.poolMax = 99;
    configuredInfrastructure.sqs.visibilityTimeoutSeconds = 120;
    configuredInfrastructure.sqs.balanceQueueUrl = 'http://attacker.invalid/queue';
    resolvePersistence(capsules.persistenceResource);
    const resource = await construction;

    expect(mockedCreateSqsReceipt.mock.calls[0]![0]).toBe(snapshot);
    expect(snapshot.database.poolMax).toBe(4);
    expect(snapshot.sqs.visibilityTimeoutSeconds).toBe(30);
    expect(snapshot.sqs.balanceQueueUrl).toContain('crypto-lending-test-balance-sync');
    expect(mockedCreateComposition.mock.calls[0]![0].receiptPolicy).toEqual({
      visibilityTimeoutSeconds: 30,
    });
    await resource.close();
  });

  it('accepts the exact managed ECS credential mode without a local endpoint', async () => {
    arrangeCapsules();
    const infrastructure = infrastructureConfig();
    delete infrastructure.sqs.endpoint;
    infrastructure.sqs.credentialRelativeUri = '/v2/credentials/balance-consumer-task';

    const resource = await createDormantBalanceSyncConsumerResource(dependencies(infrastructure));
    const snapshot = mockedCreateSqsReceipt.mock.calls[0]![0];

    expect(snapshot.sqs).toMatchObject({
      credentialRelativeUri: '/v2/credentials/balance-consumer-task',
    });
    expect(snapshot.sqs).not.toHaveProperty('endpoint');
    expect(mockedCreatePersistence.mock.calls[0]![0]).toBe(snapshot);
    await resource.close();
  });

  it('does not inspect opaque RPC, observability, clock, or metric capabilities', async () => {
    arrangeCapsules();
    const traps: string[] = [];
    const opaque = <Value extends object>(name: string, value: Value): Value =>
      new Proxy(value, {
        get: (target, property, receiver) => {
          traps.push(`${name}:get:${String(property)}`);
          return Reflect.get(target, property, receiver) as unknown;
        },
        getOwnPropertyDescriptor: (target, property) => {
          traps.push(`${name}:descriptor:${String(property)}`);
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        getPrototypeOf: (target) => {
          traps.push(`${name}:prototype`);
          return Reflect.getPrototypeOf(target);
        },
        ownKeys: (target) => {
          traps.push(`${name}:keys`);
          return Reflect.ownKeys(target);
        },
      });
    const configured: DormantBalanceSyncConsumerResourceDependencies = {
      infrastructureConfig: infrastructureConfig(),
      balanceConsumerConfig: balanceConsumerConfig(),
      observability: opaque('observability', applicationObservability),
      ethereumTransport: opaque<BalanceJsonRpcTransport>('ethereum', {
        exchange: jest.fn(),
      }),
      solanaTransport: opaque<BalanceJsonRpcTransport>('solana', { exchange: jest.fn() }),
      clock: opaque<BalanceSyncClockPort>('clock', { now: jest.fn() }),
      metrics: opaque<BalanceSyncMetricsPort>('metrics', {
        record: jest.fn(),
        alert: jest.fn(),
      }),
    };

    await createDormantBalanceSyncConsumerResource(configured);

    expect(traps).toEqual([]);
  });

  it.each(['observability', 'ethereumTransport', 'solanaTransport', 'clock', 'metrics'] as const)(
    'rejects primitive %s capabilities before capsule allocation',
    async (name) => {
      for (const candidate of [null, undefined, 0, 'invalid', Symbol('invalid')]) {
        const configured = dependencies() as unknown as Record<string, unknown>;
        configured[name] = candidate;

        const error = await capturedRejection(() =>
          createDormantBalanceSyncConsumerResource(
            configured as unknown as DormantBalanceSyncConsumerResourceDependencies,
          ),
        );
        expectFixedError(error, 'Configuration');
      }
      expect(mockedCreatePersistence).not.toHaveBeenCalled();
      expect(mockedCreateSqsReceipt).not.toHaveBeenCalled();
    },
  );

  it('rejects hostile structural configuration without invoking accessors or allocating capsules', async () => {
    const accessorInfrastructure = infrastructureConfig();
    let accessorReads = 0;
    Object.defineProperty(accessorInfrastructure.sqs, 'visibilityTimeoutSeconds', {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorReads += 1;
        throw new Error('private visibility detail');
      },
    });
    const withSymbol = infrastructureConfig() as BalanceConsumerInfrastructureConfig & {
      [key: symbol]: unknown;
    };
    withSymbol[Symbol('surplus')] = true;
    const withSurplus = infrastructureConfig() as BalanceConsumerInfrastructureConfig & {
      surplus?: boolean;
    };
    withSurplus.surplus = true;
    const nonPlain = Object.assign(Object.create({ inherited: true }) as object, {
      ...infrastructureConfig(),
    }) as BalanceConsumerInfrastructureConfig;
    const revoked = Proxy.revocable(infrastructureConfig(), {});
    revoked.revoke();

    for (const candidate of [
      accessorInfrastructure,
      withSymbol,
      withSurplus,
      nonPlain,
      revoked.proxy,
    ]) {
      const error = await capturedRejection(() =>
        createDormantBalanceSyncConsumerResource(dependencies(candidate)),
      );
      expectFixedError(error, 'Configuration');
      expect(String(error)).not.toContain('private visibility detail');
    }
    expect(accessorReads).toBe(0);
    expect(mockedCreatePersistence).not.toHaveBeenCalled();
    expect(mockedCreateSqsReceipt).not.toHaveBeenCalled();
  });

  it('rejects accessor-backed or unbranded balance configuration without copying key authority', async () => {
    let keyRingReads = 0;
    const accessorConfig = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(accessorConfig, {
      mode: { enumerable: true, value: 'enabled' },
      walletMetadataSealKeys: {
        enumerable: true,
        get: () => {
          keyRingReads += 1;
          throw new Error('private key-ring detail');
        },
      },
    });
    const forgedConfig = Object.freeze({
      mode: 'enabled',
      walletMetadataSealKeys: Object.freeze({
        purpose: 'metadata-seal',
        activeWriteVersion: 1,
        keys: Object.freeze([]),
      }),
    });

    for (const candidate of [accessorConfig, forgedConfig]) {
      const configured = dependencies() as unknown as Record<string, unknown>;
      configured.balanceConsumerConfig = candidate;
      const error = await capturedRejection(() =>
        createDormantBalanceSyncConsumerResource(
          configured as unknown as DormantBalanceSyncConsumerResourceDependencies,
        ),
      );
      expectFixedError(error, 'Configuration');
      expect(String(error)).not.toContain('private key-ring detail');
    }
    expect(keyRingReads).toBe(0);
    expect(mockedCreatePersistence).not.toHaveBeenCalled();
    expect(mockedCreateSqsReceipt).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wrong workload',
      (value: BalanceConsumerInfrastructureConfig) =>
        ((value as unknown as { workload: string }).workload = 'worker'),
    ],
    [
      'wrong database role',
      (value: BalanceConsumerInfrastructureConfig) =>
        (value.database.sessionRole = 'crypto_api_runtime'),
    ],
    [
      'wrong receive count',
      (value: BalanceConsumerInfrastructureConfig) => (value.sqs.maxReceiveCount = 2),
    ],
    [
      'wrong retry base',
      (value: BalanceConsumerInfrastructureConfig) => (value.sqs.retryBaseDelaySeconds = 4),
    ],
    [
      'wrong retry maximum',
      (value: BalanceConsumerInfrastructureConfig) => (value.sqs.retryMaxDelaySeconds = 61),
    ],
    [
      'both credential modes',
      (value: BalanceConsumerInfrastructureConfig) =>
        (value.sqs.credentialRelativeUri = '/v2/credentials/balance-consumer'),
    ],
    [
      'neither credential mode',
      (value: BalanceConsumerInfrastructureConfig) => delete value.sqs.endpoint,
    ],
  ])('rejects %s before capsule allocation', async (_label, mutate) => {
    const infrastructure = infrastructureConfig();
    mutate(infrastructure);

    const error = await capturedRejection(() =>
      createDormantBalanceSyncConsumerResource(dependencies(infrastructure)),
    );

    expectFixedError(error, 'Configuration');
    expect(mockedCreatePersistence).not.toHaveBeenCalled();
    expect(mockedCreateSqsReceipt).not.toHaveBeenCalled();
  });

  it('unwinds partial construction in reverse and sanitizes the failure', async () => {
    const capsules = arrangeCapsules();
    const order: string[] = [];
    capsules.sqsClose.mockImplementation(async () => {
      order.push('sqs');
      throw new Error('private SQS close detail');
    });
    capsules.persistenceClose.mockImplementation(async () => {
      order.push('persistence');
    });
    mockedCreateComposition.mockImplementationOnce(() => {
      throw new Error('private composition detail');
    });

    const error = await capturedRejection(() =>
      createDormantBalanceSyncConsumerResource(dependencies()),
    );

    expectFixedError(error, 'Construction');
    expect(String(error)).not.toContain('private');
    expect(order).toEqual(['sqs', 'persistence']);
  });

  it('does not attempt SQS construction when persistence construction rejects', async () => {
    arrangeCapsules();
    mockedCreatePersistence.mockRejectedValueOnce(
      new Error('private persistence construction detail'),
    );

    const error = await capturedRejection(() =>
      createDormantBalanceSyncConsumerResource(dependencies()),
    );

    expectFixedError(error, 'Construction');
    expect(String(error)).not.toContain('private');
    expect(mockedCreateSqsReceipt).not.toHaveBeenCalled();
    expect(mockedCreateComposition).not.toHaveBeenCalled();
  });

  it('closes persistence when later SQS construction fails', async () => {
    const capsules = arrangeCapsules();
    mockedCreateSqsReceipt.mockRejectedValueOnce(new Error('private SQS construction detail'));

    const error = await capturedRejection(() =>
      createDormantBalanceSyncConsumerResource(dependencies()),
    );

    expectFixedError(error, 'Construction');
    expect(capsules.persistenceClose).toHaveBeenCalledTimes(1);
    expect(capsules.sqsClose).not.toHaveBeenCalled();
    expect(mockedCreateComposition).not.toHaveBeenCalled();
  });

  it('closes a malformed current child and its predecessor after retaining the closer', async () => {
    const capsules = arrangeCapsules();
    const order: string[] = [];
    const malformedSqsClose = jest.fn(async () => {
      order.push('sqs');
    });
    capsules.persistenceClose.mockImplementation(async () => {
      order.push('persistence');
    });
    mockedCreateSqsReceipt.mockResolvedValueOnce(
      frozenNullPrototype({
        receipt: frozenNullPrototype({ receive: jest.fn() }),
        close: malformedSqsClose,
      }) as unknown as Readonly<BalanceConsumerSqsReceiptResource>,
    );

    const error = await capturedRejection(() =>
      createDormantBalanceSyncConsumerResource(dependencies()),
    );

    expectFixedError(error, 'Construction');
    expect(order).toEqual(['sqs', 'persistence']);
    expect(malformedSqsClose).toHaveBeenCalledTimes(1);
    expect(mockedCreateComposition).not.toHaveBeenCalled();
  });

  it('bridges only caller cancellation into a private safe signal and consumes the one-shot run', async () => {
    const capsules = arrangeCapsules();
    let workerSignal: AbortSignal | undefined;
    capsules.receive.mockImplementation(
      async (_maximum: number, _wait: number, signal: AbortSignal) => {
        workerSignal = signal;
        if (signal.aborted) return [];
        await new Promise<void>((resolveAbort) =>
          signal.addEventListener('abort', () => resolveAbort(), { once: true }),
        );
        return [];
      },
    );
    const resource = await createDormantBalanceSyncConsumerResource(dependencies());
    const caller = new AbortController();
    const run = resource.run(caller.signal);
    await waitUntil(() => workerSignal !== undefined);
    expect(workerSignal).not.toBe(caller.signal);
    const concurrent = await capturedRejection(() => resource.run(new AbortController().signal));
    expectFixedError(concurrent, 'AlreadyStarted');

    let hostileReasonReads = 0;
    const hostileReason = new Proxy(Object.create(null) as object, {
      get: () => {
        hostileReasonReads += 1;
        throw new Error('private caller abort reason');
      },
      getPrototypeOf: () => {
        hostileReasonReads += 1;
        throw new Error('private caller abort reason');
      },
    });
    expect(() => caller.abort(hostileReason)).not.toThrow();
    await expect(run).resolves.toBeUndefined();

    expect(hostileReasonReads).toBe(0);
    expect(workerSignal?.aborted).toBe(true);
    expect(workerSignal?.reason).toMatchObject({ name: 'AbortError' });
    expect(workerSignal?.reason).not.toBe(hostileReason);
    const rerunError = await capturedRejection(() => resource.run(new AbortController().signal));
    expectFixedError(rerunError, 'AlreadyStarted');
  });

  it('does not consume the one-shot run for an invalid signal', async () => {
    const capsules = arrangeCapsules();
    const resource = await createDormantBalanceSyncConsumerResource(dependencies());

    const invalid = await capturedRejection(() => resource.run({} as AbortSignal));
    expectFixedError(invalid, 'Signal');
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(resource.run(alreadyAborted.signal)).resolves.toBeUndefined();
    expect(capsules.receive).not.toHaveBeenCalled();
    const rerun = await capturedRejection(() => resource.run(new AbortController().signal));
    expectFixedError(rerun, 'AlreadyStarted');
  });

  it('tracks a run before synchronous receipt reentrancy can close its capsules', async () => {
    const capsules = arrangeCapsules();
    const order: string[] = [];
    const holder: {
      resource?: Awaited<ReturnType<typeof createDormantBalanceSyncConsumerResource>>;
    } = {};
    let reentrantClose: Promise<void> | undefined;
    capsules.receive.mockImplementation(() => {
      reentrantClose = holder.resource!.close();
      return Promise.resolve([]);
    });
    capsules.sqsClose.mockImplementation(async () => {
      order.push('sqs');
    });
    capsules.persistenceClose.mockImplementation(async () => {
      order.push('persistence');
    });
    const resource = await createDormantBalanceSyncConsumerResource(dependencies());
    holder.resource = resource;

    const run = resource.run(new AbortController().signal);
    await waitUntil(() => reentrantClose !== undefined);
    expect(resource.close()).toBe(reentrantClose);
    await expect(run).resolves.toBeUndefined();
    await expect(reentrantClose).resolves.toBeUndefined();

    expect(order).toEqual(['sqs', 'persistence']);
  });

  it('publishes the close promise before a private abort listener can reenter close', async () => {
    const capsules = arrangeCapsules();
    const holder: {
      resource?: Awaited<ReturnType<typeof createDormantBalanceSyncConsumerResource>>;
    } = {};
    let consumerSignal: AbortSignal | undefined;
    let reentrantClose: Promise<void> | undefined;
    mockedCreateComposition.mockImplementationOnce(
      () =>
        ({
          consumer: {
            run: (signal: AbortSignal) => {
              consumerSignal = signal;
              return new Promise<void>((resolveRun) => {
                signal.addEventListener(
                  'abort',
                  () => {
                    reentrantClose = holder.resource!.close();
                    resolveRun();
                  },
                  { once: true },
                );
              });
            },
          },
        }) as unknown as ReturnType<typeof createBalanceSyncConsumerComposition>,
    );
    const resource = await createDormantBalanceSyncConsumerResource(dependencies());
    holder.resource = resource;
    const run = resource.run(new AbortController().signal);
    await waitUntil(() => consumerSignal !== undefined);

    const close = resource.close();
    expect(reentrantClose).toBe(close);
    await expect(run).resolves.toBeUndefined();
    await expect(close).resolves.toBeUndefined();
    expect(capsules.sqsClose).toHaveBeenCalledTimes(1);
    expect(capsules.persistenceClose).toHaveBeenCalledTimes(1);
  });

  it('aborts an accepted run but drains receipt handling before closing SQS then persistence', async () => {
    const capsules = arrangeCapsules();
    const order: string[] = [];
    let rejectCheckpoint: (reason?: unknown) => void = () => undefined;
    const checkpointPending = new Promise<never>((_resolve, reject) => {
      rejectCheckpoint = reject;
    });
    capsules.checkpointLoad.mockReturnValue(checkpointPending);
    capsules.changeVisibility.mockImplementation(async () => {
      order.push('receipt-settled');
    });
    capsules.sqsClose.mockImplementation(async () => {
      order.push('sqs-close');
    });
    capsules.persistenceClose.mockImplementation(async () => {
      order.push('persistence-close');
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
        id: 'aggregate-balance-job-1',
        occurredAt: '2026-09-05T11:59:00.000Z',
        correlation: { correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      },
    );
    const message: ReceivedQueueMessage = {
      messageId: 'aggregate-message-1',
      receiptHandle: 'aggregate-receipt-1',
      body: JSON.stringify(job),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    capsules.receive.mockResolvedValueOnce([message]);
    const resource = await createDormantBalanceSyncConsumerResource(dependencies());
    const run = resource.run(new AbortController().signal);
    await waitUntil(() => capsules.checkpointLoad.mock.calls.length === 1);

    const firstClose = resource.close();
    const secondClose = resource.close();
    expect(firstClose).toBe(secondClose);
    await Promise.resolve();
    expect(capsules.sqsClose).not.toHaveBeenCalled();
    expect(capsules.persistenceClose).not.toHaveBeenCalled();

    rejectCheckpoint(new Error('private checkpoint failure'));
    await expect(run).resolves.toBeUndefined();
    await expect(firstClose).resolves.toBeUndefined();

    expect(capsules.changeVisibility).toHaveBeenCalledWith(message, 5, expect.any(AbortSignal));
    expect(capsules.deleteReceipt).not.toHaveBeenCalled();
    expect(order).toEqual(['receipt-settled', 'sqs-close', 'persistence-close']);
    const lateRun = await capturedRejection(() => resource.run(new AbortController().signal));
    expectFixedError(lateRun, 'Closed');
  });

  it('memoizes a fixed close failure while attempting both child closes in order', async () => {
    const capsules = arrangeCapsules();
    const order: string[] = [];
    capsules.sqsClose.mockImplementation(() => {
      order.push('sqs');
      throw new Error('private SQS close failure');
    });
    capsules.persistenceClose.mockImplementation(async () => {
      order.push('persistence');
      throw new Error('private persistence close failure');
    });
    const resource = await createDormantBalanceSyncConsumerResource(dependencies());

    const first = resource.close();
    const second = resource.close();
    expect(first).toBe(second);
    const error = await capturedRejection(() => first);

    expectFixedError(error, 'Close');
    expect(String(error)).not.toContain('private');
    expect(order).toEqual(['sqs', 'persistence']);
    expect(resource.close()).toBe(first);
  });

  it('sanitizes unexpected consumer failures and remains one-shot', async () => {
    const capsules = arrangeCapsules();
    mockedCreateComposition.mockImplementationOnce(
      () =>
        ({
          consumer: {
            run: () => Promise.reject(new Error('private consumer failure')),
          },
        }) as unknown as ReturnType<typeof createBalanceSyncConsumerComposition>,
    );
    const resource = await createDormantBalanceSyncConsumerResource(dependencies());

    const error = await capturedRejection(() => resource.run(new AbortController().signal));
    expectFixedError(error, 'Run');
    expect(String(error)).not.toContain('private');
    const rerun = await capturedRejection(() => resource.run(new AbortController().signal));
    expectFixedError(rerun, 'AlreadyStarted');
    await expect(resource.close()).resolves.toBeUndefined();
    expect(capsules.sqsClose).toHaveBeenCalledTimes(1);
    expect(capsules.persistenceClose).toHaveBeenCalledTimes(1);
  });

  it('remains absent from every launch and export root', () => {
    const launchRoots = [
      resolve(__dirname, '../blockchain-sync.module.ts'),
      resolve(__dirname, '../index.ts'),
      resolve(__dirname, 'balance-sync-consumer.runtime.ts'),
      resolve(__dirname, 'balance-sync-consumer.cli.ts'),
      resolve(__dirname, 'balance-sync-consumer.cli-mode.ts'),
      resolve(__dirname, 'balance-sync-consumer.activation.ts'),
      resolve(__dirname, '../../main.ts'),
    ];

    for (const path of launchRoots) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toContain('createDormantBalanceSyncConsumerResource');
      expect(source).not.toContain('balance-sync-consumer.resource');
    }
  });
});
