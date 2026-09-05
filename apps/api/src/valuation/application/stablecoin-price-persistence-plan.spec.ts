import type { StablecoinValuationSourceId } from '../domain/stablecoin-valuation-policy';
import type {
  MainnetStablecoin,
  VerifiedStablecoinPriceEvidenceV1,
  VerifiedStablecoinPriceSourcePort,
} from './ports/verified-stablecoin-price-source.port';
import {
  assertCanonicalVerifiedStablecoinPriceProjectionBatch,
  createStablecoinPriceIngestionPlan,
  createVerifiedStablecoinPriceProjectionBatch,
  fingerprintVerifiedStablecoinPriceEvidence,
  type StablecoinPriceIngestionPlanV1,
  type StablecoinPriceLogicalReadV1,
  type VerifiedStablecoinPriceEvidenceMaterialV1,
  type VerifiedStablecoinPriceProjectionBatchV1,
} from './stablecoin-price-ingestion-plan';
import {
  assertCanonicalStablecoinPriceIngestionBatch,
  DormantStablecoinPriceIngestionOrchestrator,
  type VerifiedStablecoinPriceSourceMap,
} from './stablecoin-price-ingestion.orchestrator';
import {
  createStablecoinPricePersistenceAdmission,
  STABLECOIN_PRICE_PERSISTENCE_ADMISSION_SCHEMA_VERSION,
  StablecoinPricePersistenceAdmissionError,
} from './stablecoin-price-persistence-plan';

const POLICY_DIGEST = '6c36c7bc78d70102c74255b9630f7a7e18e842e6daff52c9a73eed182121b7f3';
const CORRELATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const RUN_IDENTITY = Object.freeze({
  schemaVersion: 1,
  correlationId: CORRELATION_ID,
} as const);
const EVIDENCE_KEYS = Object.freeze([
  'schemaVersion',
  'policyId',
  'policyVersion',
  'policyDecisionSha256',
  'registryEnvironment',
  'registryVersion',
  'registryFingerprintSha256',
  'sourceId',
  'sourceReference',
  'stablecoin',
  'authenticatedSourceUpdateId',
  'monotonicSourceSequence',
  'usdPrice',
  'confidence',
  'pricedAt',
  'observedAt',
  'verificationMethod',
  'verifiedAt',
  'evidenceActorReferenceId',
  'mayAuthorizeFinancialAction',
  'evidenceFingerprintSha256',
] as const);

class FakeVerifiedPriceSource implements VerifiedStablecoinPriceSourcePort {
  constructor(
    readonly sourceId: StablecoinValuationSourceId,
    private readonly activePlan: StablecoinPriceIngestionPlanV1,
  ) {}

  async read(stablecoin: MainnetStablecoin, signal: AbortSignal): Promise<unknown> {
    void signal;
    const logicalRead = this.activePlan.logicalReads.find(
      (candidate) => candidate.sourceId === this.sourceId && candidate.stablecoin === stablecoin,
    );
    if (logicalRead === undefined) throw new Error('missing test read');
    return evidence(this.activePlan, logicalRead);
  }
}

function plan(): StablecoinPriceIngestionPlanV1 {
  return createStablecoinPriceIngestionPlan({
    policyId: 'KAN-66',
    policyVersion: 1,
    policyDecisionSha256: POLICY_DIGEST,
  });
}

