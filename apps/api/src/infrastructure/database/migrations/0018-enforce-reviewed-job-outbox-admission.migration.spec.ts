import {
  createReviewedJobOutboxAdmissionMigration,
  enforceReviewedJobOutboxAdmissionMigrationV0018,
  enforceReviewedJobOutboxAdmissionTestSchemaMigrationV0018,
} from './0018-enforce-reviewed-job-outbox-admission.migration';

function sql(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

describe('migration 0018 reviewed outbox admission', () => {
  it('replaces raw runtime inserts with one closed API capability', () => {
    const migration = enforceReviewedJobOutboxAdmissionMigrationV0018;
    const up = sql(migration.upSql);

    expect(migration.id).toBe('0018');
    expect(migration.supersedesVerificationOf).toEqual(['0017']);
    expect(up).toContain('REVOKE INSERT ON TABLE job_outbox FROM PUBLIC');
    expect(up).toContain('REVOKE INSERT (id, queue_name, payload, message_attributes');
    expect(up).toContain('CREATE FUNCTION enqueue_reviewed_job_v1(');
    expect(up).toContain('LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE');
    expect(up).toContain('SET search_path = pg_catalog');
    expect(up).toContain('SET search_path TO pg_catalog, %I, pg_temp');
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text) TO "crypto_api_runtime"',
    );
    expect(up).not.toContain(
      'GRANT EXECUTE ON FUNCTION enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text) TO "crypto_worker_runtime"',
    );
    expect(up).not.toMatch(/GRANT INSERT .*job_outbox/u);
  });

  it('pins all three version-one job shapes and their semantic bindings', () => {
    const up = sql(enforceReviewedJobOutboxAdmissionMigrationV0018.upSql);

    for (const kind of [
      'ledger.journal-committed',
      'yield.operation.submit',
      'blockchain.balance-sync',
    ]) {
      expect(up).toContain(kind);
    }
    expect(up).toContain("requested_destination IS DISTINCT FROM 'jobs'");
    expect(up).toContain("requested_envelope -> 'version' IS DISTINCT FROM '1'::jsonb");
    expect(up).toContain("'id', 'kind', 'version', 'occurredAt', 'correlation', 'payload'");
    expect(up).toContain(
      "correlation_state ->> 'ledgerEventId' IS DISTINCT FROM contract_payload ->> 'journalId'",
    );
    expect(up).toContain('command_state.outbox_id::text = requested_id');
    expect(up).toContain("command_state.operation = contract_payload ->> 'operation'");
    expect(up).toContain('journal_state.actor_account_id = command_state.actor_account_id');
    expect(up).toContain("requested_id IS DISTINCT FROM contract_payload ->> 'submissionId'");
    expect(up).toContain("correlation_state ->> 'transactionId' IS DISTINCT FROM");
    expect(up).toContain("correlation_state ->> 'quoteId' IS DISTINCT FROM");
    expect(up).toContain('FROM yield_operation_submissions AS submission_state');
    expect(up).toContain('INNER JOIN yield_operation_command_results AS result_state');
    expect(up).toContain("AND operation_state.current_state = 'SUBMITTED'");
    expect(up).toContain("AND transition_state.next_state = 'SUBMITTED'");
    expect(up).toContain("AND transition_state.reason_code = 'SUBMISSION_RECORDED'");
    expect(up).toContain('SELECT pg_catalog.max(latest_event.event_sequence)');
    expect(up).toContain("AND correlation_state ->> 'initiatorActorId' =");
    expect(up).toContain("pg_catalog.date_trunc('milliseconds', transition_state.recorded_at)");
    expect(up).toContain('FOR SHARE OF submission_state, command_state, result_state,');
    expect(up).toContain("'eip155:1'");
    expect(up).toContain("'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'");
    expect(up).toContain('FROM registered_wallets AS wallet_state');
    expect(up).toContain("AND wallet_state.status = 'ACTIVE'");
    expect(up).toContain("AND wallet_state.registry_environment = 'MAINNET'");
    expect(up).toContain('FOR SHARE OF wallet_state');
    expect(up).toContain("contract_payload ->> 'attempt' !~ '^[1-3]$'");
    expect(up).toContain(
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    );
  });

  it('uses only a fixed rejection and an atomic owner-side insert', () => {
    const up = sql(enforceReviewedJobOutboxAdmissionMigrationV0018.upSql);
    const exceptionMessages = [...up.matchAll(/RAISE EXCEPTION '([^']+)'/gu)].map(
      ([, message]) => message,
    );

    expect(exceptionMessages.length).toBeGreaterThan(5);
    expect(new Set(exceptionMessages)).toEqual(new Set(['reviewed outbox job rejected']));
    expect(up).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(up).toContain("USING ERRCODE = '22023'");
    expect(up).toContain('INSERT INTO job_outbox (');
    expect(up).toContain("'jobs',\n        requested_envelope");
    expect(up).not.toContain('EXECUTE requested_');
  });

  it('verifies exact owner, body, search path, ACL, and direct-insert denial', () => {
    const production = enforceReviewedJobOutboxAdmissionMigrationV0018;
    const isolated = enforceReviewedJobOutboxAdmissionTestSchemaMigrationV0018;
    const verifier = production.verifySql ?? '';

    expect(production.upSql).toEqual(isolated.upSql);
    expect(production.downSql).toEqual(isolated.downSql);
    expect(production.verifySql).not.toEqual(isolated.verifySql);
    expect(verifier).toContain('function_state.prosrc = $expected_admission_body$');
    expect(verifier).toContain("function_state.provolatile = 'v'");
    expect(verifier).toContain("function_state.proparallel = 'u'");
    expect(verifier).toContain("owner_role.rolname = 'crypto_schema_owner'");
    expect(verifier).toContain(
      "'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'",
    );
    expect(verifier).toContain(
      "pg_catalog.has_function_privilege(\n        'crypto_api_runtime', 'enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)', 'EXECUTE'",
    );
    expect(verifier).toContain(
      "NOT pg_catalog.has_function_privilege(\n        'crypto_worker_runtime'",
    );
    expect(verifier).toContain("NOT pg_catalog.has_function_privilege(\n        'crypto_runtime'");
    expect(verifier).toContain(
      "NOT pg_catalog.has_table_privilege('crypto_api_runtime', 'job_outbox', 'INSERT')",
    );
    expect(verifier).toContain('acl.grantee = 0');
  });

  it('restores only the predecessor API column grant on rollback', () => {
    const down = sql(enforceReviewedJobOutboxAdmissionMigrationV0018.downSql);

    expect(down).toContain(
      'REVOKE EXECUTE ON FUNCTION enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)',
    );
    expect(down).toContain(
      'DROP FUNCTION enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)',
    );
    expect(down).toContain('GRANT INSERT (');
    expect(down).toContain('ledger_command_id, ledger_journal_id');
    expect(down).toContain('ON TABLE job_outbox TO "crypto_api_runtime"');
    expect(down).not.toContain('TO "crypto_worker_runtime"');
  });

  it('rejects unsafe custom principal identifiers before producing SQL', () => {
    expect(() =>
      createReviewedJobOutboxAdmissionMigration({
        bootstrapRole: 'valid_bootstrap',
        schemaOwnerRole: 'valid_owner',
        migrationRole: 'valid_migrator',
        apiRuntimeRole: 'invalid-api',
        workerRuntimeRole: 'valid_worker',
        apiLoginPrefix: 'valid_api_login_',
        workerLoginPrefix: 'valid_worker_login_',
        legacyRuntimeRole: 'valid_legacy',
      }),
    ).toThrow('apiRuntimeRole');
  });
});
