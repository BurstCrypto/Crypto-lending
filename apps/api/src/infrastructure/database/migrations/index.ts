import { createJobOutboxMigration } from './0001-create-job-outbox.migration';
import { addJobOutboxPublishedRetentionIndexMigration } from './0002-add-job-outbox-published-retention-index.migration';
import { addJobOutboxFailedRetentionIndexMigration } from './0003-add-job-outbox-failed-retention-index.migration';
import { createAccountsAndProfilesMigration } from './0004-create-accounts-and-profiles.migration';
import { enforceDatabasePrincipalBoundariesMigration } from './0005-enforce-database-principal-boundaries.migration';
import { constrainJobOutboxLastErrorMigration } from './0006-constrain-job-outbox-last-error.migration';
import {
  createImmutableLedgerMigrationV0007,
  createImmutableLedgerTestSchemaMigrationV0007,
} from './0007-create-immutable-ledger.migration';
import {
  createLedgerLifecycleMigrationV0008,
  createLedgerLifecycleTestSchemaMigrationV0008,
} from './0008-create-ledger-lifecycle.migration';
import {
  createLedgerCommandIdempotencyMigrationV0009,
  createLedgerCommandIdempotencyTestSchemaMigrationV0009,
} from './0009-create-ledger-command-idempotency.migration';
import {
  createAuthenticationSessionsMigrationV0010,
  createAuthenticationSessionsTestSchemaMigrationV0010,
} from './0010-create-authentication-sessions.migration';
import {
  createWalletOwnershipRegistrationMigrationV0011,
  createWalletOwnershipRegistrationTestSchemaMigrationV0011,
} from './0011-create-wallet-ownership-registration.migration';
import {
  createYieldOperationControlsMigrationV0012,
  createYieldOperationControlsTestSchemaMigrationV0012,
} from './0012-create-yield-operation-controls.migration';
import {
  createLedgerFeeAdjustmentIntegrityMigrationV0013,
  createLedgerFeeAdjustmentIntegrityTestSchemaMigrationV0013,
} from './0013-repair-ledger-fee-adjustment-integrity.migration';
import type { DatabaseMigration } from './migration';

/**
 * NEVER FOR DEPLOYMENT. This owner-privileged fixture intentionally omits the
 * production principal-boundary migration so isolated database tests can
 * create disposable schemas. Production modules and CLIs must inject only
 * DATABASE_MIGRATION_LIST.
 */
export const DATABASE_TEST_SCHEMA_MIGRATION_LIST: readonly DatabaseMigration[] = Object.freeze([
  createJobOutboxMigration,
  addJobOutboxPublishedRetentionIndexMigration,
  addJobOutboxFailedRetentionIndexMigration,
  createAccountsAndProfilesMigration,
  constrainJobOutboxLastErrorMigration,
  createImmutableLedgerTestSchemaMigrationV0007,
  createLedgerLifecycleTestSchemaMigrationV0008,
  createLedgerCommandIdempotencyTestSchemaMigrationV0009,
  createAuthenticationSessionsTestSchemaMigrationV0010,
  createWalletOwnershipRegistrationTestSchemaMigrationV0011,
  createYieldOperationControlsTestSchemaMigrationV0012,
  createLedgerFeeAdjustmentIntegrityTestSchemaMigrationV0013,
]);

export const DATABASE_MIGRATION_LIST: readonly DatabaseMigration[] = Object.freeze([
  createJobOutboxMigration,
  addJobOutboxPublishedRetentionIndexMigration,
  addJobOutboxFailedRetentionIndexMigration,
  createAccountsAndProfilesMigration,
  enforceDatabasePrincipalBoundariesMigration,
  constrainJobOutboxLastErrorMigration,
  createImmutableLedgerMigrationV0007,
  createLedgerLifecycleMigrationV0008,
  createLedgerCommandIdempotencyMigrationV0009,
  createAuthenticationSessionsMigrationV0010,
  createWalletOwnershipRegistrationMigrationV0011,
  createYieldOperationControlsMigrationV0012,
  createLedgerFeeAdjustmentIntegrityMigrationV0013,
]);

export type { DatabaseMigration } from './migration';
export {
  createDatabasePrincipalBoundaryMigration,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
export type { DatabasePrincipalNames } from './0005-enforce-database-principal-boundaries.migration';
export {
  createImmutableLedgerMigration,
  createImmutableLedgerMigrationV0007,
  createImmutableLedgerTestSchemaMigrationV0007,
} from './0007-create-immutable-ledger.migration';
export {
  createLedgerLifecycleMigration,
  createLedgerLifecycleMigrationV0008,
  createLedgerLifecycleTestSchemaMigrationV0008,
} from './0008-create-ledger-lifecycle.migration';
export {
  createLedgerCommandIdempotencyMigration,
  createLedgerCommandIdempotencyMigrationV0009,
  createLedgerCommandIdempotencyTestSchemaMigrationV0009,
} from './0009-create-ledger-command-idempotency.migration';
export {
  createAuthenticationSessionsMigration,
  createAuthenticationSessionsMigrationV0010,
  createAuthenticationSessionsTestSchemaMigrationV0010,
} from './0010-create-authentication-sessions.migration';
export {
  createWalletOwnershipRegistrationMigration,
  createWalletOwnershipRegistrationMigrationV0011,
  createWalletOwnershipRegistrationTestSchemaMigrationV0011,
} from './0011-create-wallet-ownership-registration.migration';
export {
  createYieldOperationControlsMigration,
  createYieldOperationControlsMigrationV0012,
  createYieldOperationControlsTestSchemaMigrationV0012,
} from './0012-create-yield-operation-controls.migration';
export {
  createLedgerFeeAdjustmentIntegrityMigration,
  createLedgerFeeAdjustmentIntegrityMigrationV0013,
  createLedgerFeeAdjustmentIntegrityTestSchemaMigrationV0013,
} from './0013-repair-ledger-fee-adjustment-integrity.migration';
