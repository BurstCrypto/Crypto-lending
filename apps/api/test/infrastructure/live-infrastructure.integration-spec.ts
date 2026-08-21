import { randomUUID } from 'node:crypto';

import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { Redis } from 'ioredis';
import { Pool } from 'pg';

import { loadInfrastructureConfig } from '../../src/infrastructure/config/infrastructure.config';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { InfrastructureHealthService } from '../../src/infrastructure/health/infrastructure-health.service';
import { JobOutboxRepository } from '../../src/infrastructure/outbox/job-outbox.repository';
import { OutboxDispatcher } from '../../src/infrastructure/outbox/outbox-dispatcher.service';
import { TransactionalJobPublisher } from '../../src/infrastructure/outbox/transactional-job-publisher.service';
import { createRedisClient } from '../../src/infrastructure/redis/redis.module';
import { RedisService } from '../../src/infrastructure/redis/redis.service';
import { SqsJobWorker } from '../../src/infrastructure/sqs/sqs-job.worker';
import { SqsService } from '../../src/infrastructure/sqs/sqs.service';
import { testOutboxDispatcherOptions } from './fixtures';

const runLiveIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithInfrastructure = runLiveIntegration ? describe : describe.skip;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireLoopback(rawUrl: string, name: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error(`${name} must target loopback for the live infrastructure test`);
  }
}

