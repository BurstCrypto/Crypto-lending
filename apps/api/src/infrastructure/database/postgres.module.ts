import { Module } from '@nestjs/common';
import { Pool } from 'pg';

import {
  INFRASTRUCTURE_CONFIG,
  InfrastructureConfigModule,
} from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import { MigrationRunner } from './migration-runner.service';
import { DATABASE_MIGRATION_LIST } from './migrations';
import { PostgresService } from './postgres.service';
import { DATABASE_MIGRATIONS, POSTGRES_POOL } from './postgres.tokens';

export function createPostgresPool(config: InfrastructureConfig): Pool {
  return new Pool({
    connectionString: config.database.connectionString,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    idleTimeoutMillis: config.database.idleTimeoutMs,
    max: config.database.poolMax,
    maxLifetimeSeconds: config.database.maxLifetimeSeconds,
    statement_timeout: config.database.statementTimeoutMs,
    application_name: 'crypto-lending-api',
    ssl: config.database.ssl,
  });
}

@Module({
  imports: [InfrastructureConfigModule],
  providers: [
    {
      provide: POSTGRES_POOL,
      inject: [INFRASTRUCTURE_CONFIG],
      useFactory: createPostgresPool,
    },
    {
      provide: DATABASE_MIGRATIONS,
      useValue: DATABASE_MIGRATION_LIST,
    },
    PostgresService,
    MigrationRunner,
  ],
  exports: [PostgresService, MigrationRunner],
})
export class PostgresModule {}
