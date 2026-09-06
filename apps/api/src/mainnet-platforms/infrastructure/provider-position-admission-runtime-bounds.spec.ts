import type { Pool } from 'pg';

import type { DatabaseInfrastructureConfig } from '../../infrastructure/config/infrastructure.config';
import {
  createPostgresPool,
  type RuntimePostgresPoolConfig,
} from '../../infrastructure/database/runtime-postgres-pool';
import type { ProviderPositionAdmissionOptions } from '../application/provider-position-admission.coordinator';
import {
  createDormantProviderPositionAdmissionRuntimeResource,
  PROVIDER_POSITION_ADMISSION_MAX_CONCURRENCY,
  PROVIDER_POSITION_ADMISSION_MAX_DEADLINE_MILLISECONDS,
  ProviderPositionAdmissionRuntimeBoundsError,
} from './provider-position-admission-runtime-bounds';

jest.mock('../../infrastructure/database/runtime-postgres-pool', () => ({
  createPostgresPool: jest.fn(),
}));

const mockedCreatePostgresPool = jest.mocked(createPostgresPool);
const POOL = Object.freeze({ end: jest.fn() }) as unknown as Pool;

type MutableRecord = Record<PropertyKey, unknown>;

function databaseConfig(
  overrides: Partial<DatabaseInfrastructureConfig> = {},
): DatabaseInfrastructureConfig {
  return {
    connectionString: 'postgresql://crypto_api_login_a:test@localhost:5432/crypto_lending',
    connectionTimeoutMs: 2_500,
    idleTimeoutMs: 30_000,
    lockTimeoutMs: 5_000,
    maxLifetimeSeconds: 1_800,
    poolMax: 10,
    statementTimeoutMs: 15_000,
    ssl: { rejectUnauthorized: true, ca: 'test-ca' },
    sessionRole: 'crypto_api_runtime',
    ...overrides,
  };
}

function postgresConfig(
  database: DatabaseInfrastructureConfig = databaseConfig(),
): RuntimePostgresPoolConfig {
  return { workload: 'api', database };
}

function admissionOptions(
  overrides: Partial<ProviderPositionAdmissionOptions> = {},
): ProviderPositionAdmissionOptions {
  return { deadlineMilliseconds: 5_000, maximumConcurrency: 2, ...overrides };
}

function expectInvalid(
  action: () => unknown,
  code = 'PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID',
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderPositionAdmissionRuntimeBoundsError);
    expect(error).toMatchObject({
      name: 'ProviderPositionAdmissionRuntimeBoundsError',
      code,
      message: 'Provider-position admission runtime is unavailable.',
    });
    expect(error).not.toHaveProperty('cause');
    return;
  }
  throw new Error('Expected runtime resource construction to fail');
}

