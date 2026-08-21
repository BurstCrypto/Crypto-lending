import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';

import { loadInfrastructureConfig, loadMigrationDatabaseConfig } from './infrastructure.config';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kan-34-rds-ca-'));
const validCaPath = join(temporaryDirectory, 'rds-ca.pem');
const validCa = rootCertificates[0];
if (!validCa) {
  throw new Error('Node did not expose a root certificate for the TLS configuration test');
}
writeFileSync(validCaPath, validCa, 'utf8');

afterAll(() => {
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

function baseEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const nodeEnvironment = overrides.NODE_ENV ?? 'test';
  const production = nodeEnvironment.trim().toLowerCase() === 'production';
  return {
    NODE_ENV: nodeEnvironment,
    ...(production
      ? {
          APP_ENV: 'test',
          APPLICATION_WORKLOAD: 'api',
          AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/test-task-role',
        }
      : {}),
    DATABASE_RUNTIME_URL: `postgresql://${production ? 'crypto_api_login_a' : 'local'}:local@127.0.0.1:5432/crypto_lending`,
    DATABASE_RUNTIME_SSL_MODE: 'disable',
    ...(production ? { NODE_EXTRA_CA_CERTS: validCaPath } : {}),
    REDIS_URL: production
      ? 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379'
      : 'redis://127.0.0.1:6379',
    AWS_REGION: 'us-east-1',
    SQS_QUEUE_URL: production
      ? 'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-jobs'
      : 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs',
    SQS_DEAD_LETTER_QUEUE_URL: production
      ? 'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-jobs-dlq'
      : 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs-dlq',
    ...overrides,
  };
}

describe('loadInfrastructureConfig', () => {
  it('retains explicit local connection URLs', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({ SQS_ENDPOINT: 'http://127.0.0.1:4566' }),
    );

    expect(config.database.connectionString).toBe(
      'postgresql://local:local@127.0.0.1:5432/crypto_lending',
    );
    expect(config.database.sessionRole).toBe('crypto_api_runtime');
    expect(config.redis?.url).toBe('redis://127.0.0.1:6379');
    expect(config.sqs.endpoint).toBe('http://127.0.0.1:4566');
  });

  it('requires one exact workload discriminator in production', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({ NODE_ENV: 'production', APPLICATION_WORKLOAD: undefined }),
      ),
    ).toThrow('Production runtime requires APPLICATION_WORKLOAD=api or worker');
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({ NODE_ENV: 'production', APPLICATION_WORKLOAD: 'api-worker' }),
      ),
    ).toThrow('APPLICATION_WORKLOAD must be exactly api or worker');
  });

  it('requires a canonical APP_ENV identity scope in production', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ NODE_ENV: 'production', APP_ENV: undefined })),
    ).toThrow('Production runtime requires APP_ENV');
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ NODE_ENV: 'production', APP_ENV: 'Test West' })),
    ).toThrow('APP_ENV must be a canonical reviewed environment name');
  });

  it('omits Redis entirely for a production worker identity', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        NODE_ENV: 'production',
        APPLICATION_WORKLOAD: 'worker',
        DATABASE_RUNTIME_URL:
          'postgresql://crypto_worker_login_a:local@127.0.0.1:5432/crypto_lending',
        DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        REDIS_URL: undefined,
      }),
    );

    expect(config.workload).toBe('worker');
    expect(config.database.sessionRole).toBe('crypto_worker_runtime');
    expect(config.redis).toBeUndefined();
  });

  it('rejects every Redis setting injected into a production worker', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          APPLICATION_WORKLOAD: 'worker',
          DATABASE_RUNTIME_URL:
            'postgresql://crypto_worker_login_a:local@127.0.0.1:5432/crypto_lending',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('Production worker must not receive Redis configuration or credentials');
  });

  it('rejects unknown Redis aliases injected into a production worker', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          APPLICATION_WORKLOAD: 'worker',
          DATABASE_RUNTIME_URL:
            'postgresql://crypto_worker_login_a:local@127.0.0.1:5432/crypto_lending',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: undefined,
          REDIS_OPERATOR_TOKEN: 'must-not-be-injected',
        }),
      ),
    ).toThrow('Production worker must not receive Redis configuration or credentials');
  });

  it('rejects unknown Redis aliases injected into a production API', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({ NODE_ENV: 'production', REDIS_PASSWORD_BACKUP: 'must-not-be-injected' }),
      ),
    ).toThrow('Production API must not receive an unreviewed REDIS_* environment variable');
  });

  it('retains the legacy database URL only for local compatibility', () => {
    const env = baseEnvironment({ DATABASE_RUNTIME_URL: undefined });
    env.DATABASE_URL = 'postgresql://legacy:local@127.0.0.1:5432/crypto_lending';
    env.DATABASE_SSL_MODE = 'disable';
    env.DATABASE_RUNTIME_SSL_MODE = undefined;

    const database = loadInfrastructureConfig(env).database;
    expect(database.connectionString).toBe(env.DATABASE_URL);
    expect(database.sessionRole).toBeUndefined();
  });

  it('activates the schema-owner role for explicitly scoped local migrations', () => {
    const migration = loadMigrationDatabaseConfig({
      NODE_ENV: 'test',
      MIGRATION_DATABASE_URL: 'postgresql://crypto_migration:local@127.0.0.1:5432/crypto_lending',
      MIGRATION_DATABASE_SSL_MODE: 'disable',
    });

    expect(migration.sessionRole).toBe('crypto_schema_owner');
  });

  it('applies bounded PostgreSQL pool lifecycle defaults', () => {
    const config = loadInfrastructureConfig(baseEnvironment());

    expect(config.database).toMatchObject({
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 30_000,
      lockTimeoutMs: 5_000,
      maxLifetimeSeconds: 1_800,
      poolMax: 10,
    });
  });

  it('applies a bounded total SQS request deadline', () => {
    expect(loadInfrastructureConfig(baseEnvironment()).sqs.requestTimeoutMs).toBe(15_000);
    expect(
      loadInfrastructureConfig(baseEnvironment({ SQS_REQUEST_TIMEOUT_MS: '25000' })).sqs
        .requestTimeoutMs,
    ).toBe(25_000);
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ SQS_REQUEST_TIMEOUT_MS: '60001' })),
    ).toThrow('SQS_REQUEST_TIMEOUT_MS must be an integer between 1 and 60000');
  });

  it('accepts bounded PostgreSQL pool lifecycle overrides', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        DATABASE_CONNECTION_TIMEOUT_MS: '2500',
        DATABASE_IDLE_TIMEOUT_MS: '45000',
        DATABASE_LOCK_TIMEOUT_MS: '4000',
        DATABASE_MAX_LIFETIME_SECONDS: '900',
      }),
    );

    expect(config.database).toMatchObject({
      connectionTimeoutMs: 2_500,
      idleTimeoutMs: 45_000,
      lockTimeoutMs: 4_000,
      maxLifetimeSeconds: 900,
    });
  });

  it('rejects PostgreSQL pool lifecycle values outside their operational bounds', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ DATABASE_CONNECTION_TIMEOUT_MS: '60001' })),
    ).toThrow('DATABASE_CONNECTION_TIMEOUT_MS must be an integer between 1 and 60000');
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ DATABASE_IDLE_TIMEOUT_MS: '0' })),
    ).toThrow('DATABASE_IDLE_TIMEOUT_MS must be an integer between 1 and 600000');
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ DATABASE_LOCK_TIMEOUT_MS: '60001' })),
    ).toThrow('DATABASE_LOCK_TIMEOUT_MS must be an integer between 1 and 60000');
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ DATABASE_MAX_LIFETIME_SECONDS: '86401' })),
    ).toThrow('DATABASE_MAX_LIFETIME_SECONDS must be an integer between 1 and 86400');
  });

  it('builds encrypted managed-service URLs from separately injected secret fields', () => {
    const env = baseEnvironment({
      DATABASE_RUNTIME_URL: undefined,
      DATABASE_RUNTIME_HOST: 'db.internal.example',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'crypto_lending',
      DATABASE_RUNTIME_USERNAME: 'service user',
      DATABASE_RUNTIME_PASSWORD: 'p@ss:/word',
      DATABASE_RUNTIME_SSL_MODE: 'verify-full',
      NODE_EXTRA_CA_CERTS: validCaPath,
      REDIS_URL: undefined,
      REDIS_HOST: 'cache.internal.example',
      REDIS_PORT: '6379',
      REDIS_TLS: 'true',
      REDIS_USERNAME: 'local_api',
      REDIS_PASSWORD: 'token with:/reserved@characters',
    });

    const config = loadInfrastructureConfig(env);

    expect(config.database.connectionString).toBe(
      'postgresql://service%20user:p%40ss%3A%2Fword@db.internal.example:5432/crypto_lending',
    );
    expect(config.database.ssl).toEqual({
      rejectUnauthorized: true,
      ca: validCa,
    });
    expect(config.redis?.url).toBe(
      'rediss://local_api:token%20with%3A%2Freserved%40characters@cache.internal.example:6379',
    );
  });

  it('rejects ambiguous database configuration', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ DATABASE_RUNTIME_HOST: 'db.internal.example' })),
    ).toThrow('Configure DATABASE_RUNTIME_URL or the DATABASE_RUNTIME_HOST');
  });

  it('rejects ambiguous Redis configuration', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ REDIS_PASSWORD: 'not-exported' })),
    ).toThrow('Configure REDIS_URL or the REDIS_* connection components, but not both');
  });

  it('fails closed when a managed database secret field is missing', () => {
    const env = baseEnvironment({
      DATABASE_RUNTIME_URL: undefined,
      DATABASE_RUNTIME_HOST: 'db.internal.example',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'crypto_lending',
      DATABASE_RUNTIME_USERNAME: 'service',
    });

    expect(() => loadInfrastructureConfig(env)).toThrow(
      'Missing required environment variable: DATABASE_RUNTIME_PASSWORD',
    );
  });

  it('does not allow managed database fields to downgrade TLS verification', () => {
    const env = baseEnvironment({
      DATABASE_RUNTIME_URL: undefined,
      DATABASE_RUNTIME_HOST: 'db.internal.example',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'crypto_lending',
      DATABASE_RUNTIME_USERNAME: 'service',
      DATABASE_RUNTIME_PASSWORD: 'not-exported',
      DATABASE_RUNTIME_SSL_MODE: 'require',
      NODE_EXTRA_CA_CERTS: validCaPath,
    });

    expect(() => loadInfrastructureConfig(env)).toThrow(
      'Managed DATABASE_RUNTIME_HOST connection components require DATABASE_RUNTIME_SSL_MODE=verify-full',
    );
  });

  it('requires an explicit RDS trust bundle path for managed database fields', () => {
    const env = baseEnvironment({
      DATABASE_RUNTIME_URL: undefined,
      DATABASE_RUNTIME_HOST: 'db.internal.example',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'crypto_lending',
      DATABASE_RUNTIME_USERNAME: 'service',
      DATABASE_RUNTIME_PASSWORD: 'not-exported',
      DATABASE_RUNTIME_SSL_MODE: 'verify-full',
    });

    expect(() => loadInfrastructureConfig(env)).toThrow(
      'Managed DATABASE_RUNTIME_HOST connection components require NODE_EXTRA_CA_CERTS',
    );
  });

  it('fails closed when the configured RDS trust bundle is unreadable', () => {
    const env = baseEnvironment({
      DATABASE_RUNTIME_URL: undefined,
      DATABASE_RUNTIME_HOST: 'db.internal.example',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'crypto_lending',
      DATABASE_RUNTIME_USERNAME: 'service',
      DATABASE_RUNTIME_PASSWORD: 'not-exported',
      DATABASE_RUNTIME_SSL_MODE: 'verify-full',
      NODE_EXTRA_CA_CERTS: join(temporaryDirectory, 'missing.pem'),
    });

    expect(() => loadInfrastructureConfig(env)).toThrow(
      'NODE_EXTRA_CA_CERTS must reference a readable CA bundle',
    );
  });

  it('fails closed when the configured RDS trust bundle is invalid', () => {
    const invalidCaPath = join(temporaryDirectory, 'invalid.pem');
    writeFileSync(invalidCaPath, 'not a certificate', 'utf8');
    const env = baseEnvironment({
      DATABASE_RUNTIME_URL: undefined,
      DATABASE_RUNTIME_HOST: 'db.internal.example',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'crypto_lending',
      DATABASE_RUNTIME_USERNAME: 'service',
      DATABASE_RUNTIME_PASSWORD: 'not-exported',
      DATABASE_RUNTIME_SSL_MODE: 'verify-full',
      NODE_EXTRA_CA_CERTS: invalidCaPath,
    });

    expect(() => loadInfrastructureConfig(env)).toThrow(
      'NODE_EXTRA_CA_CERTS must contain a valid PEM CA bundle',
    );
  });

  it('rejects hostnames and ports that could alter a generated URL', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          REDIS_URL: undefined,
          REDIS_HOST: 'cache.internal.example/path',
          REDIS_PORT: '70000',
          REDIS_PASSWORD: 'not-exported',
        }),
      ),
    ).toThrow('REDIS_HOST must be a DNS hostname');
  });

  it.each(['disable', 'require'])(
    'rejects production DATABASE_RUNTIME_URL when TLS mode is %s',
    (databaseSslMode) => {
      expect(() =>
        loadInfrastructureConfig(
          baseEnvironment({
            NODE_ENV: 'production',
            DATABASE_RUNTIME_SSL_MODE: databaseSslMode,
            REDIS_URL: 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379',
          }),
        ),
      ).toThrow('Production DATABASE_RUNTIME_URL requires DATABASE_RUNTIME_SSL_MODE=verify-full');
    },
  );

  it('requires an explicit trust bundle for a production DATABASE_RUNTIME_URL', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          NODE_EXTRA_CA_CERTS: undefined,
        }),
      ),
    ).toThrow('Production DATABASE_RUNTIME_URL requires NODE_EXTRA_CA_CERTS');
  });

  it('rejects legacy and migration credentials in a production runtime process', () => {
    const legacyEnvironment = baseEnvironment({
      NODE_ENV: 'production',
      DATABASE_RUNTIME_SSL_MODE: 'verify-full',
    });
    legacyEnvironment.DATABASE_URL =
      'postgresql://migration:secret@db.internal.example:5432/crypto_lending';

    expect(() => loadInfrastructureConfig(legacyEnvironment)).toThrow(
      'Production runtime requires DATABASE_RUNTIME_* connection variables',
    );

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          MIGRATION_DATABASE_URL:
            'postgresql://migration:secret@db.internal.example:5432/crypto_lending',
        }),
      ),
    ).toThrow('Production runtime must not receive any MIGRATION_DATABASE_* variable');
  });

  it('rejects unknown migration and privileged database aliases in production runtime', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          MIGRATION_DATABASE_PASSWORD_BACKUP: 'must-not-be-injected',
        }),
      ),
    ).toThrow('Production runtime must not receive any MIGRATION_DATABASE_* variable');

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_MASTER_PASSWORD: 'must-not-be-injected',
        }),
      ),
    ).toThrow('Production runtime must not receive database bootstrap, master, or admin variables');
  });

  it('rejects a migration/admin identity disguised as a production runtime URL', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL:
            'postgresql://crypto_worker_login_a:secret@db.internal.example:5432/crypto_lending',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('must contain the reviewed crypto_api_login_<rotation-id> username and a password');

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL:
            'postgresql://crypto_api_login_a@db.internal.example:5432/crypto_lending',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('must contain the reviewed crypto_api_login_<rotation-id> username and a password');
  });

  it('requires the reviewed username for production runtime components', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL: undefined,
          DATABASE_RUNTIME_HOST: 'db.internal.example',
          DATABASE_RUNTIME_PORT: '5432',
          DATABASE_RUNTIME_NAME: 'crypto_lending',
          DATABASE_RUNTIME_USERNAME: 'crypto_worker_login_a',
          DATABASE_RUNTIME_PASSWORD: 'secret',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          NODE_EXTRA_CA_CERTS: validCaPath,
        }),
      ),
    ).toThrow('Production DATABASE_RUNTIME_USERNAME must match crypto_api_login_<rotation-id>');
  });

  it('rejects a production DATABASE_RUNTIME_URL query that downgrades verified TLS', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL:
            'postgresql://service:secret@db.internal.example:5432/crypto_lending?sslmode=verify-full&sslmode=require',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379',
        }),
      ),
    ).toThrow('Production DATABASE_RUNTIME_URL cannot override sslmode below verify-full');
  });

  it('rejects connection-string TLS options that would replace verified pool settings', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL:
            'postgresql://service:secret@db.internal.example:5432/crypto_lending?ssl=0',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379',
        }),
      ),
    ).toThrow('Production DATABASE_RUNTIME_URL cannot contain connection parameter ssl');
  });

  it.each([
    'statement_timeout=0',
    'application_name=untrusted',
    'options=-c%20statement_timeout=0',
  ])('rejects production connection parameter overrides: %s', (parameter) => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL: `postgresql://service:secret@db.internal.example:5432/crypto_lending?${parameter}`,
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('Production DATABASE_RUNTIME_URL cannot contain connection parameter');
  });

  it('rejects authority-less production database and Redis URLs', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL: 'postgresql:/crypto_lending',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('Production DATABASE_RUNTIME_URL must use postgresql:// or postgres://');

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss:/cache.internal.example:6379',
        }),
      ),
    ).toThrow('REDIS_URL must use an authority-form URL with a hostname');
  });

  it('rejects empty query or fragment delimiters in production service URLs', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL:
            'postgresql://service:secret@db.internal.example:5432/crypto_lending?',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('Production DATABASE_RUNTIME_URL must not contain an empty query delimiter');
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379#',
        }),
      ),
    ).toThrow('Production REDIS_URL must not contain a query or fragment');
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-jobs?',
        }),
      ),
    ).toThrow('SQS_QUEUE_URL must be a canonical HTTPS SQS queue URL');
  });

  it('rejects plaintext Redis in production', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'redis://cache.internal.example:6379',
        }),
      ),
    ).toThrow('Production REDIS_URL must use rediss://');
  });

  it('rejects a global TLS verification override for the production API', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
        }),
      ),
    ).toThrow(
      'Production processes must not set NODE_TLS_REJECT_UNAUTHORIZED; certificate verification is pinned',
    );
  });

  it('rejects a global TLS verification override for the production worker', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          APPLICATION_WORKLOAD: 'worker',
          DATABASE_RUNTIME_URL:
            'postgresql://crypto_worker_login_a:secret@db.internal.example:5432/crypto_lending',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
          REDIS_URL: undefined,
        }),
      ),
    ).toThrow(
      'Production processes must not set NODE_TLS_REJECT_UNAUTHORIZED; certificate verification is pinned',
    );
  });

  it.each(['crypto_api_test_a', 'crypto_api_test_b'])(
    'accepts the reviewed production API Redis rotation slot %s',
    (username) => {
      const config = loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: `rediss://${username}:not-exported@cache.internal.example:6379`,
        }),
      );

      expect(config.redis?.username).toBe(username);
    },
  );

  it.each(['default', 'crypto_api_staging_a', 'crypto_worker_test_a', 'crypto_api_test_c'])(
    'rejects the cross-scope or malformed production Redis username %s',
    (username) => {
      expect(() =>
        loadInfrastructureConfig(
          baseEnvironment({
            NODE_ENV: 'production',
            REDIS_URL: `rediss://${username}:not-exported@cache.internal.example:6379`,
          }),
        ),
      ).toThrow('Production API Redis username must match the active APP_ENV slot');
    },
  );

  it('requires TLS and a scoped username for managed production Redis components', () => {
    const components = {
      NODE_ENV: 'production',
      DATABASE_RUNTIME_SSL_MODE: 'verify-full',
      REDIS_URL: undefined,
      REDIS_HOST: 'cache.internal.example',
      REDIS_PORT: '6379',
      REDIS_USERNAME: 'crypto_api_test_a',
      REDIS_PASSWORD: 'not-exported',
    };
    expect(() => loadInfrastructureConfig(baseEnvironment(components))).toThrow(
      'Production managed Redis components require REDIS_TLS=true',
    );
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ ...components, REDIS_TLS: 'false' })),
    ).toThrow('Production managed Redis components require REDIS_TLS=true');

    const config = loadInfrastructureConfig(baseEnvironment({ ...components, REDIS_TLS: 'true' }));
    expect(config.redis).toMatchObject({
      username: 'crypto_api_test_a',
      url: 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379',
    });
  });

  it('pins managed production Redis components to the reviewed port', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: undefined,
          REDIS_HOST: 'cache.internal.example',
          REDIS_PORT: '6380',
          REDIS_TLS: 'true',
          REDIS_USERNAME: 'crypto_api_test_a',
          REDIS_PASSWORD: 'not-exported',
        }),
      ),
    ).toThrow('Production managed Redis components must use the reviewed port 6379');
  });

  it('rejects the legacy shared Redis token variable in production', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_AUTH_TOKEN: 'not-exported',
        }),
      ),
    ).toThrow('Production API must use REDIS_PASSWORD; REDIS_AUTH_TOKEN is forbidden');
  });

  it.each([
    'rediss://crypto_api_test_a:not-exported@cache.internal.example',
    'rediss://crypto_api_test_a:not-exported@cache.internal.example:6380',
    'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379/1',
    'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379/cache',
  ])('rejects a noncanonical production Redis database or port: %s', (redisUrl) => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: redisUrl,
        }),
      ),
    ).toThrow('Production REDIS_URL must use database 0 and the reviewed port 6379');
  });

  it('rejects the obsolete key-prefix variable in production health-only Redis config', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_KEY_PREFIX: 'crypto-lending:test:api:v1:',
        }),
      ),
    ).toThrow('Production API must not receive REDIS_KEY_PREFIX; Redis is health-only');
  });

  it.each([
    'rediss://cache.internal.example:6379',
    'rediss://:@cache.internal.example:6379',
    'rediss://:%0A@cache.internal.example:6379',
    'rediss://:%ZZ@cache.internal.example:6379',
    'rediss://:bad\npassword@cache.internal.example:6379',
  ])('rejects a production Redis URL without a valid password: %s', (redisUrl) => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: redisUrl,
        }),
      ),
    ).toThrow('Production REDIS_URL must include a non-empty, valid password');
  });

  it('canonicalizes encrypted Redis URLs and rejects query-based TLS overrides', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        NODE_ENV: 'production',
        DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        REDIS_URL: 'REDISS://crypto_api_test_a:not-exported@cache.internal.example:6379',
      }),
    );
    expect(config.redis?.url).toBe(
      'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379',
    );

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379?tls=',
        }),
      ),
    ).toThrow('REDIS_URL cannot override TLS');
  });

  it('rejects custom SQS endpoints in production', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379',
          SQS_ENDPOINT: 'https://sqs-proxy.internal.example',
        }),
      ),
    ).toThrow('SQS_ENDPOINT is not allowed in production');
  });

  it.each([
    'https://127.0.0.1:4566',
    'http://127.0.0.1:4567',
    'http://example.test:4566',
    ['http://user:', 'password@127.0.0.1:4566'].join(''),
    'http://127.0.0.1:4566/path',
    'http://127.0.0.1:4566?option=true',
  ])('rejects a non-canonical local SQS emulator endpoint: %s', (endpoint) => {
    expect(() => loadInfrastructureConfig(baseEnvironment({ SQS_ENDPOINT: endpoint }))).toThrow(
      'SQS_ENDPOINT must be the canonical local SQS emulator endpoint on port 4566',
    );
  });

  it('accepts only the reviewed host and Compose local SQS emulator endpoints', () => {
    expect(
      loadInfrastructureConfig(baseEnvironment({ SQS_ENDPOINT: 'http://localhost:4566' })).sqs
        .endpoint,
    ).toBe('http://localhost:4566');
    expect(
      loadInfrastructureConfig(baseEnvironment({ SQS_ENDPOINT: 'http://localstack:4566' })).sqs
        .endpoint,
    ).toBe('http://localstack:4566');
  });

  it.each([
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_PROFILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_CONFIG_FILE',
    'AWS_ROLE_ARN',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
    'AWS_ENDPOINT_URL',
    'AWS_ENDPOINT_URL_SQS',
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
  ])('rejects the production AWS credential-chain override %s', (variableName) => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          [variableName]: 'must-not-be-used',
        }),
      ),
    ).toThrow('Production runtime must use the ECS task role');
  });

  it('allows only the ECS-managed relative credential URI in production', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        NODE_ENV: 'production',
        DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/example',
      }),
    );

    expect(config.sqs.credentialRelativeUri).toBe('/v2/credentials/example');
    expect(config.sqs.endpoint).toBeUndefined();
  });

  it.each([
    undefined,
    '',
    ' /v2/credentials/example',
    '/v2/credentials/../metadata',
    '/v2/credentials/example?redirect=http://attacker.example',
    'http://169.254.170.2/v2/credentials/example',
  ])('rejects a missing or non-canonical ECS credential relative URI: %s', (relativeUri) => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: relativeUri,
        }),
      ),
    ).toThrow(
      'Production runtime requires a canonical ECS-managed AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    );
  });

  it('rejects plaintext or non-AWS queue URLs in production', () => {
    const secureProduction = {
      NODE_ENV: 'production',
      DATABASE_RUNTIME_SSL_MODE: 'verify-full',
    };
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          ...secureProduction,
          SQS_QUEUE_URL: 'http://sqs.us-east-1.amazonaws.com/000000000000/jobs',
        }),
      ),
    ).toThrow('SQS_QUEUE_URL must be a canonical HTTPS SQS queue URL');
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          ...secureProduction,
          SQS_QUEUE_URL: 'https://attacker.example/000000000000/jobs',
        }),
      ),
    ).toThrow('SQS_QUEUE_URL must be a canonical HTTPS SQS queue URL');
  });

  it.each([
    'https://sqs.us-east-1.amazonaws.com/000000000000//jobs',
    'https://sqs.us-east-1.amazonaws.com/000000000000/jobs/',
    'https://sqs.us-east-1.amazonaws.com/000000000000/jobs.fifo',
    `https://sqs.us-east-1.amazonaws.com/000000000000/${'q'.repeat(81)}`,
  ])('rejects a non-canonical production queue path: %s', (queueUrl) => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          SQS_QUEUE_URL: queueUrl,
        }),
      ),
    ).toThrow('SQS_QUEUE_URL must be a canonical HTTPS SQS queue URL');
  });

  it('accepts the AWS European Sovereign Cloud SQS DNS suffix', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        NODE_ENV: 'production',
        DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        AWS_REGION: 'eusc-de-east-1',
        SQS_QUEUE_URL: 'https://sqs.eusc-de-east-1.amazonaws.eu/000000000000/jobs',
        SQS_DEAD_LETTER_QUEUE_URL: 'https://sqs.eusc-de-east-1.amazonaws.eu/000000000000/jobs-dlq',
      }),
    );

    expect(config.sqs.region).toBe('eusc-de-east-1');
  });

  it('accepts verified direct service URLs without an SQS override in production', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        NODE_ENV: 'production',
        DATABASE_RUNTIME_URL:
          'postgresql://crypto_api_login_blue:secret@db.internal.example:5432/crypto_lending?sslmode=verify-full',
        DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        REDIS_URL: 'REDISS://crypto_api_test_a:not-exported@cache.internal.example:6379',
      }),
    );

    expect(config.database.ssl).toEqual({ rejectUnauthorized: true, ca: validCa });
    expect(config.database.sessionRole).toBe('crypto_api_runtime');
    expect(config.database.connectionString).not.toContain('sslmode');
    expect(config.redis?.url).toBe(
      'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379',
    );
    expect(config.sqs.endpoint).toBeUndefined();
  });
});
