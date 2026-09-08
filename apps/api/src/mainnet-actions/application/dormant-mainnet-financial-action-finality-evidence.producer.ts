import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../../mainnet-platforms/domain/mainnet-provider-position-chain-assessment';
import type { MainnetProviderPositionSourceKind } from '../../mainnet-platforms/domain/mainnet-provider-position-observation-policy';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import { parseWalletAddress, type WalletAddress } from '../../wallets/domain/wallet-identity';
import {
  MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES,
  type MainnetFinancialAction,
  type MainnetFinancialActionProtocolId,
  type MainnetFinancialActionProviderId,
} from '../domain/dormant-mainnet-financial-action';
import type {
  DormantMainnetFinancialActionDatabaseStage,
  DormantMainnetReconciliationDatabaseOutcome,
  MainnetFinancialActionDatabaseNetworkId,
} from './ports/dormant-mainnet-financial-action-lifecycle-durable.port';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION,
  type MainnetFinancialActionFinalityEvidenceSourcePort,
  type ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  type ReadMainnetFinancialActionPostFinalityEvidenceSourceRequestV1,
  type ReadMainnetFinancialActionReconciliationEvidenceSourceRequestV1,
} from './ports/mainnet-financial-action-finality-evidence-source.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EVM_HASH = /^0x[0-9a-f]{64}$/u;
const EVM_MARKET = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UINT64 = /^(?:0|[1-9][0-9]{0,19})$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SOURCE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const APPROVAL_ID = /^[a-z0-9](?:[a-z0-9._:-]{1,126}[a-z0-9])$/u;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ZERO_SHA256 = '0'.repeat(64);
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_INT64 = (1n << 63n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_ABORT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as EventTarget['addEventListener'] | undefined;
const REMOVE_ABORT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'removeEventListener',
)?.value as EventTarget['removeEventListener'] | undefined;
const SYSTEM_SET_TIMEOUT = globalThis.setTimeout;
const SYSTEM_CLEAR_TIMEOUT = globalThis.clearTimeout;

export const MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION = 1 as const;
export const MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_RECONCILIATION_ADMISSION_CANDIDATE_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_ADMISSION_CANDIDATE_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION = 1 as const;
export const MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE =
  'AUTHENTICATED_MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE =
  'AUTHENTICATED_MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE =
  'MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE =
  'MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_ONLY' as const;

export type MainnetFinancialActionPostFinalityDisposition =
  'FINALITY_REAFFIRMED' | 'REVIEW_INCONCLUSIVE' | 'DEEP_REORG_QUARANTINED';
export type MainnetFinancialActionPostFinalityLineageStatus = 'CANONICAL' | 'UNKNOWN' | 'CONFLICT';
export type MainnetFinancialActionEffectiveSafetyState =
  | 'AUTHENTICATED_FINALITY_RECORDED'
  | 'POST_FINALITY_REVIEW_INCONCLUSIVE'
  | 'DEEP_REORG_QUARANTINED';

interface MainnetFinancialActionFinalityPrerequisiteCommonV1 {
  readonly prerequisiteVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly accountId: string;
  readonly intentId: string;
  readonly intentRecordFingerprintSha256: string;
  readonly walletRegistrationId: string;
  readonly walletAddress: WalletAddress;
  readonly networkId: MainnetFinancialActionDatabaseNetworkId;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly transactionId: string;
  readonly walletSignedPayloadSha256: string;
  readonly walletSignatureEvidenceSha256: string;
  readonly chainAnchorEvidenceFingerprintSha256: string;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly agreedFinalizedHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchorEvidenceExpiresAt: string;
  readonly sourceAuthorityId: string;
  readonly sourceAuthorityFingerprintSha256: string;
  readonly sourceAuthorityExpiresAt: string;
  readonly sourcePairApprovalId: string;
  readonly sourcePairRegistryFingerprintSha256: string;
  readonly primarySourceFamilyId: string;
  readonly primarySourceId: string;
  readonly primarySourceKind: MainnetProviderPositionSourceKind;
  readonly corroboratingSourceFamilyId: string;
  readonly corroboratingSourceId: string;
  readonly corroboratingSourceKind: MainnetProviderPositionSourceKind;
  readonly deploymentAuthorityId: string;
  readonly deploymentAuthorityFingerprintSha256: string;
  readonly deploymentAuthorityExpiresAt: string;
  readonly primaryDeploymentManifestFingerprintSha256: string;
  readonly primaryObservedIdentityFingerprintSha256: string;
  readonly corroboratingDeploymentManifestFingerprintSha256: string;
  readonly corroboratingObservedIdentityFingerprintSha256: string;
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
  readonly verifiedAt: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}

export interface MainnetFinancialActionReconciliationEvidencePrerequisiteV1 extends MainnetFinancialActionFinalityPrerequisiteCommonV1 {
  readonly use: typeof MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE;
  readonly purpose: 'RECONCILIATION_ADMISSION';
  readonly lifecycleStage:
    'WALLET_SIGNED_SUBMISSION_BOUND' | 'BROADCAST_OUTCOME_AMBIGUOUS' | 'RECONCILIATION_AMBIGUOUS';
  readonly observationId: string;
}

export interface MainnetFinancialActionPostFinalityEvidencePrerequisiteV1 extends MainnetFinancialActionFinalityPrerequisiteCommonV1 {
  readonly use: typeof MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE;
  readonly purpose: 'POST_FINALITY_REVIEW';
  readonly lifecycleStage: 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE';
  readonly terminalTransitionFingerprintSha256: string;
  readonly originalAdmissionFingerprintSha256: string;
  readonly terminalTransactionPosition: string;
  readonly terminalTransactionBlockId: string;
  readonly expectedReviewRevision: string;
  readonly expectedPreviousReviewFingerprintSha256: string | null;
  readonly effectiveSafetyState: MainnetFinancialActionEffectiveSafetyState;
  readonly reviewId: string;
}

/**
 * Upstream, direct-import-only capability boundary. Its future implementation
 * must privately own and authenticate the exact lifecycle-read result, the
 * recorded migration-0029 evidence result, active source/deployment authority
 * rows, and (for review) the immutable admitted terminal event plus effective
 * safety cursor. This producer never accepts those fields from its caller.
 */
export interface MainnetFinancialActionFinalityEvidencePrerequisitePort {
  readonly prerequisiteVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION;
  reviewReconciliationPrerequisite(
    capability: unknown,
    request: ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1,
  ): MainnetFinancialActionReconciliationEvidencePrerequisiteV1 | null;
  reviewPostFinalityPrerequisite(
    capability: unknown,
    request: ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  ): MainnetFinancialActionPostFinalityEvidencePrerequisiteV1 | null;
}

interface ReviewMainnetFinancialActionFinalityPrerequisiteRequestCommonV1 {
  readonly prerequisiteVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly signal: AbortSignal;
}

export interface ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1 extends ReviewMainnetFinancialActionFinalityPrerequisiteRequestCommonV1 {
  readonly use: typeof MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE;
  readonly purpose: 'RECONCILIATION_ADMISSION';
}

export interface ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1 extends ReviewMainnetFinancialActionFinalityPrerequisiteRequestCommonV1 {
  readonly use: typeof MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE;
  readonly purpose: 'POST_FINALITY_REVIEW';
}

type ReviewPrerequisiteRequest =
  | ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1
  | ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1;

export interface MainnetFinancialActionFinalityEvidenceSourceBindingV1 {
  readonly networkId: MainnetFinancialActionDatabaseNetworkId;
  readonly sourceAuthorityId: string;
  readonly sourceAuthorityFingerprintSha256: string;
  readonly role: 'PRIMARY' | 'CORROBORATING';
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly source: MainnetFinancialActionFinalityEvidenceSourcePort;
}

export interface MainnetFinancialActionFinalityEvidenceProducerClock {
  now(): Date;
}

interface ProduceMainnetFinancialActionFinalityEvidenceRequestCommonV1 {
  readonly producerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly prerequisiteCapability: unknown;
  readonly prerequisiteRequest: ReviewPrerequisiteRequest;
  readonly signal: AbortSignal;
}

/** The public request deliberately carries no chain fact or authority scalar. */
export interface ProduceMainnetFinancialActionReconciliationEvidenceRequestV1 extends ProduceMainnetFinancialActionFinalityEvidenceRequestCommonV1 {
  readonly use: typeof MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE;
  readonly purpose: 'RECONCILIATION_ADMISSION';
}

/** A separate domain prevents admission evidence from becoming review evidence. */
export interface ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1 extends ProduceMainnetFinancialActionFinalityEvidenceRequestCommonV1 {
  readonly use: typeof MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE;
  readonly purpose: 'POST_FINALITY_REVIEW';
}

/** Exact positional contract of migration 0035's authenticated admission function. */
export type MainnetFinancialActionReconciliationAdmissionArgumentsV1 = readonly [
  accountId: string,
  intentId: string,
  expectedRevision: string,
  expectedSnapshotSha256: string,
  observationId: string,
  transactionId: string,
  outcome: DormantMainnetReconciliationDatabaseOutcome,
  transactionPosition: string | null,
  transactionBlockId: string | null,
  finalizedPosition: string,
  finalizedBlockId: string,
  chainAnchorEvidenceFingerprintSha256: string,
  sourceAuthorityId: string,
  sourceAuthorityFingerprintSha256: string,
  deploymentAuthorityId: string,
  deploymentAuthorityFingerprintSha256: string,
  primaryAttestationSha256: string,
  corroboratingAttestationSha256: string,
  transactionEvidenceSha256: string,
  effectEvidenceSha256: string | null,
  failureEvidenceSha256: string | null,
  observedAt: string,
  deadlineAt: string,
  correlationId: string,
];

/** Exact positional contract of migration 0035's post-finality review function. */
export type MainnetFinancialActionPostFinalityReviewArgumentsV1 = readonly [
  accountId: string,
  intentId: string,
  terminalRevision: string,
  terminalSnapshotSha256: string,
  expectedReviewRevision: string,
  expectedPreviousReviewFingerprintSha256: string | null,
  reviewId: string,
  disposition: MainnetFinancialActionPostFinalityDisposition,
  lineageStatus: MainnetFinancialActionPostFinalityLineageStatus,
  transactionId: string,
  transactionPosition: string,
  transactionBlockId: string,
  finalizedPosition: string,
  finalizedBlockId: string,
  chainAnchorEvidenceFingerprintSha256: string,
  sourceAuthorityId: string,
  sourceAuthorityFingerprintSha256: string,
  deploymentAuthorityId: string,
  deploymentAuthorityFingerprintSha256: string,
  primaryAttestationSha256: string,
  corroboratingAttestationSha256: string,
  transactionEvidenceSha256: string,
  observedAt: string,
  deadlineAt: string,
  correlationId: string,
];

export interface MainnetFinancialActionReconciliationAdmissionCandidateV1 {
  readonly producerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION;
  readonly use: typeof MAINNET_FINANCIAL_ACTION_RECONCILIATION_ADMISSION_CANDIDATE_USE;
  readonly purpose: 'RECONCILIATION_ADMISSION';
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly admissionArguments: MainnetFinancialActionReconciliationAdmissionArgumentsV1;
}

export interface MainnetFinancialActionPostFinalityReviewCandidateV1 {
  readonly producerVersion: typeof MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION;
  readonly use: typeof MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_USE;
  readonly purpose: 'POST_FINALITY_REVIEW';
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly reviewArguments: MainnetFinancialActionPostFinalityReviewArgumentsV1;
  readonly effectiveSafetyBinding: Readonly<{
    readonly terminalTransitionFingerprintSha256: string;
    readonly originalAdmissionFingerprintSha256: string;
    readonly expectedReviewRevision: string;
    readonly expectedPreviousReviewFingerprintSha256: string | null;
    readonly effectiveSafetyState: MainnetFinancialActionEffectiveSafetyState;
  }>;
}

export type MainnetFinancialActionFinalityEvidenceProducerFailureCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'PREREQUISITE_UNAVAILABLE'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_ATTESTATION_INVALID'
  | 'SOURCE_DISAGREEMENT'
  | 'STALE_EVIDENCE';