describe('createDormantProviderPositionAdmissionRuntimeResource', () => {
  beforeEach(() => {
    mockedCreatePostgresPool.mockReset();
    mockedCreatePostgresPool.mockReturnValue(POOL);
  });

  it.each([
    ['lower inclusive boundary', 1, 1],
    ['smaller', 2_500, 5_000],
    ['equal', 5_000, 5_000],
    ['upper inclusive boundary', 30_000, 30_000],
  ] as const)(
    'constructs from a %s connection timeout',
    (_label, connectionTimeoutMs, deadlineMilliseconds) => {
      const inputDatabase = databaseConfig({ connectionTimeoutMs });
      const inputSsl = inputDatabase.ssl;
      const inputOptions = admissionOptions({ deadlineMilliseconds, maximumConcurrency: 8 });

      const resource = createDormantProviderPositionAdmissionRuntimeResource(
        postgresConfig(inputDatabase),
        inputOptions,
      );

      expect(resource.pool).toBe(POOL);
      expect(resource.admissionOptions).toEqual({ deadlineMilliseconds, maximumConcurrency: 8 });
      expect(Object.getPrototypeOf(resource)).toBeNull();
      expect(Object.isFrozen(resource)).toBe(true);
      expect(Object.getPrototypeOf(resource.admissionOptions)).toBeNull();
      expect(Object.isFrozen(resource.admissionOptions)).toBe(true);

      expect(mockedCreatePostgresPool).toHaveBeenCalledTimes(1);
      const reviewedConfig = mockedCreatePostgresPool.mock.calls[0]![0];
      expect(reviewedConfig.database).not.toBe(inputDatabase);
      expect(reviewedConfig.database).toEqual(inputDatabase);
      expect(reviewedConfig.workload).toBe('api');
      expect(Object.getPrototypeOf(reviewedConfig)).toBeNull();
      expect(Object.getPrototypeOf(reviewedConfig.database)).toBeNull();
      expect(Object.isFrozen(reviewedConfig)).toBe(true);
      expect(Object.isFrozen(reviewedConfig.database)).toBe(true);
      if (inputSsl !== false && reviewedConfig.database.ssl !== false) {
        expect(reviewedConfig.database.ssl).not.toBe(inputSsl);
        expect(Object.getPrototypeOf(reviewedConfig.database.ssl)).toBeNull();
        expect(Object.isFrozen(reviewedConfig.database.ssl)).toBe(true);
      }
      expect(Object.isFrozen(inputDatabase)).toBe(false);
      expect(Object.isFrozen(inputOptions)).toBe(false);
    },
  );

  it.each([
    ['one millisecond over', 5_001, 5_000],
    ['current API maximum over admission maximum', 60_000, 30_000],
  ] as const)('rejects %s before allocating the pool', (_label, connectionTimeoutMs, deadline) => {
    expectInvalid(() =>
      createDormantProviderPositionAdmissionRuntimeResource(
        postgresConfig(databaseConfig({ connectionTimeoutMs })),
        admissionOptions({ deadlineMilliseconds: deadline }),
      ),
    );
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid connection timeout %p',
    (connectionTimeoutMs) => {
      expectInvalid(() =>
        createDormantProviderPositionAdmissionRuntimeResource(
          postgresConfig(databaseConfig({ connectionTimeoutMs })),
          admissionOptions(),
        ),
      );
      expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid admission deadline %p',
    (deadlineMilliseconds) => {
      expectInvalid(() =>
        createDormantProviderPositionAdmissionRuntimeResource(
          postgresConfig(),
          admissionOptions({ deadlineMilliseconds }),
        ),
      );
      expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, 9, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid concurrency %p',
    (maximumConcurrency) => {
      expectInvalid(() =>
        createDormantProviderPositionAdmissionRuntimeResource(
          postgresConfig(),
          admissionOptions({ maximumConcurrency }),
        ),
      );
      expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
    },
  );

  it('rejects values immediately above the reviewed maxima', () => {
    expectInvalid(() =>
      createDormantProviderPositionAdmissionRuntimeResource(
        postgresConfig(),
        admissionOptions({
          deadlineMilliseconds: PROVIDER_POSITION_ADMISSION_MAX_DEADLINE_MILLISECONDS + 1,
        }),
      ),
    );
    expectInvalid(() =>
      createDormantProviderPositionAdmissionRuntimeResource(
        postgresConfig(),
        admissionOptions({ maximumConcurrency: PROVIDER_POSITION_ADMISSION_MAX_CONCURRENCY + 1 }),
      ),
    );
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it.each([
    ['idleTimeoutMs', 600_000],
    ['lockTimeoutMs', 60_000],
    ['maxLifetimeSeconds', 86_400],
    ['poolMax', 100],
    ['statementTimeoutMs', 300_000],
  ] as const)('rejects %s above its loader maximum or outside safe integers', (key, maximum) => {
    for (const value of [maximum + 1, Number.MAX_SAFE_INTEGER + 1]) {
      const config = databaseConfig();
      config[key] = value;
      expectInvalid(() =>
        createDormantProviderPositionAdmissionRuntimeResource(
          postgresConfig(config),
          admissionOptions(),
        ),
      );
    }
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it.each([
    'postgresql://crypto_api_login_a:test@localhost:5432/crypto_lending?sslmode=no-verify',
    'postgresql://crypto_api_login_a:test@localhost:5432/crypto_lending?options=-c%20role%3Dcrypto_admin',
    'postgresql://crypto_api_login_a:test@localhost:5432/crypto_lending#override',
    'postgresql://wrong_identity:test@localhost:5432/crypto_lending',
    'postgresql://crypto_api_login_a@localhost:5432/crypto_lending',
  ])('rejects an unreviewed production connection string %s', (connectionString) => {
    expectInvalid(() =>
      createDormantProviderPositionAdmissionRuntimeResource(
        postgresConfig(databaseConfig({ connectionString })),
        admissionOptions(),
      ),
    );
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it('requires the exact API session role', () => {
    const missingRole = databaseConfig() as unknown as MutableRecord;
    delete missingRole.sessionRole;
    for (const config of [
      missingRole as unknown as DatabaseInfrastructureConfig,
      databaseConfig({ sessionRole: 'crypto_worker_runtime' }),
    ]) {
      expectInvalid(() =>
        createDormantProviderPositionAdmissionRuntimeResource(
          postgresConfig(config),
          admissionOptions(),
        ),
      );
    }
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it('requires verified CA-backed TLS for non-loopback databases', () => {
    const remoteConnectionString =
      'postgresql://crypto_api_login_a:test@database.example:5432/crypto_lending';
    for (const ssl of [
      false,
      { rejectUnauthorized: false },
      { rejectUnauthorized: true },
    ] as const) {
      expectInvalid(() =>
        createDormantProviderPositionAdmissionRuntimeResource(
          postgresConfig(databaseConfig({ connectionString: remoteConnectionString, ssl })),
          admissionOptions(),
        ),
      );
    }
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it('requires the API workload and rejects missing or extra members', () => {
    const missingPoolMember = { workload: 'api' };
    const extraPoolMember = { ...postgresConfig(), providerId: 'aave-v3' };
    const missingDatabaseMember = databaseConfig() as unknown as MutableRecord;
    delete missingDatabaseMember.poolMax;
    const extraDatabaseMember = Object.assign(databaseConfig(), { providerId: 'aave-v3' });
    const extraOptions = { ...admissionOptions(), timeoutFallback: true };
    const symbolDatabaseMember = databaseConfig() as unknown as MutableRecord;
    symbolDatabaseMember[Symbol('unexpected')] = true;

    for (const config of [
      { ...postgresConfig(), workload: 'worker' },
      missingPoolMember,
      extraPoolMember,
      postgresConfig(missingDatabaseMember as unknown as DatabaseInfrastructureConfig),
      postgresConfig(extraDatabaseMember),
      postgresConfig(symbolDatabaseMember as unknown as DatabaseInfrastructureConfig),
    ]) {
      expectInvalid(() =>
        createDormantProviderPositionAdmissionRuntimeResource(
          config as RuntimePostgresPoolConfig,
          admissionOptions(),
        ),
      );
    }
    expectInvalid(() =>
      createDormantProviderPositionAdmissionRuntimeResource(
        postgresConfig(),
        extraOptions as ProviderPositionAdmissionOptions,
      ),
    );
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it('rejects accessors without invoking them', () => {
    let reads = 0;
    const accessorDatabase = databaseConfig() as unknown as MutableRecord;
    Object.defineProperty(accessorDatabase, 'connectionTimeoutMs', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 2_500;
      },
    });
    const accessorOptions = Object.create(null) as MutableRecord;
    Object.defineProperties(accessorOptions, {
      deadlineMilliseconds: {
        enumerable: true,
        get: () => {
          reads += 1;
          return 5_000;
        },
      },
      maximumConcurrency: { enumerable: true, value: 2 },
    });

    expectInvalid(() =>
      createDormantProviderPositionAdmissionRuntimeResource(
        postgresConfig(accessorDatabase as unknown as DatabaseInfrastructureConfig),
        admissionOptions(),
      ),
    );
    expectInvalid(() =>
      createDormantProviderPositionAdmissionRuntimeResource(
        postgresConfig(),
        accessorOptions as unknown as ProviderPositionAdmissionOptions,
      ),
    );
    expect(reads).toBe(0);
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it('rejects proxies without reading traps', () => {
    let reads = 0;
    const trap = (): never => {
      reads += 1;
      throw new Error('hostile trap detail');
    };
    const postgresProxy = new Proxy(postgresConfig(), { get: trap });
    const databaseProxy = new Proxy(databaseConfig(), { get: trap });
    const optionsProxy = new Proxy(admissionOptions(), { get: trap });
    const sslProxy = new Proxy({ rejectUnauthorized: true, ca: 'test-ca' }, { get: trap });

    for (const [config, options] of [
      [postgresProxy, admissionOptions()],
      [postgresConfig(databaseProxy), admissionOptions()],
      [postgresConfig(databaseConfig({ ssl: sslProxy })), admissionOptions()],
      [postgresConfig(), optionsProxy],
    ] as const) {
      expectInvalid(() => createDormantProviderPositionAdmissionRuntimeResource(config, options));
    }
    expect(reads).toBe(0);
    expect(mockedCreatePostgresPool).not.toHaveBeenCalled();
  });

  it('uses owned snapshots that cannot be substituted after construction', () => {
    const inputDatabase = databaseConfig({ connectionTimeoutMs: 4_000 });
    const inputOptions = admissionOptions({ deadlineMilliseconds: 8_000 });

    const resource = createDormantProviderPositionAdmissionRuntimeResource(
      postgresConfig(inputDatabase),
      inputOptions,
    );
    inputDatabase.connectionTimeoutMs = 7_999;
    (inputOptions as unknown as MutableRecord).deadlineMilliseconds = 9_000;

    const reviewedConfig = mockedCreatePostgresPool.mock.calls[0]?.[0];
    expect(reviewedConfig?.database.connectionTimeoutMs).toBe(4_000);
    expect(resource.admissionOptions.deadlineMilliseconds).toBe(8_000);
  });

  it('sanitizes pool construction failures', () => {
    mockedCreatePostgresPool.mockImplementationOnce(() => {
      throw new Error('postgresql://user:sensitive@database.invalid:5432/db');
    });

    expectInvalid(
      () =>
        createDormantProviderPositionAdmissionRuntimeResource(postgresConfig(), admissionOptions()),
      'PROVIDER_POSITION_ADMISSION_RUNTIME_CONSTRUCTION_FAILED',
    );
  });
});
