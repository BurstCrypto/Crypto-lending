import { isProxy } from 'node:util/types';

import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../domain/mainnet-provider-position-chain-assessment';
import {
  DormantProviderPositionChainAnchorEvidenceProducer,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
  type ProviderPositionChainAnchorEvidenceRecordCandidateV1,
} from './dormant-provider-position-chain-anchor-evidence.producer';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION,
  type AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
  type ProviderPositionChainAnchorCandidateFinalityPort,
  type ProviderPositionChainAnchorCandidateFinalityReason,
  type ProviderPositionChainAnchorCandidateFinalityResultV1,
  type ProviderPositionChainAnchorCandidateFinalityStatus,
} from './ports/provider-position-chain-anchor-candidate-finality.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const SOURCE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const SOURCE_OBSERVATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_SHA256 = '0'.repeat(64);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const ETHEREUM_CURRENT_HEAD_LIFETIME_MILLISECONDS = 60_000;
const ETHEREUM_FINALIZED_HEAD_LIFETIME_MILLISECONDS = 1_800_000;
const SOLANA_CURRENT_HEAD_LIFETIME_MILLISECONDS = 15_000;
const SOLANA_FINALIZED_HEAD_LIFETIME_MILLISECONDS = 90_000;

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const CANONICAL_DATE_GET_TIME = Date.prototype.getTime;
const CANONICAL_DATE_TO_ISO_STRING = Date.prototype.toISOString;

const ASSESS_REQUEST_KEYS = Object.freeze([
  'finalityVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'mayCreatePositionSnapshot',
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

type NetworkId = typeof ETHEREUM | typeof SOLANA;
type SourceKind = 'RPC' | 'INDEXER' | 'PROVIDER_API';
type ReviewCandidate = DormantProviderPositionChainAnchorEvidenceProducer['reviewCandidate'];

const CANONICAL_PRODUCER_REVIEW = Object.getOwnPropertyDescriptor(
  DormantProviderPositionChainAnchorEvidenceProducer.prototype,
  'reviewCandidate',
)?.value as ReviewCandidate | undefined;

export interface ProviderPositionChainAnchorCandidateFinalityClock {
  now(): Date;
}

export type ProviderPositionChainAnchorCandidateFinalityErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'CANDIDATE_UNAVAILABLE'
  | 'STALE_ASSESSMENT'
  | 'CLOCK_REGRESSION';

export class ProviderPositionChainAnchorCandidateFinalityUnavailableError extends Error {
  constructor(readonly code: ProviderPositionChainAnchorCandidateFinalityErrorCode) {
    super('Provider-position chain-anchor candidate finality is unavailable.');
    this.name = 'ProviderPositionChainAnchorCandidateFinalityUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

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

interface ReviewedAssessRequest {
  readonly request: AssessProviderPositionChainAnchorCandidateFinalityRequestV1;
  readonly producerCapability: unknown;
  readonly producerRequest: ReviewedProducerRequest;
  readonly signal: AbortSignal;
}

interface ReviewedCandidate {
  readonly candidate: ProviderPositionChainAnchorEvidenceRecordCandidateV1;
  readonly candidateAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly currentHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly finalizedHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly assessedAt: CanonicalTime;
  readonly currentHeadAdvancedAt: CanonicalTime;
  readonly finalizedHeadAdvancedAt: CanonicalTime;
  readonly lineageProofSha256: string;
  readonly approvalExpiresAt: CanonicalTime;
  readonly expiresAtExclusive: CanonicalTime;
}

interface Classification {
  readonly status: ProviderPositionChainAnchorCandidateFinalityStatus;
  readonly reason: ProviderPositionChainAnchorCandidateFinalityReason;
  readonly comparedSolanaFinalizedRoot: boolean;
}

interface IssuedAssessment {
  readonly request: AssessProviderPositionChainAnchorCandidateFinalityRequestV1;
  readonly producerCapability: unknown;
  readonly producerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly candidate: ProviderPositionChainAnchorEvidenceRecordCandidateV1;
  readonly result: ProviderPositionChainAnchorCandidateFinalityResultV1;
  readonly signal: AbortSignal;
  readonly issuedAtMilliseconds: number;
  readonly expiresAtExclusiveMilliseconds: number;
}

function fail(code: ProviderPositionChainAnchorCandidateFinalityErrorCode): never {
  throw new ProviderPositionChainAnchorCandidateFinalityUnavailableError(code);
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
  requireFrozen: boolean,
  requireNullPrototype = false,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      (requireFrozen && !Object.isFrozen(value))
    ) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (requireNullPrototype && prototype !== null) ||
      (!requireNullPrototype && prototype !== Object.prototype && prototype !== null)
    ) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return fail(code);
  }
}

function exactDataArray(
  value: unknown,
  length: number,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value)
    ) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const expected = [...Array.from({ length }, (_, index) => String(index)), 'length'];
    const actual = Reflect.ownKeys(descriptors);
    if (
      descriptors['length']?.value !== length ||
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      return fail(code);
    }
    return Object.freeze(
      expected.slice(0, -1).map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
        return descriptor.value;
      }),
    );
  } catch {
    return fail(code);
  }
}

