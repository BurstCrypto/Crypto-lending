import { isProxy } from 'node:util/types';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_ADMISSION_CANDIDATE_USE,
  DormantMainnetFinancialActionFinalityEvidenceProducer,
  type ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
  type ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
} from '../application/dormant-mainnet-financial-action-finality-evidence.producer';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
  MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING,
  type DormantMainnetFinancialActionAdmissionDatabaseConfirmedResultV1,
  type DormantMainnetFinancialActionEffectiveSafetyCursorV1,
  type DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1,
  type DormantMainnetFinancialActionEffectiveSafetyReaderPort,
  type DormantMainnetFinancialActionFinalityDatabaseOutcomeUnknownV1,
  type DormantMainnetFinancialActionFinalityPersistencePort,
  type DormantMainnetFinancialActionFinalityPersistenceRequestV1,
  type DormantMainnetFinancialActionFinalitySidecarOperation,
  type DormantMainnetFinancialActionFinalitySidecarRequestV1,
  type DormantMainnetFinancialActionFinalitySidecarResultV1,
  type MainnetFinancialActionEffectiveSafetyState,
  type MainnetFinancialActionPostFinalityDisposition,
  type ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
  type RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
  type RecordMainnetFinancialActionPostFinalityReviewRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port';
import type { DormantMainnetFinancialActionDatabaseStage } from '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EVM_HASH = /^0x[0-9a-f]{64}$/u;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,19})$/u;
const TIMESTAMP =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_INT64 = (1n << 63n) - 1n;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

const ADMISSION_REQUEST_KEYS = Object.freeze([
  'evidenceCapability',
  'evidenceRequest',
  'signal',
] as const);
const POST_FINALITY_REQUEST_KEYS = Object.freeze([
  'evidenceCapability',
  'evidenceRequest',
  'effectiveSafetyCursor',
  'effectiveSafetyReadRequest',
  'signal',
] as const);
const READ_REQUEST_KEYS = Object.freeze(['accountId', 'intentId', 'signal'] as const);
const CANDIDATE_KEYS = Object.freeze([
  'producerVersion',
  'use',
  'purpose',
  'mayAuthorizeFinancialAction',
  'mayPersist',
] as const);
const CURSOR_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'fingerprintEncoding',
  'accountId',
  'intentId',
  'networkId',
  'terminalRevision',
  'terminalSnapshotSha256',
  'terminalTransitionFingerprintSha256',
  'originalAdmissionFingerprintSha256',
  'chainTransactionId',
  'transactionPosition',
  'transactionBlockId',
  'reviewRevision',
  'reviewFingerprintSha256',
] as const);
const EFFECTIVE_SAFETY_BINDING_KEYS = Object.freeze([
  'terminalTransitionFingerprintSha256',
  'originalAdmissionFingerprintSha256',
  'expectedReviewRevision',
  'expectedPreviousReviewFingerprintSha256',
  'effectiveSafetyState',
] as const);
const ADMISSION_ROW_KEYS = Object.freeze([
  'admission_outcome',
  'admission_fingerprint_sha256',
  'admitted_event_revision',
  'admitted_transition_fingerprint_sha256',
  'lifecycle_stage',
  'lifecycle_revision',
  'current_snapshot_sha256',
  'source_evidence_sha256',
  'effect_evidence_sha256',
  'failure_evidence_sha256',
  'terminal',
  'requires_manual_reconciliation',
  'ledger_settlement_authority',
  'recorded_at',
] as const);
const REVIEW_ROW_KEYS = Object.freeze([
  'record_outcome',
  'review_fingerprint_sha256',
  'review_revision',
  'current_review_revision',
  'current_review_fingerprint_sha256',
  'current_review_disposition',
  'effective_safety_state',
  'requires_manual_review',
  'ledger_settlement_authority',
  'recorded_at',
] as const);
const READ_ROW_KEYS = Object.freeze([
  'lifecycle_stage',
  'network_id',
  'lifecycle_revision',
  'current_snapshot_sha256',
  'current_transition_fingerprint_sha256',
  'admission_fingerprint_sha256',
  'chain_transaction_id',
  'transaction_position',
  'transaction_block_id',
  'authenticated_reconciliation',
  'review_revision',
  'review_fingerprint_sha256',
  'latest_review_disposition',
  'effective_safety_state',
  'requires_manual_review',
  'may_authorize_financial_action',
  'may_resend_transaction',
  'ledger_settlement_authority',
] as const);

const STAGES: readonly DormantMainnetFinancialActionDatabaseStage[] = Object.freeze([
  'PREPARED',
  'WALLET_SIGNED_SUBMISSION_BOUND',
  'BROADCAST_OUTCOME_AMBIGUOUS',
  'RECONCILIATION_AMBIGUOUS',
  'FINALIZED_SUCCESS',
  'FINALIZED_FAILURE',
  'REORG_QUARANTINED',
]);
const OUTCOMES = Object.freeze([
  'PENDING',
  'UNKNOWN',
  'FINALIZED_SUCCESS',
  'FINALIZED_FAILURE',
  'REORGED_OUT',
] as const);
const DISPOSITIONS: readonly MainnetFinancialActionPostFinalityDisposition[] = Object.freeze([
  'FINALITY_REAFFIRMED',
  'REVIEW_INCONCLUSIVE',
  'DEEP_REORG_QUARANTINED',
]);
const SAFETY_STATES: readonly MainnetFinancialActionEffectiveSafetyState[] = Object.freeze([
  'RECONCILIATION_PENDING',
  'AUTHENTICATED_FINALITY_RECORDED',
  'UNAUTHENTICATED_TERMINAL_QUARANTINED',
  'REORG_QUARANTINED',
  'POST_FINALITY_REVIEW_INCONCLUSIVE',
  'AUTHORITY_CONTROLLED_QUARANTINED',
  'DEEP_REORG_QUARANTINED',
]);

const ADMISSION_SQL = `SELECT
  result.admission_outcome,
  result.admission_fingerprint_sha256,
  result.admitted_event_revision::text AS admitted_event_revision,
  result.admitted_transition_fingerprint_sha256,
  result.lifecycle_stage,
  result.lifecycle_revision::text AS lifecycle_revision,
  result.current_snapshot_sha256,
  result.source_evidence_sha256,
  result.effect_evidence_sha256,
  result.failure_evidence_sha256,
  result.terminal,
  result.requires_manual_reconciliation,
  result.ledger_settlement_authority,
  pg_catalog.to_char(
    result.recorded_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS recorded_at
FROM record_authenticated_mainnet_financial_action_reconciliation_v3(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::text,
  $7::text, $8::numeric, $9::text, $10::numeric, $11::text, $12::text,
  $13::uuid, $14::text, $15::uuid, $16::text, $17::text, $18::text,
  $19::text, $20::text, $21::text, $22::timestamptz, $23::timestamptz,
  $24::uuid
) AS result`;

const POST_FINALITY_SQL = `SELECT
  result.record_outcome,
  result.review_fingerprint_sha256,
  result.review_revision::text AS review_revision,
  result.current_review_revision::text AS current_review_revision,
  result.current_review_fingerprint_sha256,
  result.current_review_disposition,
  result.effective_safety_state,
  result.requires_manual_review,
  result.ledger_settlement_authority,
  pg_catalog.to_char(
    result.recorded_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS recorded_at
FROM record_mainnet_financial_action_post_finality_review_v3(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::bigint, $6::text,
  $7::uuid, $8::text, $9::text, $10::text, $11::numeric, $12::text,
  $13::numeric, $14::text, $15::text, $16::uuid, $17::text, $18::uuid,
  $19::text, $20::text, $21::text, $22::text, $23::timestamptz,
  $24::timestamptz, $25::uuid
) AS result`;

