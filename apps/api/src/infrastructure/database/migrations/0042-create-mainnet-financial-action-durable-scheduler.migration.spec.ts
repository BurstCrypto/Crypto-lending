import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createMainnetFinancialActionDurableSchedulerMigration,
  createMainnetFinancialActionDurableSchedulerMigrationV0042,
  createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042,
} from './0042-create-mainnet-financial-action-durable-scheduler.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE FUNCTION ${name}(`);
  const end = source.indexOf('$function$;', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + '$function$;'.length);
}

describe('migration 0042 durable mainnet action scheduler', () => {
  const migration = createMainnetFinancialActionDurableSchedulerMigrationV0042;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';
  const enqueue = functionBody(up, 'enqueue_mainnet_financial_action_scheduler_job_v1');
  const claim = functionBody(up, 'claim_mainnet_financial_action_scheduler_job_v1');
  const complete = functionBody(up, 'complete_mainnet_financial_action_scheduler_job_v1');
  const jobGuard = functionBody(up, 'enforce_mainnet_financial_action_scheduler_job_v1');

  it('stays outside migration registration until tail coordination', () => {
    expect(migration).toMatchObject({ id: '0042', supersedesVerificationOf: ['0040'] });
    expect(migration.transactional).not.toBe(false);
    expect(up).toContain('LOCK TABLE mainnet_financial_action_events IN ACCESS EXCLUSIVE MODE');
    expect(up).not.toContain('GRANT ');
  });

  it('creates separate durable pre-broadcast and reconciliation queues per lifecycle event', () => {
    expect(up).toContain('CREATE TABLE mainnet_financial_action_scheduler_jobs');
    expect(up).toContain('UNIQUE (source_event_id)');
    expect(up).toContain('UNIQUE (intent_id, lifecycle_revision)');
    expect(enqueue).toContain("WHEN 'PREPARED' THEN 'PRE_BROADCAST'");
    expect(enqueue).toContain("ELSE 'RECONCILIATION'");
    expect(enqueue).toContain("WHEN 'PREPARED' THEN 3 ELSE 12 END");
    expect(enqueue).toContain("source_event.stage = 'REORG_QUARANTINED'");
    expect(enqueue).toContain("manual_reason := 'LIFECYCLE_REORG_QUARANTINED'");
    expect(up).toContain('AFTER INSERT ON mainnet_financial_action_events');
    expect(up).toContain('ORDER BY intent_id, revision');
  });

  it('makes signed and UNKNOWN states reconciliation-only and supersedes older leases', () => {
    expect(up).toContain("lifecycle_stage = 'PREPARED' AND lifecycle_revision = 1");
    expect(up).toContain(
      "lifecycle_stage = 'RECONCILIATION_AMBIGUOUS'\n              AND purpose = 'RECONCILIATION_ADMISSION'",
    );
    expect(up).toContain("reconciliation_outcome IN ('PENDING', 'UNKNOWN')");
    expect(enqueue).toContain("job.job_status IN ('READY', 'LEASED')");
    expect(enqueue).toContain("job_status = 'SUPERSEDED'");
    expect(claim).toContain('later.revision > job.lifecycle_revision');
    expect(verifier).toContain("job.queue_name = 'PRE_BROADCAST'");
    expect(verifier).toContain("job.lifecycle_stage <> 'PREPARED'");
  });

  it('authors every lease field in the database and increments a uint64 fence', () => {
    expect(claim).toContain("pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())");
    expect(claim).toContain('database_lease_id := pg_catalog.gen_random_uuid()');
    expect(claim).toContain('fencing_token = job.fencing_token + 1');
    expect(claim).toContain('attempt_count = job.attempt_count + 1');
    expect(claim).toContain('FOR UPDATE OF job SKIP LOCKED LIMIT 1');
    expect(claim).toContain("THEN 'LEASE_RECOVERED' ELSE 'CLAIMED'");
    expect(claim).toContain('requested_lease_milliseconds < 1000');
    expect(claim).toContain('requested_lease_milliseconds > 900000');
    expect(claim).not.toContain('requested_lease_id');
    expect(claim).not.toContain('requested_claimed_at');
    expect(up).toContain(`fencing_token BETWEEN 0 AND 18446744073709551615::numeric`);
  });

  it('uses exact lease/cursor CAS and preserves exact lost-ACK replay only', () => {
    for (const marker of [
      'changed_job.account_id IS DISTINCT FROM requested_account_id',
      'changed_job.intent_id IS DISTINCT FROM requested_intent_id',
      'changed_job.queue_name IS DISTINCT FROM requested_queue_name',
      'changed_job.lifecycle_revision IS DISTINCT FROM requested_lifecycle_revision',
      'changed_job.lifecycle_snapshot_sha256 IS DISTINCT FROM',
      'changed_job.lease_id IS DISTINCT FROM requested_lease_id',
      'changed_job.fencing_token IS DISTINCT FROM requested_fencing_token',
      'changed_job.state_version = changed_job.last_completion_state_version',
      'changed_job.last_requested_disposition = requested_disposition',
      "USING ERRCODE = '40001'",
    ]) {
      expect(complete).toContain(marker);
    }
    expect(complete).toContain("RETURN QUERY SELECT 'REPLAYED'::text");
  });

  it('recaptures database time only after the completion row lock', () => {
    const rowLock = complete.indexOf('WHERE job.job_id = requested_job_id FOR UPDATE');
    const postLockTime = complete.indexOf(
      "database_now := pg_catalog.date_trunc(\n        'milliseconds', pg_catalog.clock_timestamp()",
      rowLock,
    );
    const cursorDecision = complete.indexOf(
      'changed_job.account_id IS DISTINCT FROM requested_account_id',
      rowLock,
    );
    const expiryDecision = complete.indexOf(
      'changed_job.lease_expires_at <= database_now',
      rowLock,
    );
    expect(rowLock).toBeGreaterThanOrEqual(0);
    expect(postLockTime).toBeGreaterThan(rowLock);
    expect(cursorDecision).toBeGreaterThan(postLockTime);
    expect(expiryDecision).toBeGreaterThan(cursorDecision);
    expect(complete.slice(0, rowLock)).not.toContain('database_now := pg_catalog.date_trunc');
  });

  it('delays release without a caller timestamp and quarantines exhausted work', () => {
    expect(complete).toContain("THEN interval '250 milliseconds'");
    expect(complete).toContain("ELSE interval '1 second'");
    expect(complete).toContain("completion_outcome := 'ATTEMPT_LIMIT_REACHED'");
    expect(complete).toContain("next_status := 'MANUAL_REVIEW'");
    expect(up).toContain('CREATE TABLE mainnet_financial_action_scheduler_manual_reviews');
    expect(up).toContain('UNIQUE (job_id)');
    expect(up).not.toContain('DELETE FROM mainnet_financial_action_scheduler_jobs');
  });

  it('stores immutable audit and manual-review history with no action authority', () => {
    expect(up).toContain('CREATE TABLE mainnet_financial_action_scheduler_events');
    expect(up).toContain('UNIQUE (job_id, state_version)');
    expect(up).toContain('reject_mainnet_action_history_mutation()');
    expect(up.match(/ENABLE ALWAYS TRIGGER/gu)).toHaveLength(9);
    expect(
      up.match(/may_authorize_financial_action boolean NOT NULL DEFAULT false/gu),
    ).toHaveLength(3);
    for (const forbidden of [
      'raw_signed',
      'signed_envelope',
      'wallet_address',
      'private_key',
      'credential',
      'endpoint',
      'rpc_url',
    ]) {
      expect(up).not.toContain(forbidden);
    }
  });

  it('frames every fingerprint timestamp as epoch milliseconds', () => {
    expect(jobGuard).toContain('extract(epoch FROM NEW.claimed_at) * 1000');
    expect(jobGuard).toContain('extract(epoch FROM NEW.available_at) * 1000');
    expect(jobGuard).toContain('extract(epoch FROM NEW.updated_at) * 1000');
    expect(jobGuard).not.toContain('NEW.updated_at::text');
    expect(verifier).toContain('extract(epoch FROM job.updated_at) * 1000');
    expect(verifier).toContain('extract(epoch FROM audit.recorded_at) * 1000');
    expect(verifier).toContain('extract(epoch FROM manual.recorded_at) * 1000');
  });

  it('pins exact PG16 catalogs, ordered argument types, ACLs, and data continuity', () => {
    for (const marker of [
      'SCHEDULER',
      'pg_catalog.pg_get_constraintdef(oid, false)',
      'pg_catalog.pg_get_indexdef(index_record.indexrelid)',
      'pg_catalog.pg_attrdef',
      'procedure.proargnames[1:procedure.pronargs]',
      'FROM pg_catalog.unnest(procedure.proargtypes::oid[])',
      'WITH ORDINALITY AS input(input_type, ordinal) ORDER BY ordinal',
      "language.lanname = 'plpgsql'",
      'acl.grantee <> procedure.proowner',
      'acl.grantee <> relation.relowner',
      'trigger_record.tgtype = expected.trigger_type',
      'history_state.audit_count <> job.state_version',
      'audit.audit_fingerprint_sha256 IS DISTINCT FROM',
      'manual.case_fingerprint_sha256 IS DISTINCT FROM',
      'pg_catalog.lag(audit.job_status) OVER history',
      "audit.transition = 'LEASE_RECOVERED'",
      'audit.attempt_count = audit.previous_attempt + 1',
      'audit.subject_lease_id IS DISTINCT FROM audit.previous_subject_lease_id',
      "audit.source_stage = 'REORG_QUARANTINED'",
      'audit.subject_lease_id IS DISTINCT FROM job.last_completion_lease_id',
    ]) {
      expect(verifier).toContain(marker);
    }
  });

  it('keeps all scheduler state and entry points owner-only with fixed paths', () => {
    expect(up.match(/REVOKE ALL ON FUNCTION/gu)).toHaveLength(7);
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TABLE mainnet_financial_action_scheduler_jobs,');
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TYPE mainnet_financial_action_scheduler_jobs,');
    expect(up.match(/SET search_path TO pg_catalog, %I, pg_temp/gu)).toHaveLength(7);
  });

  it('refuses destructive rollback after any durable scheduler history', () => {
    expect(down).toContain('LOCK TABLE mainnet_financial_action_events,');
    expect(down).toContain("RAISE EXCEPTION 'cannot roll back durable mainnet scheduler history'");
    expect(down).toContain('IF EXISTS (SELECT 1 FROM mainnet_financial_action_scheduler_jobs)');
    expect(down.match(/DROP TRIGGER/gu)).toHaveLength(9);
    expect(down.match(/DROP FUNCTION/gu)).toHaveLength(7);
    expect(down.match(/DROP TABLE/gu)).toHaveLength(3);
  });

  it('shares DDL with the isolated test variant and rejects unsafe principal names', () => {
    expect(migration.upSql).toEqual(
      createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.verifySql,
    );
    expect(() =>
      createMainnetFinancialActionDurableSchedulerMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        migrationRole: 'unsafe-role',
      }),
    ).toThrow('migrationRole');
  });
});
