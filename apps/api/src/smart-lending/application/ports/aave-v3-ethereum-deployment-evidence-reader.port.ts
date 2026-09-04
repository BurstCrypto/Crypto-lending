export const AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_READER = Symbol(
  'AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_READER',
);

export interface ReadAaveV3EthereumDeploymentEvidenceRequest {
  /** Trusted server timestamp; implementations must not substitute a caller-authored clock. */
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

export interface AaveV3EthereumFinalizedBlockEvidence {
  readonly number: bigint;
  readonly hash: `0x${string}`;
  readonly parentHash: `0x${string}`;
  readonly stateRoot: `0x${string}`;
  readonly timestamp: string;
}

export interface AaveV3EthereumObservedRuntimeCodeHashes {
  readonly poolAddressesProvider: `0x${string}`;
  readonly poolProxy: `0x${string}`;
  readonly poolImplementation: `0x${string}`;
  readonly protocolDataProvider: `0x${string}`;
  readonly usdcAToken: `0x${string}`;
  readonly usdcVariableDebtToken: `0x${string}`;
  readonly usdtAToken: `0x${string}`;
  readonly usdtVariableDebtToken: `0x${string}`;
}

export interface AaveV3EthereumReserveTokenEvidence {
  readonly underlyingAsset: `0x${string}`;
  readonly aToken: `0x${string}`;
  readonly stableDebtToken: `0x${string}`;
  readonly variableDebtToken: `0x${string}`;
}

/**
 * A single, read-only RPC observation of the pinned Aave deployment. It is
 * deliberately unable to establish recommendation eligibility or authorize a
 * financial action until the remaining provider, checkpoint, code-approval,
 * and independent-source gates are implemented and approved.
 */
export interface AaveV3EthereumDeploymentEvidence {
  readonly schemaVersion: 1;
  readonly sourceId: 'AAVE_V3_ETHEREUM_FINALIZED_RPC';
  readonly use: 'DEPLOYMENT_CORROBORATION_ONLY';
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly networkId: 'eip155:1';
  readonly chainId: '0x1';
  readonly blockSelector: 'finalized';
  readonly blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL';
  readonly observedChainIdentityMatchesPolicy: true;
  readonly manifestBindingValidated: true;
  readonly observedDeploymentTopologyMatchesManifest: true;
  readonly blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED';
  readonly runtimeCodeApprovalStatus: 'UNVERIFIED';
  readonly sourceProviderApproved: false;
  readonly exactHostEgressApproved: false;
  readonly liveCapabilityProofValidated: false;
  readonly independentFinalizedSourcesAgree: false;
  readonly freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT';
  readonly finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF';
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly deploymentManifestFingerprintSha256: string;
  readonly assetRegistryFingerprintSha256: string;
  readonly readPlanFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly evidenceId: string;
  readonly observedAt: string;
  readonly finalizedBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly runtimeCodeKeccak256: AaveV3EthereumObservedRuntimeCodeHashes;
  readonly reserves: Readonly<{
    USDC: AaveV3EthereumReserveTokenEvidence;
    USDT: AaveV3EthereumReserveTokenEvidence;
  }>;
}

export interface AaveV3EthereumDeploymentEvidenceReader {
  readCurrentDeploymentEvidence(
    request: ReadAaveV3EthereumDeploymentEvidenceRequest,
  ): Promise<AaveV3EthereumDeploymentEvidence>;
}
