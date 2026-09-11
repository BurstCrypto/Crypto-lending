import { Module } from '@nestjs/common';

import { PostgresModule } from '../database/postgres.module';
import { SQS_HEALTH } from '../health/sqs-health.port';
import { OUTBOX_TRANSPORT } from './outbox-transport.port';
import { PostgresJobQueueConsumer } from './postgres-job-queue-consumer.service';
import { PostgresOutboxTransport } from './postgres-outbox-transport.service';

@Module({
  imports: [PostgresModule],
  providers: [
    PostgresOutboxTransport,
    PostgresJobQueueConsumer,
    { provide: OUTBOX_TRANSPORT, useExisting: PostgresOutboxTransport },
    // Keep the existing health token/API response shape stable while the
    // implementation moves from SQS to the durable PostgreSQL queue.
    { provide: SQS_HEALTH, useExisting: PostgresOutboxTransport },
  ],
  exports: [OUTBOX_TRANSPORT, SQS_HEALTH, PostgresJobQueueConsumer],
})
export class PostgresOutboxTransportModule {}
