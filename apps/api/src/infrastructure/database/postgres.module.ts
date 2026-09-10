import { Module } from '@nestjs/common';

import {
  INFRASTRUCTURE_CONFIG,
  InfrastructureConfigModule,
} from '../config/infrastructure-config.module';
import { MigrationRunner } from './migration-runner.service';
import { databaseMigrationsForDeployment } from './deployment-migrations';
import { DATABASE_MIGRATION_LIST } from './migrations';
import { PostgresService } from './postgres.service';
import { DATABASE_MIGRATIONS, POSTGRES_POOL } from './postgres.tokens';
import { createPostgresPool } from './runtime-postgres-pool';

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
      useFactory: () => databaseMigrationsForDeployment(process.env, DATABASE_MIGRATION_LIST),
    },
    PostgresService,
    MigrationRunner,
  ],
  exports: [PostgresService, MigrationRunner],
})
export class PostgresModule {}
