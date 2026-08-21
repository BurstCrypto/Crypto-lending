import { createJobOutboxMigration } from './0001-create-job-outbox.migration';
import { addJobOutboxPublishedRetentionIndexMigration } from './0002-add-job-outbox-published-retention-index.migration';
import { addJobOutboxFailedRetentionIndexMigration } from './0003-add-job-outbox-failed-retention-index.migration';
import { createAccountsAndProfilesMigration } from './0004-create-accounts-and-profiles.migration';
import { enforceDatabasePrincipalBoundariesMigration } from './0005-enforce-database-principal-boundaries.migration';
import { constrainJobOutboxLastErrorMigration } from './0006-constrain-job-outbox-last-error.migration';
import type { DatabaseMigration } from './migration';

export const DATABASE_SCHEMA_MIGRATION_LIST: readonly DatabaseMigration[] = Object.freeze([
  createJobOutboxMigration,
  addJobOutboxPublishedRetentionIndexMigration,
  addJobOutboxFailedRetentionIndexMigration,
  createAccountsAndProfilesMigration,
  constrainJobOutboxLastErrorMigration,
]);

export const DATABASE_MIGRATION_LIST: readonly DatabaseMigration[] = Object.freeze([
  createJobOutboxMigration,
  addJobOutboxPublishedRetentionIndexMigration,
  addJobOutboxFailedRetentionIndexMigration,
  createAccountsAndProfilesMigration,
  enforceDatabasePrincipalBoundariesMigration,
  constrainJobOutboxLastErrorMigration,
]);

export type { DatabaseMigration } from './migration';
export {
  createDatabasePrincipalBoundaryMigration,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
export type { DatabasePrincipalNames } from './0005-enforce-database-principal-boundaries.migration';
