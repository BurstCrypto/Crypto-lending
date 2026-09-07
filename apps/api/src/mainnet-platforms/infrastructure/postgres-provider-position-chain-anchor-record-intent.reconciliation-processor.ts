import { randomBytes } from 'node:crypto';
import { isProxy } from 'node:util/types';

import type { QueryResultRow } from 'pg';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
  type ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationPort,
  type ProviderPositionChainAnchorRecordIntentReconciliationResultV1,
  type ProviderPositionChainAnchorRecordIntentState,
  type ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
} from '../application/ports/provider-position-chain-anchor-record-intent-reconciliation.port';

const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_SHA256 = '0'.repeat(64);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const POSITIVE_BIGINT = /^[1-9][0-9]{0,18}$/u;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
const LEASE_MILLISECONDS = 30_000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

const REQUEST_KEYS = Object.freeze([
  'reconciliationVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'signal',
] as const);
const LEASE_ROW_COLUMNS = Object.freeze([
  'record_intent_fingerprint_sha256',
  'evidence_fingerprint_sha256',
  'intent_state',
  'producer_deadline_at',
  'reconciliation_attempt_count',
  'leased_at',
  'lease_expires_at',
] as const);
const RECONCILE_ROW_COLUMNS = Object.freeze([
  'intent_state',
  'record_intent_fingerprint_sha256',
  'evidence_fingerprint_sha256',
  'read_binding_fingerprint_sha256',
  'deadline_binding_sha256',
  'evidence_recorded_at',
  'resolved_at',
  'producer_deadline_at',
] as const);

const LEASE_RECONCILIATION_SQL = `SELECT
  intent.leased_record_intent_fingerprint_sha256 AS record_intent_fingerprint_sha256,
  intent.leased_evidence_fingerprint_sha256 AS evidence_fingerprint_sha256,
  intent.leased_intent_state AS intent_state,
  pg_catalog.to_char(
    intent.leased_producer_deadline_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS producer_deadline_at,
  intent.leased_reconciliation_attempt_count::text AS reconciliation_attempt_count,
  pg_catalog.to_char(
    intent.leased_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS leased_at,
  pg_catalog.to_char(
    intent.lease_expires_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS lease_expires_at
FROM lease_provider_chain_anchor_record_intent_reconciliation($1::bytea, interval '30 seconds') AS intent`;

const RECONCILE_RECORD_SQL = `SELECT
  intent.intent_state,
  intent.reconciled_record_intent_fingerprint_sha256 AS record_intent_fingerprint_sha256,
  intent.reconciled_evidence_fingerprint_sha256 AS evidence_fingerprint_sha256,
  intent.reconciled_read_binding_fingerprint_sha256 AS read_binding_fingerprint_sha256,
  intent.reconciled_deadline_binding_sha256 AS deadline_binding_sha256,
  pg_catalog.to_char(
    intent.reconciled_evidence_recorded_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS evidence_recorded_at,
  pg_catalog.to_char(
    intent.reconciled_resolved_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS resolved_at,
  pg_catalog.to_char(
    intent.reconciled_producer_deadline_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS producer_deadline_at
FROM reconcile_provider_position_chain_anchor_record_intent($1::text, $2::bytea) AS intent`;

type QueryWithCancellation = PostgresService['queryWithCancellation'];

interface CapturedQuery {
  readonly receiver: object;
  readonly method: QueryWithCancellation;
}

interface CanonicalTime {
  readonly value: string;
  readonly milliseconds: number;
}

interface LeaseDatabaseRow extends QueryResultRow {
  record_intent_fingerprint_sha256: unknown;
  evidence_fingerprint_sha256: unknown;
  intent_state: unknown;
  producer_deadline_at: unknown;
  reconciliation_attempt_count: unknown;
  leased_at: unknown;
  lease_expires_at: unknown;
}

interface ReconcileDatabaseRow extends QueryResultRow {
  intent_state: unknown;
  record_intent_fingerprint_sha256: unknown;
  evidence_fingerprint_sha256: unknown;
  read_binding_fingerprint_sha256: unknown;
  deadline_binding_sha256: unknown;
  evidence_recorded_at: unknown;
  resolved_at: unknown;
  producer_deadline_at: unknown;
}