export class DormantMainnetFinancialActionFinalityEvidenceUnavailableError extends Error {
  constructor(readonly code: MainnetFinancialActionFinalityEvidenceProducerFailureCode) {
    super('Authenticated mainnet financial-action finality evidence is unavailable.');
    this.name = 'DormantMainnetFinancialActionFinalityEvidenceUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type FinalityPrerequisite =
  | MainnetFinancialActionReconciliationEvidencePrerequisiteV1
  | MainnetFinancialActionPostFinalityEvidencePrerequisiteV1;
type ProduceRequest =
  | ProduceMainnetFinancialActionReconciliationEvidenceRequestV1
  | ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;

interface CanonicalTime {
  readonly value: string;
  readonly milliseconds: number;
}

interface CapturedPrerequisitePort {
  readonly receiver: MainnetFinancialActionFinalityEvidencePrerequisitePort;
  readonly reviewReconciliationPrerequisite: MainnetFinancialActionFinalityEvidencePrerequisitePort['reviewReconciliationPrerequisite'];
  readonly reviewPostFinalityPrerequisite: MainnetFinancialActionFinalityEvidencePrerequisitePort['reviewPostFinalityPrerequisite'];
}

interface CapturedSourceBinding extends Omit<
  MainnetFinancialActionFinalityEvidenceSourceBindingV1,
  'source'
> {
  readonly receiver: MainnetFinancialActionFinalityEvidenceSourcePort;
  readonly readAttestation: MainnetFinancialActionFinalityEvidenceSourcePort['readAttestation'];
  readonly verifyAttestation: MainnetFinancialActionFinalityEvidenceSourcePort['verifyAttestation'];
}

interface ReviewedCommonPrerequisite {
  readonly capability: object;
  readonly networkId: MainnetFinancialActionDatabaseNetworkId;
  readonly accountId: string;
  readonly intentId: string;
  readonly intentRecordFingerprintSha256: string;
  readonly walletRegistrationId: string;
  readonly walletAddress: WalletAddress;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly lifecycleStage: DormantMainnetFinancialActionDatabaseStage;
  readonly transactionId: string;
  readonly walletSignedPayloadSha256: string;
  readonly walletSignatureEvidenceSha256: string;
  readonly chainAnchorEvidenceFingerprintSha256: string;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly agreedFinalizedHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchorEvidenceExpiresAt: CanonicalTime;
  readonly sourceAuthorityId: string;
  readonly sourceAuthorityFingerprintSha256: string;
  readonly sourceAuthorityExpiresAt: CanonicalTime;
  readonly sourcePairApprovalId: string;
  readonly sourcePairRegistryFingerprintSha256: string;
  readonly primarySourceFamilyId: string;
  readonly primarySourceId: string;
  readonly primarySourceKind: MainnetProviderPositionSourceKind;
  readonly corroboratingSourceFamilyId: string;
  readonly corroboratingSourceId: string;
  readonly corroboratingSourceKind: MainnetProviderPositionSourceKind;
  readonly deploymentAuthorityId: string;
  readonly deploymentAuthorityFingerprintSha256: string;
  readonly deploymentAuthorityExpiresAt: CanonicalTime;
  readonly primaryDeploymentManifestFingerprintSha256: string;
  readonly primaryObservedIdentityFingerprintSha256: string;
  readonly corroboratingDeploymentManifestFingerprintSha256: string;
  readonly corroboratingObservedIdentityFingerprintSha256: string;
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
  readonly verifiedAt: CanonicalTime;
  readonly deadlineAt: CanonicalTime;
  readonly signal: AbortSignal;
}

interface ReviewedReconciliationPrerequisite extends ReviewedCommonPrerequisite {
  readonly purpose: 'RECONCILIATION_ADMISSION';
  readonly observationId: string;
}

interface ReviewedPostFinalityPrerequisite extends ReviewedCommonPrerequisite {
  readonly purpose: 'POST_FINALITY_REVIEW';
  readonly reviewId: string;
  readonly terminalTransitionFingerprintSha256: string;
  readonly originalAdmissionFingerprintSha256: string;
  readonly terminalTransactionPosition: string;
  readonly terminalTransactionBlockId: string;
  readonly expectedReviewRevision: string;
  readonly expectedPreviousReviewFingerprintSha256: string | null;
  readonly effectiveSafetyState: MainnetFinancialActionEffectiveSafetyState;
}

type ReviewedPrerequisite = ReviewedReconciliationPrerequisite | ReviewedPostFinalityPrerequisite;

interface ReviewedAttestationCommon {
  readonly capability: object;
  readonly observedAt: CanonicalTime;
  readonly assessedAt: CanonicalTime;
  readonly deploymentAuthorityId: string;
  readonly deploymentAuthorityFingerprintSha256: string;
  readonly providerId: MainnetFinancialActionProviderId;
  readonly protocolId: MainnetFinancialActionProtocolId;
  readonly marketId: string;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly finalizedPosition: string;
  readonly finalizedBlockId: string;
  readonly transactionEvidenceSha256: string;
  readonly attestationSha256: string;
}

interface ReviewedReconciliationAttestation extends ReviewedAttestationCommon {
  readonly purpose: 'RECONCILIATION_ADMISSION';
  readonly outcome: DormantMainnetReconciliationDatabaseOutcome;
  readonly effectEvidenceSha256: string | null;
  readonly failureEvidenceSha256: string | null;
}

interface ReviewedPostFinalityAttestation extends ReviewedAttestationCommon {
  readonly purpose: 'POST_FINALITY_REVIEW';
  readonly transactionPosition: string;
  readonly transactionBlockId: string;
  readonly disposition: MainnetFinancialActionPostFinalityDisposition;
  readonly lineageStatus: MainnetFinancialActionPostFinalityLineageStatus;
}

type ReviewedAttestation = ReviewedReconciliationAttestation | ReviewedPostFinalityAttestation;

interface IssuedCandidate<TRequest extends ProduceRequest, TCandidate extends object> {
  readonly request: TRequest;
  readonly candidate: TCandidate;
  readonly prerequisiteCapability: object;
  readonly networkId: MainnetFinancialActionDatabaseNetworkId;
  readonly signal: AbortSignal;
  readonly deadlineAtMilliseconds: number;
  readonly authorityExpiresAtMilliseconds: number;
  readonly evidenceObservedAtMilliseconds: number;
  readonly issuedAtMilliseconds: number;
}

const PUBLIC_REQUEST_KEYS = Object.freeze([
  'producerVersion',
  'use',
  'purpose',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'prerequisiteCapability',
  'prerequisiteRequest',
  'signal',
] as const);
const PREREQUISITE_REVIEW_REQUEST_KEYS = Object.freeze([
  'prerequisiteVersion',
  'use',
  'purpose',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'signal',
] as const);
const COMMON_PREREQUISITE_KEYS = Object.freeze([
  'prerequisiteVersion',
  'use',
  'purpose',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'intentId',
  'intentRecordFingerprintSha256',
  'walletRegistrationId',
  'walletAddress',
  'networkId',
  'lifecycleRevision',
  'lifecycleSnapshotSha256',
  'lifecycleStage',
  'transactionId',
  'walletSignedPayloadSha256',
  'walletSignatureEvidenceSha256',
  'chainAnchorEvidenceFingerprintSha256',
  'chainAnchor',
  'agreedFinalizedHead',
  'chainAnchorEvidenceExpiresAt',
  'sourceAuthorityId',
  'sourceAuthorityFingerprintSha256',
  'sourceAuthorityExpiresAt',
  'sourcePairApprovalId',
  'sourcePairRegistryFingerprintSha256',
  'primarySourceFamilyId',
  'primarySourceId',
  'primarySourceKind',
  'corroboratingSourceFamilyId',
  'corroboratingSourceId',
  'corroboratingSourceKind',
  'deploymentAuthorityId',
  'deploymentAuthorityFingerprintSha256',
  'deploymentAuthorityExpiresAt',
  'primaryDeploymentManifestFingerprintSha256',
  'primaryObservedIdentityFingerprintSha256',
  'corroboratingDeploymentManifestFingerprintSha256',
  'corroboratingObservedIdentityFingerprintSha256',
  'providerId',
  'protocolId',
  'marketId',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'assetSymbol',
  'assetIdentity',
  'assetDecimals',
  'action',
  'amountAtomic',
  'correlationId',
  'verifiedAt',
  'deadlineAt',
  'signal',
] as const);
const RECONCILIATION_PREREQUISITE_KEYS = Object.freeze([
  ...COMMON_PREREQUISITE_KEYS,
  'observationId',
] as const);
const REVIEW_PREREQUISITE_KEYS = Object.freeze([
  ...COMMON_PREREQUISITE_KEYS,
  'terminalTransitionFingerprintSha256',
  'originalAdmissionFingerprintSha256',
  'terminalTransactionPosition',
  'terminalTransactionBlockId',
  'expectedReviewRevision',
  'expectedPreviousReviewFingerprintSha256',
  'effectiveSafetyState',
  'reviewId',
] as const);
const SOURCE_REQUEST_COMMON_KEYS = Object.freeze([
  'sourceVersion',
  'use',
  'purpose',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'networkId',
  'accountId',
  'intentId',
  'intentRecordFingerprintSha256',
  'walletRegistrationId',
  'walletAddress',
  'lifecycleRevision',
  'lifecycleSnapshotSha256',
  'transactionId',
  'walletSignedPayloadSha256',
  'walletSignatureEvidenceSha256',
  'chainAnchorEvidenceFingerprintSha256',
  'chainAnchor',
  'agreedFinalizedHead',
  'sourceAuthorityId',
  'sourceAuthorityFingerprintSha256',
  'sourcePairApprovalId',
  'sourcePairRegistryFingerprintSha256',
  'sourceFamilyId',
  'sourceId',
  'sourceKind',
  'sourceRole',
  'deploymentAuthorityId',
  'deploymentAuthorityFingerprintSha256',
  'deploymentManifestFingerprintSha256',
  'observedDeploymentIdentityFingerprintSha256',
  'providerId',
  'protocolId',
  'marketId',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'assetSymbol',
  'assetIdentity',
  'assetDecimals',
  'action',
  'amountAtomic',
  'correlationId',
  'evaluatedAt',
  'deadlineAt',
  'signal',
] as const);
const ATTESTATION_COMMON_KEYS = Object.freeze([
  ...SOURCE_REQUEST_COMMON_KEYS.filter(
    (key) => key !== 'evaluatedAt' && key !== 'deadlineAt' && key !== 'signal',
  ),
  'transactionPosition',
  'transactionBlockId',
  'finalizedPosition',
  'finalizedBlockId',
  'transactionEvidenceSha256',
  'observedAt',
  'assessedAt',
  'attestationSha256',
] as const);
const RECONCILIATION_ATTESTATION_KEYS = Object.freeze([
  ...ATTESTATION_COMMON_KEYS,
  'observationId',
  'outcome',
  'effectEvidenceSha256',
  'failureEvidenceSha256',
] as const);
const REVIEW_ATTESTATION_KEYS = Object.freeze([
  ...ATTESTATION_COMMON_KEYS,
  'reviewId',
  'terminalTransitionFingerprintSha256',
  'originalAdmissionFingerprintSha256',
  'terminalTransactionPosition',
  'terminalTransactionBlockId',
  'expectedReviewRevision',
  'expectedPreviousReviewFingerprintSha256',
  'effectiveSafetyState',
  'disposition',
  'lineageStatus',
] as const);

function fail(code: MainnetFinancialActionFinalityEvidenceProducerFailureCode): never {
  throw new DormantMainnetFinancialActionFinalityEvidenceUnavailableError(code);
}

function nullRecord<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
  requireFrozen = false,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      (requireFrozen && !Object.isFrozen(value))
    ) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    void error;
    return fail(code);
  }
}

function stableDataMember(
  value: object,
  key: PropertyKey,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): unknown {
  try {
    let current: object | null = value;
    for (
      let depth = 0;
      current !== null &&
      current !== Object.prototype &&
      current !== Function.prototype &&
      depth < 8;
      depth += 1
    ) {
      if (isProxy(current)) return fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) return fail(code);
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail(code);
  } catch (error) {
    void error;
    return fail(code);
  }
}

function digest(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256) {
    return fail(code);
  }
  return value;
}

