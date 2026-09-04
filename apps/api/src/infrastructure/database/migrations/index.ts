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
import {
  createActiveWalletRegistrationListMigrationV0014,
  createActiveWalletRegistrationListTestSchemaMigrationV0014,
} from './0014-list-active-wallet-registrations.migration';
import {
  createMainnetWalletLaunchNarrowingMigrationV0015,
  createMainnetWalletLaunchNarrowingTestSchemaMigrationV0015,
} from './0015-narrow-mainnet-wallet-launch.migration';
import {
  createWalletRegistrationRevocationMigrationV0016,
  createWalletRegistrationRevocationTestSchemaMigrationV0016,
} from './0016-revoke-wallet-registration.migration';
import {
  createAaveV3EthereumFinalizedCheckpointMigrationV0017,
  createAaveV3EthereumFinalizedCheckpointTestSchemaMigrationV0017,
} from './0017-create-aave-finalized-checkpoints.migration';
import {
  enforceReviewedJobOutboxAdmissionMigrationV0018,
  enforceReviewedJobOutboxAdmissionTestSchemaMigrationV0018,
} from './0018-enforce-reviewed-job-outbox-admission.migration';
import {
  createStablecoinDepegLatchMigrationV0019,
  createStablecoinDepegLatchTestSchemaMigrationV0019,
} from './0019-create-stablecoin-depeg-latches.migration';
import {
  createBalanceSyncReadModelMigrationV0020,
  createBalanceSyncReadModelTestSchemaMigrationV0020,
} from './0020-create-balance-sync-read-model.migration';
import {
  createStablecoinPriceEvidenceReadModelMigrationV0021,
  createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021,
} from './0021-create-stablecoin-price-evidence-read-model.migration';
import {
  createWalletKeyRotationBoundaryMigrationV0022,
  createWalletKeyRotationBoundaryTestSchemaMigrationV0022,
} from './0022-create-wallet-key-rotation-boundary.migration';
import {
  createBalanceConsumerWalletAddressBoundaryMigrationV0023,
  createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023,
} from './0023-create-balance-consumer-wallet-address-boundary.migration';
import {
  createWalletMetadataRewrapBoundaryMigrationV0024,
  createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024,
} from './0024-create-wallet-metadata-rewrap-boundary.migration';
import {
  createAuthenticationHmacKeyRotationMigrationV0025,
  createAuthenticationHmacKeyRotationTestSchemaMigrationV0025,
} from './0025-create-authentication-hmac-key-rotation.migration';
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
  createActiveWalletRegistrationListTestSchemaMigrationV0014,
  createMainnetWalletLaunchNarrowingTestSchemaMigrationV0015,
  createWalletRegistrationRevocationTestSchemaMigrationV0016,
  createAaveV3EthereumFinalizedCheckpointTestSchemaMigrationV0017,
  enforceReviewedJobOutboxAdmissionTestSchemaMigrationV0018,
  createStablecoinDepegLatchTestSchemaMigrationV0019,
  createBalanceSyncReadModelTestSchemaMigrationV0020,
  createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021,
  createWalletKeyRotationBoundaryTestSchemaMigrationV0022,
  createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023,
  createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024,
  createAuthenticationHmacKeyRotationTestSchemaMigrationV0025,
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
  createActiveWalletRegistrationListMigrationV0014,
  createMainnetWalletLaunchNarrowingMigrationV0015,
  createWalletRegistrationRevocationMigrationV0016,
  createAaveV3EthereumFinalizedCheckpointMigrationV0017,
  enforceReviewedJobOutboxAdmissionMigrationV0018,
  createStablecoinDepegLatchMigrationV0019,
  createBalanceSyncReadModelMigrationV0020,
  createStablecoinPriceEvidenceReadModelMigrationV0021,
  createWalletKeyRotationBoundaryMigrationV0022,
  createBalanceConsumerWalletAddressBoundaryMigrationV0023,
  createWalletMetadataRewrapBoundaryMigrationV0024,
  createAuthenticationHmacKeyRotationMigrationV0025,
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
export {
  createActiveWalletRegistrationListMigration,
  createActiveWalletRegistrationListMigrationV0014,
  createActiveWalletRegistrationListTestSchemaMigrationV0014,
} from './0014-list-active-wallet-registrations.migration';
export {
  createMainnetWalletLaunchNarrowingMigration,
  createMainnetWalletLaunchNarrowingMigrationV0015,
  createMainnetWalletLaunchNarrowingTestSchemaMigrationV0015,
} from './0015-narrow-mainnet-wallet-launch.migration';
export {
  createWalletRegistrationRevocationMigration,
  createWalletRegistrationRevocationMigrationV0016,
  createWalletRegistrationRevocationTestSchemaMigrationV0016,
} from './0016-revoke-wallet-registration.migration';
export {
  createAaveV3EthereumFinalizedCheckpointMigration,
  createAaveV3EthereumFinalizedCheckpointMigrationV0017,
  createAaveV3EthereumFinalizedCheckpointTestSchemaMigrationV0017,
} from './0017-create-aave-finalized-checkpoints.migration';
export {
  createReviewedJobOutboxAdmissionMigration,
  enforceReviewedJobOutboxAdmissionMigrationV0018,
  enforceReviewedJobOutboxAdmissionTestSchemaMigrationV0018,
} from './0018-enforce-reviewed-job-outbox-admission.migration';
export {
  createStablecoinDepegLatchMigration,
  createStablecoinDepegLatchMigrationV0019,
  createStablecoinDepegLatchTestSchemaMigrationV0019,
} from './0019-create-stablecoin-depeg-latches.migration';
export {
  createBalanceSyncReadModelMigration,
  createBalanceSyncReadModelMigrationV0020,
  createBalanceSyncReadModelTestSchemaMigrationV0020,
} from './0020-create-balance-sync-read-model.migration';
export {
  createStablecoinPriceEvidenceReadModelMigration,
  createStablecoinPriceEvidenceReadModelMigrationV0021,
  createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021,
} from './0021-create-stablecoin-price-evidence-read-model.migration';
export {
  createWalletKeyRotationBoundaryMigration,
  createWalletKeyRotationBoundaryMigrationV0022,
  createWalletKeyRotationBoundaryTestSchemaMigrationV0022,
} from './0022-create-wallet-key-rotation-boundary.migration';
export {
  createBalanceConsumerWalletAddressBoundaryMigration,
  createBalanceConsumerWalletAddressBoundaryMigrationV0023,
  createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023,
} from './0023-create-balance-consumer-wallet-address-boundary.migration';
export {
  createWalletMetadataRewrapBoundaryMigration,
  createWalletMetadataRewrapBoundaryMigrationV0024,
  createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024,
} from './0024-create-wallet-metadata-rewrap-boundary.migration';
export {
  createAuthenticationHmacKeyRotationMigration,
  createAuthenticationHmacKeyRotationMigrationV0025,
  createAuthenticationHmacKeyRotationTestSchemaMigrationV0025,
} from './0025-create-authentication-hmac-key-rotation.migration';
