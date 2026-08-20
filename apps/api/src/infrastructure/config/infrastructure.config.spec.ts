import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';

import { loadInfrastructureConfig } from './infrastructure.config';

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
    DATABASE_RUNTIME_URL: `postgresql://${production ? 'crypto_runtime' : 'local'}:local@127.0.0.1:5432/crypto_lending`,
    DATABASE_RUNTIME_SSL_MODE: 'disable',
    ...(production ? { NODE_EXTRA_CA_CERTS: validCaPath } : {}),
    REDIS_URL: production
      ? 'rediss://:not-exported@cache.internal.example:6379'
      : 'redis://127.0.0.1:6379',
    REDIS_KEY_PREFIX: 'crypto-lending:test:v1:',
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
    expect(config.redis.url).toBe('redis://127.0.0.1:6379');
    expect(config.sqs.endpoint).toBe('http://127.0.0.1:4566');
  });

  it('retains the legacy database URL only for local compatibility', () => {
    const env = baseEnvironment({ DATABASE_RUNTIME_URL: undefined });
    env.DATABASE_URL = 'postgresql://legacy:local@127.0.0.1:5432/crypto_lending';
    env.DATABASE_SSL_MODE = 'disable';
    env.DATABASE_RUNTIME_SSL_MODE = undefined;

    expect(loadInfrastructureConfig(env).database.connectionString).toBe(env.DATABASE_URL);
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
      REDIS_AUTH_TOKEN: 'token with:/reserved@characters',
    });

    const config = loadInfrastructureConfig(env);

    expect(config.database.connectionString).toBe(
      'postgresql://service%20user:p%40ss%3A%2Fword@db.internal.example:5432/crypto_lending',
    );
    expect(config.database.ssl).toEqual({
      rejectUnauthorized: true,
      ca: validCa,
    });
    expect(config.redis.url).toBe(
      'rediss://:token%20with%3A%2Freserved%40characters@cache.internal.example:6379',
    );
  });

  it('rejects ambiguous database configuration', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ DATABASE_RUNTIME_HOST: 'db.internal.example' })),
    ).toThrow('Configure DATABASE_RUNTIME_URL or the DATABASE_RUNTIME_HOST');
  });

  it('rejects ambiguous Redis configuration', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ REDIS_AUTH_TOKEN: 'not-exported' })),
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
          REDIS_AUTH_TOKEN: 'not-exported',
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
            REDIS_URL: 'rediss://:not-exported@cache.internal.example:6379',
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
    ).toThrow('Production runtime must not receive MIGRATION_DATABASE_* connection variables');
  });

  it('rejects a migration/admin identity disguised as a production runtime URL', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL:
            'postgresql://crypto_admin:secret@db.internal.example:5432/crypto_lending',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('must contain the reviewed crypto_runtime username and a password');

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL:
            'postgresql://crypto_runtime@db.internal.example:5432/crypto_lending',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('must contain the reviewed crypto_runtime username and a password');
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
          DATABASE_RUNTIME_USERNAME: 'crypto_admin',
          DATABASE_RUNTIME_PASSWORD: 'secret',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          NODE_EXTRA_CA_CERTS: validCaPath,
        }),
      ),
    ).toThrow('Production DATABASE_RUNTIME_USERNAME must equal crypto_runtime');
  });

  it('rejects a production DATABASE_RUNTIME_URL query that downgrades verified TLS', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_URL:
            'postgresql://service:secret@db.internal.example:5432/crypto_lending?sslmode=verify-full&sslmode=require',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://:not-exported@cache.internal.example:6379',
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
          REDIS_URL: 'rediss://:not-exported@cache.internal.example:6379',
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
          REDIS_URL: 'rediss://:not-exported@cache.internal.example:6379#',
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
        REDIS_URL: 'REDISS://:not-exported@cache.internal.example:6379',
      }),
    );
    expect(config.redis.url).toBe('rediss://:not-exported@cache.internal.example:6379');

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_RUNTIME_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://:not-exported@cache.internal.example:6379?tls=',
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
          REDIS_URL: 'rediss://:not-exported@cache.internal.example:6379',
          SQS_ENDPOINT: 'https://sqs-proxy.internal.example',
        }),
      ),
    ).toThrow('SQS_ENDPOINT is not allowed in production');
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
          'postgresql://crypto_runtime:secret@db.internal.example:5432/crypto_lending?sslmode=verify-full',
        DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        REDIS_URL: 'REDISS://:not-exported@cache.internal.example:6379',
      }),
    );

    expect(config.database.ssl).toEqual({ rejectUnauthorized: true, ca: validCa });
    expect(config.database.connectionString).not.toContain('sslmode');
    expect(config.redis.url).toBe('rediss://:not-exported@cache.internal.example:6379');
    expect(config.sqs.endpoint).toBeUndefined();
  });
});
