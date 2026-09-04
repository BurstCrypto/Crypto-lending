import { fromHttp } from '@aws-sdk/credential-provider-http';

import type { InfrastructureConfig } from '../config/infrastructure.config';
import { SqsJobWorker } from './sqs-job.worker';
import { createSqsClient, SqsModule } from './sqs.module';
import { SQS_WORKER_QUEUE } from './sqs.tokens';

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

  it('registers only one dormant-safe generic jobs worker binding', () => {
    const providers = Reflect.getMetadata('providers', SqsModule) as unknown[];
    expect(providers.filter((provider) => provider === SqsJobWorker)).toHaveLength(1);
    expect(providers).toContainEqual({ provide: SQS_WORKER_QUEUE, useValue: 'jobs' });
    expect(providers).not.toContainEqual({ provide: SQS_WORKER_QUEUE, useValue: 'balance' });
  });
});