function uuid(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail(code);
  return value;
}

function uint64(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  if (typeof value !== 'string' || !UINT64.test(value) || BigInt(value) > MAX_UINT64) {
    return fail(code);
  }
  return value;
}

function positiveInt64(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  const parsed = uint64(value, code);
  if (BigInt(parsed) < 1n || BigInt(parsed) > MAX_INT64) return fail(code);
  return parsed;
}

function timestamp(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code);
  }
  return nullRecord({ value, milliseconds });
}

function clockTime(now: () => Date): CanonicalTime {
  try {
    const value = now();
    if (isProxy(value) || Object.getPrototypeOf(value) !== Date.prototype) {
      return fail('INVALID_CONFIGURATION');
    }
    const milliseconds = Date.prototype.getTime.call(value);
    if (!Number.isSafeInteger(milliseconds)) return fail('INVALID_CONFIGURATION');
    return nullRecord({ value: Date.prototype.toISOString.call(value), milliseconds });
  } catch (error) {
    void error;
    return fail('INVALID_CONFIGURATION');
  }
}

function network(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): MainnetFinancialActionDatabaseNetworkId {
  if (value !== ETHEREUM && value !== SOLANA) return fail(code);
  return value;
}

function signal(value: unknown): AbortSignal {
  try {
    if (
      ABORTED_GETTER === undefined ||
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype
    ) {
      return fail('INVALID_REQUEST');
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch (error) {
    void error;
    return fail('INVALID_REQUEST');
  }
}

function aborted(value: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) return fail('INVALID_REQUEST');
    return Reflect.apply(ABORTED_GETTER, value, []) as boolean;
  } catch (error) {
    void error;
    return fail('INVALID_REQUEST');
  }
}

function decodeBase58(value: string): Uint8Array | null {
  if (!BASE58.test(value)) return null;
  let number = 0n;
  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character);
    if (index < 0) return null;
    number = number * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.push(Number(number % 256n));
    number /= 256n;
  }
  bytes.reverse();
  const leading = value.match(/^1*/u)?.[0].length ?? 0;
  return Uint8Array.from([...new Array<number>(leading).fill(0), ...bytes]);
}

function canonicalBase58(
  value: unknown,
  expectedBytes: number,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  if (typeof value !== 'string') return fail(code);
  const decoded = decodeBase58(value);
  if (decoded === null || decoded.length !== expectedBytes || decoded.every((byte) => byte === 0)) {
    return fail(code);
  }
  return value;
}

function chainIdentity(
  networkId: MainnetFinancialActionDatabaseNetworkId,
  value: unknown,
  kind: 'TRANSACTION' | 'BLOCK',
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  if (networkId === ETHEREUM) {
    if (typeof value !== 'string' || !EVM_HASH.test(value) || /^0x0{64}$/u.test(value)) {
      return fail(code);
    }
    return value;
  }
  return canonicalBase58(value, kind === 'TRANSACTION' ? 64 : 32, code);
}

function anchor(
  value: unknown,
  networkId: MainnetFinancialActionDatabaseNetworkId,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  if (networkId === ETHEREUM) {
    const record = exactRecord(value, ['kind', 'blockNumber', 'blockHash'], code, true);
    if (record.kind !== 'EVM_BLOCK') return fail(code);
    return nullRecord({
      kind: 'EVM_BLOCK' as const,
      blockNumber: uint64(record.blockNumber, code),
      blockHash: chainIdentity(networkId, record.blockHash, 'BLOCK', code),
    });
  }
  const record = exactRecord(value, ['kind', 'slot', 'root'], code, true);
  if (record.kind !== 'SOLANA_SLOT') return fail(code);
  const slot = uint64(record.slot, code);
  const root = uint64(record.root, code);
  if (BigInt(root) > BigInt(slot)) return fail(code);
  return nullRecord({ kind: 'SOLANA_SLOT' as const, slot, root });
}

function sameAnchor(
  left: MainnetProviderPositionAssessmentChainAnchorV1,
  right: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  return left.kind === 'EVM_BLOCK' && right.kind === 'EVM_BLOCK'
    ? left.blockNumber === right.blockNumber && left.blockHash === right.blockHash
    : left.kind === 'SOLANA_SLOT' && right.kind === 'SOLANA_SLOT'
      ? left.slot === right.slot && left.root === right.root
      : false;
}

function sourceIdentity(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): {
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
} {
  const record = exactRecord(value, ['sourceFamilyId', 'sourceId', 'sourceKind'], code);
  if (
    typeof record.sourceFamilyId !== 'string' ||
    !SOURCE_ID.test(record.sourceFamilyId) ||
    typeof record.sourceId !== 'string' ||
    !SOURCE_ID.test(record.sourceId) ||
    (record.sourceKind !== 'RPC' &&
      record.sourceKind !== 'INDEXER' &&
      record.sourceKind !== 'PROVIDER_API')
  ) {
    return fail(code);
  }
  return nullRecord({
    sourceFamilyId: record.sourceFamilyId,
    sourceId: record.sourceId,
    sourceKind: record.sourceKind,
  });
}

function approvalId(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  if (typeof value !== 'string' || !APPROVAL_ID.test(value)) return fail(code);
  return value;
}

function market(
  networkId: MainnetFinancialActionDatabaseNetworkId,
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  if (networkId === ETHEREUM) {
    if (typeof value !== 'string' || !EVM_MARKET.test(value) || /^0x0+$/u.test(value)) {
      return fail(code);
    }
    return value;
  }
  return canonicalBase58(value, 32, code);
}

function walletAddress(
  networkId: MainnetFinancialActionDatabaseNetworkId,
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): WalletAddress {
  try {
    return parseWalletAddress(networkId, value);
  } catch (error) {
    void error;
    return fail(code);
  }
}

function action(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): MainnetFinancialAction {
  // Migration 0033/0035 can durably admit only these two action domains. Keep
  // the dormant producer fail-closed until BORROW/REPAY gain the same durable
  // authority and lifecycle representation.
  if (value !== 'SUPPLY' && value !== 'WITHDRAW') {
    return fail(code);
  }
  return value;
}

function atomicAmount(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): string {
  if (
    typeof value !== 'string' ||
    !UNSIGNED_INTEGER.test(value) ||
    BigInt(value) < 1n ||
    BigInt(value) > MAX_UINT256
  ) {
    return fail(code);
  }
  return value;
}

function assetBinding(
  networkId: MainnetFinancialActionDatabaseNetworkId,
  versionValue: unknown,
  fingerprintValue: unknown,
  symbolValue: unknown,
  identityValue: unknown,
  decimalsValue: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): Readonly<{
  assetRegistryVersion: number;
  assetRegistryFingerprintSha256: string;
  assetSymbol: SupportedStablecoin;
  assetIdentity: string;
  assetDecimals: number;
}> {
  if (!Number.isSafeInteger(versionValue) || (versionValue as number) < 1) return fail(code);
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.atVersion(versionValue as number);
  if (
    registry === undefined ||
    registry.fingerprintSha256 !== fingerprintValue ||
    typeof identityValue !== 'string' ||
    typeof symbolValue !== 'string'
  ) {
    return fail(code);
  }
  const asset = registry.identifyAsset(networkId, identityValue);
  if (
    asset === undefined ||
    asset.activationState !== 'ACTIVE' ||
    asset.stablecoin !== symbolValue ||
    asset.decimals !== decimalsValue
  ) {
    return fail(code);
  }
  return nullRecord({
    assetRegistryVersion: registry.version,
    assetRegistryFingerprintSha256: registry.fingerprintSha256,
    assetSymbol: asset.stablecoin,
    assetIdentity: asset.identity,
    assetDecimals: asset.decimals,
  });
}

function provider(
  networkId: MainnetFinancialActionDatabaseNetworkId,
  providerId: unknown,
  protocolId: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): {
  readonly providerId: MainnetFinancialActionProviderId;
  readonly protocolId: MainnetFinancialActionProtocolId;
} {
  const match = MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES.find(
    (candidate) =>
      candidate.networkId === networkId &&
      candidate.providerId === providerId &&
      candidate.protocolId === protocolId,
  );
  if (match === undefined) return fail(code);
  return nullRecord({ providerId: match.providerId, protocolId: match.protocolId });
}

function disposition(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): MainnetFinancialActionPostFinalityDisposition {
  if (
    value !== 'FINALITY_REAFFIRMED' &&
    value !== 'REVIEW_INCONCLUSIVE' &&
    value !== 'DEEP_REORG_QUARANTINED'
  ) {
    return fail(code);
  }
  return value;
}

function lineage(
  value: unknown,
  code: MainnetFinancialActionFinalityEvidenceProducerFailureCode,
): MainnetFinancialActionPostFinalityLineageStatus {
  if (value !== 'CANONICAL' && value !== 'UNKNOWN' && value !== 'CONFLICT') return fail(code);
  return value;
}

function matchingDisposition(
  reviewDisposition: MainnetFinancialActionPostFinalityDisposition,
  lineageStatus: MainnetFinancialActionPostFinalityLineageStatus,
): boolean {
  return (
    (reviewDisposition === 'FINALITY_REAFFIRMED' && lineageStatus === 'CANONICAL') ||
    (reviewDisposition === 'REVIEW_INCONCLUSIVE' && lineageStatus === 'UNKNOWN') ||
    (reviewDisposition === 'DEEP_REORG_QUARANTINED' && lineageStatus === 'CONFLICT')
  );
}

function capturePrerequisitePort(value: unknown): CapturedPrerequisitePort {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const receiver = value as MainnetFinancialActionFinalityEvidencePrerequisitePort;
  const prerequisiteVersion = stableDataMember(
    receiver,
    'prerequisiteVersion',
    'INVALID_CONFIGURATION',
  );
  const admission = stableDataMember(
    receiver,
    'reviewReconciliationPrerequisite',
    'INVALID_CONFIGURATION',
  );
  const review = stableDataMember(
    receiver,
    'reviewPostFinalityPrerequisite',
    'INVALID_CONFIGURATION',
  );
  if (
    prerequisiteVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION ||
    typeof admission !== 'function' ||
    isProxy(admission) ||
    typeof review !== 'function' ||
    isProxy(review)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver,
    reviewReconciliationPrerequisite:
      admission as MainnetFinancialActionFinalityEvidencePrerequisitePort['reviewReconciliationPrerequisite'],
    reviewPostFinalityPrerequisite:
      review as MainnetFinancialActionFinalityEvidencePrerequisitePort['reviewPostFinalityPrerequisite'],
  });
}

function captureSource(value: unknown): Readonly<{
  receiver: MainnetFinancialActionFinalityEvidenceSourcePort;
  readAttestation: MainnetFinancialActionFinalityEvidenceSourcePort['readAttestation'];
  verifyAttestation: MainnetFinancialActionFinalityEvidenceSourcePort['verifyAttestation'];
}> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const receiver = value as MainnetFinancialActionFinalityEvidenceSourcePort;
  const sourceVersion = stableDataMember(receiver, 'sourceVersion', 'INVALID_CONFIGURATION');
  const readAttestation = stableDataMember(receiver, 'readAttestation', 'INVALID_CONFIGURATION');
  const verifyAttestation = stableDataMember(
    receiver,
    'verifyAttestation',
    'INVALID_CONFIGURATION',
  );
  if (
    sourceVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION ||
    typeof readAttestation !== 'function' ||
    isProxy(readAttestation) ||
    typeof verifyAttestation !== 'function' ||
    isProxy(verifyAttestation)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver,
    readAttestation:
      readAttestation as MainnetFinancialActionFinalityEvidenceSourcePort['readAttestation'],
    verifyAttestation:
      verifyAttestation as MainnetFinancialActionFinalityEvidenceSourcePort['verifyAttestation'],
  });
}

function bindingKey(
  value: Omit<CapturedSourceBinding, 'receiver' | 'readAttestation' | 'verifyAttestation'>,
): string {
  return [
    value.networkId,
    value.sourceAuthorityId,
    value.sourceAuthorityFingerprintSha256,
    value.role,
    value.sourceFamilyId,
    value.sourceId,
    value.sourceKind,
  ].join('\0');
}

