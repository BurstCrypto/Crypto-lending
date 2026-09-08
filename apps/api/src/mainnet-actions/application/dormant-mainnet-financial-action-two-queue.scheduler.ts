import { isProxy } from 'node:util/types';

import { isMainnetLaunchNetwork } from '../../blockchain/domain/mainnet-launch-network-policy';
import { MAINNET_FINANCIAL_ACTIONS } from '../domain/dormant-mainnet-financial-action';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY,
  DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_CAPABILITY_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_VIEW_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_CAPABILITY_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_RESULT_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_LEASE_MILLISECONDS,
  DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE,
  type ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  type ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  type ClaimDormantMainnetFinancialActionRequestV1,
  type CompleteDormantMainnetFinancialActionPreBroadcastRequestV1,
  type CompleteDormantMainnetFinancialActionReconciliationRequestV1,
  type CompleteDormantMainnetFinancialActionRequestV1,
  type DormantMainnetFinancialActionClaimCapabilityV1,
  type DormantMainnetFinancialActionClaimViewV1,
  type DormantMainnetFinancialActionCompletionCapabilityV1,
  type DormantMainnetFinancialActionCompletionResultV1,
  type DormantMainnetFinancialActionPreBroadcastJobV1,
  type DormantMainnetFinancialActionReconciliationJobV1,
  type DormantMainnetFinancialActionScheduledJobV1,
  type DormantMainnetFinancialActionSchedulerClock,
  type DormantMainnetFinancialActionTwoQueueClaimSourcePort,
  type DormantMainnetFinancialActionTwoQueueSchedulerPort,
} from './ports/dormant-mainnet-financial-action-two-queue-scheduler.port';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const POSITIVE_UINT64 = /^[1-9][0-9]{0,19}$/u;
const EVM_TRANSACTION_ID = /^0x[0-9a-f]{64}$/u;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const UINT64_MAX = (1n << 64n) - 1n;
const MINIMUM_LEASE_MILLISECONDS = 1_000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const DATE_GET_TIME = Object.getOwnPropertyDescriptor(Date.prototype, 'getTime')?.value as
  ((this: Date) => number) | undefined;