const READ_EFFECTIVE_SAFETY_SQL = `SELECT
  result.lifecycle_stage,
  result.network_id,
  result.lifecycle_revision::text AS lifecycle_revision,
  result.current_snapshot_sha256,
  result.current_transition_fingerprint_sha256,
  result.admission_fingerprint_sha256,
  result.chain_transaction_id,
  result.transaction_position::text AS transaction_position,
  result.transaction_block_id,
  result.authenticated_reconciliation,
  COALESCE(result.review_revision, 0)::text AS review_revision,
  result.review_fingerprint_sha256,
  result.latest_review_disposition,
  result.effective_safety_state,
  result.requires_manual_review,
  result.may_authorize_financial_action,
  result.may_resend_transaction,
  result.ledger_settlement_authority
FROM read_mainnet_financial_action_effective_safety_state_v1(
  $1::uuid, $2::uuid
) AS result`;

type QueryWithCancellation = PostgresService['queryWithCancellation'];
type ReviewReconciliationCandidate =
  DormantMainnetFinancialActionFinalityEvidenceProducer['reviewReconciliationAdmissionCandidate'];
type ReviewPostFinalityCandidate =
  DormantMainnetFinancialActionFinalityEvidenceProducer['reviewPostFinalityReviewCandidate'];
const CANONICAL_RECONCILIATION_REVIEW = Object.getOwnPropertyDescriptor(
  DormantMainnetFinancialActionFinalityEvidenceProducer.prototype,
  'reviewReconciliationAdmissionCandidate',
)?.value as ReviewReconciliationCandidate | undefined;
const CANONICAL_POST_FINALITY_REVIEW = Object.getOwnPropertyDescriptor(
  DormantMainnetFinancialActionFinalityEvidenceProducer.prototype,
  'reviewPostFinalityReviewCandidate',
)?.value as ReviewPostFinalityCandidate | undefined;
type NetworkKind = 'ETHEREUM' | 'SOLANA';
type ReconciliationOutcome = (typeof OUTCOMES)[number];
type DatabaseMethod =
  'recordAuthenticatedAdmission' | 'recordPostFinalityReview' | 'readEffectiveSafetyState';

interface CapturedMethod<Method extends (...arguments_: never[]) => unknown> {
  readonly receiver: object;
  readonly method: Method;
}

interface CanonicalTime {
  readonly value: string;
  readonly milliseconds: number;
}

interface ReviewedAdmissionArguments {
  readonly values: readonly unknown[];
  readonly accountId: string;
  readonly intentId: string;
  readonly expectedRevision: string;
  readonly expectedSnapshotSha256: string;
  readonly outcome: ReconciliationOutcome;
  readonly observedAt: CanonicalTime;
  readonly deadlineAt: CanonicalTime;
}

interface ReviewedPostFinalityArguments {
  readonly values: readonly unknown[];
  readonly accountId: string;
  readonly intentId: string;
  readonly terminalRevision: string;
  readonly terminalSnapshotSha256: string;
  readonly network: NetworkKind;
  readonly transactionId: string;
  readonly transactionPosition: string;
  readonly transactionBlockId: string;
  readonly expectedReviewRevision: string;
  readonly expectedPreviousReviewFingerprintSha256: string | null;
  readonly terminalTransitionFingerprintSha256: string;
  readonly originalAdmissionFingerprintSha256: string;
  readonly effectiveSafetyState:
    | 'AUTHENTICATED_FINALITY_RECORDED'
    | 'POST_FINALITY_REVIEW_INCONCLUSIVE'
    | 'DEEP_REORG_QUARANTINED';
  readonly disposition: MainnetFinancialActionPostFinalityDisposition;
  readonly observedAt: CanonicalTime;
  readonly deadlineAt: CanonicalTime;
}

interface ReviewedAdmissionRequest {
  readonly request: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1;
  readonly evidenceCapability: object;
  readonly evidenceRequest: ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
  readonly signal: AbortSignal;
}

interface ReviewedReadRequest {
  readonly request: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
  readonly accountId: string;
  readonly intentId: string;
  readonly signal: AbortSignal;
}

interface ReviewedPostFinalityRequest {
  readonly request: RecordMainnetFinancialActionPostFinalityReviewRequestV1;
  readonly evidenceCapability: object;
  readonly evidenceRequest: ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
  readonly effectiveSafetyCursor: DormantMainnetFinancialActionEffectiveSafetyCursorV1;
  readonly effectiveSafetyReadRequest: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
  readonly signal: AbortSignal;
}

interface IssuedResult {
  readonly method: DatabaseMethod;
  readonly request: DormantMainnetFinancialActionFinalitySidecarRequestV1;
  readonly result: DormantMainnetFinancialActionFinalitySidecarResultV1;
}

interface IssuedCursor {
  readonly cursor: DormantMainnetFinancialActionEffectiveSafetyCursorV1;
  readonly readRequest: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
  readonly readAccountId: string;
  readonly readIntentId: string;
  readonly readSignal: AbortSignal;
  readonly readResult: DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1;
  readonly lifecycleStage: 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE';
  readonly effectiveSafetyState:
    'AUTHENTICATED_FINALITY_RECORDED' | 'POST_FINALITY_REVIEW_INCONCLUSIVE';
}

export class DormantMainnetFinancialActionFinalitySidecarUnavailableError extends Error {
  readonly code = 'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE' as const;

  constructor() {
    super('Dormant mainnet financial action finality sidecar is unavailable.');
    this.name = 'DormantMainnetFinancialActionFinalitySidecarUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

export const DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE = Object.freeze(
  new DormantMainnetFinancialActionFinalitySidecarUnavailableError(),
);

function fail(): never {
  throw DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE;
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

function stableDataMember(value: unknown, key: PropertyKey): unknown {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return fail();
    }
    let current: object | null = value;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (isProxy(current)) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) return fail();
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail();
  } catch {
    return fail();
  }
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value) || /^0{64}$/u.test(value)) return fail();
  return value;
}

function nullableDigest(value: unknown): string | null {
  return value === null ? null : digest(value);
}

function canonicalTime(value: unknown): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail();
  }
  return Object.freeze({ value, milliseconds });
}

function integer(value: unknown, minimum: bigint, maximum: bigint): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return fail();
  try {
    const parsed = BigInt(value);
    if (parsed < minimum || parsed > maximum) return fail();
  } catch {
    return fail();
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') return fail();
  return value;
}

function member<const Value extends string>(value: unknown, members: readonly Value[]): Value {
  if (typeof value !== 'string' || !members.includes(value as Value)) return fail();
  return value as Value;
}

function nullableMember<const Value extends string>(
  value: unknown,
  members: readonly Value[],
): Value | null {
  return value === null ? null : member(value, members);
}

function abortSignal(value: unknown): AbortSignal {
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

function isAborted(signal: AbortSignal): boolean {
  try {
    return ABORTED_GETTER === undefined || Reflect.apply(ABORTED_GETTER, signal, []) !== false;
  } catch {
    return true;
  }
}

function canonicalBase58(value: string, expectedBytes: number): boolean {
  if (!BASE58.test(value) || value.length > 90) return false;
  const bytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) return false;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += (bytes[index] ?? 0) * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  while (value[leadingZeros] === '1') leadingZeros += 1;
  const significant = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  return leadingZeros + significant === expectedBytes && bytes.some((byte) => byte !== 0);
}

function transactionIdentity(value: unknown): Readonly<{ value: string; network: NetworkKind }> {
  if (typeof value !== 'string') return fail();
  if (EVM_HASH.test(value) && !/^0x0{64}$/u.test(value)) {
    return Object.freeze({ value, network: 'ETHEREUM' });
  }
  if (canonicalBase58(value, 64)) return Object.freeze({ value, network: 'SOLANA' });
  return fail();
}

function blockIdentity(value: unknown, network: NetworkKind): string {
  if (typeof value !== 'string') return fail();
  if (network === 'ETHEREUM') {
    if (!EVM_HASH.test(value) || /^0x0{64}$/u.test(value)) return fail();
    return value;
  }
  if (!canonicalBase58(value, 32)) return fail();
  return value;
}

function nullableBlockIdentity(value: unknown, network: NetworkKind): string | null {
  return value === null ? null : blockIdentity(value, network);
}

function reconciliationOutcome(value: unknown): ReconciliationOutcome {
  return member(value, OUTCOMES);
}

function disposition(value: unknown): MainnetFinancialActionPostFinalityDisposition {
  return member(value, DISPOSITIONS);
}

