import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type { SupportedStablecoin } from '../../../blockchain/domain/supported-asset-registry';
import type { MainnetProviderPositionSourceKind } from '../../../mainnet-platforms/domain/mainnet-provider-position-observation-policy';
import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../../../mainnet-platforms/domain/mainnet-provider-position-chain-assessment';
import type { WalletAddress } from '../../../wallets/domain/wallet-identity';
import type {
  MainnetFinancialAction,
  MainnetFinancialActionProtocolId,
  MainnetFinancialActionProviderId,
} from '../../domain/dormant-mainnet-financial-action';
import type { DormantMainnetReconciliationDatabaseOutcome } from './dormant-mainnet-financial-action-lifecycle-durable.port';

export const MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION = 1 as const;
export const MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_ONLY' as const;

export type MainnetFinancialActionFinalityEvidenceNetworkId = MainnetLaunchNetworkId;

/**
 * Exact read plan produced from authenticated lifecycle and migration-0029
 * capabilities. The public producer caller cannot supply any outcome, chain
 * position, block identity, evidence digest, or authority identifier in this
 * request. Source and deployment authorities come from a privately reviewed
 * durable prerequisite and must exactly match the producer's captured source
 * bindings before this object is issued to an injected source.
 */
interface ReadMainnetFinancialActionFinalityEvidenceSourceRequestCommonV1 {
  readonly sourceVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION;
  readonly use: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly networkId: MainnetFinancialActionFinalityEvidenceNetworkId;
  readonly accountId: string;
  readonly intentId: string;
  readonly intentRecordFingerprintSha256: string;
  readonly walletRegistrationId: string;
  readonly walletAddress: WalletAddress;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly transactionId: string;
  readonly walletSignedPayloadSha256: string;
  readonly walletSignatureEvidenceSha256: string;
  readonly chainAnchorEvidenceFingerprintSha256: string;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly agreedFinalizedHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly sourceAuthorityId: string;
  readonly sourceAuthorityFingerprintSha256: string;
  readonly sourcePairApprovalId: string;
  readonly sourcePairRegistryFingerprintSha256: string;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceRole: 'PRIMARY' | 'CORROBORATING';
  readonly deploymentAuthorityId: string;
  readonly deploymentAuthorityFingerprintSha256: string;
  readonly deploymentManifestFingerprintSha256: string;
  readonly observedDeploymentIdentityFingerprintSha256: string;
  readonly providerId: MainnetFinancialActionProviderId;
  readonly protocolId: MainnetFinancialActionProtocolId;
  readonly marketId: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly assetSymbol: SupportedStablecoin;
  readonly assetIdentity: string;
  readonly assetDecimals: number;
  readonly action: MainnetFinancialAction;
  readonly amountAtomic: string;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}

export interface ReadMainnetFinancialActionReconciliationEvidenceSourceRequestV1 extends ReadMainnetFinancialActionFinalityEvidenceSourceRequestCommonV1 {
  readonly purpose: 'RECONCILIATION_ADMISSION';
  readonly observationId: string;
}

export interface ReadMainnetFinancialActionPostFinalityEvidenceSourceRequestV1 extends ReadMainnetFinancialActionFinalityEvidenceSourceRequestCommonV1 {
  readonly purpose: 'POST_FINALITY_REVIEW';
  readonly reviewId: string;
  readonly terminalTransitionFingerprintSha256: string;
  readonly originalAdmissionFingerprintSha256: string;
  readonly terminalTransactionPosition: string;
  readonly terminalTransactionBlockId: string;
  readonly expectedReviewRevision: string;
  readonly expectedPreviousReviewFingerprintSha256: string | null;
  readonly effectiveSafetyState:
    | 'AUTHENTICATED_FINALITY_RECORDED'
    | 'POST_FINALITY_REVIEW_INCONCLUSIVE'
    | 'DEEP_REORG_QUARANTINED';
}

export type ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1 =
  | ReadMainnetFinancialActionReconciliationEvidenceSourceRequestV1
  | ReadMainnetFinancialActionPostFinalityEvidenceSourceRequestV1;

/**
 * Structurally reviewable chain facts. They remain untrusted until the exact
 * source instance authenticates its opaque capability against the exact read
 * request object. In particular, copying these fields never creates evidence.
 */
