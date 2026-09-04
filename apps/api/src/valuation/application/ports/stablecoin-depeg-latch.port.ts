import type {
  StablecoinRecoveryRequest,
  StablecoinValuationAssetReference,
  StablecoinValuationRequest,
} from '../../domain/stablecoin-valuation-policy';

export type StablecoinDepegLatchStatus = 'LATCHED' | 'CLEARED';

/**
 * A deliberately non-financial, single-use operational capability. Until an
 * approved issuer and verifier exist, the database clear function has no
 * runtime EXECUTE grant and this type is only structural evidence.
 */
export interface StablecoinDepegRecoveryAuthorization {
  readonly schemaVersion: 1;
  readonly authorizationType: 'STABLECOIN_DEPEG_LATCH_RECOVERY';
  readonly scope: 'DEPEG_LATCH_CLEAR_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly operation: 'CLEAR_STABLECOIN_DEPEG_LATCH';
  readonly asset: StablecoinValuationAssetReference;
  readonly expectedLatchId: string;
  readonly expectedRevision: number;
  readonly clearId: string;
  readonly recoveryEvidenceFingerprintSha256: string;
  readonly evidenceActorReferenceId: string;
  readonly riskApproverReferenceId: string;
  readonly riskApproverRole: 'RISK_APPROVER';
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly authorizationFingerprintSha256: string;
  readonly authorizationId: string;
}

export interface StablecoinDepegLatch {
  readonly schemaVersion: 1;
  readonly asset: StablecoinValuationAssetReference;
  readonly revision: number;
  readonly status: StablecoinDepegLatchStatus;
  readonly latchId: string;
  readonly latchedAt: string;
  readonly depegEvidenceFingerprintSha256: string;
  readonly evidenceActorReferenceId: string;
  readonly clearId: string | null;
  readonly clearedAt: string | null;
  readonly riskApproverReferenceId: string | null;
  readonly lastEventId: string;
  readonly lastEventFingerprintSha256: string;
  readonly updatedAt: string;
}

export interface RecordStablecoinDepegLatchRequest {
  readonly expectedRevision: number | null;
  readonly correlationId: string;
  readonly latchId: string;
  readonly evidenceActorReferenceId: string;
  readonly depegEvidenceFingerprintSha256: string;
  readonly valuationRequest: StablecoinValuationRequest;
}

export type RecordStablecoinDepegLatchOutcome =
  'LATCHED' | 'RELATCHED' | 'IDEMPOTENT_REPLAY' | 'ALREADY_LATCHED' | 'REVISION_CONFLICT';

export interface RecordStablecoinDepegLatchResult {
  readonly outcome: RecordStablecoinDepegLatchOutcome;
  readonly latch: StablecoinDepegLatch | null;
}

export interface ClearStablecoinDepegLatchRequest {
  /** Trusted server timestamp; the database independently rechecks its clock. */
  readonly evaluatedAt: string;
  readonly correlationId: string;
  readonly recoveryRequest: StablecoinRecoveryRequest;
  readonly authorization: StablecoinDepegRecoveryAuthorization;
}

export type ClearStablecoinDepegLatchOutcome =
  | 'CLEARED'
  | 'IDEMPOTENT_REPLAY'
  | 'LATCH_NOT_FOUND'
  | 'LATCH_STATUS_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'LATCH_BINDING_MISMATCH'
  | 'AUTHORIZATION_EXPIRED';

export interface ClearStablecoinDepegLatchResult {
  readonly outcome: ClearStablecoinDepegLatchOutcome;
  readonly latch: StablecoinDepegLatch | null;
}

export interface StablecoinDepegLatchRepository {
  loadCurrent(asset: StablecoinValuationAssetReference): Promise<StablecoinDepegLatch | null>;
  record(request: RecordStablecoinDepegLatchRequest): Promise<RecordStablecoinDepegLatchResult>;
  clear(request: ClearStablecoinDepegLatchRequest): Promise<ClearStablecoinDepegLatchResult>;
}
