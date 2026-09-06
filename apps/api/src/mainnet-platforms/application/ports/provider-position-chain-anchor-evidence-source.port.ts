import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../../domain/mainnet-provider-position-chain-assessment';
import type { MainnetProviderPositionSourceKind } from '../../domain/mainnet-provider-position-observation-policy';

export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION = 1 as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_ONLY' as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_ONLY' as const;

export type ProviderPositionChainAnchorEvidenceSourceNetworkId = MainnetLaunchNetworkId;

/**
 * One exact, global chain-fact query to a privately configured independent
 * source. Endpoints, credentials, database handles, and provider SDK clients
 * deliberately do not cross this boundary. A future producer must give both
 * approved source-family members the same admission-owned signal and deadline.
 */
export interface ReadProviderPositionChainAnchorEvidenceSourceRequestV1 {
  readonly sourceVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly observedAt: string;
  /** Canonical server evaluation time owned by the future producer. */
  readonly evaluatedAt: string;
  /** Exact bounded deadline shared by every source read for one assessment. */
  readonly deadlineAt: string;
  /** Exact admission-owned signal; an implementation must not substitute it. */
  readonly signal: AbortSignal;
}

/**
 * Structurally reviewed independent-source facts. Authenticity still requires
 * verifyAttestation; these fields alone are never evidence or authority.
 *
 * `currentHead` and `finalizedHead` are deliberately source-local. Only a
 * future two-source producer may compare them and derive migration 0029's
 * agreed heads. The proof digests bind chain identity, live source capability,
 * and the candidate-to-head lineage without exposing source secrets.
 */
export interface ProviderPositionChainAnchorEvidenceSourceAttestationV1 {
  readonly sourceVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly observedAt: string;
  readonly assessedAt: string;
  readonly currentHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly currentHeadAdvancedAt: string;
  readonly finalizedHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly finalizedHeadAdvancedAt: string;
  readonly identityProofSha256: string;
  readonly liveCapabilityProofSha256: string;
  readonly lineageProofSha256: string;
}

/**
 * Opaque independent-source read boundary. The implementation must bind each
 * issued capability to the exact request object, including signal and
 * deadline. Unissued capabilities, capability clones, and request clones must
 * verify false. This port registers no source and performs no I/O by itself.
 */
export interface ProviderPositionChainAnchorEvidenceSourcePort {
  readonly sourceVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION;
  readAttestation(
    request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): Promise<unknown>;
  verifyAttestation(
    capability: unknown,
    request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): boolean;
}