function canonicalTimestamp(
  value: unknown,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    Reflect.apply(CANONICAL_DATE_TO_ISO_STRING, new Date(milliseconds), []) !== value
  ) {
    return fail(code);
  }
  return Object.freeze({ value, milliseconds });
}

function timestampFromMilliseconds(
  milliseconds: number,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
): CanonicalTime {
  try {
    if (!Number.isSafeInteger(milliseconds)) return fail(code);
    const value = Reflect.apply(CANONICAL_DATE_TO_ISO_STRING, new Date(milliseconds), []) as string;
    return Object.freeze({ value, milliseconds });
  } catch {
    return fail(code);
  }
}

function unsignedInteger(
  value: unknown,
  maximum: bigint,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return fail(code);
  try {
    if (BigInt(value) > maximum) return fail(code);
  } catch {
    return fail(code);
  }
  return value;
}

function anchor(
  value: unknown,
  networkId: NetworkId,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
  requireNullPrototype: boolean,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  if (networkId === ETHEREUM) {
    const record = exactDataRecord(
      value,
      ['kind', 'blockNumber', 'blockHash'],
      code,
      true,
      requireNullPrototype,
    );
    const blockNumber = unsignedInteger(record.blockNumber, MAX_UINT256, code);
    if (
      record.kind !== 'EVM_BLOCK' ||
      typeof record.blockHash !== 'string' ||
      !EVM_BLOCK_HASH.test(record.blockHash) ||
      /^0x0{64}$/u.test(record.blockHash)
    ) {
      return fail(code);
    }
    return frozenNullPrototype({
      kind: 'EVM_BLOCK' as const,
      blockNumber,
      blockHash: record.blockHash,
    });
  }
  const record = exactDataRecord(value, ['kind', 'slot', 'root'], code, true, requireNullPrototype);
  const slot = unsignedInteger(record.slot, MAX_UINT64, code);
  const root = unsignedInteger(record.root, MAX_UINT64, code);
  if (record.kind !== 'SOLANA_SLOT' || BigInt(root) > BigInt(slot)) return fail(code);
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

function signal(value: unknown): AbortSignal {
  try {
    if (
      ABORTED_GETTER === undefined ||
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype
    ) {
      return fail('INVALID_REQUEST');
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch {
    return fail('INVALID_REQUEST');
  }
}

function aborted(value: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) return fail('INVALID_REQUEST');
    return Reflect.apply(ABORTED_GETTER, value, []) as boolean;
  } catch {
    return fail('INVALID_REQUEST');
  }
}

function sourceId(
  value: unknown,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
): string {
  if (typeof value !== 'string' || !SOURCE_ID.test(value)) return fail(code);
  return value;
}

function sourceKind(
  value: unknown,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
): SourceKind {
  if (value !== 'RPC' && value !== 'INDEXER' && value !== 'PROVIDER_API') {
    return fail(code);
  }
  return value;
}

function nonzeroSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256) {
    return fail('CANDIDATE_UNAVAILABLE');
  }
  return value;
}

