import type { AccountId } from '../../../accounts/domain/account-profile';
import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../../domain/mainnet-provider-position-chain-assessment';
import type { MainnetProviderPositionSourceKind } from '../../domain/mainnet-provider-position-observation-policy';

export const PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION = 1 as const;
export const PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE =
  'DORMANT_PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ONLY' as const;
export const PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE =
  'DORMANT_PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_ONLY' as const;
export type ProviderPositionDurableChainAnchorNetworkId = MainnetLaunchNetworkId;

/**
 * Exact read-only query for independently persisted Ethereum-mainnet or
 * Solana-mainnet chain identity, progression, and finality state.
 */
export interface ReadProviderPositionDurableChainAnchorRequestV1 {
  readonly readerVersion: typeof PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION;
  readonly use: typeof PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly candidateFingerprintSha256: string;
  readonly targetId: string;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly networkId: ProviderPositionDurableChainAnchorNetworkId;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly observedAt: string;
  /** Canonical server snapshot time; assessedAt must not be later than this. */
  readonly capturedAt: string;
  readonly evaluatedAt: string;
  readonly deadlineAt: string;
  /** The exact admission-owned signal; readers must not substitute a signal. */
  readonly signal: AbortSignal;
}

/** Structurally reviewed data; authenticity still requires verifyAnchor. */
export interface ProviderPositionDurableChainAnchorAssessmentV1 {
  readonly readerVersion: typeof PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION;
  readonly use: typeof PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly networkId: ProviderPositionDurableChainAnchorNetworkId;
  readonly continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly assessedAt: string;
  readonly identityStatus: 'VERIFIED';
  readonly progressionStatus: 'CURRENT';
  readonly finalityStatus: 'HEALTHY';
}

/**
 * Durable read boundary only. A concrete reader owns storage/chain semantics
 * and must bind its opaque returned capability to the exact request identity.
 * Consumers authenticate that identity before inspecting returned properties;
 * unissued capabilities and capability/request clones must verify false.
 */
export interface ProviderPositionDurableChainAnchorReaderPort {
  readonly readerVersion: typeof PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION;
  readAnchor(request: ReadProviderPositionDurableChainAnchorRequestV1): Promise<unknown>;
  verifyAnchor(
    capability: unknown,
    request: ReadProviderPositionDurableChainAnchorRequestV1,
  ): boolean;
}
