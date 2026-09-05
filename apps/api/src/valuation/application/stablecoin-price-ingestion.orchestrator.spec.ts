import type { StablecoinValuationSourceId } from '../domain/stablecoin-valuation-policy';
import { DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES } from './fail-closed-stablecoin-price-source';
import * as stablecoinPriceIngestionPlan from './stablecoin-price-ingestion-plan';
import {
  createStablecoinPriceIngestionPlan,
  fingerprintVerifiedStablecoinPriceEvidence,
  type StablecoinPriceIngestionPlanV1,
  type StablecoinPriceLogicalReadV1,
  type VerifiedStablecoinPriceEvidenceMaterialV1,
} from './stablecoin-price-ingestion-plan';
import {
  DormantStablecoinPriceIngestionOrchestrator,
  STABLECOIN_PRICE_INGESTION_EXECUTION_POLICY,
  StablecoinPriceIngestionOrchestratorError,
  type VerifiedStablecoinPriceSourceMap,
} from './stablecoin-price-ingestion.orchestrator';
import type {
  MainnetStablecoin,
  VerifiedStablecoinPriceSourcePort,
} from './ports/verified-stablecoin-price-source.port';

const POLICY_DIGEST = '6c36c7bc78d70102c74255b9630f7a7e18e842e6daff52c9a73eed182121b7f3';

interface SourceCall {
  readonly sourceId: StablecoinValuationSourceId;
  readonly stablecoin: MainnetStablecoin;
  readonly signal: AbortSignal;
}

type SourceHandler = (
  stablecoin: MainnetStablecoin,
  signal: AbortSignal,
) => Promise<unknown> | unknown;

class FakeVerifiedPriceSource implements VerifiedStablecoinPriceSourcePort {
  constructor(
    readonly sourceId: StablecoinValuationSourceId,
    private readonly handler: SourceHandler,
  ) {}

