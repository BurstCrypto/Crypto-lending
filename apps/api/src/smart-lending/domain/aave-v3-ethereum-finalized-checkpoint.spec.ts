import type { AaveV3EthereumDeploymentEvidence } from '../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from '../infrastructure/aave/aave-v3-ethereum-deployment.manifest';
import { fingerprintAaveV3EthereumDeploymentEvidence } from './aave-v3-ethereum-deployment-evidence-fingerprint';
import {
  AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING,
  AaveV3EthereumFinalizedCheckpointValidationError,
  aaveV3EthereumCheckpointContentFingerprint,
  normalizeAaveV3EthereumFinalizedCheckpointCommand,
} from './aave-v3-ethereum-finalized-checkpoint';

const HASH = `0x${'11'.repeat(32)}` as const;
const PARENT_HASH = `0x${'22'.repeat(32)}` as const;
const STATE_ROOT = `0x${'33'.repeat(32)}` as const;
const CODE_HASH = `0x${'44'.repeat(32)}` as const;
const EVIDENCE_FINGERPRINT = '55'.repeat(32);

function evidence(
  overrides: Partial<AaveV3EthereumDeploymentEvidence> = {},
): AaveV3EthereumDeploymentEvidence {
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  const manifest = AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST;
  const candidate: AaveV3EthereumDeploymentEvidence = {
    schemaVersion: 1,
    sourceId: 'AAVE_V3_ETHEREUM_FINALIZED_RPC',
    use: 'DEPLOYMENT_CORROBORATION_ONLY',
    mayEstablishRecommendationEligibility: false,
    mayAuthorizeFinancialAction: false,
    networkId: 'eip155:1',
    chainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    observedChainIdentityMatchesPolicy: true,
    manifestBindingValidated: true,
    observedDeploymentTopologyMatchesManifest: true,
    blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED',
    runtimeCodeApprovalStatus: 'UNVERIFIED',
    sourceProviderApproved: false,
    exactHostEgressApproved: false,
    liveCapabilityProofValidated: false,
    independentFinalizedSourcesAgree: false,
    freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
    finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
    sourceReferenceId: 'rpc-primary:ethereum-mainnet',
    sourceObservationId: 'rpc-observation:00000001',
    deploymentManifestFingerprintSha256: binding.deploymentManifestFingerprintSha256,
    assetRegistryFingerprintSha256: binding.assetRegistryFingerprintSha256,
    readPlanFingerprintSha256: binding.readPlanFingerprintSha256,
    evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
    evidenceId: `aave-v3-ethereum-deployment:${EVIDENCE_FINGERPRINT}`,
    observedAt: '2026-09-04T12:00:00.000Z',
    finalizedBlock: {
      number: 20_000_000n,
      hash: HASH,
      parentHash: PARENT_HASH,
      stateRoot: STATE_ROOT,
      timestamp: '2026-09-04T11:59:00.000Z',
    },
    runtimeCodeKeccak256: {
      poolAddressesProvider: CODE_HASH,
      poolProxy: CODE_HASH,
      poolImplementation: CODE_HASH,
      protocolDataProvider: CODE_HASH,
      usdcAToken: CODE_HASH,
      usdcVariableDebtToken: CODE_HASH,
      usdtAToken: CODE_HASH,
      usdtVariableDebtToken: CODE_HASH,
    },
    reserves: {
      USDC: {
        underlyingAsset: manifest.assets.USDC.underlyingAsset.toLowerCase() as `0x${string}`,
        aToken: manifest.assets.USDC.aToken.toLowerCase() as `0x${string}`,
        stableDebtToken: `0x${'0'.repeat(40)}`,
        variableDebtToken: manifest.assets.USDC.variableDebtToken.toLowerCase() as `0x${string}`,
      },
      USDT: {
        underlyingAsset: manifest.assets.USDT.underlyingAsset.toLowerCase() as `0x${string}`,
        aToken: manifest.assets.USDT.aToken.toLowerCase() as `0x${string}`,
        stableDebtToken: `0x${'0'.repeat(40)}`,
        variableDebtToken: manifest.assets.USDT.variableDebtToken.toLowerCase() as `0x${string}`,
      },
    },
    ...overrides,
  };
  if (
    Object.hasOwn(overrides, 'evidenceFingerprintSha256') ||
    Object.hasOwn(overrides, 'evidenceId')
  ) {
    return candidate;
  }
  const fingerprint = fingerprintAaveV3EthereumDeploymentEvidence(candidate, candidate.observedAt);
  return {
    ...candidate,
    evidenceFingerprintSha256: fingerprint,
    evidenceId: `aave-v3-ethereum-deployment:${fingerprint}`,
  };
}

