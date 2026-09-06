import { isProxy } from 'node:util/types';

import type { QueryResultRow } from 'pg';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../domain/mainnet-provider-position-chain-assessment';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE,
  DormantProviderPositionChainAnchorEvidenceProducer,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
  type ProviderPositionChainAnchorEvidenceRecordCandidateV1,
} from '../application/dormant-provider-position-chain-anchor-evidence.producer';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
  type ProviderPositionChainAnchorEvidenceRecordReceiptV1,
  type ProviderPositionChainAnchorEvidenceRecorderPort,
  type RecordProviderPositionChainAnchorEvidenceRequestV1,
} from '../application/ports/provider-position-chain-anchor-evidence-recorder.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const SOURCE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const APPROVAL_ID = /^[a-z0-9](?:[a-z0-9._:-]{1,126}[a-z0-9])$/u;
const SOURCE_OBSERVATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_SHA256 = '0'.repeat(64);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

const RECORD_REQUEST_KEYS = Object.freeze([
  'recorderVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'producerCapability',
  'producerRequest',
  'signal',
] as const);
const PRODUCER_REQUEST_KEYS = Object.freeze([
  'producerVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'networkId',
  'sourceFamilyId',
  'sourceId',
  'sourceKind',
  'sourceObservationId',
  'continuityFloor',
  'chainAnchor',
  'observedAt',
  'deadlineAt',
  'signal',
] as const);
const CANDIDATE_KEYS = Object.freeze([
  'producerVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'recordArguments',
] as const);
const ROW_COLUMNS = Object.freeze([
  'record_outcome',
  'recorded_evidence_fingerprint_sha256',
  'evidence_recorded_at',
] as const);

const RECORD_SQL = `SELECT
  evidence.record_outcome,
  evidence.recorded_evidence_fingerprint_sha256,
  pg_catalog.to_char(
    evidence.evidence_recorded_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS evidence_recorded_at
FROM record_provider_position_chain_anchor_evidence(
  $1::text, $2::text, $3::text, $4::text, $5::text,
  $6::jsonb, $7::jsonb, $8::timestamptz, $9::timestamptz,
  $10::jsonb, $11::timestamptz, $12::jsonb, $13::timestamptz,
  $14::text, $15::text, $16::text, $17::text, $18::text,
  $19::text, $20::text, $21::text, $22::text, $23::timestamptz
) AS evidence`;

type NetworkId = typeof ETHEREUM | typeof SOLANA;
type SourceKind = 'RPC' | 'INDEXER' | 'PROVIDER_API';
type QueryWithCancellation = PostgresService['queryWithCancellation'];
type ReviewCandidate = DormantProviderPositionChainAnchorEvidenceProducer['reviewCandidate'];

const CANONICAL_PRODUCER_REVIEW = Object.getOwnPropertyDescriptor(
  DormantProviderPositionChainAnchorEvidenceProducer.prototype,
  'reviewCandidate',
)?.value as ReviewCandidate | undefined;

interface CapturedMethod<Method extends (...arguments_: never[]) => unknown> {
  readonly receiver: object;
  readonly method: Method;
}

interface CanonicalTime {
  readonly value: string;
  readonly milliseconds: number;
}

interface ReviewedProducerRequest {
  readonly request: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly networkId: NetworkId;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: SourceKind;
  readonly sourceObservationId: string;
  readonly continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly observedAt: CanonicalTime;
  readonly deadlineAt: CanonicalTime;
  readonly signal: AbortSignal;
}

interface ReviewedRecordRequest {
  readonly request: RecordProviderPositionChainAnchorEvidenceRequestV1;
  readonly producerCapability: unknown;
  readonly producerRequest: ReviewedProducerRequest;
  readonly signal: AbortSignal;
}

interface ReviewedCandidate {
  readonly candidate: ProviderPositionChainAnchorEvidenceRecordCandidateV1;
  readonly values: readonly unknown[];
  readonly assessedAtMilliseconds: number;
  readonly currentHeadAdvancedAtMilliseconds: number;
  readonly finalizedHeadAdvancedAtMilliseconds: number;
  readonly sourcePairApprovalExpiresAtMilliseconds: number;
  readonly networkId: NetworkId;
}

