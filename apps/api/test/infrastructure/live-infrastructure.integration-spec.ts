import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';

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
import { parseWalletAddress } from '../../src/wallets/domain/wallet-identity';
import {
  createWalletRegistrationKey,
  digestWalletIdentity,
  sealWalletRegistrationValue,
} from '../../src/wallets/infrastructure/crypto/wallet-registration-crypto';
import { testOutboxDispatcherOptions } from './fixtures';

const runLiveIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithInfrastructure = runLiveIntegration ? describe : describe.skip;
const ETHEREUM_MAINNET = 'eip155:1' as const;
const ETHEREUM_ADDRESS = '0x1111111111111111111111111111111111111111';
const MAINNET_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireLoopback(rawUrl: string, name: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error(`${name} must target loopback for the live infrastructure test`);
  }
}

async function registerEthereumWallet(pool: Pool, accountId: string): Promise<string> {
  const address = parseWalletAddress(ETHEREUM_MAINNET, ETHEREUM_ADDRESS);
  const challengeId = randomUUID();
  const walletId = randomUUID();
  const identityKey = createWalletRegistrationKey(
    'identity-hmac',
    1,
    Buffer.alloc(32, 33).toString('base64url'),
    'live-smoke-identity-v1',
  );
  const metadataKey = createWalletRegistrationKey(
    'metadata-seal',
    1,
    Buffer.alloc(32, 31).toString('base64url'),
    'live-smoke-metadata-v1',
  );
  const digest = digestWalletIdentity(identityKey, ETHEREUM_MAINNET, address);
  const issuedAt = new Date();

  await pool.query(
    `SELECT * FROM begin_wallet_ownership_challenge_rotatable(
      $1::uuid, $2::uuid, 'EVM_ERC4361_ERC191'::text,
      'eip155'::text, '1'::text, 'MAINNET'::text, 1::integer, $3::text,
      1::smallint, $4::bytea, $5::bytea, $6::bytea,
      $7::smallint, $8::bytea, 1::smallint, $9::bytea,
      1::smallint, $10::bytea, 1::smallint, $11::bytea,
      $12::timestamptz, $13::timestamptz, $14::uuid,
      ARRAY[1]::smallint[], ARRAY[$15]::text[]
    )`,
    [
      challengeId,
      accountId,
      MAINNET_FINGERPRINT,
      randomBytes(48),
      randomBytes(12),
      randomBytes(16),
      digest.version,
      Buffer.from(digest.value, 'hex'),
      randomBytes(32),
      randomBytes(32),
      randomBytes(32),
      issuedAt,
      new Date(issuedAt.getTime() + 120_000),
      randomUUID(),
      digest.value,
    ],
  );

  const sealedAddress = sealWalletRegistrationValue(
    metadataKey,
    {
      field: 'address',
      walletId,
      challengeId,
      accountId,
      networkId: ETHEREUM_MAINNET,
      addressDigest: digest,
    },
    address,
  );
  const completion = await pool.query<{ registration_outcome: string; wallet_id: string }>(
    `SELECT registration_outcome, wallet_id
     FROM complete_wallet_registration_rotatable(
       $1::uuid, $2::uuid, $3::uuid,
       $4::smallint, $5::bytea, $6::bytea, $7::bytea,
       1::smallint, $8::bytea, $9::bytea, $10::bytea,
       $11::uuid
     )`,
    [
      challengeId,
      accountId,
      walletId,
      sealedAddress.keyVersion,
      Buffer.from(sealedAddress.ciphertext, 'base64url'),
      Buffer.from(sealedAddress.iv, 'base64url'),
      Buffer.from(sealedAddress.authTag, 'base64url'),
      randomBytes(64),
      randomBytes(12),
      randomBytes(16),
      randomUUID(),
    ],
  );
  expect(completion.rows).toEqual([{ registration_outcome: 'REGISTERED', wallet_id: walletId }]);
  return walletId;
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
      SQS_BALANCE_QUEUE_URL:
        process.env.SQS_BALANCE_QUEUE_URL ??
        'http://localhost:4566/000000000000/crypto-lending-balance-sync',
      SQS_BALANCE_DEAD_LETTER_QUEUE_URL:
        process.env.SQS_BALANCE_DEAD_LETTER_QUEUE_URL ??
        'http://localhost:4566/000000000000/crypto-lending-balance-sync-dlq',
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
    requireLoopback(config.sqs.balanceQueueUrl, 'SQS_BALANCE_QUEUE_URL');
    requireLoopback(config.sqs.balanceDeadLetterQueueUrl, 'SQS_BALANCE_DEAD_LETTER_QUEUE_URL');

    const schema = `kan33_live_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString, max: 1 });
    let postgresPool: Pool | undefined;
    let redisClient: Redis | undefined;
    let sqsClient: SQSClient | undefined;
    let testQueueUrl: string | undefined;
    let testDeadLetterQueueUrl: string | undefined;
    let balanceTestQueueUrl: string | undefined;
    let balanceTestDeadLetterQueueUrl: string | undefined;

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

      await expect(migrations.up()).resolves.toEqual(
        DATABASE_TEST_SCHEMA_MIGRATION_LIST.map(({ id }) => id),
      );
      await expect(
        postgresPool.query("SELECT to_regclass('ledger_journals') AS ledger_table"),
      ).resolves.toMatchObject({ rows: [{ ledger_table: 'ledger_journals' }] });
      await expect(health.check(5_000)).resolves.toMatchObject({ status: 'ok' });

      const testQueues = await createIsolatedTestQueues(sqsClient, config.sqs.maxReceiveCount);
      testQueueUrl = testQueues.queueUrl;
      testDeadLetterQueueUrl = testQueues.deadLetterQueueUrl;
      const balanceTestQueues = await createIsolatedTestQueues(
        sqsClient,
        config.sqs.maxReceiveCount,
      );
      balanceTestQueueUrl = balanceTestQueues.queueUrl;
      balanceTestDeadLetterQueueUrl = balanceTestQueues.deadLetterQueueUrl;
      const jobConfig = {
        ...config,
        sqs: {
          ...config.sqs,
          queueUrl: testQueueUrl,
          deadLetterQueueUrl: testDeadLetterQueueUrl,
          balanceQueueUrl: balanceTestQueueUrl,
          balanceDeadLetterQueueUrl: balanceTestDeadLetterQueueUrl,
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
      const accountId = randomUUID();
      await postgresPool.query(`INSERT INTO accounts (account_id) VALUES ($1::uuid)`, [accountId]);
      const walletId = await registerEthereumWallet(postgresPool, accountId);
      const outboxEnvelope = await postgres.withTransaction(() =>
        transactionalPublisher.enqueue({
          id: `kan33-outbox-${randomUUID()}`,
          kind: 'blockchain.balance-sync',
          version: 1,
          occurredAt: '2026-08-18T00:00:00.000Z',
          payload: {
            schemaVersion: 1,
            accountId,
            walletId,
            networkId: ETHEREUM_MAINNET,
            requiredTier: 'PROVISIONAL',
            cause: 'SCHEDULED',
            attempt: 1,
            rescanFromPosition: null,
          },
        }),
      );

      await expect(outboxDispatcher.dispatchBatch()).resolves.toMatchObject({
        claimed: 1,
        published: 1,
      });
      const [publishedMessage] = await isolatedSqs.receive(balanceTestQueueUrl);
      expect(publishedMessage).toBeDefined();
      expect(isolatedSqs.parseEnvelope(publishedMessage?.body ?? '')).toMatchObject({
        id: outboxEnvelope.id,
        kind: outboxEnvelope.kind,
      });
      if (publishedMessage) {
        await isolatedSqs.delete(publishedMessage, balanceTestQueueUrl);
      }
      const persistedOutbox = await postgresPool.query<{
        id: string;
        status: string;
      }>('SELECT id, status FROM job_outbox WHERE id = $1', [outboxEnvelope.id]);
      expect(persistedOutbox.rows).toEqual([{ id: outboxEnvelope.id, status: 'published' }]);

      const rolledBackOutboxId = `kan33-rollback-${randomUUID()}`;
      await expect(
        postgres.withTransaction(async () => {
          await transactionalPublisher.enqueue({
            id: rolledBackOutboxId,
            kind: 'blockchain.balance-sync',
            version: 1,
            occurredAt: '2026-08-18T00:00:01.000Z',
            payload: {
              schemaVersion: 1,
              accountId,
              walletId,
              networkId: ETHEREUM_MAINNET,
              requiredTier: 'PROVISIONAL',
              cause: 'SCHEDULED',
              attempt: 1,
              rescanFromPosition: null,
            },
          });
          throw new Error('intentional live outbox transaction rollback');
        }),
      ).rejects.toThrow('intentional live outbox transaction rollback');
      await expect(
        postgresPool.query<{ persisted: number }>(
          'SELECT count(*)::int AS persisted FROM job_outbox WHERE id = $1',
          [rolledBackOutboxId],
        ),
      ).resolves.toMatchObject({ rows: [{ persisted: 0 }] });

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
      if (sqsClient && balanceTestQueueUrl) {
        await sqsClient
          .send(new DeleteQueueCommand({ QueueUrl: balanceTestQueueUrl }))
          .catch(() => undefined);
      }
      if (sqsClient && balanceTestDeadLetterQueueUrl) {
        await sqsClient
          .send(new DeleteQueueCommand({ QueueUrl: balanceTestDeadLetterQueueUrl }))
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