function invalidEvidence(
  overrides: Partial<AaveV3EthereumDeploymentEvidence>,
): AaveV3EthereumDeploymentEvidence {
  return { ...evidence(), ...overrides };
}

describe('Aave V3 Ethereum finalized checkpoint domain', () => {
  it('creates a source-independent content fingerprint over the complete deployment fact', () => {
    const primary = evidence();
    const alternate = evidence({
      sourceReferenceId: 'rpc-secondary:ethereum-mainnet',
      sourceObservationId: 'rpc-observation:00000002',
      observedAt: '2026-09-04T12:00:10.000Z',
      evidenceFingerprintSha256: '66'.repeat(32),
      evidenceId: `aave-v3-ethereum-deployment:${'66'.repeat(32)}`,
    });

    expect(aaveV3EthereumCheckpointContentFingerprint(primary)).toBe(
      aaveV3EthereumCheckpointContentFingerprint(alternate),
    );
    expect(aaveV3EthereumCheckpointContentFingerprint(primary)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('changes the content fingerprint when a block-bound deployment fact changes', () => {
    const changed = evidence({
      runtimeCodeKeccak256: {
        ...evidence().runtimeCodeKeccak256,
        poolProxy: `0x${'77'.repeat(32)}`,
      },
    });

    expect(aaveV3EthereumCheckpointContentFingerprint(changed)).not.toBe(
      aaveV3EthereumCheckpointContentFingerprint(evidence()),
    );
  });

  it('normalizes a revision-bound idempotent command without adding authority', () => {
    const inputEvidence = evidence();
    const normalized = normalizeAaveV3EthereumFinalizedCheckpointCommand({
      expectedRevision: 7,
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      evidence: inputEvidence,
    });

    expect(normalized).toMatchObject({
      expectedRevision: 7,
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      sourceReferenceId: 'rpc-primary:ethereum-mainnet',
      sourceObservationId: 'rpc-observation:00000001',
      evidenceFingerprintSha256: inputEvidence.evidenceFingerprintSha256,
      observedAt: '2026-09-04T12:00:00.000Z',
      finalizedBlock: { number: 20_000_000n, hash: HASH },
    });
    expect(normalized.contentFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(normalized.commandFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.finalizedBlock)).toBe(true);
  });

  it.each([
    { expectedRevision: 0 },
    { correlationId: 'not-a-uuid' },
    { evidence: invalidEvidence({ mayAuthorizeFinancialAction: true as false }) },
    { evidence: invalidEvidence({ networkId: 'eip155:8453' as 'eip155:1' }) },
    {
      evidence: invalidEvidence({
        finalizedBlock: { ...evidence().finalizedBlock, number: 0n },
      }),
    },
    {
      evidence: invalidEvidence({
        finalizedBlock: {
          ...evidence().finalizedBlock,
          timestamp: '2026-09-04T12:01:00.000Z',
        },
      }),
    },
  ])('rejects invalid or authority-expanded checkpoint input %#', (override) => {
    expect(() =>
      normalizeAaveV3EthereumFinalizedCheckpointCommand({
        expectedRevision: null,
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
        evidence: evidence(),
        ...override,
      }),
    ).toThrow(AaveV3EthereumFinalizedCheckpointValidationError);
  });
});
