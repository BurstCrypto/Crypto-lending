import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  STABLECOIN_VALUATION_POLICY,
  calculateStablecoinUsdValueMantissa,
  evaluateStablecoinRecovery,
  evaluateStablecoinValuation,
  type StablecoinDepegLatchReference,
  type StablecoinManualRiskClearReference,
  type StablecoinPriceObservation,
  type StablecoinRecoveryRequest,
  type StablecoinRecoverySample,
  type StablecoinValuationAssetReference,
  type StablecoinValuationRequest,
  type StablecoinValuationSourceId,
} from './stablecoin-valuation-policy';

interface PacketObservation {
  readonly provider: StablecoinValuationSourceId;
  readonly ageSeconds: number;
  readonly priceMantissa: string;
  readonly priceScale: number;
  readonly confidence: Readonly<{
    kind: 'PUBLISHED_ABSOLUTE_USD' | 'NOT_PUBLISHED';
    mantissa: string | null;
    scale: number | null;
  }>;
}

interface PacketExample {
  readonly id: string;
  readonly asset: 'USDC' | 'USDT' | 'PYUSD';
  readonly amountAtomic: string;
  readonly input: Readonly<{
    recoveryEvaluatedAt: string;
    depegLatch: Readonly<{ latchId: string; latchedAt: string }> | null;
    manualRiskClear: Readonly<{ clearId: string; latchId: string; clearedAt: string }> | null;
    observations: readonly PacketObservation[];
    recoveryObservations: readonly PacketRecoveryObservation[];
  }>;
  readonly result: Readonly<Record<string, unknown>>;
}

interface PacketRecoveryObservation {
  readonly id: string;
  readonly elapsedFromFirstSeconds: number;
  readonly dualSource: boolean;
  readonly sourceAgreement: 'CORROBORATED' | 'SOFT_DISAGREEMENT' | 'CONFLICT';
  readonly maximumDownsideBps: number;
  readonly pythConfidenceBps: number;
  readonly wasCurrent: boolean;
  readonly monotonic: boolean;
}

interface ValuationDecisionPacket {
  readonly deterministicExamples: readonly PacketExample[];
}

const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const EVALUATED_AT = '2026-08-22T12:00:00.000Z';
const RECOVERY_EVALUATED_AT = '2026-08-22T10:30:00.000Z';
const DEPEG_LATCH_ID = 'd'.repeat(64);
const MANUAL_RISK_CLEAR_ID = 'c'.repeat(64);

const ASSETS: Readonly<Record<'USDC' | 'USDT' | 'PYUSD', StablecoinValuationAssetReference>> =
  Object.freeze({
    USDC: Object.freeze({
      registryEnvironment: 'MAINNET',
      registryVersion: 1,
      registryFingerprintSha256: REGISTRY_FINGERPRINT,
      stablecoin: 'USDC',
      networkId: 'eip155:1',
      identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      decimals: 6,
    }),
    USDT: Object.freeze({
      registryEnvironment: 'MAINNET',
      registryVersion: 1,
      registryFingerprintSha256: REGISTRY_FINGERPRINT,
      stablecoin: 'USDT',
      networkId: 'eip155:1',
      identity: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      decimals: 6,
    }),
    PYUSD: Object.freeze({
      registryEnvironment: 'MAINNET',
      registryVersion: 1,
      registryFingerprintSha256: REGISTRY_FINGERPRINT,
      stablecoin: 'PYUSD',
      networkId: 'eip155:1',
      identity: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
      decimals: 6,
    }),
  });

interface ObservationOptions {
  readonly sourceId: StablecoinValuationSourceId;
  readonly priceMantissa: string;
  readonly ageMs?: number;
  readonly evaluatedAt?: string;
  readonly sequence?: string;
  readonly confidenceMantissa?: string;
  readonly pricedAt?: string;
  readonly observedAt?: string;
  readonly sourceReference?: string;
}

function timestampBefore(timestamp: string, ageMs: number): string {
  return new Date(Date.parse(timestamp) - ageMs).toISOString();
}

function observation(
  asset: StablecoinValuationAssetReference,
  options: ObservationOptions,
): StablecoinPriceObservation {
  const evaluatedAt = options.evaluatedAt ?? EVALUATED_AT;
  const sourceId = options.sourceId;
  const sourceSequence = options.sequence ?? '1';
  return {
    asset,
    sourceId,
    sourceReference:
      options.sourceReference ?? STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin][sourceId],
    sourceSequence,
    sourceUpdateId: sourceId === 'PYTH_CORE' ? sourceSequence.padStart(64, '0') : sourceSequence,
    pricedAt: options.pricedAt ?? timestampBefore(evaluatedAt, options.ageMs ?? 10_000),
    observedAt: options.observedAt ?? evaluatedAt,
    usdRateMantissa: options.priceMantissa,
    usdRateScale: 8,
    confidence:
      sourceId === 'PYTH_CORE'
        ? {
            kind: 'PUBLISHED_ABSOLUTE_USD',
            mantissa: options.confidenceMantissa ?? '10000',
            scale: 8,
          }
        : { kind: 'NOT_PUBLISHED' },
  };
}

function request(
  asset: StablecoinValuationAssetReference,
  observations: readonly StablecoinPriceObservation[],
  evaluatedAt = EVALUATED_AT,
): StablecoinValuationRequest {
  return {
    asset,
    amountAtomic: '10000000',
    evaluatedAt,
    sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
    observations,
  };
}

function dual(
  asset: StablecoinValuationAssetReference,
  pythPrice: string,
  chainlinkPrice: string,
  pythConfidence = '10000',
): StablecoinValuationRequest {
  return request(asset, [
    observation(asset, {
      sourceId: 'PYTH_CORE',
      priceMantissa: pythPrice,
      confidenceMantissa: pythConfidence,
      ageMs: 10_000,
    }),
    observation(asset, {
      sourceId: 'CHAINLINK_DATA_FEEDS',
      priceMantissa: chainlinkPrice,
      ageMs: 20_000,
    }),
  ]);
}

