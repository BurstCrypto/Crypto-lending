const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ATOMIC_AMOUNT_PATTERN = /^[1-9][0-9]{0,77}$/u;
export const MAX_LEDGER_POSTINGS = 64;
export const MAX_ATOMIC_AMOUNT =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export const POSTABLE_ECONOMIC_EVENT_TYPES = Object.freeze([
  'SETTLEMENT',
  'ACTUAL_FEE',
  'ADJUSTMENT',
  'COMPENSATION',
] as const);

export const POST_LEDGER_REASON_CODES = Object.freeze([
  'CHAIN_FINALITY_CONFIRMED',
  'PROVIDER_SETTLEMENT_VERIFIED',
  'ACTUAL_FEE_CONFIRMED',
  'ACCOUNTING_ADJUSTMENT_APPROVED',
  'COMPENSATION_SETTLED',
] as const);

export const REVERSAL_LEDGER_REASON_CODES = Object.freeze([
  'RECOGNITION_INVALIDATED',
  'CHAIN_REORGANIZATION_CONFIRMED',
  'SOURCE_EVIDENCE_CORRECTED',
] as const);

declare const ledgerBookIdBrand: unique symbol;
declare const ledgerAssetRevisionIdBrand: unique symbol;
declare const ledgerAccountIdBrand: unique symbol;
declare const ledgerTransactionIdBrand: unique symbol;
declare const ledgerLegIdBrand: unique symbol;
declare const ledgerJournalIdBrand: unique symbol;
declare const ledgerCorrelationIdBrand: unique symbol;
declare const atomicAmountBrand: unique symbol;
declare const ledgerTimestampBrand: unique symbol;
declare const ledgerApprovalReferenceIdBrand: unique symbol;
declare const ledgerActorAccountIdBrand: unique symbol;

export type LedgerBookId = string & { readonly [ledgerBookIdBrand]: 'LedgerBookId' };
export type LedgerAssetRevisionId = string & {
  readonly [ledgerAssetRevisionIdBrand]: 'LedgerAssetRevisionId';
};
export type LedgerAccountId = string & { readonly [ledgerAccountIdBrand]: 'LedgerAccountId' };
export type LedgerTransactionId = string & {
  readonly [ledgerTransactionIdBrand]: 'LedgerTransactionId';
};
export type LedgerLegId = string & { readonly [ledgerLegIdBrand]: 'LedgerLegId' };
export type LedgerJournalId = string & { readonly [ledgerJournalIdBrand]: 'LedgerJournalId' };
export type LedgerCorrelationId = string & {
  readonly [ledgerCorrelationIdBrand]: 'LedgerCorrelationId';
};
export type EconomicEventType = (typeof POSTABLE_ECONOMIC_EVENT_TYPES)[number];
export type PostLedgerReasonCode = (typeof POST_LEDGER_REASON_CODES)[number];
export type ReversalLedgerReasonCode = (typeof REVERSAL_LEDGER_REASON_CODES)[number];
export type AtomicAmount = string & { readonly [atomicAmountBrand]: 'AtomicAmount' };
export type LedgerTimestamp = string & { readonly [ledgerTimestampBrand]: 'LedgerTimestamp' };
export type LedgerApprovalReferenceId = string & {
  readonly [ledgerApprovalReferenceIdBrand]: 'LedgerApprovalReferenceId';
};
export type LedgerActorAccountId = string & {
  readonly [ledgerActorAccountIdBrand]: 'LedgerActorAccountId';
};
export type LedgerPostingSide = 'DEBIT' | 'CREDIT';

export type LedgerValidationCode =
  | 'INVALID_LEDGER_ID'
  | 'INVALID_ATOMIC_AMOUNT'
  | 'INVALID_ECONOMIC_EVENT_TYPE'
  | 'INVALID_REASON'
  | 'INVALID_APPROVAL_REFERENCE'
  | 'INVALID_LEDGER_TIMESTAMP'
  | 'INVALID_LEDGER_POSTING'
  | 'INVALID_LEDGER_JOURNAL'
  | 'UNBALANCED_LEDGER_JOURNAL';

export class LedgerValidationError extends Error {
  constructor(readonly code: LedgerValidationCode) {
    super(code);
    this.name = 'LedgerValidationError';
  }
}

export interface LedgerPosting {
  readonly accountId: LedgerAccountId;
  readonly assetRevisionId: LedgerAssetRevisionId;
  readonly side: LedgerPostingSide;
  readonly amountAtomic: AtomicAmount;
}

