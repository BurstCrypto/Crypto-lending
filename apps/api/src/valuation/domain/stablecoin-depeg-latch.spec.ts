import { randomUUID } from 'node:crypto';

import type {
  ClearStablecoinDepegLatchRequest,
  RecordStablecoinDepegLatchRequest,
  StablecoinDepegRecoveryAuthorization,
} from '../application/ports/stablecoin-depeg-latch.port';
import {
  fingerprintStablecoinDepegEvidence,
  fingerprintStablecoinDepegRecoveryAuthorization,
  fingerprintStablecoinDepegRecoveryEvidence,
  normalizeClearStablecoinDepegLatchCommand,
  normalizeRecordStablecoinDepegLatchCommand,
  normalizeStablecoinDepegLatchAsset,
  stablecoinDepegRecoveryAuthorizationId,
  StablecoinDepegLatchValidationError,
  STABLECOIN_DEPEG_RECOVERY_AUTHORIZATION_MAXIMUM_AGE_MILLISECONDS,
  type StablecoinDepegRecoveryAuthorizationFingerprintMaterial,
} from './stablecoin-depeg-latch';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  type StablecoinPriceObservation,
  type StablecoinRecoveryRequest,
  type StablecoinRecoverySample,
  type StablecoinValuationAssetReference,
  type StablecoinValuationRequest,
  type StablecoinValuationSourceId,
} from './stablecoin-valuation-policy';

const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const LATCH_ID = 'd'.repeat(64);
const CLEAR_ID = 'c'.repeat(64);
const DEPEG_AT = '2026-08-22T09:59:00.000Z';
const RECOVERY_AT = '2026-08-22T10:30:00.000Z';

const ASSET: StablecoinValuationAssetReference = Object.freeze({
  registryEnvironment: 'MAINNET',
  registryVersion: 1,
  registryFingerprintSha256: REGISTRY_FINGERPRINT,
  stablecoin: 'PYUSD',
  networkId: 'eip155:1',
  identity: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
  decimals: 6,
});

const SOLANA_ASSET: StablecoinValuationAssetReference = Object.freeze({
  registryEnvironment: 'MAINNET',
  registryVersion: 1,
  registryFingerprintSha256: REGISTRY_FINGERPRINT,
  stablecoin: 'USDC',
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  identity: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
});

function observation(
  asset: StablecoinValuationAssetReference,
  sourceId: StablecoinValuationSourceId,
  evaluatedAt: string,
  sequence: string,
  priceMantissa: string,
): StablecoinPriceObservation {
  return {
    asset,
    sourceId,
    sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin][sourceId],
    sourceSequence: sequence,
    sourceUpdateId: sourceId === 'PYTH_CORE' ? sequence.padStart(64, '0') : sequence,
    pricedAt: new Date(Date.parse(evaluatedAt) - 3_000).toISOString(),
    observedAt: evaluatedAt,
    usdRateMantissa: priceMantissa,
    usdRateScale: 8,
    confidence:
      sourceId === 'PYTH_CORE'
        ? { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '5000', scale: 8 }
        : { kind: 'NOT_PUBLISHED' },
  };
}

function valuationRequest(price = '97000000'): StablecoinValuationRequest {
  return {
    asset: ASSET,
    amountAtomic: '1000000',
    evaluatedAt: DEPEG_AT,
    sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
    observations: [
      observation(ASSET, 'PYTH_CORE', DEPEG_AT, '1', price),
      observation(ASSET, 'CHAINLINK_DATA_FEEDS', DEPEG_AT, '1', price),
    ],
  };
}

function recordRequest(
  overrides: Partial<RecordStablecoinDepegLatchRequest> = {},
): RecordStablecoinDepegLatchRequest {
  const request = valuationRequest();
  const evidenceActorReferenceId = 'risk-evidence:unit-test';
  return {
    expectedRevision: null,
    correlationId: '11111111-1111-4111-8111-111111111111',
    latchId: LATCH_ID,
    evidenceActorReferenceId,
    depegEvidenceFingerprintSha256: fingerprintStablecoinDepegEvidence({
      evidenceActorReferenceId,
      valuationRequest: request,
    }),
    valuationRequest: request,
    ...overrides,
  };
}

function recoverySample(index: number): StablecoinRecoverySample {
  const evaluatedAt = new Date(
    Date.parse('2026-08-22T10:00:00.000Z') + index * 600_000,
  ).toISOString();
  const sequence = String(index + 1);
  return {
    evaluatedAt,
    observations: [
      observation(ASSET, 'PYTH_CORE', evaluatedAt, sequence, '99990000'),
      observation(ASSET, 'CHAINLINK_DATA_FEEDS', evaluatedAt, sequence, '99980000'),
    ],
  };
}

