import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type {
  RecordProviderPositionChainAnchorEvidenceRequestV2,
  ProviderPositionChainAnchorEvidenceRecorderPort,
} from '../../../mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-recorder.port';
import type { WalletAddress } from '../../../wallets/domain/wallet-identity';
import type {
  MainnetFinancialActionFinalityEvidencePrerequisitePort,
  ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1,
} from '../dormant-mainnet-financial-action-finality-evidence.producer';
import type {
  DormantMainnetFinancialActionLifecycleDurablePort,
  ReadDormantMainnetFinancialActionDurableRequestV1,
} from './dormant-mainnet-financial-action-lifecycle-durable.port';
import type {
  DormantMainnetFinancialActionEffectiveSafetyReaderPort,
  ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
} from './dormant-mainnet-financial-action-finality-sidecar-durable.port';

export const MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION = 1 as const;
export const MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ISSUE_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ISSUE_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUANCE_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUANCE_ONLY' as const;

export const MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION = 2 as const;
export const MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_ONLY' as const;

interface IssueMainnetFinancialActionFinalityPrerequisiteRequestCommonV1 {
  readonly issuerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  /** Opaque result issued for the exact account-scoped lifecycle READ below. */
  readonly lifecycleCapability: unknown;
  readonly lifecycleRequest: ReadDormantMainnetFinancialActionDurableRequestV1;
  /** Opaque, confirmed migration-0029 record result; no fingerprint scalar is accepted. */
  readonly chainEvidenceCapability: unknown;
  readonly chainEvidenceRequest: RecordProviderPositionChainAnchorEvidenceRequestV2;
  /** Server-owned operation identifier, never a provider or chain fact. */
  readonly correlationId: string;
  /** Exclusive, server-owned upper bound shared with every nested read. */
  readonly deadlineAt: string;
  /** One exact cancellation identity shared by every nested request. */
  readonly signal: AbortSignal;
}

export interface IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1 extends IssueMainnetFinancialActionFinalityPrerequisiteRequestCommonV1 {
  readonly use: typeof MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ISSUE_USE;
  readonly purpose: 'RECONCILIATION_ADMISSION';
  readonly observationId: string;
}

export interface IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1 extends IssueMainnetFinancialActionFinalityPrerequisiteRequestCommonV1 {
  readonly use: typeof MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE;
  readonly purpose: 'POST_FINALITY_REVIEW';
  readonly reviewId: string;
  /** Opaque result issued for the exact migration-0035 effective-safety READ below. */
  readonly effectiveSafetyCapability: unknown;
  readonly effectiveSafetyRequest: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
}

export type IssueMainnetFinancialActionFinalityPrerequisiteRequestV1 =
  | IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1
  | IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1;

interface MainnetFinancialActionFinalityPrerequisiteIssuanceCommonV1 {
  readonly issuerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION;
  readonly use: typeof MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUANCE_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  /** Opaque capability accepted only by the same issuer instance. */
  readonly prerequisiteCapability: object;
}

export interface MainnetFinancialActionReconciliationPrerequisiteIssuanceV1 extends MainnetFinancialActionFinalityPrerequisiteIssuanceCommonV1 {
  readonly purpose: 'RECONCILIATION_ADMISSION';
  readonly prerequisiteRequest: ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1;
}

export interface MainnetFinancialActionPostFinalityPrerequisiteIssuanceV1 extends MainnetFinancialActionFinalityPrerequisiteIssuanceCommonV1 {
  readonly purpose: 'POST_FINALITY_REVIEW';
  readonly prerequisiteRequest: ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1;
}

export type MainnetFinancialActionFinalityPrerequisiteIssuanceV1 =
  | MainnetFinancialActionReconciliationPrerequisiteIssuanceV1
  | MainnetFinancialActionPostFinalityPrerequisiteIssuanceV1;

