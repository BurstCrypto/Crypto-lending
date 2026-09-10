import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';

import { BALANCE_SYNC_POLICY } from '../../blockchain-sync/domain/balance-sync';
import { PORTFOLIO_READ_DEADLINE_MILLISECONDS } from '../../portfolio/application/portfolio.service';
import {
  API_DATABASE_TIMEOUT_LIMITS,
  BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS,
  BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY,
  loadBalanceConsumerInfrastructureConfig,
  loadInfrastructureConfig,
  loadMigrationDatabaseConfig,
} from './infrastructure.config';

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
    SQS_BALANCE_QUEUE_URL: production
      ? 'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-balance-sync'
      : 'http://127.0.0.1:4566/000000000000/crypto-lending-balance-sync',
    SQS_BALANCE_DEAD_LETTER_QUEUE_URL: production
      ? 'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-balance-sync-dlq'
      : 'http://127.0.0.1:4566/000000000000/crypto-lending-balance-sync-dlq',
    ...overrides,
  };
}

function credentialUrl(
  scheme: 'postgresql' | 'redis' | 'rediss',
  username: string,
  password: string,
  authorityAndPath: string,
): string {
  return `${scheme}://${username}:${password}@${authorityAndPath}`;
}

function balanceConsumerEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return baseEnvironment({
    NODE_ENV: 'production',
    APPLICATION_WORKLOAD: 'balance-consumer',
    DATABASE_RUNTIME_URL:
      'postgresql://crypto_balance_consumer_login_a:local@127.0.0.1:5432/crypto_lending',
    DATABASE_RUNTIME_SSL_MODE: 'verify-full',
    REDIS_URL: undefined,
    SQS_QUEUE_URL: undefined,
    SQS_DEAD_LETTER_QUEUE_URL: undefined,
    SQS_BALANCE_QUEUE_URL:
      'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-test-balance-sync',
    SQS_BALANCE_DEAD_LETTER_QUEUE_URL:
      'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-test-balance-sync-dlq',
    ...overrides,
  });
}

