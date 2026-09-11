import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../database/postgres.service';
import { parseJobEnvelope } from './job-envelope';
import { parseJobMessageAttributes } from './job-message-policy';
import { assertReviewedOutboxJob } from './reviewed-job-contract-policy';

interface RailwayQueuedJob extends QueryResultRow {
  readonly attempts: number;
  readonly id: string;
  readonly ledger_command_id: string | null;
  readonly ledger_journal_id: string | null;
  readonly message_attributes: unknown;
  readonly payload: unknown;
  readonly queue_name: string;
}

export interface RailwayQueueSettlementSummary {
  readonly claimed: number;
  readonly failed: number;
  readonly retried: number;
}

const MAX_ATTEMPTS = 5;
const CLAIM_LIMIT = 25;
const LEASE_SECONDS = 30;
const FAILED_RETENTION_DAYS = 30;

/**
 * Fail-closed Railway consumer used while every provider adapter is dormant.
 * It validates each durable hand-off, then records bounded retries and a
 * terminal audit state instead of invoking an unapproved financial handler.
 */
@Injectable()
export class PostgresJobQueueConsumer {
  private readonly consumerId = `${hostname()}:${process.pid}:${randomUUID()}`;

  constructor(private readonly postgres: PostgresService) {}

  async processBatch(): Promise<RailwayQueueSettlementSummary> {
    const jobs = await this.claimBatch();
    const summary = { claimed: jobs.length, failed: 0, retried: 0 };
    for (const job of jobs) {
      let errorCode = 'RAILWAY_JOB_HANDLER_DORMANT';
      try {
        const envelope = parseJobEnvelope(job.payload);
        assertReviewedOutboxJob({
          destination: job.queue_name,
          envelope,
          messageAttributes: parseJobMessageAttributes(job.message_attributes),
          ...(job.ledger_command_id && job.ledger_journal_id
            ? {
                ledgerLink: {
                  commandId: job.ledger_command_id,
                  journalId: job.ledger_journal_id,
                },
              }
            : {}),
        });
      } catch {
        errorCode = 'RAILWAY_JOB_INVALID';
      }

      const terminal = job.attempts >= MAX_ATTEMPTS;
      const delaySeconds = terminal ? 0 : Math.min(60, 2 ** Math.max(0, job.attempts - 1));
      const result = await this.postgres.query(
        `UPDATE railway_job_queue
         SET status = $3,
             available_at = CASE
               WHEN $3 = 'queued' THEN clock_timestamp() + ($4::integer * INTERVAL '1 second')
               ELSE available_at
             END,
             locked_by = NULL,
             locked_until = NULL,
             last_error = $5,
             failed_at = CASE WHEN $3 = 'failed' THEN clock_timestamp() ELSE NULL END
         WHERE id = $1
           AND status = 'processing'
           AND locked_by = $2`,
        [job.id, this.consumerId, terminal ? 'failed' : 'queued', delaySeconds, errorCode],
      );
      if (result.rowCount === 1) {
        if (terminal) summary.failed += 1;
        else summary.retried += 1;
      }
    }
    return summary;
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.postgres.query(
      `WITH expired AS (
         SELECT id
         FROM railway_job_queue
         WHERE status = 'failed'
           AND failed_at < clock_timestamp() - ($1::integer * INTERVAL '1 day')
         ORDER BY failed_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 100
       )
       DELETE FROM railway_job_queue AS queued
       USING expired
       WHERE queued.id = expired.id`,
      [FAILED_RETENTION_DAYS],
    );
    return result.rowCount ?? 0;
  }

  private async claimBatch(): Promise<RailwayQueuedJob[]> {
    return this.postgres.withTransaction(async () => {
      const result = await this.postgres.query<RailwayQueuedJob>(
        `WITH candidates AS (
           SELECT id
           FROM railway_job_queue
           WHERE available_at <= clock_timestamp()
             AND (
               (status = 'queued' AND attempts < $4)
               OR (status = 'processing' AND locked_until <= clock_timestamp() AND attempts < $4)
             )
           ORDER BY available_at, enqueued_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $3
         )
         UPDATE railway_job_queue AS queued
         SET status = 'processing',
             attempts = queued.attempts + 1,
             locked_by = $1,
             locked_until = clock_timestamp() + ($2::integer * INTERVAL '1 second')
         FROM candidates
         WHERE queued.id = candidates.id
         RETURNING queued.id, queued.queue_name, queued.payload,
                   queued.message_attributes, queued.ledger_command_id,
                   queued.ledger_journal_id, queued.attempts`,
        [this.consumerId, LEASE_SECONDS, CLAIM_LIMIT, MAX_ATTEMPTS],
      );
      return result.rows;
    });
  }
}
