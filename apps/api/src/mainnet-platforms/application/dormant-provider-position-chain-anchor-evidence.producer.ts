import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../domain/mainnet-provider-position-chain-assessment';
import type { MainnetProviderPositionSourceKind } from '../domain/mainnet-provider-position-observation-policy';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
  type ProviderPositionChainAnchorEvidenceSourceNetworkId,
  type ProviderPositionChainAnchorEvidenceSourcePort,
  type ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
} from './ports/provider-position-chain-anchor-evidence-source.port';

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
const MAX_DEADLINE_MILLISECONDS = 30_000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

const PRODUCE_REQUEST_KEYS = Object.freeze([
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
const SOURCE_ATTESTATION_KEYS = Object.freeze([
  'sourceVersion',
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
  'assessedAt',
  'currentHead',
  'currentHeadAdvancedAt',
  'finalizedHead',
  'finalizedHeadAdvancedAt',
  'identityProofSha256',
  'liveCapabilityProofSha256',
  'lineageProofSha256',
] as const);

export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION = 1 as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_ONLY' as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_ONLY' as const;

export type ProviderPositionChainAnchorEvidenceSourceRole = 'PRIMARY' | 'CORROBORATING';

export interface ProviderPositionChainAnchorEvidenceSourceIdentityV1 {
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
}

export interface ProviderPositionChainAnchorEvidenceSourcePairV1 {
  readonly networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId;
  readonly approvalId: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly primary: ProviderPositionChainAnchorEvidenceSourceIdentityV1;
  readonly corroborating: ProviderPositionChainAnchorEvidenceSourceIdentityV1;
}

export interface ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1 {
  readonly schemaVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION;
  readonly environment: 'MAINNET';
  readonly approvalStatus: 'NOT_APPROVED' | 'APPROVED';
  readonly pairs: readonly ProviderPositionChainAnchorEvidenceSourcePairV1[];
}

export interface ProviderPositionChainAnchorEvidenceSourcePairRegistryV1 extends ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1 {
  readonly fingerprintSha256: string;
}

export interface ProviderPositionChainAnchorEvidenceSourceBindingV1 extends ProviderPositionChainAnchorEvidenceSourceIdentityV1 {
  readonly networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId;
  readonly role: ProviderPositionChainAnchorEvidenceSourceRole;
  readonly source: ProviderPositionChainAnchorEvidenceSourcePort;
}

export interface ProviderPositionChainAnchorEvidenceProducerClock {
  now(): Date;
}

/**
 * The caller supplies only the already-observed global chain binding and the
 * admission-owned cancellation boundary. Evaluation and assessment time are
 * sampled by this producer; a caller cannot backdate either one.
 */
export interface ProduceProviderPositionChainAnchorEvidenceRequestV1 {
  readonly producerVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly observedAt: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}

/**
 * Exact positional contract of migration 0029's owner-only record function.
 * It records only the selected observation source. The second approved member
 * is an authenticated chain witness, not a synthetic position observation and
 * therefore must not create a second record plan.
 */
export type ProviderPositionChainAnchorEvidenceRecordArgumentsV1 = readonly [
  networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId,
  sourceFamilyId: string,
  sourceId: string,
  sourceKind: MainnetProviderPositionSourceKind,
  sourceObservationId: string,
  continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1,
  chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1,
  observedAt: string,
  assessedAt: string,
  agreedCurrentHead: MainnetProviderPositionAssessmentChainAnchorV1,
  currentHeadAdvancedAt: string,
  agreedFinalizedHead: MainnetProviderPositionAssessmentChainAnchorV1,
  finalizedHeadAdvancedAt: string,
  identityProofSha256: string,
  liveCapabilityProofSha256: string,
  lineageProofSha256: string,
  primarySourceFamilyId: string,
  primarySourceId: string,
  corroboratingSourceFamilyId: string,
  corroboratingSourceId: string,
  sourcePairApprovalId: string,
  sourcePairRegistryFingerprintSha256: string,
  sourcePairApprovalExpiresAt: string,
];

/**
 * An authenticated, authority-free recorder input. It is opaque until
 * reviewCandidate confirms the exact capability and producer-request objects.
 */
export interface ProviderPositionChainAnchorEvidenceRecordCandidateV1 {
  readonly producerVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly recordArguments: ProviderPositionChainAnchorEvidenceRecordArgumentsV1;
}

export type ProviderPositionChainAnchorEvidenceProducerFailureCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'UNAPPROVED_SOURCE_PAIR'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_ATTESTATION_INVALID'
  | 'SOURCE_DISAGREEMENT'
  | 'STALE_EVIDENCE';

export class DormantProviderPositionChainAnchorEvidenceUnavailableError extends Error {
  constructor(readonly code: ProviderPositionChainAnchorEvidenceProducerFailureCode) {
    super('Provider-position chain-anchor evidence is unavailable.');
    this.name = 'DormantProviderPositionChainAnchorEvidenceUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface CanonicalTime {
  readonly value: string;
  readonly milliseconds: number;
}

interface ReviewedProduceRequest {
  readonly request: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly observedAt: CanonicalTime;
  readonly deadlineAt: CanonicalTime;
  readonly signal: AbortSignal;
}

interface CapturedSourceBinding extends Omit<
  ProviderPositionChainAnchorEvidenceSourceBindingV1,
  'source'
> {
  readonly receiver: ProviderPositionChainAnchorEvidenceSourcePort;
  readonly readAttestation: ProviderPositionChainAnchorEvidenceSourcePort['readAttestation'];
  readonly verifyAttestation: ProviderPositionChainAnchorEvidenceSourcePort['verifyAttestation'];
}

interface ReviewedAttestation {
  readonly binding: CapturedSourceBinding;
  readonly assessedAt: CanonicalTime;
  readonly currentHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly currentHeadAdvancedAt: CanonicalTime;
  readonly finalizedHead: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly finalizedHeadAdvancedAt: CanonicalTime;
  readonly identityProofSha256: string;
  readonly liveCapabilityProofSha256: string;
  readonly lineageProofSha256: string;
}

interface IssuedCandidate {
  readonly request: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly candidate: ProviderPositionChainAnchorEvidenceRecordCandidateV1;
  readonly networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId;
  readonly deadlineAtMilliseconds: number;
  readonly signal: AbortSignal;
  readonly issuedAtMilliseconds: number;
  readonly currentHeadAdvancedAtMilliseconds: number;
  readonly finalizedHeadAdvancedAtMilliseconds: number;
}

function fail(code: ProviderPositionChainAnchorEvidenceProducerFailureCode): never {
  throw new DormantProviderPositionChainAnchorEvidenceUnavailableError(code);
}

function nullRecord<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
  requireFrozen = false,
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
    if (prototype !== Object.prototype && prototype !== null) return fail(code);
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
  } catch (error) {
    void error;
    return fail(code);
  }
}

function dataArray(
  value: unknown,
  maximum: number,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const length = descriptors['length']?.value;
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > maximum) {
      return fail(code);
    }
    const indices = Array.from({ length: length as number }, (_, index) => String(index));
    const expected = [...indices, 'length'];
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      return fail(code);
    }
    return Object.freeze(
      indices.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
        return descriptor.value;
      }),
    );
  } catch (error) {
    void error;
    return fail(code);
  }
}

