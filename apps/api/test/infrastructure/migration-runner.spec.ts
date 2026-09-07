import type { Pool, PoolClient, QueryConfig, QueryResult, QueryResultRow } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import type { PostgresService } from '../../src/infrastructure/database/postgres.service';

const REVERSIBLE_DATABASE_MIGRATION_LIST = DATABASE_MIGRATION_LIST.filter(({ id }) => id <= '0025');

interface StoredMigration extends QueryResultRow {
  id: string;
  checksum: string;
}

function result<Row extends QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function cancelledQueryError(): Error & { readonly code: string } {
  return Object.assign(new Error('POSTGRES_CANCELLABLE_QUERY_ABORTED'), {
    code: 'POSTGRES_CANCELLABLE_QUERY_ABORTED',
  });
}

class InMemoryMigrationDatabase {
  readonly applied = new Map<string, StoredMigration>();
  readonly indexes = new Map<string, string>();
  readonly queries: string[] = [];
  accountSchemaExists = false;
  aaveCheckpointSchemaExists = false;
  balanceAddressResolverExists = false;
  financialAgreementEvidenceExists = false;
  authenticationSchemaExists = false;
  jobOutboxExists = false;
  jobOutboxLastErrorConstraintExists = false;
  ledgerIdempotencySchemaExists = false;
  ledgerSchemaExists = false;
  ledgerFeeAdjustmentIntegrityRepaired = false;
  reviewedJobAdmissionExists = false;
  walletRegistrationSchemaExists = false;
  yieldOperationSchemaExists = false;
  migrationTableExists = false;
  oldVerifierValid = true;
  newVerifierValid = true;
  thirdVerifierValid = true;
  released = false;
  releaseError: Error | boolean | undefined;
  advisoryLockFailuresRemaining = 0;
  advisoryUnlockResult: unknown = true;
  private transactionAppliedSnapshot: Map<string, StoredMigration> | undefined;
  private transactionAaveCheckpointSchemaExistsSnapshot: boolean | undefined;
  private transactionBalanceAddressResolverExistsSnapshot: boolean | undefined;
  private transactionAuthenticationSchemaExistsSnapshot: boolean | undefined;
  private transactionFinancialAgreementEvidenceExistsSnapshot: boolean | undefined;
  private transactionLedgerSchemaExistsSnapshot: boolean | undefined;
  private transactionLedgerFeeAdjustmentIntegrityRepairedSnapshot: boolean | undefined;
  private transactionLedgerIdempotencySchemaExistsSnapshot: boolean | undefined;
  private transactionReviewedJobAdmissionExistsSnapshot: boolean | undefined;
  private transactionWalletRegistrationSchemaExistsSnapshot: boolean | undefined;
  private transactionYieldOperationSchemaExistsSnapshot: boolean | undefined;

