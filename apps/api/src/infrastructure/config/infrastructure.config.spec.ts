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
    DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/crypto_lending',
    DATABASE_SSL_MODE: 'disable',
    REDIS_URL: production ? 'rediss://cache.internal.example:6379' : 'redis://127.0.0.1:6379',
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

  it('applies bounded PostgreSQL pool lifecycle defaults', () => {
    const config = loadInfrastructureConfig(baseEnvironment());

    expect(config.database).toMatchObject({
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 30_000,
      maxLifetimeSeconds: 1_800,
      poolMax: 10,
    });
  });

  it('accepts bounded PostgreSQL pool lifecycle overrides', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        DATABASE_CONNECTION_TIMEOUT_MS: '2500',
        DATABASE_IDLE_TIMEOUT_MS: '45000',
        DATABASE_MAX_LIFETIME_SECONDS: '900',
      }),
    );

    expect(config.database).toMatchObject({
      connectionTimeoutMs: 2_500,
      idleTimeoutMs: 45_000,
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
      loadInfrastructureConfig(baseEnvironment({ DATABASE_MAX_LIFETIME_SECONDS: '86401' })),
    ).toThrow('DATABASE_MAX_LIFETIME_SECONDS must be an integer between 1 and 86400');
  });

  it('builds encrypted managed-service URLs from separately injected secret fields', () => {
    const env = baseEnvironment({
      DATABASE_URL: undefined,
      DATABASE_HOST: 'db.internal.example',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'crypto_lending',
      DATABASE_USERNAME: 'service user',
      DATABASE_PASSWORD: 'p@ss:/word',
      DATABASE_SSL_MODE: 'verify-full',
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
      loadInfrastructureConfig(baseEnvironment({ DATABASE_HOST: 'db.internal.example' })),
    ).toThrow('Configure DATABASE_URL or the DATABASE_* connection components, but not both');
  });

  it('rejects ambiguous Redis configuration', () => {
    expect(() =>
      loadInfrastructureConfig(baseEnvironment({ REDIS_AUTH_TOKEN: 'not-exported' })),
    ).toThrow('Configure REDIS_URL or the REDIS_* connection components, but not both');
  });

  it('fails closed when a managed database secret field is missing', () => {
    const env = baseEnvironment({
      DATABASE_URL: undefined,
      DATABASE_HOST: 'db.internal.example',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'crypto_lending',
      DATABASE_USERNAME: 'service',
    });

    expect(() => loadInfrastructureConfig(env)).toThrow(
      'Missing required environment variable: DATABASE_PASSWORD',
    );
  });

  it('does not allow managed database fields to downgrade TLS verification', () => {
    const env = baseEnvironment({
      DATABASE_URL: undefined,
      DATABASE_HOST: 'db.internal.example',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'crypto_lending',
      DATABASE_USERNAME: 'service',
      DATABASE_PASSWORD: 'not-exported',
      DATABASE_SSL_MODE: 'require',
      NODE_EXTRA_CA_CERTS: validCaPath,
    });

    expect(() => loadInfrastructureConfig(env)).toThrow(
      'Managed DATABASE_* connection components require DATABASE_SSL_MODE=verify-full',
    );
  });

  it('requires an explicit RDS trust bundle path for managed database fields', () => {
    const env = baseEnvironment({
      DATABASE_URL: undefined,
      DATABASE_HOST: 'db.internal.example',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'crypto_lending',
      DATABASE_USERNAME: 'service',
      DATABASE_PASSWORD: 'not-exported',
      DATABASE_SSL_MODE: 'verify-full',
    });

    expect(() => loadInfrastructureConfig(env)).toThrow(
      'Managed DATABASE_* connection components require NODE_EXTRA_CA_CERTS',
    );
  });

  it('fails closed when the configured RDS trust bundle is unreadable', () => {
    const env = baseEnvironment({
      DATABASE_URL: undefined,
      DATABASE_HOST: 'db.internal.example',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'crypto_lending',
      DATABASE_USERNAME: 'service',
      DATABASE_PASSWORD: 'not-exported',
      DATABASE_SSL_MODE: 'verify-full',
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
      DATABASE_URL: undefined,
      DATABASE_HOST: 'db.internal.example',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'crypto_lending',
      DATABASE_USERNAME: 'service',
      DATABASE_PASSWORD: 'not-exported',
      DATABASE_SSL_MODE: 'verify-full',
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
    'rejects production DATABASE_URL when TLS mode is %s',
    (databaseSslMode) => {
      expect(() =>
        loadInfrastructureConfig(
          baseEnvironment({
            NODE_ENV: 'production',
            DATABASE_SSL_MODE: databaseSslMode,
            REDIS_URL: 'rediss://cache.internal.example:6379',
          }),
        ),
      ).toThrow('Production DATABASE_URL requires DATABASE_SSL_MODE=verify-full');
    },
  );

  it('rejects a production DATABASE_URL query that downgrades verified TLS', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL:
            'postgresql://service:secret@db.internal.example:5432/crypto_lending?sslmode=verify-full&sslmode=require',
          DATABASE_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://cache.internal.example:6379',
        }),
      ),
    ).toThrow('Production DATABASE_URL cannot override sslmode below verify-full');
  });

  it('rejects connection-string TLS options that would replace verified pool settings', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://service:secret@db.internal.example:5432/crypto_lending?ssl=0',
          DATABASE_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://cache.internal.example:6379',
        }),
      ),
    ).toThrow('Production DATABASE_URL cannot contain connection parameter ssl');
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
          DATABASE_URL: `postgresql://service:secret@db.internal.example:5432/crypto_lending?${parameter}`,
          DATABASE_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('Production DATABASE_URL cannot contain connection parameter');
  });

  it('rejects authority-less production database and Redis URLs', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql:/crypto_lending',
          DATABASE_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('Production DATABASE_URL must use postgresql:// or postgres://');

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_SSL_MODE: 'verify-full',
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
          DATABASE_URL: 'postgresql://service:secret@db.internal.example:5432/crypto_lending?',
          DATABASE_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('Production DATABASE_URL must not contain an empty query delimiter');
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://cache.internal.example:6379#',
        }),
      ),
    ).toThrow('Production REDIS_URL must not contain a query or fragment');
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_SSL_MODE: 'verify-full',
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
          DATABASE_SSL_MODE: 'verify-full',
          REDIS_URL: 'redis://cache.internal.example:6379',
        }),
      ),
    ).toThrow('Production REDIS_URL must use rediss://');
  });

  it('canonicalizes encrypted Redis URLs and rejects query-based TLS overrides', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'verify-full',
        REDIS_URL: 'REDISS://cache.internal.example:6379',
      }),
    );
    expect(config.redis.url).toBe('rediss://cache.internal.example:6379');

    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://cache.internal.example:6379?tls=',
        }),
      ),
    ).toThrow('REDIS_URL cannot override TLS');
  });

  it('rejects custom SQS endpoints in production', () => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_SSL_MODE: 'verify-full',
          REDIS_URL: 'rediss://cache.internal.example:6379',
          SQS_ENDPOINT: 'https://sqs-proxy.internal.example',
        }),
      ),
    ).toThrow('SQS_ENDPOINT is not allowed in production');
  });

  it('rejects plaintext or non-AWS queue URLs in production', () => {
    const secureProduction = {
      NODE_ENV: 'production',
      DATABASE_SSL_MODE: 'verify-full',
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
    `https://sqs.us-east-1.amazonaws.com/000000000000/${'q'.repeat(76)}.fifo`,
  ])('rejects a non-canonical production queue path: %s', (queueUrl) => {
    expect(() =>
      loadInfrastructureConfig(
        baseEnvironment({
          NODE_ENV: 'production',
          DATABASE_SSL_MODE: 'verify-full',
          SQS_QUEUE_URL: queueUrl,
        }),
      ),
    ).toThrow('SQS_QUEUE_URL must be a canonical HTTPS SQS queue URL');
  });

  it('accepts the AWS European Sovereign Cloud SQS DNS suffix', () => {
    const config = loadInfrastructureConfig(
      baseEnvironment({
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'verify-full',
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
        DATABASE_URL:
          'postgresql://service:secret@db.internal.example:5432/crypto_lending?sslmode=verify-full',
        DATABASE_SSL_MODE: 'verify-full',
        REDIS_URL: 'REDISS://cache.internal.example:6379',
      }),
    );

    expect(config.database.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.database.connectionString).not.toContain('sslmode');
    expect(config.redis.url).toBe('rediss://cache.internal.example:6379');
    expect(config.sqs.endpoint).toBeUndefined();
  });
});