interface RecoverySampleOptions {
  readonly intervalMs?: number;
  readonly pythAgeMs?: number;
  readonly chainlinkAgeMs?: number;
  readonly pythPrice?: string;
  readonly chainlinkPrice?: string;
  readonly pythConfidence?: string;
  readonly sequenceOffset?: number;
}

function recoverySample(
  index: number,
  options: RecoverySampleOptions = {},
): StablecoinRecoverySample {
  const evaluatedAt = new Date(
    Date.parse('2026-08-22T10:00:00.000Z') + index * (options.intervalMs ?? 600_000),
  ).toISOString();
  const sequence = String(index + 1 + (options.sequenceOffset ?? 0));
  return {
    evaluatedAt,
    observations: [
      observation(ASSETS.PYUSD, {
        sourceId: 'PYTH_CORE',
        priceMantissa: options.pythPrice ?? '99990000',
        confidenceMantissa: options.pythConfidence ?? '5000',
        evaluatedAt,
        ageMs: options.pythAgeMs ?? 3_000,
        sequence,
      }),
      observation(ASSETS.PYUSD, {
        sourceId: 'CHAINLINK_DATA_FEEDS',
        priceMantissa: options.chainlinkPrice ?? '99980000',
        evaluatedAt,
        ageMs: options.chainlinkAgeMs ?? 10_000,
        sequence,
      }),
    ],
  };
}

function recoverySamples(options: RecoverySampleOptions = {}): readonly StablecoinRecoverySample[] {
  return [0, 1, 2, 3].map((index) => recoverySample(index, options));
}

function depegLatch(
  asset: StablecoinValuationAssetReference = ASSETS.PYUSD,
  overrides: Partial<StablecoinDepegLatchReference> = {},
): StablecoinDepegLatchReference {
  return {
    asset,
    latchId: DEPEG_LATCH_ID,
    latchedAt: '2026-08-22T09:59:00.000Z',
    ...overrides,
  };
}

function manualRiskClear(
  asset: StablecoinValuationAssetReference = ASSETS.PYUSD,
  overrides: Partial<StablecoinManualRiskClearReference> = {},
): StablecoinManualRiskClearReference {
  return {
    asset,
    clearId: MANUAL_RISK_CLEAR_ID,
    latchId: DEPEG_LATCH_ID,
    clearedAt: RECOVERY_EVALUATED_AT,
    ...overrides,
  };
}

interface RecoveryRequestOptions {
  readonly evaluatedAt?: string;
  readonly depegLatch?: StablecoinDepegLatchReference | null;
  readonly manualRiskClear?: StablecoinManualRiskClearReference | null;
}

function recoveryRequest(
  samples: readonly StablecoinRecoverySample[],
  options: RecoveryRequestOptions = {},
): StablecoinRecoveryRequest {
  return {
    asset: ASSETS.PYUSD,
    evaluatedAt: options.evaluatedAt ?? RECOVERY_EVALUATED_AT,
    depegLatch: options.depegLatch === undefined ? depegLatch(ASSETS.PYUSD) : options.depegLatch,
    manualRiskClear: options.manualRiskClear ?? null,
    samples,
  };
}

const PACKET_RESULT_KEYS = Object.freeze([
  'availability',
  'selection',
  'selectedSourceId',
  'sourceAgreement',
  'confidenceClass',
  'freshnessClass',
  'usdRateMantissa',
  'usdRateScale',
  'usdValueMantissa',
  'usdValueScale',
  'depegClass',
  'downsideBand',
  'reportingUse',
  'mayIncreaseBuyingPower',
  'mayAuthorizeFinancialUse',
] as const);

function decisionPacket(): ValuationDecisionPacket {
  const path = resolve(
    __dirname,
    '../../../../../docs/valuation/kan-66-stablecoin-valuation-decision.json',
  );
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed as ValuationDecisionPacket;
}

function packetRequest(example: PacketExample): StablecoinValuationRequest {
  const asset = ASSETS[example.asset];
  const observations = example.input.observations.map((value, index) => {
    if (value.priceScale !== 8) throw new Error(`Unexpected packet rate scale: ${example.id}`);
    return observation(asset, {
      sourceId: value.provider,
      priceMantissa: value.priceMantissa,
      ...(value.confidence.kind === 'PUBLISHED_ABSOLUTE_USD'
        ? { confidenceMantissa: value.confidence.mantissa ?? 'INVALID' }
        : {}),
      ageMs: value.ageSeconds * 1_000,
      sequence: String(index + 1),
    });
  });
  return {
    asset,
    amountAtomic: example.amountAtomic,
    evaluatedAt: EVALUATED_AT,
    sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
    observations,
  };
}

function packetRecoverySamples(
  asset: StablecoinValuationAssetReference,
  rows: readonly PacketRecoveryObservation[],
): readonly StablecoinRecoverySample[] {
  return rows.map((row, index) => {
    if (
      !Number.isSafeInteger(row.elapsedFromFirstSeconds) ||
      !Number.isSafeInteger(row.maximumDownsideBps) ||
      !Number.isSafeInteger(row.pythConfidenceBps) ||
      row.elapsedFromFirstSeconds < 0 ||
      row.maximumDownsideBps < 0 ||
      row.pythConfidenceBps < 0
    ) {
      throw new Error(`Invalid compact recovery vector: ${row.id}`);
    }
    const evaluatedAt = new Date(
      Date.parse('2026-08-22T10:00:00.000Z') + row.elapsedFromFirstSeconds * 1_000,
    ).toISOString();
    const targetRate = 100_000_000n - BigInt(row.maximumDownsideBps) * 10_000n;
    const confidence = BigInt(row.pythConfidenceBps) * 10_000n;
    const requestedDivergence =
      row.sourceAgreement === 'CORROBORATED'
        ? confidence
        : row.sourceAgreement === 'SOFT_DISAGREEMENT'
          ? 250_001n
          : 500_001n;
    const pythPrice = targetRate + requestedDivergence;
    const sequence = row.monotonic ? String(index + 1) : '0';
    const pyth = observation(asset, {
      sourceId: 'PYTH_CORE',
      priceMantissa: pythPrice.toString(),
      confidenceMantissa: confidence.toString(),
      evaluatedAt,
      ageMs: row.wasCurrent ? 1_000 : 60_001,
      sequence,
    });
    const chainlink = observation(asset, {
      sourceId: 'CHAINLINK_DATA_FEEDS',
      priceMantissa: targetRate.toString(),
      evaluatedAt,
      ageMs: row.wasCurrent ? 2_000 : 60_001,
      sequence,
    });
    return {
      evaluatedAt,
      observations: row.dualSource ? [pyth, chainlink] : [pyth],
    };
  });
}

