import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../../domain/mainnet-provider-position-chain-assessment';
import type { ProduceProviderPositionChainAnchorEvidenceRequestV1 } from '../dormant-provider-position-chain-anchor-evidence.producer';

export const PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION = 1 as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_ONLY' as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_ONLY' as const;

/**
 * An exact, authority-free handoff from the authenticated two-source evidence
 * producer. The capability stays opaque until the privately owned producer
 * authenticates it against this exact producer-request object.
 */
export interface AssessProviderPositionChainAnchorCandidateFinalityRequestV1 {
  readonly finalityVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly producerCapability: unknown;
  readonly producerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly signal: AbortSignal;
}

export type ProviderPositionChainAnchorCandidateFinalityStatus =
  'FINALIZED' | 'PENDING' | 'QUARANTINED';

export type ProviderPositionChainAnchorCandidateFinalityReason =
  | 'ETHEREUM_FINALIZED_HASH_MATCH'
  | 'ETHEREUM_FINALIZED_LINEAGE_COVERS_CANDIDATE'
  | 'ETHEREUM_FINALIZED_HEIGHT_BELOW_CANDIDATE'
  | 'ETHEREUM_FINALIZED_HASH_CONFLICT'
  | 'SOLANA_FINALIZED_ROOT_COVERS_CANDIDATE_SLOT'
  | 'SOLANA_FINALIZED_ROOT_BELOW_CANDIDATE_SLOT'
  | 'SOLANA_FINALIZED_ROOT_REGRESSION';

/**
 * A pure point-in-time classification. `expiresAtExclusive` is the earliest
 * producer deadline, source-pair approval expiry, or authenticated head
 * freshness boundary. Even `FINALIZED` grants no financial, persistence, or
 * snapshot authority. Solana finality is based only on the finalized root;
 * this boundary makes no same-slot fork-detection claim.
 */
export interface ProviderPositionChainAnchorCandidateFinalityResultV1 {
  readonly finalityVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly networkId: MainnetLaunchNetworkId;
  readonly sourceObservationId: string;
  readonly candidateAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly agreedFinalizedHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly status: ProviderPositionChainAnchorCandidateFinalityStatus;
  readonly reason: ProviderPositionChainAnchorCandidateFinalityReason;
  readonly authenticatedLineageProof: true;
  readonly comparedSolanaFinalizedRoot: boolean;
  readonly claimsSameSlotForkDetection: false;
  readonly assessedAt: string;
  readonly expiresAtExclusive: string;
}

/**
 * Dormant application boundary only. It registers no source or runtime,
 * performs no I/O, owns no timer or persistence capability, and cannot create
 * a provider-position snapshot. Results remain opaque until exact-identity
 * authentication by the same finalizer.
 */
export interface ProviderPositionChainAnchorCandidateFinalityPort {
  readonly finalityVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION;
  assessCandidate(request: AssessProviderPositionChainAnchorCandidateFinalityRequestV1): unknown;
  reviewAssessment(
    capability: unknown,
    request: AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
  ): ProviderPositionChainAnchorCandidateFinalityResultV1 | null;
}
