import { randomUUID } from 'node:crypto';

import type {
  AaveV3EthereumCheckpointRecoveryAuthorization,
  AaveV3EthereumHistoricalDeploymentAgreement,
  AaveV3EthereumHistoricalDeploymentObservation,
  RecoverAaveV3EthereumFinalizedCheckpointRequest,
} from '../application/ports/aave-v3-ethereum-finalized-checkpoint.port';
import type {
  AaveV3EthereumFinalizedBlockEvidence,
  AaveV3EthereumObservedRuntimeCodeHashes,
} from '../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT } from './aave-v3-ethereum-deployment-evidence-fingerprint';
import {
  AAVE_V3_ETHEREUM_HISTORICAL_RECOVERY_READ_PLAN_FINGERPRINT_SHA256,
  AAVE_V3_ETHEREUM_MAXIMUM_RECOVERY_LINEAGE_BLOCKS,
  AaveV3EthereumFinalizedCheckpointRecoveryValidationError,
  fingerprintAaveV3EthereumCheckpointRecoveryAuthorization,
  fingerprintAaveV3EthereumHistoricalDeploymentObservation,
  normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand,
  type AaveV3EthereumHistoricalObservationFingerprintMaterial,
  type AaveV3EthereumRecoveryAuthorizationFingerprintMaterial,
} from './aave-v3-ethereum-finalized-checkpoint-recovery';
import {
  AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING,
  aaveV3EthereumCheckpointContentFingerprintFromDeploymentFact,
} from './aave-v3-ethereum-finalized-checkpoint';

type Hash = `0x${string}`;

const PRIMARY_SOURCE = 'rpc-primary:ethereum-mainnet';
const CORROBORATING_SOURCE = 'rpc-secondary:ethereum-mainnet';
const QUARANTINED_AT = '2026-09-04T12:00:00.000Z';
const ISSUED_AT = '2026-09-04T12:01:00.000Z';
const EXPIRES_AT = '2026-09-04T12:10:00.000Z';
const EVALUATED_AT = '2026-09-04T12:05:00.000Z';

function hash(byte: number): Hash {
  return `0x${byte.toString(16).padStart(2, '0').repeat(32)}`;
}

function header(
  number: bigint,
  blockHash: Hash,
  parentHash: Hash,
  timestamp: string,
  stateRoot: Hash = hash(Number(number % 200n) + 30),
): AaveV3EthereumFinalizedBlockEvidence {
  return { number, hash: blockHash, parentHash, stateRoot, timestamp };
}

const LAST_GOOD = header(
  20_000_100n,
  hash(0x64),
  hash(0x63),
  '2026-09-04T11:57:00.000Z',
  hash(0x84),
);
const FIRST = header(
  20_000_101n,
  hash(0x65),
  LAST_GOOD.hash,
  '2026-09-04T11:57:12.000Z',
  hash(0x85),
);
const TARGET = header(20_000_102n, hash(0x66), FIRST.hash, '2026-09-04T11:57:24.000Z', hash(0x86));
const CODE: AaveV3EthereumObservedRuntimeCodeHashes = {
  poolAddressesProvider: hash(0x41),
  poolProxy: hash(0x42),
  poolImplementation: hash(0x43),
  protocolDataProvider: hash(0x44),
  usdcAToken: hash(0x45),
  usdcVariableDebtToken: hash(0x46),
  usdtAToken: hash(0x47),
  usdtVariableDebtToken: hash(0x48),
};

interface ObservationOptions {
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly historicalBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly finalizedAnchor?: AaveV3EthereumFinalizedBlockEvidence;
  readonly observedAt?: string;
  readonly runtimeCodeKeccak256?: AaveV3EthereumObservedRuntimeCodeHashes;
  readonly reserves?: AaveV3EthereumHistoricalDeploymentObservation['reserves'];
}