function captureBindings(value: unknown): readonly CapturedSourceBinding[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return fail('INVALID_CONFIGURATION');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > 128 ||
    lengthDescriptor.enumerable ||
    lengthDescriptor.configurable ||
    Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1
  ) {
    return fail('INVALID_CONFIGURATION');
  }

  const bindings: CapturedSourceBinding[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const elementDescriptor = descriptors[String(index)];
    if (
      elementDescriptor === undefined ||
      !('value' in elementDescriptor) ||
      !elementDescriptor.enumerable
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    const candidate = elementDescriptor.value;
    const record = exactRecord(
      candidate,
      [
        'networkId',
        'sourceAuthorityId',
        'sourceAuthorityFingerprintSha256',
        'role',
        'sourceFamilyId',
        'sourceId',
        'sourceKind',
        'source',
      ],
      'INVALID_CONFIGURATION',
    );
    if (record.role !== 'PRIMARY' && record.role !== 'CORROBORATING') {
      return fail('INVALID_CONFIGURATION');
    }
    const identity = sourceIdentity(
      {
        sourceFamilyId: record.sourceFamilyId,
        sourceId: record.sourceId,
        sourceKind: record.sourceKind,
      },
      'INVALID_CONFIGURATION',
    );
    const binding = Object.freeze({
      networkId: network(record.networkId, 'INVALID_CONFIGURATION'),
      sourceAuthorityId: uuid(record.sourceAuthorityId, 'INVALID_CONFIGURATION'),
      sourceAuthorityFingerprintSha256: digest(
        record.sourceAuthorityFingerprintSha256,
        'INVALID_CONFIGURATION',
      ),
      role: record.role,
      ...identity,
      ...captureSource(record.source),
    });
    const key = bindingKey(binding);
    for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
      const prior = bindings[priorIndex]!;
      if (bindingKey(prior) === key || prior.receiver === binding.receiver) {
        return fail('INVALID_CONFIGURATION');
      }
    }
    bindings[index] = binding;
  }

  // Sort without consulting any caller-shadowable or prototype-inherited
  // Array method. This also keeps construction deterministic if
  // Array.prototype has been polluted before the boundary is invoked.
  for (let index = 1; index < bindings.length; index += 1) {
    const current = bindings[index]!;
    const currentKey = bindingKey(current);
    let insertionIndex = index;
    while (insertionIndex > 0 && bindingKey(bindings[insertionIndex - 1]!) > currentKey) {
      bindings[insertionIndex] = bindings[insertionIndex - 1]!;
      insertionIndex -= 1;
    }
    bindings[insertionIndex] = current;
  }
  return Object.freeze(bindings);
}

function captureClock(value: unknown): () => Date {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const now = stableDataMember(value, 'now', 'INVALID_CONFIGURATION');
  if (typeof now !== 'function' || isProxy(now)) return fail('INVALID_CONFIGURATION');
  return () => Reflect.apply(now, value, []) as Date;
}

function publicRequest<TRequest extends ProduceRequest>(
  value: TRequest,
  purpose: TRequest['purpose'],
  use:
    | typeof MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE
    | typeof MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE,
): {
  readonly request: TRequest;
  readonly prerequisiteCapability: object;
  readonly prerequisiteRequest: ReviewPrerequisiteRequest;
  readonly signal: AbortSignal;
} {
  const record = exactRecord(value, PUBLIC_REQUEST_KEYS, 'INVALID_REQUEST', true);
  if (
    record.producerVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION ||
    record.use !== use ||
    record.purpose !== purpose ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    (typeof record.prerequisiteCapability !== 'object' &&
      typeof record.prerequisiteCapability !== 'function') ||
    record.prerequisiteCapability === null ||
    isProxy(record.prerequisiteCapability)
  ) {
    return fail('INVALID_REQUEST');
  }
  const requestSignal = signal(record.signal);
  const prerequisiteRequestRecord = exactRecord(
    record.prerequisiteRequest,
    PREREQUISITE_REVIEW_REQUEST_KEYS,
    'INVALID_REQUEST',
    true,
  );
  const expectedPrerequisiteUse =
    purpose === 'RECONCILIATION_ADMISSION'
      ? MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE
      : MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE;
  if (
    prerequisiteRequestRecord.prerequisiteVersion !==
      MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION ||
    prerequisiteRequestRecord.use !== expectedPrerequisiteUse ||
    prerequisiteRequestRecord.purpose !== purpose ||
    prerequisiteRequestRecord.mayAuthorizeFinancialAction !== false ||
    prerequisiteRequestRecord.mayPersist !== false ||
    prerequisiteRequestRecord.signal !== requestSignal ||
    aborted(requestSignal)
  ) {
    return fail('INVALID_REQUEST');
  }
  return nullRecord({
    request: value,
    prerequisiteCapability: record.prerequisiteCapability as object,
    prerequisiteRequest: record.prerequisiteRequest as ReviewPrerequisiteRequest,
    signal: requestSignal,
  });
}

function reviewPrerequisiteCapability(
  port: CapturedPrerequisitePort,
  capability: object,
  request: ReviewPrerequisiteRequest,
  purpose: 'RECONCILIATION_ADMISSION' | 'POST_FINALITY_REVIEW',
): FinalityPrerequisite {
  try {
    const result =
      purpose === 'RECONCILIATION_ADMISSION'
        ? Reflect.apply(port.reviewReconciliationPrerequisite, port.receiver, [capability, request])
        : Reflect.apply(port.reviewPostFinalityPrerequisite, port.receiver, [capability, request]);
    if (result === null) return fail('PREREQUISITE_UNAVAILABLE');
    return result;
  } catch (error) {
    void error;
    return fail('PREREQUISITE_UNAVAILABLE');
  }
}

function commonPrerequisite(
  record: Record<string, unknown>,
  capability: object,
  expectedUse:
    | typeof MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE
    | typeof MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE,
  expectedPurpose: 'RECONCILIATION_ADMISSION' | 'POST_FINALITY_REVIEW',
): ReviewedCommonPrerequisite {
  const networkId = network(record.networkId, 'PREREQUISITE_UNAVAILABLE');
  const lifecycleRevision = positiveInt64(record.lifecycleRevision, 'PREREQUISITE_UNAVAILABLE');
  const minimumLifecycleRevision = expectedPurpose === 'RECONCILIATION_ADMISSION' ? 2n : 3n;
  if (BigInt(lifecycleRevision) < minimumLifecycleRevision) {
    return fail('PREREQUISITE_UNAVAILABLE');
  }
  const transactionId = chainIdentity(
    networkId,
    record.transactionId,
    'TRANSACTION',
    'PREREQUISITE_UNAVAILABLE',
  );
  const providerBinding = provider(
    networkId,
    record.providerId,
    record.protocolId,
    'PREREQUISITE_UNAVAILABLE',
  );
  const assets = assetBinding(
    networkId,
    record.assetRegistryVersion,
    record.assetRegistryFingerprintSha256,
    record.assetSymbol,
    record.assetIdentity,
    record.assetDecimals,
    'PREREQUISITE_UNAVAILABLE',
  );
  const primarySource = sourceIdentity(
    {
      sourceFamilyId: record.primarySourceFamilyId,
      sourceId: record.primarySourceId,
      sourceKind: record.primarySourceKind,
    },
    'PREREQUISITE_UNAVAILABLE',
  );
  const corroboratingSource = sourceIdentity(
    {
      sourceFamilyId: record.corroboratingSourceFamilyId,
      sourceId: record.corroboratingSourceId,
      sourceKind: record.corroboratingSourceKind,
    },
    'PREREQUISITE_UNAVAILABLE',
  );
  const deploymentProofs = [
    digest(record.primaryDeploymentManifestFingerprintSha256, 'PREREQUISITE_UNAVAILABLE'),
    digest(record.primaryObservedIdentityFingerprintSha256, 'PREREQUISITE_UNAVAILABLE'),
    digest(record.corroboratingDeploymentManifestFingerprintSha256, 'PREREQUISITE_UNAVAILABLE'),
    digest(record.corroboratingObservedIdentityFingerprintSha256, 'PREREQUISITE_UNAVAILABLE'),
  ] as const;
  if (
    record.prerequisiteVersion !==
      MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION ||
    record.use !== expectedUse ||
    record.purpose !== expectedPurpose ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    primarySource.sourceFamilyId === corroboratingSource.sourceFamilyId ||
    primarySource.sourceId === corroboratingSource.sourceId ||
    new Set(deploymentProofs).size !== deploymentProofs.length
  ) {
    return fail('PREREQUISITE_UNAVAILABLE');
  }
  return nullRecord({
    capability,
    networkId,
    accountId: uuid(record.accountId, 'PREREQUISITE_UNAVAILABLE'),
    intentId: uuid(record.intentId, 'PREREQUISITE_UNAVAILABLE'),
    intentRecordFingerprintSha256: digest(
      record.intentRecordFingerprintSha256,
      'PREREQUISITE_UNAVAILABLE',
    ),
    walletRegistrationId: uuid(record.walletRegistrationId, 'PREREQUISITE_UNAVAILABLE'),
    walletAddress: walletAddress(networkId, record.walletAddress, 'PREREQUISITE_UNAVAILABLE'),
    lifecycleRevision,
    lifecycleSnapshotSha256: digest(record.lifecycleSnapshotSha256, 'PREREQUISITE_UNAVAILABLE'),
    lifecycleStage: record.lifecycleStage as DormantMainnetFinancialActionDatabaseStage,
    transactionId,
    walletSignedPayloadSha256: digest(record.walletSignedPayloadSha256, 'PREREQUISITE_UNAVAILABLE'),
    walletSignatureEvidenceSha256: digest(
      record.walletSignatureEvidenceSha256,
      'PREREQUISITE_UNAVAILABLE',
    ),
    chainAnchorEvidenceFingerprintSha256: digest(
      record.chainAnchorEvidenceFingerprintSha256,
      'PREREQUISITE_UNAVAILABLE',
    ),
    chainAnchor: anchor(record.chainAnchor, networkId, 'PREREQUISITE_UNAVAILABLE'),
    agreedFinalizedHead: anchor(record.agreedFinalizedHead, networkId, 'PREREQUISITE_UNAVAILABLE'),
    chainAnchorEvidenceExpiresAt: timestamp(
      record.chainAnchorEvidenceExpiresAt,
      'PREREQUISITE_UNAVAILABLE',
    ),
    sourceAuthorityId: uuid(record.sourceAuthorityId, 'PREREQUISITE_UNAVAILABLE'),
    sourceAuthorityFingerprintSha256: digest(
      record.sourceAuthorityFingerprintSha256,
      'PREREQUISITE_UNAVAILABLE',
    ),
    sourceAuthorityExpiresAt: timestamp(
      record.sourceAuthorityExpiresAt,
      'PREREQUISITE_UNAVAILABLE',
    ),
    sourcePairApprovalId: approvalId(record.sourcePairApprovalId, 'PREREQUISITE_UNAVAILABLE'),
    sourcePairRegistryFingerprintSha256: digest(
      record.sourcePairRegistryFingerprintSha256,
      'PREREQUISITE_UNAVAILABLE',
    ),
    primarySourceFamilyId: primarySource.sourceFamilyId,
    primarySourceId: primarySource.sourceId,
    primarySourceKind: primarySource.sourceKind,
    corroboratingSourceFamilyId: corroboratingSource.sourceFamilyId,
    corroboratingSourceId: corroboratingSource.sourceId,
    corroboratingSourceKind: corroboratingSource.sourceKind,
    deploymentAuthorityId: uuid(record.deploymentAuthorityId, 'PREREQUISITE_UNAVAILABLE'),
    deploymentAuthorityFingerprintSha256: digest(
      record.deploymentAuthorityFingerprintSha256,
      'PREREQUISITE_UNAVAILABLE',
    ),
    deploymentAuthorityExpiresAt: timestamp(
      record.deploymentAuthorityExpiresAt,
      'PREREQUISITE_UNAVAILABLE',
    ),
    primaryDeploymentManifestFingerprintSha256: deploymentProofs[0],
    primaryObservedIdentityFingerprintSha256: deploymentProofs[1],
    corroboratingDeploymentManifestFingerprintSha256: deploymentProofs[2],
    corroboratingObservedIdentityFingerprintSha256: deploymentProofs[3],
    ...providerBinding,
    marketId: market(networkId, record.marketId, 'PREREQUISITE_UNAVAILABLE'),
    ...assets,
    action: action(record.action, 'PREREQUISITE_UNAVAILABLE'),
    amountAtomic: atomicAmount(record.amountAtomic, 'PREREQUISITE_UNAVAILABLE'),
    correlationId: uuid(record.correlationId, 'PREREQUISITE_UNAVAILABLE'),
    verifiedAt: timestamp(record.verifiedAt, 'PREREQUISITE_UNAVAILABLE'),
    deadlineAt: timestamp(record.deadlineAt, 'PREREQUISITE_UNAVAILABLE'),
    signal: signal(record.signal),
  });
}

