import type { QueryResult } from 'pg';

import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import type { ReadPortfolioPriceEvidenceRequest } from '../../../portfolio/application/ports/portfolio-price-evidence-reader.port';
import type { RecordStablecoinPriceEvidenceRequest } from '../../application/ports/stablecoin-price-evidence-store.port';
import { normalizeStablecoinPriceEvidenceCommand } from '../../domain/stablecoin-price-evidence';
import {
  evaluateStablecoinValuation,
  STABLECOIN_VALUATION_FEED_REFERENCES,
  type StablecoinPriceObservation,
  type StablecoinValuationAssetReference,
  type StablecoinValuationSourceId,
} from '../../domain/stablecoin-valuation-policy';
import {
  PostgresPortfolioPriceEvidenceReader,
  PostgresStablecoinPriceEvidenceWriter,
  StablecoinPriceEvidencePersistenceError,
} from './postgres-stablecoin-price-evidence.store';

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
const EVALUATED_AT = '2026-09-04T12:00:05.000Z';

function observation(sequence = '42'): StablecoinPriceObservation {
  return {
    asset: ASSET,
    sourceId: 'PYTH_CORE',
    sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES.USDC.PYTH_CORE,
    sourceSequence: sequence,
    sourceUpdateId: sequence.padStart(64, '0'),
    pricedAt: '2026-09-04T11:59:58.000Z',
    observedAt: '2026-09-04T12:00:00.000Z',
    usdRateMantissa: '99990000',
    usdRateScale: 8,
    confidence: { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '5000', scale: 8 },
  };
}

function recordRequest(): RecordStablecoinPriceEvidenceRequest {
  return {
    correlationId: '11111111-1111-4111-8111-111111111111',
    evidenceActorReferenceId: 'pyth-adapter:mainnet-v1',
    evidenceFingerprintSha256: 'a'.repeat(64),
    verifiedAt: '2026-09-04T12:00:00.000Z',
    observation: observation(),
  };
}

function readRequest(
  signal: AbortSignal = new AbortController().signal,
): ReadPortfolioPriceEvidenceRequest {
  return {
    asset: ASSET,
    evaluatedAt: EVALUATED_AT,
    correlationId: '22222222-2222-4222-8222-222222222222',
    signal,
  };
}

function evidenceRow(
  sourceId: StablecoinValuationSourceId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const empty = {
    source_id: sourceId,
    source_reference: STABLECOIN_VALUATION_FEED_REFERENCES.USDC[sourceId],
    observation_id: null,
    evidence_id: null,
    evidence_actor_reference_id: null,
    evidence_fingerprint_sha256: null,
    evidence_verified_at: null,
    correlation_id: null,
    source_sequence: null,
    source_update_id: null,
    priced_at: null,
    observed_at: null,
    usd_rate_mantissa: null,
    usd_rate_scale: null,
    confidence_kind: null,
    confidence_mantissa: null,
    confidence_scale: null,
    event_id: null,
    revision: null,
    previous_observation_id: null,
    previous_sequence: null,
    previous_update_id: null,
    previous_priced_at: null,
    previous_observed_at: null,
    event_fingerprint_sha256: null,
    accepted_at: null,
  };
  return { ...empty, ...overrides };
}

