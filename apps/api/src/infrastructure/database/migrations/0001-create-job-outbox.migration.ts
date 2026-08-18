import type { DatabaseMigration } from './migration';

export const createJobOutboxMigration: DatabaseMigration = {
  id: '0001',
  description: 'create transactional job outbox',
  upSql: `
    CREATE TABLE job_outbox (
      id text PRIMARY KEY,
      queue_name text NOT NULL,
      payload jsonb NOT NULL,
      message_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'published', 'failed')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error text,
      locked_by text,
      locked_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      published_at timestamptz,
      failed_at timestamptz,
      CONSTRAINT job_outbox_lock_pair_check CHECK (
        (locked_by IS NULL) = (locked_until IS NULL)
      ),
      CONSTRAINT job_outbox_pending_lock_check CHECK (
        status = 'pending' OR (locked_by IS NULL AND locked_until IS NULL)
      ),
      CONSTRAINT job_outbox_published_at_check CHECK (
        (status = 'published' AND published_at IS NOT NULL)
        OR (status <> 'published' AND published_at IS NULL)
      ),
      CONSTRAINT job_outbox_failed_at_check CHECK (
        (status = 'failed' AND failed_at IS NOT NULL)
        OR (status <> 'failed' AND failed_at IS NULL)
      )
    );

    CREATE INDEX job_outbox_pending_claim_idx
      ON job_outbox (available_at, locked_until, created_at, id)
      WHERE status = 'pending';
  `,
  downSql: `
    DROP TABLE IF EXISTS job_outbox;
  `,
};