const DATE_TO_ISO = Object.getOwnPropertyDescriptor(Date.prototype, 'toISOString')?.value as
  ((this: Date) => string) | undefined;
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
const SOURCE_CLAIM_KEYS = Object.freeze([
  'schedulerVersion',
  'use',
  'mayPersist',
  ...AUTHORITY_KEYS,
  'queue',
  'job',
  'attempt',
  'leaseId',
  'fencingToken',
  'claimedAt',
  'leaseExpiresAt',
] as const);
const JOB_KEYS = Object.freeze([
  'schedulerVersion',
  ...AUTHORITY_KEYS,
  'jobId',
  'accountId',
  'intentId',
  'intentRecordFingerprintSha256',
  'networkId',
  'action',
  'lifecycleRevision',
  'lifecycleSnapshotSha256',
  'queue',
  'purpose',
  'lifecycleStage',
  'transactionId',
  'reconciliationOutcome',
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

export type DormantMainnetFinancialActionSchedulerFailureCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'CLAIM_UNAVAILABLE'
  | 'CLAIM_EXPIRED'
  | 'CROSS_QUEUE_CLAIM';

export class DormantMainnetFinancialActionSchedulerUnavailableError extends Error {
  constructor(readonly code: DormantMainnetFinancialActionSchedulerFailureCode) {
    super('Dormant mainnet financial-action scheduled work is unavailable.');
    this.name = 'DormantMainnetFinancialActionSchedulerUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

interface CapturedMethod {
  readonly receiver: object;
  readonly method: (...arguments_: never[]) => unknown;
}

interface Timestamp {
  readonly text: string;
  readonly milliseconds: number;
}

interface IssuedClaim {
  readonly queue: 'PRE_BROADCAST' | 'RECONCILIATION';
  readonly request: WeakRef<ClaimDormantMainnetFinancialActionRequestV1>;
  readonly signal: AbortSignal;
  readonly view: DormantMainnetFinancialActionClaimViewV1;
  readonly claimedAtMilliseconds: number;
  readonly leaseExpiresAtMilliseconds: number;
}

interface IssuedCompletion {
  readonly request: WeakRef<CompleteDormantMainnetFinancialActionRequestV1>;
  readonly signal: AbortSignal;
  readonly result: DormantMainnetFinancialActionCompletionResultV1;
}

function fail(code: DormantMainnetFinancialActionSchedulerFailureCode): never {
  throw new DormantMainnetFinancialActionSchedulerUnavailableError(code);
}

function stableMember(value: unknown, key: PropertyKey): unknown {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    let current: object | null = value as object;
    for (let depth = 0; current !== null && depth < 12; depth += 1) {
      if (isProxy(current)) return fail('INVALID_CONFIGURATION');
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (
          !('value' in descriptor) ||
          (typeof descriptor.value === 'function' && isProxy(descriptor.value))
        ) {
          return fail('INVALID_CONFIGURATION');
        }
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail('INVALID_CONFIGURATION');
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionSchedulerUnavailableError) throw error;
    return fail('INVALID_CONFIGURATION');
  }
}

function captureMethod(value: unknown, key: PropertyKey): CapturedMethod {
  const method = stableMember(value, key);
  if (typeof method !== 'function') return fail('INVALID_CONFIGURATION');
  return Object.freeze({
    receiver: value as object,
    method: method as (...arguments_: never[]) => unknown,
  });
}

function nativePromiseResult(value: unknown): Promise<unknown> {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value) ||
      PROMISE_THEN === undefined
    )
      return fail('CLAIM_UNAVAILABLE');
    return Reflect.apply(PROMISE_THEN, value, [
      (result: unknown): unknown => result,
      (reason: unknown): never => {
        throw reason;
      },
    ]) as Promise<unknown>;
  } catch {
    return Promise.reject(
      new DormantMainnetFinancialActionSchedulerUnavailableError('CLAIM_UNAVAILABLE'),
    );
  }
}

function exactFrozenRecord(
  value: unknown,
  keys: readonly string[],
  code: 'INVALID_REQUEST' | 'CLAIM_UNAVAILABLE',
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      !Object.isFrozen(value)
    )
      return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    )
      return fail(code);
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.configurable ||
        !('value' in descriptor) ||
        descriptor.writable
      )
        return fail(code);
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionSchedulerUnavailableError) throw error;
    return fail(code);
  }
}

function assertDeniedAuthority(
  record: Record<string, unknown>,
  code: 'INVALID_REQUEST' | 'CLAIM_UNAVAILABLE',
): void {
  if (AUTHORITY_KEYS.some((key) => record[key] !== false) || record.mayPersist !== false) {
    return fail(code);
  }
}

function authenticSignal(value: unknown): AbortSignal {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value) ||
      ABORTED_GETTER === undefined
    )
      return fail('INVALID_REQUEST');
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionSchedulerUnavailableError) throw error;
    return fail('INVALID_REQUEST');
  }
}

function aborted(signal: AbortSignal): boolean {
  try {
    return ABORTED_GETTER === undefined || (Reflect.apply(ABORTED_GETTER, signal, []) as boolean);
  } catch {
    return true;
  }
}

function timestamp(value: unknown, code: 'INVALID_CONFIGURATION' | 'CLAIM_UNAVAILABLE'): Timestamp {
  if (typeof value !== 'string') return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value)
    return fail(code);
  return Object.freeze({ text: value, milliseconds });
}

function uuid(value: unknown, code: 'INVALID_REQUEST' | 'CLAIM_UNAVAILABLE'): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail(code);
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return fail('CLAIM_UNAVAILABLE');
  return value;
}

