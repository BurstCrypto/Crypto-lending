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
  return {
    DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/crypto_lending',
    DATABASE_SSL_MODE: 'disable',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REDIS_KEY_PREFIX: 'crypto-lending:test:v1:',
    AWS_REGION: 'us-east-1',
    SQS_QUEUE_URL: 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs',
    SQS_DEAD_LETTER_QUEUE_URL: 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs-dlq',
    ...overrides,
  };
}

describe('loadInfrastructureConfig', () => {
  it('retains explicit local connection URLs', () => {
    const config = loadInfrastructureConfig(baseEnvironment());

    expect(config.database.connectionString).toBe(
      'postgresql://local:local@127.0.0.1:5432/crypto_lending',
    );
    expect(config.redis.url).toBe('redis://127.0.0.1:6379');
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
});
