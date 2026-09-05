import { fromHttp } from '@aws-sdk/credential-provider-http';

import type {
  BalanceConsumerInfrastructureConfig,
  InfrastructureConfig,
} from '../config/infrastructure.config';
import { SqsJobWorker } from './sqs-job.worker';
import { createSqsClient, SqsModule } from './sqs.module';
import type { PinnedSqsQueueReceiptPort } from './sqs-queue-receipt.port';
import type { SqsService } from './sqs.service';
import { SQS_PINNED_QUEUE_RECEIPT, SQS_WORKER_QUEUE } from './sqs.tokens';

jest.mock('@aws-sdk/credential-provider-http', () => ({ fromHttp: jest.fn() }));

const mockedFromHttp = jest.mocked(fromHttp);

describe('createSqsClient', () => {
  beforeEach(() => mockedFromHttp.mockReset());

  it('uses fixed dummy credentials for a local endpoint instead of shell credentials', async () => {
    const previousAccessKey = process.env.AWS_ACCESS_KEY_ID;
    const previousSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_ACCESS_KEY_ID = 'must-not-reach-local-emulator';
    process.env.AWS_SECRET_ACCESS_KEY = 'must-not-reach-local-emulator';

    const config = {
      sqs: {
        region: 'us-east-1',
        endpoint: 'http://127.0.0.1:4566',
        queueUrl: 'http://127.0.0.1:4566/000000000000/jobs',
        deadLetterQueueUrl: 'http://127.0.0.1:4566/000000000000/jobs-dlq',
        balanceQueueUrl: 'http://127.0.0.1:4566/000000000000/balance-sync',
        balanceDeadLetterQueueUrl: 'http://127.0.0.1:4566/000000000000/balance-sync-dlq',
        requestTimeoutMs: 15_000,
        sdkMaxAttempts: 1,
        maxReceiveCount: 3,
        visibilityTimeoutSeconds: 30,
        retryBaseDelaySeconds: 1,
        retryMaxDelaySeconds: 60,
      },
    } as InfrastructureConfig;

    const client = createSqsClient(config);
    try {
      expect(client.config.ignoreConfiguredEndpointUrls).toBe(true);
      await expect(client.config.credentials()).resolves.toMatchObject({
        accessKeyId: 'local-emulator',
        secretAccessKey: 'local-emulator',
      });
    } finally {
      client.destroy();
      if (previousAccessKey === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = previousAccessKey;
      }
      if (previousSecretKey === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = previousSecretKey;
      }
    }
  });

  it('pins production credential resolution to the validated ECS relative endpoint', () => {
    const provider = jest.fn(async () => ({
      accessKeyId: 'task-role-access-key',
      secretAccessKey: 'task-role-secret-key',
    })) as ReturnType<typeof fromHttp>;
    mockedFromHttp.mockReturnValue(provider);
    const config = {
      sqs: {
        region: 'us-east-1',
        credentialRelativeUri: '/v2/credentials/task-role',
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs',
        deadLetterQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs-dlq',
        balanceQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
        balanceDeadLetterQueueUrl:
          'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync-dlq',
        requestTimeoutMs: 15_000,
        sdkMaxAttempts: 3,
        maxReceiveCount: 3,
        visibilityTimeoutSeconds: 30,
        retryBaseDelaySeconds: 1,
        retryMaxDelaySeconds: 60,
      },
    } as InfrastructureConfig;

    const client = createSqsClient(config);
    try {
      expect(client.config.ignoreConfiguredEndpointUrls).toBe(true);
      expect(mockedFromHttp).toHaveBeenCalledWith({
        awsContainerCredentialsRelativeUri: '/v2/credentials/task-role',
        awsContainerCredentialsFullUri: '',
        awsContainerAuthorizationToken: '',
        awsContainerAuthorizationTokenFile: '',
        maxRetries: 2,
        timeout: 1_000,
      });
    } finally {
      client.destroy();
    }
  });

  it('constructs the shared client from balance-only consumer configuration', async () => {
    const config: BalanceConsumerInfrastructureConfig = {
      workload: 'balance-consumer',
      database: {
        connectionString: 'postgresql://unused',
        connectionTimeoutMs: 100,
        idleTimeoutMs: 100,
        lockTimeoutMs: 100,
        maxLifetimeSeconds: 100,
        poolMax: 1,
        statementTimeoutMs: 100,
        ssl: false,
      },
      sqs: {
        region: 'us-east-1',
        endpoint: 'http://127.0.0.1:4566',
        balanceQueueUrl: 'http://127.0.0.1:4566/000000000000/balance-sync',
        balanceDeadLetterQueueUrl: 'http://127.0.0.1:4566/000000000000/balance-sync-dlq',
        requestTimeoutMs: 15_000,
        sdkMaxAttempts: 1,
        maxReceiveCount: 3,
        visibilityTimeoutSeconds: 30,
        retryBaseDelaySeconds: 1,
        retryMaxDelaySeconds: 60,
      },
    };

    const client = createSqsClient(config);
    try {
      expect(client.config.ignoreConfiguredEndpointUrls).toBe(true);
      await expect(client.config.credentials()).resolves.toMatchObject({
        accessKeyId: 'local-emulator',
        secretAccessKey: 'local-emulator',
      });
    } finally {
      client.destroy();
    }
  });

  it('registers only one dormant-safe generic jobs worker binding', () => {
    const providers = Reflect.getMetadata('providers', SqsModule) as unknown[];
    expect(
      providers.filter(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          (provider as { provide?: unknown }).provide === SqsJobWorker,
      ),
    ).toHaveLength(1);
    expect(
      providers.filter(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          (provider as { provide?: unknown }).provide === SQS_PINNED_QUEUE_RECEIPT,
      ),
    ).toHaveLength(1);
    expect(providers).toContainEqual({ provide: SQS_WORKER_QUEUE, useValue: 'jobs' });
    expect(providers).not.toContainEqual({ provide: SQS_WORKER_QUEUE, useValue: 'balance' });
  });

  it('pins the generic Nest worker factory to only the jobs source queue', async () => {
    const config = {
      workload: 'worker',
      database: {},
      sqs: {
        region: 'us-east-1',
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs',
        deadLetterQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs-dlq',
        balanceQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
        balanceDeadLetterQueueUrl:
          'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync-dlq',
        requestTimeoutMs: 15_000,
        sdkMaxAttempts: 1,
        maxReceiveCount: 3,
        visibilityTimeoutSeconds: 30,
        retryBaseDelaySeconds: 1,
        retryMaxDelaySeconds: 60,
      },
    } as InfrastructureConfig;
    const providers = Reflect.getMetadata('providers', SqsModule) as unknown[];
    const receiptProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === SQS_PINNED_QUEUE_RECEIPT,
    ) as {
      useFactory(service: SqsService, current: InfrastructureConfig): PinnedSqsQueueReceiptPort;
    };
    const workerProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === SqsJobWorker,
    ) as {
      useFactory(
        receipt: PinnedSqsQueueReceiptPort,
        current: InfrastructureConfig,
        queue: 'jobs',
      ): SqsJobWorker;
    };
    const receive = jest.fn().mockResolvedValue([]);
    const service = { receive } as unknown as SqsService;

    const receipt = receiptProvider.useFactory(service, config);
    const worker = workerProvider.useFactory(receipt, config, 'jobs');

    await expect(worker.processOne(async () => undefined)).resolves.toEqual({ status: 'idle' });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith(config.sqs.queueUrl);
    expect(receive).not.toHaveBeenCalledWith(config.sqs.balanceQueueUrl);
  });
});
