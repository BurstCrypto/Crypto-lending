import type { InfrastructureConfig } from '../config/infrastructure.config';
import { createRedisClient } from './redis.module';

function apiConfig(): InfrastructureConfig {
  return {
    workload: 'api',
    database: {
      connectionString: 'postgresql://local:local@127.0.0.1:5432/crypto_lending',
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 30_000,
      lockTimeoutMs: 5_000,
      maxLifetimeSeconds: 1_800,
      poolMax: 10,
      statementTimeoutMs: 15_000,
      ssl: false,
    },
    redis: {
      url: 'redis://127.0.0.1:6379',
      connectTimeoutMs: 4_000,
      commandTimeoutMs: 1_500,
    },
    sqs: {
      region: 'us-east-1',
      queueUrl: 'http://127.0.0.1:4566/000000000000/jobs',
      deadLetterQueueUrl: 'http://127.0.0.1:4566/000000000000/jobs-dlq',
      requestTimeoutMs: 15_000,
      sdkMaxAttempts: 3,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 1,
      retryMaxDelaySeconds: 60,
    },
  };
}

describe('createRedisClient', () => {
  it('uses only the reviewed handshake and readiness behavior', () => {
    const client = createRedisClient(apiConfig());
    try {
      expect(client.options).toMatchObject({
        lazyConnect: true,
        enableReadyCheck: false,
        disableClientInfo: true,
        db: 0,
        connectTimeout: 4_000,
        commandTimeout: 1_500,
        maxRetriesPerRequest: 2,
      });
      expect(client.options.keyPrefix).toBe('');
      expect(client.options.connectionName).toBeNull();
    } finally {
      client.disconnect(false);
    }
  });

  it('refuses to construct a Redis client for the worker workload', () => {
    const api = apiConfig();
    const config: InfrastructureConfig = {
      workload: 'worker',
      database: api.database,
      sqs: api.sqs,
    };
    expect(() => createRedisClient(config)).toThrow(
      'Redis client creation is restricted to the API workload',
    );
  });

  it('pins certificate verification for an encrypted Redis connection', () => {
    const config = apiConfig();
    if (!config.redis) throw new Error('API fixture must include Redis configuration');
    config.redis = {
      ...config.redis,
      url: 'rediss://crypto_api_a:not-exported@cache.internal.example:6379/',
    };
    const client = createRedisClient(config);
    try {
      expect(client.options.tls).toEqual({ rejectUnauthorized: true });
    } finally {
      client.disconnect(false);
    }
  });
});