function observation(options: ObservationOptions): AaveV3EthereumHistoricalDeploymentObservation {
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  const material: AaveV3EthereumHistoricalObservationFingerprintMaterial = {
    schemaVersion: 1,
    sourceId: 'AAVE_V3_ETHEREUM_HISTORICAL_FINALIZED_LINEAGE_RPC',
    use: 'CHECKPOINT_LINEAGE_REPAIR_ONLY',
    mayEstablishRecommendationEligibility: false,
    mayAuthorizeFinancialAction: false,
    deploymentId: 'AAVE_V3_ETHEREUM',
    networkId: 'eip155:1',
    chainId: '0x1',
    finalizedAnchorSelector: 'finalized',
    historicalBlockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    sourceReferenceId: options.sourceReferenceId,
    sourceObservationId: options.sourceObservationId,
    deploymentManifestFingerprintSha256: binding.deploymentManifestFingerprintSha256,
    assetRegistryFingerprintSha256: binding.assetRegistryFingerprintSha256,
    historicalReadPlanFingerprintSha256:
      AAVE_V3_ETHEREUM_HISTORICAL_RECOVERY_READ_PLAN_FINGERPRINT_SHA256,
    observedAt: options.observedAt ?? '2026-09-04T12:02:00.000Z',
    finalizedAnchor: options.finalizedAnchor ?? TARGET,
    historicalBlock: options.historicalBlock,
    runtimeCodeKeccak256: options.runtimeCodeKeccak256 ?? CODE,
    reserves: options.reserves ?? AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.reserves,
  };
  const fingerprint = fingerprintAaveV3EthereumHistoricalDeploymentObservation(material);
  return {
    ...material,
    evidenceFingerprintSha256: fingerprint,
    evidenceId: `aave-v3-ethereum-historical-lineage:${fingerprint}`,
  };
}

function agreement(
  historicalBlock: AaveV3EthereumFinalizedBlockEvidence,
  sequence: number,
  overrides: Readonly<{
    primary?: Partial<ObservationOptions>;
    corroborating?: Partial<ObservationOptions>;
  }> = {},
): AaveV3EthereumHistoricalDeploymentAgreement {
  return {
    primary: observation({
      sourceReferenceId: PRIMARY_SOURCE,
      sourceObservationId: `rpc-observation:primary-${sequence}`,
      historicalBlock,
      ...overrides.primary,
    }),
    corroborating: observation({
      sourceReferenceId: CORROBORATING_SOURCE,
      sourceObservationId: `rpc-observation:corroborating-${sequence}`,
      historicalBlock,
      observedAt: '2026-09-04T12:02:05.000Z',
      ...overrides.corroborating,
    }),
  };
}

function authorization(
  overrides: Partial<AaveV3EthereumRecoveryAuthorizationFingerprintMaterial> = {},
): AaveV3EthereumCheckpointRecoveryAuthorization {
  const material: AaveV3EthereumRecoveryAuthorizationFingerprintMaterial = {
    schemaVersion: 1,
    authorizationType: 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_LINEAGE_REPAIR',
    scope: 'CHECKPOINT_LINEAGE_REPAIR_ONLY',
    mayAuthorizeFinancialAction: false,
    operation: 'QUARANTINE_RECOVERY',
    deploymentId: 'AAVE_V3_ETHEREUM',
    networkId: 'eip155:1',
    sourceReferenceId: PRIMARY_SOURCE,
    corroboratingSourceReferenceId: CORROBORATING_SOURCE,
    authorizedByReferenceId: 'operations-approver:incident-2026-09-04',
    sourcePairIndependenceApprovalId: 'source-pair-approval:ethereum-mainnet-2026-09',
    expectedRevision: 2,
    expectedStatus: 'QUARANTINED',
    expectedQuarantineReason: 'FINALIZED_PARENT_MISMATCH',
    expectedQuarantinedAt: QUARANTINED_AT,
    expectedLastValidatedAt: QUARANTINED_AT,
    expectedLastGoodBlock: LAST_GOOD,
    expectedLastGoodContentFingerprintSha256:
      aaveV3EthereumCheckpointContentFingerprintFromDeploymentFact({
        finalizedBlock: LAST_GOOD,
        runtimeCodeKeccak256: CODE,
        reserves: AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.reserves,
      }),
    recoverThroughBlock: { number: TARGET.number, hash: TARGET.hash },
    reasonCode: 'RESTORE_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE',
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    nonce: '550e8400-e29b-41d4-a716-446655440010',
    ...overrides,
  };
  const fingerprint = fingerprintAaveV3EthereumCheckpointRecoveryAuthorization(material);
  return {
    ...material,
    authorizationFingerprintSha256: fingerprint,
    authorizationId: `aave-v3-ethereum-checkpoint-lineage-repair:${fingerprint}`,
  };
}

