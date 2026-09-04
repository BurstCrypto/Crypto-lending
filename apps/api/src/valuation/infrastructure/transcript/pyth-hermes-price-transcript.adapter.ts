import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../../blockchain/domain/supported-asset-registry';
import type {
  DormantStablecoinPriceTranscriptCandidate,
  StablecoinPriceTranscriptAdapter,
  StablecoinPriceTranscriptClock,
  StablecoinPriceTranscriptReadRequest,
} from '../../application/ports/stablecoin-price-transcript.port';
import {
  normalizeStablecoinPriceEvidenceAsset,
  normalizeStablecoinPriceObservation,
} from '../../domain/stablecoin-price-evidence';
import { STABLECOIN_VALUATION_FEED_REFERENCES } from '../../domain/stablecoin-valuation-policy';
import {
  assertBoundedData,
  assertCurrentSourceTime,
  canonicalObservedAt,
  canonicalUnsignedInteger,
  exactDataRecord,
  fingerprintTranscript,
  normalizeUnsignedFixedDecimal,
  positiveCanonicalInteger,
  sha256HexBytes,
  transcriptUnavailable,
  unixSecondsToTimestamp,
  StablecoinPriceTranscriptUnavailableError,
} from './stablecoin-price-transcript';

const PYTH_SOURCE_NETWORK_ID = 'pythnet:mainnet' as const;
const MAXIMUM_SIGNED_INT64 = (1n << 63n) - 1n;
const MAXIMUM_UNSIGNED_INT64 = (1n << 64n) - 1n;
const MAXIMUM_BINARY_UPDATE_BYTES = 512 * 1024;
const PYTH_RESPONSE_BOUNDS = Object.freeze({
  maximumBytes: 1024 * 1024,
  maximumNodes: 256,
  maximumDepth: 8,
  maximumArrayLength: 3,
});

export interface PythHermesLatestPriceTranscriptRequest {
  readonly schemaVersion: 1;
  readonly operation: 'LATEST_PRICE_UPDATES';
  readonly source: 'PYTH_CORE';
  readonly sourceNetworkId: 'pythnet:mainnet';
  readonly feedIds: readonly [string];
  readonly encoding: 'hex';
  readonly parsed: true;
  readonly ignoreInvalidPriceIds: false;
}

/** Owns no endpoint, client, credential, retry, DNS, TLS, or egress policy. */
export interface PythHermesPriceTranscriptTransport {
  exchange(request: PythHermesLatestPriceTranscriptRequest): Promise<unknown>;
}

interface PythPrice {
  readonly price: bigint;
  readonly confidence: bigint;
  readonly exponent: number;
  readonly publishTime: bigint;
}

interface PythMetadata {
  readonly slot: number;
  readonly proofAvailableTime: bigint;
  readonly previousPublishTime: bigint;
}

/**
 * Dormant Hermes transcript parser. The binary update is fingerprinted but not
 * cryptographically verified here; parsed JSON is never treated as proof of
 * Pyth/Wormhole authenticity and the candidate is not persistence-eligible.
 */
export class PythHermesPriceTranscriptAdapter implements StablecoinPriceTranscriptAdapter {
  constructor(
    private readonly transport: PythHermesPriceTranscriptTransport,
    private readonly clock: StablecoinPriceTranscriptClock,
  ) {
    if (
      typeof transport?.exchange !== 'function' ||
      typeof clock?.now !== 'function' ||
      MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 !==
        '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d'
    ) {
      return transcriptUnavailable();
    }
  }