function reconciliationPrerequisite(
  capability: object,
  value: FinalityPrerequisite,
): ReviewedReconciliationPrerequisite {
  const record = exactRecord(
    value,
    RECONCILIATION_PREREQUISITE_KEYS,
    'PREREQUISITE_UNAVAILABLE',
    true,
  );
  const common = commonPrerequisite(
    record,
    capability,
    MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE,
    'RECONCILIATION_ADMISSION',
  );
  if (
    record.lifecycleStage !== 'WALLET_SIGNED_SUBMISSION_BOUND' &&
    record.lifecycleStage !== 'BROADCAST_OUTCOME_AMBIGUOUS' &&
    record.lifecycleStage !== 'RECONCILIATION_AMBIGUOUS'
  ) {
    return fail('PREREQUISITE_UNAVAILABLE');
  }
  if (
    (record.lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND' &&
      common.lifecycleRevision !== '2') ||
    (record.lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS' && common.lifecycleRevision !== '3')
  ) {
    return fail('PREREQUISITE_UNAVAILABLE');
  }
  return nullRecord({
    ...common,
    purpose: 'RECONCILIATION_ADMISSION' as const,
    lifecycleStage: record.lifecycleStage,
    observationId: uuid(record.observationId, 'PREREQUISITE_UNAVAILABLE'),
  });
}

function postFinalityPrerequisite(
  capability: object,
  value: FinalityPrerequisite,
): ReviewedPostFinalityPrerequisite {
  const record = exactRecord(value, REVIEW_PREREQUISITE_KEYS, 'PREREQUISITE_UNAVAILABLE', true);
  const common = commonPrerequisite(
    record,
    capability,
    MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE,
    'POST_FINALITY_REVIEW',
  );
  if (
    record.lifecycleStage !== 'FINALIZED_SUCCESS' &&
    record.lifecycleStage !== 'FINALIZED_FAILURE'
  ) {
    return fail('PREREQUISITE_UNAVAILABLE');
  }
  const expectedReviewRevision = uint64(record.expectedReviewRevision, 'PREREQUISITE_UNAVAILABLE');
  if (BigInt(expectedReviewRevision) > MAX_INT64) return fail('PREREQUISITE_UNAVAILABLE');
  const previous =
    record.expectedPreviousReviewFingerprintSha256 === null
      ? null
      : digest(record.expectedPreviousReviewFingerprintSha256, 'PREREQUISITE_UNAVAILABLE');
  if ((expectedReviewRevision === '0') !== (previous === null)) {
    return fail('PREREQUISITE_UNAVAILABLE');
  }
  const effectiveSafetyState = record.effectiveSafetyState;
  if (
    effectiveSafetyState !== 'AUTHENTICATED_FINALITY_RECORDED' &&
    effectiveSafetyState !== 'POST_FINALITY_REVIEW_INCONCLUSIVE' &&
    effectiveSafetyState !== 'DEEP_REORG_QUARANTINED'
  ) {
    return fail('PREREQUISITE_UNAVAILABLE');
  }
  return nullRecord({
    ...common,
    purpose: 'POST_FINALITY_REVIEW' as const,
    lifecycleStage: record.lifecycleStage,
    reviewId: uuid(record.reviewId, 'PREREQUISITE_UNAVAILABLE'),
    terminalTransitionFingerprintSha256: digest(
      record.terminalTransitionFingerprintSha256,
      'PREREQUISITE_UNAVAILABLE',
    ),
    originalAdmissionFingerprintSha256: digest(
      record.originalAdmissionFingerprintSha256,
      'PREREQUISITE_UNAVAILABLE',
    ),
    terminalTransactionPosition: uint64(
      record.terminalTransactionPosition,
      'PREREQUISITE_UNAVAILABLE',
    ),
    terminalTransactionBlockId: chainIdentity(
      common.networkId,
      record.terminalTransactionBlockId,
      'BLOCK',
      'PREREQUISITE_UNAVAILABLE',
    ),
    expectedReviewRevision,
    expectedPreviousReviewFingerprintSha256: previous,
    effectiveSafetyState,
  });
}

function ensurePrerequisiteCurrent(
  prerequisite: ReviewedPrerequisite,
  requestSignal: AbortSignal,
  evaluatedAt: CanonicalTime,
): void {
  const expiries = [
    prerequisite.deadlineAt.milliseconds,
    prerequisite.chainAnchorEvidenceExpiresAt.milliseconds,
    prerequisite.sourceAuthorityExpiresAt.milliseconds,
    prerequisite.deploymentAuthorityExpiresAt.milliseconds,
  ];
  if (
    prerequisite.signal !== requestSignal ||
    aborted(requestSignal) ||
    prerequisite.verifiedAt.milliseconds > evaluatedAt.milliseconds ||
    evaluatedAt.milliseconds >= Math.min(...expiries) ||
    prerequisite.deadlineAt.milliseconds - evaluatedAt.milliseconds > MAX_DEADLINE_MILLISECONDS
  ) {
    return fail('STALE_EVIDENCE');
  }
}

function bindingFor(
  bindings: readonly CapturedSourceBinding[],
  prerequisite: ReviewedPrerequisite,
  role: 'PRIMARY' | 'CORROBORATING',
): CapturedSourceBinding {
  const expectedIdentity =
    role === 'PRIMARY'
      ? {
          sourceFamilyId: prerequisite.primarySourceFamilyId,
          sourceId: prerequisite.primarySourceId,
          sourceKind: prerequisite.primarySourceKind,
        }
      : {
          sourceFamilyId: prerequisite.corroboratingSourceFamilyId,
          sourceId: prerequisite.corroboratingSourceId,
          sourceKind: prerequisite.corroboratingSourceKind,
        };
  const match = bindings.find(
    (binding) =>
      binding.networkId === prerequisite.networkId &&
      binding.sourceAuthorityId === prerequisite.sourceAuthorityId &&
      binding.sourceAuthorityFingerprintSha256 === prerequisite.sourceAuthorityFingerprintSha256 &&
      binding.role === role &&
      binding.sourceFamilyId === expectedIdentity.sourceFamilyId &&
      binding.sourceId === expectedIdentity.sourceId &&
      binding.sourceKind === expectedIdentity.sourceKind,
  );
  if (match === undefined) return fail('PREREQUISITE_UNAVAILABLE');
  return match;
}

function sourceRequestCommon(
  binding: CapturedSourceBinding,
  prerequisite: ReviewedPrerequisite,
  evaluatedAt: CanonicalTime,
): Omit<
  ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  | 'purpose'
  | 'observationId'
  | 'reviewId'
  | 'terminalTransitionFingerprintSha256'
  | 'originalAdmissionFingerprintSha256'
  | 'expectedReviewRevision'
  | 'expectedPreviousReviewFingerprintSha256'
  | 'effectiveSafetyState'
> {
  return nullRecord({
    sourceVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION,
    use: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    networkId: prerequisite.networkId,
    accountId: prerequisite.accountId,
    intentId: prerequisite.intentId,
    intentRecordFingerprintSha256: prerequisite.intentRecordFingerprintSha256,
    walletRegistrationId: prerequisite.walletRegistrationId,
    walletAddress: prerequisite.walletAddress,
    lifecycleRevision: prerequisite.lifecycleRevision,
    lifecycleSnapshotSha256: prerequisite.lifecycleSnapshotSha256,
    transactionId: prerequisite.transactionId,
    walletSignedPayloadSha256: prerequisite.walletSignedPayloadSha256,
    walletSignatureEvidenceSha256: prerequisite.walletSignatureEvidenceSha256,
    chainAnchorEvidenceFingerprintSha256: prerequisite.chainAnchorEvidenceFingerprintSha256,
    chainAnchor: prerequisite.chainAnchor,
    agreedFinalizedHead: prerequisite.agreedFinalizedHead,
    sourceAuthorityId: prerequisite.sourceAuthorityId,
    sourceAuthorityFingerprintSha256: prerequisite.sourceAuthorityFingerprintSha256,
    sourcePairApprovalId: prerequisite.sourcePairApprovalId,
    sourcePairRegistryFingerprintSha256: prerequisite.sourcePairRegistryFingerprintSha256,
    sourceFamilyId: binding.sourceFamilyId,
    sourceId: binding.sourceId,
    sourceKind: binding.sourceKind,
    sourceRole: binding.role,
    deploymentAuthorityId: prerequisite.deploymentAuthorityId,
    deploymentAuthorityFingerprintSha256: prerequisite.deploymentAuthorityFingerprintSha256,
    deploymentManifestFingerprintSha256:
      binding.role === 'PRIMARY'
        ? prerequisite.primaryDeploymentManifestFingerprintSha256
        : prerequisite.corroboratingDeploymentManifestFingerprintSha256,
    observedDeploymentIdentityFingerprintSha256:
      binding.role === 'PRIMARY'
        ? prerequisite.primaryObservedIdentityFingerprintSha256
        : prerequisite.corroboratingObservedIdentityFingerprintSha256,
    providerId: prerequisite.providerId,
    protocolId: prerequisite.protocolId,
    marketId: prerequisite.marketId,
    assetRegistryVersion: prerequisite.assetRegistryVersion,
    assetRegistryFingerprintSha256: prerequisite.assetRegistryFingerprintSha256,
    assetSymbol: prerequisite.assetSymbol,
    assetIdentity: prerequisite.assetIdentity,
    assetDecimals: prerequisite.assetDecimals,
    action: prerequisite.action,
    amountAtomic: prerequisite.amountAtomic,
    correlationId: prerequisite.correlationId,
    evaluatedAt: evaluatedAt.value,
    deadlineAt: prerequisite.deadlineAt.value,
    signal: prerequisite.signal,
  });
}

function sourceRequest(
  binding: CapturedSourceBinding,
  prerequisite: ReviewedPrerequisite,
  evaluatedAt: CanonicalTime,
): ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1 {
  const common = sourceRequestCommon(binding, prerequisite, evaluatedAt);
  return prerequisite.purpose === 'RECONCILIATION_ADMISSION'
    ? nullRecord<ReadMainnetFinancialActionReconciliationEvidenceSourceRequestV1>({
        ...common,
        purpose: 'RECONCILIATION_ADMISSION',
        observationId: prerequisite.observationId,
      })
    : nullRecord<ReadMainnetFinancialActionPostFinalityEvidenceSourceRequestV1>({
        ...common,
        purpose: 'POST_FINALITY_REVIEW',
        reviewId: prerequisite.reviewId,
        terminalTransitionFingerprintSha256: prerequisite.terminalTransitionFingerprintSha256,
        originalAdmissionFingerprintSha256: prerequisite.originalAdmissionFingerprintSha256,
        terminalTransactionPosition: prerequisite.terminalTransactionPosition,
        terminalTransactionBlockId: prerequisite.terminalTransactionBlockId,
        expectedReviewRevision: prerequisite.expectedReviewRevision,
        expectedPreviousReviewFingerprintSha256:
          prerequisite.expectedPreviousReviewFingerprintSha256,
        effectiveSafetyState: prerequisite.effectiveSafetyState,
      });
}

function startRead(
  binding: CapturedSourceBinding,
  request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
): Promise<unknown> {
  return Promise.resolve().then(() => {
    if (aborted(request.signal)) return fail('STALE_EVIDENCE');
    const operation = Reflect.apply(binding.readAttestation, binding.receiver, [request]);
    try {
      if (
        typeof operation !== 'object' ||
        operation === null ||
        isProxy(operation) ||
        Object.getPrototypeOf(operation) !== Promise.prototype
      ) {
        return fail('SOURCE_UNAVAILABLE');
      }
    } catch {
      return fail('SOURCE_UNAVAILABLE');
    }
    return operation;
  });
}

function readPairWithinDeadline(
  operation: Promise<readonly [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]>,
  requestSignal: AbortSignal,
  eligibilityExpiresAtMilliseconds: number,
  startedAtMilliseconds: number,
  now: () => Date,
): Promise<readonly [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
  const remaining = eligibilityExpiresAtMilliseconds - startedAtMilliseconds;
  if (
    remaining <= 0 ||
    remaining > MAX_DEADLINE_MILLISECONDS ||
    ADD_ABORT_LISTENER === undefined ||
    REMOVE_ABORT_LISTENER === undefined
  ) {
    return Promise.reject(
      new DormantMainnetFinancialActionFinalityEvidenceUnavailableError('STALE_EVIDENCE'),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let listening = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) SYSTEM_CLEAR_TIMEOUT(timer);
      if (listening) {
        Reflect.apply(REMOVE_ABORT_LISTENER, requestSignal, ['abort', onAbort]);
      }
    };
    const rejectWith = (code: MainnetFinancialActionFinalityEvidenceProducerFailureCode): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DormantMainnetFinancialActionFinalityEvidenceUnavailableError(code));
    };
    const onAbort = (): void => {
      rejectWith('STALE_EVIDENCE');
    };

    try {
      Reflect.apply(ADD_ABORT_LISTENER, requestSignal, ['abort', onAbort, { once: true }]);
      listening = true;
      if (aborted(requestSignal)) {
        onAbort();
        return;
      }
      timer = SYSTEM_SET_TIMEOUT(() => {
        try {
          const observedAt = clockTime(now);
          rejectWith(
            observedAt.milliseconds >= eligibilityExpiresAtMilliseconds
              ? 'STALE_EVIDENCE'
              : 'INVALID_CONFIGURATION',
          );
        } catch {
          rejectWith('INVALID_CONFIGURATION');
        }
      }, remaining);
      timer.unref?.();
      operation.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        () => {
          rejectWith('SOURCE_UNAVAILABLE');
        },
      );
    } catch {
      rejectWith('INVALID_CONFIGURATION');
    }
  });
}