function recoveryStatusForPacketExample(
  example: PacketExample,
  result: ReturnType<typeof evaluateStablecoinValuation>,
): string {
  if (example.input.recoveryObservations.length > 0) {
    const asset = ASSETS[example.asset];
    return evaluateStablecoinRecovery({
      asset,
      evaluatedAt: example.input.recoveryEvaluatedAt,
      depegLatch: example.input.depegLatch === null ? null : { asset, ...example.input.depegLatch },
      manualRiskClear:
        example.input.manualRiskClear === null ? null : { asset, ...example.input.manualRiskClear },
      samples: packetRecoverySamples(asset, example.input.recoveryObservations),
    }).status;
  }
  if (result.downsideBand === 'DEPEGGED') return 'RECOVERY_PENDING';
  return 'NOT_APPLICABLE';
}

function packetProjection(
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(PACKET_RESULT_KEYS.map((key) => [key, record[key]])));
}

describe('KAN-66 machine decision packet parity', () => {
  it('replays all 17 compact deterministic vectors through the domain engine', () => {
    const examples = decisionPacket().deterministicExamples;
    expect(examples).toHaveLength(17);

    for (const example of examples) {
      const result = evaluateStablecoinValuation(packetRequest(example));
      const actual = {
        ...packetProjection(result as unknown as Readonly<Record<string, unknown>>),
        recoveryStatus: recoveryStatusForPacketExample(example, result),
      };
      const expected = {
        ...packetProjection(example.result),
        recoveryStatus: example.result.recoveryStatus,
      };
      expect({ id: example.id, result: actual }).toEqual({ id: example.id, result: expected });
    }
  });
});

