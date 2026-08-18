import 'reflect-metadata';
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApplication } from './application';
import { DEFAULT_PORT } from './constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  app.enableShutdownHooks();

  const configuredPort = Number(process.env.PORT ?? DEFAULT_PORT);
  const port = Number.isSafeInteger(configuredPort) ? configuredPort : DEFAULT_PORT;

  await app.listen(port);
}

void bootstrap();