function authenticCapability(
  binding: CapturedSourceBinding,
  capability: unknown,
  request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
): boolean {
  try {
    return (
      Reflect.apply(binding.verifyAttestation, binding.receiver, [capability, request]) === true
    );
  } catch (error) {
    void error;
    return false;
  }
}

function commonAttestation(
  capability: object,
  record: Record<string, unknown>,
  binding: CapturedSourceBinding,
  request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  prerequisite: ReviewedPrerequisite,
  evaluatedAt: CanonicalTime,
  completedAt: CanonicalTime,
): ReviewedAttestationCommon {
  const providerBinding = provider(
    prerequisite.networkId,
    record.providerId,
    record.protocolId,
    'SOURCE_ATTESTATION_INVALID',
  );
  const assets = assetBinding(
    prerequisite.networkId,
    record.assetRegistryVersion,
    record.assetRegistryFingerprintSha256,
    record.assetSymbol,
    record.assetIdentity,
    record.assetDecimals,
    'SOURCE_ATTESTATION_INVALID',
  );
  const transactionPosition =
    record.transactionPosition === null
      ? null
      : uint64(record.transactionPosition, 'SOURCE_ATTESTATION_INVALID');
  const transactionBlockId =
    record.transactionBlockId === null
      ? null
      : chainIdentity(
          prerequisite.networkId,
          record.transactionBlockId,
          'BLOCK',
          'SOURCE_ATTESTATION_INVALID',
        );
  const observedAt = timestamp(record.observedAt, 'SOURCE_ATTESTATION_INVALID');
  const assessedAt = timestamp(record.assessedAt, 'SOURCE_ATTESTATION_INVALID');
  if (
    record.sourceVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION ||
    record.use !== MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE ||
    record.purpose !== prerequisite.purpose ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.networkId !== prerequisite.networkId ||
    record.accountId !== prerequisite.accountId ||
    record.intentId !== prerequisite.intentId ||
    record.intentRecordFingerprintSha256 !== prerequisite.intentRecordFingerprintSha256 ||
    record.walletRegistrationId !== prerequisite.walletRegistrationId ||
    walletAddress(prerequisite.networkId, record.walletAddress, 'SOURCE_ATTESTATION_INVALID') !==
      prerequisite.walletAddress ||
    record.lifecycleRevision !== prerequisite.lifecycleRevision ||
    record.lifecycleSnapshotSha256 !== prerequisite.lifecycleSnapshotSha256 ||
    record.transactionId !== prerequisite.transactionId ||
    record.walletSignedPayloadSha256 !== prerequisite.walletSignedPayloadSha256 ||
    record.walletSignatureEvidenceSha256 !== prerequisite.walletSignatureEvidenceSha256 ||
    record.chainAnchorEvidenceFingerprintSha256 !==
      prerequisite.chainAnchorEvidenceFingerprintSha256 ||
    !sameAnchor(
      anchor(record.chainAnchor, prerequisite.networkId, 'SOURCE_ATTESTATION_INVALID'),
      prerequisite.chainAnchor,
    ) ||
    !sameAnchor(
      anchor(record.agreedFinalizedHead, prerequisite.networkId, 'SOURCE_ATTESTATION_INVALID'),
      prerequisite.agreedFinalizedHead,
    ) ||
    record.sourceAuthorityId !== prerequisite.sourceAuthorityId ||
    record.sourceAuthorityFingerprintSha256 !== prerequisite.sourceAuthorityFingerprintSha256 ||
    record.sourcePairApprovalId !== prerequisite.sourcePairApprovalId ||
    record.sourcePairRegistryFingerprintSha256 !==
      prerequisite.sourcePairRegistryFingerprintSha256 ||
    record.sourceFamilyId !== binding.sourceFamilyId ||
    record.sourceId !== binding.sourceId ||
    record.sourceKind !== binding.sourceKind ||
    record.sourceRole !== binding.role ||
    record.deploymentAuthorityId !== prerequisite.deploymentAuthorityId ||
    record.deploymentAuthorityFingerprintSha256 !==
      prerequisite.deploymentAuthorityFingerprintSha256 ||
    record.deploymentManifestFingerprintSha256 !==
      (binding.role === 'PRIMARY'
        ? prerequisite.primaryDeploymentManifestFingerprintSha256
        : prerequisite.corroboratingDeploymentManifestFingerprintSha256) ||
    record.observedDeploymentIdentityFingerprintSha256 !==
      (binding.role === 'PRIMARY'
        ? prerequisite.primaryObservedIdentityFingerprintSha256
        : prerequisite.corroboratingObservedIdentityFingerprintSha256) ||
    providerBinding.providerId !== prerequisite.providerId ||
    providerBinding.protocolId !== prerequisite.protocolId ||
    market(prerequisite.networkId, record.marketId, 'SOURCE_ATTESTATION_INVALID') !==
      prerequisite.marketId ||
    assets.assetRegistryVersion !== prerequisite.assetRegistryVersion ||
    assets.assetRegistryFingerprintSha256 !== prerequisite.assetRegistryFingerprintSha256 ||
    assets.assetSymbol !== prerequisite.assetSymbol ||
    assets.assetIdentity !== prerequisite.assetIdentity ||
    assets.assetDecimals !== prerequisite.assetDecimals ||
    action(record.action, 'SOURCE_ATTESTATION_INVALID') !== prerequisite.action ||
    atomicAmount(record.amountAtomic, 'SOURCE_ATTESTATION_INVALID') !== prerequisite.amountAtomic ||
    record.correlationId !== prerequisite.correlationId ||
    (transactionPosition === null) !== (transactionBlockId === null) ||
    observedAt.milliseconds < evaluatedAt.milliseconds ||
    observedAt.milliseconds > assessedAt.milliseconds ||
    assessedAt.milliseconds > completedAt.milliseconds
  ) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  return nullRecord({
    capability,
    observedAt,
    assessedAt,
    deploymentAuthorityId: prerequisite.deploymentAuthorityId,
    deploymentAuthorityFingerprintSha256: prerequisite.deploymentAuthorityFingerprintSha256,
    ...providerBinding,
    marketId: prerequisite.marketId,
    transactionPosition,
    transactionBlockId,
    finalizedPosition: uint64(record.finalizedPosition, 'SOURCE_ATTESTATION_INVALID'),
    finalizedBlockId: chainIdentity(
      prerequisite.networkId,
      record.finalizedBlockId,
      'BLOCK',
      'SOURCE_ATTESTATION_INVALID',
    ),
    transactionEvidenceSha256: digest(
      record.transactionEvidenceSha256,
      'SOURCE_ATTESTATION_INVALID',
    ),
    attestationSha256: digest(record.attestationSha256, 'SOURCE_ATTESTATION_INVALID'),
  });
}

function reconciliationAttestation(
  capability: object,
  binding: CapturedSourceBinding,
  request: ReadMainnetFinancialActionReconciliationEvidenceSourceRequestV1,
  prerequisite: ReviewedReconciliationPrerequisite,
  evaluatedAt: CanonicalTime,
  completedAt: CanonicalTime,
): ReviewedReconciliationAttestation {
  const record = exactRecord(
    capability,
    RECONCILIATION_ATTESTATION_KEYS,
    'SOURCE_ATTESTATION_INVALID',
    true,
  );
  const common = commonAttestation(
    capability,
    record,
    binding,
    request,
    prerequisite,
    evaluatedAt,
    completedAt,
  );
  const outcome = record.outcome;
  if (
    record.observationId !== prerequisite.observationId ||
    (outcome !== 'PENDING' &&
      outcome !== 'UNKNOWN' &&
      outcome !== 'FINALIZED_SUCCESS' &&
      outcome !== 'FINALIZED_FAILURE' &&
      outcome !== 'REORGED_OUT')
  ) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  const effect =
    record.effectEvidenceSha256 === null
      ? null
      : digest(record.effectEvidenceSha256, 'SOURCE_ATTESTATION_INVALID');
  const failure =
    record.failureEvidenceSha256 === null
      ? null
      : digest(record.failureEvidenceSha256, 'SOURCE_ATTESTATION_INVALID');
  const transaction = common.transactionPosition;
  const finalized = BigInt(common.finalizedPosition);
  if (
    (outcome === 'UNKNOWN' && transaction !== null) ||
    (outcome !== 'UNKNOWN' && outcome !== 'PENDING' && transaction === null) ||
    (outcome === 'PENDING' && transaction !== null && finalized >= BigInt(transaction)) ||
    ((outcome === 'FINALIZED_SUCCESS' ||
      outcome === 'FINALIZED_FAILURE' ||
      outcome === 'REORGED_OUT') &&
      transaction !== null &&
      finalized < BigInt(transaction)) ||
    (prerequisite.networkId === ETHEREUM &&
      (outcome === 'FINALIZED_SUCCESS' ||
        outcome === 'FINALIZED_FAILURE' ||
        outcome === 'REORGED_OUT') &&
      transaction !== null &&
      common.finalizedPosition === transaction &&
      common.finalizedBlockId !== common.transactionBlockId) ||
    (outcome === 'FINALIZED_SUCCESS' && (effect === null || failure !== null)) ||
    (outcome === 'FINALIZED_FAILURE' && (failure === null || effect !== null)) ||
    ((outcome === 'PENDING' || outcome === 'UNKNOWN' || outcome === 'REORGED_OUT') &&
      (effect !== null || failure !== null))
  ) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  ensureAnchorFacts(prerequisite, common, outcome !== 'UNKNOWN' && transaction !== null);
  return nullRecord({
    ...common,
    purpose: 'RECONCILIATION_ADMISSION' as const,
    outcome,
    effectEvidenceSha256: effect,
    failureEvidenceSha256: failure,
  });
}

