import { isProxy } from 'node:util/types';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import { isMainnetLaunchNetwork } from '../../blockchain/domain/mainnet-launch-network-policy';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY,
  DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_LEASE_MILLISECONDS,
  DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_COMPLETION_USE,
  type ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  type ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  type ClaimDormantMainnetFinancialActionRequestV1,
  type CompleteDormantMainnetFinancialActionPreBroadcastRequestV1,
  type CompleteDormantMainnetFinancialActionReconciliationRequestV1,
  type CompleteDormantMainnetFinancialActionRequestV1,
  type DormantMainnetFinancialActionPreBroadcastJobV1,
  type DormantMainnetFinancialActionPreBroadcastSourceClaimV1,
  type DormantMainnetFinancialActionReconciliationJobV1,
  type DormantMainnetFinancialActionReconciliationSourceClaimV1,
  type DormantMainnetFinancialActionScheduledJobV1,
  type DormantMainnetFinancialActionSourceCompletionV1,
  type DormantMainnetFinancialActionTwoQueueClaimSourcePort,
} from '../application/ports/dormant-mainnet-financial-action-two-queue-scheduler.port';

const MINIMUM_LEASE_MILLISECONDS = 1_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_SHA256 = '0'.repeat(64);
const POSITIVE_UINT64 = /^[1-9][0-9]{0,19}$/u;
const EVM_TRANSACTION_ID = /^0x[0-9a-f]{64}$/u;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const UINT64_MAX = (1n << 64n) - 1n;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const PROMISE_THEN = Object.getOwnPropertyDescriptor(Promise.prototype, 'then')?.value as
  | ((
      this: Promise<unknown>,
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => never,
    ) => Promise<unknown>)
  | undefined;

const AUTHORITY_KEYS = Object.freeze([
  'mayAuthorizeFinancialAction',
  'mayConstructTransaction',
  'apiMaySign',
  'apiMayBroadcast',
  'mayResubmitTransaction',
  'ledgerSettlementAuthority',
] as const);
const CLAIM_REQUEST_KEYS = Object.freeze([
  'schedulerVersion',
  'use',
  'mayPersist',
  ...AUTHORITY_KEYS,
  'signal',
] as const);
const COMPLETION_REQUEST_KEYS = Object.freeze([
  'schedulerVersion',
  'use',
  'mayPersist',
  ...AUTHORITY_KEYS,
  'claimCapability',
  'claimRequest',
  'signal',
  'disposition',
] as const);
const CLAIM_ROW_KEYS = Object.freeze([
  'schedulerVersion',
  'jobId',
  'accountId',
  'intentId',
  'intentRecordFingerprintSha256',
  'networkId',
  'action',
  'lifecycleRevision',
  'lifecycleSnapshotSha256',
  'lifecycleStage',
  'queue',
  'purpose',
  'transactionId',
  'reconciliationOutcome',
  'attempt',
  'maximumAttempts',
  'leaseId',
  'fencingToken',
  'claimedAt',
  'leaseExpiresAt',
  ...AUTHORITY_KEYS,
] as const);
const COMPLETION_ROW_KEYS = Object.freeze([
  'recordOutcome',
  'completionDisposition',
  'resultingJobStatus',
  'completedAt',
  'attempt',
  'maximumAttempts',
] as const);