interface MainnetFinancialActionFinalityEvidenceSourceAttestationCommonV1 {
  readonly sourceVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION;
  readonly use: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly networkId: MainnetFinancialActionFinalityEvidenceNetworkId;
  readonly accountId: string;
  readonly intentId: string;
  readonly intentRecordFingerprintSha256: string;
  readonly walletRegistrationId: string;
  readonly walletAddress: WalletAddress;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly transactionId: string;
  readonly walletSignedPayloadSha256: string;
  readonly walletSignatureEvidenceSha256: string;
  readonly chainAnchorEvidenceFingerprintSha256: string;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly agreedFinalizedHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly sourceAuthorityId: string;
  readonly sourceAuthorityFingerprintSha256: string;
  readonly sourcePairApprovalId: string;
  readonly sourcePairRegistryFingerprintSha256: string;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceRole: 'PRIMARY' | 'CORROBORATING';
  readonly deploymentAuthorityId: string;
  readonly deploymentAuthorityFingerprintSha256: string;
  readonly deploymentManifestFingerprintSha256: string;
  readonly observedDeploymentIdentityFingerprintSha256: string;
  readonly providerId: MainnetFinancialActionProviderId;
  readonly protocolId: MainnetFinancialActionProtocolId;
  readonly marketId: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly assetSymbol: SupportedStablecoin;
  readonly assetIdentity: string;
  readonly assetDecimals: number;
  readonly action: MainnetFinancialAction;
  readonly amountAtomic: string;
  readonly correlationId: string;
  readonly transactionPosition: string;
  readonly transactionBlockId: string;
  readonly finalizedPosition: string;
  readonly finalizedBlockId: string;
  readonly transactionEvidenceSha256: string;
  readonly observedAt: string;
  readonly assessedAt: string;
  readonly attestationSha256: string;
}

export interface MainnetFinancialActionReconciliationEvidenceSourceAttestationV1 extends Omit<
  MainnetFinancialActionFinalityEvidenceSourceAttestationCommonV1,
  'transactionPosition' | 'transactionBlockId'
> {
  readonly purpose: 'RECONCILIATION_ADMISSION';
  readonly observationId: string;
  readonly outcome: DormantMainnetReconciliationDatabaseOutcome;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly effectEvidenceSha256: string | null;
  readonly failureEvidenceSha256: string | null;
}

export interface MainnetFinancialActionPostFinalityEvidenceSourceAttestationV1 extends MainnetFinancialActionFinalityEvidenceSourceAttestationCommonV1 {
  readonly purpose: 'POST_FINALITY_REVIEW';
  readonly reviewId: string;
  readonly terminalTransitionFingerprintSha256: string;
  readonly originalAdmissionFingerprintSha256: string;
  readonly terminalTransactionPosition: string;
  readonly terminalTransactionBlockId: string;
  readonly expectedReviewRevision: string;
  readonly expectedPreviousReviewFingerprintSha256: string | null;
  readonly effectiveSafetyState:
    | 'AUTHENTICATED_FINALITY_RECORDED'
    | 'POST_FINALITY_REVIEW_INCONCLUSIVE'
    | 'DEEP_REORG_QUARANTINED';
  readonly disposition: 'FINALITY_REAFFIRMED' | 'REVIEW_INCONCLUSIVE' | 'DEEP_REORG_QUARANTINED';
  readonly lineageStatus: 'CANONICAL' | 'UNKNOWN' | 'CONFLICT';
}

export type MainnetFinancialActionFinalityEvidenceSourceAttestationV1 =
  | MainnetFinancialActionReconciliationEvidenceSourceAttestationV1
  | MainnetFinancialActionPostFinalityEvidenceSourceAttestationV1;

/**
 * Read-only, direct-import-only boundary for one independently configured
 * source. Implementations privately issue capabilities and must return true
 * only for the exact capability/request pair they created. This declaration
 * registers no adapter and carries no endpoint, credential, persistence,
 * signing, broadcast, resend, or settlement authority.
 */
export interface MainnetFinancialActionFinalityEvidenceSourcePort {
  readonly sourceVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION;
  /**
   * Implementations must honor both `signal` and the exclusive `deadlineAt`
   * and settle their returned native Promise on cancellation. The producer
   * stops awaiting at the earliest authenticated expiry, but cannot physically
   * cancel an implementation that ignores this contract.
   */
  readAttestation(
    request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  ): Promise<unknown>;
  verifyAttestation(
    capability: unknown,
    request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  ): boolean;
}