export interface PostLedgerJournalInput {
  readonly bookId: string;
  readonly transactionId: string;
  readonly legId: string;
  readonly economicEventType: string;
  readonly effectiveAt: Date;
  readonly observedAt: Date;
  readonly reason: string;
  readonly postings: readonly {
    readonly accountId: string;
    readonly assetRevisionId: string;
    readonly side: LedgerPostingSide;
    readonly amountAtomic: string;
  }[];
}

export interface ValidatedPostLedgerJournal {
  readonly bookId: LedgerBookId;
  readonly transactionId: LedgerTransactionId;
  readonly legId: LedgerLegId;
  readonly economicEventType: EconomicEventType;
  readonly effectiveAt: LedgerTimestamp;
  readonly observedAt: LedgerTimestamp;
  readonly reason: PostLedgerReasonCode;
  readonly postings: readonly LedgerPosting[];
}

export interface ReverseLedgerJournalInput {
  readonly originalJournalId: string;
  readonly reason: string;
  readonly approvalReference: string;
  readonly effectiveAt: Date;
  readonly observedAt: Date;
}

export interface ValidatedReverseLedgerJournal {
  readonly originalJournalId: LedgerJournalId;
  readonly reason: ReversalLedgerReasonCode;
  readonly approvalReference: LedgerApprovalReferenceId;
  readonly effectiveAt: LedgerTimestamp;
  readonly observedAt: LedgerTimestamp;
}

export interface PostLedgerJournalCommand extends ValidatedPostLedgerJournal {
  readonly actorAccountId: LedgerActorAccountId;
  readonly journalId: LedgerJournalId;
  readonly correlationId: LedgerCorrelationId;
}

export interface ReverseLedgerJournalCommand extends ValidatedReverseLedgerJournal {
  readonly actorAccountId: LedgerActorAccountId;
  readonly reversalJournalId: LedgerJournalId;
  readonly correlationId: LedgerCorrelationId;
}

type PlainRecord = Readonly<Record<string, unknown>>;

function validationError(code: LedgerValidationCode): never {
  throw new LedgerValidationError(code);
}

function ownDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: LedgerValidationCode,
): PlainRecord {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return validationError(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return validationError(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return validationError(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return validationError(code);
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return validationError(code);
  }
}

function ownDataArray(value: unknown): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return validationError('INVALID_LEDGER_JOURNAL');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (!lengthDescriptor || !('value' in lengthDescriptor)) {
      return validationError('INVALID_LEDGER_JOURNAL');
    }
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 2 ||
      length > MAX_LEDGER_POSTINGS
    ) {
      return validationError('INVALID_LEDGER_JOURNAL');
    }
    const allowedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== allowedKeys.size ||
      keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))
    ) {
      return validationError('INVALID_LEDGER_JOURNAL');
    }
    const copy: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return validationError('INVALID_LEDGER_JOURNAL');
      }
      copy.push(descriptor.value);
    }
    return copy;
  } catch {
    return validationError('INVALID_LEDGER_JOURNAL');
  }
}

function parseUuid<T extends string>(value: unknown): T {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return validationError('INVALID_LEDGER_ID');
  }
  return value as T;
}

export function parseLedgerBookId(value: unknown): LedgerBookId {
  return parseUuid<LedgerBookId>(value);
}

export function parseLedgerAssetRevisionId(value: unknown): LedgerAssetRevisionId {
  return parseUuid<LedgerAssetRevisionId>(value);
}

export function parseLedgerAccountId(value: unknown): LedgerAccountId {
  return parseUuid<LedgerAccountId>(value);
}

export function parseLedgerTransactionId(value: unknown): LedgerTransactionId {
  return parseUuid<LedgerTransactionId>(value);
}

export function parseLedgerLegId(value: unknown): LedgerLegId {
  return parseUuid<LedgerLegId>(value);
}

export function parseLedgerJournalId(value: unknown): LedgerJournalId {
  return parseUuid<LedgerJournalId>(value);
}

export function parseLedgerCorrelationId(value: unknown): LedgerCorrelationId {
  return parseUuid<LedgerCorrelationId>(value);
}

export function parseLedgerActorAccountId(value: unknown): LedgerActorAccountId {
  return parseUuid<LedgerActorAccountId>(value);
}