describe('stablecoin valuation policy', () => {
  it('is an immutable, bounded, mainnet-only candidate with no financial activation', () => {
    expect(STABLECOIN_VALUATION_POLICY).toMatchObject({
      version: 1,
      externalStatus: 'PENDING_EXTERNAL_APPROVAL',
      registryBinding: {
        environment: 'MAINNET',
        version: 1,
        fingerprintSha256: REGISTRY_FINGERPRINT,
      },
      bounds: {
        maxObservations: 8,
        maxRateDigits: 78,
        maxRateScale: 36,
        normalizedUsdRateScale: 8,
        maxUsdValueDigits: 96,
        usdValueScale: 18,
      },
      recovery: {
        depegLatchReferenceRequired: true,
        trustedEvaluationTimeRequired: true,
        evidenceMustNotPrecedeLatch: true,
        clearMustMatchLatchAndFollowEvidence: true,
        manualRiskClearRequired: true,
      },
      externalGates: { KAN_252: 'PENDING', KAN_231: 'PENDING' },
      trustBoundary: {
        durableWatermarkPersistenceImplemented: true,
        durableUpdateIdUniquenessImplemented: true,
        durableDepegLatchPersistenceImplemented: true,
        manualRiskClearAuthenticationImplemented: false,
        runtimeAdapterImplemented: false,
      },
      authorization: { newCredit: 'FROZEN' },
    });
    expect(Object.isFrozen(STABLECOIN_VALUATION_POLICY)).toBe(true);
    expect(Object.isFrozen(STABLECOIN_VALUATION_POLICY.sourceOrder)).toBe(true);
    expect(Reflect.set(STABLECOIN_VALUATION_POLICY.freshness, 'currentWithinMs', 1)).toBe(false);
  });

  it('binds ADR-0003 fixed scale-18 arithmetic and exact ROUND_HALF_EVEN ties', () => {
    expect(
      calculateStablecoinUsdValueMantissa({
        amountAtomic: '10000000',
        assetDecimals: 6,
        usdRateMantissa: '9998',
        usdRateScale: 4,
      }),
    ).toBe('9998000000000000000');
    expect(
      calculateStablecoinUsdValueMantissa({
        amountAtomic: '1',
        assetDecimals: 6,
        usdRateMantissa: '10000000000005',
        usdRateScale: 13,
      }),
    ).toBe('1000000000000');
    expect(
      calculateStablecoinUsdValueMantissa({
        amountAtomic: '1',
        assetDecimals: 6,
        usdRateMantissa: '10000000000015',
        usdRateScale: 13,
      }),
    ).toBe('1000000000002');
    expect(
      calculateStablecoinUsdValueMantissa({
        amountAtomic: '1',
        assetDecimals: 6,
        usdRateMantissa: '1e8',
        usdRateScale: 8,
      }),
    ).toBeNull();
  });

  it.each([
    { differenceUnits: 250_000, agreement: 'CORROBORATED', availability: 'AVAILABLE' },
    { differenceUnits: 250_001, agreement: 'SOFT_DISAGREEMENT', availability: 'AVAILABLE' },
    { differenceUnits: 500_000, agreement: 'SOFT_DISAGREEMENT', availability: 'AVAILABLE' },
    { differenceUnits: 500_001, agreement: 'CONFLICT', availability: 'UNAVAILABLE' },
  ] as const)(
    'classifies exact fractional source divergence at $differenceUnits scale-8 units',
    ({ differenceUnits, agreement, availability }) => {
      const chainlinkPrice = (100_000_000n - BigInt(differenceUnits)).toString();
      const result = evaluateStablecoinValuation(
        dual(ASSETS.USDC, '100000000', chainlinkPrice, '0'),
      );

      expect(result.availability).toBe(availability);
      expect(result.sourceAgreement).toBe(agreement);
    },
  );

  it.each([
    { price: '99500000', band: 'NORMAL' },
    { price: '99499999', band: 'WATCH' },
    { price: '98000001', band: 'WATCH' },
    { price: '98000000', band: 'DEPEGGED' },
  ] as const)('classifies exact fractional downside for $price', ({ price, band }) => {
    const result = evaluateStablecoinValuation(
      request(ASSETS.USDC, [
        observation(ASSETS.USDC, {
          sourceId: 'CHAINLINK_DATA_FEEDS',
          priceMantissa: price,
        }),
      ]),
    );

    expect(result.availability).toBe('AVAILABLE');
    expect(result.downsideBand).toBe(band);
  });

  it('requires both <=25 bps divergence and <=25 bps Pyth confidence for MEDIUM', () => {
    const exact = evaluateStablecoinValuation(dual(ASSETS.USDC, '100000000', '99990000', '250000'));
    const oneUnitOver = evaluateStablecoinValuation(
      dual(ASSETS.USDC, '100000000', '99990000', '250001'),
    );

    expect(exact.confidenceClass).toBe('MEDIUM');
    expect(oneUnitOver.confidenceClass).toBe('LOW');
  });

  it.each([
    { ageMs: 60_000, eligibility: 'ELIGIBLE_CURRENT', availability: 'AVAILABLE' },
    { ageMs: 60_001, eligibility: 'STALE', availability: 'UNAVAILABLE' },
    { ageMs: 300_000, eligibility: 'STALE', availability: 'UNAVAILABLE' },
    { ageMs: 300_001, eligibility: 'EXPIRED', availability: 'UNAVAILABLE' },
  ] as const)(
    'enforces the absolute freshness boundary at $ageMs milliseconds',
    ({ ageMs, eligibility, availability }) => {
      const result = evaluateStablecoinValuation(
        request(ASSETS.USDC, [
          observation(ASSETS.USDC, {
            sourceId: 'PYTH_CORE',
            priceMantissa: '99990000',
            confidenceMantissa: '10000',
            ageMs,
          }),
        ]),
      );

      expect(result.availability).toBe(availability);
      expect(result.sourceAssessments[0]?.eligibility).toBe(eligibility);
    },
  );

  it('makes Pyth confidence above 50 bps ineligible without substituting a price', () => {
    const result = evaluateStablecoinValuation(
      request(ASSETS.USDC, [
        observation(ASSETS.USDC, {
          sourceId: 'PYTH_CORE',
          priceMantissa: '100000000',
          confidenceMantissa: '500001',
        }),
      ]),
    );

    expect(result).toMatchObject({
      availability: 'UNAVAILABLE',
      usdRateMantissa: null,
      usdValueMantissa: null,
    });
    expect(result.sourceAssessments[0]?.eligibility).toBe('WIDE_CONFIDENCE');
  });

  it('rejects duplicate sequences, timestamp regressions, and durable watermark replays', () => {
    const older = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
      sequence: '1',
      ageMs: 20_000,
      observedAt: timestampBefore(EVALUATED_AT, 1_000),
    });
    const duplicateSequence = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
      sequence: '1',
      ageMs: 10_000,
    });
    const duplicateResult = evaluateStablecoinValuation(
      request(ASSETS.USDC, [older, duplicateSequence]),
    );
    expect(duplicateResult.sourceAssessments[0]?.eligibility).toBe('NON_MONOTONIC_SEQUENCE');

    const equalTimestamp = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
      sequence: '2',
      pricedAt: older.pricedAt,
    });
    const equalTimestampResult = evaluateStablecoinValuation(
      request(ASSETS.USDC, [older, equalTimestamp]),
    );
    expect(equalTimestampResult.availability).toBe('AVAILABLE');

    const regressedTimestamp = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
      sequence: '2',
      pricedAt: timestampBefore(older.pricedAt, 1),
    });
    const regressedTimestampResult = evaluateStablecoinValuation(
      request(ASSETS.USDC, [older, regressedTimestamp]),
    );
    expect(regressedTimestampResult.sourceAssessments[0]?.eligibility).toBe(
      'NON_MONOTONIC_SEQUENCE',
    );

    const replay = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
      sequence: '7',
    });
    const replayRequest = {
      ...request(ASSETS.USDC, [replay]),
      sourceWatermarks: [
        {
          sourceId: 'PYTH_CORE',
          lastAcceptedSequence: '7',
          lastAcceptedPricedAt: replay.pricedAt,
          lastAcceptedObservedAt: replay.observedAt,
          lastAcceptedUpdateId: replay.sourceUpdateId,
        },
        STABLECOIN_VALUATION_FIRST_USE_WATERMARKS[1],
      ],
    };
    const replayResult = evaluateStablecoinValuation(replayRequest);
    expect(replayResult.availability).toBe('UNAVAILABLE');
    expect(replayResult.sourceAssessments[0]?.eligibility).toBe('REPLAYED_OR_REGRESSED');

    const nextUpdateWithRegressedObservedAt = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
      sequence: '8',
      pricedAt: replay.pricedAt,
      observedAt: timestampBefore(replay.observedAt, 1),
    });
    const regressedObservedAtResult = evaluateStablecoinValuation({
      ...request(ASSETS.USDC, [nextUpdateWithRegressedObservedAt]),
      sourceWatermarks: replayRequest.sourceWatermarks,
    });
    expect(regressedObservedAtResult.sourceAssessments[0]?.eligibility).toBe(
      'REPLAYED_OR_REGRESSED',
    );
  });

  it('matches the exact normal dual-source USDC vector', () => {
    const result = evaluateStablecoinValuation(dual(ASSETS.USDC, '100000000', '99980000'));

    expect(result).toMatchObject({
      availability: 'AVAILABLE',
      selection: 'CONSERVATIVE_MINIMUM',
      selectedSourceId: 'CHAINLINK_DATA_FEEDS',
      usdRateMantissa: '99980000',
      usdRateScale: 8,
      usdValueMantissa: '9998000000000000000',
      usdValueScale: 18,
      roundingMode: 'ROUND_HALF_EVEN',
      freshnessClass: 'CURRENT',
      confidenceClass: 'MEDIUM',
      depegClass: 'WITHIN_POLICY',
      downsideBand: 'NORMAL',
      sourceAgreement: 'CORROBORATED',
      mayIncreaseBuyingPower: false,
      mayAuthorizeFinancialUse: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceAssessments[0]?.observation)).toBe(true);
  });

  it('caps stablecoin upside at one USD without assuming a nominal peg', () => {
    const result = evaluateStablecoinValuation(dual(ASSETS.USDT, '100300000', '100280000'));

    expect(result).toMatchObject({
      availability: 'AVAILABLE',
      usdRateMantissa: '100000000',
      usdRateScale: 8,
      usdValueMantissa: '10000000000000000000',
      downsideBand: 'NORMAL',
    });
    expect(result.reasons).toContain('UPSIDE_CAPPED_AT_PEG');
    expect(
      result.sourceAssessments.map(
        ({ conservativeUsdRateMantissa }) => conservativeUsdRateMantissa,
      ),
    ).toEqual(['100290000', '100280000']);
  });

  it('keeps a 26-50 bps disagreement available at the conservative minimum and LOW', () => {
    const result = evaluateStablecoinValuation(dual(ASSETS.PYUSD, '99600000', '99150000', '20000'));

    expect(result).toMatchObject({
      availability: 'AVAILABLE',
      usdRateMantissa: '99150000',
      usdValueMantissa: '9915000000000000000',
      confidenceClass: 'LOW',
      sourceAgreement: 'SOFT_DISAGREEMENT',
      downsideBand: 'WATCH',
      depegClass: 'WITHIN_POLICY',
    });
  });

  it('preserves full corroborated downside and detects a depeg at 200 bps', () => {
    const result = evaluateStablecoinValuation(dual(ASSETS.USDC, '97500000', '97490000', '20000'));

    expect(result).toMatchObject({
      availability: 'AVAILABLE',
      selectedSourceId: 'PYTH_CORE',
      usdRateMantissa: '97480000',
      usdValueMantissa: '9748000000000000000',
      sourceAgreement: 'CORROBORATED',
      confidenceClass: 'MEDIUM',
      downsideBand: 'DEPEGGED',
      depegClass: 'OUTSIDE_POLICY',
    });
  });

  it('uses a current Pyth primary alone at its exact confidence lower bound', () => {
    const result = evaluateStablecoinValuation(
      request(ASSETS.USDT, [
        observation(ASSETS.USDT, {
          sourceId: 'PYTH_CORE',
          priceMantissa: '99860000',
          confidenceMantissa: '10000',
        }),
        observation(ASSETS.USDT, {
          sourceId: 'CHAINLINK_DATA_FEEDS',
          priceMantissa: '99870000',
          ageMs: 61_000,
        }),
      ]),
    );

    expect(result).toMatchObject({
      availability: 'AVAILABLE',
      selection: 'PRIMARY',
      sourceAgreement: 'SINGLE_SOURCE',
      confidenceClass: 'LOW',
      usdRateMantissa: '99850000',
      usdValueMantissa: '9985000000000000000',
    });
    expect(result.sourceAssessments[1]?.eligibility).toBe('STALE');
  });

  it('uses the exact current Chainlink fallback alone without inventing confidence', () => {
    const result = evaluateStablecoinValuation(
      request(ASSETS.PYUSD, [
        observation(ASSETS.PYUSD, {
          sourceId: 'PYTH_CORE',
          priceMantissa: '99750000',
          ageMs: 301_000,
        }),
        observation(ASSETS.PYUSD, {
          sourceId: 'CHAINLINK_DATA_FEEDS',
          priceMantissa: '99700000',
          ageMs: 40_000,
        }),
      ]),
    );

    expect(result).toMatchObject({
      availability: 'AVAILABLE',
      selection: 'FALLBACK',
      selectedSourceId: 'CHAINLINK_DATA_FEEDS',
      sourceAgreement: 'SINGLE_SOURCE',
      confidenceClass: 'LOW',
      usdRateMantissa: '99700000',
      usdValueMantissa: '9970000000000000000',
    });
    expect(result.sourceAssessments[1]?.observation?.confidence).toEqual({
      kind: 'NOT_PUBLISHED',
    });
  });

  it('nulls a hard source conflict while retaining both observations and a downside alarm', () => {
    const result = evaluateStablecoinValuation(dual(ASSETS.USDC, '100000000', '97000000'));

    expect(result).toMatchObject({
      availability: 'UNAVAILABLE',
      selection: 'NONE',
      selectedSourceId: null,
      usdRateMantissa: null,
      usdRateScale: null,
      usdValueMantissa: null,
      sourceAgreement: 'CONFLICT',
      confidenceClass: 'UNAVAILABLE',
      downsideBand: 'DEPEGGED',
      depegClass: 'OUTSIDE_POLICY',
      reportingUse: 'BLOCKED',
    });
    expect(result.reasons).toEqual(['SOURCE_CONFLICT', 'DEPEG_DETECTED']);
    expect(result.sourceAssessments.every(({ observation: value }) => value !== null)).toBe(true);
  });

  it('makes stale-only evidence unavailable and never fills missing price with one or zero', () => {
    const result = evaluateStablecoinValuation(
      request(ASSETS.USDT, [
        observation(ASSETS.USDT, {
          sourceId: 'PYTH_CORE',
          priceMantissa: '99900000',
          ageMs: 61_000,
        }),
        observation(ASSETS.USDT, {
          sourceId: 'CHAINLINK_DATA_FEEDS',
          priceMantissa: '99900000',
          ageMs: 301_000,
        }),
      ]),
    );

    expect(result).toMatchObject({
      availability: 'UNAVAILABLE',
      selectedSourceId: null,
      usdRateMantissa: null,
      usdValueMantissa: null,
      sourceAgreement: 'NOT_AVAILABLE',
      freshnessClass: 'UNAVAILABLE',
    });
    expect(result.sourceAssessments.map(({ eligibility }) => eligibility)).toEqual([
      'STALE',
      'EXPIRED',
    ]);
  });
});