interface ReviewedRequest {
  readonly request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1;
  readonly signal: AbortSignal;
}

interface ReviewedLease {
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly state: ProviderPositionChainAnchorRecordIntentState;
  readonly producerDeadlineAt: CanonicalTime;
  readonly reconciliationAttemptCount: string;
  readonly leasedAt: CanonicalTime;
  readonly leaseExpiresAt: CanonicalTime;
}

type ReconcileState = 'RECORDED' | 'IDEMPOTENT_REPLAY' | 'NOT_RECORDED' | 'DEADLINE_VIOLATION';

interface ReviewedReconciliation {
  readonly state: ReconcileState;
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly readBindingFingerprintSha256: string;
  readonly deadlineBindingSha256: string | null;
  readonly evidenceRecordedAt: CanonicalTime | null;
  readonly resolvedAt: CanonicalTime;
  readonly producerDeadlineAt: CanonicalTime;
}

type QueryAttempt = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;
type LeaseReview =
  | Readonly<{ outcome: 'IDLE' }>
  | Readonly<{ outcome: 'LEASED'; lease: ReviewedLease }>
  | Readonly<{ outcome: 'INVALID' }>;

class ProviderPositionChainAnchorRecordIntentReconciliationError extends Error {
  readonly code = 'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_FAILED' as const;

  constructor() {
    super('Provider position chain-anchor record-intent reconciliation failed');
    this.name = 'ProviderPositionChainAnchorRecordIntentReconciliationError';
  }
}

export const PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR = Object.freeze(
  new ProviderPositionChainAnchorRecordIntentReconciliationError(),
);

function fail(): never {
  throw PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR;
}

function frozenNullPrototype<T extends object>(fields: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, fields)) as Readonly<T>;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  requireFrozen: boolean,
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
    if (prototype !== null && prototype !== Object.prototype) return fail();
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

function isAborted(signal: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) return fail();
    return Reflect.apply(ABORTED_GETTER, signal, []) as boolean;
  } catch {
    return fail();
  }
}

function reviewedRequest(value: unknown): Readonly<ReviewedRequest> {
  const record = exactDataRecord(value, REQUEST_KEYS, true);
  if (
    record.reconciliationVersion !==
      PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE ||
    record.mayAuthorizeFinancialAction !== false
  ) {
    return fail();
  }
  const signal = authenticSignal(record.signal);
  if (isAborted(signal)) return fail();
  return frozenNullPrototype({
    request: value as ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
    signal,
  });
}

function captureQueryWithCancellation(value: PostgresService): Readonly<CapturedQuery> {
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
      const descriptor = Object.getOwnPropertyDescriptor(current, 'queryWithCancellation');
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || typeof descriptor.value !== 'function') return fail();
        if (isProxy(descriptor.value)) return fail();
        return Object.freeze({
          receiver: value,
          method: descriptor.value as QueryWithCancellation,
        });
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail();
  } catch {
    return fail();
  }
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

const QUERY_FAILED: QueryAttempt = Object.freeze({ ok: false });

async function queryAttempt(
  captured: CapturedQuery,
  sql: string,
  values: readonly unknown[],
  signal: AbortSignal,
): Promise<QueryAttempt> {
  try {
    const operation = Reflect.apply(captured.method, captured.receiver, [
      sql,
      values,
      signal,
    ]) as unknown;
    if (!genuinePromise(operation)) return QUERY_FAILED;
    try {
      return Object.freeze({ ok: true, value: await operation });
    } catch {
      return QUERY_FAILED;
    }
  } catch {
    return QUERY_FAILED;
  }
}

function exactRows(value: unknown): readonly unknown[] {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return fail();
    const rowsDescriptor = Object.getOwnPropertyDescriptor(value, 'rows');
    if (!rowsDescriptor?.enumerable || !('value' in rowsDescriptor)) return fail();
    const rows = rowsDescriptor.value as unknown;
    if (!Array.isArray(rows) || isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(rows) as unknown as PropertyDescriptorMap;
    const length = descriptors['length']?.value as unknown;
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > 1) {
      return fail();
    }
    const expectedKeys = [
      ...Array.from({ length: length as number }, (_, index) => String(index)),
      'length',
    ];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    return Object.freeze(
      expectedKeys.slice(0, -1).map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
        return descriptor.value;
      }),
    );
  } catch {
    return fail();
  }
}

