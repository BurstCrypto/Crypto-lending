import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  PortfolioPriceEvidenceReader,
  PortfolioPriceEvidenceSnapshot,
  ReadPortfolioPriceEvidenceRequest,
} from '../../../portfolio/application/ports/portfolio-price-evidence-reader.port';
import type {
  RecordStablecoinPriceEvidenceOutcome,
  RecordStablecoinPriceEvidenceRequest,
  RecordStablecoinPriceEvidenceResult,
  StablecoinPriceEvidenceWriter,
} from '../../application/ports/stablecoin-price-evidence-store.port';
import {
  normalizeStablecoinPriceEvidenceAsset,
  normalizeStablecoinPriceEvidenceCommand,
  normalizeStablecoinPriceObservation,
} from '../../domain/stablecoin-price-evidence';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_SOURCES,
  type StablecoinPriceObservation,
  type StablecoinSourceWatermark,
  type StablecoinValuationSourceId,
} from '../../domain/stablecoin-valuation-policy';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const READ_COLUMNS = Object.freeze([
  'source_id',
  'source_reference',
  'observation_id',
  'evidence_id',
  'evidence_actor_reference_id',
  'evidence_fingerprint_sha256',
  'evidence_verified_at',
  'correlation_id',
  'source_sequence',
  'source_update_id',
  'priced_at',
  'observed_at',
  'usd_rate_mantissa',
  'usd_rate_scale',
  'confidence_kind',
  'confidence_mantissa',
  'confidence_scale',
  'event_id',
  'revision',
  'previous_observation_id',
  'previous_sequence',
  'previous_update_id',
  'previous_priced_at',
  'previous_observed_at',
  'event_fingerprint_sha256',
  'accepted_at',
] as const);
const NULLABLE_EVIDENCE_COLUMNS = READ_COLUMNS.slice(2);

interface RecordRow extends QueryResultRow {
  record_outcome: string;
  accepted_observation_id: string;
  watermark_revision: string | null;
}

interface EvidenceRow extends QueryResultRow {
  source_id: string;
  source_reference: string;
  observation_id: string | null;
  evidence_id: string | null;
  evidence_actor_reference_id: string | null;
  evidence_fingerprint_sha256: string | null;
  evidence_verified_at: Date | null;
  correlation_id: string | null;
  source_sequence: string | null;
  source_update_id: string | null;
  priced_at: Date | null;
  observed_at: Date | null;
  usd_rate_mantissa: string | null;
  usd_rate_scale: number | null;
  confidence_kind: string | null;
  confidence_mantissa: string | null;
  confidence_scale: number | null;
  event_id: string | null;
  revision: string | null;
  previous_observation_id: string | null;
  previous_sequence: string | null;
  previous_update_id: string | null;
  previous_priced_at: Date | null;
  previous_observed_at: Date | null;
  event_fingerprint_sha256: string | null;
  accepted_at: Date | null;
}

interface MappedEvidenceRow {
  readonly observation: StablecoinPriceObservation | null;
  readonly watermark: StablecoinSourceWatermark;
  readonly auditMaterial: Readonly<Record<string, string | number | null>>;
}

export class StablecoinPriceEvidencePersistenceError extends Error {
  readonly code = 'STABLECOIN_PRICE_EVIDENCE_PERSISTENCE_FAILED' as const;

  constructor() {
    super('Stablecoin price evidence persistence failed');
    this.name = 'StablecoinPriceEvidencePersistenceError';
  }
}

function persistenceFailure(): never {
  throw new StablecoinPriceEvidencePersistenceError();
}

function ownRow<Row extends QueryResultRow>(value: unknown, columns: readonly string[]): Row {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return persistenceFailure();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return persistenceFailure();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== columns.length ||
      keys.some((key) => typeof key !== 'string' || !columns.includes(key))
    ) {
      return persistenceFailure();
    }
    for (const column of columns) {
      const descriptor = descriptors[column];
      if (!descriptor?.enumerable || !('value' in descriptor)) return persistenceFailure();
    }
    return value as Row;
  } catch (error) {
    if (error instanceof StablecoinPriceEvidencePersistenceError) throw error;
    return persistenceFailure();
  }
}

function oneRow<Row extends QueryResultRow>(rows: readonly Row[], columns: readonly string[]): Row {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) return persistenceFailure();
  return ownRow<Row>(rows[0], columns);
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return persistenceFailure();
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value)) return persistenceFailure();
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return persistenceFailure();
  return value;
}

function timestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return persistenceFailure();
  const text = value.toISOString();
  if (!CANONICAL_TIMESTAMP.test(text)) return persistenceFailure();
  return text;
}

function revision(value: unknown): number {
  if (typeof value !== 'string' || !POSITIVE_INTEGER.test(value)) return persistenceFailure();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return persistenceFailure();
  return parsed;
}

function source(value: unknown): StablecoinValuationSourceId {
  if (
    typeof value !== 'string' ||
    !STABLECOIN_VALUATION_SOURCES.includes(value as StablecoinValuationSourceId)
  ) {
    return persistenceFailure();
  }
  return value as StablecoinValuationSourceId;
}

function outcome(value: unknown): RecordStablecoinPriceEvidenceOutcome {
  if (
    value !== 'ACCEPTED' &&
    value !== 'IDEMPOTENT_REPLAY' &&
    value !== 'REPLAYED_UPDATE_ID' &&
    value !== 'NON_MONOTONIC'
  ) {
    return persistenceFailure();
  }
  return value;
}

function readTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return persistenceFailure();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return persistenceFailure();
  }
  return value;
}

function readRequest(
  request: ReadPortfolioPriceEvidenceRequest,
): ReadPortfolioPriceEvidenceRequest {
  try {
    if (
      request === null ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      Object.getPrototypeOf(request) !== Object.prototype ||
      Reflect.ownKeys(request).length !== 3 ||
      !Object.hasOwn(request, 'asset') ||
      !Object.hasOwn(request, 'evaluatedAt') ||
      !Object.hasOwn(request, 'correlationId') ||
      typeof request.correlationId !== 'string' ||
      !UUID_V4.test(request.correlationId)
    ) {
      return persistenceFailure();
    }
    return Object.freeze({
      asset: normalizeStablecoinPriceEvidenceAsset(request.asset),
      evaluatedAt: readTimestamp(request.evaluatedAt),
      correlationId: request.correlationId,
    });
  } catch (error) {
    if (error instanceof StablecoinPriceEvidencePersistenceError) throw error;
    return persistenceFailure();
  }
}

