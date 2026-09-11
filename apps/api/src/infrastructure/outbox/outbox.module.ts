import { Module } from '@nestjs/common';

import { PostgresModule } from '../database/postgres.module';
import { JobOutboxRepository } from './job-outbox.repository';
import { JOB_PUBLISHER } from './job-publisher.port';
import {
  loadOutboxDispatcherOptions,
  OUTBOX_DISPATCHER_OPTIONS,
} from './outbox-dispatcher.options';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { OutboxTransportModule } from './outbox-transport.module';
import { OutboxWorker } from './outbox-worker.service';
import { TransactionalJobPublisher } from './transactional-job-publisher.service';

@Module({
  imports: [PostgresModule, OutboxTransportModule],
  providers: [
    JobOutboxRepository,
    TransactionalJobPublisher,
    {
      provide: JOB_PUBLISHER,
      useExisting: TransactionalJobPublisher,
    },
    {
      provide: OUTBOX_DISPATCHER_OPTIONS,
      useFactory: loadOutboxDispatcherOptions,
    },
    OutboxDispatcher,
    OutboxWorker,
  ],
  // The dispatcher is exported only as an explicit worker-process entrypoint;
  // it is never started by importing this module into an API replica.
  exports: [JOB_PUBLISHER, OutboxWorker, OutboxTransportModule],
})
export class OutboxModule {}
