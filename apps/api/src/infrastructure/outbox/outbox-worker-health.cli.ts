import '../config/load-dotenv';
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { bindExecutableWorkload } from '../config/application-workload';
import { PostgresModule } from '../database/postgres.module';
import { installFatalProcessBoundary, LOG_EVENTS, structuredLogger } from '../logging';
import { OutboxTransportModule } from './outbox-transport.module';
import { assertOutboxWorkerHealthy, OutboxWorkerHealthService } from './outbox-worker-health';

@Module({
  imports: [PostgresModule, OutboxTransportModule],
  providers: [OutboxWorkerHealthService],
})
class OutboxWorkerHealthApplicationModule {}

async function main(): Promise<void> {
  bindExecutableWorkload(process.env, 'worker');
  installFatalProcessBoundary(structuredLogger);
  const application = await NestFactory.createApplicationContext(
    OutboxWorkerHealthApplicationModule,
    { logger: false },
  );
  try {
    await assertOutboxWorkerHealthy(application.get(OutboxWorkerHealthService));
  } finally {
    await application.close();
  }
}

void main().catch(() => {
  structuredLogger.emit(LOG_EVENTS.workerHealthFailed, 'fatal', {
    outcome: 'failure',
    errorCode: 'OUTBOX_WORKER_HEALTH_FAILED',
  });
  process.exitCode = 1;
});