function reviewedProducerRequest(value: unknown): ReviewedProducerRequest {
  const record = exactDataRecord(value, PRODUCER_REQUEST_KEYS, 'INVALID_REQUEST', true);
  const networkId = record.networkId;
  if (networkId !== ETHEREUM && networkId !== SOLANA) return fail('INVALID_REQUEST');
  const familyId = sourceId(record.sourceFamilyId, 'INVALID_REQUEST');
  const selectedSourceId = sourceId(record.sourceId, 'INVALID_REQUEST');
  const kind = sourceKind(record.sourceKind, 'INVALID_REQUEST');
  if (
    record.producerVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    typeof record.sourceObservationId !== 'string' ||
    !SOURCE_OBSERVATION_ID.test(record.sourceObservationId)
  ) {
    return fail('INVALID_REQUEST');
  }
  const continuityFloor = anchor(record.continuityFloor, networkId, 'INVALID_REQUEST', false);
  const chainAnchor = anchor(record.chainAnchor, networkId, 'INVALID_REQUEST', false);
  const observedAt = canonicalTimestamp(record.observedAt, 'INVALID_REQUEST');
  const deadlineAt = canonicalTimestamp(record.deadlineAt, 'INVALID_REQUEST');
  const requestSignal = signal(record.signal);
  const expectedObservationId =
    chainAnchor.kind === 'EVM_BLOCK'
      ? `ethereum-block-${chainAnchor.blockNumber}`
      : `solana-slot-${chainAnchor.slot}`;
  if (
    record.sourceObservationId !== expectedObservationId ||
    !nonRegressing(continuityFloor, chainAnchor) ||
    observedAt.milliseconds >= deadlineAt.milliseconds
  ) {
    return fail('INVALID_REQUEST');
  }
  return frozenNullPrototype({
    request: value as ProduceProviderPositionChainAnchorEvidenceRequestV1,
    networkId,
    sourceFamilyId: familyId,
    sourceId: selectedSourceId,
    sourceKind: kind,
    sourceObservationId: record.sourceObservationId,
    continuityFloor,
    chainAnchor,
    observedAt,
    deadlineAt,
    signal: requestSignal,
  });
}

function reviewedAssessRequest(value: unknown): ReviewedAssessRequest {
  const record = exactDataRecord(value, ASSESS_REQUEST_KEYS, 'INVALID_REQUEST', true);
  if (
    record.finalityVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.mayCreatePositionSnapshot !== false
  ) {
    return fail('INVALID_REQUEST');
  }
  const producerRequest = reviewedProducerRequest(record.producerRequest);
  const requestSignal = signal(record.signal);
  if (requestSignal !== producerRequest.signal) return fail('INVALID_REQUEST');
  return frozenNullPrototype({
    request: value as AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
    producerCapability: record.producerCapability,
    producerRequest,
    signal: requestSignal,
  });
}

function captureMethod<Method extends (...arguments_: never[]) => unknown>(
  value: unknown,
  name: string,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
): CapturedMethod<Method> {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return fail(code);
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
      if (isProxy(current)) return fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || typeof descriptor.value !== 'function') return fail(code);
        if (isProxy(descriptor.value)) return fail(code);
        return Object.freeze({ receiver: value, method: descriptor.value as Method });
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail(code);
  } catch {
    return fail(code);
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
      Object.getOwnPropertyDescriptor(value, 'reviewCandidate') !== undefined ||
      typeof CANONICAL_PRODUCER_REVIEW !== 'function' ||
      isProxy(CANONICAL_PRODUCER_REVIEW)
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    return Object.freeze({ receiver: value, method: CANONICAL_PRODUCER_REVIEW });
  } catch {
    return fail('INVALID_CONFIGURATION');
  }
}