describe('stablecoin valuation parser boundaries', () => {
  it.each([
    null,
    [],
    { ...dual(ASSETS.USDC, '100000000', '99990000'), extra: true },
    {
      ...dual(ASSETS.USDC, '100000000', '99990000'),
      amountAtomic: '010000000',
    },
    {
      ...dual(ASSETS.USDC, '100000000', '99990000'),
      asset: { ...ASSETS.USDC, registryFingerprintSha256: '0'.repeat(64) },
    },
    {
      ...dual(ASSETS.USDC, '100000000', '99990000'),
      asset: {
        ...ASSETS.USDC,
        registryEnvironment: 'TESTNET',
        networkId: 'eip155:11155111',
        identity: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
      },
    },
    {
      ...dual(ASSETS.USDC, '100000000', '99990000'),
      sourceWatermarks: [STABLECOIN_VALUATION_FIRST_USE_WATERMARKS[0]],
    },
  ])('fails closed for malformed top-level input %#', (input) => {
    expect(evaluateStablecoinValuation(input)).toMatchObject({
      availability: 'UNAVAILABLE',
      asset: null,
      usdRateMantissa: null,
      reasons: ['INVALID_INPUT'],
      mayAuthorizeFinancialUse: false,
    });
  });

  it('requires an all-null first-use checkpoint or a complete causally ordered checkpoint', () => {
    const populatedCheckpoint = {
      sourceId: 'PYTH_CORE' as const,
      lastAcceptedSequence: '1',
      lastAcceptedPricedAt: '2026-08-22T11:59:50.000Z',
      lastAcceptedObservedAt: '2026-08-22T11:59:51.000Z',
      lastAcceptedUpdateId: '1'.padStart(64, '0'),
    };
    const checkpointFields = [
      'lastAcceptedSequence',
      'lastAcceptedPricedAt',
      'lastAcceptedObservedAt',
      'lastAcceptedUpdateId',
    ] as const;
    const partialNullCheckpoints = checkpointFields.map((field) => ({
      ...populatedCheckpoint,
      [field]: null,
    }));
    const causallyInvertedCheckpoint = {
      ...populatedCheckpoint,
      lastAcceptedPricedAt: '2026-08-22T11:59:52.000Z',
    };

    for (const invalidCheckpoint of [...partialNullCheckpoints, causallyInvertedCheckpoint]) {
      expect(
        evaluateStablecoinValuation({
          ...request(ASSETS.USDC, []),
          sourceWatermarks: [invalidCheckpoint, STABLECOIN_VALUATION_FIRST_USE_WATERMARKS[1]],
        }),
      ).toMatchObject({
        availability: 'UNAVAILABLE',
        asset: null,
        reasons: ['INVALID_INPUT'],
      });
    }
  });

  it('rejects getters and proxies without invoking them as trusted source evidence', () => {
    const base = dual(ASSETS.USDC, '100000000', '99990000');
    const getterInput = { ...base } as Record<string, unknown>;
    Object.defineProperty(getterInput, 'asset', {
      enumerable: true,
      get: () => ASSETS.USDC,
    });
    const proxy = new Proxy(base, {
      ownKeys: () => {
        throw new Error('untrusted trap');
      },
    });

    expect(evaluateStablecoinValuation(getterInput).reasons).toEqual(['INVALID_INPUT']);
    expect(evaluateStablecoinValuation(proxy).reasons).toEqual(['INVALID_INPUT']);
  });

  it('binds every observation to the exact asset feed and source-specific confidence contract', () => {
    const pyth = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
    });
    const wrongFeed = {
      ...pyth,
      sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES.USDT.PYTH_CORE,
    };
    const wrongAsset = { ...pyth, asset: ASSETS.USDT };
    const missingConfidence = { ...pyth, confidence: { kind: 'NOT_PUBLISHED' } };
    const chainlink = observation(ASSETS.USDC, {
      sourceId: 'CHAINLINK_DATA_FEEDS',
      priceMantissa: '99990000',
    });
    const inventedChainlinkConfidence = {
      ...chainlink,
      confidence: { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '0', scale: 8 },
    };

    for (const invalidObservation of [
      wrongFeed,
      wrongAsset,
      missingConfidence,
      inventedChainlinkConfidence,
    ]) {
      expect(
        evaluateStablecoinValuation({
          ...request(ASSETS.USDC, []),
          observations: [invalidObservation],
        }).reasons,
      ).toEqual(['INVALID_INPUT']);
    }
  });

  it('requires exact scale-8 integer values and source-specific update identifiers', () => {
    const pyth = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
    });
    const chainlink = observation(ASSETS.USDC, {
      sourceId: 'CHAINLINK_DATA_FEEDS',
      priceMantissa: '99990000',
    });
    const invalidObservations = [
      { ...pyth, usdRateMantissa: '9.999' },
      { ...pyth, usdRateMantissa: '1e8' },
      { ...pyth, usdRateScale: 7 },
      { ...pyth, sourceUpdateId: 'not-a-verified-update-digest' },
      { ...chainlink, sourceUpdateId: 'different-from-round-id' },
      { ...pyth, unknown: true },
    ];

    for (const invalidObservation of invalidObservations) {
      expect(
        evaluateStablecoinValuation({
          ...request(ASSETS.USDC, []),
          observations: [invalidObservation],
        }).reasons,
      ).toEqual(['INVALID_INPUT']);
    }
  });

  it('marks future evidence unavailable and does not let a provider heartbeat extend freshness', () => {
    const future = observation(ASSETS.USDC, {
      sourceId: 'PYTH_CORE',
      priceMantissa: '99990000',
      pricedAt: '2026-08-22T12:00:00.001Z',
      observedAt: '2026-08-22T12:00:00.001Z',
    });
    const result = evaluateStablecoinValuation(request(ASSETS.USDC, [future]));

    expect(result.availability).toBe('UNAVAILABLE');
    expect(result.sourceAssessments[0]?.eligibility).toBe('FUTURE_TIMESTAMP');
    expect(STABLECOIN_VALUATION_POLICY.freshness.providerHeartbeatMayExtendRiskLimit).toBe(false);
  });
});

