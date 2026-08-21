import { Module } from '@nestjs/common';
import { Pool } from 'pg';

import {
  INFRASTRUCTURE_CONFIG,
  InfrastructureConfigModule,
} from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import { MigrationRunner } from './migration-runner.service';
import { DATABASE_MIGRATION_LIST } from './migrations';
import { postgresStartupOptions } from './postgres-startup-options';
import { PostgresService } from './postgres.service';
import { DATABASE_MIGRATIONS, POSTGRES_POOL } from './postgres.tokens';

export interface RuntimeDatabaseCapabilityRoles {
  api: string;
  worker: string;
}

const PRODUCTION_RUNTIME_DATABASE_ROLES: Readonly<RuntimeDatabaseCapabilityRoles> = Object.freeze({
  api: 'crypto_api_runtime',
  worker: 'crypto_worker_runtime',
});

export function createPostgresPool(
  config: InfrastructureConfig,
  capabilityRoles: Readonly<RuntimeDatabaseCapabilityRoles> = PRODUCTION_RUNTIME_DATABASE_ROLES,
): Pool {
  const expectedSessionRole =
    config.workload === 'api' ? capabilityRoles.api : capabilityRoles.worker;
  if (config.database.sessionRole && config.database.sessionRole !== expectedSessionRole) {
    throw new Error(
      `Database session role ${config.database.sessionRole} does not match ${config.workload} workload`,
    );
  }
  return new Pool({
    connectionString: config.database.connectionString,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    idleTimeoutMillis: config.database.idleTimeoutMs,
    lock_timeout: config.database.lockTimeoutMs,
    max: config.database.poolMax,
    maxLifetimeSeconds: config.database.maxLifetimeSeconds,
    statement_timeout: config.database.statementTimeoutMs,
    application_name: `crypto-lending-${config.workload}`,
    ...(config.database.sessionRole
      ? {
          // libpq startup options are applied before node-postgres exposes the
          // client, so no application query can race ahead of SET ROLE.
          options: postgresStartupOptions(config.database.sessionRole),
        }
      : {}),
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
