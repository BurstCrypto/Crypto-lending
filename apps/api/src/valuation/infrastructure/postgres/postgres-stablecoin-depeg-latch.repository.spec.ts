import type { QueryResult } from 'pg';

import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  ClearStablecoinDepegLatchRequest,
  RecordStablecoinDepegLatchRequest,
  StablecoinDepegRecoveryAuthorization,
} from '../../application/ports/stablecoin-depeg-latch.port';
import {
  fingerprintStablecoinDepegEvidence,
  fingerprintStablecoinDepegRecoveryAuthorization,
  fingerprintStablecoinDepegRecoveryEvidence,
  normalizeClearStablecoinDepegLatchCommand,
  normalizeRecordStablecoinDepegLatchCommand,
  stablecoinDepegRecoveryAuthorizationId,
  type StablecoinDepegRecoveryAuthorizationFingerprintMaterial,
} from '../../domain/stablecoin-depeg-latch';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  type StablecoinPriceObservation,
  type StablecoinRecoveryRequest,
  type StablecoinValuationAssetReference,
  type StablecoinValuationRequest,
  type StablecoinValuationSourceId,
} from '../../domain/stablecoin-valuation-policy';
import {
  PostgresStablecoinDepegLatchRepository,
  StablecoinDepegLatchPersistenceError,
} from './postgres-stablecoin-depeg-latch.repository';

const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const LATCH_ID = 'd'.repeat(64);
const CLEAR_ID = 'c'.repeat(64);
const DEPEG_AT = '2026-08-22T09:59:00.000Z';
const RECOVERY_AT = '2026-08-22T10:30:00.000Z';
const ASSET: StablecoinValuationAssetReference = {
  registryEnvironment: 'MAINNET',
  registryVersion: 1,
  registryFingerprintSha256: REGISTRY_FINGERPRINT,
  stablecoin: 'PYUSD',
  networkId: 'eip155:1',
  identity: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
  decimals: 6,
};

function observation(
  sourceId: StablecoinValuationSourceId,
  evaluatedAt: string,
  sequence: string,
  price: string,
): StablecoinPriceObservation {
  return {
    asset: ASSET,
    sourceId,
    sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES.PYUSD[sourceId],
    sourceSequence: sequence,
    sourceUpdateId: sourceId === 'PYTH_CORE' ? sequence.padStart(64, '0') : sequence,
    pricedAt: new Date(Date.parse(evaluatedAt) - 3_000).toISOString(),
    observedAt: evaluatedAt,
    usdRateMantissa: price,
    usdRateScale: 8,
    confidence:
      sourceId === 'PYTH_CORE'
        ? { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '5000', scale: 8 }
        : { kind: 'NOT_PUBLISHED' },
  };
}

function depegValuation(): StablecoinValuationRequest {
  return {
    asset: ASSET,
    amountAtomic: '1000000',
    evaluatedAt: DEPEG_AT,
    sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
    observations: [
      observation('PYTH_CORE', DEPEG_AT, '1', '97000000'),
      observation('CHAINLINK_DATA_FEEDS', DEPEG_AT, '1', '97000000'),
    ],
  };
}

function recordRequest(): RecordStablecoinDepegLatchRequest {
  const valuationRequest = depegValuation();
  const evidenceActorReferenceId = 'risk-evidence:repository-test';
  return {
    expectedRevision: null,
    correlationId: '11111111-1111-4111-8111-111111111111',
    latchId: LATCH_ID,
    evidenceActorReferenceId,
    depegEvidenceFingerprintSha256: fingerprintStablecoinDepegEvidence({
      evidenceActorReferenceId,
      valuationRequest,
    }),
    valuationRequest,
  };
}

