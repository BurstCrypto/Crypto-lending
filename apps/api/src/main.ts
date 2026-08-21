import 'reflect-metadata';
import './infrastructure/config/load-dotenv';

import type { Server } from 'node:http';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApplication } from './application';
import { bindExecutableWorkload } from './infrastructure/config/application-workload';
import { LOG_EVENTS, structuredLogger } from './infrastructure/logging';
import { applyHttpServerLimits, loadHttpServerOptions } from './server-options';

async function bootstrap(): Promise<void> {
  bindExecutableWorkload(process.env, 'api');
  const app = await NestFactory.create(AppModule, { logger: structuredLogger });
  configureApplication(app);
  app.enableShutdownHooks();

  const options = loadHttpServerOptions();
  const server = app.getHttpServer() as Server;
  applyHttpServerLimits(server, options);

  await app.listen(options.port, options.host);
  structuredLogger.emit(LOG_EVENTS.applicationStarted, 'info', { outcome: 'success' });
}

void bootstrap().catch((error: unknown) => {
  structuredLogger.emitFatal(LOG_EVENTS.applicationStartFailed, error, { outcome: 'failure' });
  process.exitCode = 1;
});
