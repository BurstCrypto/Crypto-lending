import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../database/postgres.service';
import { isCanonicalUuidV4 } from '../logging';
import { parseJobEnvelope, type JobEnvelope } from './job-envelope';
import { serializeJobMessage } from './job-message-policy';
import type { JobDestination, LedgerOutboxLink } from './job-publisher.port';
import {
  assertReviewedOutboxJob,
  ReviewedJobContractPolicyError,
} from './reviewed-job-contract-policy';

export interface NewOutboxJob {
  destination: JobDestination;
  envelope: JobEnvelope;
  messageAttributes: Readonly<Record<string, string>>;
  ledgerLink?: LedgerOutboxLink;
}

export interface ClaimOutboxJobsOptions {
  dispatcherId: string;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
}

export interface ClaimedOutboxJob {
  id: string;
  destination: string;
  envelope: JobEnvelope;
  messageAttributes: Readonly<Record<string, string>>;
  ledgerLink?: LedgerOutboxLink;
  attempts: number;
}

export interface RecordOutboxFailureOptions {
  terminal: boolean;
  retryDelayMs: number;
}

export type OutboxFailureCode = 'OUTBOX_TRANSPORT_FAILED' | 'OUTBOX_TRANSPORT_TIMEOUT';

const OUTBOX_FAILURE_CODES = new Set<OutboxFailureCode>([
  'OUTBOX_TRANSPORT_FAILED',
  'OUTBOX_TRANSPORT_TIMEOUT',
]);

export interface CleanupOutboxJobsOptions {
  batchSize: number;
  failedRetentionMs: number;
  publishedRetentionMs: number;
}

export type OutboxFailureTransition = 'retry' | 'failed' | 'lease-lost';

interface ClaimedOutboxRow extends QueryResultRow {
  id: string;
  queue_name: string;
  payload: unknown;
  message_attributes: unknown;
  ledger_command_id?: string | null;
  ledger_journal_id?: string | null;
  attempts: number;
}

interface FailureRow extends QueryResultRow {
  status: 'pending' | 'failed';
}

const NEW_OUTBOX_JOB_KEYS = new Set(['destination', 'envelope', 'messageAttributes', 'ledgerLink']);

function parseNewOutboxJob(value: unknown): Readonly<{
  destination: unknown;
  envelope: unknown;
  messageAttributes: unknown;
  ledgerLink: unknown;
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid outbox job shape');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Invalid outbox job shape');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length < 3 ||
    keys.length > 4 ||
    keys.some((key) => typeof key !== 'string' || !NEW_OUTBOX_JOB_KEYS.has(key)) ||
    !Object.hasOwn(descriptors, 'destination') ||
    !Object.hasOwn(descriptors, 'envelope') ||
    !Object.hasOwn(descriptors, 'messageAttributes') ||
    Object.values(descriptors).some(
      (descriptor) => !('value' in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    throw new Error('Invalid outbox job shape');
  }
  return Object.freeze({
    destination: descriptors.destination?.value,
    envelope: descriptors.envelope?.value,
    messageAttributes: descriptors.messageAttributes?.value,
    ledgerLink: descriptors.ledgerLink?.value,
  });
}

function parseLedgerOutboxLink(value: unknown): Readonly<LedgerOutboxLink> | undefined {
  if (value === undefined) return undefined;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid ledger outbox link');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Invalid ledger outbox link');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== 2 ||
      !Object.hasOwn(descriptors, 'commandId') ||
      !Object.hasOwn(descriptors, 'journalId')
    ) {
      throw new Error('Invalid ledger outbox link');
    }
    const commandDescriptor = descriptors.commandId;
    const journalDescriptor = descriptors.journalId;
    const commandId =
      commandDescriptor && 'value' in commandDescriptor ? commandDescriptor.value : undefined;
    const journalId =
      journalDescriptor && 'value' in journalDescriptor ? journalDescriptor.value : undefined;
    if (!isCanonicalUuidV4(commandId) || !isCanonicalUuidV4(journalId)) {
      throw new Error('Invalid ledger outbox link');
    }
    return Object.freeze({ commandId, journalId });
  } catch {
    throw new Error('Invalid ledger outbox link');
  }
}

