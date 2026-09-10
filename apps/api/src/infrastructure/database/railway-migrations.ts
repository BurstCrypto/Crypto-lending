import {
  DATABASE_OWNER_COMPATIBLE_MIGRATION_LIST,
  type DatabaseMigration,
} from './migrations';
import { enforceRailwayDatabasePrincipalBoundariesMigration } from './migrations/9000-enforce-railway-database-principal-boundaries.migration';
import { createRailwayJobQueueMigration } from './migrations/9001-create-railway-job-queue.migration';

/**
 * Railway's managed PostgreSQL service exposes one owner credential instead of
 * AWS Secrets Manager-backed rotating login roles. Reuse the owner-compatible
 * DDL, then add target-specific runtime grants and the durable queue without
 * changing the separately reviewed AWS migration index.
 */
export const RAILWAY_DATABASE_MIGRATION_LIST: readonly DatabaseMigration[] = Object.freeze([
  ...DATABASE_OWNER_COMPATIBLE_MIGRATION_LIST,
  enforceRailwayDatabasePrincipalBoundariesMigration,
  createRailwayJobQueueMigration,
]);
