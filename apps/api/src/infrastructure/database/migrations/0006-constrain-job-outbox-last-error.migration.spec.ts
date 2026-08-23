import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { constrainJobOutboxLastErrorMigration } from './0006-constrain-job-outbox-last-error.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

describe('constrainJobOutboxLastErrorMigration', () => {
  it('keeps the production migration order monotonic while retaining the schema-only fixture', () => {
    expect(DATABASE_MIGRATION_LIST.map(({ id }) => id)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
    ]);
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.map(({ id }) => id)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
    ]);
    expect(Object.isFrozen(DATABASE_MIGRATION_LIST)).toBe(true);
    expect(Object.isFrozen(DATABASE_TEST_SCHEMA_MIGRATION_LIST)).toBe(true);
  });

  it('keeps the test-only fixture out of production module and CLI wiring', () => {
    for (const relativePath of ['../postgres.module.ts', '../migration.cli.ts']) {
      const source = readFileSync(resolve(__dirname, relativePath), 'utf8');
      expect(source).toContain("import { DATABASE_MIGRATION_LIST } from './migrations';");
      expect(source).not.toContain('DATABASE_TEST_SCHEMA_MIGRATION_LIST');
    }
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