/**
 * Private wallet-plaintext boundary used only after migration 0038 has
 * authenticated the lifecycle wallet identifier and its captured keyed digest.
 * The reader separately proves that the exact account/intent/lifecycle recovery
 * cursor resolves to the same signed-bound wallet and verifies its plaintext
 * against the current HMAC alias. A revoked registration is usable only when
 * migration 0038 proves that the signed event predates revocation. This read
 * never authorizes a new action and must not expose unrelated roster metadata
 * or key material.
 */
export interface ReadMainnetFinancialActionFinalityWalletRequestV2 {
  readonly readerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION;
  readonly use: typeof MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly accountId: string;
  readonly intentId: string;
  readonly walletRegistrationId: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly walletIdentityDigestVersion: number;
  readonly walletIdentityDigestHex: string;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly lifecycleStage:
    | 'WALLET_SIGNED_SUBMISSION_BOUND'
    | 'BROADCAST_OUTCOME_AMBIGUOUS'
    | 'RECONCILIATION_AMBIGUOUS'
    | 'FINALIZED_SUCCESS'
    | 'FINALIZED_FAILURE';
  readonly purpose: 'RECONCILIATION_ADMISSION' | 'POST_FINALITY_REVIEW';
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}

export interface MainnetFinancialActionFinalityWalletResultV2 {
  readonly readerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION;
  readonly use: typeof MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly accountId: string;
  readonly intentId: string;
  readonly walletRegistrationId: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly walletIdentityDigestVersion: number;
  readonly walletIdentityDigestHex: string;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly lifecycleStage: ReadMainnetFinancialActionFinalityWalletRequestV2['lifecycleStage'];
  readonly purpose: ReadMainnetFinancialActionFinalityWalletRequestV2['purpose'];
  readonly walletStatus: 'ACTIVE' | 'REVOKED';
  readonly revokedAt: string | null;
  readonly verifiedAt: string;
  readonly walletAddress: WalletAddress;
}

export interface MainnetFinancialActionFinalityWalletReaderPort {
  readonly readerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION;
  readWallet(request: ReadMainnetFinancialActionFinalityWalletRequestV2): Promise<unknown>;
  verifyWallet(
    capability: unknown,
    request: ReadMainnetFinancialActionFinalityWalletRequestV2,
  ): MainnetFinancialActionFinalityWalletResultV2 | null;
}

export interface MainnetFinancialActionFinalityPrerequisiteIssuerClock {
  now(): Date;
}

/**
 * Dormant direct-import-only issuer. The implementation authenticates every
 * upstream opaque capability, performs one owner-only prerequisite snapshot
 * read, resolves only the exact lifecycle-bound wallet, and privately seals the
 * prerequisite capability consumed by the evidence producer.
 *
 * This declaration registers nothing and grants no database, endpoint,
 * credential, transaction-construction, signing, broadcast, retry, resend,
 * persistence, or settlement authority.
 */
export interface MainnetFinancialActionFinalityPrerequisiteIssuerPort extends MainnetFinancialActionFinalityEvidencePrerequisitePort {
  readonly issuerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION;
  issueReconciliationPrerequisite(
    request: IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1,
  ): Promise<unknown>;
  issuePostFinalityPrerequisite(
    request: IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  ): Promise<unknown>;
  reviewIssuance(
    capability: unknown,
    request: IssueMainnetFinancialActionFinalityPrerequisiteRequestV1,
  ): MainnetFinancialActionFinalityPrerequisiteIssuanceV1 | null;
}

/** Constructor dependency documentation kept here so no runtime token is created. */
export type MainnetFinancialActionFinalityPrerequisiteIssuerDependencies = Readonly<{
  lifecycle: DormantMainnetFinancialActionLifecycleDurablePort;
  chainEvidence: ProviderPositionChainAnchorEvidenceRecorderPort;
  effectiveSafety: DormantMainnetFinancialActionEffectiveSafetyReaderPort;
  wallet: MainnetFinancialActionFinalityWalletReaderPort;
}>;
