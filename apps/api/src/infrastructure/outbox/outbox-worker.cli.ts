import '../config/load-dotenv';
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { bindExecutableWorkload } from '../config/application-workload';
import { installFatalProcessBoundary, LOG_EVENTS, structuredLogger } from '../logging';
import { OutboxModule } from './outbox.module';
import { OutboxWorker, validateOutboxPollIntervalMs } from './outbox-worker.service';

@Module({ imports: [OutboxModule] })
class OutboxWorkerApplicationModule {}

async function main(): Promise<void> {
  bindExecutableWorkload(process.env, 'worker');
  installFatalProcessBoundary(structuredLogger);
  const pollIntervalMs = validateOutboxPollIntervalMs(
    Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? '1000'),
  );
  const application = await NestFactory.createApplicationContext(OutboxWorkerApplicationModule, {
    bufferLogs: true,
  });
  application.useLogger(structuredLogger);
  const worker = application.get(OutboxWorker);
  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let ranNormally = false;

  try {
    structuredLogger.emit(LOG_EVENTS.workerStarted, 'info', { outcome: 'success' });
    await worker.run(abortController.signal, pollIntervalMs);
    ranNormally = true;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await application.close();
    if (ranNormally) {
      structuredLogger.emit(LOG_EVENTS.workerStopped, 'info', { outcome: 'success' });
    }
  }
}

void main().catch(() => {
  structuredLogger.emit(LOG_EVENTS.workerStartFailed, 'fatal', {
    outcome: 'failure',
    errorCode: 'OUTBOX_WORKER_FATAL',
  });
  process.exitCode = 1;
});