function canonicalTimestamp(value: unknown): Readonly<CanonicalTime> {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail();
  }
  return Object.freeze({ value, milliseconds });
}

function nonzeroSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256) return fail();
  return value;
}

function nullableSha256(value: unknown): string | null {
  return value === null ? null : nonzeroSha256(value);
}

function nullableTimestamp(value: unknown): Readonly<CanonicalTime> | null {
  return value === null ? null : canonicalTimestamp(value);
}

function activeIntentState(value: unknown): ProviderPositionChainAnchorRecordIntentState {
  if (value !== 'NEW' && value !== 'RECORD_DISPATCHED' && value !== 'UNKNOWN') return fail();
  return value;
}

function reconciliationAttemptCount(value: unknown): string {
  if (typeof value !== 'string' || !POSITIVE_BIGINT.test(value)) return fail();
  try {
    if (BigInt(value) > MAX_SIGNED_BIGINT) return fail();
  } catch {
    return fail();
  }
  return value;
}

function reviewLease(value: unknown): LeaseReview {
  try {
    const rows = exactRows(value);
    if (rows.length === 0) return Object.freeze({ outcome: 'IDLE' as const });
    if (rows.length !== 1) return Object.freeze({ outcome: 'INVALID' as const });
    const row = exactDataRecord(rows[0], LEASE_ROW_COLUMNS, false) as unknown as LeaseDatabaseRow;
    const producerDeadlineAt = canonicalTimestamp(row.producer_deadline_at);
    const leasedAt = canonicalTimestamp(row.leased_at);
    const leaseExpiresAt = canonicalTimestamp(row.lease_expires_at);
    if (
      leasedAt.milliseconds < producerDeadlineAt.milliseconds ||
      leaseExpiresAt.milliseconds - leasedAt.milliseconds !== LEASE_MILLISECONDS
    ) {
      return fail();
    }
    return Object.freeze({
      outcome: 'LEASED' as const,
      lease: frozenNullPrototype({
        recordIntentFingerprintSha256: nonzeroSha256(row.record_intent_fingerprint_sha256),
        evidenceFingerprintSha256: nonzeroSha256(row.evidence_fingerprint_sha256),
        state: activeIntentState(row.intent_state),
        producerDeadlineAt,
        reconciliationAttemptCount: reconciliationAttemptCount(row.reconciliation_attempt_count),
        leasedAt,
        leaseExpiresAt,
      }),
    });
  } catch {
    return Object.freeze({ outcome: 'INVALID' as const });
  }
}

function reconcileState(value: unknown): ReconcileState {
  if (
    value !== 'RECORDED' &&
    value !== 'IDEMPOTENT_REPLAY' &&
    value !== 'NOT_RECORDED' &&
    value !== 'DEADLINE_VIOLATION'
  ) {
    return fail();
  }
  return value;
}