function positiveUint64(value: unknown): string {
  if (typeof value !== 'string' || !POSITIVE_UINT64.test(value)) return fail('CLAIM_UNAVAILABLE');
  try {
    if (BigInt(value) > UINT64_MAX) return fail('CLAIM_UNAVAILABLE');
    return value;
  } catch {
    return fail('CLAIM_UNAVAILABLE');
  }
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

function transactionId(networkId: unknown, value: unknown): string {
  if (typeof value !== 'string') return fail('CLAIM_UNAVAILABLE');
  if (networkId === 'eip155:1') {
    if (!EVM_TRANSACTION_ID.test(value)) return fail('CLAIM_UNAVAILABLE');
    return value;
  }
  if (!BASE58.test(value) || decodeBase58Length(value) !== 64) return fail('CLAIM_UNAVAILABLE');
  return value;
}

function validateJobCommon(record: Record<string, unknown>): Readonly<{
  jobId: string;
  accountId: string;
  intentId: string;
  intentRecordFingerprintSha256: string;
  networkId: DormantMainnetFinancialActionScheduledJobV1['networkId'];
  action: DormantMainnetFinancialActionScheduledJobV1['action'];
  lifecycleRevision: string;
  lifecycleSnapshotSha256: string;
}> {
  if (record.schedulerVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION)
    return fail('CLAIM_UNAVAILABLE');
  assertDeniedAuthority({ ...record, mayPersist: false }, 'CLAIM_UNAVAILABLE');
  const jobId = uuid(record.jobId, 'CLAIM_UNAVAILABLE');
  const accountId = uuid(record.accountId, 'CLAIM_UNAVAILABLE');
  const intentId = uuid(record.intentId, 'CLAIM_UNAVAILABLE');
  if (new Set([jobId, accountId, intentId]).size !== 3) return fail('CLAIM_UNAVAILABLE');
  if (typeof record.networkId !== 'string' || !isMainnetLaunchNetwork(record.networkId))
    return fail('CLAIM_UNAVAILABLE');
  if (
    typeof record.action !== 'string' ||
    !MAINNET_FINANCIAL_ACTIONS.includes(record.action as never)
  )
    return fail('CLAIM_UNAVAILABLE');
  return Object.freeze({
    jobId,
    accountId,
    intentId,
    intentRecordFingerprintSha256: digest(record.intentRecordFingerprintSha256),
    networkId: record.networkId,
    action: record.action as DormantMainnetFinancialActionScheduledJobV1['action'],
    lifecycleRevision: positiveUint64(record.lifecycleRevision),
    lifecycleSnapshotSha256: digest(record.lifecycleSnapshotSha256),
  });
}

function validatePreBroadcastJob(value: unknown): DormantMainnetFinancialActionPreBroadcastJobV1 {
  const record = exactFrozenRecord(value, JOB_KEYS, 'CLAIM_UNAVAILABLE');
  const common = validateJobCommon(record);
  if (
    record.queue !== 'PRE_BROADCAST' ||
    record.purpose !== 'PRE_BROADCAST_SAFETY_REVIEW' ||
    record.lifecycleStage !== 'PREPARED' ||
    common.lifecycleRevision !== '1' ||
    record.transactionId !== null ||
    record.reconciliationOutcome !== null
  )
    return fail('CLAIM_UNAVAILABLE');
  return value as DormantMainnetFinancialActionPreBroadcastJobV1;
}

function validateReconciliationJob(
  value: unknown,
): DormantMainnetFinancialActionReconciliationJobV1 {
  const record = exactFrozenRecord(value, JOB_KEYS, 'CLAIM_UNAVAILABLE');
  const common = validateJobCommon(record);
  const revision = BigInt(common.lifecycleRevision);
  if (record.queue !== 'RECONCILIATION' || revision < 2n) return fail('CLAIM_UNAVAILABLE');
  transactionId(common.networkId, record.transactionId);
  const coherent =
    (record.lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND' &&
      revision === 2n &&
      record.purpose === 'RECONCILIATION_ADMISSION' &&
      record.reconciliationOutcome === null) ||
    (record.lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS' &&
      revision >= 3n &&
      record.purpose === 'RECONCILIATION_ADMISSION' &&
      record.reconciliationOutcome === null) ||
    (record.lifecycleStage === 'RECONCILIATION_AMBIGUOUS' &&
      revision >= 3n &&
      record.purpose === 'RECONCILIATION_ADMISSION' &&
      (record.reconciliationOutcome === 'PENDING' || record.reconciliationOutcome === 'UNKNOWN')) ||
    (record.lifecycleStage === 'FINALIZED_SUCCESS' &&
      revision >= 3n &&
      record.purpose === 'POST_FINALITY_REVIEW' &&
      record.reconciliationOutcome === 'FINALIZED_SUCCESS') ||
    (record.lifecycleStage === 'FINALIZED_FAILURE' &&
      revision >= 3n &&
      record.purpose === 'POST_FINALITY_REVIEW' &&
      record.reconciliationOutcome === 'FINALIZED_FAILURE');
  if (!coherent) return fail('CLAIM_UNAVAILABLE');
  return value as DormantMainnetFinancialActionReconciliationJobV1;
}

function validateClaimRequest(
  request: ClaimDormantMainnetFinancialActionRequestV1,
  queue: 'PRE_BROADCAST' | 'RECONCILIATION',
): AbortSignal {
  const record = exactFrozenRecord(request, CLAIM_REQUEST_KEYS, 'INVALID_REQUEST');
  assertDeniedAuthority(record, 'INVALID_REQUEST');
  const expectedUse =
    queue === 'PRE_BROADCAST'
      ? DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE
      : DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE;
  if (
    record.schedulerVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION ||
    record.use !== expectedUse
  )
    return fail('INVALID_REQUEST');
  const signal = authenticSignal(record.signal);
  if (aborted(signal)) return fail('INVALID_REQUEST');
  return signal;
}

function sourceClaim(
  value: unknown,
  queue: 'PRE_BROADCAST' | 'RECONCILIATION',
  now: Timestamp,
): DormantMainnetFinancialActionClaimViewV1 {
  const record = exactFrozenRecord(value, SOURCE_CLAIM_KEYS, 'CLAIM_UNAVAILABLE');
  assertDeniedAuthority(record, 'CLAIM_UNAVAILABLE');
  if (
    record.schedulerVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION ||
    record.use !== DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE ||
    record.queue !== queue ||
    !Number.isSafeInteger(record.attempt)
  )
    return fail('CLAIM_UNAVAILABLE');
  const job =
    queue === 'PRE_BROADCAST'
      ? validatePreBroadcastJob(record.job)
      : validateReconciliationJob(record.job);
  const maximumAttempts = DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY[queue].maximumAttempts;
  const attempt = record.attempt as number;
  if (attempt < 1 || attempt > maximumAttempts) return fail('CLAIM_UNAVAILABLE');
  const leaseId = uuid(record.leaseId, 'CLAIM_UNAVAILABLE');
  if ([job.jobId, job.accountId, job.intentId].includes(leaseId)) return fail('CLAIM_UNAVAILABLE');
  const claimedAt = timestamp(record.claimedAt, 'CLAIM_UNAVAILABLE');
  const leaseExpiresAt = timestamp(record.leaseExpiresAt, 'CLAIM_UNAVAILABLE');
  const leaseLength = leaseExpiresAt.milliseconds - claimedAt.milliseconds;
  if (
    claimedAt.milliseconds > now.milliseconds ||
    leaseExpiresAt.milliseconds <= now.milliseconds ||
    leaseLength < MINIMUM_LEASE_MILLISECONDS ||
    leaseLength > DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_LEASE_MILLISECONDS
  )
    return fail('CLAIM_EXPIRED');
  return Object.freeze({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_VIEW_USE,
    mayAuthorizeFinancialAction: false,
    mayConstructTransaction: false,
    apiMaySign: false,
    apiMayBroadcast: false,
    mayResubmitTransaction: false,
    ledgerSettlementAuthority: false,
    mayPersist: false,
    queue,
    job,
    attempt,
    maximumAttempts,
    leaseId,
    fencingToken: positiveUint64(record.fencingToken),
    claimedAt: claimedAt.text,
    leaseExpiresAt: leaseExpiresAt.text,
  });
}

function validateCompletionRequest(
  request: CompleteDormantMainnetFinancialActionRequestV1,
  queue: 'PRE_BROADCAST' | 'RECONCILIATION',
): AbortSignal {
  const record = exactFrozenRecord(request, COMPLETION_REQUEST_KEYS, 'INVALID_REQUEST');
  assertDeniedAuthority(record, 'INVALID_REQUEST');
  if (record.schedulerVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION)
    return fail('INVALID_REQUEST');
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
    record.use !== expectedUse ||
    typeof record.disposition !== 'string' ||
    !dispositions.includes(record.disposition)
  )
    return fail('INVALID_REQUEST');
  const signal = authenticSignal(record.signal);
  if (aborted(signal)) return fail('INVALID_REQUEST');
  return signal;
}

