import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';

import {
  INFRASTRUCTURE_CONFIG,
  InfrastructureConfigModule,
} from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import { SQS_HEALTH } from '../health/sqs-health.port';
import { OUTBOX_TRANSPORT } from '../outbox/outbox-transport.port';
import { SqsJobWorker } from './sqs-job.worker';
import { SqsService } from './sqs.service';
import { SQS_CLIENT } from './sqs.tokens';

@Module({
  imports: [InfrastructureConfigModule],
  providers: [
    {
      provide: SQS_CLIENT,
      inject: [INFRASTRUCTURE_CONFIG],
      useFactory: (config: InfrastructureConfig): SQSClient =>
        new SQSClient({
          region: config.sqs.region,
          maxAttempts: config.sqs.sdkMaxAttempts,
          ...(config.sqs.endpoint
            ? {
                endpoint: config.sqs.endpoint,
                credentials: {
                  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
                  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
                },
              }
            : {}),
        }),
    },
    SqsService,
    {
      provide: OUTBOX_TRANSPORT,
      useExisting: SqsService,
    },
    {
      provide: SQS_HEALTH,
      useExisting: SqsService,
    },
    SqsJobWorker,
  ],
  exports: [OUTBOX_TRANSPORT, SQS_HEALTH, SqsJobWorker],
})
export class SqsModule {}