function reviewReconciliation(value: unknown, lease: ReviewedLease): ReviewedReconciliation {
  const rows = exactRows(value);
  if (rows.length !== 1) return fail();
  const row = exactDataRecord(
    rows[0],
    RECONCILE_ROW_COLUMNS,
    false,
  ) as unknown as ReconcileDatabaseRow;
  const state = reconcileState(row.intent_state);
  const recordIntentFingerprintSha256 = nonzeroSha256(row.record_intent_fingerprint_sha256);
  const evidenceFingerprintSha256 = nonzeroSha256(row.evidence_fingerprint_sha256);
  const readBindingFingerprintSha256 = nonzeroSha256(row.read_binding_fingerprint_sha256);
  const deadlineBindingSha256 = nullableSha256(row.deadline_binding_sha256);
  const evidenceRecordedAt = nullableTimestamp(row.evidence_recorded_at);
  const resolvedAt = canonicalTimestamp(row.resolved_at);
  const producerDeadlineAt = canonicalTimestamp(row.producer_deadline_at);

  if (
    state === 'RECORDED' ||
    recordIntentFingerprintSha256 !== lease.recordIntentFingerprintSha256 ||
    evidenceFingerprintSha256 !== lease.evidenceFingerprintSha256 ||
    producerDeadlineAt.value !== lease.producerDeadlineAt.value ||
    resolvedAt.milliseconds < lease.producerDeadlineAt.milliseconds ||
    resolvedAt.milliseconds < lease.leasedAt.milliseconds ||
    (lease.state === 'NEW' && state !== 'NOT_RECORDED')
  ) {
    return fail();
  }

  if (state === 'IDEMPOTENT_REPLAY') {
    if (
      deadlineBindingSha256 === null ||
      evidenceRecordedAt === null ||
      evidenceRecordedAt.milliseconds >= producerDeadlineAt.milliseconds ||
      resolvedAt.milliseconds < evidenceRecordedAt.milliseconds
    ) {
      return fail();
    }
  } else if (state === 'NOT_RECORDED') {
    if (deadlineBindingSha256 !== null || evidenceRecordedAt !== null) return fail();
  } else if (
    deadlineBindingSha256 !== null ||
    evidenceRecordedAt === null ||
    resolvedAt.milliseconds < evidenceRecordedAt.milliseconds
  ) {
    return fail();
  }

  return frozenNullPrototype({
    state,
    recordIntentFingerprintSha256,
    evidenceFingerprintSha256,
    readBindingFingerprintSha256,
    deadlineBindingSha256,
    evidenceRecordedAt,
    resolvedAt,
    producerDeadlineAt,
  });
}

function tryReviewReconciliation(
  attempt: QueryAttempt,
  lease: ReviewedLease,
): ReviewedReconciliation | null {
  if (!attempt.ok) return null;
  try {
    return reviewReconciliation(attempt.value, lease);
  } catch {
    return null;
  }
}

function hasNonzeroByte(value: Buffer): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) return true;
  }
  return false;
}

function commonResult(): Readonly<{
  reconciliationVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION;
  use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE;
  mayAuthorizeFinancialAction: false;
}> {
  return {
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
  } as const;
}

function idleResult(): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  return frozenNullPrototype({ ...commonResult(), outcome: 'IDLE' as const });
}

function deferredResult(
  lease: ReviewedLease | null,
  uncertainPhase: 'LEASE_RECONCILIATION' | 'RECONCILE_RECORD',
): ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1 {
  return frozenNullPrototype({
    ...commonResult(),
    outcome: 'DEFERRED' as const,
    recordIntentFingerprintSha256: lease?.recordIntentFingerprintSha256 ?? null,
    evidenceFingerprintSha256: lease?.evidenceFingerprintSha256 ?? null,
    knownIntentState: lease?.state ?? null,
    uncertainPhase,
    retryNotBefore: lease?.leaseExpiresAt.value ?? null,
  });
}

function terminalResult(
  reconciliation: ReviewedReconciliation,
): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  const common = commonResult();
  if (reconciliation.state === 'IDEMPOTENT_REPLAY') {
    return frozenNullPrototype({
      ...common,
      outcome: 'RECORDED' as const,
      recordIntentFingerprintSha256: reconciliation.recordIntentFingerprintSha256,
      evidenceFingerprintSha256: reconciliation.evidenceFingerprintSha256,
      deadlineBindingSha256: reconciliation.deadlineBindingSha256 ?? fail(),
      producerDeadlineAt: reconciliation.producerDeadlineAt.value,
      evidenceRecordedAt: (reconciliation.evidenceRecordedAt ?? fail()).value,
      resolvedAt: reconciliation.resolvedAt.value,
    });
  }
  if (reconciliation.state === 'NOT_RECORDED') {
    return frozenNullPrototype({
      ...common,
      outcome: 'NOT_RECORDED' as const,
      recordIntentFingerprintSha256: reconciliation.recordIntentFingerprintSha256,
      evidenceFingerprintSha256: reconciliation.evidenceFingerprintSha256,
      producerDeadlineAt: reconciliation.producerDeadlineAt.value,
      resolvedAt: reconciliation.resolvedAt.value,
    });
  }
  return frozenNullPrototype({
    ...common,
    outcome: 'DEADLINE_VIOLATION' as const,
    recordIntentFingerprintSha256: reconciliation.recordIntentFingerprintSha256,
    evidenceFingerprintSha256: reconciliation.evidenceFingerprintSha256,
    producerDeadlineAt: reconciliation.producerDeadlineAt.value,
    evidenceRecordedAt: (reconciliation.evidenceRecordedAt ?? fail()).value,
    resolvedAt: reconciliation.resolvedAt.value,
  });
}

