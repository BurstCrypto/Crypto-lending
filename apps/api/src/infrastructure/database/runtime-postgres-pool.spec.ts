import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RuntimeInfrastructureConfig } from '../config/infrastructure.config';
import { createPostgresPool, type RuntimeDatabaseCapabilityRoles } from './runtime-postgres-pool';

function runtimeConfig(
  workload: RuntimeInfrastructureConfig['workload'],
  sessionRole?: string,
  ssl: RuntimeInfrastructureConfig['database']['ssl'] = false,
): RuntimeInfrastructureConfig {
  const database = {
    connectionString: 'postgresql://unused',
    connectionTimeoutMs: 2_500,
    idleTimeoutMs: 45_000,
    lockTimeoutMs: 4_000,
    maxLifetimeSeconds: 900,
    poolMax: 7,
    statementTimeoutMs: 8_000,
    ssl,
    ...(sessionRole ? { sessionRole } : {}),
  };
  const sqsClient = {
    region: 'us-east-1',
    requestTimeoutMs: 1_000,
    sdkMaxAttempts: 1,
    maxReceiveCount: 3,
    visibilityTimeoutSeconds: 30,
    retryBaseDelaySeconds: 1,
    retryMaxDelaySeconds: 60,
  };
  if (workload === 'balance-consumer') {
    return {
      workload,
      database,
      sqs: {
        ...sqsClient,
        balanceQueueUrl: 'http://sqs.test/000000000000/balance-sync',
        balanceDeadLetterQueueUrl: 'http://sqs.test/000000000000/balance-sync-dlq',
      },
    };
  }
  return {
    workload,
    database,
    sqs: {
      ...sqsClient,
      queueUrl: 'http://sqs.test/000000000000/jobs',
      deadLetterQueueUrl: 'http://sqs.test/000000000000/jobs-dlq',
      balanceQueueUrl: 'http://sqs.test/000000000000/balance-sync',
      balanceDeadLetterQueueUrl: 'http://sqs.test/000000000000/balance-sync-dlq',
    },
  };
}

describe('createPostgresPool', () => {
  it('maps the validated runtime database settings to a lazy pool', async () => {
    const pool = createPostgresPool(runtimeConfig('api'));
    try {
      expect(pool.options).toMatchObject({
        application_name: 'crypto-lending-api',
        connectionString: 'postgresql://unused',
        connectionTimeoutMillis: 2_500,
        idleTimeoutMillis: 45_000,
        lock_timeout: 4_000,
        max: 7,
        maxLifetimeSeconds: 900,
        statement_timeout: 8_000,
        ssl: false,
      });
      expect(pool.options.options).toBeUndefined();
      expect({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }).toEqual({
        total: 0,
        idle: 0,
        waiting: 0,
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps the extracted runtime factory decorator-free and allocation-only', () => {
    const source = readFileSync(resolve(__dirname, 'runtime-postgres-pool.ts'), 'utf8');

    expect(source).not.toMatch(
      /@nestjs|InfrastructureConfigModule|postgres\.tokens|MigrationRunner|migrations|process\.env|\.connect\s*\(|\.query\s*\(/u,
    );
  });

  it.each([
    ['api', 'crypto_api_runtime'],
    ['worker', 'crypto_worker_runtime'],
    ['balance-consumer', 'crypto_balance_consumer_runtime'],
  ] as const)(
    'binds the fixed %s capability role through startup options',
    async (workload, role) => {
      const pool = createPostgresPool(runtimeConfig(workload, role));
      try {
        expect(pool.options.options).toBe(`-c role=${role} -c search_path=public,pg_temp`);
      } finally {
        await pool.end();
      }
    },
  );

  it('forwards the validated TLS configuration by identity', async () => {
    const ssl = Object.freeze({
      rejectUnauthorized: true,
      ca: 'reviewed test CA',
    });
    const pool = createPostgresPool(runtimeConfig('api', undefined, ssl));
    try {
      expect(pool.options.ssl).toBe(ssl);
    } finally {
      await pool.end();
    }
  });

  it('rejects a capability role that does not match the workload before creating a pool', () => {
    expect(() => createPostgresPool(runtimeConfig('worker', 'crypto_api_runtime'))).toThrow(
      'Database session role crypto_api_runtime does not match worker workload',
    );
  });

  it('preserves the reviewed custom capability-role seam for isolated principal tests', async () => {
    const capabilityRoles: Readonly<RuntimeDatabaseCapabilityRoles> = {
      api: 'test_api_runtime',
      balanceConsumer: 'test_balance_consumer_runtime',
      worker: 'test_worker_runtime',
    };
    const pool = createPostgresPool(
      runtimeConfig('worker', capabilityRoles.worker),
      capabilityRoles,
    );
    try {
      expect(pool.options.options).toBe(
        '-c role=test_worker_runtime -c search_path=public,pg_temp',
      );
    } finally {
      await pool.end();
    }
  });
});
