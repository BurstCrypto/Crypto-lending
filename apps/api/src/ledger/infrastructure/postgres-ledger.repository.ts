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

const MAX_SERIALIZED_POSTINGS_BYTES = 32_768;

interface JournalIdRow extends QueryResultRow {
  journal_id: string;
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
        `SELECT public.post_ledger_journal(
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
        `SELECT public.reverse_ledger_journal(
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
}