const CLAIM_SQL = `SELECT
  result.scheduler_version::integer AS "schedulerVersion",
  result.job_id::text AS "jobId",
  result.account_id::text AS "accountId",
  result.intent_id::text AS "intentId",
  result.intent_record_fingerprint_sha256 AS "intentRecordFingerprintSha256",
  result.network_id AS "networkId",
  result.action_type AS "action",
  result.lifecycle_revision::text AS "lifecycleRevision",
  result.lifecycle_snapshot_sha256 AS "lifecycleSnapshotSha256",
  result.lifecycle_stage AS "lifecycleStage",
  result.queue_name AS "queue",
  result.purpose AS "purpose",
  result.chain_transaction_id AS "transactionId",
  result.reconciliation_outcome AS "reconciliationOutcome",
  result.attempt_count::integer AS "attempt",
  result.maximum_attempts::integer AS "maximumAttempts",
  result.lease_id::text AS "leaseId",
  result.fencing_token::text AS "fencingToken",
  to_char(result.claimed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "claimedAt",
  to_char(result.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "leaseExpiresAt",
  result.may_authorize_financial_action AS "mayAuthorizeFinancialAction",
  result.may_construct_transaction AS "mayConstructTransaction",
  result.api_may_sign AS "apiMaySign",
  result.api_may_broadcast AS "apiMayBroadcast",
  result.may_resubmit_transaction AS "mayResubmitTransaction",
  result.ledger_settlement_authority AS "ledgerSettlementAuthority"
FROM claim_mainnet_financial_action_scheduler_job_v1($1::text, $2::integer) AS result`;

const COMPLETE_SQL = `SELECT
  result.record_outcome AS "recordOutcome",
  result.completion_outcome AS "completionDisposition",
  result.resulting_job_status AS "resultingJobStatus",
  to_char(result.server_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "completedAt",
  result.attempt_count::integer AS "attempt",
  result.maximum_attempts::integer AS "maximumAttempts"
FROM complete_mainnet_financial_action_scheduler_job_v1(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::text,
  $7::uuid, $8::numeric, $9::text
) AS result`;

class PostgresDormantMainnetFinancialActionSchedulerUnavailableError extends Error {
  constructor() {
    super('Dormant mainnet financial-action scheduler persistence is unavailable.');
    this.name = 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

type Queue = 'PRE_BROADCAST' | 'RECONCILIATION';
type QueryWithCancellation = PostgresService['queryWithCancellation'];

interface CapturedDatabaseMethod {
  readonly receiver: object;
  readonly method: QueryWithCancellation;
}

interface IssuedClaim {
  readonly queue: Queue;
  readonly request: WeakRef<ClaimDormantMainnetFinancialActionRequestV1>;
  readonly signal: AbortSignal;
  readonly claim:
    | DormantMainnetFinancialActionPreBroadcastSourceClaimV1
    | DormantMainnetFinancialActionReconciliationSourceClaimV1;
  reviewed: boolean;
  completionStarted: boolean;
}

interface IssuedCompletion {
  readonly sourceClaimCapability: object;
  readonly claimRequest: WeakRef<ClaimDormantMainnetFinancialActionRequestV1>;
  readonly request: WeakRef<CompleteDormantMainnetFinancialActionRequestV1>;
  readonly signal: AbortSignal;
  readonly result: DormantMainnetFinancialActionSourceCompletionV1;
}

function unavailable(): never {
  throw new PostgresDormantMainnetFinancialActionSchedulerUnavailableError();
}

function captureDatabaseMethod(value: unknown): CapturedDatabaseMethod {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    )
      return unavailable();
    let current: object | null = value as object;
    for (let depth = 0; current !== null && depth < 12; depth += 1) {
      if (isProxy(current)) return unavailable();
      const descriptor = Object.getOwnPropertyDescriptor(current, 'queryWithCancellation');
      if (descriptor !== undefined) {
        if (
          !('value' in descriptor) ||
          typeof descriptor.value !== 'function' ||
          isProxy(descriptor.value)
        )
          return unavailable();
        return Object.freeze({
          receiver: value as object,
          method: descriptor.value as QueryWithCancellation,
        });
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return unavailable();
  } catch (error) {
    if (error instanceof PostgresDormantMainnetFinancialActionSchedulerUnavailableError)
      throw error;
    return unavailable();
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    )
      return unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    )
      return unavailable();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor))
        return unavailable();
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof PostgresDormantMainnetFinancialActionSchedulerUnavailableError)
      throw error;
    return unavailable();
  }
}