  async read(stablecoin: MainnetStablecoin, signal: AbortSignal): Promise<unknown> {
    return this.handler(stablecoin, signal);
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
  read: StablecoinPriceLogicalReadV1,
  overrides: Partial<VerifiedStablecoinPriceEvidenceMaterialV1> = {},
): VerifiedStablecoinPriceEvidenceMaterialV1 {
  const readIndex = activePlan.logicalReads.indexOf(read);
  const sequence = String(100 + readIndex);
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
        ? `${String(readIndex + 1).padStart(2, '0')}${'a'.repeat(62)}`
        : sequence,
    monotonicSourceSequence: sequence,
    usdPrice: { mantissa: '99990000', scale: 8 },
    confidence:
      read.sourceId === 'PYTH_CORE'
        ? { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '2500', scale: 8 }
        : { kind: 'NOT_PUBLISHED' },
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
): unknown {
  const material = evidenceMaterial(activePlan, read, overrides);
  return {
    ...material,
    evidenceFingerprintSha256: fingerprintVerifiedStablecoinPriceEvidence(material),
  };
}

function sourceMap(
  activePlan: StablecoinPriceIngestionPlanV1,
  calls: SourceCall[],
  override?: Partial<Record<StablecoinValuationSourceId, SourceHandler>>,
): VerifiedStablecoinPriceSourceMap {
  const makeHandler = (sourceId: StablecoinValuationSourceId): SourceHandler =>
    override?.[sourceId] ??
    (async (stablecoin, signal) => {
      calls.push({ sourceId, stablecoin, signal });
      const read = activePlan.logicalReads.find(
        (candidate) => candidate.sourceId === sourceId && candidate.stablecoin === stablecoin,
      );
      if (read === undefined) throw new Error('missing test read');
      await Promise.resolve();
      return evidence(activePlan, read);
    });
  return {
    PYTH_CORE: new FakeVerifiedPriceSource('PYTH_CORE', makeHandler('PYTH_CORE')),
    CHAINLINK_DATA_FEEDS: new FakeVerifiedPriceSource(
      'CHAINLINK_DATA_FEEDS',
      makeHandler('CHAINLINK_DATA_FEEDS'),
    ),
  };
}

describe('DormantStablecoinPriceIngestionOrchestrator', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('executes the six reads once in canonical sequential order and returns all 12 projections', async () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    let activeReads = 0;
    let maximumConcurrentReads = 0;
    const handler =
      (sourceId: StablecoinValuationSourceId): SourceHandler =>
      async (stablecoin, signal) => {
        calls.push({ sourceId, stablecoin, signal });
        activeReads += 1;
        maximumConcurrentReads = Math.max(maximumConcurrentReads, activeReads);
        await Promise.resolve();
        activeReads -= 1;
        const read = activePlan.logicalReads.find(
          (candidate) => candidate.sourceId === sourceId && candidate.stablecoin === stablecoin,
        );
        if (read === undefined) throw new Error('missing test read');
        return evidence(activePlan, read);
      };
    const sources = sourceMap(activePlan, calls, {
      PYTH_CORE: handler('PYTH_CORE'),
      CHAINLINK_DATA_FEEDS: handler('CHAINLINK_DATA_FEEDS'),
    });
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(activePlan, sources);
    const signal = new AbortController().signal;

    const result = await orchestrator.ingest(signal);

    expect(calls.map(({ sourceId, stablecoin }) => [sourceId, stablecoin])).toEqual(
      activePlan.logicalReads.map(({ sourceId, stablecoin }) => [sourceId, stablecoin]),
    );
    expect(calls).toHaveLength(6);
    expect(calls.every((call) => call.signal === signal)).toBe(true);
    expect(maximumConcurrentReads).toBe(1);
    expect(STABLECOIN_PRICE_INGESTION_EXECUTION_POLICY).toEqual({
      order: 'CANONICAL_PLAN_SEQUENTIAL',
      maximumConcurrentReads: 1,
      logicalReadsPerSuccessfulRun: 6,
      projectionsPerSuccessfulRun: 12,
      partialProjectionAllowed: false,
    });
    expect(result.projections).toHaveLength(12);
    expect(result.projectionCount).toBe(12);
    expect(result.mayAuthorizeFinancialAction).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('uses no ambient fetch or clock and owns no persistence/configuration dependency', async () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const clockSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('ambient clock was accessed');
    });
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(
      activePlan,
      sourceMap(activePlan, calls),
    );

    const result = await orchestrator.ingest(new AbortController().signal);

    expect(result.projections).toHaveLength(12);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(clockSpy).not.toHaveBeenCalled();
    expect(Reflect.ownKeys(orchestrator)).toEqual(['plan', 'sources']);
    expect(Object.isFrozen(orchestrator)).toBe(true);
    expect(Reflect.set(orchestrator as unknown as Record<string, unknown>, 'plan', null)).toBe(
      false,
    );
    expect(Reflect.set(orchestrator as unknown as Record<string, unknown>, 'sources', null)).toBe(
      false,
    );
    fetchSpy.mockRestore();
    clockSpy.mockRestore();
  });

  it('remains zero-I/O-by-default with the disabled source map', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(
      plan(),
      DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES,
    );

    await expect(orchestrator.ingest(new AbortController().signal)).rejects.toMatchObject({
      name: 'StablecoinPriceIngestionOrchestratorError',
      code: 'VERIFIED_PRICE_SOURCE_UNAVAILABLE',
      message: 'Stablecoin price ingestion is unavailable.',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('propagates an already-aborted caller reason by identity without reading a source', async () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(
      activePlan,
      sourceMap(activePlan, calls),
    );
    const controller = new AbortController();
    const reason = new Error('shutdown requested');
    controller.abort(reason);

    await expect(orchestrator.ingest(controller.signal)).rejects.toBe(reason);
    expect(calls).toEqual([]);
  });

  it('preserves a caller abort even when the in-flight source ignores the signal', async () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const controller = new AbortController();
    const reason = new Error('shutdown during read');
    const sources = sourceMap(activePlan, calls, {
      PYTH_CORE: async (stablecoin, signal) => {
        calls.push({ sourceId: 'PYTH_CORE', stablecoin, signal });
        return new Promise<never>(() => undefined);
      },
    });
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(activePlan, sources);

    const ingestion = orchestrator.ingest(controller.signal);
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    controller.abort(reason);

    await expect(ingestion).rejects.toBe(reason);
    expect(calls).toHaveLength(1);
  });

  it('stops after a partial source failure and exposes only a fixed non-secret code', async () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const secret = 'https://paid-provider.example/key/private-token';
    let invocation = 0;
    const sources = sourceMap(activePlan, calls, {
      PYTH_CORE: async (stablecoin, signal) => {
        calls.push({ sourceId: 'PYTH_CORE', stablecoin, signal });
        invocation += 1;
        if (invocation === 2) throw new Error(secret);
        const read = activePlan.logicalReads[invocation - 1];
        if (read === undefined) throw new Error('missing test read');
        return evidence(activePlan, read);
      },
    });
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(activePlan, sources);
    const projectionSpy = jest.spyOn(
      stablecoinPriceIngestionPlan,
      'createVerifiedStablecoinPriceProjectionBatch',
    );

    let captured: unknown;
    try {
      await orchestrator.ingest(new AbortController().signal);
    } catch (error) {
      captured = error;
    }

    expect(calls).toHaveLength(2);
    expect(captured).toBeInstanceOf(StablecoinPriceIngestionOrchestratorError);
    expect(captured).toMatchObject({ code: 'VERIFIED_PRICE_SOURCE_UNAVAILABLE' });
    expect(captured).not.toHaveProperty('cause');
    expect(JSON.stringify(captured)).not.toContain(secret);
    expect(projectionSpy).not.toHaveBeenCalled();
  });

  it('creates no batch from duplicate or mismatched evidence and stops at the first rejection', async () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const firstRead = activePlan.logicalReads[0];
    if (firstRead === undefined) throw new Error('missing test read');
    let invocation = 0;
    const sources = sourceMap(activePlan, calls, {
      PYTH_CORE: async (stablecoin, signal) => {
        calls.push({ sourceId: 'PYTH_CORE', stablecoin, signal });
        invocation += 1;
        return evidence(activePlan, firstRead);
      },
    });
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(activePlan, sources);
    const projectionSpy = jest.spyOn(
      stablecoinPriceIngestionPlan,
      'createVerifiedStablecoinPriceProjectionBatch',
    );

    await expect(orchestrator.ingest(new AbortController().signal)).rejects.toMatchObject({
      code: 'VERIFIED_PRICE_EVIDENCE_REJECTED',
      message: 'Stablecoin price ingestion is unavailable.',
    });
    expect(invocation).toBe(2);
    expect(calls).toHaveLength(2);
    expect(projectionSpy).not.toHaveBeenCalled();
  });

  it('creates no batch from a source result whose bound policy identity is mismatched', async () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const firstRead = activePlan.logicalReads[0];
    if (firstRead === undefined) throw new Error('missing test read');
    const mismatchedMaterial = evidenceMaterial(activePlan, firstRead, {
      policyDecisionSha256: 'b'.repeat(64),
    });
    const sources = sourceMap(activePlan, calls, {
      PYTH_CORE: async (stablecoin, signal) => {
        calls.push({ sourceId: 'PYTH_CORE', stablecoin, signal });
        return {
          ...mismatchedMaterial,
          evidenceFingerprintSha256: fingerprintVerifiedStablecoinPriceEvidence(mismatchedMaterial),
        };
      },
    });
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(activePlan, sources);
    const projectionSpy = jest.spyOn(
      stablecoinPriceIngestionPlan,
      'createVerifiedStablecoinPriceProjectionBatch',
    );

    await expect(orchestrator.ingest(new AbortController().signal)).rejects.toMatchObject({
      code: 'VERIFIED_PRICE_EVIDENCE_REJECTED',
      message: 'Stablecoin price ingestion is unavailable.',
    });
    expect(calls).toHaveLength(1);
    expect(projectionSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing source',
      (sources: VerifiedStablecoinPriceSourceMap) => ({ PYTH_CORE: sources.PYTH_CORE }),
    ],
    [
      'extra source',
      (sources: VerifiedStablecoinPriceSourceMap) => ({ ...sources, EXTRA: sources.PYTH_CORE }),
    ],
    [
      'swapped identity',
      (sources: VerifiedStablecoinPriceSourceMap) => ({
        ...sources,
        PYTH_CORE: sources.CHAINLINK_DATA_FEEDS,
      }),
    ],
  ])('rejects an exact source-map %s before any read', (_label, mutate) => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const sources = sourceMap(activePlan, calls);

    expect(
      () =>
        new DormantStablecoinPriceIngestionOrchestrator(
          activePlan,
          mutate(sources) as VerifiedStablecoinPriceSourceMap,
        ),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_ORCHESTRATOR_CONFIGURATION',
        message: 'Stablecoin price ingestion is unavailable.',
      }),
    );
    expect(calls).toEqual([]);
  });

  it('rejects source-map accessors and proxies without invoking their traps', () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const sources = sourceMap(activePlan, calls);
    const getter = jest.fn(() => sources.PYTH_CORE);
    const accessorMap = { CHAINLINK_DATA_FEEDS: sources.CHAINLINK_DATA_FEEDS } as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessorMap, 'PYTH_CORE', { enumerable: true, get: getter });
    const proxyTrap = jest.fn(() => Object.prototype);
    const proxyMap = new Proxy(sources, { getPrototypeOf: proxyTrap });

    for (const invalidMap of [accessorMap, proxyMap]) {
      expect(
        () =>
          new DormantStablecoinPriceIngestionOrchestrator(
            activePlan,
            invalidMap as VerifiedStablecoinPriceSourceMap,
          ),
      ).toThrow(expect.objectContaining({ code: 'INVALID_ORCHESTRATOR_CONFIGURATION' }));
    }
    expect(getter).not.toHaveBeenCalled();
    expect(proxyTrap).not.toHaveBeenCalled();
  });

  it('rejects a proxied source implementation without inspecting it', () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const sources = sourceMap(activePlan, calls);
    const proxyTrap = jest.fn(() => Object.prototype);
    const proxySource = new Proxy(sources.PYTH_CORE, { getPrototypeOf: proxyTrap });

    expect(
      () =>
        new DormantStablecoinPriceIngestionOrchestrator(activePlan, {
          ...sources,
          PYTH_CORE: proxySource,
        }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ORCHESTRATOR_CONFIGURATION' }));
    expect(proxyTrap).not.toHaveBeenCalled();
  });

  it('rejects source identity and read accessors without invoking them', () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const validSources = sourceMap(activePlan, calls);
    const sourceIdGetter = jest.fn(() => 'PYTH_CORE');
    const readGetter = jest.fn(() => validSources.PYTH_CORE.read);
    const sourceIdAccessor = Object.create(Object.prototype) as Record<string, unknown>;
    Object.defineProperty(sourceIdAccessor, 'sourceId', {
      enumerable: true,
      get: sourceIdGetter,
    });
    Object.defineProperty(sourceIdAccessor, 'read', {
      enumerable: true,
      value: validSources.PYTH_CORE.read,
    });
    const readAccessor = { sourceId: 'PYTH_CORE' } as Record<string, unknown>;
    Object.defineProperty(readAccessor, 'read', { enumerable: true, get: readGetter });

    for (const invalidSource of [sourceIdAccessor, readAccessor]) {
      expect(
        () =>
          new DormantStablecoinPriceIngestionOrchestrator(activePlan, {
            ...validSources,
            PYTH_CORE: invalidSource,
          } as unknown as VerifiedStablecoinPriceSourceMap),
      ).toThrow(expect.objectContaining({ code: 'INVALID_ORCHESTRATOR_CONFIGURATION' }));
    }
    expect(sourceIdGetter).not.toHaveBeenCalled();
    expect(readGetter).not.toHaveBeenCalled();
  });

  it('rejects fabricated plans and non-AbortSignal input with fixed errors', async () => {
    const activePlan = plan();
    const calls: SourceCall[] = [];
    const sources = sourceMap(activePlan, calls);

    expect(
      () =>
        new DormantStablecoinPriceIngestionOrchestrator(
          { ...activePlan } as StablecoinPriceIngestionPlanV1,
          sources,
        ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ORCHESTRATOR_CONFIGURATION' }));
    const orchestrator = new DormantStablecoinPriceIngestionOrchestrator(activePlan, sources);
    await expect(orchestrator.ingest({ aborted: false } as AbortSignal)).rejects.toMatchObject({
      code: 'INVALID_ABORT_SIGNAL',
      message: 'Stablecoin price ingestion is unavailable.',
    });
    expect(calls).toEqual([]);
  });
});