function postFinalityAttestation(
  capability: object,
  binding: CapturedSourceBinding,
  request: ReadMainnetFinancialActionPostFinalityEvidenceSourceRequestV1,
  prerequisite: ReviewedPostFinalityPrerequisite,
  evaluatedAt: CanonicalTime,
  completedAt: CanonicalTime,
): ReviewedPostFinalityAttestation {
  const record = exactRecord(
    capability,
    REVIEW_ATTESTATION_KEYS,
    'SOURCE_ATTESTATION_INVALID',
    true,
  );
  const common = commonAttestation(
    capability,
    record,
    binding,
    request,
    prerequisite,
    evaluatedAt,
    completedAt,
  );
  const transactionPosition = common.transactionPosition;
  const transactionBlockId = common.transactionBlockId;
  if (transactionPosition === null || transactionBlockId === null) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  const reviewDisposition = disposition(record.disposition, 'SOURCE_ATTESTATION_INVALID');
  const lineageStatus = lineage(record.lineageStatus, 'SOURCE_ATTESTATION_INVALID');
  if (
    record.reviewId !== prerequisite.reviewId ||
    record.terminalTransitionFingerprintSha256 !==
      prerequisite.terminalTransitionFingerprintSha256 ||
    record.originalAdmissionFingerprintSha256 !== prerequisite.originalAdmissionFingerprintSha256 ||
    record.terminalTransactionPosition !== prerequisite.terminalTransactionPosition ||
    record.terminalTransactionBlockId !== prerequisite.terminalTransactionBlockId ||
    record.expectedReviewRevision !== prerequisite.expectedReviewRevision ||
    record.expectedPreviousReviewFingerprintSha256 !==
      prerequisite.expectedPreviousReviewFingerprintSha256 ||
    record.effectiveSafetyState !== prerequisite.effectiveSafetyState ||
    transactionPosition !== prerequisite.terminalTransactionPosition ||
    !matchingDisposition(reviewDisposition, lineageStatus) ||
    (reviewDisposition === 'DEEP_REORG_QUARANTINED'
      ? transactionBlockId === prerequisite.terminalTransactionBlockId
      : transactionBlockId !== prerequisite.terminalTransactionBlockId) ||
    (prerequisite.effectiveSafetyState === 'DEEP_REORG_QUARANTINED' &&
      reviewDisposition !== 'DEEP_REORG_QUARANTINED')
  ) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  ensureAnchorFacts(prerequisite, common, true);
  if (
    ((reviewDisposition === 'FINALITY_REAFFIRMED' ||
      reviewDisposition === 'DEEP_REORG_QUARANTINED') &&
      BigInt(common.finalizedPosition) < BigInt(transactionPosition)) ||
    (prerequisite.networkId === ETHEREUM &&
      (reviewDisposition === 'FINALITY_REAFFIRMED' ||
        reviewDisposition === 'DEEP_REORG_QUARANTINED') &&
      common.finalizedPosition === transactionPosition &&
      common.finalizedBlockId !== transactionBlockId)
  ) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  return nullRecord({
    ...common,
    purpose: 'POST_FINALITY_REVIEW' as const,
    transactionPosition,
    transactionBlockId,
    disposition: reviewDisposition,
    lineageStatus,
  });
}

function ensureAnchorFacts(
  prerequisite: ReviewedPrerequisite,
  attestation: ReviewedAttestationCommon,
  bindTransaction: boolean,
): void {
  if (prerequisite.networkId === ETHEREUM) {
    if (
      prerequisite.chainAnchor.kind !== 'EVM_BLOCK' ||
      prerequisite.agreedFinalizedHead.kind !== 'EVM_BLOCK' ||
      (bindTransaction &&
        (attestation.transactionPosition !== prerequisite.chainAnchor.blockNumber ||
          attestation.transactionBlockId !== prerequisite.chainAnchor.blockHash)) ||
      attestation.finalizedPosition !== prerequisite.agreedFinalizedHead.blockNumber ||
      attestation.finalizedBlockId !== prerequisite.agreedFinalizedHead.blockHash
    ) {
      return fail('SOURCE_ATTESTATION_INVALID');
    }
    return;
  }
  if (
    prerequisite.chainAnchor.kind !== 'SOLANA_SLOT' ||
    prerequisite.agreedFinalizedHead.kind !== 'SOLANA_SLOT' ||
    (bindTransaction && attestation.transactionPosition !== prerequisite.chainAnchor.slot) ||
    attestation.finalizedPosition !== prerequisite.agreedFinalizedHead.root
  ) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
}

function sameFacts(left: ReviewedAttestation, right: ReviewedAttestation): boolean {
  if (
    left.purpose !== right.purpose ||
    left.deploymentAuthorityId !== right.deploymentAuthorityId ||
    left.deploymentAuthorityFingerprintSha256 !== right.deploymentAuthorityFingerprintSha256 ||
    left.providerId !== right.providerId ||
    left.protocolId !== right.protocolId ||
    left.marketId !== right.marketId ||
    left.transactionPosition !== right.transactionPosition ||
    left.transactionBlockId !== right.transactionBlockId ||
    left.finalizedPosition !== right.finalizedPosition ||
    left.finalizedBlockId !== right.finalizedBlockId
  ) {
    return false;
  }
  return left.purpose === 'RECONCILIATION_ADMISSION' && right.purpose === 'RECONCILIATION_ADMISSION'
    ? left.outcome === right.outcome &&
        (left.effectEvidenceSha256 === null) === (right.effectEvidenceSha256 === null) &&
        (left.failureEvidenceSha256 === null) === (right.failureEvidenceSha256 === null)
    : left.purpose === 'POST_FINALITY_REVIEW' &&
        right.purpose === 'POST_FINALITY_REVIEW' &&
        left.disposition === right.disposition &&
        left.lineageStatus === right.lineageStatus;
}

function ensureEvidenceCurrent(
  networkId: MainnetFinancialActionDatabaseNetworkId,
  observedAtMilliseconds: number,
  checkedAtMilliseconds: number,
): void {
  const lifetime = networkId === ETHEREUM ? 60_000 : 15_000;
  if (
    checkedAtMilliseconds < observedAtMilliseconds ||
    checkedAtMilliseconds >= observedAtMilliseconds + lifetime
  ) {
    return fail('STALE_EVIDENCE');
  }
}