function timestamp(
  value: unknown,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code);
  }
  return Object.freeze({ value, milliseconds });
}

function clockTime(now: () => Date): CanonicalTime {
  try {
    const value = now();
    if (isProxy(value) || Object.getPrototypeOf(value) !== Date.prototype) {
      return fail('INVALID_CONFIGURATION');
    }
    const milliseconds = Date.prototype.getTime.call(value);
    if (!Number.isSafeInteger(milliseconds)) return fail('INVALID_CONFIGURATION');
    return Object.freeze({
      value: Date.prototype.toISOString.call(value),
      milliseconds,
    });
  } catch (error) {
    void error;
    return fail('INVALID_CONFIGURATION');
  }
}

function network(
  value: unknown,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
): ProviderPositionChainAnchorEvidenceSourceNetworkId {
  if (value !== ETHEREUM && value !== SOLANA) return fail(code);
  return value;
}

function unsignedInteger(
  value: unknown,
  maximum: bigint,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
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
  networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
  requireFrozen: boolean,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  if (networkId === ETHEREUM) {
    const record = exactRecord(value, ['kind', 'blockNumber', 'blockHash'], code, requireFrozen);
    const blockNumber = unsignedInteger(record.blockNumber, MAX_UINT256, code);
    if (
      record.kind !== 'EVM_BLOCK' ||
      typeof record.blockHash !== 'string' ||
      !EVM_BLOCK_HASH.test(record.blockHash) ||
      /^0x0{64}$/u.test(record.blockHash)
    ) {
      return fail(code);
    }
    return nullRecord({ kind: 'EVM_BLOCK' as const, blockNumber, blockHash: record.blockHash });
  }
  const record = exactRecord(value, ['kind', 'slot', 'root'], code, requireFrozen);
  const slot = unsignedInteger(record.slot, MAX_UINT64, code);
  const root = unsignedInteger(record.root, MAX_UINT64, code);
  if (record.kind !== 'SOLANA_SLOT' || BigInt(root) > BigInt(slot)) return fail(code);
  return nullRecord({ kind: 'SOLANA_SLOT' as const, slot, root });
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

function sourceIdentity(
  value: unknown,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
): ProviderPositionChainAnchorEvidenceSourceIdentityV1 {
  const record = exactRecord(value, ['sourceFamilyId', 'sourceId', 'sourceKind'], code);
  if (
    typeof record.sourceFamilyId !== 'string' ||
    !SOURCE_ID.test(record.sourceFamilyId) ||
    typeof record.sourceId !== 'string' ||
    !SOURCE_ID.test(record.sourceId) ||
    (record.sourceKind !== 'RPC' &&
      record.sourceKind !== 'INDEXER' &&
      record.sourceKind !== 'PROVIDER_API')
  ) {
    return fail(code);
  }
  return nullRecord({
    sourceFamilyId: record.sourceFamilyId,
    sourceId: record.sourceId,
    sourceKind: record.sourceKind,
  });
}

function identityKey(value: ProviderPositionChainAnchorEvidenceSourceIdentityV1): string {
  return `${value.sourceFamilyId}\0${value.sourceId}`;
}

function pair(
  value: unknown,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
): ProviderPositionChainAnchorEvidenceSourcePairV1 {
  const record = exactRecord(
    value,
    ['networkId', 'approvalId', 'approvedAt', 'expiresAt', 'primary', 'corroborating'],
    code,
  );
  const networkId = network(record.networkId, code);
  const approvedAt = timestamp(record.approvedAt, code);
  const expiresAt = timestamp(record.expiresAt, code);
  const primary = sourceIdentity(record.primary, code);
  const corroborating = sourceIdentity(record.corroborating, code);
  if (
    typeof record.approvalId !== 'string' ||
    !APPROVAL_ID.test(record.approvalId) ||
    approvedAt.milliseconds >= expiresAt.milliseconds ||
    primary.sourceFamilyId === corroborating.sourceFamilyId ||
    primary.sourceId === corroborating.sourceId ||
    compare(identityKey(primary), identityKey(corroborating)) >= 0
  ) {
    return fail(code);
  }
  return nullRecord({
    networkId,
    approvalId: record.approvalId,
    approvedAt: approvedAt.value,
    expiresAt: expiresAt.value,
    primary,
    corroborating,
  });
}

function registryContent(
  value: unknown,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
): ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1 {
  const record = exactRecord(
    value,
    ['schemaVersion', 'environment', 'approvalStatus', 'pairs'],
    code,
  );
  if (
    record.schemaVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION ||
    record.environment !== 'MAINNET' ||
    (record.approvalStatus !== 'NOT_APPROVED' && record.approvalStatus !== 'APPROVED')
  ) {
    return fail(code);
  }
  const pairs = dataArray(record.pairs, 2, code)
    .map((candidate) => pair(candidate, code))
    .sort((left, right) => compare(left.networkId, right.networkId));
  if (
    new Set(pairs.map(({ networkId }) => networkId)).size !== pairs.length ||
    (record.approvalStatus === 'NOT_APPROVED' && pairs.length !== 0) ||
    (record.approvalStatus === 'APPROVED' &&
      (pairs.length !== 2 ||
        !pairs.some(({ networkId }) => networkId === ETHEREUM) ||
        !pairs.some(({ networkId }) => networkId === SOLANA)))
  ) {
    return fail(code);
  }
  return nullRecord({
    schemaVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    environment: 'MAINNET' as const,
    approvalStatus: record.approvalStatus,
    pairs: Object.freeze(pairs),
  });
}

function canonicalRegistryFingerprint(
  content: ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1,
): string {
  return fingerprint([
    'crypto-lending:provider-position-chain-anchor-evidence-source-pair-registry:v1',
    content.schemaVersion,
    content.environment,
    content.approvalStatus,
    content.pairs.map((candidate) => [
      candidate.networkId,
      candidate.approvalId,
      candidate.approvedAt,
      candidate.expiresAt,
      [candidate.primary.sourceFamilyId, candidate.primary.sourceId, candidate.primary.sourceKind],
      [
        candidate.corroborating.sourceFamilyId,
        candidate.corroborating.sourceId,
        candidate.corroborating.sourceKind,
      ],
    ]),
  ]);
}

export function fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1(
  value: unknown,
): string {
  return canonicalRegistryFingerprint(registryContent(value, 'INVALID_CONFIGURATION'));
}

const UNAPPROVED_REGISTRY_CONTENT = nullRecord({
  schemaVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  environment: 'MAINNET' as const,
  approvalStatus: 'NOT_APPROVED' as const,
  pairs: Object.freeze([]) as readonly ProviderPositionChainAnchorEvidenceSourcePairV1[],
});

/** Checked-in production posture: no source pair is approved or configured. */
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1: ProviderPositionChainAnchorEvidenceSourcePairRegistryV1 =
  nullRecord({
    ...UNAPPROVED_REGISTRY_CONTENT,
    fingerprintSha256: canonicalRegistryFingerprint(UNAPPROVED_REGISTRY_CONTENT),
  });

function registry(value: unknown): ProviderPositionChainAnchorEvidenceSourcePairRegistryV1 {
  const record = exactRecord(
    value,
    ['schemaVersion', 'environment', 'approvalStatus', 'pairs', 'fingerprintSha256'],
    'INVALID_CONFIGURATION',
  );
  const content = registryContent(
    {
      schemaVersion: record.schemaVersion,
      environment: record.environment,
      approvalStatus: record.approvalStatus,
      pairs: record.pairs,
    },
    'INVALID_CONFIGURATION',
  );
  if (
    typeof record.fingerprintSha256 !== 'string' ||
    !SHA256.test(record.fingerprintSha256) ||
    record.fingerprintSha256 === ZERO_SHA256 ||
    record.fingerprintSha256 !== canonicalRegistryFingerprint(content)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return nullRecord({ ...content, fingerprintSha256: record.fingerprintSha256 });
}

function stableDataMember(
  value: object,
  key: PropertyKey,
  code: ProviderPositionChainAnchorEvidenceProducerFailureCode,
): unknown {
  try {
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
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) return fail(code);
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail(code);
  } catch (error) {
    void error;
    return fail(code);
  }
}

function capturedSource(value: unknown): Readonly<{
  receiver: ProviderPositionChainAnchorEvidenceSourcePort;
  readAttestation: ProviderPositionChainAnchorEvidenceSourcePort['readAttestation'];
  verifyAttestation: ProviderPositionChainAnchorEvidenceSourcePort['verifyAttestation'];
}> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const receiver = value as ProviderPositionChainAnchorEvidenceSourcePort;
  const sourceVersion = stableDataMember(receiver, 'sourceVersion', 'INVALID_CONFIGURATION');
  const readAttestation = stableDataMember(receiver, 'readAttestation', 'INVALID_CONFIGURATION');
  const verifyAttestation = stableDataMember(
    receiver,
    'verifyAttestation',
    'INVALID_CONFIGURATION',
  );
  if (
    sourceVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION ||
    typeof readAttestation !== 'function' ||
    isProxy(readAttestation) ||
    typeof verifyAttestation !== 'function' ||
    isProxy(verifyAttestation)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver,
    readAttestation:
      readAttestation as ProviderPositionChainAnchorEvidenceSourcePort['readAttestation'],
    verifyAttestation:
      verifyAttestation as ProviderPositionChainAnchorEvidenceSourcePort['verifyAttestation'],
  });
}