function safetyState(value: unknown): MainnetFinancialActionEffectiveSafetyState {
  return member(value, SAFETY_STATES);
}

function lifecycleStage(value: unknown): DormantMainnetFinancialActionDatabaseStage {
  return member(value, STAGES);
}

function validateAdmissionShape(
  outcome: ReconciliationOutcome,
  transactionPosition: string | null,
  finalizedPosition: string,
  effectEvidenceSha256: string | null,
  failureEvidenceSha256: string | null,
): void {
  const finalized = BigInt(finalizedPosition);
  const transaction = transactionPosition === null ? null : BigInt(transactionPosition);
  const valid =
    (outcome === 'UNKNOWN' &&
      transaction === null &&
      effectEvidenceSha256 === null &&
      failureEvidenceSha256 === null) ||
    (outcome === 'PENDING' &&
      effectEvidenceSha256 === null &&
      failureEvidenceSha256 === null &&
      (transaction === null || finalized < transaction)) ||
    (outcome === 'FINALIZED_SUCCESS' &&
      transaction !== null &&
      finalized >= transaction &&
      effectEvidenceSha256 !== null &&
      failureEvidenceSha256 === null) ||
    (outcome === 'FINALIZED_FAILURE' &&
      transaction !== null &&
      finalized >= transaction &&
      effectEvidenceSha256 === null &&
      failureEvidenceSha256 !== null) ||
    (outcome === 'REORGED_OUT' &&
      transaction !== null &&
      finalized >= transaction &&
      effectEvidenceSha256 === null &&
      failureEvidenceSha256 === null);
  if (!valid) return fail();
}

function reviewedAdmissionArguments(candidate: unknown): ReviewedAdmissionArguments {
  const common = exactDataRecord(candidate, [...CANDIDATE_KEYS, 'admissionArguments'], true, true);
  if (
    common.producerVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION ||
    common.use !== MAINNET_FINANCIAL_ACTION_RECONCILIATION_ADMISSION_CANDIDATE_USE ||
    common.purpose !== 'RECONCILIATION_ADMISSION' ||
    common.mayAuthorizeFinancialAction !== false ||
    common.mayPersist !== false
  ) {
    return fail();
  }
  const input = exactDataArray(common.admissionArguments, 24);
  const accountId = uuid(input[0]);
  const intentId = uuid(input[1]);
  const expectedRevision = integer(input[2], 2n, MAX_INT64);
  const expectedSnapshotSha256 = digest(input[3]);
  const observationId = uuid(input[4]);
  const transaction = transactionIdentity(input[5]);
  const outcome = reconciliationOutcome(input[6]);
  const transactionPosition = input[7] === null ? null : integer(input[7], 0n, MAX_UINT64);
  const transactionBlockId = nullableBlockIdentity(input[8], transaction.network);
  if ((transactionPosition === null) !== (transactionBlockId === null)) return fail();
  const finalizedPosition = integer(input[9], 0n, MAX_UINT64);
  const finalizedBlockId = blockIdentity(input[10], transaction.network);
  const chainAnchorEvidenceFingerprintSha256 = digest(input[11]);
  const sourceAuthorityId = uuid(input[12]);
  const sourceAuthorityFingerprintSha256 = digest(input[13]);
  const deploymentAuthorityId = uuid(input[14]);
  const deploymentAuthorityFingerprintSha256 = digest(input[15]);
  const primaryAttestationSha256 = digest(input[16]);
  const corroboratingAttestationSha256 = digest(input[17]);
  const transactionEvidenceSha256 = digest(input[18]);
  if (
    primaryAttestationSha256 === corroboratingAttestationSha256 ||
    primaryAttestationSha256 === transactionEvidenceSha256 ||
    corroboratingAttestationSha256 === transactionEvidenceSha256
  ) {
    return fail();
  }
  const effectEvidenceSha256 = nullableDigest(input[19]);
  const failureEvidenceSha256 = nullableDigest(input[20]);
  const observedAt = canonicalTime(input[21]);
  const deadlineAt = canonicalTime(input[22]);
  const correlationId = uuid(input[23]);
  if (observedAt.milliseconds >= deadlineAt.milliseconds) return fail();
  validateAdmissionShape(
    outcome,
    transactionPosition,
    finalizedPosition,
    effectEvidenceSha256,
    failureEvidenceSha256,
  );
  return frozenNullPrototype({
    values: Object.freeze([
      accountId,
      intentId,
      expectedRevision,
      expectedSnapshotSha256,
      observationId,
      transaction.value,
      outcome,
      transactionPosition,
      transactionBlockId,
      finalizedPosition,
      finalizedBlockId,
      chainAnchorEvidenceFingerprintSha256,
      sourceAuthorityId,
      sourceAuthorityFingerprintSha256,
      deploymentAuthorityId,
      deploymentAuthorityFingerprintSha256,
      primaryAttestationSha256,
      corroboratingAttestationSha256,
      transactionEvidenceSha256,
      effectEvidenceSha256,
      failureEvidenceSha256,
      observedAt.value,
      deadlineAt.value,
      correlationId,
    ]),
    accountId,
    intentId,
    expectedRevision,
    expectedSnapshotSha256,
    outcome,
    observedAt,
    deadlineAt,
  });
}

function reviewedPostFinalityArguments(candidate: unknown): ReviewedPostFinalityArguments {
  const common = exactDataRecord(
    candidate,
    [...CANDIDATE_KEYS, 'reviewArguments', 'effectiveSafetyBinding'],
    true,
    true,
  );
  if (
    common.producerVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION ||
    common.use !== MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_USE ||
    common.purpose !== 'POST_FINALITY_REVIEW' ||
    common.mayAuthorizeFinancialAction !== false ||
    common.mayPersist !== false
  ) {
    return fail();
  }
  const input = exactDataArray(common.reviewArguments, 25);
  const accountId = uuid(input[0]);
  const intentId = uuid(input[1]);
  const terminalRevision = integer(input[2], 3n, MAX_INT64);
  const terminalSnapshotSha256 = digest(input[3]);
  const expectedReviewRevision = integer(input[4], 0n, MAX_INT64);
  const expectedPreviousReviewFingerprintSha256 = nullableDigest(input[5]);
  if ((expectedReviewRevision === '0') !== (expectedPreviousReviewFingerprintSha256 === null)) {
    return fail();
  }
  const reviewId = uuid(input[6]);
  const reviewedDisposition = disposition(input[7]);
  const lineageStatus = member(input[8], ['CANONICAL', 'UNKNOWN', 'CONFLICT'] as const);
  const validDisposition =
    (reviewedDisposition === 'FINALITY_REAFFIRMED' && lineageStatus === 'CANONICAL') ||
    (reviewedDisposition === 'REVIEW_INCONCLUSIVE' && lineageStatus === 'UNKNOWN') ||
    (reviewedDisposition === 'DEEP_REORG_QUARANTINED' && lineageStatus === 'CONFLICT');
  if (!validDisposition) return fail();
  const transaction = transactionIdentity(input[9]);
  const transactionPosition = integer(input[10], 0n, MAX_UINT64);
  const transactionBlockId = blockIdentity(input[11], transaction.network);
  const finalizedPosition = integer(input[12], 0n, MAX_UINT64);
  const finalizedBlockId = blockIdentity(input[13], transaction.network);
  if (
    reviewedDisposition === 'FINALITY_REAFFIRMED' &&
    BigInt(finalizedPosition) < BigInt(transactionPosition)
  ) {
    return fail();
  }
  const chainAnchorEvidenceFingerprintSha256 = digest(input[14]);
  const sourceAuthorityId = uuid(input[15]);
  const sourceAuthorityFingerprintSha256 = digest(input[16]);
  const deploymentAuthorityId = uuid(input[17]);
  const deploymentAuthorityFingerprintSha256 = digest(input[18]);
  const primaryAttestationSha256 = digest(input[19]);
  const corroboratingAttestationSha256 = digest(input[20]);
  const transactionEvidenceSha256 = digest(input[21]);
  if (
    primaryAttestationSha256 === corroboratingAttestationSha256 ||
    primaryAttestationSha256 === transactionEvidenceSha256 ||
    corroboratingAttestationSha256 === transactionEvidenceSha256
  ) {
    return fail();
  }
  const observedAt = canonicalTime(input[22]);
  const deadlineAt = canonicalTime(input[23]);
  const correlationId = uuid(input[24]);
  if (observedAt.milliseconds >= deadlineAt.milliseconds) return fail();
  const binding = exactDataRecord(
    common.effectiveSafetyBinding,
    EFFECTIVE_SAFETY_BINDING_KEYS,
    true,
    true,
  );
  const terminalTransitionFingerprintSha256 = digest(binding.terminalTransitionFingerprintSha256);
  const originalAdmissionFingerprintSha256 = digest(binding.originalAdmissionFingerprintSha256);
  const bindingReviewRevision = integer(binding.expectedReviewRevision, 0n, MAX_INT64);
  const bindingReviewFingerprint = nullableDigest(binding.expectedPreviousReviewFingerprintSha256);
  const effectiveSafetyState = member(binding.effectiveSafetyState, [
    'AUTHENTICATED_FINALITY_RECORDED',
    'POST_FINALITY_REVIEW_INCONCLUSIVE',
    'DEEP_REORG_QUARANTINED',
  ] as const);
  if (
    bindingReviewRevision !== expectedReviewRevision ||
    bindingReviewFingerprint !== expectedPreviousReviewFingerprintSha256
  ) {
    return fail();
  }
  return frozenNullPrototype({
    values: Object.freeze([
      accountId,
      intentId,
      terminalRevision,
      terminalSnapshotSha256,
      expectedReviewRevision,
      expectedPreviousReviewFingerprintSha256,
      reviewId,
      reviewedDisposition,
      lineageStatus,
      transaction.value,
      transactionPosition,
      transactionBlockId,
      finalizedPosition,
      finalizedBlockId,
      chainAnchorEvidenceFingerprintSha256,
      sourceAuthorityId,
      sourceAuthorityFingerprintSha256,
      deploymentAuthorityId,
      deploymentAuthorityFingerprintSha256,
      primaryAttestationSha256,
      corroboratingAttestationSha256,
      transactionEvidenceSha256,
      observedAt.value,
      deadlineAt.value,
      correlationId,
    ]),
    accountId,
    intentId,
    terminalRevision,
    terminalSnapshotSha256,
    network: transaction.network,
    transactionId: transaction.value,
    transactionPosition,
    transactionBlockId,
    expectedReviewRevision,
    expectedPreviousReviewFingerprintSha256,
    terminalTransitionFingerprintSha256,
    originalAdmissionFingerprintSha256,
    effectiveSafetyState,
    disposition: reviewedDisposition,
    observedAt,
    deadlineAt,
  });
}

