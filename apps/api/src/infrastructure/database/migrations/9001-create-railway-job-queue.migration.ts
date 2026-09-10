import type { DatabaseMigration } from './migration';

/**
 * Railway replaces SQS with a durable PostgreSQL hand-off table. The immutable
 * envelope ID is the idempotency key, so a worker crash after INSERT but before
 * marking the source outbox row published cannot duplicate the queued job.
 */
export const createRailwayJobQueueMigration: DatabaseMigration = {
  id: '9001',
  description: 'create durable Railway PostgreSQL job queue',
  upSql: `
    CREATE TABLE railway_job_queue (
      id text PRIMARY KEY,
      queue_name text NOT NULL CHECK (queue_name = 'jobs'),
      payload jsonb NOT NULL,
      message_attributes jsonb NOT NULL,
      ledger_command_id text,
      ledger_journal_id text,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_by text,
      locked_until timestamptz,
      enqueued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at timestamptz,
      failed_at timestamptz,
      last_error text CHECK (
        last_error IS NULL OR last_error IN ('RAILWAY_JOB_HANDLER_DORMANT', 'RAILWAY_JOB_INVALID')
      ),
      CONSTRAINT railway_job_queue_ledger_pair_check CHECK (
        (ledger_command_id IS NULL) = (ledger_journal_id IS NULL)
      ),
      CONSTRAINT railway_job_queue_lock_pair_check CHECK (
        (locked_by IS NULL) = (locked_until IS NULL)
      )
    );

    CREATE INDEX railway_job_queue_claim_idx
      ON railway_job_queue (available_at, locked_until, enqueued_at, id)
      WHERE status = 'queued';

    REVOKE ALL PRIVILEGES ON TABLE railway_job_queue
      FROM PUBLIC, crypto_api_runtime, crypto_worker_runtime;
    GRANT SELECT, INSERT, DELETE ON TABLE railway_job_queue TO crypto_worker_runtime;
    GRANT UPDATE (
      status, attempts, available_at, locked_by, locked_until, failed_at, last_error
    ) ON TABLE railway_job_queue TO crypto_worker_runtime;
  `,
  downSql: `DO $railway_queue_irreversible$
    BEGIN
      RAISE EXCEPTION
        'Railway durable job queue is irreversible; archive it and restore from a reviewed backup'
        USING ERRCODE = '55000';
    END;
    $railway_queue_irreversible$;`,
  verifySql: `
    SELECT
      to_regclass('public.railway_job_queue') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'railway_job_queue'
          AND indexname = 'railway_job_queue_claim_idx'
      )
      AND pg_catalog.has_table_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'SELECT,INSERT,DELETE'
      )
      AND pg_catalog.has_column_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'status', 'UPDATE'
      )
      AND pg_catalog.has_column_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'attempts', 'UPDATE'
      )
      AND pg_catalog.has_column_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'available_at', 'UPDATE'
      )
      AND pg_catalog.has_column_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'locked_by', 'UPDATE'
      )
      AND pg_catalog.has_column_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'locked_until', 'UPDATE'
      )
      AND pg_catalog.has_column_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'failed_at', 'UPDATE'
      )
      AND pg_catalog.has_column_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'last_error', 'UPDATE'
      )
      AND NOT pg_catalog.has_column_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue', 'payload', 'UPDATE'
      )
      AND NOT pg_catalog.has_table_privilege(
        'crypto_worker_runtime', 'public.railway_job_queue',
        'TRUNCATE,REFERENCES,TRIGGER'
      ) AS valid;
  `,
};
