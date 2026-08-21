import type { InfrastructureConfig } from '../../src/infrastructure/config/infrastructure.config';
import type { OutboxDispatcherOptions } from '../../src/infrastructure/outbox/outbox-dispatcher.options';

export function testInfrastructureConfig(
  overrides: Partial<InfrastructureConfig['sqs']> = {},
): InfrastructureConfig {
  return {
    workload: 'api',
    database: {
      connectionString: 'postgresql://unused',
      connectionTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      lockTimeoutMs: 100,
      maxLifetimeSeconds: 60,
      poolMax: 1,
      statementTimeoutMs: 1_000,
      ssl: false,
    },
    redis: {
      url: 'redis://unused',
      connectTimeoutMs: 100,
      commandTimeoutMs: 100,
    },
    sqs: {
      region: 'us-east-1',
      queueUrl: 'http://sqs.test/000000000000/jobs',
      deadLetterQueueUrl: 'http://sqs.test/000000000000/jobs-dlq',
      requestTimeoutMs: 1_000,
      sdkMaxAttempts: 1,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 1,
      retryMaxDelaySeconds: 60,
      ...overrides,
    },
  };
}

export function testOutboxDispatcherOptions(
  overrides: Partial<OutboxDispatcherOptions> = {},
): OutboxDispatcherOptions {
  return {
    batchSize: 10,
    cleanupBatchSize: 100,
    cleanupIntervalMs: 60_000,
    concurrency: 2,
    failedRetentionMs: 30 * 24 * 60 * 60 * 1_000,
    leaseMs: 5_000,
    maxAttempts: 3,
    publishTimeoutMs: 1_000,
    publishedRetentionMs: 7 * 24 * 60 * 60 * 1_000,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1_000,
    ...overrides,
  };
}
