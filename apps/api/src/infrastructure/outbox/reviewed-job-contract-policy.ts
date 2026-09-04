import { parseBalanceSyncJobEnvelope } from '../../blockchain-sync/domain/balance-sync';
import { MAINNET_LAUNCH_NETWORK_IDS } from '../../blockchain/domain/mainnet-launch-network-policy';
import {
  LEDGER_IDEMPOTENCY_OPERATIONS,
  type LedgerIdempotencyOperation,
} from '../../ledger/domain/idempotency';
import {
  YIELD_OPERATION_TYPES,
  type YieldOperationType,
} from '../../yield-operations/domain/yield-operation';
import { isCanonicalUuidV4 } from '../logging';
import { parseJobEnvelope, type JobEnvelope } from './job-envelope';
import { parseJobMessageAttributes } from './job-message-policy';
import type { LedgerOutboxLink } from './job-publisher.port';

export const REVIEWED_JOB_CONTRACT_POLICY_VERSION = 1 as const;

export const REVIEWED_JOB_CONTRACTS = Object.freeze([
  Object.freeze({
    kind: 'ledger.journal-committed',
    version: 1,
    destination: 'jobs',
    payloadDataClass: 'INTERNAL_FINANCIAL_EVENT_IDENTIFIERS',
    payloadFields: Object.freeze(['journalId', 'operation']),
    messageAttributeFields: Object.freeze([]),
    retentionReview: 'OUTBOX_PUBLISHED_7_DAYS_FAILED_30_DAYS_PENDING_UNTIL_SETTLED',
  }),
  Object.freeze({
    kind: 'yield.operation.submit',
    version: 1,
    destination: 'jobs',
    payloadDataClass: 'INTERNAL_FINANCIAL_OPERATION_IDENTIFIERS',
    payloadFields: Object.freeze([
      'submissionId',
      'operationId',
      'operationType',
      'ledgerTransactionId',
      'planReferenceId',
      'quoteReferenceId',
    ]),
    messageAttributeFields: Object.freeze(['operationType']),
    retentionReview: 'OUTBOX_PUBLISHED_7_DAYS_FAILED_30_DAYS_PENDING_UNTIL_SETTLED',
  }),
  Object.freeze({
    kind: 'blockchain.balance-sync',
    version: 1,
    destination: 'jobs',
    payloadDataClass: 'RESTRICTED_PSEUDONYMOUS_ACCOUNT_AND_WALLET_IDENTIFIERS',
    payloadFields: Object.freeze([
      'schemaVersion',
      'accountId',
      'walletId',
      'networkId',
      'requiredTier',
      'cause',
      'attempt',
      'rescanFromPosition',
    ]),
    messageAttributeFields: Object.freeze([]),
    retentionReview: 'OUTBOX_PUBLISHED_7_DAYS_FAILED_30_DAYS_PENDING_UNTIL_SETTLED',
  }),
] as const);

export type ReviewedJobKind = (typeof REVIEWED_JOB_CONTRACTS)[number]['kind'];

export type ReviewedJobContractPolicyErrorCode =
  | 'UNREVIEWED_JOB_CONTRACT'
  | 'INVALID_REVIEWED_JOB_SHAPE'
  | 'INVALID_REVIEWED_JOB_DESTINATION'
  | 'INVALID_REVIEWED_JOB_PAYLOAD'
  | 'INVALID_REVIEWED_JOB_ATTRIBUTES'
  | 'INVALID_REVIEWED_JOB_LEDGER_LINK';

export class ReviewedJobContractPolicyError extends Error {
  constructor(readonly code: ReviewedJobContractPolicyErrorCode) {
    super(code);
    this.name = 'ReviewedJobContractPolicyError';
  }
}

interface ReviewedOutboxJob {
  readonly destination: unknown;
  readonly envelope: JobEnvelope;
  readonly messageAttributes: unknown;
  readonly ledgerLink?: LedgerOutboxLink;
}

function invalid(code: ReviewedJobContractPolicyErrorCode): never {
  throw new ReviewedJobContractPolicyError(code);
}

function reviewedOutboxJob(value: unknown): Readonly<{
  destination: unknown;
  envelope: unknown;
  messageAttributes: unknown;
  ledgerLink: unknown;
}> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return invalid('INVALID_REVIEWED_JOB_SHAPE');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid('INVALID_REVIEWED_JOB_SHAPE');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length < 3 ||
      keys.length > 4 ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !['destination', 'envelope', 'messageAttributes', 'ledgerLink'].includes(key),
      ) ||
      !Object.hasOwn(descriptors, 'destination') ||
      !Object.hasOwn(descriptors, 'envelope') ||
      !Object.hasOwn(descriptors, 'messageAttributes') ||
      Object.values(descriptors).some(
        (descriptor) => !('value' in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      return invalid('INVALID_REVIEWED_JOB_SHAPE');
    }
    return Object.freeze({
      destination: descriptors.destination?.value,
      envelope: descriptors.envelope?.value,
      messageAttributes: descriptors.messageAttributes?.value,
      ledgerLink: descriptors.ledgerLink?.value,
    });
  } catch (error) {
    if (error instanceof ReviewedJobContractPolicyError) throw error;
    return invalid('INVALID_REVIEWED_JOB_SHAPE');
  }
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof ReviewedJobContractPolicyError) throw error;
    return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
  }
}