function completionDisposition(
  queue: 'PRE_BROADCAST' | 'RECONCILIATION',
  requested: DormantMainnetFinancialActionCompletionResultV1['requestedDisposition'],
  attempt: number,
  maximumAttempts: number,
): Readonly<{
  completionDisposition: DormantMainnetFinancialActionCompletionResultV1['completionDisposition'];
  nextQueue: DormantMainnetFinancialActionCompletionResultV1['nextQueue'];
}> {
  if (requested === 'RETRY_PRE_BROADCAST_REVIEW_ONLY') {
    return attempt < maximumAttempts
      ? Object.freeze({
          completionDisposition: 'RELEASE_PRE_BROADCAST_ONLY',
          nextQueue: 'PRE_BROADCAST',
        })
      : Object.freeze({ completionDisposition: 'ATTEMPT_LIMIT_REACHED', nextQueue: null });
  }
  if (requested === 'RETRY_RECONCILIATION_ONLY') {
    return attempt < maximumAttempts
      ? Object.freeze({
          completionDisposition: 'RELEASE_RECONCILIATION_ONLY',
          nextQueue: 'RECONCILIATION',
        })
      : Object.freeze({ completionDisposition: 'ATTEMPT_LIMIT_REACHED', nextQueue: null });
  }
  if (requested === 'MANUAL_REVIEW_REQUIRED')
    return Object.freeze({ completionDisposition: 'MANUAL_REVIEW_REQUIRED', nextQueue: null });
  if (requested === 'PRE_BROADCAST_TERMINAL_FAILURE')
    return Object.freeze({ completionDisposition: 'TERMINAL_FAILURE', nextQueue: null });
  return Object.freeze({ completionDisposition: 'COMPLETED', nextQueue: null });
}