function bindingKey(
  value: Omit<ProviderPositionChainAnchorEvidenceSourceBindingV1, 'source'>,
): string {
  return [value.networkId, value.role, value.sourceFamilyId, value.sourceId, value.sourceKind].join(
    '\0',
  );
}

function pairBinding(
  value: ProviderPositionChainAnchorEvidenceSourcePairV1,
  role: ProviderPositionChainAnchorEvidenceSourceRole,
): Omit<ProviderPositionChainAnchorEvidenceSourceBindingV1, 'source'> {
  const identity = role === 'PRIMARY' ? value.primary : value.corroborating;
  return { networkId: value.networkId, role, ...identity };
}

function bindings(
  value: unknown,
  reviewedRegistry: ProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
): readonly CapturedSourceBinding[] {
  const normalized = dataArray(value, 4, 'INVALID_CONFIGURATION').map((candidate) => {
    const record = exactRecord(
      candidate,
      ['networkId', 'role', 'sourceFamilyId', 'sourceId', 'sourceKind', 'source'],
      'INVALID_CONFIGURATION',
    );
    const identity = sourceIdentity(
      {
        sourceFamilyId: record.sourceFamilyId,
        sourceId: record.sourceId,
        sourceKind: record.sourceKind,
      },
      'INVALID_CONFIGURATION',
    );
    if (record.role !== 'PRIMARY' && record.role !== 'CORROBORATING') {
      return fail('INVALID_CONFIGURATION');
    }
    const captured = capturedSource(record.source);
    return Object.freeze({
      networkId: network(record.networkId, 'INVALID_CONFIGURATION'),
      role: record.role,
      ...identity,
      ...captured,
    });
  });
  const expected = reviewedRegistry.pairs.flatMap((candidate) => [
    pairBinding(candidate, 'PRIMARY'),
    pairBinding(candidate, 'CORROBORATING'),
  ]);
  const actualKeys = normalized.map(bindingKey);
  if (
    normalized.length !== expected.length ||
    new Set(actualKeys).size !== normalized.length ||
    new Set(normalized.map(({ receiver }) => receiver)).size !== normalized.length ||
    expected.some((candidate) => !actualKeys.includes(bindingKey(candidate)))
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return Object.freeze(
    normalized.sort((left, right) => compare(bindingKey(left), bindingKey(right))),
  );
}

function captureClock(value: ProviderPositionChainAnchorEvidenceProducerClock): () => Date {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const method = stableDataMember(value, 'now', 'INVALID_CONFIGURATION');
  if (typeof method !== 'function' || isProxy(method)) return fail('INVALID_CONFIGURATION');
  return () => Reflect.apply(method, value, []) as Date;
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
  } catch (error) {
    void error;
    return fail('INVALID_REQUEST');
  }
}

