import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../infrastructure/database/postgres.service';
import { loggingContext } from '../../infrastructure/logging';
import {
  JOB_PUBLISHER,
  type JobPublisherPort,
} from '../../infrastructure/outbox/job-publisher.port';
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
  LedgerIdempotencyError,
  normalizeLedgerIdempotencyContext,
  type LedgerIdempotencyContext,
  type LedgerIdempotencyOperation,
} from '../domain/idempotency';
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
const IDEMPOTENCY_CONFLICT_SQL_STATE = 'L4301';

interface JournalIdRow extends QueryResultRow {
  journal_id: string;
}

interface LifecycleEventIdRow extends QueryResultRow {
  event_id: string;
}

interface IdempotencyClaimRow extends QueryResultRow {
  command_id: string;
  journal_id: string | null;
  outbox_id: string;
  outcome: 'CLAIMED' | 'REPLAYED';
}

interface IdempotencyClaim {
  readonly commandId: string;
  readonly journalId: LedgerJournalId | null;
  readonly outboxId: string;
  readonly outcome: 'CLAIMED' | 'REPLAYED';
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

function optionalJournalId(rows: readonly JournalIdRow[]): LedgerJournalId | null {
  if (!Array.isArray(rows) || rows.length > 1) {
    throw new LedgerPersistenceError();
  }
  return rows.length === 0 ? null : returnedJournalId(rows);
}

function returnedIdempotencyClaim(rows: readonly IdempotencyClaimRow[]): IdempotencyClaim {
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
  const expectedKeys = new Set(['command_id', 'journal_id', 'outbox_id', 'outcome']);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
  ) {
    throw new LedgerPersistenceError();
  }
  const read = (key: string): unknown => {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new LedgerPersistenceError();
    }
    return descriptor.value;
  };
  const commandId = read('command_id');
  const journalId = read('journal_id');
  const outboxId = read('outbox_id');
  const outcome = read('outcome');
  if (
    typeof commandId !== 'string' ||
    !UUID_V4_PATTERN.test(commandId) ||
    typeof outboxId !== 'string' ||
    !UUID_V4_PATTERN.test(outboxId) ||
    (outcome !== 'CLAIMED' && outcome !== 'REPLAYED') ||
    (outcome === 'CLAIMED' && journalId !== null) ||
    (outcome === 'REPLAYED' && typeof journalId !== 'string')
  ) {
    throw new LedgerPersistenceError();
  }
  return Object.freeze({
    commandId,
    journalId: journalId === null ? null : parseLedgerJournalId(journalId),
    outboxId,
    outcome,
  });
}

function idempotencyValues(context: LedgerIdempotencyContext): readonly unknown[] {
  return [
    context.actorAccountId,
    context.operation,
    context.contractVersion,
    context.keyDigest,
    context.fingerprintVersion,
    context.requestFingerprint,
  ];
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
  if (postgresErrorCode(error) === IDEMPOTENCY_CONFLICT_SQL_STATE) {
    throw new LedgerIdempotencyError('IDEMPOTENCY_CONFLICT');
  }
  throw new LedgerPersistenceError();
}