function exactAttributes(
  value: unknown,
  expected: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  let attributes: Readonly<Record<string, string>>;
  try {
    attributes = parseJobMessageAttributes(value);
  } catch {
    return invalid('INVALID_REVIEWED_JOB_ATTRIBUTES');
  }
  const expectedEntries = Object.entries(expected);
  const actualEntries = Object.entries(attributes);
  if (
    actualEntries.length !== expectedEntries.length ||
    expectedEntries.some(([name, expectedValue]) => attributes[name] !== expectedValue)
  ) {
    return invalid('INVALID_REVIEWED_JOB_ATTRIBUTES');
  }
  return attributes;
}

function ledgerPayload(value: unknown): Readonly<{ journalId: string; operation: string }> {
  const record = exactDataRecord(value, ['journalId', 'operation']);
  if (
    !isCanonicalUuidV4(record.journalId) ||
    typeof record.operation !== 'string' ||
    !LEDGER_IDEMPOTENCY_OPERATIONS.includes(record.operation as LedgerIdempotencyOperation)
  ) {
    return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
  }
  return Object.freeze({ journalId: record.journalId, operation: record.operation });
}

function yieldPayload(value: unknown): Readonly<{
  submissionId: string;
  operationType: YieldOperationType;
  ledgerTransactionId: string;
  quoteReferenceId: string;
}> {
  const record = exactDataRecord(value, [
    'submissionId',
    'operationId',
    'operationType',
    'ledgerTransactionId',
    'planReferenceId',
    'quoteReferenceId',
  ]);
  for (const key of [
    'submissionId',
    'operationId',
    'ledgerTransactionId',
    'planReferenceId',
    'quoteReferenceId',
  ] as const) {
    if (!isCanonicalUuidV4(record[key])) return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
  }
  if (
    typeof record.operationType !== 'string' ||
    !YIELD_OPERATION_TYPES.includes(record.operationType as YieldOperationType)
  ) {
    return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
  }
  return Object.freeze({
    submissionId: record.submissionId as string,
    operationType: record.operationType as YieldOperationType,
    ledgerTransactionId: record.ledgerTransactionId as string,
    quoteReferenceId: record.quoteReferenceId as string,
  });
}

function ledgerLink(value: unknown, journalId: string): void {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return invalid('INVALID_REVIEWED_JOB_LEDGER_LINK');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid('INVALID_REVIEWED_JOB_LEDGER_LINK');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 2 ||
      keys.some((key) => key !== 'commandId' && key !== 'journalId') ||
      Object.values(descriptors).some(
        (descriptor) => !('value' in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      return invalid('INVALID_REVIEWED_JOB_LEDGER_LINK');
    }
    const commandId = descriptors.commandId;
    const linkedJournalId = descriptors.journalId;
    if (
      !commandId ||
      !('value' in commandId) ||
      !isCanonicalUuidV4(commandId.value) ||
      !linkedJournalId ||
      !('value' in linkedJournalId) ||
      linkedJournalId.value !== journalId
    ) {
      return invalid('INVALID_REVIEWED_JOB_LEDGER_LINK');
    }
  } catch (error) {
    if (error instanceof ReviewedJobContractPolicyError) throw error;
    return invalid('INVALID_REVIEWED_JOB_LEDGER_LINK');
  }
}

export function assertReviewedOutboxJob(value: ReviewedOutboxJob): void {
  const job = reviewedOutboxJob(value);
  if (job.destination !== 'jobs') return invalid('INVALID_REVIEWED_JOB_DESTINATION');
  let envelope: JobEnvelope;
  try {
    envelope = parseJobEnvelope(job.envelope);
  } catch {
    return invalid('UNREVIEWED_JOB_CONTRACT');
  }

  if (envelope.kind === 'ledger.journal-committed' && envelope.version === 1) {
    const payload = ledgerPayload(envelope.payload);
    if (envelope.correlation.ledgerEventId !== payload.journalId) {
      return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
    }
    exactAttributes(job.messageAttributes, {});
    ledgerLink(job.ledgerLink, payload.journalId);
    return;
  }

  if (envelope.kind === 'yield.operation.submit' && envelope.version === 1) {
    const payload = yieldPayload(envelope.payload);
    if (
      envelope.id !== payload.submissionId ||
      envelope.correlation.transactionId !== payload.ledgerTransactionId ||
      envelope.correlation.quoteId !== payload.quoteReferenceId
    ) {
      return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
    }
    exactAttributes(job.messageAttributes, { operationType: payload.operationType });
    if (job.ledgerLink !== undefined) invalid('INVALID_REVIEWED_JOB_LEDGER_LINK');
    return;
  }

  if (envelope.kind === 'blockchain.balance-sync' && envelope.version === 1) {
    try {
      const balanceSync = parseBalanceSyncJobEnvelope(envelope);
      if (!MAINNET_LAUNCH_NETWORK_IDS.includes(balanceSync.payload.networkId as never)) {
        return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
      }
    } catch {
      return invalid('INVALID_REVIEWED_JOB_PAYLOAD');
    }
    exactAttributes(job.messageAttributes, {});
    if (job.ledgerLink !== undefined) invalid('INVALID_REVIEWED_JOB_LEDGER_LINK');
    return;
  }

  return invalid('UNREVIEWED_JOB_CONTRACT');
}