interface RecordRow extends QueryResultRow {
  record_outcome: string;
  recorded_evidence_fingerprint_sha256: string;
  evidence_recorded_at: string;
}

class ProviderPositionChainAnchorEvidenceRecordError extends Error {
  readonly code = 'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_FAILED' as const;

  constructor() {
    super('Provider position chain-anchor evidence record failed');
    this.name = 'ProviderPositionChainAnchorEvidenceRecordError';
  }
}

export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ERROR = Object.freeze(
  new ProviderPositionChainAnchorEvidenceRecordError(),
);

function fail(): never {
  throw PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ERROR;
}

function frozenNullPrototype<T extends object>(fields: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, fields)) as Readonly<T>;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  requireFrozen: boolean,
  requireNullPrototype: boolean,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      (requireFrozen && !Object.isFrozen(value))
    ) {
      return fail();
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (requireNullPrototype && prototype !== null) ||
      (!requireNullPrototype && prototype !== null && prototype !== Object.prototype)
    ) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail();
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return fail();
  }
}

function exactDataArray(value: unknown, length: number): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value)
    ) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const expected = [...Array.from({ length }, (_, index) => String(index)), 'length'];
    const actual = Reflect.ownKeys(descriptors);
    if (
      descriptors['length']?.value !== length ||
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      return fail();
    }
    return Object.freeze(
      expected.slice(0, -1).map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
        return descriptor.value;
      }),
    );
  } catch {
    return fail();
  }
}

function canonicalTimestamp(value: unknown): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail();
  }
  return Object.freeze({ value, milliseconds });
}

function lowerSourceId(value: unknown): string {
  if (typeof value !== 'string' || !SOURCE_ID.test(value)) return fail();
  return value;
}

function sourceKind(value: unknown): SourceKind {
  if (value !== 'RPC' && value !== 'INDEXER' && value !== 'PROVIDER_API') return fail();
  return value;
}

function nonzeroSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256) return fail();
  return value;
}

function unsignedInteger(value: unknown, maximum: bigint): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return fail();
  try {
    if (BigInt(value) > maximum) return fail();
  } catch {
    return fail();
  }
  return value;
}

function anchor(
  value: unknown,
  networkId: NetworkId,
  requireFrozen: boolean,
  requireNullPrototype: boolean,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  const record = exactDataRecord(
    value,
    networkId === ETHEREUM ? ['kind', 'blockNumber', 'blockHash'] : ['kind', 'slot', 'root'],
    requireFrozen,
    requireNullPrototype,
  );
  if (networkId === ETHEREUM) {
    const blockNumber = unsignedInteger(record.blockNumber, MAX_UINT256);
    if (
      record.kind !== 'EVM_BLOCK' ||
      typeof record.blockHash !== 'string' ||
      !EVM_BLOCK_HASH.test(record.blockHash) ||
      /^0x0{64}$/u.test(record.blockHash)
    ) {
      return fail();
    }
    return frozenNullPrototype({
      kind: 'EVM_BLOCK' as const,
      blockNumber,
      blockHash: record.blockHash,
    });
  }
  const slot = unsignedInteger(record.slot, MAX_UINT64);
  const root = unsignedInteger(record.root, MAX_UINT64);
  if (record.kind !== 'SOLANA_SLOT' || BigInt(root) > BigInt(slot)) return fail();
  return frozenNullPrototype({ kind: 'SOLANA_SLOT' as const, slot, root });
}

function sameAnchor(
  left: MainnetProviderPositionAssessmentChainAnchorV1,
  right: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  return left.kind === 'EVM_BLOCK' && right.kind === 'EVM_BLOCK'
    ? left.blockNumber === right.blockNumber && left.blockHash === right.blockHash
    : left.kind === 'SOLANA_SLOT' && right.kind === 'SOLANA_SLOT'
      ? left.slot === right.slot && left.root === right.root
      : false;
}

function nonRegressing(
  floor: MainnetProviderPositionAssessmentChainAnchorV1,
  value: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  if (floor.kind === 'EVM_BLOCK' && value.kind === 'EVM_BLOCK') {
    return (
      BigInt(value.blockNumber) > BigInt(floor.blockNumber) ||
      (value.blockNumber === floor.blockNumber && value.blockHash === floor.blockHash)
    );
  }
  return (
    floor.kind === 'SOLANA_SLOT' &&
    value.kind === 'SOLANA_SLOT' &&
    BigInt(value.slot) >= BigInt(floor.slot) &&
    BigInt(value.root) >= BigInt(floor.root)
  );
}