function mapEvidenceRow(
  raw: EvidenceRow,
  requested: ReadPortfolioPriceEvidenceRequest,
): MappedEvidenceRow {
  const row = ownRow<EvidenceRow>(raw, READ_COLUMNS);
  const sourceId = source(row.source_id);
  const expectedReference =
    STABLECOIN_VALUATION_FEED_REFERENCES[requested.asset.stablecoin][sourceId];
  if (row.source_reference !== expectedReference) return persistenceFailure();
  if (row.observation_id === null) {
    if (NULLABLE_EVIDENCE_COLUMNS.some((column) => row[column] !== null)) {
      return persistenceFailure();
    }
    return Object.freeze({
      observation: null,
      watermark: Object.freeze({
        sourceId,
        lastAcceptedSequence: null,
        lastAcceptedPricedAt: null,
        lastAcceptedObservedAt: null,
        lastAcceptedUpdateId: null,
      }),
      auditMaterial: Object.freeze({
        sourceId,
        sourceReference: expectedReference,
        revision: null,
      }),
    });
  }

  const observationId = digest(row.observation_id);
  const evidenceId = digest(row.evidence_id);
  const evidenceActorReferenceId = reference(row.evidence_actor_reference_id);
  const evidenceFingerprintSha256 = digest(row.evidence_fingerprint_sha256);
  const evidenceVerifiedAt = timestamp(row.evidence_verified_at);
  const correlationId = uuid(row.correlation_id);
  const eventId = digest(row.event_id);
  const eventFingerprintSha256 = digest(row.event_fingerprint_sha256);
  const acceptedAt = timestamp(row.accepted_at);
  const currentRevision = revision(row.revision);
  if (
    typeof row.source_sequence !== 'string' ||
    !POSITIVE_INTEGER.test(row.source_sequence) ||
    typeof row.source_update_id !== 'string' ||
    typeof row.usd_rate_mantissa !== 'string' ||
    !/^(0|[1-9][0-9]*)$/u.test(row.usd_rate_mantissa) ||
    row.usd_rate_scale !== 8
  ) {
    return persistenceFailure();
  }
  const confidence =
    sourceId === 'PYTH_CORE'
      ? {
          kind: 'PUBLISHED_ABSOLUTE_USD' as const,
          mantissa: row.confidence_mantissa,
          scale: row.confidence_scale,
        }
      : { kind: row.confidence_kind };
  const observation = normalizeStablecoinPriceObservation({
    asset: requested.asset,
    sourceId,
    sourceReference: expectedReference,
    sourceSequence: row.source_sequence,
    sourceUpdateId: row.source_update_id,
    pricedAt: timestamp(row.priced_at),
    observedAt: timestamp(row.observed_at),
    usdRateMantissa: row.usd_rate_mantissa,
    usdRateScale: row.usd_rate_scale,
    confidence,
  });
  if (
    Date.parse(observation.observedAt) > Date.parse(evidenceVerifiedAt) ||
    Date.parse(acceptedAt) > Date.parse(requested.evaluatedAt) ||
    Date.parse(evidenceVerifiedAt) > Date.parse(acceptedAt) + 5_000
  ) {
    return persistenceFailure();
  }

  let watermark: StablecoinSourceWatermark;
  let previousObservationId: string | null = null;
  if (currentRevision === 1) {
    if (
      row.previous_observation_id !== null ||
      row.previous_sequence !== null ||
      row.previous_update_id !== null ||
      row.previous_priced_at !== null ||
      row.previous_observed_at !== null
    ) {
      return persistenceFailure();
    }
    watermark = Object.freeze({
      sourceId,
      lastAcceptedSequence: null,
      lastAcceptedPricedAt: null,
      lastAcceptedObservedAt: null,
      lastAcceptedUpdateId: null,
    });
  } else {
    previousObservationId = digest(row.previous_observation_id);
    if (
      typeof row.previous_sequence !== 'string' ||
      !POSITIVE_INTEGER.test(row.previous_sequence) ||
      typeof row.previous_update_id !== 'string'
    ) {
      return persistenceFailure();
    }
    const previousPricedAt = timestamp(row.previous_priced_at);
    const previousObservedAt = timestamp(row.previous_observed_at);
    if (
      BigInt(row.previous_sequence) >= BigInt(observation.sourceSequence) ||
      (sourceId === 'PYTH_CORE'
        ? !SHA256.test(row.previous_update_id)
        : row.previous_update_id !== row.previous_sequence) ||
      row.previous_update_id === observation.sourceUpdateId ||
      Date.parse(previousPricedAt) > Date.parse(observation.pricedAt) ||
      Date.parse(previousObservedAt) > Date.parse(observation.observedAt) ||
      Date.parse(previousPricedAt) > Date.parse(previousObservedAt)
    ) {
      return persistenceFailure();
    }
    watermark = Object.freeze({
      sourceId,
      lastAcceptedSequence: row.previous_sequence,
      lastAcceptedPricedAt: previousPricedAt,
      lastAcceptedObservedAt: previousObservedAt,
      lastAcceptedUpdateId: row.previous_update_id,
    });
  }
  return Object.freeze({
    observation,
    watermark,
    auditMaterial: Object.freeze({
      sourceId,
      sourceReference: expectedReference,
      observationId,
      evidenceId,
      evidenceActorReferenceId,
      evidenceFingerprintSha256,
      evidenceVerifiedAt,
      correlationId,
      eventId,
      eventFingerprintSha256,
      acceptedAt,
      revision: currentRevision,
      previousObservationId,
      previousSequence: watermark.lastAcceptedSequence,
      previousUpdateId: watermark.lastAcceptedUpdateId,
      previousPricedAt: watermark.lastAcceptedPricedAt,
      previousObservedAt: watermark.lastAcceptedObservedAt,
    }),
  });
}

/** Dormant worker adapter: callers must first authenticate provider/on-chain evidence. */
@Injectable()
export class PostgresStablecoinPriceEvidenceWriter implements StablecoinPriceEvidenceWriter {
  constructor(private readonly postgres: PostgresService) {}

