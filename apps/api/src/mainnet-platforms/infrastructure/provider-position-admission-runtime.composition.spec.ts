import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Pool } from 'pg';

import { RegisteredPortfolioWalletReader } from '../../portfolio/infrastructure/registered-portfolio-wallet-reader';
import { PostgresService } from '../../infrastructure/database/postgres.service';
import type { RuntimePostgresPoolConfig } from '../../infrastructure/database/runtime-postgres-pool';
import { WalletRegistrationService } from '../../wallets/application/wallet-registration.service';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
} from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import type { EnabledWalletRegistrationConfig } from '../../wallets/infrastructure/config/wallet-registration.config';
import { PostgresWalletRegistrationRepository } from '../../wallets/infrastructure/postgres/postgres-wallet-registration.repository';
import {
  DormantProviderPositionAdmissionCoordinator,
  type ProviderPositionAdmissionOptions,
  type ProviderPositionAdmissionSourceBinding,
} from '../application/provider-position-admission.coordinator';
import type { ProviderPositionTrustedChainAssessmentAssemblyPort } from '../application/ports/provider-position-trusted-chain-assessment-assembly.port';
import { NodeProviderPositionAdmissionDeadlineRunner } from './node-provider-position-admission-deadline.runner';
import {
  createDormantProviderPositionAdmissionRuntimeResource,
  ProviderPositionAdmissionRuntimeBoundsError,
  type DormantProviderPositionAdmissionRuntimeResource,
} from './provider-position-admission-runtime-bounds';
import {
  createDormantProviderPositionAdmissionRuntimeComposition,
  ProviderPositionAdmissionRuntimeCompositionError,
  type DormantProviderPositionAdmissionRuntimeCompositionDependencies,
} from './provider-position-admission-runtime.composition';

jest.mock('./provider-position-admission-runtime-bounds', () => {
  class MockRuntimeBoundsError extends Error {
    constructor(readonly code: string) {
      super('Provider-position admission runtime is unavailable.');
      this.name = 'ProviderPositionAdmissionRuntimeBoundsError';
    }
  }
  return {
    createDormantProviderPositionAdmissionRuntimeResource: jest.fn(),
    ProviderPositionAdmissionRuntimeBoundsError: MockRuntimeBoundsError,
  };
});
jest.mock('../../infrastructure/database/postgres.service', () => ({
  PostgresService: jest.fn(),
}));
jest.mock('../../wallets/infrastructure/postgres/postgres-wallet-registration.repository', () => ({
  PostgresWalletRegistrationRepository: jest.fn(),
}));
jest.mock('../../wallets/application/wallet-registration.service', () => ({
  WalletRegistrationService: jest.fn(),
}));
jest.mock('../../portfolio/infrastructure/registered-portfolio-wallet-reader', () => ({
  RegisteredPortfolioWalletReader: jest.fn(),
}));
jest.mock('./node-provider-position-admission-deadline.runner', () => ({
  NodeProviderPositionAdmissionDeadlineRunner: jest.fn(),
}));
jest.mock('../application/provider-position-admission.coordinator', () => ({
  DormantProviderPositionAdmissionCoordinator: jest.fn(),
}));

const mockedRuntimeResource = jest.mocked(createDormantProviderPositionAdmissionRuntimeResource);
const MockedPostgresService = jest.mocked(PostgresService);
const MockedWalletRepository = jest.mocked(PostgresWalletRegistrationRepository);
const MockedWalletService = jest.mocked(WalletRegistrationService);
const MockedWalletReader = jest.mocked(RegisteredPortfolioWalletReader);
const MockedDeadlineRunner = jest.mocked(NodeProviderPositionAdmissionDeadlineRunner);
const MockedCoordinator = jest.mocked(DormantProviderPositionAdmissionCoordinator);

const POLICY_FINGERPRINT = 'a'.repeat(64);
const ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';
const CORRELATION_ID = 'provider-position-composition-test';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return Object.freeze({ promise, resolve: resolvePromise });
}