function recoveryRequest(): StablecoinRecoveryRequest {
  return {
    asset: ASSET,
    evaluatedAt: RECOVERY_AT,
    depegLatch: { asset: ASSET, latchId: LATCH_ID, latchedAt: DEPEG_AT },
    manualRiskClear: { asset: ASSET, latchId: LATCH_ID, clearId: CLEAR_ID, clearedAt: RECOVERY_AT },
    samples: [0, 1, 2, 3].map((index) => {
      const evaluatedAt = new Date(
        Date.parse('2026-08-22T10:00:00.000Z') + index * 600_000,
      ).toISOString();
      const sequence = String(index + 1);
      return {
        evaluatedAt,
        observations: [
          observation('PYTH_CORE', evaluatedAt, sequence, '99990000'),
          observation('CHAINLINK_DATA_FEEDS', evaluatedAt, sequence, '99980000'),
        ],
      };
    }),
  };
}

function clearRequest(): ClearStablecoinDepegLatchRequest {
  const recovery = recoveryRequest();
  const material: StablecoinDepegRecoveryAuthorizationFingerprintMaterial = {
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
    evidenceActorReferenceId: 'risk-evidence:repository-test',
    riskApproverReferenceId: 'risk-approver:repository-test',
    riskApproverRole: 'RISK_APPROVER',
    issuedAt: RECOVERY_AT,
    notBefore: RECOVERY_AT,
    expiresAt: '2026-08-22T10:40:00.000Z',
    nonce: '22222222-2222-4222-8222-222222222222',
  };
  const fingerprint = fingerprintStablecoinDepegRecoveryAuthorization(material);
  const authorization: StablecoinDepegRecoveryAuthorization = {
    ...material,
    authorizationFingerprintSha256: fingerprint,
    authorizationId: stablecoinDepegRecoveryAuthorizationId(fingerprint),
  };
  return {
    evaluatedAt: RECOVERY_AT,
    correlationId: '33333333-3333-4333-8333-333333333333',
    recoveryRequest: recovery,
    authorization,
  };
}

function projectionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projection_schema_version: 1,
    projection_registry_environment: 'MAINNET',
    projection_registry_version: 1,
    projection_registry_fingerprint: REGISTRY_FINGERPRINT,
    projection_stablecoin: 'PYUSD',
    projection_network_id: 'eip155:1',
    projection_asset_identity: ASSET.identity,
    projection_asset_decimals: 6,
    projection_revision: '1',
    projection_status: 'LATCHED',
    projection_latch_id: LATCH_ID,
    projection_latched_at: new Date(DEPEG_AT),
    projection_depeg_evidence_fingerprint: recordRequest().depegEvidenceFingerprintSha256,
    projection_evidence_actor_reference_id: 'risk-evidence:repository-test',
    projection_clear_id: null,
    projection_cleared_at: null,
    projection_risk_approver_reference_id: null,
    projection_last_event_id: LATCH_ID,
    projection_last_event_fingerprint:
      normalizeRecordStablecoinDepegLatchCommand(recordRequest()).eventFingerprintSha256,
    projection_updated_at: new Date(DEPEG_AT),
    ...overrides,
  };
}

function clearedProjectionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return projectionRow({
    projection_revision: '2',
    projection_status: 'CLEARED',
    projection_clear_id: CLEAR_ID,
    projection_cleared_at: new Date(RECOVERY_AT),
    projection_risk_approver_reference_id: 'risk-approver:repository-test',
    projection_last_event_id: CLEAR_ID,
    projection_updated_at: new Date(RECOVERY_AT),
    ...overrides,
  });
}

function queryResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

function harness(): { query: jest.Mock; repository: PostgresStablecoinDepegLatchRepository } {
  const query = jest.fn();
  return {
    query,
    repository: new PostgresStablecoinDepegLatchRepository({ query } as unknown as PostgresService),
  };
}