function exactFrozenRequest(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = exactRecord(value, keys);
  try {
    if (!Object.isFrozen(value)) return unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      keys.some((key) => {
        const descriptor = descriptors[key];
        return descriptor === undefined || descriptor.configurable || descriptor.writable;
      })
    )
      return unavailable();
    return record;
  } catch (error) {
    if (error instanceof PostgresDormantMainnetFinancialActionSchedulerUnavailableError)
      throw error;
    return unavailable();
  }
}

function assertDeniedAuthority(record: Record<string, unknown>): void {
  if (record.mayPersist !== false || AUTHORITY_KEYS.some((key) => record[key] !== false))
    return unavailable();
}

function signal(value: unknown): AbortSignal {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value) ||
      ABORTED_GETTER === undefined
    )
      return unavailable();
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch (error) {
    if (error instanceof PostgresDormantMainnetFinancialActionSchedulerUnavailableError)
      throw error;
    return unavailable();
  }
}

function isAborted(value: AbortSignal): boolean {
  try {
    return ABORTED_GETTER === undefined || (Reflect.apply(ABORTED_GETTER, value, []) as boolean);
  } catch {
    return true;
  }
}

function validateClaimRequest(
  request: ClaimDormantMainnetFinancialActionRequestV1,
  queue: Queue,
): AbortSignal {
  const record = exactFrozenRequest(request, CLAIM_REQUEST_KEYS);
  assertDeniedAuthority(record);
  const expectedUse =
    queue === 'PRE_BROADCAST'
      ? DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE
      : DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE;
  if (
    record.schedulerVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION ||
    record.use !== expectedUse
  )
    return unavailable();
  const reviewedSignal = signal(record.signal);
  if (isAborted(reviewedSignal)) return unavailable();
  return reviewedSignal;
}

function validateCompletionRequest(
  request: CompleteDormantMainnetFinancialActionRequestV1,
  claimRequest: ClaimDormantMainnetFinancialActionRequestV1,
  queue: Queue,
): AbortSignal {
  const record = exactFrozenRequest(request, COMPLETION_REQUEST_KEYS);
  assertDeniedAuthority(record);
  const expectedUse =
    queue === 'PRE_BROADCAST'
      ? DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE
      : DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE;
  const dispositions =
    queue === 'PRE_BROADCAST'
      ? [
          'PRE_BROADCAST_REVIEW_COMPLETED',
          'RETRY_PRE_BROADCAST_REVIEW_ONLY',
          'PRE_BROADCAST_TERMINAL_FAILURE',
        ]
      : ['RECONCILIATION_COMPLETED', 'RETRY_RECONCILIATION_ONLY', 'MANUAL_REVIEW_REQUIRED'];
  if (
    record.schedulerVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION ||
    record.use !== expectedUse ||
    record.claimRequest !== claimRequest ||
    record.signal !== claimRequest.signal ||
    typeof record.disposition !== 'string' ||
    !dispositions.includes(record.disposition) ||
    typeof record.claimCapability !== 'object' ||
    record.claimCapability === null ||
    isProxy(record.claimCapability)
  )
    return unavailable();
  const reviewedSignal = signal(record.signal);
  if (isAborted(reviewedSignal)) return unavailable();
  return reviewedSignal;
}

function nativePromise(value: unknown): Promise<unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      !(value instanceof Promise) ||
      Object.getPrototypeOf(value) !== Promise.prototype ||
      Object.getOwnPropertyDescriptor(value, 'then') !== undefined ||
      PROMISE_THEN === undefined
    )
      return unavailable();
    return Reflect.apply(PROMISE_THEN, value, [
      (result: unknown): unknown => result,
      (reason: unknown): never => {
        throw reason;
      },
    ]) as Promise<unknown>;
  } catch (error) {
    if (error instanceof PostgresDormantMainnetFinancialActionSchedulerUnavailableError)
      throw error;
    return unavailable();
  }
}