const IDENTITY_RING = createWalletRegistrationKeyRing('identity-hmac', 1, [
  createWalletRegistrationKey(
    'identity-hmac',
    1,
    Buffer.alloc(32, 1).toString('base64url'),
    'provider-composition-identity-v1',
  ),
]);
const CHALLENGE_RING = createWalletRegistrationKeyRing('challenge-hmac', 1, [
  createWalletRegistrationKey(
    'challenge-hmac',
    1,
    Buffer.alloc(32, 2).toString('base64url'),
    'provider-composition-challenge-v1',
  ),
]);
const METADATA_RING = createWalletRegistrationKeyRing('metadata-seal', 1, [
  createWalletRegistrationKey(
    'metadata-seal',
    1,
    Buffer.alloc(32, 3).toString('base64url'),
    'provider-composition-metadata-v1',
  ),
]);

function walletConfig(): EnabledWalletRegistrationConfig {
  return Object.freeze({
    mode: 'enabled',
    publicOrigin: 'https://app.example.test',
    registryEnvironment: 'MAINNET',
    challengeTtlSeconds: 120,
    identityHmacKeys: IDENTITY_RING,
    challengeHmacKeys: CHALLENGE_RING,
    metadataSealKeys: METADATA_RING,
  });
}

function postgresConfig(): RuntimePostgresPoolConfig {
  return {
    workload: 'api',
    database: {
      connectionString: 'postgresql://crypto_api_login_a:test@localhost:5432/crypto_lending',
      connectionTimeoutMs: 2_500,
      idleTimeoutMs: 30_000,
      lockTimeoutMs: 5_000,
      maxLifetimeSeconds: 1_800,
      poolMax: 10,
      statementTimeoutMs: 15_000,
      ssl: false,
      sessionRole: 'crypto_api_runtime',
    },
  };
}

function options(): ProviderPositionAdmissionOptions {
  return { deadlineMilliseconds: 5_000, maximumConcurrency: 2 };
}

function sourceBindings(): readonly ProviderPositionAdmissionSourceBinding[] {
  return [
    {
      sourceFamilyId: 'rpc-operator-a',
      sourceId: 'rpc-a',
      sourceKind: 'RPC',
      networkId: 'eip155:1',
      source: { readTarget: jest.fn() },
    },
    {
      sourceFamilyId: 'indexer-operator-b',
      sourceId: 'indexer-b',
      sourceKind: 'INDEXER',
      networkId: 'eip155:1',
      source: { readTarget: jest.fn() },
    },
  ];
}

const trustedAssembly = Object.freeze({
  assemblyVersion: 1,
  assemble: jest.fn(),
  verifyAssembly: jest.fn(),
  verify: jest.fn(),
}) as ProviderPositionTrustedChainAssessmentAssemblyPort;

function dependencies(
  overrides: Partial<DormantProviderPositionAdmissionRuntimeCompositionDependencies> = {},
): DormantProviderPositionAdmissionRuntimeCompositionDependencies {
  return {
    postgresConfig: postgresConfig(),
    admissionOptions: options(),
    walletRegistrationConfig: walletConfig(),
    policyInput: Object.freeze({ policy: 'test-only' }),
    requiredPolicyFingerprintSha256: POLICY_FINGERPRINT,
    sourceBindings: sourceBindings(),
    clock: { now: jest.fn(() => new Date('2026-09-05T21:00:00.000Z')) },
    trustedChainAssessmentAssembly: trustedAssembly,
    ...overrides,
  };
}