function finalizedNotAhead(
  finalized: MainnetProviderPositionAssessmentChainAnchorV1,
  current: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  if (finalized.kind === 'EVM_BLOCK' && current.kind === 'EVM_BLOCK') {
    return (
      BigInt(finalized.blockNumber) < BigInt(current.blockNumber) ||
      (finalized.blockNumber === current.blockNumber && finalized.blockHash === current.blockHash)
    );
  }
  return (
    finalized.kind === 'SOLANA_SLOT' &&
    current.kind === 'SOLANA_SLOT' &&
    BigInt(finalized.slot) <= BigInt(current.slot) &&
    BigInt(finalized.root) <= BigInt(current.root)
  );
}

function authenticSignal(value: unknown): AbortSignal {
  try {
    if (
      ABORTED_GETTER === undefined ||
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype
    ) {
      return fail();
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch {
    return fail();
  }
}

function isAborted(value: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) return fail();
    return Reflect.apply(ABORTED_GETTER, value, []) as boolean;
  } catch {
    return fail();
  }
}

function reviewedProducerRequest(value: unknown): ReviewedProducerRequest {
  const record = exactDataRecord(value, PRODUCER_REQUEST_KEYS, true, false);
  const networkId = record.networkId;
  if (networkId !== ETHEREUM && networkId !== SOLANA) return fail();
  const sourceFamilyId = lowerSourceId(record.sourceFamilyId);
  const sourceId = lowerSourceId(record.sourceId);
  const kind = sourceKind(record.sourceKind);
  const sourceObservationId = record.sourceObservationId;
  if (
    record.producerVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    typeof sourceObservationId !== 'string' ||
    !SOURCE_OBSERVATION_ID.test(sourceObservationId)
  ) {
    return fail();
  }
  const continuityFloor = anchor(record.continuityFloor, networkId, true, false);
  const chainAnchor = anchor(record.chainAnchor, networkId, true, false);
  const observedAt = canonicalTimestamp(record.observedAt);
  const deadlineAt = canonicalTimestamp(record.deadlineAt);
  const signal = authenticSignal(record.signal);
  const expectedObservationId =
    chainAnchor.kind === 'EVM_BLOCK'
      ? `ethereum-block-${chainAnchor.blockNumber}`
      : `solana-slot-${chainAnchor.slot}`;
  if (
    sourceObservationId !== expectedObservationId ||
    !nonRegressing(continuityFloor, chainAnchor) ||
    observedAt.milliseconds >= deadlineAt.milliseconds ||
    isAborted(signal)
  ) {
    return fail();
  }
  return frozenNullPrototype({
    request: value as ProduceProviderPositionChainAnchorEvidenceRequestV1,
    networkId,
    sourceFamilyId,
    sourceId,
    sourceKind: kind,
    sourceObservationId,
    continuityFloor,
    chainAnchor,
    observedAt,
    deadlineAt,
    signal,
  });
}

function reviewedRecordRequest(value: unknown): ReviewedRecordRequest {
  const record = exactDataRecord(value, RECORD_REQUEST_KEYS, true, false);
  if (
    record.recorderVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE ||
    record.mayAuthorizeFinancialAction !== false
  ) {
    return fail();
  }
  const producerRequest = reviewedProducerRequest(record.producerRequest);
  const signal = authenticSignal(record.signal);
  if (signal !== producerRequest.signal || isAborted(signal)) return fail();
  return frozenNullPrototype({
    request: value as RecordProviderPositionChainAnchorEvidenceRequestV1,
    producerCapability: record.producerCapability,
    producerRequest,
    signal,
  });
}

