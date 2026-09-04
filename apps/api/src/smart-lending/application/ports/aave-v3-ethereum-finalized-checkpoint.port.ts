import type {
  AaveV3EthereumDeploymentEvidence,
  AaveV3EthereumFinalizedBlockEvidence,
  AaveV3EthereumObservedRuntimeCodeHashes,
  AaveV3EthereumReserveTokenEvidence,
} from './aave-v3-ethereum-deployment-evidence-reader.port';

export const AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_REPOSITORY = Symbol(
  'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_REPOSITORY',
);

export type AaveV3EthereumFinalizedCheckpointQuarantineReason =
  | 'FINALIZED_HEIGHT_REGRESSION'
  | 'FINALIZED_BLOCK_DIVERGENCE'
  | 'FINALIZED_PARENT_MISMATCH'
  | 'FINALIZED_TIMESTAMP_REGRESSION'
  | 'SAME_BLOCK_EVIDENCE_DIVERGENCE';

export type AaveV3EthereumFinalizedCheckpointRecordOutcome =
  | 'CREATED'
  | 'ADVANCED'
  | 'REOBSERVED'
  | 'CONTINUITY_REQUIRED'
  | 'QUARANTINED'
  | 'ALREADY_QUARANTINED'
  | 'OBSERVATION_TIME_REGRESSION'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENT_REPLAY';

export interface AaveV3EthereumFinalizedCheckpoint {
  readonly schemaVersion: 1;
  readonly deploymentId: 'AAVE_V3_ETHEREUM';
  readonly networkId: 'eip155:1';
  readonly sourceReferenceId: string;
  readonly deploymentManifestFingerprintSha256: string;
  readonly assetRegistryFingerprintSha256: string;
  readonly readPlanFingerprintSha256: string;
  readonly revision: number;
  readonly status: 'ACTIVE' | 'QUARANTINED';
  readonly finalizedBlock: Readonly<{
    number: bigint;
    hash: `0x${string}`;
    parentHash: `0x${string}`;
    stateRoot: `0x${string}`;
    timestamp: string;
  }>;
  readonly sourceObservationId: string;
  readonly evidenceFingerprintSha256: string;
  readonly contentFingerprintSha256: string;
  readonly observedAt: string;
  readonly finalizedAdvancedAt: string;
  readonly lastValidatedAt: string;
  readonly quarantineReason: AaveV3EthereumFinalizedCheckpointQuarantineReason | null;
  readonly quarantinedAt: string | null;
}

export interface RecordAaveV3EthereumFinalizedCheckpointRequest {
  readonly expectedRevision: number | null;
  readonly correlationId: string;
  readonly evidence: AaveV3EthereumDeploymentEvidence;
}

export interface RecordAaveV3EthereumFinalizedCheckpointResult {
  readonly outcome: AaveV3EthereumFinalizedCheckpointRecordOutcome;
  readonly checkpoint: AaveV3EthereumFinalizedCheckpoint | null;
}

export interface AaveV3EthereumHistoricalDeploymentObservation {
  readonly schemaVersion: 1;
  readonly sourceId: 'AAVE_V3_ETHEREUM_HISTORICAL_FINALIZED_LINEAGE_RPC';
  readonly use: 'CHECKPOINT_LINEAGE_REPAIR_ONLY';
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly deploymentId: 'AAVE_V3_ETHEREUM';
  readonly networkId: 'eip155:1';
  readonly chainId: '0x1';
  readonly finalizedAnchorSelector: 'finalized';
  readonly historicalBlockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL';
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly deploymentManifestFingerprintSha256: string;
  readonly assetRegistryFingerprintSha256: string;
  readonly historicalReadPlanFingerprintSha256: string;
  readonly observedAt: string;
  readonly finalizedAnchor: AaveV3EthereumFinalizedBlockEvidence;
  readonly historicalBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly runtimeCodeKeccak256: AaveV3EthereumObservedRuntimeCodeHashes;
  readonly reserves: Readonly<{
    USDC: AaveV3EthereumReserveTokenEvidence;
    USDT: AaveV3EthereumReserveTokenEvidence;
  }>;
  readonly evidenceFingerprintSha256: string;
  readonly evidenceId: string;
}

