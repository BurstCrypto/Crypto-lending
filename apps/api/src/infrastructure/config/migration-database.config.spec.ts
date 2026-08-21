import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';

import { loadMigrationDatabaseConfig } from './infrastructure.config';

const REDIS_ENVIRONMENT_VARIABLES = [
  'REDIS_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_TLS',
  'REDIS_USERNAME',
  'REDIS_PASSWORD',
  'REDIS_AUTH_TOKEN',
  'REDIS_KEY_PREFIX',
  'REDIS_CONNECT_TIMEOUT_MS',
  'REDIS_COMMAND_TIMEOUT_MS',
] as const;

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'migration-rds-ca-'));
const validCaPath = join(temporaryDirectory, 'rds-ca.pem');
const validCa = rootCertificates[0];
if (!validCa) {
  throw new Error('Node did not expose a root certificate for the TLS configuration test');
}
writeFileSync(validCaPath, validCa, 'utf8');

afterAll(() => {
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

describe('loadMigrationDatabaseConfig', () => {
  it('uses an explicit migration URL without requiring runtime dependencies', () => {
    const config = loadMigrationDatabaseConfig({
      NODE_ENV: 'test',
      MIGRATION_DATABASE_URL: 'postgresql://crypto_migration:local@127.0.0.1:5432/crypto_lending',
      MIGRATION_DATABASE_SSL_MODE: 'disable',
    });

    expect(config).toMatchObject({
      connectionString: 'postgresql://crypto_migration:local@127.0.0.1:5432/crypto_lending',
      lockTimeoutMs: 10_000,
      poolMax: 1,
      statementTimeoutMs: 3_600_000,
      ssl: false,
    });
  });

  it('accepts bounded migration lock and statement timeout overrides', () => {
    const config = loadMigrationDatabaseConfig({
      NODE_ENV: 'test',
      MIGRATION_DATABASE_URL: 'postgresql://crypto_migration:local@127.0.0.1:5432/crypto_lending',
      MIGRATION_DATABASE_LOCK_TIMEOUT_MS: '25000',
      MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS: '7200000',
      MIGRATION_DATABASE_SSL_MODE: 'disable',
    });

    expect(config).toMatchObject({
      lockTimeoutMs: 25_000,
      statementTimeoutMs: 7_200_000,
    });
  });

  it('rejects migration timeouts outside their operational bounds', () => {
    const base = {
      NODE_ENV: 'test',
      MIGRATION_DATABASE_URL: 'postgresql://crypto_migration:local@127.0.0.1:5432/crypto_lending',
      MIGRATION_DATABASE_SSL_MODE: 'disable',
    };

    expect(() =>
      loadMigrationDatabaseConfig({ ...base, MIGRATION_DATABASE_LOCK_TIMEOUT_MS: '300001' }),
    ).toThrow('MIGRATION_DATABASE_LOCK_TIMEOUT_MS must be an integer between 1 and 300000');
    expect(() =>
      loadMigrationDatabaseConfig({ ...base, MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS: '43200001' }),
    ).toThrow('MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS must be an integer between 1 and 43200000');
  });

  it('preserves the legacy database URL fallback outside production', () => {
    const config = loadMigrationDatabaseConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://legacy:local@127.0.0.1:5432/crypto_lending',
      DATABASE_SSL_MODE: 'disable',
    });

    expect(config.connectionString).toBe('postgresql://legacy:local@127.0.0.1:5432/crypto_lending');
    expect(config.poolMax).toBe(1);
  });

  it('accepts only scoped, verified migration credentials in production', () => {
    const config = loadMigrationDatabaseConfig({
      NODE_ENV: 'production',
      MIGRATION_DATABASE_URL:
        'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending?sslmode=verify-full',
      MIGRATION_DATABASE_SSL_MODE: 'verify-full',
      NODE_EXTRA_CA_CERTS: validCaPath,
    });

    expect(config.connectionString).not.toContain('sslmode');
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: validCa });
    expect(config.sessionRole).toBe('crypto_schema_owner');
  });

  it('rejects a global TLS verification override in production migration tasks', () => {
    expect(() =>
      loadMigrationDatabaseConfig({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending',
        MIGRATION_DATABASE_SSL_MODE: 'verify-full',
        NODE_EXTRA_CA_CERTS: validCaPath,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow(
      'Production processes must not set NODE_TLS_REJECT_UNAUTHORIZED; certificate verification is pinned',
    );
  });

  it.each(REDIS_ENVIRONMENT_VARIABLES)(
    'rejects Redis setting %s in a production migration task',
    (variableName) => {
      expect(() =>
        loadMigrationDatabaseConfig({
          NODE_ENV: 'production',
          MIGRATION_DATABASE_URL:
            'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending',
          MIGRATION_DATABASE_SSL_MODE: 'verify-full',
          NODE_EXTRA_CA_CERTS: validCaPath,
          [variableName]: 'must-not-be-present',
        }),
      ).toThrow('Production migration tasks must not receive Redis configuration or credentials');
    },
  );

  it('rejects unknown Redis aliases in a production migration task', () => {
    expect(() =>
      loadMigrationDatabaseConfig({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending',
        MIGRATION_DATABASE_SSL_MODE: 'verify-full',
        NODE_EXTRA_CA_CERTS: validCaPath,
        REDIS_OPERATOR_TOKEN: 'must-not-be-injected',
      }),
    ).toThrow('Production migration tasks must not receive Redis configuration or credentials');
  });

  it('requires an explicit trust bundle for a production migration URL', () => {
    expect(() =>
      loadMigrationDatabaseConfig({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending',
        MIGRATION_DATABASE_SSL_MODE: 'verify-full',
      }),
    ).toThrow('Production MIGRATION_DATABASE_URL requires NODE_EXTRA_CA_CERTS');
  });

  it('rejects runtime credentials in a production migration process', () => {
    expect(() =>
      loadMigrationDatabaseConfig({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending',
        MIGRATION_DATABASE_SSL_MODE: 'verify-full',
        DATABASE_RUNTIME_URL:
          'postgresql://crypto_runtime:secret@db.internal.example:5432/crypto_lending',
      }),
    ).toThrow('Production migration tasks must not receive any DATABASE_RUNTIME_* variable');
  });

  it('rejects unknown runtime and privileged database aliases in production migrations', () => {
    const base = {
      NODE_ENV: 'production',
      MIGRATION_DATABASE_URL:
        'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending',
      MIGRATION_DATABASE_SSL_MODE: 'verify-full',
      NODE_EXTRA_CA_CERTS: validCaPath,
    };

    expect(() =>
      loadMigrationDatabaseConfig({
        ...base,
        DATABASE_RUNTIME_PASSWORD_BACKUP: 'must-not-be-injected',
      }),
    ).toThrow('Production migration tasks must not receive any DATABASE_RUNTIME_* variable');
    expect(() =>
      loadMigrationDatabaseConfig({ ...base, RDS_ADMIN_TOKEN: 'must-not-be-injected' }),
    ).toThrow(
      'Production migration tasks must not receive database bootstrap, master, or admin variables',
    );
  });

  it('rejects a runtime identity disguised as a production migration URL', () => {
    expect(() =>
      loadMigrationDatabaseConfig({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgresql://crypto_runtime:secret@db.internal.example:5432/crypto_lending',
        MIGRATION_DATABASE_SSL_MODE: 'verify-full',
      }),
    ).toThrow('must contain the reviewed crypto_migration username and a password');
  });

  it('rejects legacy credentials in a production migration process', () => {
    expect(() =>
      loadMigrationDatabaseConfig({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending',
        MIGRATION_DATABASE_SSL_MODE: 'verify-full',
        DATABASE_URL: 'postgresql://legacy:secret@db.internal.example:5432/crypto_lending',
      }),
    ).toThrow('Production migration tasks require MIGRATION_DATABASE_* connection variables');
  });

  it('fails closed when production migration configuration is absent', () => {
    expect(() =>
      loadMigrationDatabaseConfig({
        NODE_ENV: 'production',
      }),
    ).toThrow('Missing required environment variable: MIGRATION_DATABASE_HOST');
  });

  it('rejects migration URL connection options that override pool safety', () => {
    expect(() =>
      loadMigrationDatabaseConfig({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgresql://crypto_migration:secret@db.internal.example:5432/crypto_lending?statement_timeout=0',
        MIGRATION_DATABASE_SSL_MODE: 'verify-full',
      }),
    ).toThrow('Production MIGRATION_DATABASE_URL cannot contain connection parameter');
  });
});