function captureMethod<Method extends (...arguments_: never[]) => unknown>(
  value: unknown,
  name: string,
): CapturedMethod<Method> {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return fail();
    }
    let current: object | null = value;
    for (
      let depth = 0;
      current !== null &&
      current !== Object.prototype &&
      current !== Function.prototype &&
      depth < 8;
      depth += 1
    ) {
      if (isProxy(current)) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || typeof descriptor.value !== 'function') return fail();
        if (isProxy(descriptor.value)) return fail();
        return Object.freeze({ receiver: value, method: descriptor.value as Method });
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail();
  } catch {
    return fail();
  }
}

function captureProducerReview(
  value: DormantProviderPositionChainAnchorEvidenceProducer,
): CapturedMethod<ReviewCandidate> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !==
        DormantProviderPositionChainAnchorEvidenceProducer.prototype ||
      Object.getOwnPropertyDescriptor(value, 'reviewCandidate') !== undefined
    ) {
      return fail();
    }
    if (typeof CANONICAL_PRODUCER_REVIEW !== 'function' || isProxy(CANONICAL_PRODUCER_REVIEW)) {
      return fail();
    }
    return Object.freeze({ receiver: value, method: CANONICAL_PRODUCER_REVIEW });
  } catch {
    return fail();
  }
}

function reviewCandidate(
  captured: CapturedMethod<ReviewCandidate>,
  capability: unknown,
  request: ProduceProviderPositionChainAnchorEvidenceRequestV1,
): unknown {
  try {
    return Reflect.apply(captured.method, captured.receiver, [capability, request]);
  } catch {
    return fail();
  }
}

function reviewedCandidate(value: unknown, request: ReviewedProducerRequest): ReviewedCandidate {
  const record = exactDataRecord(value, CANDIDATE_KEYS, true, true);
  if (
    record.producerVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false
  ) {
    return fail();
  }
  const arguments_ = exactDataArray(record.recordArguments, 23);
  const networkId = arguments_[0];
  if (networkId !== ETHEREUM && networkId !== SOLANA) return fail();
  const candidateSourceFamilyId = lowerSourceId(arguments_[1]);
  const candidateSourceId = lowerSourceId(arguments_[2]);
  const candidateSourceKind = sourceKind(arguments_[3]);
  const sourceObservationId = arguments_[4];
  if (typeof sourceObservationId !== 'string' || !SOURCE_OBSERVATION_ID.test(sourceObservationId)) {
    return fail();
  }
  const continuityFloor = anchor(arguments_[5], networkId, true, true);
  const chainAnchor = anchor(arguments_[6], networkId, true, true);
  const observedAt = canonicalTimestamp(arguments_[7]);
  const assessedAt = canonicalTimestamp(arguments_[8]);
  const currentHead = anchor(arguments_[9], networkId, true, true);
  const currentHeadAdvancedAt = canonicalTimestamp(arguments_[10]);
  const finalizedHead = anchor(arguments_[11], networkId, true, true);
  const finalizedHeadAdvancedAt = canonicalTimestamp(arguments_[12]);
  const identityProofSha256 = nonzeroSha256(arguments_[13]);
  const liveCapabilityProofSha256 = nonzeroSha256(arguments_[14]);
  const lineageProofSha256 = nonzeroSha256(arguments_[15]);
  const primarySourceFamilyId = lowerSourceId(arguments_[16]);
  const primarySourceId = lowerSourceId(arguments_[17]);
  const corroboratingSourceFamilyId = lowerSourceId(arguments_[18]);
  const corroboratingSourceId = lowerSourceId(arguments_[19]);
  const sourcePairApprovalId = arguments_[20];
  if (typeof sourcePairApprovalId !== 'string' || !APPROVAL_ID.test(sourcePairApprovalId)) {
    return fail();
  }
  const registryFingerprintSha256 = nonzeroSha256(arguments_[21]);
  const approvalExpiresAt = canonicalTimestamp(arguments_[22]);
  const expectedObservationId =
    chainAnchor.kind === 'EVM_BLOCK'
      ? `ethereum-block-${chainAnchor.blockNumber}`
      : `solana-slot-${chainAnchor.slot}`;
  const primaryKey = `${primarySourceFamilyId}\u0000${primarySourceId}`;
  const corroboratingKey = `${corroboratingSourceFamilyId}\u0000${corroboratingSourceId}`;
  const selectedIsPairMember =
    (candidateSourceFamilyId === primarySourceFamilyId && candidateSourceId === primarySourceId) ||
    (candidateSourceFamilyId === corroboratingSourceFamilyId &&
      candidateSourceId === corroboratingSourceId);
  if (
    networkId !== request.networkId ||
    candidateSourceFamilyId !== request.sourceFamilyId ||
    candidateSourceId !== request.sourceId ||
    candidateSourceKind !== request.sourceKind ||
    sourceObservationId !== request.sourceObservationId ||
    sourceObservationId !== expectedObservationId ||
    !sameAnchor(continuityFloor, request.continuityFloor) ||
    !sameAnchor(chainAnchor, request.chainAnchor) ||
    observedAt.value !== request.observedAt.value ||
    !nonRegressing(continuityFloor, chainAnchor) ||
    !nonRegressing(chainAnchor, currentHead) ||
    !finalizedNotAhead(finalizedHead, currentHead) ||
    observedAt.milliseconds > assessedAt.milliseconds ||
    assessedAt.milliseconds >= request.deadlineAt.milliseconds ||
    currentHeadAdvancedAt.milliseconds > assessedAt.milliseconds ||
    finalizedHeadAdvancedAt.milliseconds > assessedAt.milliseconds ||
    assessedAt.milliseconds >= approvalExpiresAt.milliseconds ||
    primarySourceFamilyId === corroboratingSourceFamilyId ||
    primarySourceId === corroboratingSourceId ||
    primaryKey >= corroboratingKey ||
    !selectedIsPairMember ||
    new Set([identityProofSha256, liveCapabilityProofSha256, lineageProofSha256]).size !== 3
  ) {
    return fail();
  }
  return frozenNullPrototype({
    candidate: value as ProviderPositionChainAnchorEvidenceRecordCandidateV1,
    values: Object.freeze([
      networkId,
      candidateSourceFamilyId,
      candidateSourceId,
      candidateSourceKind,
      sourceObservationId,
      JSON.stringify(continuityFloor),
      JSON.stringify(chainAnchor),
      observedAt.value,
      assessedAt.value,
      JSON.stringify(currentHead),
      currentHeadAdvancedAt.value,
      JSON.stringify(finalizedHead),
      finalizedHeadAdvancedAt.value,
      identityProofSha256,
      liveCapabilityProofSha256,
      lineageProofSha256,
      primarySourceFamilyId,
      primarySourceId,
      corroboratingSourceFamilyId,
      corroboratingSourceId,
      sourcePairApprovalId,
      registryFingerprintSha256,
      approvalExpiresAt.value,
    ]),
    assessedAtMilliseconds: assessedAt.milliseconds,
    currentHeadAdvancedAtMilliseconds: currentHeadAdvancedAt.milliseconds,
    finalizedHeadAdvancedAtMilliseconds: finalizedHeadAdvancedAt.milliseconds,
    sourcePairApprovalExpiresAtMilliseconds: approvalExpiresAt.milliseconds,
    networkId,
  });
}