  readonly client = {
    query: async (text: string, values: readonly unknown[] = []): Promise<QueryResult> => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      this.queries.push(normalized);

      if (normalized === 'SELECT pg_try_advisory_lock($1) AS acquired') {
        const acquired = this.advisoryLockFailuresRemaining === 0;
        if (!acquired) this.advisoryLockFailuresRemaining -= 1;
        return result([{ acquired }]);
      } else if (normalized === 'SELECT pg_advisory_unlock($1) AS released') {
        return result([{ released: this.advisoryUnlockResult }]);
      } else if (normalized === 'BEGIN') {
        this.transactionAppliedSnapshot = new Map(this.applied);
        this.transactionAaveCheckpointSchemaExistsSnapshot = this.aaveCheckpointSchemaExists;
        this.transactionBalanceAddressResolverExistsSnapshot = this.balanceAddressResolverExists;
        this.transactionAuthenticationSchemaExistsSnapshot = this.authenticationSchemaExists;
        this.transactionFinancialAgreementEvidenceExistsSnapshot =
          this.financialAgreementEvidenceExists;
        this.transactionLedgerSchemaExistsSnapshot = this.ledgerSchemaExists;
        this.transactionLedgerFeeAdjustmentIntegrityRepairedSnapshot =
          this.ledgerFeeAdjustmentIntegrityRepaired;
        this.transactionLedgerIdempotencySchemaExistsSnapshot = this.ledgerIdempotencySchemaExists;
        this.transactionReviewedJobAdmissionExistsSnapshot = this.reviewedJobAdmissionExists;
        this.transactionWalletRegistrationSchemaExistsSnapshot =
          this.walletRegistrationSchemaExists;
        this.transactionYieldOperationSchemaExistsSnapshot = this.yieldOperationSchemaExists;
      } else if (normalized === 'COMMIT') {
        this.transactionAppliedSnapshot = undefined;
        this.transactionAaveCheckpointSchemaExistsSnapshot = undefined;
        this.transactionBalanceAddressResolverExistsSnapshot = undefined;
        this.transactionAuthenticationSchemaExistsSnapshot = undefined;
        this.transactionFinancialAgreementEvidenceExistsSnapshot = undefined;
        this.transactionLedgerSchemaExistsSnapshot = undefined;
        this.transactionLedgerFeeAdjustmentIntegrityRepairedSnapshot = undefined;
        this.transactionLedgerIdempotencySchemaExistsSnapshot = undefined;
        this.transactionReviewedJobAdmissionExistsSnapshot = undefined;
        this.transactionWalletRegistrationSchemaExistsSnapshot = undefined;
        this.transactionYieldOperationSchemaExistsSnapshot = undefined;
      } else if (normalized === 'ROLLBACK') {
        if (this.transactionAppliedSnapshot) {
          this.applied.clear();
          for (const [id, migration] of this.transactionAppliedSnapshot) {
            this.applied.set(id, migration);
          }
        }
        if (this.transactionLedgerSchemaExistsSnapshot !== undefined) {
          this.ledgerSchemaExists = this.transactionLedgerSchemaExistsSnapshot;
        }
        if (this.transactionAaveCheckpointSchemaExistsSnapshot !== undefined) {
          this.aaveCheckpointSchemaExists = this.transactionAaveCheckpointSchemaExistsSnapshot;
        }
        if (this.transactionBalanceAddressResolverExistsSnapshot !== undefined) {
          this.balanceAddressResolverExists = this.transactionBalanceAddressResolverExistsSnapshot;
        }
        if (this.transactionLedgerFeeAdjustmentIntegrityRepairedSnapshot !== undefined) {
          this.ledgerFeeAdjustmentIntegrityRepaired =
            this.transactionLedgerFeeAdjustmentIntegrityRepairedSnapshot;
        }
        if (this.transactionLedgerIdempotencySchemaExistsSnapshot !== undefined) {
          this.ledgerIdempotencySchemaExists =
            this.transactionLedgerIdempotencySchemaExistsSnapshot;
        }
        if (this.transactionReviewedJobAdmissionExistsSnapshot !== undefined) {
          this.reviewedJobAdmissionExists = this.transactionReviewedJobAdmissionExistsSnapshot;
        }
        if (this.transactionAuthenticationSchemaExistsSnapshot !== undefined) {
          this.authenticationSchemaExists = this.transactionAuthenticationSchemaExistsSnapshot;
        }
        if (this.transactionFinancialAgreementEvidenceExistsSnapshot !== undefined) {
          this.financialAgreementEvidenceExists =
            this.transactionFinancialAgreementEvidenceExistsSnapshot;
        }
        if (this.transactionWalletRegistrationSchemaExistsSnapshot !== undefined) {
          this.walletRegistrationSchemaExists =
            this.transactionWalletRegistrationSchemaExistsSnapshot;
        }
        if (this.transactionYieldOperationSchemaExistsSnapshot !== undefined) {
          this.yieldOperationSchemaExists = this.transactionYieldOperationSchemaExistsSnapshot;
        }
        this.transactionAppliedSnapshot = undefined;
        this.transactionAaveCheckpointSchemaExistsSnapshot = undefined;
        this.transactionBalanceAddressResolverExistsSnapshot = undefined;
        this.transactionAuthenticationSchemaExistsSnapshot = undefined;
        this.transactionFinancialAgreementEvidenceExistsSnapshot = undefined;
        this.transactionLedgerSchemaExistsSnapshot = undefined;
        this.transactionLedgerFeeAdjustmentIntegrityRepairedSnapshot = undefined;
        this.transactionLedgerIdempotencySchemaExistsSnapshot = undefined;
        this.transactionReviewedJobAdmissionExistsSnapshot = undefined;
        this.transactionWalletRegistrationSchemaExistsSnapshot = undefined;
        this.transactionYieldOperationSchemaExistsSnapshot = undefined;
      } else if (normalized.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        this.migrationTableExists = true;
      } else if (normalized.startsWith("SELECT to_regclass('schema_migrations')")) {
        return result([
          {
            table_name: this.migrationTableExists ? 'schema_migrations' : null,
          },
        ]);
      } else if (normalized.includes('CREATE TABLE job_outbox')) {
        this.jobOutboxExists = true;
      } else if (normalized.includes('DROP TABLE IF EXISTS job_outbox')) {
        this.jobOutboxExists = false;
        this.jobOutboxLastErrorConstraintExists = false;
        this.indexes.clear();
      } else if (normalized.includes('ADD CONSTRAINT job_outbox_last_error_code_check')) {
        this.jobOutboxLastErrorConstraintExists = true;
      } else if (
        normalized.includes('DROP CONSTRAINT IF EXISTS job_outbox_last_error_code_check')
      ) {
        this.jobOutboxLastErrorConstraintExists = false;
      } else if (normalized.includes('CREATE TABLE accounts (')) {
        this.accountSchemaExists = true;
      } else if (
        normalized.includes('CREATE TABLE aave_v3_ethereum_finalized_checkpoint_events (')
      ) {
        this.aaveCheckpointSchemaExists = true;
      } else if (normalized.includes('CREATE FUNCTION enqueue_reviewed_job_v1(')) {
        this.reviewedJobAdmissionExists = true;
      } else if (
        normalized.startsWith('CREATE FUNCTION resolve_active_wallet_address_ciphertext(')
      ) {
        this.balanceAddressResolverExists = true;
      } else if (
        normalized.startsWith(
          'DROP FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text)',
        )
      ) {
        this.balanceAddressResolverExists = false;
      } else if (
        normalized.includes(
          'DROP FUNCTION enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)',
        )
      ) {
        this.reviewedJobAdmissionExists = false;
      } else if (normalized.includes('DROP TABLE aave_v3_ethereum_finalized_checkpoint_events')) {
        this.aaveCheckpointSchemaExists = false;
      } else if (normalized.includes('DROP TABLE IF EXISTS account_profile_audit')) {
        this.accountSchemaExists = false;
      } else if (normalized.includes('CREATE TABLE ledger_books (')) {
        this.ledgerSchemaExists = true;
      } else if (normalized.includes('CREATE TABLE ledger_command_idempotency (')) {
        this.ledgerIdempotencySchemaExists = true;
      } else if (normalized.includes('CREATE TABLE authentication_oidc_identities (')) {
        this.authenticationSchemaExists = true;
      } else if (normalized.includes('CREATE TABLE balance_sync_financial_agreement_evidence (')) {
        this.financialAgreementEvidenceExists = true;
      } else if (normalized.includes('CREATE TABLE wallet_ownership_challenges (')) {
        this.walletRegistrationSchemaExists = true;
      } else if (normalized.includes('CREATE TABLE yield_operations (')) {
        this.yieldOperationSchemaExists = true;
      } else if (
        normalized.includes('repair_ledger_fee_adjustment_integrity') &&
        normalized.includes("$expected$AND component.stage = 'ACTUAL'$expected$")
      ) {
        this.ledgerFeeAdjustmentIntegrityRepaired = true;
      } else if (
        normalized.includes('repair_ledger_fee_adjustment_integrity') &&
        normalized.includes(
          "$expected$AND component.stage = CASE WHEN target_event_type = 'ADJUSTMENT'",
        )
      ) {
        this.ledgerFeeAdjustmentIntegrityRepaired = false;
      } else if (normalized === 'DROP TABLE yield_operations') {
        this.yieldOperationSchemaExists = false;
      } else if (normalized === 'DROP TABLE wallet_ownership_challenges') {
        this.walletRegistrationSchemaExists = false;
      } else if (normalized === 'DROP TABLE authentication_oidc_identities') {
        this.authenticationSchemaExists = false;
      } else if (normalized === 'DROP TABLE balance_sync_financial_agreement_evidence') {
        this.financialAgreementEvidenceExists = false;
      } else if (normalized === 'DROP TABLE ledger_command_idempotency') {
        this.ledgerIdempotencySchemaExists = false;
      } else if (normalized === 'DROP TABLE ledger_books') {
        this.ledgerSchemaExists = false;
      } else if (normalized.startsWith('DROP INDEX CONCURRENTLY IF EXISTS')) {
        const indexName = normalized.split(' ').at(-1);
        if (indexName) this.indexes.delete(indexName);
      } else if (normalized.startsWith('CREATE INDEX CONCURRENTLY')) {
        const indexName = normalized.split(' ')[3];
        if (indexName) this.indexes.set(indexName, normalized);
      } else if (normalized === "SELECT 'old-verifier' AS verifier") {
        return result([{ valid: this.oldVerifierValid }]);
      } else if (normalized === "SELECT 'new-verifier' AS verifier") {
        return result([{ valid: this.newVerifierValid }]);
      } else if (normalized === "SELECT 'third-verifier' AS verifier") {
        return result([{ valid: this.thirdVerifierValid }]);
      } else if (
        normalized.startsWith('SELECT ( prior.valid AND relation_state.valid') &&
        normalized.includes('balance_sync_financial_agreement_evidence')
      ) {
        return result([{ valid: this.financialAgreementEvidenceExists }]);
      } else if (
        normalized.startsWith(
          'SELECT (prior.valid AND function_privileges.valid AND direct_objects.valid)',
        ) &&
        normalized.includes('record_stablecoin_price_evidence')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists &&
              this.yieldOperationSchemaExists &&
              this.ledgerFeeAdjustmentIntegrityRepaired &&
              this.aaveCheckpointSchemaExists &&
              this.reviewedJobAdmissionExists,
          },
        ]);
      } else if (
        normalized.startsWith(
          'SELECT (prior.valid AND function_state.valid AND privileges.valid)',
        ) &&
        normalized.includes('resolve_active_wallet_address_ciphertext(uuid,uuid,text)')
      ) {
        return result([{ valid: this.balanceAddressResolverExists }]);
      } else if (
        normalized.startsWith(
          'SELECT ( prior.valid AND admission_function.valid AND admission_privileges.valid',
        ) &&
        normalized.includes('enqueue_reviewed_job_v1')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists &&
              this.yieldOperationSchemaExists &&
              this.ledgerFeeAdjustmentIntegrityRepaired &&
              this.aaveCheckpointSchemaExists &&
              this.reviewedJobAdmissionExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT ( prior.valid AND relations.valid') &&
        normalized.includes('aave_v3_ethereum_finalized_checkpoint_events')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists &&
              this.yieldOperationSchemaExists &&
              this.ledgerFeeAdjustmentIntegrityRepaired &&
              this.aaveCheckpointSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT EXISTS') &&
        normalized.includes('pg_catalog.pg_index')
      ) {
        const indexName = [...this.indexes.keys()].find((name) => normalized.includes(`'${name}'`));
        const definition = indexName ? this.indexes.get(indexName) : undefined;
        const expectedTimestamp = normalized.includes("= 'published_at'")
          ? 'published_at'
          : 'failed_at';
        const expectedStatus = expectedTimestamp === 'published_at' ? 'published' : 'failed';
        return result([
          {
            valid: Boolean(
              definition?.includes(`ON job_outbox (${expectedTimestamp}, id)`) &&
              definition.includes(`WHERE status = '${expectedStatus}'`),
            ),
          },
        ]);
      } else if (
        normalized.startsWith(
          'SELECT ( prior.valid AND state_function.valid AND revoke_function.valid AND guarded_completion.valid',
        ) &&
        normalized.includes('revoke_wallet_registration(uuid,uuid,uuid)')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists &&
              this.yieldOperationSchemaExists &&
              this.ledgerFeeAdjustmentIntegrityRepaired,
          },
        ]);
      } else if (
        normalized.startsWith(
          'SELECT (prior.valid AND wallet_list.valid AND wallet_capacity.valid)',
        ) &&
        normalized.includes('list_active_wallet_registrations(uuid)')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists &&
              this.yieldOperationSchemaExists &&
              this.ledgerFeeAdjustmentIntegrityRepaired,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND repair.valid)') &&
        normalized.includes("function_state.proname = 'assert_ledger_journal_integrity'")
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists &&
              this.yieldOperationSchemaExists &&
              this.ledgerFeeAdjustmentIntegrityRepaired,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND yield_operation.valid)') &&
        normalized.includes('yield_operation_commands_scope_unique')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists &&
              this.yieldOperationSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND wallet_registration.valid)') &&
        normalized.includes('registered_wallets_one_active_identity')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND authentication.valid)') &&
        normalized.includes('authentication_function_catalog')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND outbox_link.valid)') &&
        normalized.includes('ledger_command_idempotency')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (principal.valid AND ledger.valid)') &&
        normalized.includes('ledger_touching_constraints')
      ) {
        return result([
          {
            valid: this.accountSchemaExists && this.jobOutboxExists && this.ledgerSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (') &&
        normalized.includes('job_outbox_schema_owner_all') &&
        normalized.includes('pg_catalog.pg_auth_members') &&
        !normalized.includes('revoke_wallet_registration(uuid,uuid,uuid)')
      ) {
        // This harness tests MigrationRunner control flow, not PostgreSQL ACL
        // semantics. The dedicated Docker principal suite executes 0005's
        // verifier against a real catalog and mutates every security boundary.
        return result([{ valid: this.accountSchemaExists && this.jobOutboxExists }]);
      } else if (
        normalized.startsWith('SELECT (') &&
        normalized.includes('job_outbox_last_error_code_check') &&
        normalized.includes('pg_catalog.pg_constraint')
      ) {
        return result([
          {
            valid: this.jobOutboxExists && this.jobOutboxLastErrorConstraintExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (') &&
        normalized.includes("to_regclass('account_profile_audit')")
      ) {
        return result([{ valid: this.accountSchemaExists }]);
      } else if (normalized.startsWith('INSERT INTO schema_migrations')) {
        const [id, , migrationChecksum] = values;
        this.applied.set(String(id), {
          id: String(id),
          checksum: String(migrationChecksum),
        });
      } else if (normalized.startsWith('DELETE FROM schema_migrations')) {
        this.applied.delete(String(values[0]));
      } else if (normalized.startsWith('SELECT id, checksum')) {
        const descending = normalized.endsWith('DESC');
        const rows = [...this.applied.values()].sort((left, right) =>
          descending ? right.id.localeCompare(left.id) : left.id.localeCompare(right.id),
        );
        return result(rows);
      }
      return result();
    },
    release: (error?: Error | boolean): void => {
      this.released = true;
      this.releaseError = error;
    },
  } as unknown as PoolClient;

  readonly pool = {
    connect: async (): Promise<PoolClient> => this.client,
  } as unknown as Pool;
}

describe('MigrationRunner', () => {
  it('fails closed before pool acquisition when signaled readiness lacks cancellation support', async () => {
    const database = new InMemoryMigrationDatabase();
    const connect = jest.spyOn(database.pool, 'connect');
    const runner = new MigrationRunner(database.pool, []);

    await expect(runner.assertUpToDate(new AbortController().signal)).rejects.toThrow(
      'Cancellable database migration readiness is unavailable',
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects pre-aborted readiness through the cancellable executor without issuing SQL', async () => {
    const database = new InMemoryMigrationDatabase();
    const issuedSql: string[] = [];
    const queryWithCancellation = jest.fn(
      async (
        queryTextOrConfig: string | QueryConfig,
        values: unknown[] | undefined,
        signal: AbortSignal,
      ): Promise<QueryResult> => {
        if (signal.aborted) throw cancelledQueryError();
        const queryText =
          typeof queryTextOrConfig === 'string' ? queryTextOrConfig : queryTextOrConfig.text;
        issuedSql.push(queryText);
        return database.client.query(queryText, values);
      },
    );
    const runner = new MigrationRunner(database.pool, [], {
      queryWithCancellation,
    } as unknown as PostgresService);
    const controller = new AbortController();
    controller.abort();

    await expect(runner.assertUpToDate(controller.signal)).rejects.toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_ABORTED',
    });
    expect(queryWithCancellation).toHaveBeenCalledWith(
      "SELECT to_regclass('schema_migrations')::text AS table_name",
      undefined,
      controller.signal,
    );
    expect(issuedSql).toEqual([]);
  });

  it('stops signaled readiness before later verifier SQL when aborted between queries', async () => {
    const database = new InMemoryMigrationDatabase();
    const migrations = [
      {
        id: '1000',
        description: 'abortable readiness fixture',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
    ] as const;
    await new MigrationRunner(database.pool, migrations).up();
    const issuedSql: string[] = [];
    const controller = new AbortController();
    const queryWithCancellation = jest.fn(
      async (
        queryTextOrConfig: string | QueryConfig,
        values: unknown[] | undefined,
        signal: AbortSignal,
      ): Promise<QueryResult> => {
        if (signal.aborted) throw cancelledQueryError();
        const queryText =
          typeof queryTextOrConfig === 'string' ? queryTextOrConfig : queryTextOrConfig.text;
        const normalized = queryText.replace(/\s+/g, ' ').trim();
        issuedSql.push(normalized);
        const queryResult = await database.client.query(queryText, values);
        if (normalized.startsWith('SELECT id, checksum')) controller.abort();
        return queryResult;
      },
    );
    const runner = new MigrationRunner(database.pool, migrations, {
      queryWithCancellation,
    } as unknown as PostgresService);

    await expect(runner.assertUpToDate(controller.signal)).rejects.toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_ABORTED',
    });
    expect(issuedSql).toEqual([
      "SELECT to_regclass('schema_migrations')::text AS table_name",
      'SELECT id, checksum FROM schema_migrations ORDER BY id ASC',
    ]);
    expect(queryWithCancellation).toHaveBeenCalledTimes(3);
    expect(
      queryWithCancellation.mock.calls.every(([, , signal]) => signal === controller.signal),
    ).toBe(true);
  });

  it('retries the global session lock without holding a blocking probe transaction open', async () => {
    const database = new InMemoryMigrationDatabase();
    database.advisoryLockFailuresRemaining = 1;
    const runner = new MigrationRunner(database.pool, [
      {
        id: '1000',
        description: 'nonblocking migration lock fixture',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
      },
    ]);

    await expect(runner.up()).resolves.toEqual(['1000']);
    expect(
      database.queries.filter((query) => query === 'SELECT pg_try_advisory_lock($1) AS acquired'),
    ).toHaveLength(2);
    expect(database.queries).not.toContain('SELECT pg_advisory_lock($1)');
    expect(database.queries).toContain('SELECT pg_advisory_unlock($1) AS released');
  });

  it('bounds lock acquisition and returns a sanitized timeout', async () => {
    const database = new InMemoryMigrationDatabase();
    database.advisoryLockFailuresRemaining = 1;
    const now = jest.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(31_001);
    const runner = new MigrationRunner(database.pool, []);

    await expect(runner.up()).rejects.toThrow('Database migration lock acquisition timed out');
    expect(database.released).toBe(true);
    expect(database.releaseError).toBeUndefined();
    now.mockRestore();
  });

  it('destroys a session on invalid unlock without masking an existing work failure', async () => {
    const database = new InMemoryMigrationDatabase();
    database.oldVerifierValid = false;
    database.advisoryUnlockResult = false;
    const runner = new MigrationRunner(database.pool, [
      {
        id: '1000',
        description: 'unlock failure fixture',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
    ]);

    await expect(runner.up()).rejects.toThrow('Database migration 1000 schema verification failed');
    expect(database.releaseError).toEqual(new Error('Database migration lock release failed'));

    const successfulDatabase = new InMemoryMigrationDatabase();
    successfulDatabase.advisoryUnlockResult = null;
    await expect(new MigrationRunner(successfulDatabase.pool, []).up()).rejects.toThrow(
      'Database migration lock release failed',
    );
    expect(successfulDatabase.releaseError).toEqual(
      new Error('Database migration lock release failed'),
    );
  });

  it('migrates a blank database and rolls back the reversible chain', async () => {
    const database = new InMemoryMigrationDatabase();
    const runner = new MigrationRunner(database.pool, REVERSIBLE_DATABASE_MIGRATION_LIST);

    await expect(runner.up()).resolves.toEqual([
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
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
      '0021',
      '0022',
      '0023',
      '0024',
      '0025',
    ]);
    expect(database.jobOutboxExists).toBe(true);
    expect(database.applied.has('0001')).toBe(true);
    expect(database.applied.has('0002')).toBe(true);
    expect(database.applied.has('0003')).toBe(true);
    expect(database.applied.has('0004')).toBe(true);
    expect(database.applied.has('0005')).toBe(true);
    expect(database.applied.has('0006')).toBe(true);
    expect(database.applied.has('0007')).toBe(true);
    expect(database.applied.has('0008')).toBe(true);
    expect(database.applied.has('0009')).toBe(true);
    expect(database.applied.has('0010')).toBe(true);
    expect(database.applied.has('0011')).toBe(true);
    expect(database.applied.has('0012')).toBe(true);
    expect(database.applied.has('0013')).toBe(true);
    expect(database.applied.has('0014')).toBe(true);
    expect(database.applied.has('0015')).toBe(true);
    expect(database.applied.has('0016')).toBe(true);
    expect(database.applied.has('0017')).toBe(true);
    expect(database.applied.has('0018')).toBe(true);
    expect(database.applied.has('0019')).toBe(true);
    expect(database.applied.has('0020')).toBe(true);
    expect(database.applied.has('0021')).toBe(true);
    expect(database.applied.has('0022')).toBe(true);
    expect(database.applied.has('0023')).toBe(true);
    expect(database.applied.has('0024')).toBe(true);
    expect(database.applied.has('0025')).toBe(true);
    expect(database.reviewedJobAdmissionExists).toBe(true);
    expect(database.aaveCheckpointSchemaExists).toBe(true);
    expect(database.accountSchemaExists).toBe(true);
    expect(database.ledgerSchemaExists).toBe(true);
    expect(database.jobOutboxLastErrorConstraintExists).toBe(true);
    expect(database.ledgerIdempotencySchemaExists).toBe(true);
    expect(database.authenticationSchemaExists).toBe(true);
    expect(database.walletRegistrationSchemaExists).toBe(true);
    expect(database.yieldOperationSchemaExists).toBe(true);
    expect(database.ledgerFeeAdjustmentIntegrityRepaired).toBe(true);
    expect(database.queries.filter((query) => query === 'BEGIN')).toHaveLength(23);
    expect(
      database.queries.filter((query) => query.startsWith('CREATE INDEX CONCURRENTLY')),
    ).toHaveLength(2);
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();

    await expect(runner.up()).resolves.toEqual([]);
    await expect(runner.down(25)).resolves.toEqual([
      '0025',
      '0024',
      '0023',
      '0022',
      '0021',
      '0020',
      '0019',
      '0018',
      '0017',
      '0016',
      '0015',
      '0014',
      '0013',
      '0012',
      '0011',
      '0010',
      '0009',
      '0008',
      '0007',
      '0006',
      '0005',
      '0004',
      '0003',
      '0002',
      '0001',
    ]);
    expect(database.jobOutboxExists).toBe(false);
    expect(database.accountSchemaExists).toBe(false);
    expect(database.ledgerSchemaExists).toBe(false);
    expect(database.ledgerIdempotencySchemaExists).toBe(false);
    expect(database.authenticationSchemaExists).toBe(false);
    expect(database.walletRegistrationSchemaExists).toBe(false);
    expect(database.yieldOperationSchemaExists).toBe(false);
    expect(database.ledgerFeeAdjustmentIntegrityRepaired).toBe(false);
    expect(database.aaveCheckpointSchemaExists).toBe(false);
    expect(database.reviewedJobAdmissionExists).toBe(false);
    expect(database.applied.size).toBe(0);
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0001 has not been applied',
    );
    expect(database.released).toBe(true);
  });

  it('requires drift repair before rolling back a cumulative verifier', async () => {
    const database = new InMemoryMigrationDatabase();
    const runner = new MigrationRunner(database.pool, REVERSIBLE_DATABASE_MIGRATION_LIST);
    await runner.up();

    database.indexes.delete('job_outbox_failed_retention_idx');
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0003 schema verification failed',
    );
    await expect(runner.status()).rejects.toThrow(
      'Database migration 0003 schema verification failed',
    );
    await expect(runner.up()).rejects.toThrow('Database migration 0003 schema verification failed');

    await expect(runner.down(22)).rejects.toThrow(
      'Database migration 0003 schema verification failed',
    );
    expect(database.ledgerSchemaExists).toBe(true);
    database.indexes.set(
      'job_outbox_failed_retention_idx',
      "CREATE INDEX CONCURRENTLY job_outbox_failed_retention_idx ON job_outbox (failed_at, id) WHERE status = 'failed'",
    );
    await expect(runner.down(22)).resolves.toEqual([
      '0025',
      '0024',
      '0023',
      '0022',
      '0021',
      '0020',
      '0019',
      '0018',
      '0017',
      '0016',
      '0015',
      '0014',
      '0013',
      '0012',
      '0011',
      '0010',
      '0009',
      '0008',
      '0007',
      '0006',
      '0005',
      '0004',
    ]);
    await expect(runner.up()).resolves.toEqual([
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
      '0021',
      '0022',
      '0023',
      '0024',
      '0025',
    ]);
    expect(database.indexes.has('job_outbox_failed_retention_idx')).toBe(true);
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });

  it('rejects a valid same-name retention index with the wrong definition', async () => {
    const database = new InMemoryMigrationDatabase();
    const runner = new MigrationRunner(database.pool, DATABASE_MIGRATION_LIST);
    await runner.up();

    database.indexes.set(
      'job_outbox_published_retention_idx',
      "CREATE INDEX CONCURRENTLY job_outbox_published_retention_idx ON job_outbox (id) WHERE status = 'published'",
    );

    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0002 schema verification failed',
    );
  });

  it('includes non-transactional execution policy in the immutable checksum', async () => {
    const database = new InMemoryMigrationDatabase();
    await new MigrationRunner(database.pool, DATABASE_MIGRATION_LIST).up();
    const mutated = DATABASE_MIGRATION_LIST.map((migration) =>
      migration.id === '0003' ? { ...migration, transactional: true } : migration,
    );

    await expect(new MigrationRunner(database.pool, mutated).up()).rejects.toThrow(
      'Applied migration 0003 has changed',
    );
  });

  it('uses an applied checksum-valid cumulative verifier instead of its superseded verifier', async () => {
    const database = new InMemoryMigrationDatabase();
    const migrations = [
      {
        id: '1000',
        description: 'old exact allowlist',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
      {
        id: '1001',
        description: 'cumulative exact allowlist',
        upSql: 'SELECT 1001',
        downSql: 'SELECT -1001',
        verifySql: "SELECT 'new-verifier' AS verifier",
        supersedesVerificationOf: ['1000'],
      },
    ] as const;
    const runner = new MigrationRunner(database.pool, migrations);

    const freshInvalidDatabase = new InMemoryMigrationDatabase();
    freshInvalidDatabase.oldVerifierValid = false;
    await expect(new MigrationRunner(freshInvalidDatabase.pool, migrations).up()).rejects.toThrow(
      'Database migration 1000 schema verification failed',
    );
    expect(freshInvalidDatabase.applied.has('1001')).toBe(false);

    await expect(runner.up()).resolves.toEqual(['1000', '1001']);
    database.oldVerifierValid = false;
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    await expect(runner.status()).resolves.toEqual([
      { id: '1000', description: 'old exact allowlist', applied: true },
      { id: '1001', description: 'cumulative exact allowlist', applied: true },
    ]);

    database.newVerifierValid = false;
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 1001 schema verification failed',
    );

    database.newVerifierValid = true;
    await expect(runner.down(1)).rejects.toThrow(
      'Database migration 1000 schema verification failed',
    );
    expect(database.applied.has('1001')).toBe(true);
    database.oldVerifierValid = true;
    await expect(runner.down(1)).resolves.toEqual(['1001']);
    expect(database.applied.has('1001')).toBe(false);
  });

  it('checks supersession metadata in the immutable checksum', async () => {
    const database = new InMemoryMigrationDatabase();
    const migrations = [
      {
        id: '1000',
        description: 'first verifier',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
      {
        id: '1001',
        description: 'second verifier',
        upSql: 'SELECT 1001',
        downSql: 'SELECT -1001',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
      {
        id: '1002',
        description: 'cumulative verifier',
        upSql: 'SELECT 1002',
        downSql: 'SELECT -1002',
        verifySql: "SELECT 'new-verifier' AS verifier",
        supersedesVerificationOf: ['1000'],
      },
    ] as const;
    await new MigrationRunner(database.pool, migrations).up();
    const mutated = migrations.map((migration) =>
      migration.id === '1002'
        ? { ...migration, supersedesVerificationOf: ['1001'] as const }
        : migration,
    );

    await expect(new MigrationRunner(database.pool, mutated).up()).rejects.toThrow(
      'Applied migration 1002 has changed',
    );
    database.oldVerifierValid = false;
    await expect(new MigrationRunner(database.pool, mutated).up()).rejects.toThrow(
      'Database migration 1000 schema verification failed',
    );
  });

  it('snapshots migration artifacts before caching their checksums', async () => {
    const database = new InMemoryMigrationDatabase();
    const migration = {
      id: '1000',
      description: 'immutable migration snapshot',
      upSql: ['SELECT 1000'],
      downSql: ['SELECT -1000'],
      verifySql: "SELECT 'old-verifier' AS verifier",
    };
    const runner = new MigrationRunner(database.pool, [migration]);

    migration.id = '9999';
    migration.description = 'mutated after construction';
    migration.upSql[0] = 'SELECT 9999';
    migration.downSql[0] = 'SELECT -9999';
    migration.verifySql = "SELECT 'new-verifier' AS verifier";

    await expect(runner.up()).resolves.toEqual(['1000']);
    expect(database.queries).toContain('SELECT 1000');
    expect(database.queries).not.toContain('SELECT 9999');
    expect(database.queries).toContain("SELECT 'old-verifier' AS verifier");
    await expect(runner.status()).resolves.toEqual([
      { id: '1000', description: 'immutable migration snapshot', applied: true },
    ]);
  });

  it('rejects invalid or ambiguous verifier supersession declarations', () => {
    const database = new InMemoryMigrationDatabase();
    const base = {
      description: 'synthetic verifier',
      upSql: 'SELECT 1',
      downSql: 'SELECT -1',
      verifySql: "SELECT 'old-verifier' AS verifier",
    };

    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', ...base },
          { id: '1001', ...base, supersedesVerificationOf: ['1002'] },
          { id: '1002', ...base },
        ]),
    ).toThrow('can only supersede an earlier configured verifier');
    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', ...base },
          { id: '1001', ...base, supersedesVerificationOf: [] },
        ]),
    ).toThrow('must have verification SQL to supersede a verifier');
    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', ...base },
          { id: '1001', ...base, supersedesVerificationOf: ['1000'] },
          { id: '1002', ...base, supersedesVerificationOf: ['1000'] },
        ]),
    ).toThrow('is superseded more than once');
    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', description: 'no verifier', upSql: 'SELECT 1', downSql: 'SELECT -1' },
          { id: '1001', ...base, supersedesVerificationOf: ['1000'] },
        ]),
    ).toThrow('without verification SQL');
    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', ...base },
          {
            id: '1001',
            ...base,
            transactional: false,
            supersedesVerificationOf: ['1000'],
          },
        ]),
    ).toThrow('must be transactional to supersede a verifier');
  });

  it('removes rolled-back superseders from multi-step verifier selection', async () => {
    const database = new InMemoryMigrationDatabase();
    const migrations = [
      {
        id: '1000',
        description: 'base verifier',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
      {
        id: '1001',
        description: 'middle cumulative verifier',
        upSql: 'SELECT 1001',
        downSql: 'SELECT -1001',
        verifySql: "SELECT 'new-verifier' AS verifier",
        supersedesVerificationOf: ['1000'],
      },
      {
        id: '1002',
        description: 'latest cumulative verifier',
        upSql: 'SELECT 1002',
        downSql: 'SELECT -1002',
        verifySql: "SELECT 'third-verifier' AS verifier",
        supersedesVerificationOf: ['1001'],
      },
    ] as const;
    const runner = new MigrationRunner(database.pool, migrations);
    await expect(runner.up()).resolves.toEqual(['1000', '1001', '1002']);

    await expect(runner.down(2)).resolves.toEqual(['1002', '1001']);
    expect(database.applied.has('1002')).toBe(false);
    expect(database.applied.has('1001')).toBe(false);
    expect(database.applied.has('1000')).toBe(true);
    expect(
      database.queries.filter((query) => query === "SELECT 'third-verifier' AS verifier"),
    ).toHaveLength(1);
    expect(
      database.queries.filter((query) => query === "SELECT 'new-verifier' AS verifier"),
    ).toHaveLength(2);
    expect(
      database.queries.filter((query) => query === "SELECT 'old-verifier' AS verifier"),
    ).toHaveLength(2);
  });
});
