import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../infrastructure/database/postgres.service';
import type { LedgerRepository } from '../application/ledger.repository.port';
import {
  revealLedgerCapability,
  type LedgerPostingCapability,
  type LedgerReversalCapability,
} from '../application/ledger-capability-resolver.port';
import {
  normalizePostLedgerJournalCommand,
  normalizeReverseLedgerJournalCommand,
  parseLedgerJournalId,
  type LedgerJournalId,
  type LedgerPosting,
  type PostLedgerJournalCommand,
  type ReverseLedgerJournalCommand,
} from '../domain/ledger';
import {
  LedgerLifecycleValidationError,
  normalizeLedgerLifecycleTransitionCommand,
  normalizeLedgerRecoveryTransitionCommand,
  type LedgerLifecycleTransitionCommand,
  type LedgerRecoveryTransitionCommand,
} from '../domain/transaction-lifecycle';

const MAX_SERIALIZED_POSTINGS_BYTES = 32_768;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ILLEGAL_LIFECYCLE_SQL_STATE = 'L4201';

interface JournalIdRow extends QueryResultRow {
  journal_id: string;
}

interface LifecycleEventIdRow extends QueryResultRow {
  event_id: string;
}

export class LedgerPersistenceError extends Error {
  readonly code = 'LEDGER_PERSISTENCE_FAILED' as const;

  constructor() {
    super('Ledger persistence operation failed');
    this.name = 'LedgerPersistenceError';
  }
}

function serializeProjectedPostings(postings: readonly LedgerPosting[]): string {
  const serialized = `[${postings
    .map(
      (posting) =>
        `{"accountId":"${posting.accountId}","assetRevisionId":"${posting.assetRevisionId}","side":"${posting.side}","amountAtomic":"${posting.amountAtomic}"}`,
    )
    .join(',')}]`;
  const serializedBytes = Buffer.byteLength(serialized, 'utf8');
  if (serializedBytes < 2 || serializedBytes > MAX_SERIALIZED_POSTINGS_BYTES) {
    throw new LedgerPersistenceError();
  }
  return serialized;
}

function returnedJournalId(rows: readonly JournalIdRow[]): LedgerJournalId {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new LedgerPersistenceError();
  }
  const row: unknown = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new LedgerPersistenceError();
  }
  const prototype = Object.getPrototypeOf(row);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LedgerPersistenceError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(row);
  const keys = Reflect.ownKeys(descriptors);
  const journalIdDescriptor = descriptors.journal_id;
  if (
    keys.length !== 1 ||
    keys[0] !== 'journal_id' ||
    !journalIdDescriptor ||
    !('value' in journalIdDescriptor) ||
    journalIdDescriptor.enumerable !== true
  ) {
    throw new LedgerPersistenceError();
  }
  return parseLedgerJournalId(journalIdDescriptor.value);
}

function assertReturnedLifecycleEvent(rows: readonly LifecycleEventIdRow[]): void {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new LedgerPersistenceError();
  }
  const row: unknown = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new LedgerPersistenceError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(row);
  const keys = Reflect.ownKeys(descriptors);
  const eventIdDescriptor = descriptors.event_id;
  if (
    keys.length !== 1 ||
    keys[0] !== 'event_id' ||
    !eventIdDescriptor ||
    !('value' in eventIdDescriptor) ||
    eventIdDescriptor.enumerable !== true ||
    typeof eventIdDescriptor.value !== 'string' ||
    !UUID_V4_PATTERN.test(eventIdDescriptor.value)
  ) {
    throw new LedgerPersistenceError();
  }
}

function postgresErrorCode(value: unknown): string | undefined {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'code');
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function persistenceError(error: unknown): never {
  if (postgresErrorCode(error) === ILLEGAL_LIFECYCLE_SQL_STATE) {
    throw new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION');
  }
  throw new LedgerPersistenceError();
}

@Injectable()
export class PostgresLedgerRepository implements LedgerRepository {
  constructor(private readonly postgres: PostgresService) {}

