import type { InfrastructureConfig } from '../../src/infrastructure/config/infrastructure.config';

export function testInfrastructureConfig(
  overrides: Partial<InfrastructureConfig['sqs']> = {},
): InfrastructureConfig {
  return {
    database: {
      connectionString: 'postgresql://unused',
      poolMax: 1,
      statementTimeoutMs: 1_000,
      ssl: false,
    },
    redis: {
      url: 'redis://unused',
      keyPrefix: 'crypto-lending:test:v1:',
      connectTimeoutMs: 100,
      commandTimeoutMs: 100,
    },
    sqs: {
      region: 'us-east-1',
      queueUrl: 'http://sqs.test/000000000000/jobs',
      deadLetterQueueUrl: 'http://sqs.test/000000000000/jobs-dlq',
      sdkMaxAttempts: 1,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 1,
      retryMaxDelaySeconds: 60,
      ...overrides,
    },
  };
}
