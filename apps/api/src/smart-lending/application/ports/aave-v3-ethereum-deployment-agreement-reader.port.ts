import type {
  AaveV3EthereumFinalizedBlockEvidence,
  ReadAaveV3EthereumDeploymentEvidenceRequest,
} from './aave-v3-ethereum-deployment-evidence-reader.port';

export const AAVE_V3_ETHEREUM_DEPLOYMENT_AGREEMENT_READER = Symbol(
  'AAVE_V3_ETHEREUM_DEPLOYMENT_AGREEMENT_READER',
);

export type AaveV3EthereumDeploymentPayloadComparisonStatus =
  | 'EXACT_PAYLOAD_MATCH'
  | 'BLOCKED_SOURCE_ALIAS_REUSE'
  | 'BLOCKED_NOT_ALIGNED'
  | 'QUARANTINED_FINALIZED_HEADER_DIVERGENCE'
  | 'QUARANTINED_DEPLOYMENT_STATE_DIVERGENCE';

export interface AaveV3EthereumComparedSourceEvidence {
  readonly role: 'PRIMARY_CANDIDATE' | 'CORROBORATING_CANDIDATE';
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly evidenceFingerprintSha256: string;
  readonly evidenceId: string;
  readonly deploymentStateFingerprintSha256: string;
  readonly finalizedBlock: AaveV3EthereumFinalizedBlockEvidence;
}

/**
 * A code-side comparison of two separately read, validated payloads. Even an
 * exact match is corroboration only: source/provider independence, egress,
 * live capability, code approval, checkpoint freshness, and finality remain
 * separate externally approved gates.
 */
export interface AaveV3EthereumDeploymentAgreementDecision {
  readonly schemaVersion: 1;
  readonly sourceId: 'AAVE_V3_ETHEREUM_TWO_SOURCE_COMPARISON';
  readonly use: 'DEPLOYMENT_CORROBORATION_ONLY';
  readonly comparisonStatus: AaveV3EthereumDeploymentPayloadComparisonStatus;
  readonly quarantineRequired: boolean;
  readonly sourcePairProviderApprovalStatus: 'UNVERIFIED';
  readonly sourcePairEgressApprovalStatus: 'UNVERIFIED';
  readonly sourcePairLiveCapabilityProofStatus: 'UNVERIFIED';
  readonly sourcePairIndependenceStatus: 'UNVERIFIED_WITHOUT_APPROVED_PAIR_BINDING';
  readonly blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED';
  readonly runtimeCodeApprovalStatus: 'UNVERIFIED';
  readonly freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT';
  readonly finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF';
  readonly independentFinalizedSourcesAgree: false;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly networkId: 'eip155:1';
  readonly chainId: '0x1';
  readonly correlationId: string;
  readonly evaluatedAt: string;
  readonly deploymentManifestFingerprintSha256: string;
  readonly assetRegistryFingerprintSha256: string;
  readonly readPlanFingerprintSha256: string;
  readonly primary: AaveV3EthereumComparedSourceEvidence;
  readonly corroborating: AaveV3EthereumComparedSourceEvidence;
  readonly matchedDeploymentStateFingerprintSha256: string | null;
  readonly comparisonFingerprintSha256: string;
  readonly comparisonId: string;
}

export interface AaveV3EthereumDeploymentAgreementReader {
  readDeploymentAgreement(
    request: ReadAaveV3EthereumDeploymentEvidenceRequest,
  ): Promise<AaveV3EthereumDeploymentAgreementDecision>;
}