describe('stablecoin depeg recovery policy', () => {
  it('requires manual Risk clear after four exact corroborated samples spanning 1800 seconds', () => {
    const samples = recoverySamples();
    const pending = evaluateStablecoinRecovery(recoveryRequest(samples));
    const clear = manualRiskClear();
    const clearedCandidate = evaluateStablecoinRecovery(
      recoveryRequest(samples, { manualRiskClear: clear }),
    );

    expect(pending).toMatchObject({
      status: 'MANUAL_RISK_CLEAR_REQUIRED',
      evidenceCount: 4,
      evidenceSpanMs: 1_800_000,
      reasons: ['MANUAL_RISK_CLEAR_REQUIRED'],
      manualRiskClearAccepted: false,
      acceptedManualRiskClear: null,
      mayAuthorizeFinancialUse: false,
    });
    expect(clearedCandidate).toMatchObject({
      status: 'RECOVERY_CANDIDATE_CLEARED',
      reasons: ['LOCAL_CANDIDATE_CLEAR_ONLY'],
      manualRiskClearAccepted: true,
      acceptedManualRiskClear: clear,
      mayIncreaseBuyingPower: false,
      mayAuthorizeFinancialUse: false,
    });
  });

  it('accepts equal source timestamps when evaluation time, sequence, and update ID advance', () => {
    const first = recoverySample(0);
    const firstPyth = first.observations[0] as StablecoinPriceObservation;
    const firstChainlink = first.observations[1] as StablecoinPriceObservation;
    const evaluatedAt = '2026-08-22T10:00:01.000Z';
    const second: StablecoinRecoverySample = {
      evaluatedAt,
      observations: [
        observation(ASSETS.PYUSD, {
          sourceId: 'PYTH_CORE',
          priceMantissa: '99990000',
          confidenceMantissa: '5000',
          evaluatedAt,
          pricedAt: firstPyth.pricedAt,
          observedAt: firstPyth.observedAt,
          sequence: '2',
        }),
        observation(ASSETS.PYUSD, {
          sourceId: 'CHAINLINK_DATA_FEEDS',
          priceMantissa: '99980000',
          evaluatedAt,
          pricedAt: firstChainlink.pricedAt,
          observedAt: firstChainlink.observedAt,
          sequence: '2',
        }),
      ],
    };
    const samples = [
      first,
      second,
      recoverySample(1, { sequenceOffset: 1 }),
      recoverySample(2, { sequenceOffset: 1 }),
      recoverySample(3, { sequenceOffset: 1 }),
    ];

    expect(evaluateStablecoinRecovery(recoveryRequest(samples))).toMatchObject({
      status: 'MANUAL_RISK_CLEAR_REQUIRED',
      evidenceCount: 5,
      evidenceSpanMs: 1_800_000,
    });
  });

  it('does not apply recovery without a prior depeg latch', () => {
    expect(
      evaluateStablecoinRecovery(
        recoveryRequest(recoverySamples(), { depegLatch: null, manualRiskClear: null }),
      ),
    ).toMatchObject({
      status: 'NOT_APPLICABLE',
      reasons: ['NO_PRIOR_DEPEG_LATCH'],
      manualRiskClearAccepted: false,
    });
  });

  it('rejects recovery evidence before its asset-bound latch or after the trusted evaluation time', () => {
    const preLatch = evaluateStablecoinRecovery(
      recoveryRequest(recoverySamples(), {
        depegLatch: depegLatch(ASSETS.PYUSD, {
          latchedAt: '2026-08-22T10:00:00.000Z',
        }),
      }),
    );
    const futureEvidence = evaluateStablecoinRecovery(
      recoveryRequest(recoverySamples(), {
        evaluatedAt: '2026-08-22T10:29:59.999Z',
      }),
    );
    const futureLatch = evaluateStablecoinRecovery(
      recoveryRequest([], {
        evaluatedAt: '2026-08-22T10:30:00.000Z',
        depegLatch: depegLatch(ASSETS.PYUSD, {
          latchedAt: '2026-08-22T10:30:00.001Z',
        }),
      }),
    );

    expect(preLatch).toMatchObject({
      status: 'RECOVERY_PENDING',
      reasons: expect.arrayContaining(['EVIDENCE_PRECEDES_DEPEG_LATCH']),
    });
    expect(futureEvidence).toMatchObject({
      status: 'RECOVERY_PENDING',
      reasons: expect.arrayContaining(['EVIDENCE_AFTER_RECOVERY_EVALUATION']),
    });
    expect(futureLatch).toMatchObject({
      status: 'RECOVERY_PENDING',
      reasons: expect.arrayContaining(['DEPEG_LATCH_AFTER_RECOVERY_EVALUATION']),
    });
  });

  it('requires a matching clear at or after final evidence and at or before evaluation', () => {
    const samples = recoverySamples();
    const cases = [
      {
        clear: manualRiskClear(ASSETS.PYUSD, { latchId: 'e'.repeat(64) }),
        reason: 'MANUAL_RISK_CLEAR_LATCH_MISMATCH',
      },
      {
        clear: manualRiskClear(ASSETS.PYUSD, {
          clearedAt: '2026-08-22T10:29:59.999Z',
        }),
        reason: 'MANUAL_RISK_CLEAR_PRECEDES_FINAL_SAMPLE',
      },
      {
        clear: manualRiskClear(ASSETS.PYUSD, {
          clearedAt: '2026-08-22T10:30:00.001Z',
        }),
        reason: 'MANUAL_RISK_CLEAR_AFTER_RECOVERY_EVALUATION',
      },
    ] as const;

    for (const { clear, reason } of cases) {
      expect(
        evaluateStablecoinRecovery(recoveryRequest(samples, { manualRiskClear: clear })),
      ).toMatchObject({
        status: 'MANUAL_RISK_CLEAR_REQUIRED',
        acceptedManualRiskClear: null,
        manualRiskClearAccepted: false,
        reasons: [reason],
      });
    }
  });

  it('fails closed for malformed, cross-asset, or non-distinct latch and clear references', () => {
    const samples = recoverySamples();
    const validLatch = depegLatch();
    const validClear = manualRiskClear();
    const malformedRequests: unknown[] = [
      recoveryRequest(samples, { depegLatch: null, manualRiskClear: validClear }),
      recoveryRequest(samples, { depegLatch: { ...validLatch, asset: ASSETS.USDC } }),
      recoveryRequest(samples, {
        manualRiskClear: { ...validClear, asset: ASSETS.USDC },
      }),
      recoveryRequest(samples, {
        manualRiskClear: { ...validClear, clearId: validLatch.latchId },
      }),
      recoveryRequest(samples, {
        depegLatch: { ...validLatch, latchId: 'D'.repeat(64) },
      }),
      {
        ...recoveryRequest(samples),
        depegLatch: { ...validLatch, unexpected: true },
      },
    ];

    for (const malformed of malformedRequests) {
      expect(evaluateStablecoinRecovery(malformed)).toMatchObject({
        status: 'INVALID_INPUT',
        asset: null,
        depegLatch: null,
        acceptedManualRiskClear: null,
        reasons: ['INVALID_INPUT'],
        mayAuthorizeFinancialUse: false,
      });
    }
  });

  it('rejects fewer than four samples and a span one millisecond below 1800 seconds', () => {
    const tooFew = evaluateStablecoinRecovery(
      recoveryRequest(recoverySamples().slice(0, 3), { manualRiskClear: manualRiskClear() }),
    );
    const tooShort = evaluateStablecoinRecovery(
      recoveryRequest(recoverySamples({ intervalMs: 599_999 }), {
        manualRiskClear: manualRiskClear(),
      }),
    );

    expect(tooFew.status).toBe('RECOVERY_PENDING');
    expect(tooFew.reasons).toContain('INSUFFICIENT_DISTINCT_OBSERVATIONS');
    expect(tooShort.evidenceSpanMs).toBe(1_799_997);
    expect(tooShort.reasons).toContain('INSUFFICIENT_OBSERVATION_SPAN');
  });

  it('rejects duplicate, non-monotonic, and equal-time evidence', () => {
    const duplicate = [...recoverySamples()];
    duplicate[2] = duplicate[1] as StablecoinRecoverySample;
    const nonMonotonic = [...recoverySamples()];
    const second = nonMonotonic[1];
    nonMonotonic[1] = nonMonotonic[2] as StablecoinRecoverySample;
    nonMonotonic[2] = second as StablecoinRecoverySample;

    for (const samples of [duplicate, nonMonotonic]) {
      const result = evaluateStablecoinRecovery(
        recoveryRequest(samples, { manualRiskClear: manualRiskClear() }),
      );
      expect(result.status).toBe('RECOVERY_PENDING');
      expect(result.reasons).toContain('NON_MONOTONIC_EVIDENCE');
    }
  });

  it('rejects a non-adjacent replayed update identity across the recovery window', () => {
    const samples = [...recoverySamples()];
    const first = samples[0] as StablecoinRecoverySample;
    const third = samples[2] as StablecoinRecoverySample;
    const firstPyth = first.observations[0] as StablecoinPriceObservation;
    const thirdPyth = third.observations[0] as StablecoinPriceObservation;
    samples[2] = {
      ...third,
      observations: [
        { ...thirdPyth, sourceUpdateId: firstPyth.sourceUpdateId },
        third.observations[1] as StablecoinPriceObservation,
      ],
    };

    expect(
      evaluateStablecoinRecovery(recoveryRequest(samples, { manualRiskClear: manualRiskClear() })),
    ).toMatchObject({
      status: 'RECOVERY_PENDING',
      reasons: expect.arrayContaining(['NON_MONOTONIC_EVIDENCE']),
      manualRiskClearAccepted: false,
    });
  });

  it('rejects stale, >25 bps disagreement, >25 bps confidence, and >25 bps downside', () => {
    const cases = [
      recoverySamples({ pythAgeMs: 60_001 }),
      recoverySamples({ pythPrice: '99990000', chainlinkPrice: '99739999' }),
      recoverySamples({ pythConfidence: '250001' }),
      recoverySamples({ pythPrice: '99750000', chainlinkPrice: '99740000', pythConfidence: '0' }),
    ];
    const expectedReasons = [
      'OBSERVATION_NOT_CURRENT',
      'OBSERVATION_NOT_CORROBORATED',
      'OBSERVATION_NOT_CORROBORATED',
      'OBSERVATION_OUTSIDE_REPEG_BAND',
    ];

    for (const [index, samples] of cases.entries()) {
      const result = evaluateStablecoinRecovery(
        recoveryRequest(samples, { manualRiskClear: manualRiskClear() }),
      );
      expect(result.status).toBe('RECOVERY_PENDING');
      expect(result.reasons).toContain(expectedReasons[index]);
      expect(result.mayAuthorizeFinancialUse).toBe(false);
    }
  });

  it('requires exactly one Pyth and one Chainlink observation in every recovery sample', () => {
    const samples = [...recoverySamples()];
    const first = samples[0] as StablecoinRecoverySample;
    samples[0] = {
      ...first,
      observations: [first.observations[0], first.observations[0]],
    } as StablecoinRecoverySample;

    expect(
      evaluateStablecoinRecovery(recoveryRequest(samples, { manualRiskClear: manualRiskClear() })),
    ).toMatchObject({ status: 'INVALID_INPUT', reasons: ['INVALID_INPUT'] });
  });
});