function acceptedPythRow(revision = '1'): Record<string, unknown> {
  const current = observation(revision === '1' ? '42' : '43');
  return evidenceRow('PYTH_CORE', {
    observation_id: 'b'.repeat(64),
    evidence_id: 'c'.repeat(64),
    evidence_actor_reference_id: 'pyth-adapter:mainnet-v1',
    evidence_fingerprint_sha256: 'd'.repeat(64),
    evidence_verified_at: new Date('2026-09-04T12:00:00.000Z'),
    correlation_id: '11111111-1111-4111-8111-111111111111',
    source_sequence: current.sourceSequence,
    source_update_id: current.sourceUpdateId,
    priced_at: new Date(current.pricedAt),
    observed_at: new Date(current.observedAt),
    usd_rate_mantissa: current.usdRateMantissa,
    usd_rate_scale: 8,
    confidence_kind: 'PUBLISHED_ABSOLUTE_USD',
    confidence_mantissa: '5000',
    confidence_scale: 8,
    event_id: 'e'.repeat(64),
    revision,
    previous_observation_id: revision === '1' ? null : 'f'.repeat(64),
    previous_sequence: revision === '1' ? null : '42',
    previous_update_id: revision === '1' ? null : '42'.padStart(64, '0'),
    previous_priced_at: revision === '1' ? null : new Date('2026-09-04T11:59:57.000Z'),
    previous_observed_at: revision === '1' ? null : new Date('2026-09-04T11:59:59.000Z'),
    event_fingerprint_sha256: '1'.repeat(64),
    accepted_at: new Date('2026-09-04T12:00:00.001Z'),
  });
}

