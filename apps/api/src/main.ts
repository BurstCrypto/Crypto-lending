import 'reflect-metadata';
import 'dotenv/config';

import type { Server } from 'node:http';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApplication } from './application';
import { bindExecutableWorkload } from './infrastructure/config/application-workload';
import { applyHttpServerLimits, loadHttpServerOptions } from './server-options';

async function bootstrap(): Promise<void> {
  bindExecutableWorkload(process.env, 'api');
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  app.enableShutdownHooks();

  const options = loadHttpServerOptions();
  const server = app.getHttpServer() as Server;
  applyHttpServerLimits(server, options);

  await app.listen(options.port, options.host);
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`API startup failed: ${message}\n`);
  process.exitCode = 1;
});
