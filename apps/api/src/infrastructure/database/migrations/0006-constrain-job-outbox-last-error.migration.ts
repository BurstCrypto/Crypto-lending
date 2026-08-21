import type { DatabaseMigration } from './migration';

const LAST_ERROR_CONSTRAINT = 'job_outbox_last_error_code_check';

/**
 * Historical workers persisted raw transport error text in this column. Add
 * the new constraint as NOT VALID first so every write in this transaction is
 * checked, replace the historical values, and only then validate old rows.
 */
export const constrainJobOutboxLastErrorMigration: DatabaseMigration = {
  id: '0006',
  description: 'sanitize and constrain outbox transport failure codes',
  upSql: [
    `ALTER TABLE job_outbox
       ADD CONSTRAINT ${LAST_ERROR_CONSTRAINT}
       CHECK (
         last_error IS NULL
         OR last_error IN ('OUTBOX_TRANSPORT_FAILED', 'OUTBOX_TRANSPORT_TIMEOUT')
       ) NOT VALID`,
    `UPDATE job_outbox
       SET last_error = 'OUTBOX_TRANSPORT_FAILED'
       WHERE last_error IS NOT NULL
         AND last_error NOT IN ('OUTBOX_TRANSPORT_FAILED', 'OUTBOX_TRANSPORT_TIMEOUT')`,
    `ALTER TABLE job_outbox
       VALIDATE CONSTRAINT ${LAST_ERROR_CONSTRAINT}`,
  ],
  downSql: `ALTER TABLE job_outbox
    DROP CONSTRAINT IF EXISTS ${LAST_ERROR_CONSTRAINT}`,
  verifySql: `SELECT (
    SELECT count(*) = 1
    FROM pg_catalog.pg_constraint AS constraint_state
    INNER JOIN pg_catalog.pg_attribute AS constrained_column
      ON constrained_column.attrelid = constraint_state.conrelid
      AND constrained_column.attname = 'last_error'
      AND NOT constrained_column.attisdropped
    WHERE constraint_state.conrelid = pg_catalog.to_regclass('job_outbox')
      AND constraint_state.conname = '${LAST_ERROR_CONSTRAINT}'
      AND constraint_state.contype = 'c'
      AND constraint_state.convalidated
      AND NOT constraint_state.connoinherit
      AND constraint_state.conkey = ARRAY[constrained_column.attnum]
      AND pg_catalog.pg_get_expr(
        constraint_state.conbin,
        constraint_state.conrelid,
        false
      ) = '((last_error IS NULL) OR (last_error = ANY (ARRAY[''OUTBOX_TRANSPORT_FAILED''::text, ''OUTBOX_TRANSPORT_TIMEOUT''::text])))'
  ) AS valid`,
};
