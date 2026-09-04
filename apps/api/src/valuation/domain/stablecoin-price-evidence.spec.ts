import type { RecordStablecoinPriceEvidenceRequest } from '../application/ports/stablecoin-price-evidence-store.port';
import {
  normalizeStablecoinPriceEvidenceAsset,
  normalizeStablecoinPriceEvidenceCommand,
  normalizeStablecoinPriceObservation,
  StablecoinPriceEvidenceValidationError,
} from './stablecoin-price-evidence';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  type StablecoinPriceObservation,
  type StablecoinValuationAssetReference,
} from './stablecoin-valuation-policy';

const FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const ASSET: StablecoinValuationAssetReference = Object.freeze({
  registryEnvironment: 'MAINNET',
  registryVersion: 1,
  registryFingerprintSha256: FINGERPRINT,
  stablecoin: 'USDC',
  networkId: 'eip155:1',
  identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
});

function observation(
  overrides: Partial<StablecoinPriceObservation> = {},
): StablecoinPriceObservation {
  return {
    asset: ASSET,
    sourceId: 'PYTH_CORE',
    sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES.USDC.PYTH_CORE,
    sourceSequence: '42',
    sourceUpdateId: 'a'.repeat(64),
    pricedAt: '2026-09-04T11:59:58.000Z',
    observedAt: '2026-09-04T12:00:00.000Z',
    usdRateMantissa: '99990000',
    usdRateScale: 8,
    confidence: { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '5000', scale: 8 },
    ...overrides,
  };
}

function request(
  overrides: Partial<RecordStablecoinPriceEvidenceRequest> = {},
): RecordStablecoinPriceEvidenceRequest {
  return {
    correlationId: '11111111-1111-4111-8111-111111111111',
    evidenceActorReferenceId: 'pyth-adapter:mainnet-v1',
    evidenceFingerprintSha256: 'b'.repeat(64),
    verifiedAt: '2026-09-04T12:00:00.000Z',
    observation: observation(),
    ...overrides,
  };
}

describe('stablecoin price evidence normalization', () => {
  it('normalizes one exact launch asset and produces deterministic independent identities', () => {
    const first = normalizeStablecoinPriceEvidenceCommand(request());
    const replay = normalizeStablecoinPriceEvidenceCommand(request());

    expect(first).toEqual(replay);
    expect(first.schemaVersion).toBe(1);
    for (const digest of [
      first.evidenceId,
      first.observationId,
      first.commandFingerprintSha256,
      first.watermarkEventId,
      first.watermarkEventFingerprintSha256,
    ]) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(
      new Set([
        first.evidenceId,
        first.observationId,
        first.commandFingerprintSha256,
        first.watermarkEventId,
        first.watermarkEventFingerprintSha256,
      ]).size,
    ).toBe(5);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.observation)).toBe(true);
  });

  it('binds evidence to the exact registry version, launch networks, and active identity', () => {
    expect(normalizeStablecoinPriceEvidenceAsset(ASSET)).toEqual(ASSET);
    for (const asset of [
      { ...ASSET, registryVersion: 2 },
      { ...ASSET, registryFingerprintSha256: '0'.repeat(64) },
      { ...ASSET, networkId: 'eip155:8453' },
      { ...ASSET, identity: '0x0000000000000000000000000000000000000000' },
      { ...ASSET, decimals: 18 },
    ]) {
      expect(() => normalizeStablecoinPriceEvidenceAsset(asset)).toThrow(
        StablecoinPriceEvidenceValidationError,
      );
    }
  });

  it('enforces source-specific references, update IDs, and confidence models', () => {
    expect(() =>
      normalizeStablecoinPriceObservation(
        observation({ sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES.USDT.PYTH_CORE }),
      ),
    ).toThrow(StablecoinPriceEvidenceValidationError);
    expect(() =>
      normalizeStablecoinPriceObservation(observation({ sourceUpdateId: '42' })),
    ).toThrow(StablecoinPriceEvidenceValidationError);
    expect(() =>
      normalizeStablecoinPriceObservation(observation({ confidence: { kind: 'NOT_PUBLISHED' } })),
    ).toThrow(StablecoinPriceEvidenceValidationError);

    const chainlink = normalizeStablecoinPriceObservation(
      observation({
        sourceId: 'CHAINLINK_DATA_FEEDS',
        sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES.USDC.CHAINLINK_DATA_FEEDS,
        sourceSequence: '77',
        sourceUpdateId: '77',
        confidence: { kind: 'NOT_PUBLISHED' },
      }),
    );
    expect(chainlink.sourceId).toBe('CHAINLINK_DATA_FEEDS');
  });

  it('rejects non-canonical numbers, time regressions, and verification before receipt', () => {
    for (const candidate of [
      observation({ sourceSequence: '01' }),
      observation({ sourceSequence: '0' }),
      observation({ usdRateMantissa: '01' }),
      observation({ usdRateScale: 7 }),
      observation({ pricedAt: '2026-09-04T12:00:00.001Z' }),
    ]) {
      expect(() => normalizeStablecoinPriceObservation(candidate)).toThrow(
        StablecoinPriceEvidenceValidationError,
      );
    }
    expect(() =>
      normalizeStablecoinPriceEvidenceCommand(request({ verifiedAt: '2026-09-04T11:59:59.999Z' })),
    ).toThrow(StablecoinPriceEvidenceValidationError);
  });

  it('rejects extra properties, custom prototypes, and accessor-bearing input', () => {
    expect(() =>
      normalizeStablecoinPriceEvidenceCommand({ ...request(), unexpected: true }),
    ).toThrow(StablecoinPriceEvidenceValidationError);
    expect(() =>
      normalizeStablecoinPriceEvidenceCommand(
        Object.assign(Object.create({ inherited: true }) as object, request()),
      ),
    ).toThrow(StablecoinPriceEvidenceValidationError);
    const accessor = { ...request() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'verifiedAt', {
      enumerable: true,
      get: () => '2026-09-04T12:00:00.000Z',
    });
    expect(() => normalizeStablecoinPriceEvidenceCommand(accessor)).toThrow(
      StablecoinPriceEvidenceValidationError,
    );
  });
});