/**
 * Dormant migration-0031 reconciliation processor. It owns one private lease
 * token and executes at most one lease and one reconciliation statement per
 * invocation. It is intentionally not registered with any module or timer.
 */
export class PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor implements ProviderPositionChainAnchorRecordIntentReconciliationPort {
  readonly reconciliationVersion =
    PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION;

  readonly #databaseQuery: Readonly<CapturedQuery>;
  readonly #issued = new WeakMap<
    object,
    Readonly<{
      request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1;
      result: ProviderPositionChainAnchorRecordIntentReconciliationResultV1;
    }>
  >();

  constructor(postgres: PostgresService) {
    this.#databaseQuery = captureQueryWithCancellation(postgres);
  }

  async reconcileNext(
    requestInput: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ): Promise<unknown> {
    const request = reviewedRequest(requestInput);
    let leaseToken: Buffer | null = null;
    let acknowledgedLease: ReviewedLease | null = null;
    let uncertainPhase: 'LEASE_RECONCILIATION' | 'RECONCILE_RECORD' = 'LEASE_RECONCILIATION';

    const issue = (
      result: ProviderPositionChainAnchorRecordIntentReconciliationResultV1,
    ): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 => {
      this.#issued.set(result, Object.freeze({ request: request.request, result }));
      return result;
    };

    try {
      try {
        const generated: unknown = randomBytes(32);
        if (!Buffer.isBuffer(generated) || isProxy(generated)) {
          return issue(deferredResult(null, 'LEASE_RECONCILIATION'));
        }
        leaseToken = generated;
        if (leaseToken.length !== 32 || !hasNonzeroByte(leaseToken)) {
          return issue(deferredResult(null, 'LEASE_RECONCILIATION'));
        }
      } catch {
        return issue(deferredResult(null, 'LEASE_RECONCILIATION'));
      }

      if (isAborted(request.signal)) {
        return issue(deferredResult(null, 'LEASE_RECONCILIATION'));
      }

      const leaseAttempt = await queryAttempt(
        this.#databaseQuery,
        LEASE_RECONCILIATION_SQL,
        Object.freeze([leaseToken]),
        request.signal,
      );
      if (!leaseAttempt.ok) return issue(deferredResult(null, 'LEASE_RECONCILIATION'));
      const leaseReview = reviewLease(leaseAttempt.value);
      if (leaseReview.outcome === 'INVALID') {
        return issue(deferredResult(null, 'LEASE_RECONCILIATION'));
      }
      if (leaseReview.outcome === 'IDLE') return issue(idleResult());

      const lease = leaseReview.lease;
      acknowledgedLease = lease;
      uncertainPhase = 'RECONCILE_RECORD';
      if (isAborted(request.signal)) {
        return issue(deferredResult(lease, 'RECONCILE_RECORD'));
      }

      const reconciliation = tryReviewReconciliation(
        await queryAttempt(
          this.#databaseQuery,
          RECONCILE_RECORD_SQL,
          Object.freeze([lease.recordIntentFingerprintSha256, leaseToken]),
          request.signal,
        ),
        lease,
      );
      return issue(
        reconciliation === null
          ? deferredResult(lease, 'RECONCILE_RECORD')
          : terminalResult(reconciliation),
      );
    } catch {
      return issue(deferredResult(acknowledgedLease, uncertainPhase));
    } finally {
      leaseToken?.fill(0);
    }
  }

  reviewResult(
    capability: unknown,
    request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 | null {
    try {
      if (typeof capability !== 'object' || capability === null || isProxy(capability)) return null;
      const issued = this.#issued.get(capability);
      return issued?.request === request && issued.result === capability ? issued.result : null;
    } catch {
      return null;
    }
  }
}