export function parseAtomicAmount(value: unknown): AtomicAmount {
  if (
    typeof value !== 'string' ||
    !ATOMIC_AMOUNT_PATTERN.test(value) ||
    value.length > MAX_ATOMIC_AMOUNT.length ||
    (value.length === MAX_ATOMIC_AMOUNT.length && value > MAX_ATOMIC_AMOUNT)
  ) {
    return validationError('INVALID_ATOMIC_AMOUNT');
  }
  return value as AtomicAmount;
}

export function parseEconomicEventType(value: unknown): EconomicEventType {
  if (
    typeof value !== 'string' ||
    !POSTABLE_ECONOMIC_EVENT_TYPES.includes(value as EconomicEventType)
  ) {
    return validationError('INVALID_ECONOMIC_EVENT_TYPE');
  }
  return value as EconomicEventType;
}

function parsePostLedgerReason(value: unknown): PostLedgerReasonCode {
  if (
    typeof value !== 'string' ||
    !POST_LEDGER_REASON_CODES.includes(value as PostLedgerReasonCode)
  ) {
    return validationError('INVALID_REASON');
  }
  return value as PostLedgerReasonCode;
}

function parseReversalLedgerReason(value: unknown): ReversalLedgerReasonCode {
  if (
    typeof value !== 'string' ||
    !REVERSAL_LEDGER_REASON_CODES.includes(value as ReversalLedgerReasonCode)
  ) {
    return validationError('INVALID_REASON');
  }
  return value as ReversalLedgerReasonCode;
}

export function parseApprovalReference(value: unknown): LedgerApprovalReferenceId {
  try {
    return parseUuid<LedgerApprovalReferenceId>(value);
  } catch {
    return validationError('INVALID_APPROVAL_REFERENCE');
  }
}

function parseLedgerTimestamp(value: unknown): LedgerTimestamp {
  try {
    if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
      return validationError('INVALID_LEDGER_TIMESTAMP');
    }
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) {
      return validationError('INVALID_LEDGER_TIMESTAMP');
    }
    return new Date(milliseconds).toISOString() as LedgerTimestamp;
  } catch {
    return validationError('INVALID_LEDGER_TIMESTAMP');
  }
}

function parsePosting(value: unknown): LedgerPosting {
  const record = ownDataRecord(
    value,
    ['accountId', 'assetRevisionId', 'side', 'amountAtomic'],
    'INVALID_LEDGER_POSTING',
  );
  const side = record.side;
  if (side !== 'DEBIT' && side !== 'CREDIT') {
    return validationError('INVALID_LEDGER_POSTING');
  }
  return Object.freeze({
    accountId: parseLedgerAccountId(record.accountId),
    assetRevisionId: parseLedgerAssetRevisionId(record.assetRevisionId),
    side,
    amountAtomic: parseAtomicAmount(record.amountAtomic),
  });
}

function parseAndBalancePostings(value: unknown): readonly LedgerPosting[] {
  const values = ownDataArray(value);
  const postings = values.map(parsePosting);
  const accountIds = new Set<LedgerAccountId>();
  const balances = new Map<LedgerAssetRevisionId, { debit: bigint; credit: bigint }>();

  for (const posting of postings) {
    accountIds.add(posting.accountId);
    const balance = balances.get(posting.assetRevisionId) ?? { debit: 0n, credit: 0n };
    balance[posting.side === 'DEBIT' ? 'debit' : 'credit'] += BigInt(posting.amountAtomic);
    balances.set(posting.assetRevisionId, balance);
  }

  if (
    accountIds.size < 2 ||
    [...balances.values()].some(({ debit, credit }) => debit === 0n || debit !== credit)
  ) {
    return validationError('UNBALANCED_LEDGER_JOURNAL');
  }
  return Object.freeze(postings);
}