function reviewedAdmissionRequest(value: unknown): ReviewedAdmissionRequest {
  const record = exactDataRecord(value, ADMISSION_REQUEST_KEYS, true, false);
  const signal = abortSignal(record.signal);
  const evidenceCapability = record.evidenceCapability;
  const evidenceRequest = record.evidenceRequest;
  if (
    typeof evidenceCapability !== 'object' ||
    evidenceCapability === null ||
    isProxy(evidenceCapability) ||
    (typeof evidenceRequest !== 'object' && typeof evidenceRequest !== 'function') ||
    evidenceRequest === null ||
    isProxy(evidenceRequest) ||
    stableDataMember(evidenceRequest, 'signal') !== signal
  ) {
    return fail();
  }
  return frozenNullPrototype({
    request: value as RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
    evidenceCapability,
    evidenceRequest:
      evidenceRequest as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
    signal,
  });
}

function reviewedReadRequest(value: unknown): ReviewedReadRequest {
  const record = exactDataRecord(value, READ_REQUEST_KEYS, true, false);
  return frozenNullPrototype({
    request: value as ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
    accountId: uuid(record.accountId),
    intentId: uuid(record.intentId),
    signal: abortSignal(record.signal),
  });
}

function reviewedPostFinalityRequest(value: unknown): ReviewedPostFinalityRequest {
  const record = exactDataRecord(value, POST_FINALITY_REQUEST_KEYS, true, false);
  const signal = abortSignal(record.signal);
  const evidenceCapability = record.evidenceCapability;
  const evidenceRequest = record.evidenceRequest;
  if (
    typeof evidenceCapability !== 'object' ||
    evidenceCapability === null ||
    isProxy(evidenceCapability) ||
    (typeof evidenceRequest !== 'object' && typeof evidenceRequest !== 'function') ||
    evidenceRequest === null ||
    isProxy(evidenceRequest) ||
    stableDataMember(evidenceRequest, 'signal') !== signal ||
    typeof record.effectiveSafetyCursor !== 'object' ||
    record.effectiveSafetyCursor === null ||
    isProxy(record.effectiveSafetyCursor) ||
    typeof record.effectiveSafetyReadRequest !== 'object' ||
    record.effectiveSafetyReadRequest === null ||
    isProxy(record.effectiveSafetyReadRequest)
  ) {
    return fail();
  }
  return frozenNullPrototype({
    request: value as RecordMainnetFinancialActionPostFinalityReviewRequestV1,
    evidenceCapability,
    evidenceRequest: evidenceRequest as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
    effectiveSafetyCursor:
      record.effectiveSafetyCursor as DormantMainnetFinancialActionEffectiveSafetyCursorV1,
    effectiveSafetyReadRequest:
      record.effectiveSafetyReadRequest as ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
    signal,
  });
}

function sameAdmissionRequest(
  left: ReviewedAdmissionRequest,
  right: ReviewedAdmissionRequest,
): boolean {
  return (
    left.request === right.request &&
    left.evidenceCapability === right.evidenceCapability &&
    left.evidenceRequest === right.evidenceRequest &&
    left.signal === right.signal
  );
}

function samePostFinalityRequest(
  left: ReviewedPostFinalityRequest,
  right: ReviewedPostFinalityRequest,
): boolean {
  return (
    left.request === right.request &&
    left.evidenceCapability === right.evidenceCapability &&
    left.evidenceRequest === right.evidenceRequest &&
    left.effectiveSafetyCursor === right.effectiveSafetyCursor &&
    left.effectiveSafetyReadRequest === right.effectiveSafetyReadRequest &&
    left.signal === right.signal
  );
}