  async read(
    request: StablecoinPriceTranscriptReadRequest,
  ): Promise<DormantStablecoinPriceTranscriptCandidate> {
    try {
      const requestRecord = exactDataRecord(request, ['asset']);
      const asset = normalizeStablecoinPriceEvidenceAsset(requestRecord.asset);
      const feedId = pythFeedId(asset.stablecoin);
      const transportRequest = Object.freeze({
        schemaVersion: 1 as const,
        operation: 'LATEST_PRICE_UPDATES' as const,
        source: 'PYTH_CORE' as const,
        sourceNetworkId: PYTH_SOURCE_NETWORK_ID,
        feedIds: Object.freeze([feedId]) as readonly [string],
        encoding: 'hex' as const,
        parsed: true as const,
        ignoreInvalidPriceIds: false as const,
      });
      let response: unknown;
      try {
        response = await this.transport.exchange(transportRequest);
      } catch {
        return transcriptUnavailable();
      }
      assertBoundedData(response, PYTH_RESPONSE_BOUNDS);
      const envelope = exactDataRecord(response, ['binary', 'parsed']);
      const binary = exactDataRecord(envelope.binary, ['data', 'encoding']);
      if (binary.encoding !== 'hex' || !Array.isArray(binary.data) || binary.data.length !== 1) {
        return transcriptUnavailable();
      }
      const updateBytes = binary.data[0];
      if (
        typeof updateBytes !== 'string' ||
        !/^(?:[0-9a-f]{2})+$/u.test(updateBytes) ||
        updateBytes.length / 2 > MAXIMUM_BINARY_UPDATE_BYTES
      ) {
        return transcriptUnavailable();
      }
      if (!Array.isArray(envelope.parsed) || envelope.parsed.length !== 1) {
        return transcriptUnavailable();
      }
      const parsed = exactDataRecord(envelope.parsed[0], ['ema_price', 'id', 'metadata', 'price']);
      if (parsed.id !== feedId) return transcriptUnavailable();
      const price = parsePrice(parsed.price);
      const emaPrice = parsePrice(parsed.ema_price);
      const metadata = parseMetadata(parsed.metadata);
      if (
        emaPrice.publishTime !== price.publishTime ||
        metadata.previousPublishTime > price.publishTime ||
        metadata.proofAvailableTime < price.publishTime
      ) {
        return transcriptUnavailable();
      }
      const observedAt = canonicalObservedAt(this.clock.now());
      const pricedAt = unixSecondsToTimestamp(price.publishTime);
      const proofAvailableAt = unixSecondsToTimestamp(metadata.proofAvailableTime);
      if (Date.parse(proofAvailableAt) > Date.parse(observedAt)) return transcriptUnavailable();
      assertCurrentSourceTime(pricedAt, observedAt);
      const sourceUpdateId = sha256HexBytes(updateBytes);
      const normalizedPrice = normalizeUnsignedFixedDecimal(
        price.price,
        -price.exponent,
        'HALF_EVEN',
      );
      if (normalizedPrice === '0') return transcriptUnavailable();
      const observation = normalizeStablecoinPriceObservation({
        asset,
        sourceId: 'PYTH_CORE',
        sourceReference: feedId,
        sourceSequence: String(metadata.slot),
        sourceUpdateId,
        pricedAt,
        observedAt,
        usdRateMantissa: normalizedPrice,
        usdRateScale: 8,
        confidence: {
          kind: 'PUBLISHED_ABSOLUTE_USD',
          mantissa: normalizeUnsignedFixedDecimal(price.confidence, -price.exponent, 'CEILING'),
          scale: 8,
        },
      });
      return Object.freeze({
        schemaVersion: 1,
        observation,
        transcriptFingerprintSha256: fingerprintTranscript(
          'crypto-lending:pyth-hermes-price-transcript:v1',
          [asset, feedId, updateBytes, parsed, observedAt],
        ),
        sourceNetworkId: PYTH_SOURCE_NETWORK_ID,
        sourcePosition: String(metadata.slot),
        sourceFinality: 'PYTH_HERMES_METADATA_UNVERIFIED',
        sourceProofStatus: 'PYTH_BINARY_UPDATE_SIGNATURE_UNVERIFIED',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION',
        mayRecordAsVerifiedEvidence: false,
      });
    } catch (error) {
      if (error instanceof StablecoinPriceTranscriptUnavailableError) throw error;
      return transcriptUnavailable();
    }
  }
}

function pythFeedId(stablecoin: SupportedStablecoin): string {
  return STABLECOIN_VALUATION_FEED_REFERENCES[stablecoin].PYTH_CORE;
}

function parsePrice(value: unknown): PythPrice {
  const record = exactDataRecord(value, ['conf', 'expo', 'price', 'publish_time']);
  const price = positiveCanonicalInteger(record.price, MAXIMUM_SIGNED_INT64);
  const confidence = canonicalUnsignedInteger(record.conf, MAXIMUM_UNSIGNED_INT64);
  if (
    typeof record.expo !== 'number' ||
    !Number.isSafeInteger(record.expo) ||
    record.expo > 0 ||
    record.expo < -36 ||
    typeof record.publish_time !== 'number' ||
    !Number.isSafeInteger(record.publish_time) ||
    record.publish_time <= 0
  ) {
    return transcriptUnavailable();
  }
  const publishTime = BigInt(record.publish_time);
  unixSecondsToTimestamp(publishTime);
  return Object.freeze({
    price,
    confidence,
    exponent: record.expo,
    publishTime,
  });
}

function parseMetadata(value: unknown): PythMetadata {
  const record = exactDataRecord(value, ['prev_publish_time', 'proof_available_time', 'slot']);
  if (
    typeof record.slot !== 'number' ||
    !Number.isSafeInteger(record.slot) ||
    record.slot <= 0 ||
    typeof record.proof_available_time !== 'number' ||
    !Number.isSafeInteger(record.proof_available_time) ||
    record.proof_available_time <= 0 ||
    typeof record.prev_publish_time !== 'number' ||
    !Number.isSafeInteger(record.prev_publish_time) ||
    record.prev_publish_time <= 0
  ) {
    return transcriptUnavailable();
  }
  const proofAvailableTime = BigInt(record.proof_available_time);
  const previousPublishTime = BigInt(record.prev_publish_time);
  unixSecondsToTimestamp(proofAvailableTime);
  unixSecondsToTimestamp(previousPublishTime);
  return Object.freeze({
    slot: record.slot,
    proofAvailableTime,
    previousPublishTime,
  });
}
