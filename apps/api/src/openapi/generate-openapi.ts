import 'reflect-metadata';
import '../infrastructure/config/load-dotenv';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { configureApplication } from '../application';
import { LOG_EVENTS, structuredLogger } from '../infrastructure/logging';
import { serializeDeterministically } from './stable-json';

async function generateOpenApi(): Promise<void> {
  // Contract generation constructs infrastructure providers but never connects.
  // Local-only defaults keep this command hermetic when CI has no service env.
  if (
    !process.env.DATABASE_RUNTIME_URL &&
    !process.env.DATABASE_RUNTIME_HOST &&
    !process.env.DATABASE_URL &&
    !process.env.DATABASE_HOST
  ) {
    process.env.DATABASE_RUNTIME_URL = 'postgres://openapi:openapi@127.0.0.1:5432/openapi';
    process.env.DATABASE_RUNTIME_SSL_MODE = 'disable';
  }
  if (
    !process.env.REDIS_URL &&
    !process.env.REDIS_HOST &&
    !process.env.REDIS_PORT &&
    !process.env.REDIS_USERNAME &&
    !process.env.REDIS_PASSWORD
  ) {
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_TLS = 'false';
    process.env.REDIS_USERNAME = 'crypto_api_a';
    process.env.REDIS_PASSWORD = 'local-api-current';
  }
  process.env.SQS_QUEUE_URL ??= 'http://127.0.0.1:4566/000000000000/openapi-jobs';
  process.env.SQS_DEAD_LETTER_QUEUE_URL ??= 'http://127.0.0.1:4566/000000000000/openapi-jobs-dlq';

  const outputPath = resolve(process.cwd(), process.argv[2] ?? 'openapi.json');
  const app = await NestFactory.create(AppModule, { logger: false });

  try {
    const document = configureApplication(app);
    await app.init();
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serializeDeterministically(document), 'utf8');
  } finally {
    await app.close();
  }
}

void generateOpenApi().catch((error: unknown) => {
  structuredLogger.emitFatal(LOG_EVENTS.openApiFailed, error, { outcome: 'failure' });
  process.exitCode = 1;
});
