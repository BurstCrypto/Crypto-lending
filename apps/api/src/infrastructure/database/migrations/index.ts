import { createJobOutboxMigration } from './0001-create-job-outbox.migration';
import type { DatabaseMigration } from './migration';

export const DATABASE_MIGRATION_LIST: readonly DatabaseMigration[] = Object.freeze([
  createJobOutboxMigration,
]);

export type { DatabaseMigration } from './migration';
