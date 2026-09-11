import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../database/postgres.service';
import { serializeJobMessage } from './job-message-policy';
import type {
  OutboxTransport,
  OutboxTransportMessage,
  OutboxTransportReceipt,
} from './outbox-transport.port';

interface RailwayQueuePublishResult extends QueryResultRow {
  matches: boolean;
}

interface RailwayQueueHealthResult extends QueryResultRow {
  ready: boolean;
}

@Injectable()
export class PostgresOutboxTransport implements OutboxTransport {
  constructor(private readonly postgres: PostgresService) {}

  async publish(
    message: OutboxTransportMessage,
    abortSignal?: AbortSignal,
  ): Promise<OutboxTransportReceipt> {
    if (abortSignal?.aborted) throw new Error('PostgreSQL outbox transport aborted');

    const serialized = serializeJobMessage(message.envelope, message.messageAttributes);
    const result = await this.postgres.query<RailwayQueuePublishResult>(
      `WITH inserted AS (
         INSERT INTO railway_job_queue (
           id, queue_name, payload, message_attributes, ledger_command_id, ledger_journal_id
         )
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
         ON CONFLICT (id) DO NOTHING
         RETURNING true AS matches
       )
       SELECT matches FROM inserted
       UNION ALL
       SELECT payload = $3::jsonb
          AND message_attributes = $4::jsonb
          AND queue_name = $2
          AND ledger_command_id IS NOT DISTINCT FROM $5
          AND ledger_journal_id IS NOT DISTINCT FROM $6 AS matches
       FROM railway_job_queue
       WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [
        message.envelope.id,
        message.destination,
        serialized.body,
        JSON.stringify(serialized.messageAttributes),
        message.ledgerLink?.commandId ?? null,
        message.ledgerLink?.journalId ?? null,
      ],
    );
    if (result.rows[0]?.matches !== true) {
      throw new Error('PostgreSQL outbox idempotency conflict');
    }
    return { transportMessageId: message.envelope.id };
  }

  async healthCheck(abortSignal?: AbortSignal): Promise<void> {
    if (abortSignal?.aborted) throw new Error('PostgreSQL queue health check aborted');
    // The API capability intentionally cannot read the worker-owned queue.
    // Existence is enough here: the owner-role deploy verifier proves the ACL,
    // and persistent worker claim failures cross the worker's fatal boundary.
    const result = await this.postgres.query<RailwayQueueHealthResult>(
      "SELECT to_regclass('public.railway_job_queue') IS NOT NULL AS ready",
    );
    if (result.rows[0]?.ready !== true) {
      throw new Error('PostgreSQL queue is not ready');
    }
  }
}
