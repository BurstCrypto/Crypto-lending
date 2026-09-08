import type {
  DormantMainnetSignedSubmissionCapabilityV1,
  VerifyDormantMainnetSignedSubmissionRequestV1,
} from './dormant-mainnet-financial-action-signed-submission-verifier.port';
import type {
  DormantMainnetFinancialActionClmaDatabaseCursorV1,
  DormantMainnetFinancialActionDurableResultV1,
} from './dormant-mainnet-financial-action-lifecycle-durable.port';

export const DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION = 1 as const;
export const DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_REQUEST_USE =
  'DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_REQUEST_ONLY' as const;
export const DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE =
  'DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_OPAQUE_CAPABILITY_ONLY' as const;

/**
 * Exact, immutable composition request. The caller supplies verifier provenance,
 * never individual transaction, signer, digest, nonce/blockhash, or time fields.
 */
export interface BindDormantMainnetVerifiedSubmissionRequestV1 {
  readonly verifiedSubmissionBinderVersion: typeof DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION;
  readonly use: typeof DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_REQUEST_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
  readonly verificationRequest: VerifyDormantMainnetSignedSubmissionRequestV1;
  readonly verificationCapability: DormantMainnetSignedSubmissionCapabilityV1;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

/**
 * Publicly inert handle. The issuing binder must authenticate and consume the
 * exact object, request, signal, and adapter instance before revealing a result.
 */
export interface DormantMainnetVerifiedSubmissionBindCapabilityV1 {
  readonly verifiedSubmissionBinderVersion: typeof DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION;
  readonly use: typeof DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly apiMaySign: false;
  readonly apiMayBroadcast: false;
  readonly mayResendTransaction: false;
  readonly automaticRetryAllowed: false;
}

/**
 * Dormant, direct-import-only persistence boundary. It owns no signer,
 * broadcaster, retry loop, RPC client, or settlement authority.
 */
export interface DormantMainnetFinancialActionVerifiedSubmissionBinderPort {
  readonly verifiedSubmissionBinderVersion: typeof DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION;
  bindVerifiedSubmission(request: BindDormantMainnetVerifiedSubmissionRequestV1): Promise<unknown>;
  reviewVerifiedSubmissionBindResult(
    capability: unknown,
    request: BindDormantMainnetVerifiedSubmissionRequestV1,
  ): DormantMainnetFinancialActionDurableResultV1 | null;
}
