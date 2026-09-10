import '../config/load-dotenv';
import 'reflect-metadata';

import { createServer, type Server } from 'node:http';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { bindExecutableWorkload } from '../config/application-workload';
import { PostgresModule } from '../database/postgres.module';
import { installFatalProcessBoundary, LOG_EVENTS, structuredLogger } from '../logging';
import { OutboxTransportModule } from './outbox-transport.module';
import { OutboxModule } from './outbox.module';
import { OutboxWorkerHealthService } from './outbox-worker-health';
import { OutboxWorker, validateOutboxPollIntervalMs } from './outbox-worker.service';

@Module({
  imports: [PostgresModule, OutboxTransportModule, OutboxModule],
  providers: [OutboxWorkerHealthService],
})
class OutboxWorkerApplicationModule {}

function workerHealthPort(environment: Readonly<NodeJS.ProcessEnv>): number {
  const value = Number(environment.PORT ?? '3001');
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error('Worker PORT must be an integer between 1 and 65535');
  }
  return value;
}

async function startHealthServer(health: OutboxWorkerHealthService, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/api/v1/internal/health/dependencies') {
      response.writeHead(404, { 'Cache-Control': 'no-store', 'Content-Length': '0' });
      response.end();
      return;
    }
    void health.check().then(
      (result) => {
        const ready = result.status === 'ok';
        const body = JSON.stringify({ status: ready ? 'ok' : 'degraded' });
        response.writeHead(ready ? 200 : 503, {
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(body),
          'Content-Type': 'application/json',
        });
        response.end(body);
      },
      () => {
        response.writeHead(503, { 'Cache-Control': 'no-store', 'Content-Length': '0' });
        response.end();
      },
    );
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

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
  const healthServer = await startHealthServer(
    application.get(OutboxWorkerHealthService),
    workerHealthPort(process.env),
  );
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
    await closeServer(healthServer);
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