function reviewProducerCandidate(
  captured: CapturedMethod<ReviewCandidate>,
  capability: unknown,
  request: ProduceProviderPositionChainAnchorEvidenceRequestV1,
): unknown {
  try {
    return Reflect.apply(captured.method, captured.receiver, [capability, request]);
  } catch {
    return fail('CANDIDATE_UNAVAILABLE');
  }
}

function reviewedCandidate(value: unknown, request: ReviewedProducerRequest): ReviewedCandidate {
  const record = exactDataRecord(value, CANDIDATE_KEYS, 'CANDIDATE_UNAVAILABLE', true, true);
  if (
    record.producerVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false
  ) {
    return fail('CANDIDATE_UNAVAILABLE');
  }
  const values = exactDataArray(record.recordArguments, 23, 'CANDIDATE_UNAVAILABLE');
  if (values[0] !== request.networkId) return fail('CANDIDATE_UNAVAILABLE');
  const candidateSourceFamilyId = sourceId(values[1], 'CANDIDATE_UNAVAILABLE');
  const candidateSourceId = sourceId(values[2], 'CANDIDATE_UNAVAILABLE');
  const candidateSourceKind = sourceKind(values[3], 'CANDIDATE_UNAVAILABLE');
  const sourceObservationId = values[4];
  const continuityFloor = anchor(values[5], request.networkId, 'CANDIDATE_UNAVAILABLE', true);
  const candidateAnchor = anchor(values[6], request.networkId, 'CANDIDATE_UNAVAILABLE', true);
  const observedAt = canonicalTimestamp(values[7], 'CANDIDATE_UNAVAILABLE');
  const assessedAt = canonicalTimestamp(values[8], 'CANDIDATE_UNAVAILABLE');
  const currentHead = anchor(values[9], request.networkId, 'CANDIDATE_UNAVAILABLE', true);
  const currentHeadAdvancedAt = canonicalTimestamp(values[10], 'CANDIDATE_UNAVAILABLE');
  const finalizedHead = anchor(values[11], request.networkId, 'CANDIDATE_UNAVAILABLE', true);
  const finalizedHeadAdvancedAt = canonicalTimestamp(values[12], 'CANDIDATE_UNAVAILABLE');
  const identityProofSha256 = nonzeroSha256(values[13]);
  const liveCapabilityProofSha256 = nonzeroSha256(values[14]);
  const lineageProofSha256 = nonzeroSha256(values[15]);
  const approvalExpiresAt = canonicalTimestamp(values[22], 'CANDIDATE_UNAVAILABLE');
  if (
    candidateSourceFamilyId !== request.sourceFamilyId ||
    candidateSourceId !== request.sourceId ||
    candidateSourceKind !== request.sourceKind ||
    sourceObservationId !== request.sourceObservationId ||
    !sameAnchor(continuityFloor, request.continuityFloor) ||
    !sameAnchor(candidateAnchor, request.chainAnchor) ||
    observedAt.value !== request.observedAt.value ||
    !nonRegressing(continuityFloor, candidateAnchor) ||
    !nonRegressing(candidateAnchor, currentHead) ||
    !finalizedNotAhead(finalizedHead, currentHead) ||
    observedAt.milliseconds > assessedAt.milliseconds ||
    assessedAt.milliseconds >= request.deadlineAt.milliseconds ||
    currentHeadAdvancedAt.milliseconds > assessedAt.milliseconds ||
    finalizedHeadAdvancedAt.milliseconds > assessedAt.milliseconds ||
    assessedAt.milliseconds >= approvalExpiresAt.milliseconds ||
    new Set([identityProofSha256, liveCapabilityProofSha256, lineageProofSha256]).size !== 3
  ) {
    return fail('CANDIDATE_UNAVAILABLE');
  }
  const currentLifetime =
    request.networkId === ETHEREUM
      ? ETHEREUM_CURRENT_HEAD_LIFETIME_MILLISECONDS
      : SOLANA_CURRENT_HEAD_LIFETIME_MILLISECONDS;
  const finalizedLifetime =
    request.networkId === ETHEREUM
      ? ETHEREUM_FINALIZED_HEAD_LIFETIME_MILLISECONDS
      : SOLANA_FINALIZED_HEAD_LIFETIME_MILLISECONDS;
  const expiresAtExclusive = timestampFromMilliseconds(
    Math.min(
      request.deadlineAt.milliseconds,
      approvalExpiresAt.milliseconds,
      currentHeadAdvancedAt.milliseconds + currentLifetime,
      finalizedHeadAdvancedAt.milliseconds + finalizedLifetime,
    ),
    'CANDIDATE_UNAVAILABLE',
  );
  return frozenNullPrototype({
    candidate: value as ProviderPositionChainAnchorEvidenceRecordCandidateV1,
    candidateAnchor,
    currentHead,
    finalizedHead,
    assessedAt,
    currentHeadAdvancedAt,
    finalizedHeadAdvancedAt,
    lineageProofSha256,
    approvalExpiresAt,
    expiresAtExclusive,
  });
}

