import {
  createProviderPositionChainAnchorRecordDeadlineMigration,
  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,
  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,
} from './0030-enforce-provider-position-chain-anchor-record-deadline.migration';
import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function count(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('migration 0030 provider position record deadline', () => {
  it('supersedes 0029 as one transactional dormant migration', () => {
    const migration = enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030;

    expect(migration.id).toBe('0030');
    expect(migration.supersedesVerificationOf).toEqual(['0029']);
    expect(migration.transactional).not.toBe(false);
    expect(migration.description).toContain('producer deadlines');
    expect(migration.description).toContain('reconciliation');
  });

  it('locks out the old writer before refusing unbound 0029 history', () => {
    const up = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.upSql);
    const lock = up.indexOf(
      'LOCK TABLE provider_position_chain_anchor_evidence IN ACCESS EXCLUSIVE MODE;',
    );
    const historyRead = up.indexOf(
      'IF EXISTS (SELECT 1 FROM provider_position_chain_anchor_evidence)',
    );
    const tableCreate = up.indexOf(
      'CREATE TABLE provider_position_chain_anchor_record_deadlines (',
    );

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(historyRead).toBeGreaterThan(lock);
    expect(tableCreate).toBeGreaterThan(historyRead);
    expect(up).toContain(
      'cannot install provider position chain anchor deadlines after evidence exists',
    );
    expect(up).toContain("USING ERRCODE = '55000';");
  });

  it('stores a domain-separated immutable deadline binding without wallet PII', () => {
    const up = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.upSql);
    const table = between(
      up,
      'CREATE TABLE provider_position_chain_anchor_record_deadlines (',
      'COMMENT ON TABLE provider_position_chain_anchor_record_deadlines',
    );

    for (const column of [
      'deadline_binding_sha256 text NOT NULL',
      'evidence_fingerprint_sha256 text NOT NULL',
      'deadline_binding_version smallint NOT NULL',
      'deadline_binding_use text NOT NULL',
      'may_authorize_financial_action boolean NOT NULL',
      'may_persist boolean NOT NULL',
      'producer_deadline_at timestamptz NOT NULL',
      'evidence_recorded_at timestamptz NOT NULL',
    ]) {
      expect(table).toContain(column);
    }
    expect(table).not.toMatch(/\b(?:account_id|wallet_id|address_|ciphertext)\b/u);
    expect(up).toContain(
      "'crypto-lending:provider-position-chain-anchor-record-deadline-binding:v1'",
    );
    expect(up).toContain(
      "requested_deadline_binding_use = 'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_DEADLINE_ONLY'",
    );
    expect(up).toContain('requested_may_authorize_financial_action = false');
    expect(up).toContain('requested_may_persist = false');
    expect(up).toContain('requested_evidence_recorded_at < requested_producer_deadline_at');
    expect(up).toContain(
      'requested_deadline_binding_sha256 =\n        provider_position_chain_anchor_record_deadline_fingerprint(',
    );
    expect(table).toContain(') IS TRUE\n      )\n    );');
    expect(up).toContain('no-wallet-pii;append-only');
  });

  it('closes the old owner-writer bypass with circular evidence integrity', () => {
    const up = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.upSql);
    const sidecarForeignKey = between(
      up,
      'CONSTRAINT provider_position_chain_anchor_deadline_evidence_fk',
      'CONSTRAINT provider_position_chain_anchor_deadline_valid_check',
    );
    const reverseForeignKey = between(
      up,
      'ADD CONSTRAINT provider_position_chain_anchor_evidence_deadline_fk',
      'CREATE TRIGGER provider_position_chain_anchor_deadline_append_only_row',
    );

    expect(sidecarForeignKey).toContain(
      'REFERENCES provider_position_chain_anchor_evidence (evidence_fingerprint_sha256)',
    );
    expect(sidecarForeignKey).toContain('ON UPDATE NO ACTION ON DELETE NO ACTION');
    expect(reverseForeignKey).toContain(
      'REFERENCES provider_position_chain_anchor_record_deadlines (evidence_fingerprint_sha256)',
    );
    expect(reverseForeignKey).toContain('ON UPDATE NO ACTION ON DELETE NO ACTION');
    expect(reverseForeignKey).toContain('DEFERRABLE INITIALLY DEFERRED');
  });

  it('makes deadline bindings append-only under the existing always trigger', () => {
    const up = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.upSql);

    expect(count(up, 'ENABLE ALWAYS TRIGGER')).toBe(2);
    expect(up).toContain(
      'BEFORE UPDATE OR DELETE ON provider_position_chain_anchor_record_deadlines',
    );
    expect(up).toContain('BEFORE TRUNCATE ON provider_position_chain_anchor_record_deadlines');
    expect(count(up, 'reject_provider_position_chain_anchor_history_mutation()')).toBe(2);
  });

  it('installs only an exact owner-only deadline-bound record/reconcile function', () => {
    const up = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.upSql);
    const guardedIdentity =
      'record_provider_position_chain_anchor_evidence_guarded(text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone,jsonb,timestamp with time zone,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text)';

    expect(up).toContain('requested_producer_deadline_at timestamptz');
    expect(up).toContain('requested_operation text');
    expect(up).toContain(') LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE');
    expect(up).toContain(
      `ALTER FUNCTION %I.${guardedIdentity} SET search_path TO pg_catalog, %I, pg_temp`,
    );
    expect(up).toContain(`REVOKE ALL ON FUNCTION ${guardedIdentity} FROM PUBLIC`);
    expect(up).not.toContain('GRANT');
    expect(up).toContain(
      'FROM PUBLIC, "crypto_api_runtime", "crypto_worker_runtime", "crypto_runtime", "crypto_balance_consumer_runtime", "crypto_migration";',
    );
  });

  it('serializes before reading and never calls the old writer for replay or reconciliation', () => {
    const up = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.upSql);
    const guarded = between(
      up,
      'CREATE FUNCTION record_provider_position_chain_anchor_evidence_guarded(',
      'DO $set_provider_position_chain_anchor_deadline_path$',
    );
    const isolation = guarded.indexOf(
      "pg_catalog.current_setting('transaction_isolation') <> 'read committed'",
    );
    const advisoryLock = guarded.indexOf(
      'pg_catalog.hashtextextended(requested_read_binding_fingerprint, 56029)',
    );
    const startClock = guarded.indexOf(
      "database_started_at := pg_catalog.date_trunc(\n        'milliseconds', pg_catalog.clock_timestamp()",
    );
    const existingRead = guarded.indexOf('SELECT evidence.* INTO prior', startClock);
    const replayReturn = guarded.indexOf(
      "RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text",
      existingRead,
    );
    const reconcileAbsence = guarded.indexOf(
      "IF requested_operation = 'RECONCILE_ONLY'",
      replayReturn,
    );
    const oldWriter = guarded.indexOf(
      'FROM record_provider_position_chain_anchor_evidence(',
      reconcileAbsence,
    );
    const preWriter = guarded.slice(advisoryLock, oldWriter);

    expect(isolation).toBeGreaterThanOrEqual(0);
    expect(guarded).toContain('provider_position_chain_anchor_evidence_row_valid(');
    expect(guarded).toContain(
      "requested_read_binding_fingerprint,\n        1::smallint,\n        'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_ONLY'",
    );
    expect(guarded).not.toContain(
      "requested_read_binding_fingerprint,\n        1,\n        'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_ONLY'",
    );
    expect(guarded).toContain(') IS DISTINCT FROM true');
    expect(advisoryLock).toBeGreaterThan(isolation);
    expect(startClock).toBeGreaterThan(advisoryLock);
    expect(existingRead).toBeGreaterThan(startClock);
    expect(replayReturn).toBeGreaterThan(existingRead);
    expect(reconcileAbsence).toBeGreaterThan(replayReturn);
    expect(oldWriter).toBeGreaterThan(reconcileAbsence);
    expect(preWriter).not.toContain('FOR UPDATE');
    expect(preWriter).not.toContain('FOR SHARE');
    expect(preWriter).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/u);
    expect(preWriter).not.toContain('record_provider_position_chain_anchor_evidence(');
    expect(count(guarded, 'FROM record_provider_position_chain_anchor_evidence(')).toBe(1);
    expect(guarded).toContain(
      "IF requested_operation = 'RECONCILE_ONLY'\n        OR database_started_at >= requested_producer_deadline_at",
    );
  });

  it('rolls both inserts back when the database crosses the exclusive deadline', () => {
    const up = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.upSql);
    const guarded = between(
      up,
      'CREATE FUNCTION record_provider_position_chain_anchor_evidence_guarded(',
      'DO $set_provider_position_chain_anchor_deadline_path$',
    );
    const writer = guarded.indexOf('FROM record_provider_position_chain_anchor_evidence(');
    const bindingInsert = guarded.indexOf(
      'INSERT INTO provider_position_chain_anchor_record_deadlines',
      writer,
    );
    const completionClock = guarded.indexOf('database_completed_at :=', bindingInsert);
    const sentinel = guarded.indexOf("USING ERRCODE = 'P0030';", completionClock);
    const handler = guarded.indexOf("WHEN SQLSTATE 'P0030' THEN", sentinel);
    const rejected = guarded.indexOf("RETURN QUERY SELECT 'NOT_RECORDED'::text", handler);

    expect(bindingInsert).toBeGreaterThan(writer);
    expect(completionClock).toBeGreaterThan(bindingInsert);
    expect(sentinel).toBeGreaterThan(completionClock);
    expect(handler).toBeGreaterThan(sentinel);
    expect(rejected).toBeGreaterThan(handler);
    expect(guarded).toContain('database_completed_at < database_started_at');
    expect(guarded).toContain('database_completed_at < stored_recorded_at');
    expect(guarded).toContain('database_completed_at >= requested_producer_deadline_at');
    expect(guarded).toContain('stored_recorded_at >= requested_producer_deadline_at');
  });

  it('reconciles only exact evidence and its original durable deadline', () => {
    const up = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.upSql);
    const guarded = between(
      up,
      'CREATE FUNCTION record_provider_position_chain_anchor_evidence_guarded(',
      'DO $set_provider_position_chain_anchor_deadline_path$',
    );

    for (const comparison of [
      'prior.evidence_fingerprint_sha256 IS DISTINCT FROM requested_fingerprint',
      'prior.continuity_floor IS DISTINCT FROM requested_continuity_floor',
      'prior.chain_anchor IS DISTINCT FROM requested_chain_anchor',
      'prior.agreed_current_head IS DISTINCT FROM requested_agreed_current_head',
      'prior.agreed_finalized_head IS DISTINCT FROM requested_agreed_finalized_head',
      'prior.identity_proof_sha256 IS DISTINCT FROM requested_identity_proof_sha256',
      'prior.live_capability_proof_sha256',
      'prior.lineage_proof_sha256 IS DISTINCT FROM requested_lineage_proof_sha256',
      'prior.source_pair_approval_expires_at',
    ]) {
      expect(guarded).toContain(comparison);
    }
    expect(guarded).toContain('provider position chain anchor evidence reconciliation conflict');
    expect(guarded).toContain("USING ERRCODE = '23505';");
    expect(guarded).toContain(
      'deadline_binding.evidence_recorded_at IS DISTINCT FROM prior.recorded_at',
    );
    expect(guarded).toContain(
      'deadline_binding.producer_deadline_at\n            IS DISTINCT FROM requested_producer_deadline_at',
    );
    expect(guarded).toContain("RETURN QUERY SELECT 'DEADLINE_VIOLATION'::text");
    expect(guarded).toContain("RETURN QUERY SELECT 'NOT_RECORDED'::text");
    expect(guarded).toContain("RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text");
  });

  it('cumulatively pins the sidecar, circular constraints, functions, triggers, and ACLs', () => {
    const verifier = enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.verifySql ?? '';

    expect(verifier).toContain('SELECT pg_catalog.count(*) = 7');
    expect(verifier).toContain(
      "relation.relname = 'provider_position_chain_anchor_record_deadlines'",
    );
    expect(verifier).toContain('SELECT pg_catalog.count(*) = 8');
    expect(verifier).toContain("WHEN 'provider_position_chain_anchor_evidence_deadline_fk' THEN");
    expect(verifier).toContain('constraint_state.condeferrable');
    expect(verifier).toContain('constraint_state.condeferred');
    expect(verifier).toContain('procedure.pronargs = 25');
    expect(verifier).toContain('pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc');
    expect(verifier).toContain(
      "NOT pg_catalog.has_function_privilege('crypto_api_runtime', 'record_provider_position_chain_anchor_evidence_guarded(",
    );
    expect(verifier).toContain(
      "NOT pg_catalog.has_table_privilege('crypto_balance_consumer_runtime', 'provider_position_chain_anchor_record_deadlines'",
    );
    expect(verifier).toContain("trigger.tgattr = ''::pg_catalog.int2vector");
  });

  it('shares DDL with isolated schemas while preserving cumulative verification', () => {
    const canonical = enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030;
    const isolated = enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030;

    expect(isolated.upSql).toEqual(canonical.upSql);
    expect(isolated.downSql).toEqual(canonical.downSql);
    expect(isolated.verifySql).not.toEqual(canonical.verifySql);
    expect(isolated.verifySql).toContain('SELECT true AS valid');
  });

  it('validates principal identities through the 0029 predecessor contract', () => {
    expect(() =>
      createProviderPositionChainAnchorRecordDeadlineMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        migrationRole: 'unsafe-role',
      }),
    ).toThrow('migrationRole');
  });

  it('refuses unsafe rollback and removes only 0030 objects when empty', () => {
    const down = sql(enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030.downSql);

    expect(down).toContain(
      'LOCK TABLE provider_position_chain_anchor_evidence,\n      provider_position_chain_anchor_control_events,\n      provider_position_chain_anchor_record_deadlines\n      IN ACCESS EXCLUSIVE MODE;',
    );
    expect(down).toContain('IF EXISTS (SELECT 1 FROM provider_position_chain_anchor_evidence)');
    expect(down).toContain(
      'OR EXISTS (SELECT 1 FROM provider_position_chain_anchor_control_events)',
    );
    expect(down).toContain(
      'OR EXISTS (SELECT 1 FROM provider_position_chain_anchor_record_deadlines)',
    );
    expect(down).toContain('cannot roll back provider position chain anchor deadlines after use');
    expect(down).toContain("USING ERRCODE = '55000';");
    expect(down).toContain('DROP CONSTRAINT provider_position_chain_anchor_evidence_deadline_fk;');
    expect(down).toContain('DROP FUNCTION record_provider_position_chain_anchor_evidence_guarded(');
    expect(down).not.toContain('GRANT');
    expect(down).not.toContain('DROP FUNCTION record_provider_position_chain_anchor_evidence(');
  });
});