function evidenceMaterial(
  activePlan: StablecoinPriceIngestionPlanV1,
  logicalRead: StablecoinPriceLogicalReadV1,
): VerifiedStablecoinPriceEvidenceMaterialV1 {
  const readIndex = activePlan.logicalReads.indexOf(logicalRead);
  const sequence = String(100 + readIndex);
  return {
    schemaVersion: 1,
    policyId: 'KAN-66',
    policyVersion: 1,
    policyDecisionSha256: POLICY_DIGEST,
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: activePlan.registryFingerprintSha256,
    sourceId: logicalRead.sourceId,
    sourceReference: logicalRead.sourceReference,
    stablecoin: logicalRead.stablecoin,
    authenticatedSourceUpdateId:
      logicalRead.sourceId === 'PYTH_CORE'
        ? `${String(readIndex + 1).padStart(2, '0')}${'a'.repeat(62)}`
        : sequence,
    monotonicSourceSequence: sequence,
    usdPrice: { mantissa: String(99_990_000 + readIndex), scale: 8 },
    confidence:
      logicalRead.sourceId === 'PYTH_CORE'
        ? { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: String(2_500 + readIndex), scale: 8 }
        : { kind: 'NOT_PUBLISHED' },
    pricedAt: '2026-09-04T11:59:58.000Z',
    observedAt: '2026-09-04T12:00:00.000Z',
    verificationMethod: logicalRead.verificationMethod,
    verifiedAt: '2026-09-04T12:00:01.000Z',
    evidenceActorReferenceId:
      logicalRead.sourceId === 'PYTH_CORE'
        ? 'verified-pyth-source:mainnet-v1'
        : 'verified-chainlink-source:mainnet-v1',
    mayAuthorizeFinancialAction: false,
  };
}

function evidence(
  activePlan: StablecoinPriceIngestionPlanV1,
  logicalRead: StablecoinPriceLogicalReadV1,
): VerifiedStablecoinPriceEvidenceV1 {
  const material = evidenceMaterial(activePlan, logicalRead);
  return {
    ...material,
    evidenceFingerprintSha256: fingerprintVerifiedStablecoinPriceEvidence(material),
  };
}

function directBatch(
  activePlan: StablecoinPriceIngestionPlanV1,
): VerifiedStablecoinPriceProjectionBatchV1 {
  return createVerifiedStablecoinPriceProjectionBatch(
    activePlan,
    activePlan.logicalReads.map((logicalRead) => evidence(activePlan, logicalRead)),
  );
}

async function orchestratedBatch(): Promise<{
  readonly activePlan: StablecoinPriceIngestionPlanV1;
  readonly batch: VerifiedStablecoinPriceProjectionBatchV1;
}> {
  const activePlan = plan();
  const sources: VerifiedStablecoinPriceSourceMap = {
    PYTH_CORE: new FakeVerifiedPriceSource('PYTH_CORE', activePlan),
    CHAINLINK_DATA_FEEDS: new FakeVerifiedPriceSource('CHAINLINK_DATA_FEEDS', activePlan),
  };
  const batch = await new DormantStablecoinPriceIngestionOrchestrator(activePlan, sources).ingest(
    new AbortController().signal,
  );
  return { activePlan, batch };
}

function expectFixedError(action: () => unknown, code: string): void {
  let captured: unknown;
  try {
    action();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(StablecoinPricePersistenceAdmissionError);
  expect(captured).toMatchObject({
    name: 'StablecoinPricePersistenceAdmissionError',
    code,
    message: 'Stablecoin price persistence admission is invalid.',
  });
  expect(captured).not.toHaveProperty('cause');
}

function expectDeeplyFrozen(value: unknown, visited = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) expectDeeplyFrozen(descriptor.value, visited);
  }
}