function genuinePromise(value: unknown): value is Promise<unknown> {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      !isProxy(value) &&
      Object.getPrototypeOf(value) === Promise.prototype
    );
  } catch {
    return false;
  }
}

function singleRow(value: unknown): RecordRow {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return fail();
    const rowsDescriptor = Object.getOwnPropertyDescriptor(value, 'rows');
    if (!rowsDescriptor?.enumerable || !('value' in rowsDescriptor)) return fail();
    const rows = rowsDescriptor.value as unknown;
    if (!Array.isArray(rows) || isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(rows) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      descriptors['length']?.value !== 1 ||
      keys.length !== 2 ||
      keys.some((key) => key !== '0' && key !== 'length') ||
      !descriptors['0']?.enumerable ||
      !('value' in descriptors['0'])
    ) {
      return fail();
    }
    return exactDataRecord(descriptors['0'].value, ROW_COLUMNS, false, false) as RecordRow;
  } catch {
    return fail();
  }
}

function receiptFromRow(
  row: RecordRow,
  candidate: ReviewedCandidate,
  producerRequest: ReviewedProducerRequest,
): ProviderPositionChainAnchorEvidenceRecordReceiptV1 {
  if (row.record_outcome !== 'RECORDED' && row.record_outcome !== 'IDEMPOTENT_REPLAY') {
    return fail();
  }
  const fingerprint = nonzeroSha256(row.recorded_evidence_fingerprint_sha256);
  const recordedAt = canonicalTimestamp(row.evidence_recorded_at);
  const currentLifetime = candidate.networkId === ETHEREUM ? 60_000 : 15_000;
  const finalizedLifetime = candidate.networkId === ETHEREUM ? 1_800_000 : 90_000;
  const currentExpiresAt = candidate.currentHeadAdvancedAtMilliseconds + currentLifetime;
  const finalizedExpiresAt = candidate.finalizedHeadAdvancedAtMilliseconds + finalizedLifetime;
  if (
    !Number.isSafeInteger(currentExpiresAt) ||
    !Number.isSafeInteger(finalizedExpiresAt) ||
    recordedAt.milliseconds < candidate.assessedAtMilliseconds ||
    recordedAt.milliseconds >= producerRequest.deadlineAt.milliseconds ||
    recordedAt.milliseconds >= candidate.sourcePairApprovalExpiresAtMilliseconds ||
    recordedAt.milliseconds >= currentExpiresAt ||
    recordedAt.milliseconds >= finalizedExpiresAt
  ) {
    return fail();
  }
  return frozenNullPrototype({
    recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE,
    mayAuthorizeFinancialAction: false as const,
    recordOutcome: row.record_outcome,
    recordedEvidenceFingerprintSha256: fingerprint,
    evidenceRecordedAt: recordedAt.value,
  });
}