function request(
  overrides: Partial<RecoverAaveV3EthereumFinalizedCheckpointRequest> = {},
): RecoverAaveV3EthereumFinalizedCheckpointRequest {
  return {
    evaluatedAt: EVALUATED_AT,
    recoveryId: '550e8400-e29b-41d4-a716-446655440011',
    authorization: authorization(),
    lineage: [agreement(FIRST, 1), agreement(TARGET, 2)],
    ...overrides,
  };
}

describe('Aave V3 Ethereum finalized checkpoint recovery domain', () => {
  it('normalizes a bounded, independently approved, full-fact lineage', () => {
    const normalized = normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(request());

    expect(normalized).toMatchObject({
      sourceReferenceId: PRIMARY_SOURCE,
      corroboratingSourceReferenceId: CORROBORATING_SOURCE,
      expectedRevision: 2,
      expectedStatus: 'QUARANTINED',
      expectedQuarantineReason: 'FINALIZED_PARENT_MISMATCH',
      recoverThroughBlock: TARGET,
      lineage: [
        { sequence: 1, block: FIRST },
        { sequence: 2, block: TARGET },
      ],
    });
    expect(normalized.commandFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.parse(normalized.serializedLineage)).toHaveLength(2);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.lineage)).toBe(true);
    expect(Object.isFrozen(normalized.lineage[0]?.block)).toBe(true);
  });

  it('normalizes an active-head continuity backfill as a distinct operation', () => {
    const backfillAuthorization = authorization({
      operation: 'CONTINUITY_BACKFILL',
      expectedRevision: 1,
      expectedStatus: 'ACTIVE',
      expectedQuarantineReason: null,
      expectedQuarantinedAt: null,
      expectedLastValidatedAt: '2026-09-04T11:59:00.000Z',
      reasonCode: 'BACKFILL_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE',
    });

    expect(
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(
        request({ authorization: backfillAuthorization }),
      ),
    ).toMatchObject({
      operation: 'CONTINUITY_BACKFILL',
      expectedRevision: 1,
      expectedStatus: 'ACTIVE',
      expectedQuarantineReason: null,
      expectedQuarantinedAt: null,
    });
  });

  it('rejects a source alias even when the payloads match', () => {
    const aliasedAuthorization = authorization({
      corroboratingSourceReferenceId: PRIMARY_SOURCE,
    });
    expect(() =>
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(
        request({ authorization: aliasedAuthorization }),
      ),
    ).toThrow(AaveV3EthereumFinalizedCheckpointRecoveryValidationError);
  });

  it.each([
    {
      name: 'header divergence',
      lineage: [
        agreement(FIRST, 1, {
          corroborating: {
            historicalBlock: { ...FIRST, stateRoot: hash(0xee) },
          },
        }),
        agreement(TARGET, 2),
      ],
    },
    {
      name: 'runtime-code divergence',
      lineage: [
        agreement(FIRST, 1, {
          corroborating: {
            runtimeCodeKeccak256: { ...CODE, poolProxy: hash(0xee) },
          },
        }),
        agreement(TARGET, 2),
      ],
    },
    {
      name: 'reserve-topology divergence',
      lineage: [
        agreement(FIRST, 1, {
          corroborating: {
            reserves: {
              ...AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.reserves,
              USDC: {
                ...AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.reserves.USDC,
                aToken: `0x${'ef'.repeat(20)}`,
              },
            },
          },
        }),
        agreement(TARGET, 2),
      ],
    },
    {
      name: 'broken parent continuity',
      lineage: [agreement({ ...FIRST, parentHash: hash(0xee) }, 1), agreement(TARGET, 2)],
    },
    {
      name: 'target not the finalized anchor',
      lineage: [
        agreement(FIRST, 1),
        agreement(TARGET, 2, {
          primary: { finalizedAnchor: { ...TARGET, hash: hash(0xee) } },
          corroborating: { finalizedAnchor: { ...TARGET, hash: hash(0xee) } },
        }),
      ],
    },
    {
      name: 'reused source observation',
      lineage: [
        agreement(FIRST, 1),
        agreement(TARGET, 2, {
          primary: { sourceObservationId: 'rpc-observation:primary-1' },
        }),
      ],
    },
  ])('rejects $name', ({ lineage }) => {
    expect(() =>
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(request({ lineage })),
    ).toThrow(AaveV3EthereumFinalizedCheckpointRecoveryValidationError);
  });

  it.each([
    {
      name: 'expired at evaluation',
      evaluatedAt: '2026-09-04T12:10:00.000Z',
      authorization: authorization(),
    },
    {
      name: 'authorization issued before quarantine',
      evaluatedAt: EVALUATED_AT,
      authorization: authorization({ issuedAt: '2026-09-04T11:59:59.999Z' }),
    },
    {
      name: 'authorization valid for too long',
      evaluatedAt: EVALUATED_AT,
      authorization: authorization({ expiresAt: '2026-09-04T12:16:00.001Z' }),
    },
  ])('rejects $name', ({ authorization: candidate, evaluatedAt }) => {
    expect(() =>
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(
        request({ authorization: candidate, evaluatedAt }),
      ),
    ).toThrow(AaveV3EthereumFinalizedCheckpointRecoveryValidationError);
  });

  it('rejects a lineage or authorization wider than the fixed 64-block ceiling', () => {
    const targetNumber =
      LAST_GOOD.number + BigInt(AAVE_V3_ETHEREUM_MAXIMUM_RECOVERY_LINEAGE_BLOCKS) + 1n;
    const tooWide = authorization({
      recoverThroughBlock: { number: targetNumber, hash: hash(0xf0) },
    });

    expect(() =>
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(
        request({ authorization: tooWide }),
      ),
    ).toThrow(AaveV3EthereumFinalizedCheckpointRecoveryValidationError);
  });

  it('rejects tampered authorization fields and authority expansion', () => {
    const valid = authorization();
    const tampered = {
      ...valid,
      expectedRevision: 3,
      mayAuthorizeFinancialAction: true,
    } as unknown as AaveV3EthereumCheckpointRecoveryAuthorization;

    expect(() =>
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(
        request({ authorization: tampered }),
      ),
    ).toThrow(AaveV3EthereumFinalizedCheckpointRecoveryValidationError);
  });

  it('rejects a self-consistent fingerprint over a mismatched operation and head status', () => {
    const mismatched = authorization({
      operation: 'CONTINUITY_BACKFILL',
      reasonCode: 'BACKFILL_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE',
    });

    expect(() =>
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(
        request({ authorization: mismatched }),
      ),
    ).toThrow(AaveV3EthereumFinalizedCheckpointRecoveryValidationError);
  });

  it('rejects surplus fields, getters, and non-data-record inputs', () => {
    const withSurplus = { ...request(), unexpected: true };
    const withGetter = Object.defineProperty({ ...request() }, 'lineage', {
      enumerable: true,
      get: () => request().lineage,
    });
    const withPrototype = Object.assign(Object.create({ inherited: true }), request());

    for (const candidate of [withSurplus, withGetter, withPrototype]) {
      expect(() =>
        normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(
          candidate as RecoverAaveV3EthereumFinalizedCheckpointRequest,
        ),
      ).toThrow(AaveV3EthereumFinalizedCheckpointRecoveryValidationError);
    }
  });

  it('binds fingerprints to source observations, full facts, and the exact head', () => {
    const first = request();
    const second = request({
      recoveryId: randomUUID(),
      authorization: authorization({
        expectedLastGoodBlock: { ...LAST_GOOD, stateRoot: hash(0xef) },
      }),
    });

    expect(
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(first).commandFingerprintSha256,
    ).not.toBe(
      normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(second).commandFingerprintSha256,
    );
  });
});