function aborted(value: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) return fail('INVALID_REQUEST');
    return Reflect.apply(ABORTED_GETTER, value, []) as boolean;
  } catch (error) {
    void error;
    return fail('INVALID_REQUEST');
  }
}

function produceRequest(value: unknown): ReviewedProduceRequest {
  const record = exactRecord(value, PRODUCE_REQUEST_KEYS, 'INVALID_REQUEST', true);
  const networkId = network(record.networkId, 'INVALID_REQUEST');
  const identity = sourceIdentity(
    {
      sourceFamilyId: record.sourceFamilyId,
      sourceId: record.sourceId,
      sourceKind: record.sourceKind,
    },
    'INVALID_REQUEST',
  );
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
  const continuityFloor = anchor(record.continuityFloor, networkId, 'INVALID_REQUEST', true);
  const chainAnchor = anchor(record.chainAnchor, networkId, 'INVALID_REQUEST', true);
  const observedAt = timestamp(record.observedAt, 'INVALID_REQUEST');
  const deadlineAt = timestamp(record.deadlineAt, 'INVALID_REQUEST');
  const requestSignal = signal(record.signal);
  const expectedObservationId =
    chainAnchor.kind === 'EVM_BLOCK'
      ? `ethereum-block-${chainAnchor.blockNumber}`
      : `solana-slot-${chainAnchor.slot}`;
  if (
    record.sourceObservationId !== expectedObservationId ||
    !nonRegressing(continuityFloor, chainAnchor) ||
    observedAt.milliseconds >= deadlineAt.milliseconds ||
    aborted(requestSignal)
  ) {
    return fail('INVALID_REQUEST');
  }
  return nullRecord({
    request: value as ProduceProviderPositionChainAnchorEvidenceRequestV1,
    networkId,
    ...identity,
    sourceObservationId: record.sourceObservationId,
    continuityFloor,
    chainAnchor,
    observedAt,
    deadlineAt,
    signal: requestSignal,
  });
}