describe('Postgres stablecoin depeg latch repository', () => {
  it('loads and strictly maps a durable projection', async () => {
    const test = harness();
    test.query.mockResolvedValue(queryResult([projectionRow()]));

    await expect(test.repository.loadCurrent(ASSET)).resolves.toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        asset: ASSET,
        status: 'LATCHED',
        revision: 1,
        latchId: LATCH_ID,
      }),
    );
    expect(test.query).toHaveBeenCalledWith(
      expect.stringContaining('read_stablecoin_depeg_latch'),
      ['MAINNET', 1, REGISTRY_FINGERPRINT, 'PYUSD', 'eip155:1', ASSET.identity, 6],
    );
  });

  it('returns null only for no row and rejects a synthetic null row from a direct read', async () => {
    const test = harness();
    test.query.mockResolvedValueOnce(queryResult([]));
    await expect(test.repository.loadCurrent(ASSET)).resolves.toBeNull();

    test.query.mockResolvedValueOnce(
      queryResult([
        Object.fromEntries(Object.keys(projectionRow()).map((column) => [column, null])),
      ]),
    );
    await expect(test.repository.loadCurrent(ASSET)).resolves.toBeNull();
  });

  it('records only the normalized, revision-bound depeg command', async () => {
    const test = harness();
    test.query.mockResolvedValue(queryResult([{ record_outcome: 'LATCHED', ...projectionRow() }]));
    const request = recordRequest();
    const normalized = normalizeRecordStablecoinDepegLatchCommand(request);

    await expect(test.repository.record(request)).resolves.toEqual(
      expect.objectContaining({
        outcome: 'LATCHED',
        latch: expect.objectContaining({ revision: 1 }),
      }),
    );
    expect(test.query.mock.calls[0]?.[1]).toEqual([
      null,
      request.correlationId,
      LATCH_ID,
      'MAINNET',
      1,
      REGISTRY_FINGERPRINT,
      'PYUSD',
      'eip155:1',
      6,
      DEPEG_AT,
      ASSET.identity,
      request.evidenceActorReferenceId,
      request.depegEvidenceFingerprintSha256,
      normalized.commandFingerprintSha256,
      normalized.eventFingerprintSha256,
    ]);
  });

  it('passes every normalized authorization binding to the dormant clear function', async () => {
    const test = harness();
    const request = clearRequest();
    const normalized = normalizeClearStablecoinDepegLatchCommand(request);
    test.query.mockResolvedValue(
      queryResult([
        {
          clear_outcome: 'CLEARED',
          ...projectionRow({
            projection_revision: '2',
            projection_status: 'CLEARED',
            projection_clear_id: CLEAR_ID,
            projection_cleared_at: new Date(RECOVERY_AT),
            projection_risk_approver_reference_id: normalized.riskApproverReferenceId,
            projection_last_event_id: CLEAR_ID,
            projection_last_event_fingerprint: normalized.eventFingerprintSha256,
            projection_updated_at: new Date(RECOVERY_AT),
          }),
        },
      ]),
    );

    await expect(test.repository.clear(request)).resolves.toEqual(
      expect.objectContaining({
        outcome: 'CLEARED',
        latch: expect.objectContaining({ revision: 2 }),
      }),
    );
    expect(test.query.mock.calls[0]?.[1]).toEqual([
      request.correlationId,
      'MAINNET',
      1,
      REGISTRY_FINGERPRINT,
      'PYUSD',
      'eip155:1',
      6,
      ASSET.identity,
      CLEAR_ID,
      DEPEG_AT,
      1,
      LATCH_ID,
      normalized.recoveryEvidenceFingerprintSha256,
      normalized.evidenceActorReferenceId,
      normalized.riskApproverReferenceId,
      'RISK_APPROVER',
      RECOVERY_AT,
      RECOVERY_AT,
      RECOVERY_AT,
      '2026-08-22T10:40:00.000Z',
      RECOVERY_AT,
      '22222222-2222-4222-8222-222222222222',
      normalized.authorizationFingerprintSha256,
      normalized.authorizationId,
      normalized.commandFingerprintSha256,
      normalized.eventFingerprintSha256,
    ]);
  });

  it.each([
    { rows: [projectionRow(), projectionRow()] },
    { rows: [projectionRow({ projection_revision: '9007199254740992' })] },
    { rows: [projectionRow({ projection_status: 'CLEARED' })] },
    { rows: [projectionRow({ projection_registry_fingerprint: '0'.repeat(64) })] },
    { rows: [{ ...projectionRow(), unexpected_column: true }] },
    { rows: [projectionRow({ projection_last_event_id: 'a'.repeat(64) })] },
    {
      rows: [projectionRow({ projection_updated_at: new Date('2026-08-22T09:58:59.999Z') })],
    },
    {
      rows: [
        clearedProjectionRow({
          projection_risk_approver_reference_id: 'risk-evidence:repository-test',
        }),
      ],
    },
    { rows: [clearedProjectionRow({ projection_last_event_id: 'a'.repeat(64) })] },
    {
      rows: [
        clearedProjectionRow({
          projection_cleared_at: new Date('2026-08-22T09:58:59.999Z'),
        }),
      ],
    },
    {
      rows: [
        clearedProjectionRow({
          projection_updated_at: new Date('2026-08-22T10:29:59.999Z'),
        }),
      ],
    },
  ])('fails closed on malformed database rows %#', async ({ rows }) => {
    const test = harness();
    test.query.mockResolvedValue(queryResult(rows));
    await expect(test.repository.loadCurrent(ASSET)).rejects.toEqual(
      expect.objectContaining({
        code: 'STABLECOIN_DEPEG_LATCH_PERSISTENCE_FAILED',
        message: 'Stablecoin depeg latch persistence failed',
      }),
    );
  });

  it('fails closed when database outcomes contradict null or projection state', async () => {
    const nullProjection = Object.fromEntries(
      Object.keys(projectionRow()).map((column) => [column, null]),
    );
    const record = harness();
    record.query.mockResolvedValue(queryResult([{ record_outcome: 'LATCHED', ...nullProjection }]));
    await expect(record.repository.record(recordRequest())).rejects.toBeInstanceOf(
      StablecoinDepegLatchPersistenceError,
    );

    const absentRecordRevision = harness();
    absentRecordRevision.query.mockResolvedValue(
      queryResult([{ record_outcome: 'REVISION_CONFLICT', ...nullProjection }]),
    );
    await expect(absentRecordRevision.repository.record(recordRequest())).resolves.toEqual({
      outcome: 'REVISION_CONFLICT',
      latch: null,
    });

    const clear = harness();
    clear.query.mockResolvedValue(
      queryResult([{ clear_outcome: 'LATCH_NOT_FOUND', ...projectionRow() }]),
    );
    await expect(clear.repository.clear(clearRequest())).rejects.toBeInstanceOf(
      StablecoinDepegLatchPersistenceError,
    );

    const recordStatus = harness();
    recordStatus.query.mockResolvedValue(
      queryResult([{ record_outcome: 'RELATCHED', ...clearedProjectionRow() }]),
    );
    await expect(recordStatus.repository.record(recordRequest())).rejects.toBeInstanceOf(
      StablecoinDepegLatchPersistenceError,
    );

    const clearStatus = harness();
    clearStatus.query.mockResolvedValue(
      queryResult([{ clear_outcome: 'CLEARED', ...projectionRow() }]),
    );
    await expect(clearStatus.repository.clear(clearRequest())).rejects.toBeInstanceOf(
      StablecoinDepegLatchPersistenceError,
    );

    const missingExpired = harness();
    missingExpired.query.mockResolvedValue(
      queryResult([{ clear_outcome: 'AUTHORIZATION_EXPIRED', ...nullProjection }]),
    );
    await expect(missingExpired.repository.clear(clearRequest())).rejects.toBeInstanceOf(
      StablecoinDepegLatchPersistenceError,
    );

    const nonexistentRevision = harness();
    nonexistentRevision.query.mockResolvedValue(
      queryResult([{ clear_outcome: 'REVISION_CONFLICT', ...nullProjection }]),
    );
    await expect(nonexistentRevision.repository.clear(clearRequest())).rejects.toBeInstanceOf(
      StablecoinDepegLatchPersistenceError,
    );
  });

  it('does not leak validation or database error details', async () => {
    const test = harness();
    test.query.mockRejectedValue(new Error('postgres://secret:credential@host/key'));
    await expect(test.repository.loadCurrent(ASSET)).rejects.toBeInstanceOf(
      StablecoinDepegLatchPersistenceError,
    );
    await expect(
      test.repository.loadCurrent({ ...ASSET, networkId: 'eip155:8453' }),
    ).rejects.toEqual(
      expect.objectContaining({ message: 'Stablecoin depeg latch persistence failed' }),
    );
  });
});
