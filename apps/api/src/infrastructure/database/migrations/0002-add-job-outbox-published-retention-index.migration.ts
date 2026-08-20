import type { DatabaseMigration } from './migration';

export const addJobOutboxPublishedRetentionIndexMigration: DatabaseMigration = {
  id: '0002',
  description: 'add published outbox retention index',
  transactional: false,
  upSql: [
    'DROP INDEX CONCURRENTLY IF EXISTS job_outbox_published_retention_idx',
    `CREATE INDEX CONCURRENTLY job_outbox_published_retention_idx
       ON job_outbox (published_at, id)
       WHERE status = 'published'`,
  ],
  downSql: 'DROP INDEX CONCURRENTLY IF EXISTS job_outbox_published_retention_idx',
  verifySql: `SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_state
    INNER JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_state.indexrelid
    WHERE index_state.indexrelid = pg_catalog.to_regclass('job_outbox_published_retention_idx')
      AND index_state.indrelid = pg_catalog.to_regclass('job_outbox')
      AND index_class.relam = (SELECT oid FROM pg_catalog.pg_am WHERE amname = 'btree')
      AND index_state.indnkeyatts = 2
      AND index_state.indnatts = 2
      AND NOT index_state.indisunique
      AND NOT index_state.indisprimary
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_state.indislive
      AND pg_catalog.pg_get_indexdef(index_state.indexrelid, 1, true) = 'published_at'
      AND pg_catalog.pg_get_indexdef(index_state.indexrelid, 2, true) = 'id'
      AND pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid, false)
        = '(status = ''published''::text)'
  ) AS valid`,
};