function exactCursor(value: unknown): DormantMainnetFinancialActionEffectiveSafetyCursorV1 {
  const record = exactDataRecord(value, CURSOR_KEYS, true, true);
  const reviewRevision = integer(record.reviewRevision, 0n, MAX_INT64);
  const reviewFingerprintSha256 = nullableDigest(record.reviewFingerprintSha256);
  if (
    record.schemaVersion !== 1 ||
    record.source !== 'MIGRATION_0035_DATABASE' ||
    record.fingerprintEncoding !== MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING ||
    (reviewRevision === '0') !== (reviewFingerprintSha256 === null)
  ) {
    return fail();
  }
  uuid(record.accountId);
  uuid(record.intentId);
  const networkId = member(record.networkId, [
    'eip155:1',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  ] as const);
  integer(record.terminalRevision, 3n, MAX_INT64);
  digest(record.terminalSnapshotSha256);
  digest(record.terminalTransitionFingerprintSha256);
  digest(record.originalAdmissionFingerprintSha256);
  const transaction = transactionIdentity(record.chainTransactionId);
  if (
    (transaction.network === 'ETHEREUM'
      ? 'eip155:1'
      : 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') !== networkId
  ) {
    return fail();
  }
  integer(record.transactionPosition, 0n, MAX_UINT64);
  blockIdentity(record.transactionBlockId, transaction.network);
  return value as DormantMainnetFinancialActionEffectiveSafetyCursorV1;
}

function singleRow(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return fail();
    const rowsDescriptor = Object.getOwnPropertyDescriptor(value, 'rows');
    if (!rowsDescriptor?.enumerable || !('value' in rowsDescriptor)) return fail();
    const rows = rowsDescriptor.value as unknown;
    if (!Array.isArray(rows) || isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(rows) as unknown as PropertyDescriptorMap;
    const actual = Reflect.ownKeys(descriptors);
    if (
      descriptors['length']?.value !== 1 ||
      actual.length !== 2 ||
      actual.some((key) => key !== '0' && key !== 'length') ||
      !descriptors['0']?.enumerable ||
      !('value' in descriptors['0'])
    ) {
      return fail();
    }
    return exactDataRecord(descriptors['0'].value, keys, false, false);
  } catch {
    return fail();
  }
}

function commonResult(): Readonly<{
  sidecarVersion: 1;
  use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE;
  mayAuthorizeFinancialAction: false;
  mayConstructTransaction: false;
  apiMaySign: false;
  apiMayBroadcast: false;
  mayResendTransaction: false;
  automaticRetryAllowed: false;
  ledgerSettlementAuthority: false;
}> {
  return {
    sidecarVersion: DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayConstructTransaction: false as const,
    apiMaySign: false as const,
    apiMayBroadcast: false as const,
    mayResendTransaction: false as const,
    automaticRetryAllowed: false as const,
    ledgerSettlementAuthority: false as const,
  };
}

function decodeAdmission(
  value: unknown,
  arguments_: ReviewedAdmissionArguments,
): DormantMainnetFinancialActionAdmissionDatabaseConfirmedResultV1 {
  const row = singleRow(value, ADMISSION_ROW_KEYS);
  const databaseRecordOutcome = member(row.admission_outcome, ['RECORDED', 'REPLAYED'] as const);
  const admissionFingerprintSha256 = digest(row.admission_fingerprint_sha256);
  const admittedEventRevision = integer(row.admitted_event_revision, 3n, MAX_INT64);
  const admittedTransitionFingerprintSha256 = digest(row.admitted_transition_fingerprint_sha256);
  const stage = lifecycleStage(row.lifecycle_stage);
  const lifecycleRevision = integer(row.lifecycle_revision, 3n, MAX_INT64);
  const currentSnapshotSha256 = digest(row.current_snapshot_sha256);
  const sourceEvidenceSha256 = digest(row.source_evidence_sha256);
  const effectEvidenceSha256 = nullableDigest(row.effect_evidence_sha256);
  const failureEvidenceSha256 = nullableDigest(row.failure_evidence_sha256);
  const terminal = boolean(row.terminal);
  const requiresManualReconciliation = boolean(row.requires_manual_reconciliation);
  if (row.ledger_settlement_authority !== false) return fail();
  const recordedAt = canonicalTime(row.recorded_at);
  if (
    BigInt(admittedEventRevision) !== BigInt(arguments_.expectedRevision) + 1n ||
    BigInt(lifecycleRevision) < BigInt(admittedEventRevision) ||
    recordedAt.milliseconds < arguments_.observedAt.milliseconds ||
    recordedAt.milliseconds >= arguments_.deadlineAt.milliseconds ||
    (stage === 'FINALIZED_SUCCESS' ||
      stage === 'FINALIZED_FAILURE' ||
      stage === 'REORG_QUARANTINED') !== terminal ||
    (arguments_.outcome === 'FINALIZED_SUCCESS' && effectEvidenceSha256 === null) ||
    (arguments_.outcome === 'FINALIZED_FAILURE' && failureEvidenceSha256 === null) ||
    ((arguments_.outcome === 'PENDING' ||
      arguments_.outcome === 'UNKNOWN' ||
      arguments_.outcome === 'REORGED_OUT') &&
      (effectEvidenceSha256 !== null || failureEvidenceSha256 !== null))
  ) {
    return fail();
  }
  return frozenNullPrototype({
    ...commonResult(),
    outcome: 'DATABASE_STATE_CONFIRMED' as const,
    operation: 'RECORD_AUTHENTICATED_ADMISSION' as const,
    databaseRecordOutcome,
    admissionFingerprintSha256,
    admittedEventRevision,
    admittedTransitionFingerprintSha256,
    lifecycleStage: stage,
    lifecycleRevision,
    currentSnapshotSha256,
    sourceEvidenceSha256,
    effectEvidenceSha256,
    failureEvidenceSha256,
    terminal,
    requiresManualReconciliation,
    recordedAt: recordedAt.value,
    recoveryMode: 'READ_ONLY' as const,
  });
}

function expectedManualReview(state: MainnetFinancialActionEffectiveSafetyState): boolean {
  return state !== 'AUTHENTICATED_FINALITY_RECORDED' && state !== 'RECONCILIATION_PENDING';
}

function decodeReview(
  value: unknown,
  arguments_: ReviewedPostFinalityArguments,
  cursorSeal: IssuedCursor,
): DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1 {
  const row = singleRow(value, REVIEW_ROW_KEYS);
  const databaseRecordOutcome = member(row.record_outcome, ['RECORDED', 'REPLAYED'] as const);
  const recordedReviewFingerprintSha256 = digest(row.review_fingerprint_sha256);
  const recordedReviewRevision = integer(row.review_revision, 1n, MAX_INT64);
  const currentReviewRevision = integer(row.current_review_revision, 1n, MAX_INT64);
  const currentReviewFingerprintSha256 = digest(row.current_review_fingerprint_sha256);
  const currentReviewDisposition = disposition(row.current_review_disposition);
  const effectiveSafetyState = safetyState(row.effective_safety_state);
  const requiresManualReview = boolean(row.requires_manual_review);
  if (row.ledger_settlement_authority !== false) return fail();
  const recordedAt = canonicalTime(row.recorded_at);
  if (
    BigInt(recordedReviewRevision) !== BigInt(arguments_.expectedReviewRevision) + 1n ||
    BigInt(currentReviewRevision) < BigInt(recordedReviewRevision) ||
    ((databaseRecordOutcome === 'RECORDED' || currentReviewRevision === recordedReviewRevision) &&
      (currentReviewRevision !== recordedReviewRevision ||
        currentReviewFingerprintSha256 !== recordedReviewFingerprintSha256 ||
        currentReviewDisposition !== arguments_.disposition)) ||
    (BigInt(currentReviewRevision) > BigInt(recordedReviewRevision) &&
      currentReviewFingerprintSha256 === recordedReviewFingerprintSha256) ||
    recordedAt.milliseconds < arguments_.observedAt.milliseconds ||
    recordedAt.milliseconds >= arguments_.deadlineAt.milliseconds ||
    requiresManualReview !== expectedManualReview(effectiveSafetyState) ||
    (effectiveSafetyState === 'AUTHENTICATED_FINALITY_RECORDED' &&
      currentReviewDisposition !== 'FINALITY_REAFFIRMED') ||
    (effectiveSafetyState === 'POST_FINALITY_REVIEW_INCONCLUSIVE' &&
      currentReviewDisposition !== 'REVIEW_INCONCLUSIVE') ||
    (effectiveSafetyState === 'DEEP_REORG_QUARANTINED' &&
      currentReviewDisposition !== 'DEEP_REORG_QUARANTINED') ||
    (effectiveSafetyState !== 'AUTHENTICATED_FINALITY_RECORDED' &&
      effectiveSafetyState !== 'POST_FINALITY_REVIEW_INCONCLUSIVE' &&
      effectiveSafetyState !== 'AUTHORITY_CONTROLLED_QUARANTINED' &&
      effectiveSafetyState !== 'DEEP_REORG_QUARANTINED')
  ) {
    return fail();
  }
  // A mutation result never rolls a cursor forward. A fresh authenticated read
  // is required before any subsequent post-finality compare-and-swap.
  return frozenNullPrototype({
    ...commonResult(),
    outcome: 'DATABASE_STATE_CONFIRMED' as const,
    operation: 'RECORD_POST_FINALITY_REVIEW' as const,
    databaseRecordOutcome,
    cursor: null,
    lifecycleStage: cursorSeal.lifecycleStage,
    authenticatedReconciliation: true,
    recordedReviewRevision,
    recordedReviewFingerprintSha256,
    recordedReviewDisposition: arguments_.disposition,
    reviewRevision: currentReviewRevision,
    reviewFingerprintSha256: currentReviewFingerprintSha256,
    latestReviewDisposition: currentReviewDisposition,
    effectiveSafetyState,
    requiresManualReview,
    recordedAt: recordedAt.value,
    recoveryMode: 'READ_ONLY' as const,
  });
}

interface DecodedRead {
  readonly stage: DormantMainnetFinancialActionDatabaseStage;
  readonly networkId: 'eip155:1' | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  readonly lifecycleRevision: string;
  readonly currentSnapshotSha256: string;
  readonly currentTransitionFingerprintSha256: string;
  readonly admissionFingerprintSha256: string | null;
  readonly chainTransactionId: string | null;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly authenticatedReconciliation: boolean;
  readonly reviewRevision: string;
  readonly reviewFingerprintSha256: string | null;
  readonly latestReviewDisposition: MainnetFinancialActionPostFinalityDisposition | null;
  readonly effectiveSafetyState: MainnetFinancialActionEffectiveSafetyState;
  readonly requiresManualReview: boolean;
}

function decodeReadRow(value: unknown): DecodedRead {
  const row = singleRow(value, READ_ROW_KEYS);
  const stage = lifecycleStage(row.lifecycle_stage);
  const networkId = member(row.network_id, [
    'eip155:1',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  ] as const);
  const network: NetworkKind = networkId === 'eip155:1' ? 'ETHEREUM' : 'SOLANA';
  const lifecycleRevision = integer(row.lifecycle_revision, 1n, MAX_INT64);
  const currentSnapshotSha256 = digest(row.current_snapshot_sha256);
  const currentTransitionFingerprintSha256 = digest(row.current_transition_fingerprint_sha256);
  const admissionFingerprintSha256 = nullableDigest(row.admission_fingerprint_sha256);
  const chainTransaction =
    row.chain_transaction_id === null ? null : transactionIdentity(row.chain_transaction_id);
  const transactionPosition =
    row.transaction_position === null ? null : integer(row.transaction_position, 0n, MAX_UINT64);
  const transactionBlockId = nullableBlockIdentity(row.transaction_block_id, network);
  const authenticatedReconciliation = boolean(row.authenticated_reconciliation);
  const reviewRevision = integer(row.review_revision, 0n, MAX_INT64);
  const reviewFingerprintSha256 = nullableDigest(row.review_fingerprint_sha256);
  const latestReviewDisposition = nullableMember(row.latest_review_disposition, DISPOSITIONS);
  const effectiveSafetyState = safetyState(row.effective_safety_state);
  const requiresManualReview = boolean(row.requires_manual_review);
  if (
    row.may_authorize_financial_action !== false ||
    row.may_resend_transaction !== false ||
    row.ledger_settlement_authority !== false ||
    (reviewRevision === '0') !== (reviewFingerprintSha256 === null) ||
    (reviewRevision === '0') !== (latestReviewDisposition === null) ||
    authenticatedReconciliation !== (admissionFingerprintSha256 !== null) ||
    (transactionPosition === null) !== (transactionBlockId === null) ||
    (transactionBlockId !== null && chainTransaction === null) ||
    (chainTransaction !== null && chainTransaction.network !== network) ||
    requiresManualReview !== expectedManualReview(effectiveSafetyState) ||
    (effectiveSafetyState === 'RECONCILIATION_PENDING' &&
      (stage === 'FINALIZED_SUCCESS' ||
        stage === 'FINALIZED_FAILURE' ||
        stage === 'REORG_QUARANTINED')) ||
    (effectiveSafetyState === 'AUTHENTICATED_FINALITY_RECORDED' &&
      (!authenticatedReconciliation ||
        chainTransaction === null ||
        transactionPosition === null ||
        transactionBlockId === null ||
        (stage !== 'FINALIZED_SUCCESS' && stage !== 'FINALIZED_FAILURE') ||
        latestReviewDisposition === 'REVIEW_INCONCLUSIVE' ||
        latestReviewDisposition === 'DEEP_REORG_QUARANTINED')) ||
    (effectiveSafetyState === 'POST_FINALITY_REVIEW_INCONCLUSIVE' &&
      (!authenticatedReconciliation ||
        chainTransaction === null ||
        transactionPosition === null ||
        transactionBlockId === null ||
        (stage !== 'FINALIZED_SUCCESS' && stage !== 'FINALIZED_FAILURE') ||
        latestReviewDisposition !== 'REVIEW_INCONCLUSIVE')) ||
    (effectiveSafetyState === 'DEEP_REORG_QUARANTINED' &&
      (latestReviewDisposition !== 'DEEP_REORG_QUARANTINED' ||
        !authenticatedReconciliation ||
        chainTransaction === null ||
        transactionPosition === null ||
        transactionBlockId === null ||
        (stage !== 'FINALIZED_SUCCESS' && stage !== 'FINALIZED_FAILURE'))) ||
    (effectiveSafetyState === 'AUTHORITY_CONTROLLED_QUARANTINED' && !authenticatedReconciliation) ||
    (effectiveSafetyState === 'REORG_QUARANTINED' && stage !== 'REORG_QUARANTINED') ||
    (effectiveSafetyState === 'UNAUTHENTICATED_TERMINAL_QUARANTINED' &&
      (authenticatedReconciliation ||
        (stage !== 'FINALIZED_SUCCESS' &&
          stage !== 'FINALIZED_FAILURE' &&
          stage !== 'REORG_QUARANTINED')))
  ) {
    return fail();
  }
  return frozenNullPrototype({
    stage,
    networkId,
    lifecycleRevision,
    currentSnapshotSha256,
    currentTransitionFingerprintSha256,
    admissionFingerprintSha256,
    chainTransactionId: chainTransaction?.value ?? null,
    transactionPosition,
    transactionBlockId,
    authenticatedReconciliation,
    reviewRevision,
    reviewFingerprintSha256,
    latestReviewDisposition,
    effectiveSafetyState,
    requiresManualReview,
  });
}

function unknownResult(
  operation: DormantMainnetFinancialActionFinalitySidecarOperation,
  lastConfirmedEffectiveSafetyCursor: DormantMainnetFinancialActionEffectiveSafetyCursorV1 | null,
): DormantMainnetFinancialActionFinalityDatabaseOutcomeUnknownV1 {
  return frozenNullPrototype({
    ...commonResult(),
    outcome: 'DATABASE_OUTCOME_UNKNOWN' as const,
    operation,
    lastConfirmedEffectiveSafetyCursor,
    recoveryMode: 'READ_ONLY' as const,
  });
}

function nativePromise(value: unknown): Promise<unknown> | null {
  try {
    return typeof value === 'object' &&
      value !== null &&
      !isProxy(value) &&
      value instanceof Promise &&
      Object.getPrototypeOf(value) === Promise.prototype
      ? value
      : null;
  } catch {
    return null;
  }
}

function captureMethod<Method extends (...arguments_: never[]) => unknown>(
  value: unknown,
  methodName: string,
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
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (isProxy(current)) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(current, methodName);
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || typeof descriptor.value !== 'function') return fail();
        if (isProxy(descriptor.value)) return fail();
        return Object.freeze({ receiver: value, method: descriptor.value as Method });
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return fail();
  }
  return fail();
}