  async postJournal(
    command: PostLedgerJournalCommand,
    capability: LedgerPostingCapability,
  ): Promise<LedgerJournalId> {
    try {
      const normalized = normalizePostLedgerJournalCommand(command);
      const capabilityValue = revealLedgerCapability(capability, 'POST');
      const serializedPostings = serializeProjectedPostings(normalized.postings);
      const result = await this.postgres.query<JournalIdRow>(
        `SELECT public.post_ledger_journal_with_lifecycle(
           $1::text,
           $2::uuid,
           $3::uuid,
           $4::uuid,
           $5::text,
           $6::timestamptz,
           $7::timestamptz,
           $8::text,
           $9::uuid,
           $10::text
         ) AS journal_id`,
        [
          capabilityValue,
          normalized.bookId,
          normalized.transactionId,
          normalized.legId,
          normalized.economicEventType,
          normalized.effectiveAt,
          normalized.observedAt,
          normalized.reason,
          normalized.correlationId,
          serializedPostings,
        ],
      );
      return returnedJournalId(result.rows);
    } catch {
      throw new LedgerPersistenceError();
    }
  }

  async reverseJournal(
    command: ReverseLedgerJournalCommand,
    capability: LedgerReversalCapability,
  ): Promise<LedgerJournalId> {
    try {
      const normalized = normalizeReverseLedgerJournalCommand(command);
      const capabilityValue = revealLedgerCapability(capability, 'REVERSE');
      const result = await this.postgres.query<JournalIdRow>(
        `SELECT public.reverse_ledger_journal_with_lifecycle(
           $1::text,
           $2::uuid,
           $3::text,
           $4::timestamptz,
           $5::timestamptz,
           $6::uuid
         ) AS journal_id`,
        [
          capabilityValue,
          normalized.originalJournalId,
          normalized.reason,
          normalized.effectiveAt,
          normalized.observedAt,
          normalized.correlationId,
        ],
      );
      return returnedJournalId(result.rows);
    } catch {
      throw new LedgerPersistenceError();
    }
  }

  async transitionLifecycle(command: LedgerLifecycleTransitionCommand): Promise<void> {
    try {
      const normalized = normalizeLedgerLifecycleTransitionCommand(command);
      const result =
        normalized.legId === null
          ? await this.postgres.query<LifecycleEventIdRow>(
              `SELECT public.transition_ledger_transaction_state(
                 $1::uuid, $2::uuid, $3::text, $4::text,
                 $5::text, $6::timestamptz, $7::uuid
               ) AS event_id`,
              [
                normalized.actorAccountId,
                normalized.transactionId,
                normalized.expectedState,
                normalized.nextState,
                normalized.reason,
                normalized.effectiveAt,
                normalized.correlationId,
              ],
            )
          : await this.postgres.query<LifecycleEventIdRow>(
              `SELECT public.transition_ledger_leg_state(
                 $1::uuid, $2::uuid, $3::uuid, $4::text,
                 $5::text, $6::text, $7::timestamptz, $8::uuid
               ) AS event_id`,
              [
                normalized.actorAccountId,
                normalized.transactionId,
                normalized.legId,
                normalized.expectedState,
                normalized.nextState,
                normalized.reason,
                normalized.effectiveAt,
                normalized.correlationId,
              ],
            );
      assertReturnedLifecycleEvent(result.rows);
    } catch (error) {
      persistenceError(error);
    }
  }

  async transitionRecovery(command: LedgerRecoveryTransitionCommand): Promise<void> {
    try {
      const normalized = normalizeLedgerRecoveryTransitionCommand(command);
      const result = await this.postgres.query<LifecycleEventIdRow>(
        `SELECT public.transition_ledger_recovery_state(
           $1::uuid, $2::uuid, $3::uuid, $4::text,
           $5::text, $6::text, $7::timestamptz, $8::uuid
         ) AS event_id`,
        [
          normalized.actorAccountId,
          normalized.transactionId,
          normalized.legId,
          normalized.expectedRecoveryState,
          normalized.nextRecoveryState,
          normalized.reason,
          normalized.effectiveAt,
          normalized.correlationId,
        ],
      );
      assertReturnedLifecycleEvent(result.rows);
    } catch (error) {
      persistenceError(error);
    }
  }
}