function databaseRow(
  value: unknown,
  keys: readonly string[],
  allowEmpty: boolean,
): Record<string, unknown> | null {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(value, 'rows');
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
      return unavailable();
    const rows = descriptor.value as unknown;
    if (!Array.isArray(rows) || isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype)
      return unavailable();
    const rowKeys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(rows));
    if (rows.length === 0) {
      if (allowEmpty && rowKeys.length === 1 && rowKeys[0] === 'length') return null;
      return unavailable();
    }
    if (rows.length !== 1) return unavailable();
    const rowDescriptor = Object.getOwnPropertyDescriptor(rows, '0');
    if (
      rowDescriptor === undefined ||
      !('value' in rowDescriptor) ||
      !rowDescriptor.enumerable ||
      rowKeys.length !== 2 ||
      !rowKeys.includes('0') ||
      !rowKeys.includes('length')
    )
      return unavailable();
    return exactRecord(rowDescriptor.value, keys);
  } catch (error) {
    if (error instanceof PostgresDormantMainnetFinancialActionSchedulerUnavailableError)
      throw error;
    return unavailable();
  }
}

function optionalClaimRow(value: unknown): Record<string, unknown> | null {
  return databaseRow(value, CLAIM_ROW_KEYS, true);
}

function singleCompletionRow(value: unknown): Record<string, unknown> {
  const row = databaseRow(value, COMPLETION_ROW_KEYS, false);
  return row ?? unavailable();
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return unavailable();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256)
    return unavailable();
  return value;
}

function positiveUint64(value: unknown): string {
  if (typeof value !== 'string' || !POSITIVE_UINT64.test(value)) return unavailable();
  try {
    if (BigInt(value) > UINT64_MAX) return unavailable();
    return value;
  } catch {
    return unavailable();
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    return unavailable();
  return value as number;
}

function timestamp(value: unknown): Readonly<{ text: string; milliseconds: number }> {
  if (typeof value !== 'string') return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value)
    return unavailable();
  return Object.freeze({ text: value, milliseconds });
}

function decodeBase58Length(value: string): number {
  const bytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) return 0;
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
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === '1') leadingZeroes += 1;
  const significant = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  return leadingZeroes + significant;
}

function validateTransactionId(networkId: string, value: unknown): string {
  if (typeof value !== 'string') return unavailable();
  if (networkId === 'eip155:1') {
    if (!EVM_TRANSACTION_ID.test(value)) return unavailable();
    return value;
  }
  if (!BASE58.test(value) || decodeBase58Length(value) !== 64) return unavailable();
  return value;
}

function deniedAuthority(record: Record<string, unknown>): void {
  if (AUTHORITY_KEYS.some((key) => record[key] !== false)) return unavailable();
}