/**
 * Two source-specific, full deployment observations of one historical block.
 * Equality is verified over the complete header, runtime-code set, and reserve
 * topology; the source-pair authorization separately attests independence.
 */
export interface AaveV3EthereumHistoricalDeploymentAgreement {
  readonly primary: AaveV3EthereumHistoricalDeploymentObservation;
  readonly corroborating: AaveV3EthereumHistoricalDeploymentObservation;
}

/**
 * A single-use operational capability. Its scope is only to repair the bound
 * checkpoint lineage; it never grants recommendation or financial authority.
 */
export interface AaveV3EthereumCheckpointRecoveryAuthorization {
  readonly schemaVersion: 1;
  readonly authorizationType: 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_LINEAGE_REPAIR';
  readonly scope: 'CHECKPOINT_LINEAGE_REPAIR_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly operation: 'CONTINUITY_BACKFILL' | 'QUARANTINE_RECOVERY';
  readonly deploymentId: 'AAVE_V3_ETHEREUM';
  readonly networkId: 'eip155:1';
  readonly sourceReferenceId: string;
  readonly corroboratingSourceReferenceId: string;
  readonly authorizedByReferenceId: string;
  readonly sourcePairIndependenceApprovalId: string;
  readonly expectedRevision: number;
  readonly expectedStatus: 'ACTIVE' | 'QUARANTINED';
  readonly expectedQuarantineReason: AaveV3EthereumFinalizedCheckpointQuarantineReason | null;
  readonly expectedQuarantinedAt: string | null;
  readonly expectedLastValidatedAt: string;
  readonly expectedLastGoodBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly expectedLastGoodContentFingerprintSha256: string;
  readonly recoverThroughBlock: Readonly<{
    number: bigint;
    hash: `0x${string}`;
  }>;
  readonly reasonCode:
    | 'BACKFILL_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE'
    | 'RESTORE_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE';
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly authorizationFingerprintSha256: string;
  readonly authorizationId: string;
}

export interface RecoverAaveV3EthereumFinalizedCheckpointRequest {
  /** Trusted server timestamp used to revalidate the short-lived authorization. */
  readonly evaluatedAt: string;
  readonly recoveryId: string;
  readonly authorization: AaveV3EthereumCheckpointRecoveryAuthorization;
  readonly lineage: readonly AaveV3EthereumHistoricalDeploymentAgreement[];
}

export type AaveV3EthereumFinalizedCheckpointRecoveryOutcome =
  | 'BACKFILLED'
  | 'RECOVERED'
  | 'IDEMPOTENT_REPLAY'
  | 'CHECKPOINT_NOT_FOUND'
  | 'CHECKPOINT_STATUS_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'HEAD_BINDING_MISMATCH'
  | 'AUTHORIZATION_EXPIRED';

export interface RecoverAaveV3EthereumFinalizedCheckpointResult {
  readonly outcome: AaveV3EthereumFinalizedCheckpointRecoveryOutcome;
  readonly checkpoint: AaveV3EthereumFinalizedCheckpoint | null;
}

export interface AaveV3EthereumFinalizedCheckpointRepository {
  loadCurrent(sourceReferenceId: string): Promise<AaveV3EthereumFinalizedCheckpoint | null>;
  record(
    request: RecordAaveV3EthereumFinalizedCheckpointRequest,
  ): Promise<RecordAaveV3EthereumFinalizedCheckpointResult>;
  recover(
    request: RecoverAaveV3EthereumFinalizedCheckpointRequest,
  ): Promise<RecoverAaveV3EthereumFinalizedCheckpointResult>;
  backfill(
    request: RecoverAaveV3EthereumFinalizedCheckpointRequest,
  ): Promise<RecoverAaveV3EthereumFinalizedCheckpointResult>;
}
