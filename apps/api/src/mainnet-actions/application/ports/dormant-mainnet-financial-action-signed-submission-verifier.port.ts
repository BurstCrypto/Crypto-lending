import type { DormantMainnetFinancialActionIntentV1 } from '../../domain/dormant-mainnet-financial-action';

export const DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION = 1 as const;
export const DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE =
  'DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_ONLY' as const;
export const DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE =
  'DORMANT_MAINNET_SIGNED_SUBMISSION_OPAQUE_CAPABILITY_ONLY' as const;
export const DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE =
  'DORMANT_MAINNET_SIGNED_SUBMISSION_DIGEST_EVIDENCE_ONLY' as const;

export type DormantMainnetSignedTransactionWireV1 =
  | Readonly<{
      readonly networkId: 'eip155:1';
      readonly encoding: 'LOWERCASE_0X_HEX';
      readonly signedTransaction: string;
    }>
  | Readonly<{
      readonly networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
      readonly encoding: 'CANONICAL_BASE64';
      readonly signedTransaction: string;
    }>;

export interface VerifyDormantMainnetSignedSubmissionRequestV1 {
  readonly verifierVersion: typeof DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION;
  readonly use: typeof DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly intentRecordFingerprintSha256: string;
  readonly intent: DormantMainnetFinancialActionIntentV1;
  readonly wire: DormantMainnetSignedTransactionWireV1;
  readonly signal: AbortSignal;
}

/**
 * Publicly inert handle. Possession is not authority: a concrete verifier must
 * authenticate the exact object and exact request through instance-private
 * state before returning digest-only evidence.
 */
export interface DormantMainnetSignedSubmissionCapabilityV1 {
  readonly verifierVersion: typeof DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION;
  readonly use: typeof DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly apiMaySign: false;
  readonly apiMayBroadcast: false;
}

export interface DormantMainnetSignedSubmissionVerificationResultV1 {
  readonly verifierVersion: typeof DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION;
  readonly use: typeof DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly apiMaySign: false;
  readonly apiMayBroadcast: false;
  readonly mayResendTransaction: false;
  readonly automaticRetryAllowed: false;
  readonly dynamicChainStateVerified: false;
  readonly providerDeploymentVerified: false;
  readonly currentNonceOrBlockhashVerified: false;
  readonly walletBalanceVerified: false;
  readonly intentId: string;
  readonly intentRecordFingerprintSha256: string;
  readonly verificationIntentFingerprintSha256: string;
  readonly networkId: DormantMainnetSignedTransactionWireV1['networkId'];
  readonly transactionId: string;
  readonly signerWalletAddress: string;
  readonly signatureScheme: 'ECDSA_SECP256K1_EIP1559' | 'ED25519_SOLANA_TRANSACTION';
  readonly signedEnvelopeSha256: string;
  readonly signingPayloadSha256: string;
  readonly signatureEvidenceSha256: string;
  readonly chainReplayIdentitySha256: string;
  readonly providerWriteManifestFingerprintSha256: string;
  readonly providerActionBindingSha256: string;
  readonly ethereumNonce: string | null;
  readonly solanaRecentBlockhash: string | null;
  readonly staticCommandVerification: 'CRYPTOGRAPHIC_SIGNATURE_AND_EXACT_MANIFEST_MATCH';
}

/**
 * Dormant, direct-import-only, no-I/O boundary. It neither constructs, signs,
 * broadcasts, persists, retries, nor authorizes a financial action.
 */
export interface DormantMainnetFinancialActionSignedSubmissionVerifierPort {
  readonly verifierVersion: typeof DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION;
  verifySubmission(request: VerifyDormantMainnetSignedSubmissionRequestV1): Promise<unknown>;
  reviewResult(
    capability: unknown,
    request: VerifyDormantMainnetSignedSubmissionRequestV1,
  ): DormantMainnetSignedSubmissionVerificationResultV1 | null;
}