function decodeClaimRow(
  raw: Record<string, unknown>,
  queue: Queue,
  leaseMilliseconds: number,
):
  | DormantMainnetFinancialActionPreBroadcastSourceClaimV1
  | DormantMainnetFinancialActionReconciliationSourceClaimV1 {
  deniedAuthority(raw);
  if (
    raw.schedulerVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION ||
    raw.queue !== queue
  )
    return unavailable();
  const jobId = uuid(raw.jobId);
  const accountId = uuid(raw.accountId);
  const intentId = uuid(raw.intentId);
  if (new Set([jobId, accountId, intentId]).size !== 3) return unavailable();
  if (typeof raw.networkId !== 'string' || !isMainnetLaunchNetwork(raw.networkId))
    return unavailable();
  if (raw.action !== 'SUPPLY' && raw.action !== 'WITHDRAW') return unavailable();
  const lifecycleRevision = positiveUint64(raw.lifecycleRevision);
  const attempt = boundedInteger(
    raw.attempt,
    1,
    DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY[queue].maximumAttempts,
  );
  const maximumAttempts = boundedInteger(
    raw.maximumAttempts,
    1,
    DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY[queue].maximumAttempts,
  );
  if (
    maximumAttempts !== DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY[queue].maximumAttempts ||
    attempt > maximumAttempts
  )
    return unavailable();
  const leaseId = uuid(raw.leaseId);
  if ([jobId, accountId, intentId].includes(leaseId)) return unavailable();
  const claimedAt = timestamp(raw.claimedAt);
  const leaseExpiresAt = timestamp(raw.leaseExpiresAt);
  if (leaseExpiresAt.milliseconds - claimedAt.milliseconds !== leaseMilliseconds)
    return unavailable();

  const common = {
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    mayAuthorizeFinancialAction: false as const,
    mayConstructTransaction: false as const,
    apiMaySign: false as const,
    apiMayBroadcast: false as const,
    mayResubmitTransaction: false as const,
    ledgerSettlementAuthority: false as const,
    jobId,
    accountId,
    intentId,
    intentRecordFingerprintSha256: digest(raw.intentRecordFingerprintSha256),
    networkId: raw.networkId,
    action: raw.action,
    lifecycleRevision,
    lifecycleSnapshotSha256: digest(raw.lifecycleSnapshotSha256),
  } as const;

  let job: DormantMainnetFinancialActionScheduledJobV1;
  if (queue === 'PRE_BROADCAST') {
    if (
      lifecycleRevision !== '1' ||
      raw.lifecycleStage !== 'PREPARED' ||
      raw.purpose !== 'PRE_BROADCAST_SAFETY_REVIEW' ||
      raw.transactionId !== null ||
      raw.reconciliationOutcome !== null
    )
      return unavailable();
    job = Object.freeze({
      ...common,
      queue,
      purpose: 'PRE_BROADCAST_SAFETY_REVIEW',
      lifecycleStage: 'PREPARED',
      transactionId: null,
      reconciliationOutcome: null,
    }) as DormantMainnetFinancialActionPreBroadcastJobV1;
  } else {
    const transactionId = validateTransactionId(raw.networkId, raw.transactionId);
    const revision = BigInt(lifecycleRevision);
    const coherent =
      (raw.lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND' &&
        revision === 2n &&
        raw.purpose === 'RECONCILIATION_ADMISSION' &&
        raw.reconciliationOutcome === null) ||
      (raw.lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS' &&
        revision >= 3n &&
        raw.purpose === 'RECONCILIATION_ADMISSION' &&
        raw.reconciliationOutcome === null) ||
      (raw.lifecycleStage === 'RECONCILIATION_AMBIGUOUS' &&
        revision >= 3n &&
        raw.purpose === 'RECONCILIATION_ADMISSION' &&
        (raw.reconciliationOutcome === 'PENDING' || raw.reconciliationOutcome === 'UNKNOWN')) ||
      (raw.lifecycleStage === 'FINALIZED_SUCCESS' &&
        revision >= 3n &&
        raw.purpose === 'POST_FINALITY_REVIEW' &&
        raw.reconciliationOutcome === 'FINALIZED_SUCCESS') ||
      (raw.lifecycleStage === 'FINALIZED_FAILURE' &&
        revision >= 3n &&
        raw.purpose === 'POST_FINALITY_REVIEW' &&
        raw.reconciliationOutcome === 'FINALIZED_FAILURE');
    if (!coherent) return unavailable();
    job = Object.freeze({
      ...common,
      queue,
      purpose: raw.purpose,
      lifecycleStage: raw.lifecycleStage,
      transactionId,
      reconciliationOutcome: raw.reconciliationOutcome,
    }) as DormantMainnetFinancialActionReconciliationJobV1;
  }

  return Object.freeze({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE,
    mayPersist: false,
    mayAuthorizeFinancialAction: false,
    mayConstructTransaction: false,
    apiMaySign: false,
    apiMayBroadcast: false,
    mayResubmitTransaction: false,
    ledgerSettlementAuthority: false,
    queue,
    job,
    attempt,
    leaseId,
    fencingToken: positiveUint64(raw.fencingToken),
    claimedAt: claimedAt.text,
    leaseExpiresAt: leaseExpiresAt.text,
  }) as
    | DormantMainnetFinancialActionPreBroadcastSourceClaimV1
    | DormantMainnetFinancialActionReconciliationSourceClaimV1;
}

