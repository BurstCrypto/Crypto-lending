import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../database/postgres.service';
import { parseJobEnvelope, type JobEnvelope } from './job-envelope';
import { serializeJobMessage } from './job-message-policy';

export interface NewOutboxJob {
  destination: string;
  envelope: JobEnvelope;
  messageAttributes: Readonly<Record<string, string>>;
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
  attempts: number;
}

export interface RecordOutboxFailureOptions {
  terminal: boolean;
  retryDelayMs: number;
}

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
  attempts: number;
}

interface FailureRow extends QueryResultRow {
  status: 'pending' | 'failed';
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
    try {
      const serialized = serializeJobMessage(job.envelope, job.messageAttributes);
      serializedEnvelope = serialized.body;
      serializedAttributes = JSON.stringify(serialized.messageAttributes);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid JSON';
      throw new Error(`Invalid outbox job: ${reason}`, {
        cause: error,
      });
    }

    await this.postgres.query(
      `INSERT INTO job_outbox (id, queue_name, payload, message_attributes)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
      [job.envelope.id, job.destination, serializedEnvelope, serializedAttributes],
    );
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
                   outbox.attempts`,
        [options.dispatcherId, options.batchSize, options.leaseMs, options.maxAttempts],
      );

      return result.rows.map((row) => ({
        id: row.id,
        destination: row.queue_name,
        envelope: parseJobEnvelope(row.payload),
        messageAttributes: parseStoredMessageAttributes(row.message_attributes),
        attempts: row.attempts,
      }));
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
    error: string,
    options: RecordOutboxFailureOptions,
  ): Promise<OutboxFailureTransition> {
    if (
      !Number.isSafeInteger(options.retryDelayMs) ||
      options.retryDelayMs < 0 ||
      options.retryDelayMs > 900_000
    ) {
      throw new Error('Outbox retryDelayMs must be an integer between 0 and 900000');
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
      [id, dispatcherId, error.slice(0, 2_000), options.terminal, options.retryDelayMs],
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
