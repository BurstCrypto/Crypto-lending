import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { fromHttp } from '@aws-sdk/credential-provider-http';

import {
  INFRASTRUCTURE_CONFIG,
  InfrastructureConfigModule,
} from '../config/infrastructure-config.module';
import type {
  InfrastructureConfig,
  RuntimeInfrastructureConfig,
} from '../config/infrastructure.config';
import { SQS_HEALTH } from '../health/sqs-health.port';
import { OUTBOX_TRANSPORT } from '../outbox/outbox-transport.port';
import { SqsJobWorker } from './sqs-job.worker';
import {
  PinnedSqsQueueReceiptAdapter,
  type PinnedSqsQueueReceiptPort,
} from './sqs-queue-receipt.port';
import { SqsService } from './sqs.service';
import { SQS_CLIENT, SQS_PINNED_QUEUE_RECEIPT, SQS_WORKER_QUEUE } from './sqs.tokens';

const LOCAL_SQS_CREDENTIALS = {
  accessKeyId: 'local-emulator',
  secretAccessKey: 'local-emulator',
};

export function createSqsClient(config: RuntimeInfrastructureConfig): SQSClient {
  const credentials = config.sqs.endpoint
    ? LOCAL_SQS_CREDENTIALS
    : config.sqs.credentialRelativeUri
      ? fromHttp({
          awsContainerCredentialsRelativeUri: config.sqs.credentialRelativeUri,
          awsContainerCredentialsFullUri: '',
          awsContainerAuthorizationToken: '',
          awsContainerAuthorizationTokenFile: '',
          maxRetries: 2,
          timeout: 1_000,
        })
      : undefined;
  return new SQSClient({
    region: config.sqs.region,
    maxAttempts: config.sqs.sdkMaxAttempts,
    // Never let a QueueUrl replace the configured client origin. This is
    // defense in depth against credential-bearing requests to a bad URL.
    useQueueUrlAsEndpoint: false,
    // Ignore AWS_ENDPOINT_URL*, shared-profile endpoint_url, and the matching
    // SDK setting so ambient configuration cannot redirect signed requests.
    ignoreConfiguredEndpointUrls: true,
    ...(credentials ? { credentials } : {}),
    ...(config.sqs.endpoint
      ? {
          endpoint: config.sqs.endpoint,
          // A local emulator must never receive credentials inherited from a
          // developer shell. Production omits this override and uses the ECS
          // task-role provider chain.
        }
      : {}),
  });
}

@Module({
  imports: [InfrastructureConfigModule],
  providers: [
    {
      provide: SQS_CLIENT,
      inject: [INFRASTRUCTURE_CONFIG],
      useFactory: createSqsClient,
    },
    SqsService,
    { provide: SQS_WORKER_QUEUE, useValue: 'jobs' },
    {
      provide: OUTBOX_TRANSPORT,
      useExisting: SqsService,
    },
    {
      provide: SQS_HEALTH,
      useExisting: SqsService,
    },
    {
      provide: SQS_PINNED_QUEUE_RECEIPT,
      inject: [SqsService, INFRASTRUCTURE_CONFIG],
      useFactory: (sqs: SqsService, config: InfrastructureConfig): PinnedSqsQueueReceiptPort =>
        new PinnedSqsQueueReceiptAdapter(sqs, config.sqs.queueUrl),
    },
    {
      provide: SqsJobWorker,
      inject: [SQS_PINNED_QUEUE_RECEIPT, INFRASTRUCTURE_CONFIG, SQS_WORKER_QUEUE],
      useFactory: (
        receipt: PinnedSqsQueueReceiptPort,
        config: InfrastructureConfig,
        queue: 'jobs',
      ): SqsJobWorker => new SqsJobWorker(receipt, config.sqs, undefined, queue),
    },
  ],
  exports: [OUTBOX_TRANSPORT, SQS_HEALTH, SqsJobWorker],
})
export class SqsModule {}