  async record(
    request: RecordStablecoinPriceEvidenceRequest,
  ): Promise<RecordStablecoinPriceEvidenceResult> {
    try {
      const command = normalizeStablecoinPriceEvidenceCommand(request);
      const observation = command.observation;
      const confidenceMantissa =
        observation.confidence.kind === 'PUBLISHED_ABSOLUTE_USD'
          ? observation.confidence.mantissa
          : null;
      const confidenceScale =
        observation.confidence.kind === 'PUBLISHED_ABSOLUTE_USD'
          ? observation.confidence.scale
          : null;
      const result = await this.postgres.query<RecordRow>(
        `SELECT recorded.* FROM record_stablecoin_price_evidence(
           $1::uuid, $2::text, $3::text, $4::timestamptz, $5::text, $6::text,
           $7::text, $8::smallint, $9::text, $10::text, $11::text, $12::text,
           $13::smallint, $14::text, $15::text, $16::numeric, $17::text,
           $18::timestamptz, $19::timestamptz, $20::numeric, $21::smallint,
           $22::text, $23::numeric, $24::smallint, $25::text, $26::text, $27::text
         ) AS recorded`,
        [
          command.correlationId,
          command.evidenceId,
          command.evidenceActorReferenceId,
          command.verifiedAt,
          command.evidenceFingerprintSha256,
          command.observationId,
          observation.asset.registryEnvironment,
          observation.asset.registryVersion,
          observation.asset.registryFingerprintSha256,
          observation.asset.stablecoin,
          observation.asset.networkId,
          observation.asset.identity,
          observation.asset.decimals,
          observation.sourceId,
          observation.sourceReference,
          observation.sourceSequence,
          observation.sourceUpdateId,
          observation.pricedAt,
          observation.observedAt,
          observation.usdRateMantissa,
          observation.usdRateScale,
          observation.confidence.kind,
          confidenceMantissa,
          confidenceScale,
          command.commandFingerprintSha256,
          command.watermarkEventId,
          command.watermarkEventFingerprintSha256,
        ],
      );
      const row = oneRow<RecordRow>(result.rows, [
        'record_outcome',
        'accepted_observation_id',
        'watermark_revision',
      ]);
      const recordOutcome = outcome(row.record_outcome);
      if (digest(row.accepted_observation_id) !== command.observationId) {
        return persistenceFailure();
      }
      const watermarkRevision =
        row.watermark_revision === null ? null : revision(row.watermark_revision);
      if (
        ((recordOutcome === 'ACCEPTED' || recordOutcome === 'IDEMPOTENT_REPLAY') &&
          watermarkRevision === null) ||
        ((recordOutcome === 'REPLAYED_UPDATE_ID' || recordOutcome === 'NON_MONOTONIC') &&
          watermarkRevision !== null)
      ) {
        return persistenceFailure();
      }
      return Object.freeze({
        outcome: recordOutcome,
        observationId: command.observationId,
        watermarkRevision,
      });
    } catch (error) {
      if (error instanceof StablecoinPriceEvidencePersistenceError) throw error;
      return persistenceFailure();
    }
  }
}

/** Dormant API adapter. Empty history yields a valid but unavailable valuation snapshot. */
@Injectable()
export class PostgresPortfolioPriceEvidenceReader implements PortfolioPriceEvidenceReader {
  constructor(private readonly postgres: PostgresService) {}

  async readPriceEvidence(
    requestValue: ReadPortfolioPriceEvidenceRequest,
  ): Promise<PortfolioPriceEvidenceSnapshot> {
    try {
      const request = readRequest(requestValue);
      const asset = request.asset;
      const result = await this.postgres.query<EvidenceRow>(
        `SELECT evidence.* FROM read_stablecoin_price_evidence(
           $1::text, $2::smallint, $3::text, $4::text, $5::text, $6::text,
           $7::smallint, $8::timestamptz
         ) AS evidence`,
        [
          asset.registryEnvironment,
          asset.registryVersion,
          asset.registryFingerprintSha256,
          asset.stablecoin,
          asset.networkId,
          asset.identity,
          asset.decimals,
          request.evaluatedAt,
        ],
      );
      if (!Array.isArray(result.rows) || result.rows.length !== 2) return persistenceFailure();
      const mapped = result.rows.map((row) => mapEvidenceRow(row, request));
      if (
        mapped.length !== STABLECOIN_VALUATION_SOURCES.length ||
        mapped.some(
          ({ watermark }, index) => watermark.sourceId !== STABLECOIN_VALUATION_SOURCES[index],
        )
      ) {
        return persistenceFailure();
      }
      const observations = Object.freeze(
        mapped.flatMap(({ observation }) => (observation === null ? [] : [observation])),
      );
      const sourceWatermarks = Object.freeze(mapped.map(({ watermark }) => watermark));
      const snapshotDigest = createHash('sha256')
        .update(
          JSON.stringify({
            schemaVersion: 1,
            asset,
            evaluatedAt: request.evaluatedAt,
            sources: mapped.map(({ auditMaterial }) => auditMaterial),
          }),
          'utf8',
        )
        .digest('hex');
      return Object.freeze({
        snapshotId: `price-evidence-${snapshotDigest}`,
        observations,
        sourceWatermarks,
      });
    } catch (error) {
      if (error instanceof StablecoinPriceEvidencePersistenceError) throw error;
      return persistenceFailure();
    }
  }
}
