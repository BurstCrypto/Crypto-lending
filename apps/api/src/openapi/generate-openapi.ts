import 'reflect-metadata';
import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { configureApplication } from '../application';
import { serializeDeterministically } from './stable-json';

async function generateOpenApi(): Promise<void> {
  // Contract generation constructs infrastructure providers but never connects.
  // Local-only defaults keep this command hermetic when CI has no service env.
  process.env.DATABASE_URL ??= 'postgres://openapi:openapi@127.0.0.1:5432/openapi';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
  process.env.REDIS_KEY_PREFIX ??= 'crypto-lending:openapi:v1:';
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
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`OpenAPI generation failed: ${message}`);
  process.exitCode = 1;
});