export function normalizePostLedgerJournalInput(value: unknown): ValidatedPostLedgerJournal {
  const record = ownDataRecord(
    value,
    [
      'bookId',
      'transactionId',
      'legId',
      'economicEventType',
      'effectiveAt',
      'observedAt',
      'reason',
      'postings',
    ],
    'INVALID_LEDGER_JOURNAL',
  );
  const effectiveAt = parseLedgerTimestamp(record.effectiveAt);
  const observedAt = parseLedgerTimestamp(record.observedAt);
  if (observedAt < effectiveAt) {
    return validationError('INVALID_LEDGER_TIMESTAMP');
  }

  const economicEventType = parseEconomicEventType(record.economicEventType);
  const reason = parsePostLedgerReason(record.reason);
  const validReasonForEvent =
    (economicEventType === 'SETTLEMENT' &&
      (reason === 'CHAIN_FINALITY_CONFIRMED' || reason === 'PROVIDER_SETTLEMENT_VERIFIED')) ||
    (economicEventType === 'ACTUAL_FEE' && reason === 'ACTUAL_FEE_CONFIRMED') ||
    (economicEventType === 'ADJUSTMENT' && reason === 'ACCOUNTING_ADJUSTMENT_APPROVED') ||
    (economicEventType === 'COMPENSATION' && reason === 'COMPENSATION_SETTLED');
  if (!validReasonForEvent) {
    return validationError('INVALID_REASON');
  }

  return Object.freeze({
    bookId: parseLedgerBookId(record.bookId),
    transactionId: parseLedgerTransactionId(record.transactionId),
    legId: parseLedgerLegId(record.legId),
    economicEventType,
    effectiveAt,
    observedAt,
    reason,
    postings: parseAndBalancePostings(record.postings),
  });
}

export function normalizeReverseLedgerJournalInput(value: unknown): ValidatedReverseLedgerJournal {
  const record = ownDataRecord(
    value,
    ['originalJournalId', 'reason', 'approvalReference', 'effectiveAt', 'observedAt'],
    'INVALID_LEDGER_JOURNAL',
  );
  const effectiveAt = parseLedgerTimestamp(record.effectiveAt);
  const observedAt = parseLedgerTimestamp(record.observedAt);
  if (observedAt < effectiveAt) {
    return validationError('INVALID_LEDGER_TIMESTAMP');
  }
  return Object.freeze({
    originalJournalId: parseLedgerJournalId(record.originalJournalId),
    reason: parseReversalLedgerReason(record.reason),
    approvalReference: parseApprovalReference(record.approvalReference),
    effectiveAt,
    observedAt,
  });
}

export function normalizePostLedgerJournalCommand(value: unknown): PostLedgerJournalCommand {
  const record = ownDataRecord(
    value,
    [
      'actorAccountId',
      'journalId',
      'correlationId',
      'bookId',
      'transactionId',
      'legId',
      'economicEventType',
      'effectiveAt',
      'observedAt',
      'reason',
      'postings',
    ],
    'INVALID_LEDGER_JOURNAL',
  );
  const journal = normalizePostLedgerJournalInput({
    bookId: record.bookId,
    transactionId: record.transactionId,
    legId: record.legId,
    economicEventType: record.economicEventType,
    effectiveAt: timestampInput(record.effectiveAt),
    observedAt: timestampInput(record.observedAt),
    reason: record.reason,
    postings: record.postings,
  });
  return Object.freeze({
    actorAccountId: parseLedgerActorAccountId(record.actorAccountId),
    journalId: parseLedgerJournalId(record.journalId),
    correlationId: parseLedgerCorrelationId(record.correlationId),
    ...journal,
  });
}

export function normalizeReverseLedgerJournalCommand(value: unknown): ReverseLedgerJournalCommand {
  const record = ownDataRecord(
    value,
    [
      'actorAccountId',
      'reversalJournalId',
      'correlationId',
      'originalJournalId',
      'reason',
      'approvalReference',
      'effectiveAt',
      'observedAt',
    ],
    'INVALID_LEDGER_JOURNAL',
  );
  const reversal = normalizeReverseLedgerJournalInput({
    originalJournalId: record.originalJournalId,
    reason: record.reason,
    approvalReference: record.approvalReference,
    effectiveAt: timestampInput(record.effectiveAt),
    observedAt: timestampInput(record.observedAt),
  });
  const reversalJournalId = parseLedgerJournalId(record.reversalJournalId);
  if (reversalJournalId === reversal.originalJournalId) {
    return validationError('INVALID_LEDGER_JOURNAL');
  }
  return Object.freeze({
    actorAccountId: parseLedgerActorAccountId(record.actorAccountId),
    reversalJournalId,
    correlationId: parseLedgerCorrelationId(record.correlationId),
    ...reversal,
  });
}

function timestampInput(value: unknown): Date {
  if (typeof value !== 'string') {
    return validationError('INVALID_LEDGER_TIMESTAMP');
  }
  try {
    const timestamp = new Date(value);
    if (timestamp.toISOString() !== value) {
      return validationError('INVALID_LEDGER_TIMESTAMP');
    }
    return timestamp;
  } catch {
    return validationError('INVALID_LEDGER_TIMESTAMP');
  }
}