function classify(candidate: ReviewedCandidate): Classification {
  if (
    candidate.candidateAnchor.kind === 'EVM_BLOCK' &&
    candidate.finalizedHead.kind === 'EVM_BLOCK'
  ) {
    const candidateHeight = BigInt(candidate.candidateAnchor.blockNumber);
    const finalizedHeight = BigInt(candidate.finalizedHead.blockNumber);
    if (finalizedHeight < candidateHeight) {
      return frozenNullPrototype({
        status: 'PENDING' as const,
        reason: 'ETHEREUM_FINALIZED_HEIGHT_BELOW_CANDIDATE' as const,
        comparedSolanaFinalizedRoot: false,
      });
    }
    if (finalizedHeight === candidateHeight) {
      return candidate.finalizedHead.blockHash === candidate.candidateAnchor.blockHash
        ? frozenNullPrototype({
            status: 'FINALIZED' as const,
            reason: 'ETHEREUM_FINALIZED_HASH_MATCH' as const,
            comparedSolanaFinalizedRoot: false,
          })
        : frozenNullPrototype({
            status: 'QUARANTINED' as const,
            reason: 'ETHEREUM_FINALIZED_HASH_CONFLICT' as const,
            comparedSolanaFinalizedRoot: false,
          });
    }
    return frozenNullPrototype({
      status: 'FINALIZED' as const,
      reason: 'ETHEREUM_FINALIZED_LINEAGE_COVERS_CANDIDATE' as const,
      comparedSolanaFinalizedRoot: false,
    });
  }
  if (
    candidate.candidateAnchor.kind !== 'SOLANA_SLOT' ||
    candidate.finalizedHead.kind !== 'SOLANA_SLOT'
  ) {
    return fail('CANDIDATE_UNAVAILABLE');
  }
  const candidateSlot = BigInt(candidate.candidateAnchor.slot);
  const candidateObservedRoot = BigInt(candidate.candidateAnchor.root);
  const finalizedRoot = BigInt(candidate.finalizedHead.root);
  if (finalizedRoot < candidateObservedRoot) {
    return frozenNullPrototype({
      status: 'QUARANTINED' as const,
      reason: 'SOLANA_FINALIZED_ROOT_REGRESSION' as const,
      comparedSolanaFinalizedRoot: true,
    });
  }
  return finalizedRoot >= candidateSlot
    ? frozenNullPrototype({
        status: 'FINALIZED' as const,
        reason: 'SOLANA_FINALIZED_ROOT_COVERS_CANDIDATE_SLOT' as const,
        comparedSolanaFinalizedRoot: true,
      })
    : frozenNullPrototype({
        status: 'PENDING' as const,
        reason: 'SOLANA_FINALIZED_ROOT_BELOW_CANDIDATE_SLOT' as const,
        comparedSolanaFinalizedRoot: true,
      });
}