function captureProducerReview<Method extends (...arguments_: never[]) => unknown>(
  producer: DormantMainnetFinancialActionFinalityEvidenceProducer,
  methodName: 'reviewReconciliationAdmissionCandidate' | 'reviewPostFinalityReviewCandidate',
): CapturedMethod<Method> {
  try {
    if (
      typeof producer !== 'object' ||
      producer === null ||
      isProxy(producer) ||
      Object.getPrototypeOf(producer) !==
        DormantMainnetFinancialActionFinalityEvidenceProducer.prototype ||
      Object.getOwnPropertyDescriptor(producer, methodName) !== undefined
    ) {
      return fail();
    }
    const method =
      methodName === 'reviewReconciliationAdmissionCandidate'
        ? CANONICAL_RECONCILIATION_REVIEW
        : CANONICAL_POST_FINALITY_REVIEW;
    const descriptor = Object.getOwnPropertyDescriptor(
      DormantMainnetFinancialActionFinalityEvidenceProducer.prototype,
      methodName,
    );
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.value !== method ||
      typeof method !== 'function'
    ) {
      return fail();
    }
    if (isProxy(method)) return fail();
    return Object.freeze({ receiver: producer, method: method as Method });
  } catch {
    return fail();
  }
}

function invokeReview<Method extends (...arguments_: never[]) => unknown>(
  captured: CapturedMethod<Method>,
  capability: unknown,
  request: unknown,
): unknown {
  try {
    return Reflect.apply(captured.method, captured.receiver, [capability, request]);
  } catch {
    return fail();
  }
}