describe('loadInfrastructureConfig', () => {
  it('loads Railway private PostgreSQL/Redis without any AWS or SQS dependency', () => {
    const config = loadInfrastructureConfig({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      APPLICATION_WORKLOAD: 'api',
      DEPLOYMENT_TARGET: 'railway',
      DATABASE_RUNTIME_HOST: 'postgres.railway.internal',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'railway',
      DATABASE_RUNTIME_USERNAME: 'crypto_api_login_railway',
      DATABASE_RUNTIME_PASSWORD: 'not-exported',
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      REDIS_URL: credentialUrl('redis', 'default', 'not-exported', 'redis.railway.internal:6379'),
    });

    expect(config.database).toMatchObject({
      connectionString: credentialUrl(
        'postgresql',
        'crypto_api_login_railway',
        'not-exported',
        'postgres.railway.internal:5432/railway',
      ),
      sessionRole: 'crypto_api_runtime',
      ssl: false,
    });
    expect(config.redis?.url).toBe(
      credentialUrl('redis', 'default', 'not-exported', 'redis.railway.internal:6379'),
    );
    expect(config.sqs.region).toBe('railway-postgres');
  });

  it('rejects public data URLs and AWS/SQS variables in a Railway production runtime', () => {
    const railway = {
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      APPLICATION_WORKLOAD: 'api',
      DEPLOYMENT_TARGET: 'railway',
      DATABASE_RUNTIME_HOST: 'postgres.railway.internal',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'railway',
      DATABASE_RUNTIME_USERNAME: 'crypto_api_login_railway',
      DATABASE_RUNTIME_PASSWORD: 'not-exported',
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      REDIS_URL: credentialUrl('redis', 'default', 'not-exported', 'redis.railway.internal:6379'),
    };
    expect(() => loadInfrastructureConfig({ ...railway, AWS_REGION: 'us-east-1' })).toThrow(
      'Railway runtime must not receive AWS or SQS configuration',
    );
    expect(() =>
      loadInfrastructureConfig({
        ...railway,
        DATABASE_RUNTIME_HOST: 'public.example',
      }),
    ).toThrow('Railway private-network URL');
    expect(() =>
      loadInfrastructureConfig({
        ...railway,
        DATABASE_RUNTIME_URL: credentialUrl(
          'postgresql',
          'crypto_api_login_railway',
          'secret',
          'postgres.railway.internal:5432/railway',
        ),
      }),
    ).toThrow('not DATABASE_RUNTIME_URL');
    expect(() =>
      loadInfrastructureConfig({
        ...railway,
        REDIS_URL: credentialUrl('rediss', 'default', 'secret', 'redis.railway.internal:6379'),
      }),
    ).toThrow('Railway private-network URL');
  });

  it('loads the Railway owner migration connection only from private DNS', () => {
    const migration = loadMigrationDatabaseConfig({
      NODE_ENV: 'production',
      DEPLOYMENT_TARGET: 'railway',
      MIGRATION_DATABASE_URL: credentialUrl(
        'postgresql',
        'postgres',
        'not-exported',
        'postgres.railway.internal:5432/railway',
      ),
    });
    expect(migration).toMatchObject({
      connectionString: credentialUrl(
        'postgresql',
        'postgres',
        'not-exported',
        'postgres.railway.internal:5432/railway',
      ),
      poolMax: 1,
      sessionRole: 'crypto_schema_owner',
      ssl: false,
    });
  });

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
    ).toThrow('Production runtime requires APPLICATION_WORKLOAD=api, worker, or balance-consumer');
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({ NODE_ENV: 'production', APPLICATION_WORKLOAD: 'api-worker' }),
      ),
    ).toThrow('APPLICATION_WORKLOAD must be exactly api, worker, or balance-consumer');
  });

  it('requires the dedicated loader for the balance-consumer workload', () => {
    expect(() => loadInfrastructureConfig(balanceConsumerEnvironment())).toThrow(
      'Balance-consumer runtime requires the dedicated balance-consumer infrastructure loader',
    );
  });

  it('requires a canonical APP_ENV identity scope in production', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ NODE_ENV: 'production', APP_ENV: undefined })),
    ).toThrow('Production runtime requires APP_ENV');
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ NODE_ENV: 'production', APP_ENV: 'Test West' })),
    ).toThrow('APP_ENV must be a canonical reviewed environment name');
  });

  it('requires an explicit AWS region in production but retains the local default', () => {
    expect(loadInfrastructureConfig(baseEnvironment({ AWS_REGION: undefined })).sqs.region).toBe(
      'us-east-1',
    );
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ NODE_ENV: 'production', AWS_REGION: undefined })),
    ).toThrow('Production runtime requires AWS_REGION');
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ NODE_ENV: 'production', AWS_REGION: '  ' })),
    ).toThrow('Production runtime requires AWS_REGION');
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
    expect('redis' in config).toBe(false);
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

  it('uses the dedicated production balance-consumer database identity without Redis', () => {
    const config = loadBalanceConsumerInfrastructureConfig(
      balanceConsumerEnvironment({
        DATABASE_RUNTIME_URL:
          'postgresql://crypto_balance_consumer_login_blue:local@127.0.0.1:5432/crypto_lending',
      }),
    );

    expect(config.workload).toBe('balance-consumer');
    expect(config.database.sessionRole).toBe('crypto_balance_consumer_runtime');
    expect('redis' in config).toBe(false);
  });

  it('accepts the exact balance-consumer database timeout ceilings', () => {
    const config = loadBalanceConsumerInfrastructureConfig(
      balanceConsumerEnvironment({
        DATABASE_CONNECTION_TIMEOUT_MS: '5000',
        DATABASE_LOCK_TIMEOUT_MS: '5000',
        DATABASE_STATEMENT_TIMEOUT_MS: '15000',
      }),
    );

    expect(config.database).toMatchObject(BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS);
  });

  it.each([
    ['DATABASE_CONNECTION_TIMEOUT_MS', '5001', 'between 1 and 5000'],
    ['DATABASE_LOCK_TIMEOUT_MS', '5001', 'between 1 and 5000'],
    ['DATABASE_STATEMENT_TIMEOUT_MS', '15001', 'between 1 and 15000'],
  ] as const)(
    'rejects balance-consumer %s above its shutdown-safe ceiling',
    (name, value, text) => {
      expect(() =>
        loadBalanceConsumerInfrastructureConfig(balanceConsumerEnvironment({ [name]: value })),
      ).toThrow(text);
    },
  );

  it('rejects a cross-scoped database login for the production balance consumer', () => {
    expect(() =>
      loadBalanceConsumerInfrastructureConfig(
        balanceConsumerEnvironment({
          DATABASE_RUNTIME_URL:
            'postgresql://crypto_worker_login_a:local@127.0.0.1:5432/crypto_lending',
        }),
      ),
    ).toThrow(
      'must contain the reviewed crypto_balance_consumer_login_<rotation-id> username and a password',
    );
  });

  it('rejects every Redis setting injected into a production balance consumer', () => {
    expect(() =>
      loadBalanceConsumerInfrastructureConfig(
        balanceConsumerEnvironment({ REDIS_URL: 'rediss://must-not-be-injected' }),
      ),
    ).toThrow('Production balance-consumer must not receive Redis configuration or credentials');
  });

  it('rejects unknown Redis aliases injected into a production balance consumer', () => {
    expect(() =>
      loadBalanceConsumerInfrastructureConfig(
        balanceConsumerEnvironment({
          REDIS_OPERATOR_TOKEN: 'must-not-be-injected',
        }),
      ),
    ).toThrow('Production balance-consumer must not receive Redis configuration or credentials');
  });

  it('exposes only the exact balance pair and bounded common SQS fields to the consumer', () => {
    const config = loadBalanceConsumerInfrastructureConfig(balanceConsumerEnvironment());

    expect(Object.keys(config.sqs).sort()).toEqual([
      'balanceDeadLetterQueueUrl',
      'balanceQueueUrl',
      'credentialRelativeUri',
      'maxReceiveCount',
      'region',
      'requestTimeoutMs',
      'retryBaseDelaySeconds',
      'retryMaxDelaySeconds',
      'sdkMaxAttempts',
      'visibilityTimeoutSeconds',
    ]);
    expect(config.sqs).not.toHaveProperty('queueUrl');
    expect(config.sqs).not.toHaveProperty('deadLetterQueueUrl');
  });

  it('pins native balance receipt redrive to the domain attempt and delay policy', () => {
    const config = loadBalanceConsumerInfrastructureConfig(balanceConsumerEnvironment());

    expect(BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY).toEqual({
      maxReceiveCount: BALANCE_SYNC_POLICY.maxAttempts,
      retryBaseDelaySeconds: BALANCE_SYNC_POLICY.retryBaseDelaySeconds,
      retryMaxDelaySeconds: BALANCE_SYNC_POLICY.retryMaximumDelaySeconds,
    });
    expect(Object.isFrozen(BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY)).toBe(true);
    expect(config.sqs).toMatchObject(BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY);
  });

  it.each([
    ['SQS_MAX_RECEIVE_COUNT', '2'],
    ['SQS_RETRY_BASE_DELAY_SECONDS', '1'],
    ['SQS_RETRY_MAX_DELAY_SECONDS', '59'],
  ] as const)('rejects balance receipt redrive drift through %s', (name, value) => {
    expect(() =>
      loadBalanceConsumerInfrastructureConfig(balanceConsumerEnvironment({ [name]: value })),
    ).toThrow('Balance-consumer SQS receipt redrive policy must exactly match BALANCE_SYNC_POLICY');
  });

  it('leaves the generic job worker receipt policy independently configurable', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        SQS_MAX_RECEIVE_COUNT: '7',
        SQS_RETRY_BASE_DELAY_SECONDS: '2',
        SQS_RETRY_MAX_DELAY_SECONDS: '17',
      }),
    );

    expect(config.sqs).toMatchObject({
      maxReceiveCount: 7,
      retryBaseDelaySeconds: 2,
      retryMaxDelaySeconds: 17,
    });
  });

  it.each(['SQS_QUEUE_URL', 'SQS_DEAD_LETTER_QUEUE_URL'])(
    'rejects generic job queue input %s for the balance consumer',
    (name) => {
      expect(() =>
        loadBalanceConsumerInfrastructureConfig(
          balanceConsumerEnvironment({ [name]: 'must-not-be-accepted' }),
        ),
      ).toThrow('Balance-consumer runtime must not receive generic job queue configuration');
    },
  );

  it.each(['SQS_PUBLISH_QUEUE_URL', 'sqs_balance_queue_url', 'AWS_CUSTOM_SQS_TOKEN'])(
    'rejects unreviewed or noncanonical SQS alias %s for the balance consumer',
    (name) => {
      expect(() =>
        loadBalanceConsumerInfrastructureConfig(
          balanceConsumerEnvironment({ [name]: 'must-not-be-accepted' }),
        ),
      ).toThrow('Balance-consumer runtime must not receive an unreviewed SQS configuration');
    },
  );

  it('binds the production balance pair to the exact APP_ENV names and one account', () => {
    for (const environment of [
      balanceConsumerEnvironment({
        SQS_BALANCE_QUEUE_URL:
          'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-other-balance-sync',
      }),
      balanceConsumerEnvironment({
        SQS_BALANCE_DEAD_LETTER_QUEUE_URL:
          'https://sqs.us-east-1.amazonaws.com/111111111111/crypto-lending-test-balance-sync-dlq',
      }),
      balanceConsumerEnvironment({
        SQS_BALANCE_DEAD_LETTER_QUEUE_URL:
          'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-test-balance-sync',
      }),
    ]) {
      expect(() => loadBalanceConsumerInfrastructureConfig(environment)).toThrow(
        /exact APP_ENV source and dead-letter identities|must be different/u,
      );
    }
  });

  it('rejects a balance queue outside the configured AWS region', () => {
    expect(() =>
      loadBalanceConsumerInfrastructureConfig(
        balanceConsumerEnvironment({
          SQS_BALANCE_QUEUE_URL:
            'https://sqs.us-west-2.amazonaws.com/000000000000/crypto-lending-test-balance-sync',
        }),
      ),
    ).toThrow('SQS_BALANCE_QUEUE_URL must be a canonical HTTPS SQS queue URL for AWS_REGION');
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

  it('requires a dedicated balance-sync source and dead-letter queue', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ SQS_BALANCE_QUEUE_URL: undefined })),
    ).toThrow('Missing required environment variable: SQS_BALANCE_QUEUE_URL');
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ SQS_BALANCE_DEAD_LETTER_QUEUE_URL: undefined })),
    ).toThrow('Missing required environment variable: SQS_BALANCE_DEAD_LETTER_QUEUE_URL');
  });

  it('requires all physical SQS queue URLs to be pairwise distinct', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          SQS_BALANCE_QUEUE_URL: 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs',
        }),
      ),
    ).toThrow('SQS source and dead-letter queue URLs must be pairwise different');
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

  it('caps API pool acquisition at five seconds without silently clamping it', () => {
    expect(API_DATABASE_TIMEOUT_LIMITS).toEqual({
      connectionTimeoutMs: 5_000,
      lockTimeoutMs: 60_000,
      statementTimeoutMs: 300_000,
    });
    expect(API_DATABASE_TIMEOUT_LIMITS.connectionTimeoutMs).toBeLessThan(
      PORTFOLIO_READ_DEADLINE_MILLISECONDS,
    );
    expect(loadInfrastructureConfig(baseEnvironment()).database.connectionTimeoutMs).toBe(5_000);
    expect(
      loadInfrastructureConfig(baseEnvironment({ DATABASE_CONNECTION_TIMEOUT_MS: '5000' })).database
        .connectionTimeoutMs,
    ).toBe(5_000);
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ DATABASE_CONNECTION_TIMEOUT_MS: '5001' })),
    ).toThrow('DATABASE_CONNECTION_TIMEOUT_MS must be an integer between 1 and 5000');
  });

  it('preserves the worker pool acquisition ceiling independently of the API', () => {
    const worker = loadInfrastructureConfig(
      baseEnvironment({
        APPLICATION_WORKLOAD: 'worker',
        DATABASE_CONNECTION_TIMEOUT_MS: '60000',
      }),
    );

    expect(worker.workload).toBe('worker');
    expect(worker.database.connectionTimeoutMs).toBe(60_000);
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          APPLICATION_WORKLOAD: 'worker',
          DATABASE_CONNECTION_TIMEOUT_MS: '60001',
        }),
      ),
    ).toThrow('DATABASE_CONNECTION_TIMEOUT_MS must be an integer between 1 and 60000');
  });

  it('rejects PostgreSQL pool lifecycle values outside their operational bounds', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ DATABASE_CONNECTION_TIMEOUT_MS: '0' })),
    ).toThrow('DATABASE_CONNECTION_TIMEOUT_MS must be an integer between 1 and 5000');
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
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          ...secureProduction,
          SQS_BALANCE_QUEUE_URL: 'https://attacker.example/000000000000/balance-sync',
        }),
      ),
    ).toThrow('SQS_BALANCE_QUEUE_URL must be a canonical HTTPS SQS queue URL');
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
        SQS_BALANCE_QUEUE_URL: 'https://sqs.eusc-de-east-1.amazonaws.eu/000000000000/balance-sync',
        SQS_BALANCE_DEAD_LETTER_QUEUE_URL:
          'https://sqs.eusc-de-east-1.amazonaws.eu/000000000000/balance-sync-dlq',
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
