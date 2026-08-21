import { constrainJobOutboxLastErrorMigration } from './0006-constrain-job-outbox-last-error.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_SCHEMA_MIGRATION_LIST } from './index';

describe('constrainJobOutboxLastErrorMigration', () => {
  it('keeps the production migration order monotonic while retaining the schema-only fixture', () => {
    expect(DATABASE_MIGRATION_LIST.map(({ id }) => id)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
    ]);
    expect(DATABASE_SCHEMA_MIGRATION_LIST.map(({ id }) => id)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0006',
    ]);
    expect(Object.isFrozen(DATABASE_MIGRATION_LIST)).toBe(true);
    expect(Object.isFrozen(DATABASE_SCHEMA_MIGRATION_LIST)).toBe(true);
  });

  it('constrains new writes before sanitizing and validating historical rows', () => {
    expect(constrainJobOutboxLastErrorMigration.transactional).not.toBe(false);
    expect(constrainJobOutboxLastErrorMigration.upSql).toEqual([
      expect.stringMatching(/ADD CONSTRAINT job_outbox_last_error_code_check[\s\S]+NOT VALID/u),
      expect.stringMatching(
        /SET last_error = 'OUTBOX_TRANSPORT_FAILED'[\s\S]+last_error NOT IN \('OUTBOX_TRANSPORT_FAILED', 'OUTBOX_TRANSPORT_TIMEOUT'\)/u,
      ),
      expect.stringMatching(/VALIDATE CONSTRAINT job_outbox_last_error_code_check/u),
    ]);
    expect(constrainJobOutboxLastErrorMigration.verifySql).toContain(
      "constraint_state.conname = 'job_outbox_last_error_code_check'",
    );
    expect(constrainJobOutboxLastErrorMigration.verifySql).toContain(
      'constraint_state.convalidated',
    );
    expect(constrainJobOutboxLastErrorMigration.downSql).toContain(
      'DROP CONSTRAINT IF EXISTS job_outbox_last_error_code_check',
    );
  });
});
