import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import { MAINNET_LAUNCH_NETWORK_IDS } from '../../blockchain/domain/mainnet-launch-network-policy';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  type StablecoinPriceConfidence,
} from '../domain/stablecoin-valuation-policy';
import type { VerifiedStablecoinPriceEvidenceV1 } from './ports/verified-stablecoin-price-source.port';
import {
  createStablecoinPriceIngestionPlan,
  createVerifiedStablecoinPriceProjectionBatch,
  fingerprintVerifiedStablecoinPriceEvidence,
  normalizeVerifiedStablecoinPriceEvidence,
  StablecoinPriceIngestionPlanValidationError,
  type StablecoinPriceIngestionPlanV1,
  type StablecoinPriceLogicalReadV1,
  type VerifiedStablecoinPriceEvidenceMaterialV1,
} from './stablecoin-price-ingestion-plan';

const POLICY_DIGEST = '6c36c7bc78d70102c74255b9630f7a7e18e842e6daff52c9a73eed182121b7f3';
const POLICY_IDENTITY = Object.freeze({
  policyId: 'KAN-66',
  policyVersion: 1,
  policyDecisionSha256: POLICY_DIGEST,
} as const);

function plan(): StablecoinPriceIngestionPlanV1 {
  return createStablecoinPriceIngestionPlan(POLICY_IDENTITY);
}

function confidence(read: StablecoinPriceLogicalReadV1): StablecoinPriceConfidence {
  return read.sourceId === 'PYTH_CORE'
    ? { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '2500', scale: 8 }
    : { kind: 'NOT_PUBLISHED' };
}

function material(
  activePlan: StablecoinPriceIngestionPlanV1,
  read: StablecoinPriceLogicalReadV1,
  overrides: Partial<VerifiedStablecoinPriceEvidenceMaterialV1> = {},
): VerifiedStablecoinPriceEvidenceMaterialV1 {
  const sequence = String(100 + activePlan.logicalReads.indexOf(read));
  return {
    schemaVersion: 1,
    policyId: 'KAN-66',
    policyVersion: 1,
    policyDecisionSha256: POLICY_DIGEST,
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: activePlan.registryFingerprintSha256,
    sourceId: read.sourceId,
    sourceReference: read.sourceReference,
    stablecoin: read.stablecoin,
    authenticatedSourceUpdateId:
      read.sourceId === 'PYTH_CORE'
        ? `${String(activePlan.logicalReads.indexOf(read) + 1).padStart(2, '0')}${'a'.repeat(62)}`
        : sequence,
    monotonicSourceSequence: sequence,
    usdPrice: { mantissa: '99990000', scale: 8 },
    confidence: confidence(read),
    pricedAt: '2026-09-04T11:59:58.000Z',
    observedAt: '2026-09-04T12:00:00.000Z',
    verificationMethod: read.verificationMethod,
    verifiedAt: '2026-09-04T12:00:01.000Z',
    evidenceActorReferenceId:
      read.sourceId === 'PYTH_CORE'
        ? 'verified-pyth-source:mainnet-v1'
        : 'verified-chainlink-source:mainnet-v1',
    mayAuthorizeFinancialAction: false,
    ...overrides,
  };
}

function evidence(
  activePlan: StablecoinPriceIngestionPlanV1,
  read: StablecoinPriceLogicalReadV1,
  overrides: Partial<VerifiedStablecoinPriceEvidenceMaterialV1> = {},
): VerifiedStablecoinPriceEvidenceV1 {
  const candidate = material(activePlan, read, overrides);
  return {
    ...candidate,
    evidenceFingerprintSha256: fingerprintVerifiedStablecoinPriceEvidence(candidate),
  };
}