function currentPair(
  reviewedRegistry: ProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
  networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId,
  milliseconds: number,
): ProviderPositionChainAnchorEvidenceSourcePairV1 {
  const selected = reviewedRegistry.pairs.find((candidate) => candidate.networkId === networkId);
  if (
    reviewedRegistry.approvalStatus !== 'APPROVED' ||
    selected === undefined ||
    milliseconds < Date.parse(selected.approvedAt) ||
    milliseconds >= Date.parse(selected.expiresAt)
  ) {
    return fail('UNAPPROVED_SOURCE_PAIR');
  }
  return selected;
}

function selectedBelongsToPair(
  request: ReviewedProduceRequest,
  selected: ProviderPositionChainAnchorEvidenceSourcePairV1,
): boolean {
  return [selected.primary, selected.corroborating].some(
    (identity) =>
      identity.sourceFamilyId === request.sourceFamilyId &&
      identity.sourceId === request.sourceId &&
      identity.sourceKind === request.sourceKind,
  );
}

function bindingFor(
  available: readonly CapturedSourceBinding[],
  selected: ProviderPositionChainAnchorEvidenceSourcePairV1,
  role: ProviderPositionChainAnchorEvidenceSourceRole,
): CapturedSourceBinding {
  const key = bindingKey(pairBinding(selected, role));
  const match = available.find((candidate) => bindingKey(candidate) === key);
  if (match === undefined) return fail('INVALID_CONFIGURATION');
  return match;
}

function sourceRequest(
  binding: CapturedSourceBinding,
  request: ReviewedProduceRequest,
  evaluatedAt: string,
): ReadProviderPositionChainAnchorEvidenceSourceRequestV1 {
  return nullRecord({
    sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    networkId: request.networkId,
    sourceFamilyId: binding.sourceFamilyId,
    sourceId: binding.sourceId,
    sourceKind: binding.sourceKind,
    sourceObservationId: request.sourceObservationId,
    continuityFloor: request.continuityFloor,
    chainAnchor: request.chainAnchor,
    observedAt: request.observedAt.value,
    evaluatedAt,
    deadlineAt: request.deadlineAt.value,
    signal: request.signal,
  });
}

function startRead(
  binding: CapturedSourceBinding,
  request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
): Promise<unknown> {
  return Promise.resolve().then(() => {
    const operation = Reflect.apply(binding.readAttestation, binding.receiver, [request]);
    try {
      if (
        typeof operation !== 'object' ||
        operation === null ||
        isProxy(operation) ||
        Object.getPrototypeOf(operation) !== Promise.prototype
      ) {
        return fail('SOURCE_UNAVAILABLE');
      }
    } catch {
      return fail('SOURCE_UNAVAILABLE');
    }
    return operation;
  });
}

function authenticCapability(
  binding: CapturedSourceBinding,
  capability: unknown,
  request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
): boolean {
  try {
    return (
      Reflect.apply(binding.verifyAttestation, binding.receiver, [capability, request]) === true
    );
  } catch (error) {
    void error;
    return false;
  }
}

function proof(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  return value;
}

