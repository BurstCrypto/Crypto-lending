import 'dotenv/config';
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { InfrastructureHealthService } from '../health/infrastructure-health.service';
import { InfrastructureModule } from '../infrastructure.module';
import { assertOutboxWorkerHealthy } from './outbox-worker-health';

@Module({ imports: [InfrastructureModule] })
class OutboxWorkerHealthApplicationModule {}

async function main(): Promise<void> {
  const application = await NestFactory.createApplicationContext(
    OutboxWorkerHealthApplicationModule,
    { logger: false },
  );
  try {
    await assertOutboxWorkerHealthy(application.get(InfrastructureHealthService));
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Outbox worker health check failed: ${message}\n`);
  process.exitCode = 1;
});
