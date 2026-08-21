import 'dotenv/config';
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { bindExecutableWorkload } from '../config/application-workload';
import { OutboxModule } from './outbox.module';
import { OutboxWorker } from './outbox-worker.service';

@Module({ imports: [OutboxModule] })
class OutboxWorkerApplicationModule {}

async function main(): Promise<void> {
  bindExecutableWorkload(process.env, 'worker');
  const application = await NestFactory.createApplicationContext(OutboxWorkerApplicationModule);
  const worker = application.get(OutboxWorker);
  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    const pollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? '1000');
    await worker.run(abortController.signal, pollIntervalMs);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await application.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Outbox worker failed: ${message}\n`);
  process.exitCode = 1;
});