describeWithInfrastructure('live docker-compose infrastructure', () => {
  jest.setTimeout(45_000);

  it('is healthy, publishes a transactional outbox job, rolls back, and redrives a failed job', async () => {
    const connectionString =
      process.env.TEST_DATABASE_URL ??
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_RUNTIME_URL ??
      process.env.DATABASE_URL ??
      'postgresql://crypto_admin:local_admin_only@localhost:5432/crypto_lending';
    const config = loadInfrastructureConfig({
      NODE_ENV: 'test',
      APPLICATION_WORKLOAD: 'api',
      DATABASE_RUNTIME_URL: connectionString,
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      REDIS_HOST: process.env.REDIS_HOST ?? '127.0.0.1',
      REDIS_PORT: process.env.REDIS_PORT ?? '6379',
      REDIS_TLS: process.env.REDIS_TLS ?? 'false',
      REDIS_USERNAME: process.env.REDIS_USERNAME ?? 'crypto_api_a',
      REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? 'local-api-current',
      AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
      SQS_ENDPOINT: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
      SQS_QUEUE_URL:
        process.env.SQS_QUEUE_URL ?? 'http://localhost:4566/000000000000/crypto-lending-jobs',
      SQS_DEAD_LETTER_QUEUE_URL:
        process.env.SQS_DEAD_LETTER_QUEUE_URL ??
        'http://localhost:4566/000000000000/crypto-lending-jobs-dlq',
      SQS_MAX_RECEIVE_COUNT: '3',
      SQS_VISIBILITY_TIMEOUT_SECONDS: '5',
      SQS_RETRY_BASE_DELAY_SECONDS: '1',
      SQS_RETRY_MAX_DELAY_SECONDS: '1',
    });
    if (config.workload !== 'api' || !config.redis) {
      throw new Error('Live infrastructure integration requires API Redis configuration');
    }
    const redisConfig = config.redis;
    requireLoopback(config.database.connectionString, 'DATABASE_RUNTIME_URL');
    requireLoopback(redisConfig.url, 'REDIS_URL');
    requireLoopback(config.sqs.endpoint ?? '', 'SQS_ENDPOINT');
    requireLoopback(config.sqs.queueUrl, 'SQS_QUEUE_URL');
    requireLoopback(config.sqs.deadLetterQueueUrl, 'SQS_DEAD_LETTER_QUEUE_URL');

    const schema = `kan33_live_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString, max: 1 });
    let postgresPool: Pool | undefined;
    let redisClient: Redis | undefined;
    let sqsClient: SQSClient | undefined;
    let testQueueUrl: string | undefined;
    let testDeadLetterQueueUrl: string | undefined;

    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      postgresPool = new Pool({
        connectionString,
        max: 2,
        options: `-c search_path=${schema}`,
      });
      redisClient = createRedisClient(config);
      sqsClient = new SQSClient({
        region: config.sqs.region,
        ...(config.sqs.endpoint ? { endpoint: config.sqs.endpoint } : {}),
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        maxAttempts: 1,
      });

      const postgres = new PostgresService(postgresPool);
      const redis = new RedisService(redisClient);
      const sqs = new SqsService(sqsClient, config);
      const migrations = new MigrationRunner(postgresPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);
      const health = new InfrastructureHealthService(postgres, migrations, redis, sqs);

      await expect(migrations.up()).resolves.toEqual([
        '0001',
        '0002',
        '0003',
        '0004',
        '0006',
        '0007',
        '0008',
        '0009',
      ]);
      await expect(
        postgresPool.query("SELECT to_regclass('ledger_journals') AS ledger_table"),
      ).resolves.toMatchObject({ rows: [{ ledger_table: 'ledger_journals' }] });
      await expect(health.check(5_000)).resolves.toMatchObject({ status: 'ok' });

      const testQueues = await createIsolatedTestQueues(sqsClient, config.sqs.maxReceiveCount);
      testQueueUrl = testQueues.queueUrl;
      testDeadLetterQueueUrl = testQueues.deadLetterQueueUrl;
      const jobConfig = {
        ...config,
        sqs: {
          ...config.sqs,
          queueUrl: testQueueUrl,
          deadLetterQueueUrl: testDeadLetterQueueUrl,
        },
      };

      const isolatedSqs = new SqsService(sqsClient, jobConfig);
      const outboxRepository = new JobOutboxRepository(postgres);
      const transactionalPublisher = new TransactionalJobPublisher(outboxRepository);
      const outboxDispatcher = new OutboxDispatcher(
        outboxRepository,
        isolatedSqs,
        testOutboxDispatcherOptions({ batchSize: 5 }),
      );
      const outboxEnvelope = await postgres.withTransaction(() =>
        transactionalPublisher.enqueue({
          id: `kan33-outbox-${randomUUID()}`,
          kind: 'sample.live-outbox',
          occurredAt: '2026-08-18T00:00:00.000Z',
          payload: { acceptanceTest: true },
        }),
      );

      await expect(outboxDispatcher.dispatchBatch()).resolves.toMatchObject({
        claimed: 1,
        published: 1,
      });
      const [publishedMessage] = await isolatedSqs.receive(testQueueUrl);
      expect(publishedMessage).toBeDefined();
      expect(isolatedSqs.parseEnvelope(publishedMessage?.body ?? '')).toMatchObject({
        id: outboxEnvelope.id,
        kind: outboxEnvelope.kind,
      });
      if (publishedMessage) {
        await isolatedSqs.delete(publishedMessage, testQueueUrl);
      }
      const persistedOutbox = await postgresPool.query<{
        id: string;
        status: string;
      }>('SELECT id, status FROM job_outbox WHERE id = $1', [outboxEnvelope.id]);
      expect(persistedOutbox.rows).toEqual([{ id: outboxEnvelope.id, status: 'published' }]);

      await expect(migrations.down(8)).resolves.toEqual([
        '0009',
        '0008',
        '0007',
        '0006',
        '0004',
        '0003',
        '0002',
        '0001',
      ]);
      const rolledBack = await postgresPool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'job_outbox'`,
        [schema],
      );
      expect(rolledBack.rows).toEqual([]);
      await expect(
        postgresPool.query("SELECT to_regclass('ledger_journals') AS ledger_table"),
      ).resolves.toMatchObject({ rows: [{ ledger_table: null }] });

      const worker = new SqsJobWorker(isolatedSqs, jobConfig);
      const sample = await isolatedSqs.sendJob(
        'sample.live-always-fails',
        { acceptanceTest: true },
        { id: `kan33-${randomUUID()}` },
      );
      let observedFailures = 0;
      const retryDeadline = Date.now() + 20_000;
      while (observedFailures < jobConfig.sqs.maxReceiveCount && Date.now() < retryDeadline) {
        const processed = await worker.processOne(async () => {
          throw new Error('intentional KAN-33 acceptance failure');
        });
        if (processed.status === 'retry-scheduled' || processed.status === 'awaiting-dead-letter') {
          observedFailures = processed.receiveCount;
        } else if (processed.status === 'idle') {
          await delay(100);
        }
      }
      expect(observedFailures).toBe(jobConfig.sqs.maxReceiveCount);

      let deadLetterBody: string | undefined;
      const deadLetterDeadline = Date.now() + 20_000;
      while (!deadLetterBody && Date.now() < deadLetterDeadline) {
        const unexpectedSource = await isolatedSqs.receive(testQueueUrl);
        if (unexpectedSource[0]) {
          await isolatedSqs.changeVisibility(unexpectedSource[0], 0, testQueueUrl);
        }
        const deadLetters = await isolatedSqs.receive(testDeadLetterQueueUrl, 10);
        for (const message of deadLetters) {
          const envelope = isolatedSqs.parseEnvelope(message.body);
          if (envelope.id === sample.id) {
            deadLetterBody = message.body;
          }
          await isolatedSqs.delete(message, testDeadLetterQueueUrl);
        }
        if (!deadLetterBody) {
          await delay(100);
        }
      }

      expect(deadLetterBody).toBeDefined();
      expect(isolatedSqs.parseEnvelope(deadLetterBody ?? '')).toMatchObject({
        id: sample.id,
        kind: 'sample.live-always-fails',
      });
    } finally {
      if (redisClient) {
        if (redisClient.status === 'end') {
          // Nothing to close.
        } else {
          await redisClient.quit().catch(() => redisClient?.disconnect(false));
        }
      }
      if (sqsClient && testQueueUrl) {
        await sqsClient
          .send(new DeleteQueueCommand({ QueueUrl: testQueueUrl }))
          .catch(() => undefined);
      }
      if (sqsClient && testDeadLetterQueueUrl) {
        await sqsClient
          .send(new DeleteQueueCommand({ QueueUrl: testDeadLetterQueueUrl }))
          .catch(() => undefined);
      }
      sqsClient?.destroy();
      if (postgresPool) {
        await postgresPool.end();
      }
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });
});