/**
 * Direct-import-only effective-safety reader and persistence factory.
 * Construction captures only PostgreSQL, so it can be given to the
 * prerequisite issuer before that issuer is given to the evidence producer.
 * Exactly one producer-backed persistence facet may then be bound. Cursor
 * minting, review, and consumption stay in this instance's private state.
 */
export class PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter implements DormantMainnetFinancialActionEffectiveSafetyReaderPort {
  readonly sidecarVersion = DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION;

  #reconciliationReview: CapturedMethod<ReviewReconciliationCandidate> | null = null;
  #postFinalityReview: CapturedMethod<ReviewPostFinalityCandidate> | null = null;
  readonly #databaseQuery: CapturedMethod<QueryWithCancellation>;
  readonly #issuedResults = new WeakMap<object, IssuedResult>();
  readonly #requestMethods = new WeakMap<object, DatabaseMethod>();
  readonly #issuedCursors = new WeakMap<object, IssuedCursor>();
  readonly #spentCursors = new WeakSet<object>();
  #boundPersistence: BoundMainnetFinancialActionFinalityPersistence | null = null;

  constructor(postgres: PostgresService) {
    this.#databaseQuery = captureMethod<QueryWithCancellation>(postgres, 'queryWithCancellation');
  }

  bindPersistence(
    producer: DormantMainnetFinancialActionFinalityEvidenceProducer,
  ): DormantMainnetFinancialActionFinalityPersistencePort {
    if (this.#boundPersistence !== null) return fail();
    const reconciliationReview = captureProducerReview<ReviewReconciliationCandidate>(
      producer,
      'reviewReconciliationAdmissionCandidate',
    );
    const postFinalityReview = captureProducerReview<ReviewPostFinalityCandidate>(
      producer,
      'reviewPostFinalityReviewCandidate',
    );
    const persistence = new BoundMainnetFinancialActionFinalityPersistence(
      (request) => this.#recordAuthenticatedAdmission(request),
      (request) => this.#recordPostFinalityReview(request),
      (capability, request) => this.#reviewPersistenceResult(capability, request),
    );
    this.#reconciliationReview = reconciliationReview;
    this.#postFinalityReview = postFinalityReview;
    this.#boundPersistence = persistence;
    return persistence;
  }

  async #recordAuthenticatedAdmission(
    requestInput: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
  ): Promise<unknown> {
    const request = reviewedAdmissionRequest(requestInput);
    const review = this.#reconciliationReview ?? fail();
    const firstCandidate = invokeReview(
      review,
      request.evidenceCapability,
      request.evidenceRequest,
    );
    if (firstCandidate !== request.evidenceCapability) return fail();
    const arguments_ = reviewedAdmissionArguments(firstCandidate);
    if (isAborted(request.signal)) return fail();

    const repeatedRequest = reviewedAdmissionRequest(requestInput);
    const secondCandidate = invokeReview(
      review,
      request.evidenceCapability,
      request.evidenceRequest,
    );
    if (
      !sameAdmissionRequest(request, repeatedRequest) ||
      secondCandidate !== firstCandidate ||
      isAborted(request.signal)
    ) {
      return fail();
    }

    return this.#dispatch(
      'recordAuthenticatedAdmission',
      'RECORD_AUTHENTICATED_ADMISSION',
      request.request,
      ADMISSION_SQL,
      arguments_.values,
      request.signal,
      null,
      (value) => decodeAdmission(value, arguments_),
    );
  }

  async #recordPostFinalityReview(
    requestInput: RecordMainnetFinancialActionPostFinalityReviewRequestV1,
  ): Promise<unknown> {
    const request = reviewedPostFinalityRequest(requestInput);
    const review = this.#postFinalityReview ?? fail();
    const cursorSeal = this.#reviewCursor(
      request.effectiveSafetyCursor,
      request.effectiveSafetyReadRequest,
    );
    const firstCandidate = invokeReview(
      review,
      request.evidenceCapability,
      request.evidenceRequest,
    );
    if (firstCandidate !== request.evidenceCapability) return fail();
    const arguments_ = reviewedPostFinalityArguments(firstCandidate);
    if (
      arguments_.accountId !== cursorSeal.cursor.accountId ||
      arguments_.intentId !== cursorSeal.cursor.intentId ||
      arguments_.terminalRevision !== cursorSeal.cursor.terminalRevision ||
      arguments_.terminalSnapshotSha256 !== cursorSeal.cursor.terminalSnapshotSha256 ||
      (arguments_.network === 'ETHEREUM'
        ? 'eip155:1'
        : 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') !== cursorSeal.cursor.networkId ||
      arguments_.transactionId !== cursorSeal.cursor.chainTransactionId ||
      arguments_.transactionPosition !== cursorSeal.cursor.transactionPosition ||
      (arguments_.disposition === 'DEEP_REORG_QUARANTINED'
        ? arguments_.transactionBlockId === cursorSeal.cursor.transactionBlockId
        : arguments_.transactionBlockId !== cursorSeal.cursor.transactionBlockId) ||
      arguments_.expectedReviewRevision !== cursorSeal.cursor.reviewRevision ||
      arguments_.expectedPreviousReviewFingerprintSha256 !==
        cursorSeal.cursor.reviewFingerprintSha256 ||
      arguments_.terminalTransitionFingerprintSha256 !==
        cursorSeal.cursor.terminalTransitionFingerprintSha256 ||
      arguments_.originalAdmissionFingerprintSha256 !==
        cursorSeal.cursor.originalAdmissionFingerprintSha256 ||
      arguments_.effectiveSafetyState !== cursorSeal.effectiveSafetyState ||
      isAborted(request.signal)
    ) {
      return fail();
    }

    const repeatedRequest = reviewedPostFinalityRequest(requestInput);
    const repeatedCursorSeal = this.#reviewCursor(
      repeatedRequest.effectiveSafetyCursor,
      repeatedRequest.effectiveSafetyReadRequest,
    );
    const secondCandidate = invokeReview(
      review,
      request.evidenceCapability,
      request.evidenceRequest,
    );
    if (
      !samePostFinalityRequest(request, repeatedRequest) ||
      repeatedCursorSeal !== cursorSeal ||
      secondCandidate !== firstCandidate ||
      isAborted(request.signal)
    ) {
      return fail();
    }

    // A cursor is a one-shot CAS capability. Once database dispatch is
    // attempted, success and ambiguity alike require a new effective read.
    this.#spentCursors.add(cursorSeal.cursor);
    return this.#dispatch(
      'recordPostFinalityReview',
      'RECORD_POST_FINALITY_REVIEW',
      request.request,
      POST_FINALITY_SQL,
      arguments_.values,
      request.signal,
      cursorSeal.cursor,
      (value) => decodeReview(value, arguments_, cursorSeal),
    );
  }

  async readEffectiveSafetyState(
    requestInput: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
  ): Promise<unknown> {
    const request = reviewedReadRequest(requestInput);
    if (isAborted(request.signal)) return fail();
    const repeated = reviewedReadRequest(requestInput);
    if (
      repeated.request !== request.request ||
      repeated.accountId !== request.accountId ||
      repeated.intentId !== request.intentId ||
      repeated.signal !== request.signal ||
      isAborted(request.signal)
    ) {
      return fail();
    }
    return this.#dispatch(
      'readEffectiveSafetyState',
      'READ_EFFECTIVE_SAFETY_STATE',
      request.request,
      READ_EFFECTIVE_SAFETY_SQL,
      Object.freeze([request.accountId, request.intentId]),
      request.signal,
      null,
      (value) => this.#decodeRead(value, request),
    );
  }

  reviewResult(
    capability: unknown,
    request: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
  ): DormantMainnetFinancialActionFinalitySidecarResultV1 | null {
    return this.#reviewIssuedResult(capability, request, 'readEffectiveSafetyState');
  }

  #reviewPersistenceResult(
    capability: unknown,
    request: DormantMainnetFinancialActionFinalityPersistenceRequestV1,
  ): DormantMainnetFinancialActionFinalitySidecarResultV1 | null {
    const method = this.#requestMethods.get(request);
    if (method !== 'recordAuthenticatedAdmission' && method !== 'recordPostFinalityReview') {
      return null;
    }
    return this.#reviewIssuedResult(capability, request, method);
  }

  #reviewIssuedResult(
    capability: unknown,
    request: DormantMainnetFinancialActionFinalitySidecarRequestV1,
    method: DatabaseMethod,
  ): DormantMainnetFinancialActionFinalitySidecarResultV1 | null {
    try {
      if (
        typeof capability !== 'object' ||
        capability === null ||
        isProxy(capability) ||
        typeof request !== 'object' ||
        request === null ||
        isProxy(request)
      ) {
        return null;
      }
      const issued = this.#issuedResults.get(capability);
      return issued?.result === capability &&
        issued.request === request &&
        issued.method === method &&
        this.#requestMethods.get(request) === method
        ? issued.result
        : null;
    } catch {
      return null;
    }
  }

  #reviewCursor(cursorInput: unknown, readRequestInput: unknown): IssuedCursor {
    const cursor = exactCursor(cursorInput);
    const readRequest = reviewedReadRequest(readRequestInput);
    const seal = this.#issuedCursors.get(cursor);
    if (
      seal === undefined ||
      this.#spentCursors.has(cursor) ||
      seal.cursor !== cursor ||
      seal.readRequest !== readRequest.request ||
      seal.readAccountId !== readRequest.accountId ||
      seal.readIntentId !== readRequest.intentId ||
      seal.readSignal !== readRequest.signal ||
      seal.readResult.cursor !== cursor ||
      cursor.accountId !== readRequest.accountId ||
      cursor.intentId !== readRequest.intentId
    ) {
      return fail();
    }
    return seal;
  }

  #decodeRead(
    value: unknown,
    request: ReviewedReadRequest,
  ): DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1 {
    const row = decodeReadRow(value);
    const eligible =
      row.authenticatedReconciliation &&
      (row.stage === 'FINALIZED_SUCCESS' || row.stage === 'FINALIZED_FAILURE') &&
      row.admissionFingerprintSha256 !== null &&
      row.chainTransactionId !== null &&
      row.transactionPosition !== null &&
      row.transactionBlockId !== null &&
      (row.effectiveSafetyState === 'AUTHENTICATED_FINALITY_RECORDED' ||
        row.effectiveSafetyState === 'POST_FINALITY_REVIEW_INCONCLUSIVE');
    const cursor = eligible
      ? frozenNullPrototype({
          schemaVersion: 1 as const,
          source: 'MIGRATION_0035_DATABASE' as const,
          fingerprintEncoding: MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING,
          accountId: request.accountId,
          intentId: request.intentId,
          networkId: row.networkId,
          terminalRevision: row.lifecycleRevision,
          terminalSnapshotSha256: row.currentSnapshotSha256,
          terminalTransitionFingerprintSha256: row.currentTransitionFingerprintSha256,
          originalAdmissionFingerprintSha256: row.admissionFingerprintSha256 ?? fail(),
          chainTransactionId: row.chainTransactionId ?? fail(),
          transactionPosition: row.transactionPosition ?? fail(),
          transactionBlockId: row.transactionBlockId ?? fail(),
          reviewRevision: row.reviewRevision,
          reviewFingerprintSha256: row.reviewFingerprintSha256,
        })
      : null;
    const result = frozenNullPrototype({
      ...commonResult(),
      outcome: 'DATABASE_STATE_CONFIRMED' as const,
      operation: 'READ_EFFECTIVE_SAFETY_STATE' as const,
      databaseRecordOutcome: 'READ' as const,
      cursor,
      lifecycleStage: row.stage,
      authenticatedReconciliation: row.authenticatedReconciliation,
      recordedReviewRevision: null,
      recordedReviewFingerprintSha256: null,
      recordedReviewDisposition: null,
      reviewRevision: row.reviewRevision,
      reviewFingerprintSha256: row.reviewFingerprintSha256,
      latestReviewDisposition: row.latestReviewDisposition,
      effectiveSafetyState: row.effectiveSafetyState,
      requiresManualReview: row.requiresManualReview,
      recordedAt: null,
      recoveryMode: 'READ_ONLY' as const,
    });
    if (cursor !== null) {
      this.#issuedCursors.set(
        cursor,
        Object.freeze({
          cursor,
          readRequest: request.request,
          readAccountId: request.accountId,
          readIntentId: request.intentId,
          readSignal: request.signal,
          readResult: result,
          lifecycleStage: row.stage as 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE',
          effectiveSafetyState: row.effectiveSafetyState as
            'AUTHENTICATED_FINALITY_RECORDED' | 'POST_FINALITY_REVIEW_INCONCLUSIVE',
        }),
      );
    }
    return result;
  }

  async #dispatch(
    method: DatabaseMethod,
    operation: DormantMainnetFinancialActionFinalitySidecarOperation,
    request: DormantMainnetFinancialActionFinalitySidecarRequestV1,
    sql: string,
    values: readonly unknown[],
    signal: AbortSignal,
    lastCursor: DormantMainnetFinancialActionEffectiveSafetyCursorV1 | null,
    decode: (value: unknown) => DormantMainnetFinancialActionFinalitySidecarResultV1,
  ): Promise<unknown> {
    this.#requestMethods.set(request, method);
    let pending: unknown;
    try {
      pending = Reflect.apply(this.#databaseQuery.method, this.#databaseQuery.receiver, [
        sql,
        values,
        signal,
      ]);
    } catch {
      return this.#issue(method, request, unknownResult(operation, lastCursor));
    }

    try {
      const promise = nativePromise(pending);
      if (promise === null) throw new Error('DATABASE_OUTCOME_UNKNOWN');
      const value = await promise;
      if (isAborted(signal)) throw new Error('DATABASE_OUTCOME_UNKNOWN');
      return this.#issue(method, request, decode(value));
    } catch {
      return this.#issue(method, request, unknownResult(operation, lastCursor));
    }
  }

  #issue(
    method: DatabaseMethod,
    request: DormantMainnetFinancialActionFinalitySidecarRequestV1,
    result: DormantMainnetFinancialActionFinalitySidecarResultV1,
  ): DormantMainnetFinancialActionFinalitySidecarResultV1 {
    this.#issuedResults.set(result, Object.freeze({ method, request, result }));
    return result;
  }
}

class BoundMainnetFinancialActionFinalityPersistence implements DormantMainnetFinancialActionFinalityPersistencePort {
  readonly sidecarVersion = DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION;

  constructor(
    private readonly recordAdmission: DormantMainnetFinancialActionFinalityPersistencePort['recordAuthenticatedAdmission'],
    private readonly recordReview: DormantMainnetFinancialActionFinalityPersistencePort['recordPostFinalityReview'],
    private readonly review: DormantMainnetFinancialActionFinalityPersistencePort['reviewResult'],
  ) {
    Object.freeze(this);
  }

  recordAuthenticatedAdmission(
    request: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
  ): Promise<unknown> {
    return this.recordAdmission(request);
  }

  recordPostFinalityReview(
    request: RecordMainnetFinancialActionPostFinalityReviewRequestV1,
  ): Promise<unknown> {
    return this.recordReview(request);
  }

  reviewResult(
    capability: unknown,
    request: DormantMainnetFinancialActionFinalityPersistenceRequestV1,
  ): DormantMainnetFinancialActionFinalitySidecarResultV1 | null {
    return this.review(capability, request);
  }
}