function ensureCurrent(
  request: ReviewedAssessRequest,
  candidate: ReviewedCandidate,
  now: CanonicalTime,
  earliestAllowedMilliseconds: number,
): void {
  if (
    now.milliseconds < earliestAllowedMilliseconds ||
    now.milliseconds < candidate.assessedAt.milliseconds ||
    now.milliseconds >= candidate.expiresAtExclusive.milliseconds ||
    aborted(request.signal)
  ) {
    return fail(
      now.milliseconds < earliestAllowedMilliseconds ? 'CLOCK_REGRESSION' : 'STALE_ASSESSMENT',
    );
  }
}

/**
 * Pure, dormant finality classifier layered after the authenticated two-source
 * producer. Construction and assessment perform no network, database,
 * environment, timer, provider, snapshot, or financial action.
 */
export class DormantProviderPositionChainAnchorCandidateFinalityFinalizer implements ProviderPositionChainAnchorCandidateFinalityPort {
  readonly finalityVersion = PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION;

  readonly #producerReview: CapturedMethod<ReviewCandidate>;
  readonly #clock: CapturedMethod<ProviderPositionChainAnchorCandidateFinalityClock['now']>;
  readonly #issued = new WeakMap<object, IssuedAssessment>();
  #lastClockMilliseconds: number | null = null;