describe('stablecoin price persistence admission plan', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts the canonical in-process Slice C batch as one exact atomic hand-off', async () => {
    const { activePlan, batch } = await orchestratedBatch();

    const admission = createStablecoinPricePersistenceAdmission(RUN_IDENTITY, batch);

    expect(() => assertCanonicalVerifiedStablecoinPriceProjectionBatch(batch)).not.toThrow();
    expect(() => assertCanonicalStablecoinPriceIngestionBatch(batch)).not.toThrow();
    expect(admission).toEqual({
      schemaVersion: STABLECOIN_PRICE_PERSISTENCE_ADMISSION_SCHEMA_VERSION,
      runIdentity: RUN_IDENTITY,
      projectionBatch: batch,
      projectionCount: 12,
      atomicWriteRequired: true,
      mayAuthorizeFinancialAction: false,
    });
    expect(admission.projectionBatch).toBe(batch);
    expect(admission.projectionBatch.projections).toBe(batch.projections);
    expect(admission.projectionBatch.projections.map(({ projectionId }) => projectionId)).toEqual(
      activePlan.projections.map(({ projectionId }) => projectionId),
    );
    expect(new Set(batch.projections.map(({ projectionId }) => projectionId)).size).toBe(12);
  });

  it('rejects a batch created outside the Slice C orchestrator', () => {
    const batch = directBatch(plan());

    expect(() => assertCanonicalVerifiedStablecoinPriceProjectionBatch(batch)).not.toThrow();
    expectFixedError(
      () => createStablecoinPricePersistenceAdmission(RUN_IDENTITY, batch),
      'NON_CANONICAL_PROJECTION_BATCH',
    );
  });

  it('preserves every projection and verified evidence field losslessly by identity', async () => {
    const { activePlan, batch } = await orchestratedBatch();

    const admission = createStablecoinPricePersistenceAdmission(RUN_IDENTITY, batch);

    expect(admission.projectionBatch.projections).toHaveLength(12);
    for (const [index, projection] of admission.projectionBatch.projections.entries()) {
      expect(projection).toBe(batch.projections[index]);
      expect(Reflect.ownKeys(projection.evidence)).toEqual(EVIDENCE_KEYS);
      expect(projection.evidence).toBe(batch.projections[index]?.evidence);
      expect(projection.evidence.policyDecisionSha256).toBe(POLICY_DIGEST);
      expect(projection.evidence.registryFingerprintSha256).toBe(
        activePlan.registryFingerprintSha256,
      );
      expect(projection.evidence.evidenceFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('is deeply immutable and cannot authorize a financial action at any layer', async () => {
    const { batch } = await orchestratedBatch();

    const admission = createStablecoinPricePersistenceAdmission(RUN_IDENTITY, batch);

    expectDeeplyFrozen(admission);
    expect(admission.mayAuthorizeFinancialAction).toBe(false);
    expect(admission.projectionBatch.mayAuthorizeFinancialAction).toBe(false);
    expect(
      admission.projectionBatch.projections.every(
        (projection) =>
          !projection.mayAuthorizeFinancialAction &&
          !projection.evidence.mayAuthorizeFinancialAction,
      ),
    ).toBe(true);
    expect(
      Reflect.set(
        admission as unknown as Record<string, unknown>,
        'mayAuthorizeFinancialAction',
        true,
      ),
    ).toBe(false);
  });

  it.each([
    ['forged', (batch: VerifiedStablecoinPriceProjectionBatchV1) => ({ ...batch })],
    [
      'reordered',
      (batch: VerifiedStablecoinPriceProjectionBatchV1) => ({
        ...batch,
        projections: [...batch.projections].reverse(),
      }),
    ],
    [
      'duplicate',
      (batch: VerifiedStablecoinPriceProjectionBatchV1) => ({
        ...batch,
        projections: [batch.projections[0], batch.projections[0], ...batch.projections.slice(2)],
      }),
    ],
    [
      'missing',
      (batch: VerifiedStablecoinPriceProjectionBatchV1) => ({
        ...batch,
        projections: batch.projections.slice(0, 11),
      }),
    ],
    [
      'surplus',
      (batch: VerifiedStablecoinPriceProjectionBatchV1) => ({
        ...batch,
        projections: [...batch.projections, batch.projections[0]],
      }),
    ],
    [
      'extra-field',
      (batch: VerifiedStablecoinPriceProjectionBatchV1) => ({ ...batch, unexpected: true }),
    ],
  ])('rejects a %s projection batch with one fixed non-secret code', async (_label, forge) => {
    const { batch } = await orchestratedBatch();

    expectFixedError(
      () => createStablecoinPricePersistenceAdmission(RUN_IDENTITY, forge(batch)),
      'NON_CANONICAL_PROJECTION_BATCH',
    );
  });

  it('rejects batch accessors and proxies without invoking their traps', async () => {
    const { batch } = await orchestratedBatch();
    const projectionGetter = jest.fn(() => batch.projections);
    const accessor = { ...batch } as Record<string, unknown>;
    Object.defineProperty(accessor, 'projections', { enumerable: true, get: projectionGetter });
    const getPrototypeOf = jest.fn(() => Object.prototype);
    const get = jest.fn(() => undefined);
    const proxy = new Proxy(batch, { get, getPrototypeOf });

    for (const candidate of [accessor, proxy]) {
      expectFixedError(
        () => createStablecoinPricePersistenceAdmission(RUN_IDENTITY, candidate),
        'NON_CANONICAL_PROJECTION_BATCH',
      );
    }
    expect(projectionGetter).not.toHaveBeenCalled();
    expect(getPrototypeOf).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { schemaVersion: 1 },
    { schemaVersion: 2, correlationId: CORRELATION_ID },
    { schemaVersion: 1, correlationId: '123e4567-e89b-12d3-a456-426614174000' },
    { schemaVersion: 1, correlationId: CORRELATION_ID.toUpperCase() },
    { schemaVersion: 1, correlationId: CORRELATION_ID, unexpected: 'private-value' },
    Object.assign(Object.create({ inherited: true }) as object, RUN_IDENTITY),
  ])('rejects a non-exact run identity without reflecting it', async (identity) => {
    const { batch } = await orchestratedBatch();

    expectFixedError(
      () => createStablecoinPricePersistenceAdmission(identity, batch),
      'INVALID_PERSISTENCE_RUN_IDENTITY',
    );
  });

  it('rejects run-identity accessors and proxies without invoking their traps', async () => {
    const { batch } = await orchestratedBatch();
    const correlationGetter = jest.fn(() => CORRELATION_ID);
    const accessor = { schemaVersion: 1 } as Record<string, unknown>;
    Object.defineProperty(accessor, 'correlationId', {
      enumerable: true,
      get: correlationGetter,
    });
    const getPrototypeOf = jest.fn(() => Object.prototype);
    const proxy = new Proxy(RUN_IDENTITY, { getPrototypeOf });

    for (const identity of [accessor, proxy]) {
      expectFixedError(
        () => createStablecoinPricePersistenceAdmission(identity, batch),
        'INVALID_PERSISTENCE_RUN_IDENTITY',
      );
    }
    expect(correlationGetter).not.toHaveBeenCalled();
    expect(getPrototypeOf).not.toHaveBeenCalled();
  });

  it('performs no ambient fetch, clock, configuration, persistence, or per-row work', async () => {
    const { batch } = await orchestratedBatch();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const clockSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('ambient clock accessed');
    });
    const ambientEnvironmentRead = jest.fn(() => {
      throw new Error('ambient environment accessed');
    });
    const originalEnvironment = Object.getOwnPropertyDescriptor(process, 'env');
    if (originalEnvironment === undefined) throw new Error('missing environment descriptor');
    Object.defineProperty(process, 'env', {
      ...originalEnvironment,
      value: new Proxy(process.env, { get: ambientEnvironmentRead }),
    });
    const hypotheticalWriter = jest.fn();
    let admission: ReturnType<typeof createStablecoinPricePersistenceAdmission> | undefined;

    try {
      admission = createStablecoinPricePersistenceAdmission(RUN_IDENTITY, batch);
    } finally {
      Object.defineProperty(process, 'env', originalEnvironment);
    }

    expect(admission?.projectionBatch).toBe(batch);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(clockSpy).not.toHaveBeenCalled();
    expect(ambientEnvironmentRead).not.toHaveBeenCalled();
    expect(hypotheticalWriter).not.toHaveBeenCalled();
    expect(Reflect.ownKeys(admission ?? {})).toEqual([
      'schemaVersion',
      'runIdentity',
      'projectionBatch',
      'projectionCount',
      'atomicWriteRequired',
      'mayAuthorizeFinancialAction',
    ]);
  });
});