export class DormantMainnetFinancialActionTwoQueueScheduler implements DormantMainnetFinancialActionTwoQueueSchedulerPort {
  readonly schedulerVersion = DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  private readonly claimPreBroadcastMethod: CapturedMethod;
  private readonly claimReconciliationMethod: CapturedMethod;
  private readonly reviewPreBroadcastClaimMethod: CapturedMethod;
  private readonly reviewReconciliationClaimMethod: CapturedMethod;
  private readonly clockNowMethod: CapturedMethod;
  private readonly claims = new WeakMap<object, IssuedClaim>();
  private readonly completions = new WeakMap<object, IssuedCompletion>();

  constructor(
    source: DormantMainnetFinancialActionTwoQueueClaimSourcePort,
    clock: DormantMainnetFinancialActionSchedulerClock,
  ) {
    this.claimPreBroadcastMethod = captureMethod(source, 'claimPreBroadcast');
    this.claimReconciliationMethod = captureMethod(source, 'claimReconciliation');
    this.reviewPreBroadcastClaimMethod = captureMethod(source, 'reviewPreBroadcastClaim');
    this.reviewReconciliationClaimMethod = captureMethod(source, 'reviewReconciliationClaim');
    this.clockNowMethod = captureMethod(clock, 'now');
    if (
      stableMember(source, 'schedulerVersion') !==
      DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION
    )
      return fail('INVALID_CONFIGURATION');
    Object.freeze(this);
  }