function recoveryRequest(
  overrides: Partial<StablecoinRecoveryRequest> = {},
): StablecoinRecoveryRequest {
  return {
    asset: ASSET,
    evaluatedAt: RECOVERY_AT,
    depegLatch: { asset: ASSET, latchId: LATCH_ID, latchedAt: DEPEG_AT },
    manualRiskClear: {
      asset: ASSET,
      clearId: CLEAR_ID,
      latchId: LATCH_ID,
      clearedAt: RECOVERY_AT,
    },
    samples: [0, 1, 2, 3].map(recoverySample),
    ...overrides,
  };
}

function authorizationMaterial(
  recovery: StablecoinRecoveryRequest,
  overrides: Partial<StablecoinDepegRecoveryAuthorizationFingerprintMaterial> = {},
): StablecoinDepegRecoveryAuthorizationFingerprintMaterial {
  return {
    schemaVersion: 1,
    authorizationType: 'STABLECOIN_DEPEG_LATCH_RECOVERY',
    scope: 'DEPEG_LATCH_CLEAR_ONLY',
    mayAuthorizeFinancialAction: false,
    operation: 'CLEAR_STABLECOIN_DEPEG_LATCH',
    asset: ASSET,
    expectedLatchId: LATCH_ID,
    expectedRevision: 1,
    clearId: CLEAR_ID,
    recoveryEvidenceFingerprintSha256: fingerprintStablecoinDepegRecoveryEvidence(recovery),
    evidenceActorReferenceId: 'risk-evidence:unit-test',
    riskApproverReferenceId: 'risk-approver:unit-test',
    riskApproverRole: 'RISK_APPROVER',
    issuedAt: RECOVERY_AT,
    notBefore: RECOVERY_AT,
    expiresAt: '2026-08-22T10:40:00.000Z',
    nonce: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

function authorization(
  recovery: StablecoinRecoveryRequest,
  overrides: Partial<StablecoinDepegRecoveryAuthorizationFingerprintMaterial> = {},
): StablecoinDepegRecoveryAuthorization {
  const material = authorizationMaterial(recovery, overrides);
  const fingerprint = fingerprintStablecoinDepegRecoveryAuthorization(material);
  return {
    ...material,
    authorizationFingerprintSha256: fingerprint,
    authorizationId: stablecoinDepegRecoveryAuthorizationId(fingerprint),
  };
}

function clearRequest(
  overrides: Partial<ClearStablecoinDepegLatchRequest> = {},
): ClearStablecoinDepegLatchRequest {
  const recovery = recoveryRequest();
  return {
    evaluatedAt: RECOVERY_AT,
    correlationId: '33333333-3333-4333-8333-333333333333',
    recoveryRequest: recovery,
    authorization: authorization(recovery),
    ...overrides,
  };
}

function expectValidationCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error('Expected stablecoin latch validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(StablecoinDepegLatchValidationError);
    expect((error as StablecoinDepegLatchValidationError).code).toBe(code);
    expect((error as Error).message).toBe('Stablecoin depeg latch input is invalid');
  }
}

describe('stablecoin depeg latch commands', () => {
  it('binds exact KAN-61 Ethereum and Solana assets and rejects identity drift', () => {
    expect(normalizeStablecoinDepegLatchAsset(ASSET)).toEqual(ASSET);
    expect(normalizeStablecoinDepegLatchAsset(SOLANA_ASSET)).toEqual(SOLANA_ASSET);
    expectValidationCode(
      () => normalizeStablecoinDepegLatchAsset({ ...ASSET, decimals: 18 }),
      'INVALID_DEPEG_LATCH_ASSET',
    );
    expectValidationCode(
      () => normalizeStablecoinDepegLatchAsset({ ...ASSET, networkId: 'eip155:8453' }),
      'INVALID_DEPEG_LATCH_ASSET',
    );
  });

  it('normalizes a classifier-confirmed depeg into deterministic command and event fingerprints', () => {
    const request = recordRequest();
    const first = normalizeRecordStablecoinDepegLatchCommand(request);
    const second = normalizeRecordStablecoinDepegLatchCommand({ ...request });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      asset: ASSET,
      expectedRevision: null,
      latchId: LATCH_ID,
      latchedAt: DEPEG_AT,
    });
    expect(first.commandFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.eventFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.eventFingerprintSha256).not.toBe(first.commandFingerprintSha256);
  });

  it('rejects non-depeg evidence, evidence substitution, accessors, and prototype pollution', () => {
    const nonDepeg = valuationRequest('99990000');
    expectValidationCode(
      () =>
        normalizeRecordStablecoinDepegLatchCommand(recordRequest({ valuationRequest: nonDepeg })),
      'VALUATION_DID_NOT_DETECT_DEPEG',
    );
    expectValidationCode(
      () =>
        normalizeRecordStablecoinDepegLatchCommand(
          recordRequest({ depegEvidenceFingerprintSha256: '0'.repeat(64) }),
        ),
      'DEPEG_EVIDENCE_FINGERPRINT_MISMATCH',
    );
    const getter = recordRequest() as unknown as Record<string, unknown>;
    Object.defineProperty(getter, 'latchId', { enumerable: true, get: () => LATCH_ID });
    expectValidationCode(
      () => normalizeRecordStablecoinDepegLatchCommand(getter as never),
      'INVALID_DEPEG_LATCH_INPUT',
    );
    const polluted = Object.assign(Object.create({ expectedRevision: null }), recordRequest());
    expectValidationCode(
      () => normalizeRecordStablecoinDepegLatchCommand(polluted),
      'INVALID_DEPEG_LATCH_INPUT',
    );
  });

  it('accepts only pure-classifier-cleared recovery evidence and a matching one-use authorization', () => {
    const request = clearRequest();
    const command = normalizeClearStablecoinDepegLatchCommand(request);

    expect(command).toMatchObject({
      asset: ASSET,
      latchId: LATCH_ID,
      clearId: CLEAR_ID,
      expectedRevision: 1,
      evaluatedAt: RECOVERY_AT,
      evidenceActorReferenceId: 'risk-evidence:unit-test',
      riskApproverReferenceId: 'risk-approver:unit-test',
    });
    expect(command.authorizationId).toBe(
      stablecoinDepegRecoveryAuthorizationId(command.authorizationFingerprintSha256),
    );
  });

  it('rejects pending recovery and mismatched asset/evidence/time bindings', () => {
    const pending = recoveryRequest({ manualRiskClear: null });
    expectValidationCode(
      () =>
        normalizeClearStablecoinDepegLatchCommand(
          clearRequest({
            recoveryRequest: pending,
            authorization: authorization(recoveryRequest()),
          }),
        ),
      'RECOVERY_NOT_CLEARED',
    );

    const base = recoveryRequest();
    for (const changed of [
      authorization(base, { asset: SOLANA_ASSET }),
      authorization(base, { recoveryEvidenceFingerprintSha256: 'a'.repeat(64) }),
      authorization(base, { expectedLatchId: 'a'.repeat(64) }),
      authorization(base, { clearId: 'b'.repeat(64) }),
    ]) {
      expectValidationCode(
        () => normalizeClearStablecoinDepegLatchCommand(clearRequest({ authorization: changed })),
        'DEPEG_RECOVERY_AUTHORIZATION_MISMATCH',
      );
    }

    expectValidationCode(
      () =>
        normalizeClearStablecoinDepegLatchCommand(
          clearRequest({ evaluatedAt: '2026-08-22T10:40:00.000Z' }),
        ),
      'DEPEG_RECOVERY_AUTHORIZATION_MISMATCH',
    );
  });

  it('rejects forged, overlong, malformed, or same-actor authorizations', () => {
    const recovery = recoveryRequest();
    const forged = { ...authorization(recovery), authorizationFingerprintSha256: '0'.repeat(64) };
    expectValidationCode(
      () => normalizeClearStablecoinDepegLatchCommand(clearRequest({ authorization: forged })),
      'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
    );
    expectValidationCode(
      () =>
        authorization(recovery, {
          expiresAt: new Date(
            Date.parse(RECOVERY_AT) +
              STABLECOIN_DEPEG_RECOVERY_AUTHORIZATION_MAXIMUM_AGE_MILLISECONDS +
              1,
          ).toISOString(),
        }),
      'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
    );
    expectValidationCode(
      () => authorization(recovery, { nonce: randomUUID().toUpperCase() }),
      'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
    );
    expectValidationCode(
      () => authorization(recovery, { riskApproverReferenceId: 'risk-evidence:unit-test' }),
      'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
    );
  });

  it('rejects an accessor in nested recovery evidence without invoking it', () => {
    const recovery = recoveryRequest();
    let invoked = false;
    Object.defineProperty(recovery.samples[0] as object, 'evaluatedAt', {
      enumerable: true,
      get: () => {
        invoked = true;
        return '2026-08-22T10:00:00.000Z';
      },
    });

    expectValidationCode(
      () => fingerprintStablecoinDepegRecoveryEvidence(recovery),
      'RECOVERY_NOT_CLEARED',
    );
    expect(invoked).toBe(false);
  });
});