@Injectable()
export class PostgresLedgerRepository implements LedgerRepository {
  constructor(
    private readonly postgres: PostgresService,
    @Inject(JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
  ) {}

  async resolveIdempotency(context: LedgerIdempotencyContext): Promise<LedgerJournalId | null> {
    try {
      const normalized = normalizeLedgerIdempotencyContext(context);
      const result = await this.postgres.query<JournalIdRow>(
        `SELECT resolved.journal_id
         FROM public.resolve_ledger_command_idempotency(
           $1::uuid, $2::text, $3::smallint,
           $4::text, $5::smallint, $6::text
         ) AS resolved`,
        [...idempotencyValues(normalized)],
      );
      return optionalJournalId(result.rows);
    } catch (error) {
      persistenceError(error);
    }
  }

  async postJournal(
    command: PostLedgerJournalCommand,
    capability: LedgerPostingCapability,
    idempotency: LedgerIdempotencyContext,
  ): Promise<LedgerJournalId> {
    try {
      const normalized = normalizePostLedgerJournalCommand(command);
      const normalizedIdempotency = normalizeLedgerIdempotencyContext(idempotency);
      if (normalizedIdempotency.operation !== 'POST_JOURNAL') {
        throw new LedgerPersistenceError();
      }
      const serializedPostings = serializeProjectedPostings(normalized.postings);
      return await this.postgres.withTransaction(async () => {
        const claim = await this.claimIdempotency(normalizedIdempotency);
        if (claim.outcome === 'REPLAYED') {
          if (claim.journalId === null) throw new LedgerPersistenceError();
          return claim.journalId;
        }

        const capabilityValue = revealLedgerCapability(capability, 'POST');
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
        const journalId = returnedJournalId(result.rows);
        await this.publishAndComplete(
          claim,
          journalId,
          normalizedIdempotency.operation,
          normalized.correlationId,
          normalizedIdempotency.actorAccountId,
        );
        return journalId;
      });
    } catch (error) {
      persistenceError(error);
    }
  }

  async reverseJournal(
    command: ReverseLedgerJournalCommand,
    capability: LedgerReversalCapability,
    idempotency: LedgerIdempotencyContext,
  ): Promise<LedgerJournalId> {
    try {
      const normalized = normalizeReverseLedgerJournalCommand(command);
      const normalizedIdempotency = normalizeLedgerIdempotencyContext(idempotency);
      if (normalizedIdempotency.operation !== 'REVERSE_JOURNAL') {
        throw new LedgerPersistenceError();
      }
      return await this.postgres.withTransaction(async () => {
        const claim = await this.claimIdempotency(normalizedIdempotency);
        if (claim.outcome === 'REPLAYED') {
          if (claim.journalId === null) throw new LedgerPersistenceError();
          return claim.journalId;
        }

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
        const journalId = returnedJournalId(result.rows);
        await this.publishAndComplete(
          claim,
          journalId,
          normalizedIdempotency.operation,
          normalized.correlationId,
          normalizedIdempotency.actorAccountId,
        );
        return journalId;
      });
    } catch (error) {
      persistenceError(error);
    }
  }

  private async claimIdempotency(context: LedgerIdempotencyContext): Promise<IdempotencyClaim> {
    const result = await this.postgres.query<IdempotencyClaimRow>(
      `SELECT claimed.command_id,
              claimed.journal_id,
              claimed.outbox_id,
              claimed.outcome
       FROM public.claim_ledger_command_idempotency(
         $1::uuid, $2::text, $3::smallint,
         $4::text, $5::smallint, $6::text
       ) AS claimed`,
      [...idempotencyValues(context)],
    );
    return returnedIdempotencyClaim(result.rows);
  }

  private async publishAndComplete(
    claim: IdempotencyClaim,
    journalId: LedgerJournalId,
    operation: LedgerIdempotencyOperation,
    correlationId: string,
    actorAccountId: string,
  ): Promise<void> {
    if (claim.outcome !== 'CLAIMED' || claim.journalId !== null) {
      throw new LedgerPersistenceError();
    }
    const activeContext = loggingContext.current();
    if (
      activeContext &&
      (activeContext.correlationId !== correlationId ||
        (activeContext.initiatorActorId !== undefined &&
          activeContext.initiatorActorId !== actorAccountId))
    ) {
      throw new LedgerPersistenceError();
    }
    const enqueue = (): ReturnType<JobPublisherPort['enqueue']> =>
      this.publisher.enqueue({
        id: claim.outboxId,
        kind: 'ledger.journal-committed',
        version: 1,
        payload: Object.freeze({ journalId, operation }),
        ledgerLink: Object.freeze({ commandId: claim.commandId, journalId }),
      });
    const envelope = await (activeContext
      ? loggingContext.runWith(
          Object.freeze({ initiatorActorId: actorAccountId, ledgerEventId: journalId }),
          enqueue,
        )
      : loggingContext.run(
          Object.freeze({
            correlationId,
            initiatorActorId: actorAccountId,
            ledgerEventId: journalId,
          }),
          enqueue,
        ));
    if (envelope.id !== claim.outboxId) throw new LedgerPersistenceError();

    const completed = await this.postgres.query<JournalIdRow>(
      `SELECT public.complete_ledger_command_idempotency(
         $1::uuid, $2::uuid, $3::uuid
       ) AS journal_id`,
      [claim.commandId, journalId, claim.outboxId],
    );
    if (returnedJournalId(completed.rows) !== journalId) {
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