  constructor(
    producer: DormantProviderPositionChainAnchorEvidenceProducer,
    clock: ProviderPositionChainAnchorCandidateFinalityClock,
  ) {
    this.#producerReview = captureProducerReview(producer);
    this.#clock = captureMethod<ProviderPositionChainAnchorCandidateFinalityClock['now']>(
      clock,
      'now',
      'INVALID_CONFIGURATION',
    );
  }

  assessCandidate(
    requestInput: AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
  ): unknown {
    const request = reviewedAssessRequest(requestInput);
    const startedAt = this.#clockTime();
    if (
      startedAt.milliseconds >= request.producerRequest.deadlineAt.milliseconds ||
      aborted(request.signal)
    ) {
      return fail('STALE_ASSESSMENT');
    }

    const firstReview = reviewProducerCandidate(
      this.#producerReview,
      request.producerCapability,
      request.producerRequest.request,
    );
    if (firstReview !== request.producerCapability) return fail('CANDIDATE_UNAVAILABLE');

    // Candidate fields are inspected only after exact producer authentication.
    const candidate = reviewedCandidate(firstReview, request.producerRequest);
    ensureCurrent(request, candidate, startedAt, candidate.assessedAt.milliseconds);
    const classification = classify(candidate);

    const beforeSecondReview = this.#clockTime();
    ensureCurrent(request, candidate, beforeSecondReview, startedAt.milliseconds);
    const assessedAt = this.#clockTime();
    ensureCurrent(request, candidate, assessedAt, beforeSecondReview.milliseconds);
    const secondReview = reviewProducerCandidate(
      this.#producerReview,
      request.producerCapability,
      request.producerRequest.request,
    );
    if (secondReview !== firstReview || secondReview !== candidate.candidate) {
      return fail('CANDIDATE_UNAVAILABLE');
    }
    if (aborted(request.signal)) return fail('STALE_ASSESSMENT');

    const result = frozenNullPrototype({
      finalityVersion: PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_USE,
      mayAuthorizeFinancialAction: false as const,
      mayPersist: false as const,
      mayCreatePositionSnapshot: false as const,
      networkId: request.producerRequest.networkId,
      sourceObservationId: request.producerRequest.sourceObservationId,
      candidateAnchor: candidate.candidateAnchor,
      agreedFinalizedHead: candidate.finalizedHead,
      status: classification.status,
      reason: classification.reason,
      authenticatedLineageProof: true as const,
      comparedSolanaFinalizedRoot: classification.comparedSolanaFinalizedRoot,
      claimsSameSlotForkDetection: false as const,
      assessedAt: assessedAt.value,
      expiresAtExclusive: candidate.expiresAtExclusive.value,
    });
    this.#issued.set(
      result,
      frozenNullPrototype({
        request: request.request,
        producerCapability: request.producerCapability,
        producerRequest: request.producerRequest.request,
        candidate: candidate.candidate,
        result,
        signal: request.signal,
        issuedAtMilliseconds: assessedAt.milliseconds,
        expiresAtExclusiveMilliseconds: candidate.expiresAtExclusive.milliseconds,
      }),
    );
    return result;
  }

  reviewAssessment(
    capability: unknown,
    requestInput: AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
  ): ProviderPositionChainAnchorCandidateFinalityResultV1 | null {
    try {
      if (typeof capability !== 'object' || capability === null || isProxy(capability)) return null;
      const issued = this.#issued.get(capability);
      if (issued === undefined || issued.request !== requestInput || issued.result !== capability) {
        return null;
      }
      const request = reviewedAssessRequest(requestInput);
      if (
        request.producerCapability !== issued.producerCapability ||
        request.producerRequest.request !== issued.producerRequest ||
        request.signal !== issued.signal
      ) {
        return null;
      }
      const reviewedAt = this.#clockTime();
      if (
        reviewedAt.milliseconds < issued.issuedAtMilliseconds ||
        reviewedAt.milliseconds >= issued.expiresAtExclusiveMilliseconds ||
        aborted(issued.signal)
      ) {
        return fail(
          reviewedAt.milliseconds < issued.issuedAtMilliseconds
            ? 'CLOCK_REGRESSION'
            : 'STALE_ASSESSMENT',
        );
      }
      const producerReview = reviewProducerCandidate(
        this.#producerReview,
        issued.producerCapability,
        issued.producerRequest,
      );
      if (producerReview !== issued.candidate) return fail('CANDIDATE_UNAVAILABLE');
      const returnedAt = this.#clockTime();
      if (
        returnedAt.milliseconds < reviewedAt.milliseconds ||
        returnedAt.milliseconds >= issued.expiresAtExclusiveMilliseconds ||
        aborted(issued.signal)
      ) {
        return fail(
          returnedAt.milliseconds < reviewedAt.milliseconds
            ? 'CLOCK_REGRESSION'
            : 'STALE_ASSESSMENT',
        );
      }
      return issued.result;
    } catch (error) {
      if (error instanceof ProviderPositionChainAnchorCandidateFinalityUnavailableError) {
        throw error;
      }
      return fail('CANDIDATE_UNAVAILABLE');
    }
  }

  #clockTime(): CanonicalTime {
    let value: unknown;
    try {
      value = Reflect.apply(this.#clock.method, this.#clock.receiver, []);
      if (
        typeof value !== 'object' ||
        value === null ||
        isProxy(value) ||
        Object.getPrototypeOf(value) !== Date.prototype
      ) {
        return fail('INVALID_CONFIGURATION');
      }
      const milliseconds = Reflect.apply(CANONICAL_DATE_GET_TIME, value, []) as number;
      if (!Number.isSafeInteger(milliseconds)) return fail('INVALID_CONFIGURATION');
      if (this.#lastClockMilliseconds !== null && milliseconds < this.#lastClockMilliseconds) {
        return fail('CLOCK_REGRESSION');
      }
      this.#lastClockMilliseconds = milliseconds;
      return Object.freeze({
        value: Reflect.apply(CANONICAL_DATE_TO_ISO_STRING, value, []) as string,
        milliseconds,
      });
    } catch (error) {
      if (error instanceof ProviderPositionChainAnchorCandidateFinalityUnavailableError) {
        throw error;
      }
      return fail('INVALID_CONFIGURATION');
    }
  }
}