function attestation(
  capability: unknown,
  binding: CapturedSourceBinding,
  request: ReviewedProduceRequest,
  evaluatedAt: CanonicalTime,
  completed: CanonicalTime,
): ReviewedAttestation {
  const record = exactRecord(
    capability,
    SOURCE_ATTESTATION_KEYS,
    'SOURCE_ATTESTATION_INVALID',
    true,
  );
  if (
    record.sourceVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.networkId !== request.networkId ||
    record.sourceFamilyId !== binding.sourceFamilyId ||
    record.sourceId !== binding.sourceId ||
    record.sourceKind !== binding.sourceKind ||
    record.sourceObservationId !== request.sourceObservationId ||
    record.observedAt !== request.observedAt.value
  ) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  const continuityFloor = anchor(
    record.continuityFloor,
    request.networkId,
    'SOURCE_ATTESTATION_INVALID',
    true,
  );
  const chainAnchor = anchor(
    record.chainAnchor,
    request.networkId,
    'SOURCE_ATTESTATION_INVALID',
    true,
  );
  const currentHead = anchor(
    record.currentHead,
    request.networkId,
    'SOURCE_ATTESTATION_INVALID',
    true,
  );
  const finalizedHead = anchor(
    record.finalizedHead,
    request.networkId,
    'SOURCE_ATTESTATION_INVALID',
    true,
  );
  const assessedAt = timestamp(record.assessedAt, 'SOURCE_ATTESTATION_INVALID');
  const currentHeadAdvancedAt = timestamp(
    record.currentHeadAdvancedAt,
    'SOURCE_ATTESTATION_INVALID',
  );
  const finalizedHeadAdvancedAt = timestamp(
    record.finalizedHeadAdvancedAt,
    'SOURCE_ATTESTATION_INVALID',
  );
  if (
    !sameAnchor(continuityFloor, request.continuityFloor) ||
    !sameAnchor(chainAnchor, request.chainAnchor) ||
    !nonRegressing(chainAnchor, currentHead) ||
    !finalizedNotAhead(finalizedHead, currentHead) ||
    request.observedAt.milliseconds > assessedAt.milliseconds ||
    evaluatedAt.milliseconds > assessedAt.milliseconds ||
    assessedAt.milliseconds > completed.milliseconds ||
    currentHeadAdvancedAt.milliseconds > assessedAt.milliseconds ||
    finalizedHeadAdvancedAt.milliseconds > assessedAt.milliseconds
  ) {
    return fail('SOURCE_ATTESTATION_INVALID');
  }
  return nullRecord({
    binding,
    assessedAt,
    currentHead,
    currentHeadAdvancedAt,
    finalizedHead,
    finalizedHeadAdvancedAt,
    identityProofSha256: proof(record.identityProofSha256),
    liveCapabilityProofSha256: proof(record.liveCapabilityProofSha256),
    lineageProofSha256: proof(record.lineageProofSha256),
  });
}

function ensureCurrent(
  value: ReviewedAttestation,
  networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId,
  completedMilliseconds: number,
): void {
  return ensureHeadTimesCurrent(
    networkId,
    value.currentHeadAdvancedAt.milliseconds,
    value.finalizedHeadAdvancedAt.milliseconds,
    completedMilliseconds,
  );
}

function ensureHeadTimesCurrent(
  networkId: ProviderPositionChainAnchorEvidenceSourceNetworkId,
  currentHeadAdvancedAtMilliseconds: number,
  finalizedHeadAdvancedAtMilliseconds: number,
  completedMilliseconds: number,
): void {
  const currentLifetime = networkId === ETHEREUM ? 60_000 : 15_000;
  const finalizedLifetime = networkId === ETHEREUM ? 1_800_000 : 90_000;
  if (
    completedMilliseconds < currentHeadAdvancedAtMilliseconds ||
    completedMilliseconds >= currentHeadAdvancedAtMilliseconds + currentLifetime ||
    completedMilliseconds < finalizedHeadAdvancedAtMilliseconds ||
    completedMilliseconds >= finalizedHeadAdvancedAtMilliseconds + finalizedLifetime
  ) {
    return fail('STALE_EVIDENCE');
  }
}