  private now(): Timestamp {
    if (DATE_GET_TIME === undefined || DATE_TO_ISO === undefined)
      return fail('INVALID_CONFIGURATION');
    try {
      const value = Reflect.apply(this.clockNowMethod.method, this.clockNowMethod.receiver, []);
      if (typeof value !== 'object' || value === null || isProxy(value))
        return fail('INVALID_CONFIGURATION');
      const milliseconds = Reflect.apply(DATE_GET_TIME, value, []) as number;
      const text = Reflect.apply(DATE_TO_ISO, value, []) as string;
      if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== text)
        return fail('INVALID_CONFIGURATION');
      return Object.freeze({ text, milliseconds });
    } catch (error) {
      if (error instanceof DormantMainnetFinancialActionSchedulerUnavailableError) throw error;
      return fail('INVALID_CONFIGURATION');
    }
  }

  private async claim(
    queue: 'PRE_BROADCAST' | 'RECONCILIATION',
    request: ClaimDormantMainnetFinancialActionRequestV1,
  ): Promise<unknown> {
    const signal = validateClaimRequest(request, queue);
    const claimMethod =
      queue === 'PRE_BROADCAST' ? this.claimPreBroadcastMethod : this.claimReconciliationMethod;
    const reviewMethod =
      queue === 'PRE_BROADCAST'
        ? this.reviewPreBroadcastClaimMethod
        : this.reviewReconciliationClaimMethod;
    let sourceCapability: unknown;
    try {
      const sourceResult = Reflect.apply(claimMethod.method, claimMethod.receiver, [request]);
      sourceCapability = await nativePromiseResult(sourceResult);
    } catch {
      return fail('CLAIM_UNAVAILABLE');
    }
    if (aborted(signal)) return fail('INVALID_REQUEST');
    let reviewed: unknown;
    try {
      reviewed = Reflect.apply(reviewMethod.method, reviewMethod.receiver, [
        sourceCapability,
        request,
      ]);
    } catch {
      return fail('CLAIM_UNAVAILABLE');
    }
    if (reviewed === null) return fail('CLAIM_UNAVAILABLE');
    const view = sourceClaim(reviewed, queue, this.now());
    const capability: DormantMainnetFinancialActionClaimCapabilityV1 = Object.freeze({
      schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
      use: DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_CAPABILITY_USE,
      mayAuthorizeFinancialAction: false,
      mayConstructTransaction: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResubmitTransaction: false,
      ledgerSettlementAuthority: false,
      mayPersist: false,
    });
    this.claims.set(capability, {
      queue,
      request: new WeakRef(request),
      signal,
      view,
      claimedAtMilliseconds: Date.parse(view.claimedAt),
      leaseExpiresAtMilliseconds: Date.parse(view.leaseExpiresAt),
    });
    return capability;
  }

  claimPreBroadcast(
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): Promise<unknown> {
    return this.claim('PRE_BROADCAST', request);
  }

  claimReconciliation(
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown> {
    return this.claim('RECONCILIATION', request);
  }

  private reviewClaim(
    queue: 'PRE_BROADCAST' | 'RECONCILIATION',
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionRequestV1,
  ): DormantMainnetFinancialActionClaimViewV1 | null {
    if (typeof capability !== 'object' || capability === null || isProxy(capability)) return null;
    const issued = this.claims.get(capability);
    if (issued === undefined || issued.queue !== queue || issued.request.deref() !== request)
      return null;
    try {
      validateClaimRequest(request, queue);
      if (aborted(issued.signal) || this.now().milliseconds >= issued.leaseExpiresAtMilliseconds) {
        this.claims.delete(capability);
        return null;
      }
      return issued.view;
    } catch {
      return null;
    }
  }

  reviewPreBroadcastClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): DormantMainnetFinancialActionClaimViewV1 | null {
    return this.reviewClaim('PRE_BROADCAST', capability, request);
  }

  reviewReconciliationClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): DormantMainnetFinancialActionClaimViewV1 | null {
    return this.reviewClaim('RECONCILIATION', capability, request);
  }

  private async complete(
    queue: 'PRE_BROADCAST' | 'RECONCILIATION',
    request: CompleteDormantMainnetFinancialActionRequestV1,
  ): Promise<unknown> {
    const signal = validateCompletionRequest(request, queue);
    if (request.signal !== request.claimRequest.signal || signal !== request.signal)
      return fail('INVALID_REQUEST');
    if (
      typeof request.claimCapability !== 'object' ||
      request.claimCapability === null ||
      isProxy(request.claimCapability)
    )
      return fail('CLAIM_UNAVAILABLE');
    const issued = this.claims.get(request.claimCapability);
    if (issued === undefined) return fail('CLAIM_UNAVAILABLE');
    if (issued.queue !== queue) return fail('CROSS_QUEUE_CLAIM');
    if (issued.request.deref() !== request.claimRequest || issued.signal !== signal)
      return fail('CLAIM_UNAVAILABLE');
    const completedAt = this.now();
    if (completedAt.milliseconds < issued.claimedAtMilliseconds) {
      this.claims.delete(request.claimCapability);
      return fail('INVALID_CONFIGURATION');
    }
    if (completedAt.milliseconds >= issued.leaseExpiresAtMilliseconds) {
      this.claims.delete(request.claimCapability);
      return fail('CLAIM_EXPIRED');
    }
    this.claims.delete(request.claimCapability);
    const disposition = completionDisposition(
      queue,
      request.disposition,
      issued.view.attempt,
      issued.view.maximumAttempts,
    );
    const job = issued.view.job;
    const result: DormantMainnetFinancialActionCompletionResultV1 = Object.freeze({
      schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
      use: DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_RESULT_USE,
      mayAuthorizeFinancialAction: false,
      mayConstructTransaction: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResubmitTransaction: false,
      ledgerSettlementAuthority: false,
      mayPersist: false,
      queue,
      jobId: job.jobId,
      accountId: job.accountId,
      intentId: job.intentId,
      intentRecordFingerprintSha256: job.intentRecordFingerprintSha256,
      networkId: job.networkId,
      action: job.action,
      lifecycleRevision: job.lifecycleRevision,
      lifecycleSnapshotSha256: job.lifecycleSnapshotSha256,
      lifecycleStage: job.lifecycleStage,
      purpose: job.purpose,
      transactionId: job.transactionId,
      reconciliationOutcome: job.reconciliationOutcome,
      attempt: issued.view.attempt,
      maximumAttempts: issued.view.maximumAttempts,
      leaseId: issued.view.leaseId,
      fencingToken: issued.view.fencingToken,
      claimedAt: issued.view.claimedAt,
      leaseExpiresAt: issued.view.leaseExpiresAt,
      completedAt: completedAt.text,
      requestedDisposition: request.disposition,
      ...disposition,
    });
    const capability: DormantMainnetFinancialActionCompletionCapabilityV1 = Object.freeze({
      schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
      use: DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_CAPABILITY_USE,
      mayAuthorizeFinancialAction: false,
      mayConstructTransaction: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResubmitTransaction: false,
      ledgerSettlementAuthority: false,
      mayPersist: false,
    });
    this.completions.set(capability, { request: new WeakRef(request), signal, result });
    return capability;
  }

  completePreBroadcast(
    request: CompleteDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): Promise<unknown> {
    return this.complete('PRE_BROADCAST', request);
  }

  completeReconciliation(
    request: CompleteDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown> {
    return this.complete('RECONCILIATION', request);
  }

  reviewCompletion(
    capability: unknown,
    request: CompleteDormantMainnetFinancialActionRequestV1,
  ): DormantMainnetFinancialActionCompletionResultV1 | null {
    if (typeof capability !== 'object' || capability === null || isProxy(capability)) return null;
    const issued = this.completions.get(capability);
    if (issued === undefined) return null;
    this.completions.delete(capability);
    try {
      const queue = issued.result.queue;
      validateCompletionRequest(request, queue);
      if (
        issued.request.deref() !== request ||
        issued.signal !== request.signal ||
        aborted(issued.signal)
      )
        return null;
      return issued.result;
    } catch {
      return null;
    }
  }
}