function expectedCompletion(
  queue: Queue,
  disposition: CompleteDormantMainnetFinancialActionRequestV1['disposition'],
  attempt: number,
  maximumAttempts: number,
): Readonly<{
  completionDisposition: DormantMainnetFinancialActionSourceCompletionV1['completionDisposition'];
  resultingJobStatus: DormantMainnetFinancialActionSourceCompletionV1['resultingJobStatus'];
}> {
  if (disposition === 'RETRY_PRE_BROADCAST_REVIEW_ONLY' && attempt < maximumAttempts)
    return Object.freeze({
      completionDisposition: 'RELEASE_PRE_BROADCAST_ONLY',
      resultingJobStatus: 'READY',
    });
  if (disposition === 'RETRY_RECONCILIATION_ONLY' && attempt < maximumAttempts)
    return Object.freeze({
      completionDisposition: 'RELEASE_RECONCILIATION_ONLY',
      resultingJobStatus: 'READY',
    });
  if (
    disposition === 'RETRY_PRE_BROADCAST_REVIEW_ONLY' ||
    disposition === 'RETRY_RECONCILIATION_ONLY'
  )
    return Object.freeze({
      completionDisposition: 'ATTEMPT_LIMIT_REACHED',
      resultingJobStatus: 'MANUAL_REVIEW',
    });
  if (disposition === 'PRE_BROADCAST_TERMINAL_FAILURE')
    return Object.freeze({
      completionDisposition: 'TERMINAL_FAILURE',
      resultingJobStatus: 'MANUAL_REVIEW',
    });
  if (disposition === 'MANUAL_REVIEW_REQUIRED')
    return Object.freeze({
      completionDisposition: 'MANUAL_REVIEW_REQUIRED',
      resultingJobStatus: 'MANUAL_REVIEW',
    });
  return Object.freeze({ completionDisposition: 'COMPLETED', resultingJobStatus: 'COMPLETED' });
}

/**
 * Direct-import-only migration-0042 adapter. It has no runtime registration,
 * signer, broadcaster, retry loop, timer, or settlement authority.
 */
export class PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter implements DormantMainnetFinancialActionTwoQueueClaimSourcePort {
  readonly schedulerVersion = DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;

  readonly #databaseReceiver: object;
  readonly #databaseQuery: QueryWithCancellation;
  readonly #leaseMilliseconds: number;
  readonly #startedClaimRequests = new WeakSet<object>();
  readonly #claims = new WeakMap<object, IssuedClaim>();
  readonly #completions = new WeakMap<object, IssuedCompletion>();