describe('stablecoin price ingestion plan', () => {
  it('defines exactly six logical source reads and twelve Ethereum/Solana projections', () => {
    const result = plan();

    expect(result).toMatchObject({
      schemaVersion: 1,
      policyIdentity: POLICY_IDENTITY,
      registryEnvironment: 'MAINNET',
      registryVersion: 1,
      registryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
      logicalReadCount: 6,
      projectionCount: 12,
      mayAuthorizeFinancialAction: false,
    });
    expect(result.logicalReads.map(({ sourceId, stablecoin }) => [sourceId, stablecoin])).toEqual([
      ['PYTH_CORE', 'USDC'],
      ['PYTH_CORE', 'USDT'],
      ['PYTH_CORE', 'PYUSD'],
      ['CHAINLINK_DATA_FEEDS', 'USDC'],
      ['CHAINLINK_DATA_FEEDS', 'USDT'],
      ['CHAINLINK_DATA_FEEDS', 'PYUSD'],
    ]);
    expect(new Set(result.logicalReads.map(({ readId }) => readId)).size).toBe(6);
    expect(new Set(result.projections.map(({ projectionId }) => projectionId)).size).toBe(12);
    expect(new Set(result.projections.map(({ asset }) => asset.networkId))).toEqual(
      new Set(MAINNET_LAUNCH_NETWORK_IDS),
    );
    expect(result.projections).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ asset: expect.objectContaining({ networkId: 'eip155:8453' }) }),
        expect.objectContaining({ asset: expect.objectContaining({ networkId: 'eip155:42161' }) }),
      ]),
    );
    for (const read of result.logicalReads) {
      expect(result.projections.filter(({ readId }) => readId === read.readId)).toHaveLength(2);
      expect(read.sourceReference).toBe(
        STABLECOIN_VALUATION_FEED_REFERENCES[read.stablecoin][read.sourceId],
      );
      expect(read.sourceReference).not.toMatch(/^https?:/u);
    }
  });

  it('is deeply immutable and contains the exact active launch asset identities', () => {
    const result = plan();

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.policyIdentity)).toBe(true);
    expect(Object.isFrozen(result.logicalReads)).toBe(true);
    expect(Object.isFrozen(result.projections)).toBe(true);
    for (const target of result.projections) {
      expect(Object.isFrozen(target)).toBe(true);
      expect(Object.isFrozen(target.asset)).toBe(true);
      expect(
        MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(
          target.asset.networkId,
          target.asset.identity,
        ),
      ).toMatchObject({
        stablecoin: target.asset.stablecoin,
        decimals: target.asset.decimals,
        activationState: 'ACTIVE',
      });
    }
  });

  it.each([
    ['wrong policy', { ...POLICY_IDENTITY, policyId: 'KAN-67' }],
    ['wrong version', { ...POLICY_IDENTITY, policyVersion: 2 }],
    ['uppercase digest', { ...POLICY_IDENTITY, policyDecisionSha256: POLICY_DIGEST.toUpperCase() }],
    ['extra field', { ...POLICY_IDENTITY, approved: true }],
  ])('rejects a %s identity instead of silently selecting policy', (_label, candidate) => {
    expect(() => createStablecoinPriceIngestionPlan(candidate)).toThrow(
      StablecoinPriceIngestionPlanValidationError,
    );
  });

  it('validates all bound evidence fields and returns immutable evidence', () => {
    const activePlan = plan();
    const read = activePlan.logicalReads[0];
    if (read === undefined) throw new Error('missing read fixture');
    const candidate = evidence(activePlan, read);

    const result = normalizeVerifiedStablecoinPriceEvidence(activePlan, read, candidate);

    expect(result).toEqual(candidate);
    expect(result.evidenceFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.mayAuthorizeFinancialAction).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.usdPrice)).toBe(true);
    expect(Object.isFrozen(result.confidence)).toBe(true);
  });

  it('requires source-specific authenticated update identifiers and confidence', () => {
    const activePlan = plan();
    const pyth = activePlan.logicalReads.find(({ sourceId }) => sourceId === 'PYTH_CORE');
    const chainlink = activePlan.logicalReads.find(
      ({ sourceId }) => sourceId === 'CHAINLINK_DATA_FEEDS',
    );
    if (pyth === undefined || chainlink === undefined) throw new Error('missing read fixture');

    expect(() =>
      fingerprintVerifiedStablecoinPriceEvidence(
        material(activePlan, pyth, { authenticatedSourceUpdateId: '100' }),
      ),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
    expect(() =>
      fingerprintVerifiedStablecoinPriceEvidence(
        material(activePlan, chainlink, {
          authenticatedSourceUpdateId: '999',
        }),
      ),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
    expect(() =>
      fingerprintVerifiedStablecoinPriceEvidence(
        material(activePlan, pyth, { confidence: { kind: 'NOT_PUBLISHED' } }),
      ),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
    expect(() =>
      fingerprintVerifiedStablecoinPriceEvidence(
        material(activePlan, chainlink, {
          confidence: { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '1', scale: 8 },
        }),
      ),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
  });

  it.each([
    ['policy digest', { policyDecisionSha256: 'b'.repeat(64) }],
    ['registry fingerprint', { registryFingerprintSha256: 'b'.repeat(64) }],
    ['source reference', { sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES.USDT.PYTH_CORE }],
    ['sequence zero', { monotonicSourceSequence: '0' }],
    ['sequence leading zero', { monotonicSourceSequence: '01' }],
    ['price leading zero', { usdPrice: { mantissa: '099990000', scale: 8 } }],
    ['wrong price scale', { usdPrice: { mantissa: '99990000', scale: 7 } }],
    ['priced after observation', { pricedAt: '2026-09-04T12:00:00.001Z' }],
    ['verified before observation', { verifiedAt: '2026-09-04T11:59:59.999Z' }],
    ['unreviewed actor', { evidenceActorReferenceId: 'https://secret.example/token' }],
    ['financial permission', { mayAuthorizeFinancialAction: true }],
  ])('rejects mismatched or malformed %s evidence', (_label, overrides) => {
    const activePlan = plan();
    const read = activePlan.logicalReads[0];
    if (read === undefined) throw new Error('missing read fixture');
    const candidate = { ...material(activePlan, read), ...overrides };
    const fullCandidate = {
      ...candidate,
      evidenceFingerprintSha256: 'a'.repeat(64),
    };

    expect(() => normalizeVerifiedStablecoinPriceEvidence(activePlan, read, fullCandidate)).toThrow(
      StablecoinPriceIngestionPlanValidationError,
    );
  });

  it('detects post-verification mutation because the fingerprint binds every field', () => {
    const activePlan = plan();
    const read = activePlan.logicalReads[0];
    if (read === undefined) throw new Error('missing read fixture');
    const candidate = evidence(activePlan, read);

    expect(() =>
      normalizeVerifiedStablecoinPriceEvidence(activePlan, read, {
        ...candidate,
        verifiedAt: '2026-09-04T12:00:02.000Z',
      }),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
  });

  it('rejects extra, accessor, and custom-prototype evidence', () => {
    const activePlan = plan();
    const read = activePlan.logicalReads[0];
    if (read === undefined) throw new Error('missing read fixture');
    const candidate = evidence(activePlan, read);
    const accessor = { ...candidate } as Record<string, unknown>;
    Object.defineProperty(accessor, 'verifiedAt', {
      enumerable: true,
      get: () => '2026-09-04T12:00:01.000Z',
    });

    for (const invalidCandidate of [
      { ...candidate, unexpected: true },
      accessor,
      Object.assign(Object.create({ inherited: true }) as object, candidate),
    ]) {
      expect(() =>
        normalizeVerifiedStablecoinPriceEvidence(activePlan, read, invalidCandidate),
      ).toThrow(StablecoinPriceIngestionPlanValidationError);
    }
  });

  it('turns exactly six verified logical results into twelve immutable projections', () => {
    const activePlan = plan();
    const candidates = activePlan.logicalReads.map((read) => evidence(activePlan, read)).reverse();

    const batch = createVerifiedStablecoinPriceProjectionBatch(activePlan, candidates);

    expect(batch).toMatchObject({
      schemaVersion: 1,
      policyIdentity: POLICY_IDENTITY,
      registryEnvironment: 'MAINNET',
      registryVersion: 1,
      evidenceCount: 6,
      projectionCount: 12,
      mayAuthorizeFinancialAction: false,
    });
    expect(batch.projections).toHaveLength(12);
    expect(batch.projections.map(({ projectionId }) => projectionId)).toEqual(
      activePlan.projections.map(({ projectionId }) => projectionId),
    );
    expect(
      batch.projections.every(({ mayAuthorizeFinancialAction }) => !mayAuthorizeFinancialAction),
    ).toBe(true);
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.projections)).toBe(true);
    expect(batch.projections.every((projection) => Object.isFrozen(projection))).toBe(true);
  });

  it('rejects duplicate, missing, and surplus evidence sets', () => {
    const activePlan = plan();
    const candidates = activePlan.logicalReads.map((read) => evidence(activePlan, read));
    const first = candidates[0];
    if (first === undefined) throw new Error('missing evidence fixture');

    expect(() =>
      createVerifiedStablecoinPriceProjectionBatch(activePlan, [
        first,
        first,
        ...candidates.slice(2),
      ]),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
    expect(() =>
      createVerifiedStablecoinPriceProjectionBatch(activePlan, candidates.slice(0, 5)),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
    expect(() =>
      createVerifiedStablecoinPriceProjectionBatch(activePlan, [...candidates, first]),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
  });

  it('rejects caller-fabricated plan objects', () => {
    const activePlan = plan();
    const read = activePlan.logicalReads[0];
    if (read === undefined) throw new Error('missing read fixture');

    expect(() =>
      normalizeVerifiedStablecoinPriceEvidence(
        { ...activePlan } as StablecoinPriceIngestionPlanV1,
        read,
        evidence(activePlan, read),
      ),
    ).toThrow(StablecoinPriceIngestionPlanValidationError);
  });
});