// Existing rows may predate today's stricter SQS policy. Keep claim parsing
// structural so one legacy poison row reaches dispatch failure handling instead
// of rolling back and permanently blocking every newer row in the batch.
function parseStoredMessageAttributes(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid stored job message attributes');
  }

  const entries = Object.entries(value);
  if (entries.some(([, attributeValue]) => typeof attributeValue !== 'string')) {
    throw new Error('Stored job message attributes must contain only strings');
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function validateClaimOptions(options: ClaimOutboxJobsOptions): void {
  if (!options.dispatcherId.trim()) {
    throw new Error('Outbox dispatcherId cannot be empty');
  }
  if (
    !Number.isSafeInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 100
  ) {
    throw new Error('Outbox batchSize must be an integer between 1 and 100');
  }
  if (
    !Number.isSafeInteger(options.leaseMs) ||
    options.leaseMs < 1_000 ||
    options.leaseMs > 900_000
  ) {
    throw new Error('Outbox leaseMs must be an integer between 1000 and 900000');
  }
  if (
    !Number.isSafeInteger(options.maxAttempts) ||
    options.maxAttempts < 1 ||
    options.maxAttempts > 100
  ) {
    throw new Error('Outbox maxAttempts must be an integer between 1 and 100');
  }
}

function validateCleanupOptions(options: CleanupOutboxJobsOptions): void {
  if (
    !Number.isSafeInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 1_000
  ) {
    throw new Error('Outbox cleanup batchSize must be an integer between 1 and 1000');
  }
  for (const [name, value] of [
    ['failedRetentionMs', options.failedRetentionMs],
    ['publishedRetentionMs', options.publishedRetentionMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 60_000 || value > 315_360_000_000) {
      throw new Error(`Outbox cleanup ${name} must be an integer between 60000 and 315360000000`);
    }
  }
}

@Injectable()
export class JobOutboxRepository {
  constructor(private readonly postgres: PostgresService) {}

  async insert(job: NewOutboxJob): Promise<void> {
    if (!this.postgres.hasActiveTransaction()) {
      throw new Error('Outbox enqueue requires an active PostgreSQL transaction');
    }

    let serializedEnvelope: string;
    let serializedAttributes: string;
    let destination: string;
    let envelopeId: string;
    let ledgerLink: Readonly<LedgerOutboxLink> | undefined;
    try {
      const parsedJob = parseNewOutboxJob(job);
      ledgerLink = parseLedgerOutboxLink(parsedJob.ledgerLink);
      const serialized = serializeJobMessage(
        parsedJob.envelope as JobEnvelope,
        parsedJob.messageAttributes,
      );
      const persistedEnvelope = parseJobEnvelope(JSON.parse(serialized.body) as unknown);
      assertReviewedOutboxJob({
        destination: parsedJob.destination,
        envelope: persistedEnvelope,
        messageAttributes: serialized.messageAttributes,
        ...(ledgerLink === undefined ? {} : { ledgerLink }),
      });
      destination = 'jobs';
      envelopeId = persistedEnvelope.id;
      serializedEnvelope = serialized.body;
      serializedAttributes = JSON.stringify(serialized.messageAttributes);
    } catch (error) {
      const reason = error instanceof ReviewedJobContractPolicyError ? `: ${error.code}` : '';
      // Validation causes can contain rejected payload data. Only the reviewed,
      // closed policy code is safe to expose at this boundary.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Invalid outbox job${reason}`);
    }

    try {
      await this.postgres.query(
        `SELECT enqueue_reviewed_job_v1(
           $1::text, $2::text, $3::jsonb, $4::jsonb, $5::text, $6::text
         )`,
        [
          envelopeId,
          destination,
          serializedEnvelope,
          serializedAttributes,
          ledgerLink?.commandId ?? null,
          ledgerLink?.journalId ?? null,
        ],
      );
    } catch {
      // Database errors can contain SQL, connection details, or row data. This
      // boundary deliberately replaces them instead of attaching them as cause.
      throw new Error('Outbox persistence failed');
    }
  }

  async claimBatch(options: ClaimOutboxJobsOptions): Promise<ClaimedOutboxJob[]> {
    validateClaimOptions(options);

    return this.postgres.withTransaction(async () => {
      const result = await this.postgres.query<ClaimedOutboxRow>(
        `WITH candidates AS (
           SELECT id
           FROM job_outbox
           WHERE status = 'pending'
             AND available_at <= clock_timestamp()
             AND (locked_until IS NULL OR locked_until <= clock_timestamp())
             AND attempts < $4
           ORDER BY available_at, created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE job_outbox AS outbox
         SET locked_by = $1,
             locked_until = clock_timestamp() + ($3::integer * INTERVAL '1 millisecond')
         FROM candidates
         WHERE outbox.id = candidates.id
         RETURNING outbox.id,
                   outbox.queue_name,
                   outbox.payload,
                   outbox.message_attributes,
                   outbox.ledger_command_id,
                   outbox.ledger_journal_id,
                   outbox.attempts`,
        [options.dispatcherId, options.batchSize, options.leaseMs, options.maxAttempts],
      );

      return result.rows.map((row) => {
        const ledgerLink =
          row.ledger_command_id == null && row.ledger_journal_id == null
            ? undefined
            : parseLedgerOutboxLink({
                commandId: row.ledger_command_id,
                journalId: row.ledger_journal_id,
              });
        return {
          id: row.id,
          destination: row.queue_name,
          envelope: parseJobEnvelope(row.payload),
          messageAttributes: parseStoredMessageAttributes(row.message_attributes),
          ...(ledgerLink === undefined ? {} : { ledgerLink }),
          attempts: row.attempts,
        };
      });
    });
  }

  async markPublished(id: string, dispatcherId: string): Promise<boolean> {
    const result = await this.postgres.query(
      `UPDATE job_outbox
       SET status = 'published',
           published_at = clock_timestamp(),
           failed_at = NULL,
           last_error = NULL,
           locked_by = NULL,
           locked_until = NULL
       WHERE id = $1
         AND status = 'pending'
         AND locked_by = $2`,
      [id, dispatcherId],
    );
    return result.rowCount === 1;
  }

  async recordFailure(
    id: string,
    dispatcherId: string,
    errorCode: OutboxFailureCode,
    options: RecordOutboxFailureOptions,
  ): Promise<OutboxFailureTransition> {
    if (
      !Number.isSafeInteger(options.retryDelayMs) ||
      options.retryDelayMs < 0 ||
      options.retryDelayMs > 900_000
    ) {
      throw new Error('Outbox retryDelayMs must be an integer between 0 and 900000');
    }
    if (!OUTBOX_FAILURE_CODES.has(errorCode)) {
      throw new Error('Outbox failure code is not allowlisted');
    }

    const result = await this.postgres.query<FailureRow>(
      `UPDATE job_outbox
       SET attempts = attempts + 1,
           status = CASE WHEN $4 THEN 'failed' ELSE 'pending' END,
           available_at = CASE
             WHEN $4 THEN available_at
             ELSE clock_timestamp() + ($5::integer * INTERVAL '1 millisecond')
           END,
           last_error = $3,
           failed_at = CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,
           locked_by = NULL,
           locked_until = NULL
       WHERE id = $1
         AND status = 'pending'
         AND locked_by = $2
       RETURNING status`,
      [id, dispatcherId, errorCode, options.terminal, options.retryDelayMs],
    );

    const status = result.rows[0]?.status;
    if (!status) {
      return 'lease-lost';
    }
    return status === 'failed' ? 'failed' : 'retry';
  }

  /**
   * Deletes only terminal rows in a small lock-skipping batch. Pending rows,
   * including legacy rows awaiting their terminal transition, are never
   * retention candidates.
   */
  async deleteExpired(options: CleanupOutboxJobsOptions): Promise<number> {
    validateCleanupOptions(options);
    const result = await this.postgres.query(
      `WITH published_expired AS (
         SELECT id,
                published_at + ($1::double precision * INTERVAL '1 millisecond') AS expires_at
         FROM job_outbox
         WHERE status = 'published'
           AND published_at < statement_timestamp()
             - ($1::double precision * INTERVAL '1 millisecond')
         ORDER BY published_at, id
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       ), failed_expired AS (
         SELECT id,
                failed_at + ($2::double precision * INTERVAL '1 millisecond') AS expires_at
         FROM job_outbox
         WHERE status = 'failed'
           AND failed_at < statement_timestamp()
             - ($2::double precision * INTERVAL '1 millisecond')
         ORDER BY failed_at, id
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       ), terminal_candidates AS (
         SELECT id
         FROM (
           SELECT * FROM published_expired
           UNION ALL
           SELECT * FROM failed_expired
         ) AS candidates
         ORDER BY expires_at, id
         LIMIT $3
       )
       DELETE FROM job_outbox AS outbox
       USING terminal_candidates AS candidate
       WHERE outbox.id = candidate.id
         AND outbox.status IN ('published', 'failed')
       RETURNING outbox.id`,
      [options.publishedRetentionMs, options.failedRetentionMs, options.batchSize],
    );
    return result.rowCount ?? result.rows.length;
  }
}