/**
 * Dormant migration-0029 adapter. It is intentionally unregistered and owns
 * no provider transport, customer context, financial authority, or database
 * grant. Construction captures two capabilities but performs no I/O.
 *
 * The database function's own clock is the atomic record-time freshness and
 * pair-expiry boundary. A late database timestamp is rejected here, but that
 * cannot roll back a write: atomic producer-deadline enforcement requires a
 * future database-contract change before this dormant adapter may be activated.
 */
export class PostgresProviderPositionChainAnchorEvidenceRecorder implements ProviderPositionChainAnchorEvidenceRecorderPort {
  readonly recorderVersion = PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION;

  readonly #producerReview: CapturedMethod<ReviewCandidate>;
  readonly #databaseQuery: CapturedMethod<QueryWithCancellation>;
  readonly #issued = new WeakMap<object, RecordProviderPositionChainAnchorEvidenceRequestV1>();

  constructor(
    producer: DormantProviderPositionChainAnchorEvidenceProducer,
    postgres: PostgresService,
  ) {
    this.#producerReview = captureProducerReview(producer);
    this.#databaseQuery = captureMethod<QueryWithCancellation>(postgres, 'queryWithCancellation');
  }

  async recordEvidence(
    requestInput: RecordProviderPositionChainAnchorEvidenceRequestV1,
  ): Promise<unknown> {
    try {
      const request = reviewedRecordRequest(requestInput);
      const firstReview = reviewCandidate(
        this.#producerReview,
        request.producerCapability,
        request.producerRequest.request,
      );
      if (firstReview !== request.producerCapability) return fail();
      if (isAborted(request.signal)) return fail();
      const candidate = reviewedCandidate(firstReview, request.producerRequest);
      const operation = Reflect.apply(this.#databaseQuery.method, this.#databaseQuery.receiver, [
        RECORD_SQL,
        candidate.values,
        request.signal,
      ]) as unknown;
      if (!genuinePromise(operation)) return fail();
      const result = await operation;
      if (isAborted(request.signal)) return fail();
      const secondReview = reviewCandidate(
        this.#producerReview,
        request.producerCapability,
        request.producerRequest.request,
      );
      if (secondReview !== firstReview || secondReview !== candidate.candidate) return fail();
      const receipt = receiptFromRow(singleRow(result), candidate, request.producerRequest);
      this.#issued.set(receipt, request.request);
      return receipt;
    } catch {
      return fail();
    }
  }

  verifyReceipt(
    capability: unknown,
    request: RecordProviderPositionChainAnchorEvidenceRequestV1,
  ): boolean {
    try {
      return (
        typeof capability === 'object' &&
        capability !== null &&
        this.#issued.get(capability) === request
      );
    } catch {
      return false;
    }
  }
}