  constructor(postgres: PostgresService, leaseMilliseconds: number) {
    this.#leaseMilliseconds = boundedInteger(
      leaseMilliseconds,
      MINIMUM_LEASE_MILLISECONDS,
      DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_LEASE_MILLISECONDS,
    );
    const database = captureDatabaseMethod(postgres);
    this.#databaseReceiver = database.receiver;
    this.#databaseQuery = database.method;
    Object.freeze(this);
  }

  claimPreBroadcast(
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): Promise<unknown> {
    return this.#claim('PRE_BROADCAST', request);
  }

  claimReconciliation(
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown> {
    return this.#claim('RECONCILIATION', request);
  }

  reviewPreBroadcastClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): DormantMainnetFinancialActionPreBroadcastSourceClaimV1 | null {
    const claim = this.#reviewClaim('PRE_BROADCAST', capability, request);
    return claim as DormantMainnetFinancialActionPreBroadcastSourceClaimV1 | null;
  }

  reviewReconciliationClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): DormantMainnetFinancialActionReconciliationSourceClaimV1 | null {
    const claim = this.#reviewClaim('RECONCILIATION', capability, request);
    return claim as DormantMainnetFinancialActionReconciliationSourceClaimV1 | null;
  }

  completePreBroadcast(
    sourceClaimCapability: unknown,
    claimRequest: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
    request: CompleteDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): Promise<unknown> {
    return this.#complete('PRE_BROADCAST', sourceClaimCapability, claimRequest, request);
  }

  completeReconciliation(
    sourceClaimCapability: unknown,
    claimRequest: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
    request: CompleteDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown> {
    return this.#complete('RECONCILIATION', sourceClaimCapability, claimRequest, request);
  }

  reviewPreBroadcastCompletion(
    capability: unknown,
    sourceClaimCapability: unknown,
    claimRequest: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
    request: CompleteDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): DormantMainnetFinancialActionSourceCompletionV1 | null {
    return this.#reviewCompletion(
      'PRE_BROADCAST',
      capability,
      sourceClaimCapability,
      claimRequest,
      request,
    );
  }

  reviewReconciliationCompletion(
    capability: unknown,
    sourceClaimCapability: unknown,
    claimRequest: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
    request: CompleteDormantMainnetFinancialActionReconciliationRequestV1,
  ): DormantMainnetFinancialActionSourceCompletionV1 | null {
    return this.#reviewCompletion(
      'RECONCILIATION',
      capability,
      sourceClaimCapability,
      claimRequest,
      request,
    );
  }

  async #claim(
    queue: Queue,
    request: ClaimDormantMainnetFinancialActionRequestV1,
  ): Promise<unknown> {
    const reviewedSignal = validateClaimRequest(request, queue);
    if (this.#startedClaimRequests.has(request)) return unavailable();
    this.#startedClaimRequests.add(request);

    let pending: unknown;
    try {
      pending = Reflect.apply(this.#databaseQuery, this.#databaseReceiver, [
        CLAIM_SQL,
        [queue, this.#leaseMilliseconds],
        reviewedSignal,
      ]);
    } catch {
      return unavailable();
    }

    let queryResult: unknown;
    try {
      queryResult = await nativePromise(pending);
    } catch {
      return unavailable();
    }
    if (isAborted(reviewedSignal)) return unavailable();
    const row = optionalClaimRow(queryResult);
    if (row === null) return null;
    const claim = decodeClaimRow(row, queue, this.#leaseMilliseconds);
    const capability = Object.freeze(Object.create(null) as object);
    this.#claims.set(capability, {
      queue,
      request: new WeakRef(request),
      signal: reviewedSignal,
      claim,
      reviewed: false,
      completionStarted: false,
    });
    return capability;
  }

  #reviewClaim(
    queue: Queue,
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionRequestV1,
  ):
    | DormantMainnetFinancialActionPreBroadcastSourceClaimV1
    | DormantMainnetFinancialActionReconciliationSourceClaimV1
    | null {
    try {
      if (typeof capability !== 'object' || capability === null || isProxy(capability)) return null;
      const issued = this.#claims.get(capability);
      if (
        issued === undefined ||
        issued.reviewed ||
        issued.queue !== queue ||
        issued.request.deref() !== request ||
        isAborted(issued.signal)
      )
        return null;
      validateClaimRequest(request, queue);
      issued.reviewed = true;
      return issued.claim;
    } catch {
      return null;
    }
  }

  async #complete(
    queue: Queue,
    sourceClaimCapability: unknown,
    claimRequest: ClaimDormantMainnetFinancialActionRequestV1,
    request: CompleteDormantMainnetFinancialActionRequestV1,
  ): Promise<unknown> {
    validateClaimRequest(claimRequest, queue);
    const reviewedSignal = validateCompletionRequest(request, claimRequest, queue);
    if (
      typeof sourceClaimCapability !== 'object' ||
      sourceClaimCapability === null ||
      isProxy(sourceClaimCapability)
    )
      return unavailable();
    const issued = this.#claims.get(sourceClaimCapability);
    if (
      issued === undefined ||
      !issued.reviewed ||
      issued.completionStarted ||
      issued.queue !== queue ||
      issued.request.deref() !== claimRequest ||
      issued.signal !== reviewedSignal
    )
      return unavailable();
    issued.completionStarted = true;
    this.#claims.delete(sourceClaimCapability);

    const job = issued.claim.job;
    const values = [
      job.jobId,
      job.accountId,
      job.intentId,
      queue,
      job.lifecycleRevision,
      job.lifecycleSnapshotSha256,
      issued.claim.leaseId,
      issued.claim.fencingToken,
      request.disposition,
    ] as const;
    let pending: unknown;
    try {
      pending = Reflect.apply(this.#databaseQuery, this.#databaseReceiver, [
        COMPLETE_SQL,
        values,
        reviewedSignal,
      ]);
    } catch {
      return unavailable();
    }

    let queryResult: unknown;
    try {
      queryResult = await nativePromise(pending);
    } catch {
      return unavailable();
    }
    if (isAborted(reviewedSignal)) return unavailable();
    const raw = singleCompletionRow(queryResult);
    const expected = expectedCompletion(
      queue,
      request.disposition,
      issued.claim.attempt,
      DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY[queue].maximumAttempts,
    );
    if (
      (raw.recordOutcome !== 'RECORDED' && raw.recordOutcome !== 'REPLAYED') ||
      raw.completionDisposition !== expected.completionDisposition ||
      raw.resultingJobStatus !== expected.resultingJobStatus ||
      raw.attempt !== issued.claim.attempt ||
      raw.maximumAttempts !== DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY[queue].maximumAttempts
    )
      return unavailable();
    const completedAt = timestamp(raw.completedAt);
    const claimedAt = timestamp(issued.claim.claimedAt);
    const leaseExpiresAt = timestamp(issued.claim.leaseExpiresAt);
    if (
      completedAt.milliseconds < claimedAt.milliseconds ||
      completedAt.milliseconds >= leaseExpiresAt.milliseconds
    )
      return unavailable();

    const result = Object.freeze({
      schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
      use: DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_COMPLETION_USE,
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      mayConstructTransaction: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResubmitTransaction: false,
      ledgerSettlementAuthority: false,
      recordOutcome: raw.recordOutcome,
      queue,
      jobId: job.jobId,
      accountId: job.accountId,
      intentId: job.intentId,
      lifecycleRevision: job.lifecycleRevision,
      lifecycleSnapshotSha256: job.lifecycleSnapshotSha256,
      attempt: issued.claim.attempt,
      maximumAttempts: DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY[queue].maximumAttempts,
      leaseId: issued.claim.leaseId,
      fencingToken: issued.claim.fencingToken,
      requestedDisposition: request.disposition,
      completionDisposition: expected.completionDisposition,
      resultingJobStatus: expected.resultingJobStatus,
      completedAt: completedAt.text,
    }) as DormantMainnetFinancialActionSourceCompletionV1;
    const capability = Object.freeze(Object.create(null) as object);
    this.#completions.set(
      capability,
      Object.freeze({
        sourceClaimCapability,
        claimRequest: new WeakRef(claimRequest),
        request: new WeakRef(request),
        signal: reviewedSignal,
        result,
      }),
    );
    return capability;
  }

  #reviewCompletion(
    queue: Queue,
    capability: unknown,
    sourceClaimCapability: unknown,
    claimRequest: ClaimDormantMainnetFinancialActionRequestV1,
    request: CompleteDormantMainnetFinancialActionRequestV1,
  ): DormantMainnetFinancialActionSourceCompletionV1 | null {
    try {
      if (
        typeof capability !== 'object' ||
        capability === null ||
        isProxy(capability) ||
        typeof sourceClaimCapability !== 'object' ||
        sourceClaimCapability === null ||
        isProxy(sourceClaimCapability)
      )
        return null;
      const issued = this.#completions.get(capability);
      if (issued === undefined) return null;
      this.#completions.delete(capability);
      validateClaimRequest(claimRequest, queue);
      validateCompletionRequest(request, claimRequest, queue);
      if (
        issued.result.queue !== queue ||
        issued.sourceClaimCapability !== sourceClaimCapability ||
        issued.claimRequest.deref() !== claimRequest ||
        issued.request.deref() !== request ||
        issued.signal !== request.signal ||
        isAborted(issued.signal)
      )
        return null;
      return issued.result;
    } catch {
      return null;
    }
  }
}