function result(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

function harness(): {
  readonly query: jest.Mock;
  readonly queryWithCancellation: jest.Mock;
  readonly writer: PostgresStablecoinPriceEvidenceWriter;
  readonly reader: PostgresPortfolioPriceEvidenceReader;
} {
  const query = jest.fn();
  const queryWithCancellation = jest.fn();
  const postgres = { query, queryWithCancellation } as unknown as PostgresService;
  return {
    query,
    queryWithCancellation,
    writer: new PostgresStablecoinPriceEvidenceWriter(postgres),
    reader: new PostgresPortfolioPriceEvidenceReader(postgres),
  };
}

describe('Postgres stablecoin price evidence adapters', () => {
  it('writes only the fully normalized worker command and maps an acceptance', async () => {
    const test = harness();
    const request = recordRequest();
    const command = normalizeStablecoinPriceEvidenceCommand(request);
    test.query.mockResolvedValue(
      result([
        {
          record_outcome: 'ACCEPTED',
          accepted_observation_id: command.observationId,
          watermark_revision: '1',
        },
      ]),
    );

    await expect(test.writer.record(request)).resolves.toEqual({
      outcome: 'ACCEPTED',
      observationId: command.observationId,
      watermarkRevision: 1,
    });
    expect(test.query.mock.calls[0]?.[0]).toContain('record_stablecoin_price_evidence');
    expect(test.query.mock.calls[0]?.[1]).toEqual([
      request.correlationId,
      command.evidenceId,
      request.evidenceActorReferenceId,
      request.verifiedAt,
      request.evidenceFingerprintSha256,
      command.observationId,
      'MAINNET',
      1,
      FINGERPRINT,
      'USDC',
      'eip155:1',
      ASSET.identity,
      6,
      'PYTH_CORE',
      STABLECOIN_VALUATION_FEED_REFERENCES.USDC.PYTH_CORE,
      '42',
      '42'.padStart(64, '0'),
      '2026-09-04T11:59:58.000Z',
      '2026-09-04T12:00:00.000Z',
      '99990000',
      8,
      'PUBLISHED_ABSOLUTE_USD',
      '5000',
      8,
      command.commandFingerprintSha256,
      command.watermarkEventId,
      command.watermarkEventFingerprintSha256,
    ]);
  });

  it.each([
    ['IDEMPOTENT_REPLAY', '1', 1],
    ['REPLAYED_UPDATE_ID', null, null],
    ['NON_MONOTONIC', null, null],
  ])('maps the closed database outcome %s', async (recordOutcome, stored, expected) => {
    const test = harness();
    const command = normalizeStablecoinPriceEvidenceCommand(recordRequest());
    test.query.mockResolvedValue(
      result([
        {
          record_outcome: recordOutcome,
          accepted_observation_id: command.observationId,
          watermark_revision: stored,
        },
      ]),
    );
    await expect(test.writer.record(recordRequest())).resolves.toMatchObject({
      outcome: recordOutcome,
      watermarkRevision: expected,
    });
  });

  it('returns two first-use watermarks and no synthetic prices for empty history', async () => {
    const test = harness();
    test.queryWithCancellation.mockResolvedValue(
      result([evidenceRow('PYTH_CORE'), evidenceRow('CHAINLINK_DATA_FEEDS')]),
    );

    const signal = new AbortController().signal;
    const snapshot = await test.reader.readPriceEvidence(readRequest(signal));
    expect(snapshot.snapshotId).toMatch(/^price-evidence-[0-9a-f]{64}$/u);
    expect(snapshot.observations).toEqual([]);
    expect(snapshot.sourceWatermarks).toEqual([
      {
        sourceId: 'PYTH_CORE',
        lastAcceptedSequence: null,
        lastAcceptedPricedAt: null,
        lastAcceptedObservedAt: null,
        lastAcceptedUpdateId: null,
      },
      {
        sourceId: 'CHAINLINK_DATA_FEEDS',
        lastAcceptedSequence: null,
        lastAcceptedPricedAt: null,
        lastAcceptedObservedAt: null,
        lastAcceptedUpdateId: null,
      },
    ]);
    expect(test.queryWithCancellation.mock.calls[0]?.[2]).toBe(signal);
    expect(test.query).not.toHaveBeenCalled();
  });

  it('returns the predecessor watermark so the latest accepted observation remains eligible', async () => {
    const test = harness();
    test.queryWithCancellation.mockResolvedValue(
      result([acceptedPythRow('2'), evidenceRow('CHAINLINK_DATA_FEEDS')]),
    );

    const snapshot = await test.reader.readPriceEvidence(readRequest());
    expect(snapshot.observations[0]?.sourceSequence).toBe('43');
    expect(snapshot.sourceWatermarks[0]).toMatchObject({
      sourceId: 'PYTH_CORE',
      lastAcceptedSequence: '42',
      lastAcceptedUpdateId: '42'.padStart(64, '0'),
    });
    const valuation = evaluateStablecoinValuation({
      asset: ASSET,
      amountAtomic: '1000000',
      evaluatedAt: EVALUATED_AT,
      observations: snapshot.observations,
      sourceWatermarks: snapshot.sourceWatermarks,
    });
    expect(valuation.availability).toBe('AVAILABLE');
    expect(valuation.selectedSourceSequence).toBe('43');
  });

  it.each([
    [[acceptedPythRow('2'), acceptedPythRow('2')], 'duplicate source rows'],
    [
      [acceptedPythRow('2'), evidenceRow('CHAINLINK_DATA_FEEDS', { surprise: true })],
      'unexpected database column',
    ],
    [
      [
        acceptedPythRow('2'),
        evidenceRow('CHAINLINK_DATA_FEEDS', { source_reference: 'usdt-usd.data.eth' }),
      ],
      'wrong source reference',
    ],
    [
      [acceptedPythRow('2'), evidenceRow('CHAINLINK_DATA_FEEDS')].map((row, index) =>
        index === 0 ? { ...row, previous_sequence: '43' } : row,
      ),
      'self watermark',
    ],
  ])('fails closed on %s', async (rows) => {
    const test = harness();
    test.queryWithCancellation.mockResolvedValue(result(rows as Record<string, unknown>[]));
    await expect(test.reader.readPriceEvidence(readRequest())).rejects.toBeInstanceOf(
      StablecoinPriceEvidencePersistenceError,
    );
  });

  it('sanitizes validation and database details', async () => {
    const test = harness();
    test.queryWithCancellation.mockRejectedValue(new Error('postgres://secret@example/key'));
    await expect(test.reader.readPriceEvidence(readRequest())).rejects.toEqual(
      expect.objectContaining({
        code: 'STABLECOIN_PRICE_EVIDENCE_PERSISTENCE_FAILED',
        message: 'Stablecoin price evidence persistence failed',
      }),
    );
    await expect(
      test.writer.record({ ...recordRequest(), evidenceFingerprintSha256: 'not-a-digest' }),
    ).rejects.toBeInstanceOf(StablecoinPriceEvidencePersistenceError);
  });
});