describe('createDormantProviderPositionAdmissionRuntimeComposition', () => {
  const poolEnd = jest.fn();
  const pool = { end: poolEnd } as unknown as Pool;
  const closePostgres = jest.fn();
  const postgres = { closeCancellableQueries: closePostgres } as unknown as PostgresService;
  const walletRepository = {} as PostgresWalletRegistrationRepository;
  const walletService = {} as WalletRegistrationService;
  const walletReader = {} as RegisteredPortfolioWalletReader;
  const deadlineRunner = {} as NodeProviderPositionAdmissionDeadlineRunner;
  const coordinatorAdmit = jest.fn();
  const coordinatorAssemble = jest.fn();
  const coordinatorClose = jest.fn();
  const coordinator = {
    admit: coordinatorAdmit,
    admitAndAssemble: coordinatorAssemble,
    closeAdmission: coordinatorClose,
  } as unknown as DormantProviderPositionAdmissionCoordinator;
  let reviewedOptions: Readonly<ProviderPositionAdmissionOptions>;

  beforeEach(() => {
    jest.clearAllMocks();
    reviewedOptions = Object.freeze(
      Object.assign(Object.create(null), options()),
    ) as Readonly<ProviderPositionAdmissionOptions>;
    const runtime = Object.freeze(
      Object.assign(Object.create(null), {
        pool,
        admissionOptions: reviewedOptions,
      }),
    ) as DormantProviderPositionAdmissionRuntimeResource;
    mockedRuntimeResource.mockReturnValue(runtime);
    poolEnd.mockResolvedValue(undefined);
    closePostgres.mockResolvedValue(undefined);
    coordinatorAdmit.mockResolvedValue(Object.freeze({ candidate: true }));
    coordinatorAssemble.mockResolvedValue(Object.freeze({ assembly: true }));
    MockedPostgresService.mockImplementation(() => postgres);
    MockedWalletRepository.mockImplementation(() => walletRepository);
    MockedWalletService.mockImplementation(() => walletService);
    MockedWalletReader.mockImplementation(() => walletReader);
    MockedDeadlineRunner.mockImplementation(() => deadlineRunner);
    MockedCoordinator.mockImplementation(() => coordinator);
  });

  it('uses the exact budget resource pool and options through the private direct graph', async () => {
    const input = dependencies();
    const composition = await createDormantProviderPositionAdmissionRuntimeComposition(input);

    expect(mockedRuntimeResource).toHaveBeenCalledWith(
      input.postgresConfig,
      input.admissionOptions,
    );
    expect(MockedPostgresService).toHaveBeenCalledWith(pool);
    expect(MockedWalletRepository).toHaveBeenCalledWith(postgres);
    const walletServiceArguments = MockedWalletService.mock.calls[0];
    expect(walletServiceArguments?.[0]).toBe(walletRepository);
    expect(walletServiceArguments?.[1]).toEqual(input.walletRegistrationConfig);
    expect(walletServiceArguments?.[1]).not.toBe(input.walletRegistrationConfig);
    expect(Object.isFrozen(walletServiceArguments?.[1])).toBe(true);
    expect(MockedWalletReader).toHaveBeenCalledWith(walletService);

    const capturedClock = MockedDeadlineRunner.mock.calls[0]?.[0];
    expect(capturedClock).toBeDefined();
    expect(capturedClock).not.toBe(input.clock);
    expect(Object.getPrototypeOf(capturedClock as object)).toBeNull();
    expect(Object.isFrozen(capturedClock)).toBe(true);
    expect(MockedWalletService.mock.calls[0]?.[2]).toBe(capturedClock);
    expect(MockedCoordinator).toHaveBeenCalledWith(
      input.policyInput,
      input.requiredPolicyFingerprintSha256,
      expect.any(Array),
      walletReader,
      capturedClock,
      deadlineRunner,
      reviewedOptions,
      trustedAssembly,
    );
    expect(MockedCoordinator.mock.calls[0]?.[6]).toBe(reviewedOptions);

    expect(Reflect.ownKeys(composition)).toEqual(['admit', 'admitAndAssemble', 'close']);
    expect(Object.getPrototypeOf(composition)).toBeNull();
    expect(Object.isFrozen(composition)).toBe(true);
    expect(poolEnd).not.toHaveBeenCalled();
    expect(closePostgres).not.toHaveBeenCalled();
    expect(coordinatorClose).not.toHaveBeenCalled();
    expect(coordinatorAdmit).not.toHaveBeenCalled();
    expect(coordinatorAssemble).not.toHaveBeenCalled();

    const constructionOrder = [
      mockedRuntimeResource,
      MockedPostgresService,
      MockedWalletRepository,
      MockedWalletService,
      MockedWalletReader,
      MockedDeadlineRunner,
      MockedCoordinator,
    ].map((mock) => mock.mock.invocationCallOrder[0] as number);
    expect(constructionOrder).toEqual([...constructionOrder].sort((left, right) => left - right));

    await composition.close();
  });

  it('delegates only through the narrow facade and preserves request identity', async () => {
    const composition =
      await createDormantProviderPositionAdmissionRuntimeComposition(dependencies());
    const request = Object.freeze({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID });

    await expect(composition.admit(request as never)).resolves.toEqual({ candidate: true });
    await expect(composition.admitAndAssemble(request as never)).resolves.toEqual({
      assembly: true,
    });
    expect(coordinatorAdmit).toHaveBeenCalledWith(request);
    expect(coordinatorAssemble).toHaveBeenCalledWith(request);

    await composition.close();
  });

  it('closes admission synchronously, drains admitted work, then ends the exact pool once', async () => {
    const pending = deferred<Readonly<{ candidate: true }>>();
    coordinatorAdmit.mockReturnValueOnce(pending.promise);
    const composition =
      await createDormantProviderPositionAdmissionRuntimeComposition(dependencies());
    const request = Object.freeze({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID });
    const admission = composition.admit(request as never);
    await Promise.resolve();
    expect(coordinatorAdmit).toHaveBeenCalledTimes(1);

    const firstClose = composition.close();
    const secondClose = composition.close();
    expect(secondClose).toBe(firstClose);
    expect(coordinatorClose).toHaveBeenCalledTimes(1);
    expect(closePostgres).toHaveBeenCalledTimes(1);
    expect(poolEnd).not.toHaveBeenCalled();
    await expect(composition.admit(request as never)).rejects.toMatchObject({
      name: 'ProviderPositionAdmissionRuntimeCompositionError',
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSED',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(coordinatorAdmit).toHaveBeenCalledTimes(1);

    pending.resolve(Object.freeze({ candidate: true }));
    await expect(admission).resolves.toEqual({ candidate: true });
    await expect(firstClose).resolves.toBeUndefined();
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(closePostgres.mock.invocationCallOrder[0]).toBeLessThan(
      poolEnd.mock.invocationCallOrder[0] as number,
    );
    expect(coordinatorClose.mock.invocationCallOrder[0]).toBeLessThan(
      closePostgres.mock.invocationCallOrder[0] as number,
    );
  });

  it('attempts pool shutdown and returns a fixed error after PostgreSQL drain failure', async () => {
    closePostgres.mockRejectedValueOnce(new Error('private database drain detail'));
    const composition =
      await createDormantProviderPositionAdmissionRuntimeComposition(dependencies());

    await expect(composition.close()).rejects.toMatchObject({
      name: 'ProviderPositionAdmissionRuntimeCompositionError',
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSE_FAILED',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('still drains and ends the pool when coordinator cancellation fails', async () => {
    coordinatorClose.mockImplementationOnce(() => {
      throw new Error('private coordinator close detail');
    });
    const composition =
      await createDormantProviderPositionAdmissionRuntimeComposition(dependencies());

    await expect(composition.close()).rejects.toMatchObject({
      name: 'ProviderPositionAdmissionRuntimeCompositionError',
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSE_FAILED',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(closePostgres).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('drains and ends the exact pool when downstream construction fails', async () => {
    MockedCoordinator.mockImplementationOnce(() => {
      throw new Error('private policy construction detail');
    });

    await expect(
      createDormantProviderPositionAdmissionRuntimeComposition(dependencies()),
    ).rejects.toMatchObject({
      name: 'ProviderPositionAdmissionRuntimeCompositionError',
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(closePostgres).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(closePostgres.mock.invocationCallOrder[0]).toBeLessThan(
      poolEnd.mock.invocationCallOrder[0] as number,
    );
  });

  it('maps reviewed runtime-bound failures without constructing downstream services', async () => {
    mockedRuntimeResource.mockImplementationOnce(() => {
      throw new ProviderPositionAdmissionRuntimeBoundsError(
        'PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID',
      );
    });

    await expect(
      createDormantProviderPositionAdmissionRuntimeComposition(dependencies()),
    ).rejects.toMatchObject({
      name: 'ProviderPositionAdmissionRuntimeCompositionError',
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(MockedPostgresService).not.toHaveBeenCalled();
    expect(poolEnd).not.toHaveBeenCalled();
  });

  it('maps runtime pool-construction failure to the fixed composition error', async () => {
    mockedRuntimeResource.mockImplementationOnce(() => {
      throw new ProviderPositionAdmissionRuntimeBoundsError(
        'PROVIDER_POSITION_ADMISSION_RUNTIME_CONSTRUCTION_FAILED',
      );
    });

    await expect(
      createDormantProviderPositionAdmissionRuntimeComposition(dependencies()),
    ).rejects.toMatchObject({
      name: 'ProviderPositionAdmissionRuntimeCompositionError',
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(MockedPostgresService).not.toHaveBeenCalled();
    expect(poolEnd).not.toHaveBeenCalled();
  });

  it('rejects missing, extra, and proxy dependency records before runtime allocation', async () => {
    const missing = dependencies() as unknown as Record<PropertyKey, unknown>;
    delete missing.clock;
    const extra = Object.assign(dependencies(), { poolFallback: true });
    let proxyReads = 0;
    const proxy = new Proxy(dependencies(), {
      get: () => {
        proxyReads += 1;
        throw new Error('private proxy detail');
      },
    });

    for (const input of [missing, extra, proxy]) {
      await expect(
        createDormantProviderPositionAdmissionRuntimeComposition(
          input as DormantProviderPositionAdmissionRuntimeCompositionDependencies,
        ),
      ).rejects.toMatchObject({
        code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID',
        message: 'Provider-position admission composition is unavailable.',
      });
    }
    expect(proxyReads).toBe(0);
    expect(mockedRuntimeResource).not.toHaveBeenCalled();
  });

  it('rejects accessors before pool-resource construction without invoking them', async () => {
    let reads = 0;
    const input = dependencies() as unknown as Record<PropertyKey, unknown>;
    Object.defineProperty(input, 'clock', {
      enumerable: true,
      get: () => {
        reads += 1;
        return { now: () => new Date() };
      },
    });

    await expect(
      createDormantProviderPositionAdmissionRuntimeComposition(
        input as unknown as DormantProviderPositionAdmissionRuntimeCompositionDependencies,
      ),
    ).rejects.toBeInstanceOf(ProviderPositionAdmissionRuntimeCompositionError);
    expect(reads).toBe(0);
    expect(mockedRuntimeResource).not.toHaveBeenCalled();
  });

  it('rejects clock proxy prototypes and callable proxies without invoking traps', async () => {
    let traps = 0;
    const clockPrototypeProxy = new Proxy(Object.create(null) as object, {
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error('private clock prototype detail');
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error('private clock prototype detail');
      },
    });
    const inheritedProxyClock = Object.create(clockPrototypeProxy) as {
      now: () => Date;
    };
    const proxiedNow = new Proxy(() => new Date('2026-09-05T21:00:00.000Z'), {
      apply: () => {
        traps += 1;
        throw new Error('private clock callable detail');
      },
    });

    for (const clock of [inheritedProxyClock, { now: proxiedNow }]) {
      await expect(
        createDormantProviderPositionAdmissionRuntimeComposition(dependencies({ clock })),
      ).rejects.toMatchObject({
        code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID',
        message: 'Provider-position admission composition is unavailable.',
      });
    }
    expect(traps).toBe(0);
    expect(mockedRuntimeResource).not.toHaveBeenCalled();
  });

  it('rejects a proxied PostgreSQL lifecycle method without invoking its trap', async () => {
    let traps = 0;
    const proxiedClosePostgres = new Proxy(async (): Promise<void> => undefined, {
      apply: () => {
        traps += 1;
        throw new Error('private PostgreSQL close proxy detail');
      },
    });
    MockedPostgresService.mockImplementationOnce(
      () =>
        ({
          closeCancellableQueries: proxiedClosePostgres,
        }) as unknown as PostgresService,
    );

    await expect(
      createDormantProviderPositionAdmissionRuntimeComposition(dependencies()),
    ).rejects.toMatchObject({
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(traps).toBe(0);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('rejects proxied coordinator facade methods and rolls back without invoking traps', async () => {
    let traps = 0;
    const proxiedCloseAdmission = new Proxy((): void => undefined, {
      apply: () => {
        traps += 1;
        throw new Error('private coordinator close proxy detail');
      },
    });
    MockedCoordinator.mockImplementationOnce(
      () =>
        ({
          admit: coordinatorAdmit,
          admitAndAssemble: coordinatorAssemble,
          closeAdmission: proxiedCloseAdmission,
        }) as unknown as DormantProviderPositionAdmissionCoordinator,
    );

    await expect(
      createDormantProviderPositionAdmissionRuntimeComposition(dependencies()),
    ).rejects.toMatchObject({
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(traps).toBe(0);
    expect(closePostgres).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('memoizes a fixed close rejection when ending the exact pool fails', async () => {
    poolEnd.mockRejectedValueOnce(new Error('private pool shutdown detail'));
    const composition =
      await createDormantProviderPositionAdmissionRuntimeComposition(dependencies());

    const firstClose = composition.close();
    const secondClose = composition.close();
    expect(secondClose).toBe(firstClose);
    await expect(firstClose).rejects.toMatchObject({
      name: 'ProviderPositionAdmissionRuntimeCompositionError',
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSE_FAILED',
      message: 'Provider-position admission composition is unavailable.',
    });
    await expect(secondClose).rejects.toBeInstanceOf(
      ProviderPositionAdmissionRuntimeCompositionError,
    );
    expect(closePostgres).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('ends the pool when construction fails before PostgresService exists', async () => {
    MockedPostgresService.mockImplementationOnce(() => {
      throw new Error('private postgres construction detail');
    });

    await expect(
      createDormantProviderPositionAdmissionRuntimeComposition(dependencies()),
    ).rejects.toMatchObject({
      code: 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED',
      message: 'Provider-position admission composition is unavailable.',
    });
    expect(closePostgres).not.toHaveBeenCalled();
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('has no environment, registration, transport, query, or provider activation surface', () => {
    const source = readFileSync(
      resolve(__dirname, 'provider-position-admission-runtime.composition.ts'),
      'utf8',
    );
    const featureModule = readFileSync(
      resolve(__dirname, '../mainnet-platforms.module.ts'),
      'utf8',
    );
    const featureBarrel = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');

    expect(source).not.toMatch(
      /@Module|@Injectable|process\.env|loadInfrastructureConfig|NestFactory|\.connect\s*\(|\.query\s*\(|fetch\s*\(|WebSocket/u,
    );
    expect(featureModule).not.toContain('ProviderPositionAdmissionRuntimeComposition');
    expect(featureBarrel).not.toContain('provider-position-admission-runtime.composition');
  });

  it('drives an unmocked empty roster through the exact pool-backed wallet chain', async () => {
    jest.resetModules();
    jest.dontMock('./provider-position-admission-runtime-bounds');
    jest.dontMock('../../infrastructure/database/postgres.service');
    jest.dontMock('../../wallets/infrastructure/postgres/postgres-wallet-registration.repository');
    jest.dontMock('../../wallets/application/wallet-registration.service');
    jest.dontMock('../../portfolio/infrastructure/registered-portfolio-wallet-reader');
    jest.dontMock('./node-provider-position-admission-deadline.runner');
    jest.dontMock('../application/provider-position-admission.coordinator');

    const clientQuery = jest.fn().mockResolvedValue({ rows: [] });
    const clientRelease = jest.fn();
    const client = Object.freeze({ query: clientQuery, release: clientRelease });
    const poolConnect = jest.fn().mockResolvedValue(client);
    const isolatedPoolEnd = jest.fn().mockResolvedValue(undefined);
    const emitter = new EventEmitter();
    const isolatedPool = Object.assign(emitter, {
      connect: poolConnect,
      end: isolatedPoolEnd,
    }) as unknown as Pool;
    const isolatedCreatePool = jest.fn(() => isolatedPool);
    jest.doMock('../../infrastructure/database/runtime-postgres-pool', () => ({
      createPostgresPool: isolatedCreatePool,
    }));

    await jest.isolateModulesAsync(async () => {
      const [
        actualCompositionModule,
        accountProfileModule,
        assetRegistryModule,
        observationPolicyModule,
        walletCryptoModule,
      ] = await Promise.all([
        import('./provider-position-admission-runtime.composition'),
        import('../../accounts/domain/account-profile'),
        import('../../blockchain/domain/supported-asset-registry'),
        import('../domain/mainnet-provider-position-observation-policy'),
        import('../../wallets/infrastructure/crypto/wallet-registration-crypto'),
      ]);
      const isolatedIdentityRing = walletCryptoModule.createWalletRegistrationKeyRing(
        'identity-hmac',
        1,
        [
          walletCryptoModule.createWalletRegistrationKey(
            'identity-hmac',
            1,
            Buffer.alloc(32, 1).toString('base64url'),
            'provider-composition-identity-v1',
          ),
        ],
      );
      const isolatedChallengeRing = walletCryptoModule.createWalletRegistrationKeyRing(
        'challenge-hmac',
        1,
        [
          walletCryptoModule.createWalletRegistrationKey(
            'challenge-hmac',
            1,
            Buffer.alloc(32, 2).toString('base64url'),
            'provider-composition-challenge-v1',
          ),
        ],
      );
      const isolatedMetadataRing = walletCryptoModule.createWalletRegistrationKeyRing(
        'metadata-seal',
        1,
        [
          walletCryptoModule.createWalletRegistrationKey(
            'metadata-seal',
            1,
            Buffer.alloc(32, 3).toString('base64url'),
            'provider-composition-metadata-v1',
          ),
        ],
      );
      const isolatedWalletConfig = Object.freeze({
        mode: 'enabled' as const,
        publicOrigin: 'https://app.example.test',
        registryEnvironment: 'MAINNET' as const,
        challengeTtlSeconds: 120,
        identityHmacKeys: isolatedIdentityRing,
        challengeHmacKeys: isolatedChallengeRing,
        metadataSealKeys: isolatedMetadataRing,
      });
      const registry = assetRegistryModule.MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
      const policyContent = {
        policyVersion: observationPolicyModule.MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
        use: observationPolicyModule.MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
        policyId: 'empty-roster-composition-policy-v1',
        assetRegistryVersion: registry.version,
        assetRegistryFingerprintSha256: registry.fingerprintSha256,
        providers: [
          {
            providerId: 'aave',
            protocols: [
              {
                protocolId: 'aave-v3',
                markets: [
                  {
                    networkId: 'eip155:1',
                    marketId: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
                    assets: [
                      {
                        stablecoin: 'USDC',
                        identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        sources: [
          { sourceId: 'rpc-a', sourceKind: 'RPC', networkId: 'eip155:1' },
          { sourceId: 'indexer-b', sourceKind: 'INDEXER', networkId: 'eip155:1' },
        ],
      };
      const policy = Object.freeze({
        ...policyContent,
        fingerprintSha256:
          observationPolicyModule.mainnetProviderPositionObservationPolicyFingerprintV1(
            policyContent,
          ),
      });
      const readers = sourceBindings();
      const composition =
        await actualCompositionModule.createDormantProviderPositionAdmissionRuntimeComposition({
          postgresConfig: postgresConfig(),
          admissionOptions: options(),
          walletRegistrationConfig: isolatedWalletConfig,
          policyInput: policy,
          requiredPolicyFingerprintSha256: policy.fingerprintSha256,
          sourceBindings: readers,
          clock: { now: () => new Date('2026-09-05T21:00:00.000Z') },
        });

      expect(poolConnect).not.toHaveBeenCalled();
      expect(clientQuery).not.toHaveBeenCalled();

      const result = await composition.admit({
        accountId: accountProfileModule.parseAccountId(ACCOUNT_ID),
        correlationId: CORRELATION_ID,
      });
      expect(result.targets).toEqual([]);
      expect(result.coverageManifest.targets).toEqual([]);
      expect(isolatedCreatePool).toHaveBeenCalledTimes(1);
      expect(poolConnect).toHaveBeenCalledTimes(1);
      expect(clientQuery).toHaveBeenCalledTimes(1);
      expect(clientQuery.mock.calls[0]?.[0]).toContain(
        'list_active_wallet_registrations_rotatable',
      );
      expect(clientRelease).toHaveBeenCalledTimes(1);
      expect(
        readers.every(({ source }) => jest.mocked(source.readTarget).mock.calls.length === 0),
      ).toBe(true);
      await composition.close();
      expect(isolatedPoolEnd).toHaveBeenCalledTimes(1);
    });
  });
});