async function createIsolatedTestQueues(
  client: SQSClient,
  maxReceiveCount: number,
): Promise<{ queueUrl: string; deadLetterQueueUrl: string }> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const deadLetter = await client.send(
    new CreateQueueCommand({
      QueueName: `kan33-${suffix}-dlq`,
      Attributes: { MessageRetentionPeriod: '300' },
    }),
  );
  if (!deadLetter.QueueUrl) {
    throw new Error('LocalStack did not return the test DLQ URL');
  }

  const attributes = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: deadLetter.QueueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const deadLetterArn = attributes.Attributes?.QueueArn;
  if (!deadLetterArn) {
    throw new Error('LocalStack did not return the test DLQ ARN');
  }

  const source = await client.send(
    new CreateQueueCommand({
      QueueName: `kan33-${suffix}-jobs`,
      Attributes: {
        VisibilityTimeout: '5',
        ReceiveMessageWaitTimeSeconds: '0',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: deadLetterArn,
          maxReceiveCount: String(maxReceiveCount),
        }),
      },
    }),
  );
  if (!source.QueueUrl) {
    await client.send(new DeleteQueueCommand({ QueueUrl: deadLetter.QueueUrl }));
    throw new Error('LocalStack did not return the test source queue URL');
  }

  return {
    queueUrl: source.QueueUrl,
    deadLetterQueueUrl: deadLetter.QueueUrl,
  };
}