function aggregateProof(
  domain: 'identity' | 'live-capability' | 'lineage',
  reviewedRegistry: ProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
  selected: ProviderPositionChainAnchorEvidenceSourcePairV1,
  request: ReviewedProduceRequest,
  evaluatedAt: string,
  assessedAt: string,
  agreedCurrentHead: MainnetProviderPositionAssessmentChainAnchorV1,
  currentHeadAdvancedAt: string,
  agreedFinalizedHead: MainnetProviderPositionAssessmentChainAnchorV1,
  finalizedHeadAdvancedAt: string,
  primary: ReviewedAttestation,
  corroborating: ReviewedAttestation,
): string {
  const result = fingerprint([
    `crypto-lending:provider-position-chain-anchor-evidence-${domain}-proof:v1`,
    reviewedRegistry.fingerprintSha256,
    selected.approvalId,
    selected.approvedAt,
    selected.expiresAt,
    selected.networkId,
    request.sourceFamilyId,
    request.sourceId,
    request.sourceKind,
    request.sourceObservationId,
    request.continuityFloor,
    request.chainAnchor,
    request.observedAt.value,
    evaluatedAt,
    request.deadlineAt.value,
    assessedAt,
    agreedCurrentHead,
    currentHeadAdvancedAt,
    agreedFinalizedHead,
    finalizedHeadAdvancedAt,
    [
      primary.binding.sourceFamilyId,
      primary.binding.sourceId,
      primary.binding.sourceKind,
      primary.assessedAt.value,
      primary.currentHead,
      primary.currentHeadAdvancedAt.value,
      primary.finalizedHead,
      primary.finalizedHeadAdvancedAt.value,
      primary.identityProofSha256,
      primary.liveCapabilityProofSha256,
      primary.lineageProofSha256,
    ],
    [
      corroborating.binding.sourceFamilyId,
      corroborating.binding.sourceId,
      corroborating.binding.sourceKind,
      corroborating.assessedAt.value,
      corroborating.currentHead,
      corroborating.currentHeadAdvancedAt.value,
      corroborating.finalizedHead,
      corroborating.finalizedHeadAdvancedAt.value,
      corroborating.identityProofSha256,
      corroborating.liveCapabilityProofSha256,
      corroborating.lineageProofSha256,
    ],
  ]);
  if (result === ZERO_SHA256) return fail('SOURCE_ATTESTATION_INVALID');
  return result;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

/**
 * Dormant two-source producer. Construction performs no read and the class has
 * no decorator, transport, provider SDK, persistence adapter, or registration.
 */
export class DormantProviderPositionChainAnchorEvidenceProducer {
  readonly #registry: ProviderPositionChainAnchorEvidenceSourcePairRegistryV1;
  readonly #bindings: readonly CapturedSourceBinding[];
  readonly #now: () => Date;
  readonly #issued = new WeakMap<object, IssuedCandidate>();

  constructor(
    registryInput: unknown,
    bindingsInput: readonly ProviderPositionChainAnchorEvidenceSourceBindingV1[],
    clock: ProviderPositionChainAnchorEvidenceProducerClock,
  ) {
    this.#registry = registry(registryInput);
    this.#bindings = bindings(bindingsInput, this.#registry);
    this.#now = captureClock(clock);
  }

  async produceCandidate(
    requestInput: ProduceProviderPositionChainAnchorEvidenceRequestV1,
  ): Promise<unknown> {
    const request = produceRequest(requestInput);
    const evaluatedAt = clockTime(this.#now);
    if (
      request.observedAt.milliseconds > evaluatedAt.milliseconds ||
      evaluatedAt.milliseconds >= request.deadlineAt.milliseconds ||
      request.deadlineAt.milliseconds - evaluatedAt.milliseconds > MAX_DEADLINE_MILLISECONDS ||
      aborted(request.signal)
    ) {
      return fail('INVALID_REQUEST');
    }
    const selectedPair = currentPair(this.#registry, request.networkId, evaluatedAt.milliseconds);
    if (!selectedBelongsToPair(request, selectedPair)) return fail('UNAPPROVED_SOURCE_PAIR');
    const primaryBinding = bindingFor(this.#bindings, selectedPair, 'PRIMARY');
    const corroboratingBinding = bindingFor(this.#bindings, selectedPair, 'CORROBORATING');
    if (primaryBinding.receiver === corroboratingBinding.receiver) {
      return fail('INVALID_CONFIGURATION');
    }
    const primaryRequest = sourceRequest(primaryBinding, request, evaluatedAt.value);
    const corroboratingRequest = sourceRequest(corroboratingBinding, request, evaluatedAt.value);
    const [primaryResult, corroboratingResult] = await Promise.allSettled([
      startRead(primaryBinding, primaryRequest),
      startRead(corroboratingBinding, corroboratingRequest),
    ]);
    const settledAt = clockTime(this.#now);
    if (
      settledAt.milliseconds < evaluatedAt.milliseconds ||
      settledAt.milliseconds >= request.deadlineAt.milliseconds ||
      aborted(request.signal)
    ) {
      return fail('STALE_EVIDENCE');
    }
    currentPair(this.#registry, request.networkId, settledAt.milliseconds);
    if (primaryResult.status !== 'fulfilled' || corroboratingResult.status !== 'fulfilled') {
      return fail('SOURCE_UNAVAILABLE');
    }
    const primaryAuthentic = authenticCapability(
      primaryBinding,
      primaryResult.value,
      primaryRequest,
    );
    const corroboratingAuthentic = authenticCapability(
      corroboratingBinding,
      corroboratingResult.value,
      corroboratingRequest,
    );
    if (!primaryAuthentic || !corroboratingAuthentic) {
      return fail('SOURCE_ATTESTATION_INVALID');
    }
    const verifiedAt = clockTime(this.#now);
    if (
      verifiedAt.milliseconds < settledAt.milliseconds ||
      verifiedAt.milliseconds >= request.deadlineAt.milliseconds ||
      aborted(request.signal)
    ) {
      return fail('STALE_EVIDENCE');
    }
    currentPair(this.#registry, request.networkId, verifiedAt.milliseconds);
    if (
      typeof primaryResult.value !== 'object' ||
      primaryResult.value === null ||
      typeof corroboratingResult.value !== 'object' ||
      corroboratingResult.value === null ||
      primaryResult.value === corroboratingResult.value
    ) {
      return fail('SOURCE_ATTESTATION_INVALID');
    }
    const primary = attestation(
      primaryResult.value,
      primaryBinding,
      request,
      evaluatedAt,
      verifiedAt,
    );
    const corroborating = attestation(
      corroboratingResult.value,
      corroboratingBinding,
      request,
      evaluatedAt,
      verifiedAt,
    );
    if (
      !sameAnchor(primary.currentHead, corroborating.currentHead) ||
      !sameAnchor(primary.finalizedHead, corroborating.finalizedHead)
    ) {
      return fail('SOURCE_DISAGREEMENT');
    }
    const assessedAt = clockTime(this.#now);
    if (
      assessedAt.milliseconds < verifiedAt.milliseconds ||
      assessedAt.milliseconds >= request.deadlineAt.milliseconds ||
      aborted(request.signal)
    ) {
      return fail('STALE_EVIDENCE');
    }
    currentPair(this.#registry, request.networkId, assessedAt.milliseconds);
    ensureCurrent(primary, request.networkId, assessedAt.milliseconds);
    ensureCurrent(corroborating, request.networkId, assessedAt.milliseconds);
    const currentHeadAdvancedAt =
      primary.currentHeadAdvancedAt.milliseconds <= corroborating.currentHeadAdvancedAt.milliseconds
        ? primary.currentHeadAdvancedAt.value
        : corroborating.currentHeadAdvancedAt.value;
    const finalizedHeadAdvancedAt =
      primary.finalizedHeadAdvancedAt.milliseconds <=
      corroborating.finalizedHeadAdvancedAt.milliseconds
        ? primary.finalizedHeadAdvancedAt.value
        : corroborating.finalizedHeadAdvancedAt.value;
    const identityProofSha256 = aggregateProof(
      'identity',
      this.#registry,
      selectedPair,
      request,
      evaluatedAt.value,
      assessedAt.value,
      primary.currentHead,
      currentHeadAdvancedAt,
      primary.finalizedHead,
      finalizedHeadAdvancedAt,
      primary,
      corroborating,
    );
    const liveCapabilityProofSha256 = aggregateProof(
      'live-capability',
      this.#registry,
      selectedPair,
      request,
      evaluatedAt.value,
      assessedAt.value,
      primary.currentHead,
      currentHeadAdvancedAt,
      primary.finalizedHead,
      finalizedHeadAdvancedAt,
      primary,
      corroborating,
    );
    const lineageProofSha256 = aggregateProof(
      'lineage',
      this.#registry,
      selectedPair,
      request,
      evaluatedAt.value,
      assessedAt.value,
      primary.currentHead,
      currentHeadAdvancedAt,
      primary.finalizedHead,
      finalizedHeadAdvancedAt,
      primary,
      corroborating,
    );
    if (new Set([identityProofSha256, liveCapabilityProofSha256, lineageProofSha256]).size !== 3) {
      return fail('SOURCE_ATTESTATION_INVALID');
    }
    const recordArguments = Object.freeze([
      request.networkId,
      request.sourceFamilyId,
      request.sourceId,
      request.sourceKind,
      request.sourceObservationId,
      request.continuityFloor,
      request.chainAnchor,
      request.observedAt.value,
      assessedAt.value,
      primary.currentHead,
      currentHeadAdvancedAt,
      primary.finalizedHead,
      finalizedHeadAdvancedAt,
      identityProofSha256,
      liveCapabilityProofSha256,
      lineageProofSha256,
      selectedPair.primary.sourceFamilyId,
      selectedPair.primary.sourceId,
      selectedPair.corroborating.sourceFamilyId,
      selectedPair.corroborating.sourceId,
      selectedPair.approvalId,
      this.#registry.fingerprintSha256,
      selectedPair.expiresAt,
    ]) as ProviderPositionChainAnchorEvidenceRecordArgumentsV1;
    const candidate = nullRecord({
      producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE,
      mayAuthorizeFinancialAction: false as const,
      mayPersist: false as const,
      recordArguments,
    });
    const issuedAt = clockTime(this.#now);
    if (
      issuedAt.milliseconds < assessedAt.milliseconds ||
      issuedAt.milliseconds >= request.deadlineAt.milliseconds ||
      aborted(request.signal)
    ) {
      return fail('STALE_EVIDENCE');
    }
    currentPair(this.#registry, request.networkId, issuedAt.milliseconds);
    ensureCurrent(primary, request.networkId, issuedAt.milliseconds);
    ensureCurrent(corroborating, request.networkId, issuedAt.milliseconds);
    this.#issued.set(
      candidate,
      nullRecord({
        request: request.request,
        candidate,
        networkId: request.networkId,
        deadlineAtMilliseconds: request.deadlineAt.milliseconds,
        signal: request.signal,
        issuedAtMilliseconds: issuedAt.milliseconds,
        currentHeadAdvancedAtMilliseconds: Math.min(
          primary.currentHeadAdvancedAt.milliseconds,
          corroborating.currentHeadAdvancedAt.milliseconds,
        ),
        finalizedHeadAdvancedAtMilliseconds: Math.min(
          primary.finalizedHeadAdvancedAt.milliseconds,
          corroborating.finalizedHeadAdvancedAt.milliseconds,
        ),
      }),
    );
    return candidate;
  }

  reviewCandidate(
    capability: unknown,
    request: ProduceProviderPositionChainAnchorEvidenceRequestV1,
  ): ProviderPositionChainAnchorEvidenceRecordCandidateV1 {
    if (typeof capability !== 'object' || capability === null) return fail('INVALID_REQUEST');
    const issued = this.#issued.get(capability);
    if (issued === undefined || issued.request !== request || issued.candidate !== capability) {
      return fail('INVALID_REQUEST');
    }
    const reviewedAt = clockTime(this.#now);
    if (
      reviewedAt.milliseconds < issued.issuedAtMilliseconds ||
      reviewedAt.milliseconds >= issued.deadlineAtMilliseconds ||
      aborted(issued.signal)
    ) {
      return fail('STALE_EVIDENCE');
    }
    currentPair(this.#registry, issued.networkId, reviewedAt.milliseconds);
    ensureHeadTimesCurrent(
      issued.networkId,
      issued.currentHeadAdvancedAtMilliseconds,
      issued.finalizedHeadAdvancedAtMilliseconds,
      reviewedAt.milliseconds,
    );
    return issued.candidate;
  }
}
