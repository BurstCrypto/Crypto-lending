import type { DatabaseMigration } from './migrations';
import { DATABASE_MIGRATION_LIST } from './migrations';
import { RAILWAY_DATABASE_MIGRATION_LIST } from './railway-migrations';
import { isRailwayDeployment } from '../config/infrastructure.config';

export function databaseMigrationsForDeployment(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
  defaultMigrations: readonly DatabaseMigration[] = DATABASE_MIGRATION_LIST,
): readonly DatabaseMigration[] {
  return isRailwayDeployment(environment) ? RAILWAY_DATABASE_MIGRATION_LIST : defaultMigrations;
}
