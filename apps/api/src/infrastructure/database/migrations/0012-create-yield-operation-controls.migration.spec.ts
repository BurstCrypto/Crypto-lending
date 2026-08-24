import {
  createYieldOperationControlsMigration,
  createYieldOperationControlsMigrationV0012,
  createYieldOperationControlsTestSchemaMigrationV0012,
} from './0012-create-yield-operation-controls.migration';

const joinedSql = (value: string | readonly string[]): string =>
  typeof value === 'string' ? value : value.join('\n');

describe('createYieldOperationControlsMigration', () => {
  it('publishes matching production and isolated DDL with cumulative verification', () => {
    const canonical = createYieldOperationControlsMigrationV0012;
    const isolated = createYieldOperationControlsTestSchemaMigrationV0012;

    expect(canonical.id).toBe('0012');
    expect(canonical.description).toContain('yield operation');
    expect(canonical.upSql).toEqual(isolated.upSql);
    expect(canonical.downSql).toEqual(isolated.downSql);
    expect(canonical.verifySql).not.toEqual(isolated.verifySql);
    expect(canonical.supersedesVerificationOf).toEqual(['0011']);
  });

  it('binds every immutable audit event to actor, time, reason, and ledger references', () => {
    const sql = joinedSql(createYieldOperationControlsMigrationV0012.upSql);
    const events = sql.slice(
      sql.indexOf('CREATE TABLE yield_operation_transition_events'),
      sql.indexOf('CREATE TABLE yield_operation_commands'),
    );

    expect(events).toContain('actor_account_id uuid NOT NULL');
    expect(events).toContain('reason_code text NOT NULL');
    expect(events).toContain('effective_at timestamptz NOT NULL');
    expect(events).toContain('recorded_at timestamptz NOT NULL');
    expect(events).toContain('correlation_id uuid NOT NULL');
    expect(events).toContain('ledger_transaction_id uuid NOT NULL');
    expect(events).toContain('ledger_journal_id uuid');
    expect(events).toContain('yield_transition_event_ledger_event_fk');
    expect(events).toContain('yield_transition_event_journal_shape_check');
  });

  it('uses the canonical ledger transition function and state/reason vocabulary', () => {
    const sql = joinedSql(createYieldOperationControlsMigrationV0012.upSql);

    expect(sql).toContain('transition_ledger_transaction_state(');
    expect(sql).toContain("'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED'");
    expect(sql).toContain("'SUBMISSION_RECORDED', 'OUTCOME_PENDING', 'SETTLEMENT_RECORDED'");
    expect(sql).not.toContain("'DEPOSITING'");
    expect(sql).not.toContain("'WITHDRAWING'");
  });

  it('scopes hashed idempotency keys to actor and rejects fingerprint reuse', () => {
    const sql = joinedSql(createYieldOperationControlsMigrationV0012.upSql);
    const claim = sql.slice(
      sql.indexOf('CREATE FUNCTION claim_yield_operation_command'),
      sql.indexOf('CREATE FUNCTION yield_operation_command_result'),
    );

    expect(sql).toContain('actor_account_id, command_kind, contract_version, key_digest');
    expect(sql).toContain('octet_length(key_digest) = 32');
    expect(sql).toContain('octet_length(request_fingerprint) = 32');
    expect(claim).toContain('ON CONFLICT');
    expect(claim).toContain('FOR UPDATE');
    expect(claim).toContain("USING ERRCODE = 'Y8601'");
    expect(sql).not.toMatch(/\n\s+idempotency_key\s+text/iu);
  });

  it('replays the immutable command snapshot after later operation progress', () => {
    const sql = joinedSql(createYieldOperationControlsMigrationV0012.upSql);
    const resultProjection = sql.slice(
      sql.indexOf('CREATE FUNCTION yield_operation_command_result'),
      sql.indexOf('CREATE FUNCTION create_yield_operation'),
    );

    expect(resultProjection).toContain('transition_state.next_state AS current_state');
    expect(resultProjection).not.toContain('operation_state.current_state');
  });

  it('makes submit and its single outbox request one deferred atomic unit', () => {
    const sql = joinedSql(createYieldOperationControlsMigrationV0012.upSql);

    expect(sql).toContain('yield_operation_submissions_operation_unique');
    expect(sql).toContain('yield_operation_submissions_command_unique');
    expect(sql).toContain('yield_operation_submissions_outbox_unique');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('yield submission command must atomically enqueue one outbox job');
    expect(sql).toContain("requested_next_state = 'SUBMITTED'");
    expect(sql).toContain("'PROVIDER_OR_CHAIN_ADAPTER'");
  });

  it('keeps audit/idempotency/submission rows append-only and grants only boundary functions', () => {
    const custom = createYieldOperationControlsMigration({
      bootstrapRole: 'yield_bootstrap',
      schemaOwnerRole: 'yield_owner',
      migrationRole: 'yield_migrator',
      legacyRuntimeRole: 'yield_legacy',
      apiRuntimeRole: 'yield_api',
      workerRuntimeRole: 'yield_worker',
      apiLoginPrefix: 'yield_api_login_',
      workerLoginPrefix: 'yield_worker_login_',
    });
    const sql = joinedSql(custom.upSql);
    const grants = sql.match(/GRANT EXECUTE ON FUNCTION [^;]+ TO "yield_api";/gu) ?? [];

    expect(grants).toHaveLength(2);
    expect(sql).toContain('yield operation audit records are append-only');
    expect(sql).toContain('ENABLE ALWAYS TRIGGER yield_operation_transition_append_only_row');
    expect(sql).toContain('ENABLE ALWAYS TRIGGER yield_operation_command_complete_insert');
    expect(sql).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON TABLE/u);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]+TO "yield_worker"/u);
  });

  it('extends cumulative principal verification for exact tables and functions', () => {
    const canonical = createYieldOperationControlsMigrationV0012.verifySql ?? '';
    const isolated = createYieldOperationControlsTestSchemaMigrationV0012.verifySql ?? '';

    expect(canonical).toContain('prior.valid AND yield_operation.valid');
    expect(canonical).toContain('complete_wallet_registration');
    expect(canonical).toContain('yield_operation_row_table');
    expect(canonical).toContain('transition_yield_operation');
    expect(canonical).toContain('yield_operation_commands_outbox_fk');
    expect(isolated).toContain('prior.valid AND yield_operation.valid');
    expect(isolated).not.toContain('yield_operation_row_table');
  });

  it('refuses destructive rollback once financial operation evidence exists', () => {
    const sql = joinedSql(createYieldOperationControlsMigrationV0012.downSql);

    expect(sql).toContain('cannot roll back retained yield operation audit state');
    expect(sql).toContain('EXISTS (SELECT 1 FROM yield_operations)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM yield_operation_transition_events)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM yield_operation_submissions)');
  });
});
