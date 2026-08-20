import { createJobOutboxMigration } from './0001-create-job-outbox.migration';
import { addJobOutboxPublishedRetentionIndexMigration } from './0002-add-job-outbox-published-retention-index.migration';
import { addJobOutboxFailedRetentionIndexMigration } from './0003-add-job-outbox-failed-retention-index.migration';
import type { DatabaseMigration } from './migration';

export const DATABASE_MIGRATION_LIST: readonly DatabaseMigration[] = Object.freeze([
  createJobOutboxMigration,
  addJobOutboxPublishedRetentionIndexMigration,
  addJobOutboxFailedRetentionIndexMigration,
]);

export type { DatabaseMigration } from './migration';
