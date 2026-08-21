import 'dotenv/config';
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { bindExecutableWorkload } from '../config/application-workload';
import { PostgresModule } from '../database/postgres.module';
import { SqsModule } from '../sqs/sqs.module';
import { assertOutboxWorkerHealthy, OutboxWorkerHealthService } from './outbox-worker-health';

@Module({ imports: [PostgresModule, SqsModule], providers: [OutboxWorkerHealthService] })
class OutboxWorkerHealthApplicationModule {}

async function main(): Promise<void> {
  bindExecutableWorkload(process.env, 'worker');
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

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Outbox worker health check failed: ${message}\n`);
  process.exitCode = 1;
});