function aggregateEvidence(
  domain: 'transaction' | 'effect' | 'failure',
  prerequisite: ReviewedPrerequisite,
  primary: ReviewedAttestation,
  corroborating: ReviewedAttestation,
): string {
  const sourceValues =
    domain === 'transaction'
      ? [primary.transactionEvidenceSha256, corroborating.transactionEvidenceSha256]
      : domain === 'effect' &&
          primary.purpose === 'RECONCILIATION_ADMISSION' &&
          corroborating.purpose === 'RECONCILIATION_ADMISSION'
        ? [primary.effectEvidenceSha256, corroborating.effectEvidenceSha256]
        : domain === 'failure' &&
            primary.purpose === 'RECONCILIATION_ADMISSION' &&
            corroborating.purpose === 'RECONCILIATION_ADMISSION'
          ? [primary.failureEvidenceSha256, corroborating.failureEvidenceSha256]
          : [null, null];
  if (sourceValues[0] === null || sourceValues[1] === null) return fail('SOURCE_DISAGREEMENT');
  return fingerprint([
    `crypto-lending:mainnet-financial-action-${domain}-evidence:v1`,
    prerequisite.purpose,
    prerequisite.accountId,
    prerequisite.intentId,
    prerequisite.intentRecordFingerprintSha256,
    prerequisite.walletRegistrationId,
    prerequisite.walletAddress,
    prerequisite.lifecycleRevision,
    prerequisite.lifecycleSnapshotSha256,
    prerequisite.transactionId,
    prerequisite.walletSignedPayloadSha256,
    prerequisite.walletSignatureEvidenceSha256,
    prerequisite.providerId,
    prerequisite.protocolId,
    prerequisite.marketId,
    prerequisite.assetRegistryVersion,
    prerequisite.assetRegistryFingerprintSha256,
    prerequisite.assetSymbol,
    prerequisite.assetIdentity,
    prerequisite.assetDecimals,
    prerequisite.action,
    prerequisite.amountAtomic,
    prerequisite.chainAnchorEvidenceFingerprintSha256,
    prerequisite.sourceAuthorityFingerprintSha256,
    prerequisite.sourcePairApprovalId,
    prerequisite.sourcePairRegistryFingerprintSha256,
    prerequisite.primarySourceFamilyId,
    prerequisite.primarySourceId,
    prerequisite.primarySourceKind,
    prerequisite.corroboratingSourceFamilyId,
    prerequisite.corroboratingSourceId,
    prerequisite.corroboratingSourceKind,
    prerequisite.deploymentAuthorityFingerprintSha256,
    prerequisite.primaryDeploymentManifestFingerprintSha256,
    prerequisite.primaryObservedIdentityFingerprintSha256,
    prerequisite.corroboratingDeploymentManifestFingerprintSha256,
    prerequisite.corroboratingObservedIdentityFingerprintSha256,
    primary.attestationSha256,
    corroborating.attestationSha256,
    sourceValues,
  ]);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

/**
 * Dormant two-source evidence producer. Construction and import perform no
 * reads; only explicitly invoked injected ports can observe chain state. The
 * class owns no endpoint, credential, transport, SDK, writer, retry, signer,
 * broadcaster, recurring work, or runtime registration. Its sole native timer
 * bounds already-started read-only source work and is always cleared.
 */
export class DormantMainnetFinancialActionFinalityEvidenceProducer {
  readonly #prerequisites: CapturedPrerequisitePort;
  readonly #bindings: readonly CapturedSourceBinding[];
  readonly #now: () => Date;
  readonly #issuedAdmissions = new WeakMap<
    object,
    IssuedCandidate<
      ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      MainnetFinancialActionReconciliationAdmissionCandidateV1
    >
  >();
  readonly #issuedReviews = new WeakMap<
    object,
    IssuedCandidate<
      ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
      MainnetFinancialActionPostFinalityReviewCandidateV1
    >
  >();

  constructor(
    prerequisitePort: MainnetFinancialActionFinalityEvidencePrerequisitePort,
    sourceBindings: readonly MainnetFinancialActionFinalityEvidenceSourceBindingV1[],
    clock: MainnetFinancialActionFinalityEvidenceProducerClock,
  ) {
    this.#prerequisites = capturePrerequisitePort(prerequisitePort);
    this.#bindings = captureBindings(sourceBindings);
    this.#now = captureClock(clock);
  }

  async produceReconciliationAdmissionCandidate(
    requestInput: ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
  ): Promise<unknown> {
    const request = publicRequest(
      requestInput,
      'RECONCILIATION_ADMISSION',
      MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE,
    );
    const prerequisite = reconciliationPrerequisite(
      request.prerequisiteCapability,
      reviewPrerequisiteCapability(
        this.#prerequisites,
        request.prerequisiteCapability,
        request.prerequisiteRequest,
        'RECONCILIATION_ADMISSION',
      ),
    );
    const evidence = await this.#produce(request.signal, prerequisite);
    if (
      evidence.primary.purpose !== 'RECONCILIATION_ADMISSION' ||
      evidence.corroborating.purpose !== 'RECONCILIATION_ADMISSION'
    ) {
      return fail('SOURCE_ATTESTATION_INVALID');
    }
    const transactionEvidenceSha256 = aggregateEvidence(
      'transaction',
      prerequisite,
      evidence.primary,
      evidence.corroborating,
    );
    const effectEvidenceSha256 =
      evidence.primary.effectEvidenceSha256 === null
        ? null
        : aggregateEvidence('effect', prerequisite, evidence.primary, evidence.corroborating);
    const failureEvidenceSha256 =
      evidence.primary.failureEvidenceSha256 === null
        ? null
        : aggregateEvidence('failure', prerequisite, evidence.primary, evidence.corroborating);
    const admissionArguments = Object.freeze([
      prerequisite.accountId,
      prerequisite.intentId,
      prerequisite.lifecycleRevision,
      prerequisite.lifecycleSnapshotSha256,
      prerequisite.observationId,
      prerequisite.transactionId,
      evidence.primary.outcome,
      evidence.primary.transactionPosition,
      evidence.primary.transactionBlockId,
      evidence.primary.finalizedPosition,
      evidence.primary.finalizedBlockId,
      prerequisite.chainAnchorEvidenceFingerprintSha256,
      prerequisite.sourceAuthorityId,
      prerequisite.sourceAuthorityFingerprintSha256,
      prerequisite.deploymentAuthorityId,
      prerequisite.deploymentAuthorityFingerprintSha256,
      evidence.primary.attestationSha256,
      evidence.corroborating.attestationSha256,
      transactionEvidenceSha256,
      effectEvidenceSha256,
      failureEvidenceSha256,
      evidence.observedAt.value,
      prerequisite.deadlineAt.value,
      prerequisite.correlationId,
    ]) as MainnetFinancialActionReconciliationAdmissionArgumentsV1;
    const candidate = nullRecord<MainnetFinancialActionReconciliationAdmissionCandidateV1>({
      producerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
      use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_ADMISSION_CANDIDATE_USE,
      purpose: 'RECONCILIATION_ADMISSION',
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      admissionArguments,
    });
    this.#issue(this.#issuedAdmissions, request.request, prerequisite, evidence, candidate);
    return candidate;
  }

  async producePostFinalityReviewCandidate(
    requestInput: ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
  ): Promise<unknown> {
    const request = publicRequest(
      requestInput,
      'POST_FINALITY_REVIEW',
      MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE,
    );
    const prerequisite = postFinalityPrerequisite(
      request.prerequisiteCapability,
      reviewPrerequisiteCapability(
        this.#prerequisites,
        request.prerequisiteCapability,
        request.prerequisiteRequest,
        'POST_FINALITY_REVIEW',
      ),
    );
    const evidence = await this.#produce(request.signal, prerequisite);
    if (
      evidence.primary.purpose !== 'POST_FINALITY_REVIEW' ||
      evidence.corroborating.purpose !== 'POST_FINALITY_REVIEW'
    ) {
      return fail('SOURCE_ATTESTATION_INVALID');
    }
    const transactionEvidenceSha256 = aggregateEvidence(
      'transaction',
      prerequisite,
      evidence.primary,
      evidence.corroborating,
    );
    const reviewArguments = Object.freeze([
      prerequisite.accountId,
      prerequisite.intentId,
      prerequisite.lifecycleRevision,
      prerequisite.lifecycleSnapshotSha256,
      prerequisite.expectedReviewRevision,
      prerequisite.expectedPreviousReviewFingerprintSha256,
      prerequisite.reviewId,
      evidence.primary.disposition,
      evidence.primary.lineageStatus,
      prerequisite.transactionId,
      evidence.primary.transactionPosition,
      evidence.primary.transactionBlockId,
      evidence.primary.finalizedPosition,
      evidence.primary.finalizedBlockId,
      prerequisite.chainAnchorEvidenceFingerprintSha256,
      prerequisite.sourceAuthorityId,
      prerequisite.sourceAuthorityFingerprintSha256,
      prerequisite.deploymentAuthorityId,
      prerequisite.deploymentAuthorityFingerprintSha256,
      evidence.primary.attestationSha256,
      evidence.corroborating.attestationSha256,
      transactionEvidenceSha256,
      evidence.observedAt.value,
      prerequisite.deadlineAt.value,
      prerequisite.correlationId,
    ]) as MainnetFinancialActionPostFinalityReviewArgumentsV1;
    const candidate = nullRecord<MainnetFinancialActionPostFinalityReviewCandidateV1>({
      producerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
      use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_USE,
      purpose: 'POST_FINALITY_REVIEW',
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      reviewArguments,
      effectiveSafetyBinding: nullRecord({
        terminalTransitionFingerprintSha256: prerequisite.terminalTransitionFingerprintSha256,
        originalAdmissionFingerprintSha256: prerequisite.originalAdmissionFingerprintSha256,
        expectedReviewRevision: prerequisite.expectedReviewRevision,
        expectedPreviousReviewFingerprintSha256:
          prerequisite.expectedPreviousReviewFingerprintSha256,
        effectiveSafetyState: prerequisite.effectiveSafetyState,
      }),
    });
    this.#issue(this.#issuedReviews, request.request, prerequisite, evidence, candidate);
    return candidate;
  }

  reviewReconciliationAdmissionCandidate(
    capability: unknown,
    request: ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
  ): MainnetFinancialActionReconciliationAdmissionCandidateV1 {
    return this.#review(this.#issuedAdmissions, capability, request);
  }

  reviewPostFinalityReviewCandidate(
    capability: unknown,
    request: ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
  ): MainnetFinancialActionPostFinalityReviewCandidateV1 {
    return this.#review(this.#issuedReviews, capability, request);
  }

  async #produce(
    requestSignal: AbortSignal,
    prerequisite: ReviewedPrerequisite,
  ): Promise<{
    readonly primary: ReviewedAttestation;
    readonly corroborating: ReviewedAttestation;
    readonly observedAt: CanonicalTime;
    readonly freshnessFloorAt: CanonicalTime;
    readonly completedAt: CanonicalTime;
  }> {
    const evaluatedAt = clockTime(this.#now);
    ensurePrerequisiteCurrent(prerequisite, requestSignal, evaluatedAt);
    const primaryBinding = bindingFor(this.#bindings, prerequisite, 'PRIMARY');
    const corroboratingBinding = bindingFor(this.#bindings, prerequisite, 'CORROBORATING');
    if (
      primaryBinding.receiver === corroboratingBinding.receiver ||
      primaryBinding.sourceFamilyId === corroboratingBinding.sourceFamilyId ||
      primaryBinding.sourceId === corroboratingBinding.sourceId
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    const primaryRequest = sourceRequest(primaryBinding, prerequisite, evaluatedAt);
    const corroboratingRequest = sourceRequest(corroboratingBinding, prerequisite, evaluatedAt);
    const pendingReads = Promise.allSettled([
      startRead(primaryBinding, primaryRequest),
      startRead(corroboratingBinding, corroboratingRequest),
    ]) as Promise<readonly [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]>;
    const [primaryResult, corroboratingResult] = await readPairWithinDeadline(
      pendingReads,
      requestSignal,
      Math.min(
        prerequisite.deadlineAt.milliseconds,
        prerequisite.chainAnchorEvidenceExpiresAt.milliseconds,
        prerequisite.sourceAuthorityExpiresAt.milliseconds,
        prerequisite.deploymentAuthorityExpiresAt.milliseconds,
      ),
      evaluatedAt.milliseconds,
      this.#now,
    );
    const completedAt = clockTime(this.#now);
    ensurePrerequisiteCurrent(prerequisite, requestSignal, completedAt);
    if (
      completedAt.milliseconds < evaluatedAt.milliseconds ||
      primaryResult.status !== 'fulfilled' ||
      corroboratingResult.status !== 'fulfilled'
    ) {
      return fail('SOURCE_UNAVAILABLE');
    }
    const primaryAuthentic = authenticCapability(
      primaryBinding,
      primaryResult.value,
      primaryRequest,
    );
    const corroboratingAuthentic = authenticCapability(
      corroboratingBinding,
      corroboratingResult.value,
      corroboratingRequest,
    );
    if (!primaryAuthentic || !corroboratingAuthentic) {
      return fail('SOURCE_ATTESTATION_INVALID');
    }
    if (
      typeof primaryResult.value !== 'object' ||
      primaryResult.value === null ||
      typeof corroboratingResult.value !== 'object' ||
      corroboratingResult.value === null ||
      primaryResult.value === corroboratingResult.value
    ) {
      return fail('SOURCE_ATTESTATION_INVALID');
    }
    const primary =
      prerequisite.purpose === 'RECONCILIATION_ADMISSION'
        ? reconciliationAttestation(
            primaryResult.value,
            primaryBinding,
            primaryRequest as ReadMainnetFinancialActionReconciliationEvidenceSourceRequestV1,
            prerequisite,
            evaluatedAt,
            completedAt,
          )
        : postFinalityAttestation(
            primaryResult.value,
            primaryBinding,
            primaryRequest as ReadMainnetFinancialActionPostFinalityEvidenceSourceRequestV1,
            prerequisite,
            evaluatedAt,
            completedAt,
          );
    const corroborating =
      prerequisite.purpose === 'RECONCILIATION_ADMISSION'
        ? reconciliationAttestation(
            corroboratingResult.value,
            corroboratingBinding,
            corroboratingRequest as ReadMainnetFinancialActionReconciliationEvidenceSourceRequestV1,
            prerequisite,
            evaluatedAt,
            completedAt,
          )
        : postFinalityAttestation(
            corroboratingResult.value,
            corroboratingBinding,
            corroboratingRequest as ReadMainnetFinancialActionPostFinalityEvidenceSourceRequestV1,
            prerequisite,
            evaluatedAt,
            completedAt,
          );
    if (
      !sameFacts(primary, corroborating) ||
      primary.attestationSha256 === corroborating.attestationSha256
    ) {
      return fail('SOURCE_DISAGREEMENT');
    }
    const observedAt =
      primary.observedAt.milliseconds >= corroborating.observedAt.milliseconds
        ? primary.observedAt
        : corroborating.observedAt;
    const freshnessFloorAt =
      primary.observedAt.milliseconds <= corroborating.observedAt.milliseconds
        ? primary.observedAt
        : corroborating.observedAt;
    ensureEvidenceCurrent(
      prerequisite.networkId,
      primary.observedAt.milliseconds,
      completedAt.milliseconds,
    );
    ensureEvidenceCurrent(
      prerequisite.networkId,
      corroborating.observedAt.milliseconds,
      completedAt.milliseconds,
    );
    return nullRecord({ primary, corroborating, observedAt, freshnessFloorAt, completedAt });
  }

  #issue<TRequest extends ProduceRequest, TCandidate extends object>(
    map: WeakMap<object, IssuedCandidate<TRequest, TCandidate>>,
    request: TRequest,
    prerequisite: ReviewedPrerequisite,
    evidence: {
      readonly observedAt: CanonicalTime;
      readonly freshnessFloorAt: CanonicalTime;
      readonly completedAt: CanonicalTime;
    },
    candidate: TCandidate,
  ): void {
    const issuedAt = clockTime(this.#now);
    ensurePrerequisiteCurrent(prerequisite, request.signal, issuedAt);
    ensureEvidenceCurrent(
      prerequisite.networkId,
      evidence.freshnessFloorAt.milliseconds,
      issuedAt.milliseconds,
    );
    if (issuedAt.milliseconds < evidence.completedAt.milliseconds) return fail('STALE_EVIDENCE');
    map.set(
      candidate,
      nullRecord({
        request,
        candidate,
        prerequisiteCapability: prerequisite.capability,
        networkId: prerequisite.networkId,
        signal: prerequisite.signal,
        deadlineAtMilliseconds: prerequisite.deadlineAt.milliseconds,
        authorityExpiresAtMilliseconds: Math.min(
          prerequisite.chainAnchorEvidenceExpiresAt.milliseconds,
          prerequisite.sourceAuthorityExpiresAt.milliseconds,
          prerequisite.deploymentAuthorityExpiresAt.milliseconds,
        ),
        evidenceObservedAtMilliseconds: evidence.freshnessFloorAt.milliseconds,
        issuedAtMilliseconds: issuedAt.milliseconds,
      }),
    );
  }

  #review<TRequest extends ProduceRequest, TCandidate extends object>(
    map: WeakMap<object, IssuedCandidate<TRequest, TCandidate>>,
    capability: unknown,
    request: TRequest,
  ): TCandidate {
    if (typeof capability !== 'object' || capability === null || isProxy(capability)) {
      return fail('INVALID_REQUEST');
    }
    const issued = map.get(capability);
    if (
      issued === undefined ||
      issued.request !== request ||
      issued.candidate !== capability ||
      request.prerequisiteCapability !== issued.prerequisiteCapability ||
      request.signal !== issued.signal
    ) {
      return fail('INVALID_REQUEST');
    }
    const reviewedAt = clockTime(this.#now);
    if (
      reviewedAt.milliseconds < issued.issuedAtMilliseconds ||
      reviewedAt.milliseconds >= issued.deadlineAtMilliseconds ||
      reviewedAt.milliseconds >= issued.authorityExpiresAtMilliseconds ||
      aborted(issued.signal)
    ) {
      return fail('STALE_EVIDENCE');
    }
    ensureEvidenceCurrent(
      issued.networkId,
      issued.evidenceObservedAtMilliseconds,
      reviewedAt.milliseconds,
    );
    return issued.candidate;
  }
}
