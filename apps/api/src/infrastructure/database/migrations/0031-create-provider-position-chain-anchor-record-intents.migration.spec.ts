import {
  createProviderPositionChainAnchorRecordIntentMigration,
  createProviderPositionChainAnchorRecordIntentMigrationV0031,
  createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031,
} from './0031-create-provider-position-chain-anchor-record-intents.migration';
import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

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

function assertCriticalIntentContract(up: string, verifier: string): void {
  expect(up).toContain(
    'LOCK TABLE provider_position_chain_anchor_evidence, provider_position_chain_anchor_record_deadlines IN ACCESS EXCLUSIVE MODE;',
  );
  expect(up).toContain('CONSTRAINT provider_chain_anchor_intent_evidence_deadline_unique');
  expect(up).toContain('UNIQUE (evidence_fingerprint_sha256, producer_deadline_at)');
  expect(up).toContain('FOR UPDATE SKIP LOCKED');
  expect(up).toContain("'RECONCILE_ONLY'");
  expect(up).toContain(
    'CREATE CONSTRAINT TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check',
  );
  expect(up).toContain('DEFERRABLE INITIALLY DEFERRED');
  expect(up).toContain(
    'ALTER TABLE provider_position_chain_anchor_record_deadlines ENABLE ALWAYS TRIGGER',
  );
  expect(up).not.toContain('GRANT ');
  expect(verifier).toContain('procedure.proisstrict = expected.strict_function');
  expect(verifier).toContain('trigger.tgdeferrable = expected.constraint_trigger');
  expect(verifier).toContain('pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc');
  expect(verifier).toContain(
    'index_state.indoption = expected.index_options::pg_catalog.int2vector',
  );
  expect(verifier).toContain('operator_class.opcname');
  expect(verifier).toContain('NOT index_state.indnullsnotdistinct');
  expect(verifier).toContain('index_state.indcollation[key_position]');
  expect(verifier).toContain('expected.predicate_expression');
}

describe('migration 0031 provider position chain anchor record intents', () => {
  const migration = createProviderPositionChainAnchorRecordIntentMigrationV0031;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';

  it('supersedes 0030 and registers both variants immediately before 0032', () => {
    expect(migration.id).toBe('0031');
    expect(migration.supersedesVerificationOf).toEqual(['0030']);
    expect(migration.transactional).not.toBe(false);
    expect(migration.description).toContain('one-shot');
    expect(migration.description).toContain('source-only reconciliation');
    expect(DATABASE_MIGRATION_LIST.at(-4)).toBe(
      createProviderPositionChainAnchorRecordIntentMigrationV0031,
    );
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-4)).toBe(
      createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031,
    );
    expect(DATABASE_MIGRATION_LIST.map(({ id }) => id).slice(-6)).toEqual([
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
    ]);
  });

  it('keeps every declared PostgreSQL object identifier within the 63-byte limit', () => {
    const declaredIdentifiers = Array.from(
      up.matchAll(
        /\b(?:CREATE\s+(?:FUNCTION|TABLE)|CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+(?:CONSTRAINT\s+)?TRIGGER|(?:ADD\s+)?CONSTRAINT)\s+([a-z][a-z0-9_]*)/gu,
      ),
      (match) => match[1] ?? '',
    );

    expect(declaredIdentifiers.length).toBeGreaterThan(20);
    expect(
      declaredIdentifiers
        .map((name) => [name, Buffer.byteLength(name, 'utf8')] as const)
        .filter(([, byteLength]) => byteLength > 63),
    ).toEqual([]);
  });

  it('takes the old-writer locks and refuses unrecoverable evidence or deadline history', () => {
    const lock = up.indexOf(
      'LOCK TABLE provider_position_chain_anchor_evidence, provider_position_chain_anchor_record_deadlines IN ACCESS EXCLUSIVE MODE;',
    );
    const evidence = up.indexOf(
      'IF EXISTS (SELECT 1 FROM provider_position_chain_anchor_evidence)',
    );
    const deadline = up.indexOf(
      'OR EXISTS (SELECT 1 FROM provider_position_chain_anchor_record_deadlines)',
    );
    const table = up.indexOf('CREATE TABLE provider_position_chain_anchor_record_intents (');

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(evidence).toBeGreaterThan(lock);
    expect(deadline).toBeGreaterThan(evidence);
    expect(table).toBeGreaterThan(deadline);
    expect(up).toContain(
      'cannot install provider position chain anchor record intents after record history exists',
    );
    expect(up).toContain("USING ERRCODE = '55000';");
  });

  it('stores a retained no-PII header with exact typed 0029 evidence fields', () => {
    const table = between(
      up,
      'CREATE TABLE provider_position_chain_anchor_record_intents (',
      'COMMENT ON TABLE provider_position_chain_anchor_record_intents',
    );

    for (const column of [
      'record_intent_fingerprint_sha256 text NOT NULL',
      'evidence_fingerprint_sha256 text NOT NULL',
      'read_binding_fingerprint_sha256 text NOT NULL',
      'record_intent_version smallint NOT NULL',
      'record_intent_use text NOT NULL',
      'may_authorize_financial_action boolean NOT NULL',
      'may_persist boolean NOT NULL',
      'prepared_at timestamptz NOT NULL',
      'producer_deadline_at timestamptz NOT NULL',
      'network_id text NOT NULL',
      'source_observation_id text NOT NULL',
      'continuity_floor jsonb NOT NULL',
      'chain_anchor jsonb NOT NULL',
      'assessed_at timestamptz NOT NULL',
      'identity_proof_sha256 text NOT NULL',
      'live_capability_proof_sha256 text NOT NULL',
      'lineage_proof_sha256 text NOT NULL',
      'source_pair_approval_expires_at timestamptz NOT NULL',
      'record_state text NOT NULL',
      'record_dispatch_count smallint NOT NULL',
      'reconciliation_attempt_count bigint NOT NULL',
    ]) {
      expect(table).toContain(column);
    }
    expect(table).not.toMatch(
      /\b(?:account_id|wallet_id|address_|correlation_id|request_id|actor_id|endpoint|credential|raw_token|raw_error|payload|envelope)\b/u,
    );
    expect(up).toContain('no-wallet-pii;retained;one-shot');
    expect(up).toContain(
      "requested_record_intent_use = 'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_ONLY'",
    );
    expect(up).toContain('requested_may_authorize_financial_action = false');
    expect(up).toContain('requested_may_persist = false');
  });

  it('domain-separates immutable intent and fixed binary token fingerprints', () => {
    expect(up).toContain("'crypto-lending:provider-position-chain-anchor-record-intent:v1'");
    expect(up).toContain(
      "'crypto-lending:provider-position-chain-anchor-record-dispatch-token:v1'",
    );
    expect(up).toContain(
      "'crypto-lending:provider-position-chain-anchor-reconciliation-lease-token:v1'",
    );
    expect(up).toContain('requested_record_intent_fingerprint_sha256,');
    expect(up).toContain("pg_catalog.encode(requested_raw_dispatch_token, 'hex')");
    expect(up).toContain("pg_catalog.encode(requested_raw_lease_token, 'hex')");
    expect(up).toContain('requested_raw_dispatch_token bytea');
    expect(up).toContain('requested_raw_lease_token bytea');
    expect(up).toContain('pg_catalog.octet_length(requested_raw_dispatch_token) <> 32');
    expect(up).toContain('pg_catalog.octet_length(requested_raw_lease_token) <> 32');
    expect(up).toContain("pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')");
    expect(up).toContain(
      'CREATE UNIQUE INDEX provider_position_chain_anchor_record_dispatch_token_unique',
    );
    expect(up).toContain(
      'CREATE UNIQUE INDEX provider_chain_anchor_reconciliation_lease_token_unique',
    );
  });

  it('reconstructs the exact 0029 row-valid argument order', () => {
    const header = between(
      up,
      'CREATE FUNCTION provider_position_chain_anchor_record_intent_header_valid(',
      'CREATE FUNCTION provider_position_chain_anchor_record_intent_lifecycle_valid(',
    );
    const rowValid = header.indexOf('provider_position_chain_anchor_evidence_row_valid(');
    const lineage = header.indexOf('requested_lineage_proof_sha256', rowValid);
    const verified = header.indexOf("'VERIFIED'", lineage);
    const primary = header.indexOf('requested_primary_source_family_id', verified);
    const approvalExpiry = header.indexOf('requested_source_pair_approval_expires_at', primary);
    const prepared = header.indexOf('requested_prepared_at', approvalExpiry);

    expect(rowValid).toBeGreaterThanOrEqual(0);
    expect(header.slice(rowValid, lineage)).toContain('1::smallint');
    expect(lineage).toBeGreaterThan(rowValid);
    expect(verified).toBeGreaterThan(lineage);
    expect(primary).toBeGreaterThan(verified);
    expect(approvalExpiry).toBeGreaterThan(primary);
    expect(prepared).toBeGreaterThan(approvalExpiry);
    expect(header.slice(lineage, primary)).toContain("'CURRENT'");
    expect(header.slice(lineage, primary)).toContain("'HEALTHY'");
  });

  it('prepares one exact idempotent NEW intent without invoking either record writer', () => {
    const prepare = between(
      up,
      'CREATE FUNCTION prepare_provider_position_chain_anchor_record_intent(',
      'CREATE FUNCTION claim_provider_position_chain_anchor_record_dispatch(',
    );
    const advisory = prepare.indexOf(
      'pg_catalog.hashtextextended(computed_read_binding_fingerprint, 56031)',
    );
    const headerValid = prepare.indexOf(
      'provider_position_chain_anchor_record_intent_header_valid(',
    );
    const intentUse = prepare.indexOf(
      "'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_ONLY'",
      headerValid,
    );
    const clock = prepare.indexOf('database_prepared_at :=', advisory);
    const insert = prepare.indexOf(
      'INSERT INTO provider_position_chain_anchor_record_intents',
      clock,
    );
    const countConflicts = prepare.indexOf(
      'SELECT pg_catalog.count(*) INTO matching_intent_count',
      insert,
    );
    const strictRead = prepare.indexOf('SELECT intent.* INTO STRICT prior', countConflicts);

    expect(count(prepare, 'requested_network_id text')).toBe(1);
    expect(prepare).toContain('requested_source_pair_approval_expires_at timestamptz');
    expect(prepare).toContain('provider_position_chain_anchor_read_binding_fingerprint(');
    expect(prepare).toContain('provider_position_chain_anchor_evidence_fingerprint(');
    expect(prepare).toContain('provider_position_chain_anchor_record_intent_header_valid(');
    expect(headerValid).toBeGreaterThanOrEqual(0);
    expect(intentUse).toBeGreaterThan(headerValid);
    expect(prepare.slice(headerValid, intentUse)).toContain('1::smallint');
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(clock).toBeGreaterThan(advisory);
    expect(insert).toBeGreaterThan(clock);
    expect(prepare).toContain(') ON CONFLICT DO NOTHING;');
    expect(countConflicts).toBeGreaterThan(insert);
    expect(strictRead).toBeGreaterThan(countConflicts);
    expect(prepare).toContain('IF matching_intent_count <> 1 THEN');
    expect(prepare).toContain(
      'prior.read_binding_fingerprint_sha256\n          IS DISTINCT FROM computed_read_binding_fingerprint',
    );
    expect(prepare).toContain(
      'prior.source_pair_registry_fingerprint_sha256 IS DISTINCT FROM requested_source_pair_registry_fingerprint_sha256',
    );
    expect(prepare).not.toContain('record_provider_position_chain_anchor_evidence_guarded(');
    expect(prepare).not.toContain('record_provider_position_chain_anchor_evidence(');
  });

  it('claims one dispatch before the deadline or closes an expired NEW intent', () => {
    const claim = between(
      up,
      'CREATE FUNCTION claim_provider_position_chain_anchor_record_dispatch(',
      'CREATE FUNCTION execute_provider_position_chain_anchor_record_intent(',
    );
    const rowLock = claim.indexOf('FOR UPDATE;');
    const tokenHash = claim.indexOf(
      'provider_chain_anchor_record_dispatch_token_fingerprint(',
      rowLock,
    );
    const deadline = claim.indexOf('database_claimed_at >= intent.producer_deadline_at', tokenHash);
    const notRecorded = claim.indexOf("SET record_state = 'NOT_RECORDED'", deadline);
    const dispatched = claim.indexOf("SET record_state = 'RECORD_DISPATCHED'", notRecorded);

    expect(rowLock).toBeGreaterThanOrEqual(0);
    expect(tokenHash).toBeGreaterThan(rowLock);
    expect(deadline).toBeGreaterThan(tokenHash);
    expect(notRecorded).toBeGreaterThan(deadline);
    expect(dispatched).toBeGreaterThan(notRecorded);
    expect(claim).toContain('record_dispatch_count = 1');
    expect(claim).toContain('record_dispatch_token_sha256 = requested_dispatch_token_sha256');
    expect(claim).toContain('reconcile_not_before = producer_deadline_at');
    expect(claim).not.toContain('requested_raw_dispatch_token\n      RETURN');
    expect(claim).not.toContain('record_provider_position_chain_anchor_evidence_guarded(');
  });

  it('executes RECORD only after the intent lock and before the exclusive deadline', () => {
    const execute = between(
      up,
      'CREATE FUNCTION execute_provider_position_chain_anchor_record_intent(',
      'CREATE FUNCTION mark_provider_position_chain_anchor_record_intent_unknown(',
    );
    const rowLock = execute.indexOf('FOR UPDATE;');
    const priorReturn = execute.indexOf("IF intent.record_state <> 'RECORD_DISPATCHED' THEN");
    const deadline = execute.indexOf(
      'database_started_at >= intent.producer_deadline_at',
      priorReturn,
    );
    const forceDeferred = execute.indexOf(
      'SET CONSTRAINTS provider_position_chain_anchor_evidence_deadline_fk,',
      deadline,
    );
    const writer = execute.indexOf(
      'FROM record_provider_position_chain_anchor_evidence_guarded(',
      forceDeferred,
    );

    expect(rowLock).toBeGreaterThanOrEqual(0);
    expect(priorReturn).toBeGreaterThan(rowLock);
    expect(deadline).toBeGreaterThan(priorReturn);
    expect(execute).toContain(
      'IF database_started_at < intent.record_dispatched_at\n        OR database_started_at >= intent.producer_deadline_at\n      THEN',
    );
    expect(forceDeferred).toBeGreaterThan(deadline);
    expect(execute).toContain(
      'provider_position_chain_anchor_deadline_intent_fk,\n        provider_position_chain_anchor_deadline_intent_terminal_check DEFERRED;',
    );
    expect(writer).toBeGreaterThan(forceDeferred);
    expect(count(execute, 'FROM record_provider_position_chain_anchor_evidence_guarded(')).toBe(1);
    expect(execute).toContain("intent.producer_deadline_at,\n        'RECORD'");
    expect(execute).toContain(
      "stored_outcome NOT IN (\n        'RECORDED', 'IDEMPOTENT_REPLAY', 'NOT_RECORDED'",
    );
    expect(execute).not.toContain(
      "stored_outcome NOT IN (\n        'RECORDED', 'IDEMPOTENT_REPLAY', 'NOT_RECORDED', 'DEADLINE_VIOLATION'",
    );
    expect(execute).toContain('SET record_state = stored_outcome');
    expect(execute).toContain('deadline_binding_sha256 = stored_deadline_binding');
    expect(execute).toContain('resolution_code = stored_outcome');
    const resolvedClock = execute.indexOf('database_resolved_at :=', writer);
    const regressedResolution = execute.indexOf(
      'database_resolved_at < database_started_at',
      resolvedClock,
    );
    expect(resolvedClock).toBeGreaterThan(writer);
    expect(regressedResolution).toBeGreaterThan(resolvedClock);
    expect(
      execute.indexOf('UPDATE provider_position_chain_anchor_record_intents', resolvedClock),
    ).toBeGreaterThan(regressedResolution);
  });

  it('enforces exact monotonic state and timestamp shapes in the database', () => {
    const lifecycle = between(
      up,
      'CREATE FUNCTION provider_position_chain_anchor_record_intent_lifecycle_valid(',
      'DO $set_provider_position_chain_anchor_intent_validation_paths$',
    );
    const transition = between(
      up,
      'CREATE FUNCTION enforce_provider_position_chain_anchor_record_intent_transition()',
      'CREATE TRIGGER provider_position_chain_anchor_record_intent_transition',
    );

    expect(lifecycle).toContain(') RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE');
    expect(lifecycle).not.toContain('IMMUTABLE STRICT');
    expect(lifecycle).toContain(
      "'NEW', 'RECORD_DISPATCHED', 'UNKNOWN',\n        'RECORDED', 'IDEMPOTENT_REPLAY', 'NOT_RECORDED', 'DEADLINE_VIOLATION'",
    );
    expect(lifecycle).toContain('requested_reconcile_not_before >= requested_producer_deadline_at');
    expect(lifecycle).toContain(
      "requested_reconciliation_lease_expires_at\n            <= requested_reconciliation_lease_acquired_at + interval '60 seconds'",
    );
    expect(lifecycle).toContain("requested_record_state = 'NOT_RECORDED'");
    expect(lifecycle).toContain('requested_resolved_at >= requested_producer_deadline_at');
    const deadlineViolation = lifecycle.indexOf("requested_record_state = 'DEADLINE_VIOLATION'");
    expect(deadlineViolation).toBeGreaterThanOrEqual(0);
    expect(lifecycle.slice(deadlineViolation)).toContain(
      'requested_record_dispatched_at < requested_producer_deadline_at',
    );
    expect(lifecycle.slice(deadlineViolation)).toContain(
      'requested_resolved_at >= requested_producer_deadline_at',
    );
    expect(lifecycle.slice(deadlineViolation)).toContain(
      'pg_catalog.isfinite(requested_evidence_recorded_at)',
    );
    expect(lifecycle.slice(deadlineViolation)).toContain(
      'requested_evidence_recorded_at >= requested_prepared_at',
    );
    expect(lifecycle.slice(deadlineViolation)).toContain(
      'requested_evidence_recorded_at >= requested_record_dispatched_at',
    );
    expect(lifecycle.slice(deadlineViolation)).toContain(
      'requested_resolved_at >= requested_evidence_recorded_at',
    );
    expect(transition).toContain('record intent header is immutable');
    expect(transition).toContain('record intent is terminal');
    expect(transition).toContain("OLD.record_state = 'NEW'");
    expect(transition).toContain("NEW.record_state IN ('RECORD_DISPATCHED', 'NOT_RECORDED')");
    expect(transition).toContain(
      "AND NEW.record_state = (CASE\n            WHEN OLD.record_dispatch_count = 1 THEN 'UNKNOWN'",
    );
    expect(transition).not.toMatch(/NEW[.]record_state = CASE/u);
    expect(transition).toContain('NEW.reconciliation_attempt_count < OLD');
    expect(transition).toContain('NEW.reconciliation_attempt_count > OLD');
    expect(transition).toContain('NEW.reconcile_not_before < OLD.reconcile_not_before');
    expect(up).toContain(
      'ALTER TABLE provider_position_chain_anchor_record_intents ENABLE ALWAYS TRIGGER',
    );
    expect(up).toContain('BEFORE DELETE ON provider_position_chain_anchor_record_intents');
    expect(up).toContain('BEFORE TRUNCATE ON provider_position_chain_anchor_record_intents');
  });

  it('leases only post-deadline unresolved work with bounded SKIP LOCKED claims', () => {
    const lease = between(
      up,
      'CREATE FUNCTION lease_provider_chain_anchor_record_intent_reconciliation(',
      'CREATE FUNCTION reconcile_provider_position_chain_anchor_record_intent(',
    );
    const initialClock = lease.indexOf('database_scanned_at :=');
    const scan = lease.indexOf('FOR UPDATE SKIP LOCKED', initialClock);
    const resample = lease.indexOf('database_leased_at :=', initialClock + 1);
    const update = lease.indexOf('UPDATE provider_position_chain_anchor_record_intents', resample);

    expect(lease).toContain("requested_lease_duration < interval '5 seconds'");
    expect(lease).toContain("requested_lease_duration > interval '60 seconds'");
    expect(lease).toContain("stored.record_state = 'NEW'");
    expect(lease).toContain(
      "stored.record_state = 'NEW'\n            AND stored.producer_deadline_at <= database_scanned_at\n            AND stored.reconcile_not_before <= database_scanned_at",
    );
    expect(lease).toContain("stored.record_state IN ('RECORD_DISPATCHED', 'UNKNOWN')");
    expect(lease).toContain('stored.reconcile_not_before <= database_scanned_at');
    expect(scan).toBeGreaterThan(initialClock);
    expect(resample).toBeGreaterThan(scan);
    expect(update).toBeGreaterThan(resample);
    expect(lease).toContain('database_leased_at < database_scanned_at');
    expect(lease).toContain('reconciliation_attempt_count = reconciliation_attempt_count + 1');
    expect(lease).not.toContain('record_provider_position_chain_anchor_evidence_guarded(');
  });

  it('reconciles expired NEW locally and dispatched uncertainty through RECONCILE_ONLY only', () => {
    const reconcile = between(
      up,
      'CREATE FUNCTION reconcile_provider_position_chain_anchor_record_intent(',
      'CREATE FUNCTION release_provider_chain_anchor_record_intent_reconciliation(',
    );
    const rowLock = reconcile.indexOf('FOR UPDATE;');
    const clock = reconcile.indexOf('database_started_at :=', rowLock);
    const newBranch = reconcile.indexOf("IF intent.record_state = 'NEW' THEN", clock);
    const localTerminal = reconcile.indexOf("SET record_state = 'NOT_RECORDED'", newBranch);
    const guarded = reconcile.indexOf(
      'FROM record_provider_position_chain_anchor_evidence_guarded(',
      localTerminal,
    );

    expect(clock).toBeGreaterThan(rowLock);
    expect(reconcile).toContain('database_started_at < intent.reconciliation_lease_acquired_at');
    expect(newBranch).toBeGreaterThan(clock);
    expect(localTerminal).toBeGreaterThan(newBranch);
    expect(guarded).toBeGreaterThan(localTerminal);
    expect(count(reconcile, 'FROM record_provider_position_chain_anchor_evidence_guarded(')).toBe(
      1,
    );
    expect(reconcile).toContain("intent.producer_deadline_at,\n        'RECONCILE_ONLY'");
    expect(reconcile).toContain(
      "stored_outcome NOT IN (\n        'IDEMPOTENT_REPLAY', 'NOT_RECORDED', 'DEADLINE_VIOLATION'",
    );
    expect(reconcile).toContain("stored_outcome IN ('IDEMPOTENT_REPLAY', 'DEADLINE_VIOLATION')");
    expect(reconcile).toContain('OR stored_recorded_at IS NULL');
    expect(count(reconcile, 'database_resolved_at < database_started_at')).toBe(2);
    expect(reconcile).not.toContain("intent.producer_deadline_at,\n        'RECORD'");
    expect(reconcile).not.toContain('requested_operation');
  });

  it('allows bounded lease release without a max-attempt terminal failure', () => {
    const release = between(
      up,
      'CREATE FUNCTION release_provider_chain_anchor_record_intent_reconciliation(',
      'DO $set_provider_position_chain_anchor_record_intent_paths$',
    );
    const rowLock = release.indexOf('FOR UPDATE;');
    const clock = release.indexOf('database_released_at :=', rowLock);

    expect(clock).toBeGreaterThan(rowLock);
    expect(release).toContain('database_released_at < intent.reconciliation_lease_acquired_at');
    expect(release).toContain('intent.reconciliation_lease_acquired_at IS NULL');
    expect(release).toContain('intent.reconciliation_lease_expires_at <= database_released_at');
    expect(release).toContain(
      "requested_reconcile_not_before > database_released_at + interval '5 minutes'",
    );
    expect(release).toContain("WHEN record_dispatch_count = 1 THEN 'UNKNOWN'");
    expect(release).toContain('last_reconciliation_error_code = requested_error_code');
    expect(release).not.toMatch(/max(?:imum)?[_ ]attempt|attempt_limit|retry_limit/iu);
    expect(release).not.toContain("record_state = 'FAILED'");
  });

  it('gates every new deadline at commit on its exact terminal recorded intent', () => {
    const sidecarFk = between(
      up,
      'ADD CONSTRAINT provider_position_chain_anchor_deadline_intent_fk',
      'CREATE FUNCTION enforce_provider_position_chain_anchor_record_intent_transition()',
    );
    const gate = between(
      up,
      'CREATE FUNCTION enforce_provider_chain_anchor_record_deadline_intent_binding()',
      'DO $set_provider_position_chain_anchor_deadline_intent_guard_path$',
    );
    const trigger = between(
      up,
      'CREATE CONSTRAINT TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check',
      'CREATE FUNCTION prepare_provider_position_chain_anchor_record_intent(',
    );

    expect(sidecarFk).toContain('FOREIGN KEY (evidence_fingerprint_sha256, producer_deadline_at)');
    expect(sidecarFk).toContain(
      'REFERENCES provider_position_chain_anchor_record_intents (evidence_fingerprint_sha256, producer_deadline_at)',
    );
    expect(sidecarFk).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(gate).toContain("intent.record_state NOT IN ('RECORDED', 'IDEMPOTENT_REPLAY')");
    expect(gate).toContain(
      'intent.deadline_binding_sha256 IS DISTINCT FROM NEW.deadline_binding_sha256',
    );
    expect(gate).toContain('intent.evidence_recorded_at IS DISTINCT FROM NEW.evidence_recorded_at');
    expect(trigger).toContain('AFTER INSERT ON provider_position_chain_anchor_record_deadlines');
    expect(trigger).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(trigger).toContain('ENABLE ALWAYS TRIGGER');
  });

  it('keeps every new relation, row type, and function owner-only with no activation grant', () => {
    expect(up).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE provider_position_chain_anchor_record_intents FROM PUBLIC, "crypto_api_runtime", "crypto_worker_runtime", "crypto_runtime", "crypto_balance_consumer_runtime", "crypto_migration";',
    );
    expect(up).toContain(
      'REVOKE ALL PRIVILEGES ON TYPE provider_position_chain_anchor_record_intents FROM PUBLIC,',
    );
    expect(up).toContain(
      'REVOKE ALL ON FUNCTION execute_provider_position_chain_anchor_record_intent(text,bytea) FROM PUBLIC,',
    );
    expect(up).toContain(
      'REVOKE ALL ON FUNCTION reconcile_provider_position_chain_anchor_record_intent(text,bytea) FROM PUBLIC,',
    );
    expect(up).not.toContain('GRANT ');
  });

  it('cumulatively pins 0030 plus exact columns, constraints, bodies, triggers, and ACLs', () => {
    const intentConstraints = between(
      verifier,
      ') AS indexes\n    CROSS JOIN (\n      SELECT pg_catalog.count(*) = 9',
      ') AS constraints\n    CROSS JOIN (',
    );

    expect(verifier).toContain('SELECT pg_catalog.count(*) = 6');
    expect(verifier).toContain('SELECT pg_catalog.count(*) = 3');
    expect(verifier).toContain(
      "relation.relname = 'provider_position_chain_anchor_record_intents'",
    );
    expect(verifier).toContain('SELECT pg_catalog.count(*) = 47');
    expect(verifier).toContain("WHEN 'provider_chain_anchor_intent_evidence_deadline_unique' THEN");
    expect(verifier).toContain('constraint_state.conkey = ARRAY[2,9]::smallint[]');
    expect(verifier).toContain('constraint_state.conkey = ARRAY[2,7]::smallint[]');
    expect(intentConstraints).toContain('constraint_state.conislocal');
    expect(intentConstraints).toContain('constraint_state.coninhcount = 0');
    expect(intentConstraints.match(/AND constraint_state\.connoinherit/gu)).toHaveLength(7);
    expect(intentConstraints.match(/AND NOT constraint_state\.connoinherit/gu)).toHaveLength(2);
    expect(verifier).toContain('constraint_state.condeferrable');
    expect(verifier).toContain('constraint_state.condeferred');
    expect(verifier).toContain("constraint_state.contype = 't'");
    expect(verifier).toContain(
      'trigger.tgconstraint = (\n              SELECT constraint_state.oid',
    );
    expect(verifier).toContain('procedure.proisstrict = expected.strict_function');
    expect(verifier).toContain("'record_dispatch_token_sha256ISNOTNULL'");
    expect(verifier).toContain("'reconciliation_lease_token_sha256ISNOTNULL'");
    expect(verifier).toContain(
      "'record_state=ANY(ARRAY[''NEW''::text,''RECORD_DISPATCHED''::text,''UNKNOWN''::text])'",
    );
    expect(verifier).toContain(
      'index_state.indoption = expected.index_options::pg_catalog.int2vector',
    );
    expect(verifier).toContain('operator_class.opcname');
    expect(verifier).toContain('NOT index_state.indnullsnotdistinct');
    expect(verifier).toContain('index_state.indcollation[key_position]');
    expect(verifier).toContain(
      "'provider_position_chain_anchor_record_intent_lifecycle_valid(text,smallint,text,timestamp with time zone",
    );
    expect(verifier).toContain("false,\n          'i',");
    expect(verifier).toContain('pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc');
    expect(verifier).toContain(
      "trigger.tgname =\n              'provider_position_chain_anchor_deadline_intent_terminal_check'",
    );
    expect(verifier).toContain("trigger.tgenabled = 'A'");
    expect(verifier).toContain(
      "NOT pg_catalog.has_table_privilege('crypto_balance_consumer_runtime', 'provider_position_chain_anchor_record_intents'",
    );
  });

  it('shares DDL with isolated schemas while preserving cumulative verification', () => {
    const isolated = createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031;

    expect(isolated.upSql).toEqual(migration.upSql);
    expect(isolated.downSql).toEqual(migration.downSql);
    expect(isolated.verifySql).not.toEqual(migration.verifySql);
    expect(isolated.verifySql).toContain('SELECT true AS valid');
  });

  it('validates injected principal names through the predecessor factory', () => {
    expect(() =>
      createProviderPositionChainAnchorRecordIntentMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        workerRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('workerRuntimeRole');
  });

  it('refuses rollback after any intent, evidence, deadline, or control use', () => {
    expect(down).toContain(
      'LOCK TABLE provider_position_chain_anchor_evidence,\n      provider_position_chain_anchor_control_events,\n      provider_position_chain_anchor_record_deadlines,\n      provider_position_chain_anchor_record_intents\n      IN ACCESS EXCLUSIVE MODE;',
    );
    for (const table of [
      'provider_position_chain_anchor_evidence',
      'provider_position_chain_anchor_control_events',
      'provider_position_chain_anchor_record_deadlines',
      'provider_position_chain_anchor_record_intents',
    ]) {
      expect(down).toContain(`EXISTS (SELECT 1 FROM ${table})`);
    }
    expect(down).toContain(
      'DROP TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check',
    );
    expect(down).toContain('DROP CONSTRAINT provider_position_chain_anchor_deadline_intent_fk;');
    expect(down).toContain('DROP TABLE provider_position_chain_anchor_record_intents;');
    expect(down).not.toContain('GRANT ');
    expect(down).not.toContain('DROP TABLE provider_position_chain_anchor_evidence');
    expect(down).not.toContain('DROP TABLE provider_position_chain_anchor_record_deadlines');
  });

  it('detects hostile removal of each critical production boundary', () => {
    assertCriticalIntentContract(up, verifier);
    for (const [target, replacement] of [
      [' IN ACCESS EXCLUSIVE MODE;', ' IN SHARE MODE;'],
      ['UNIQUE (evidence_fingerprint_sha256, producer_deadline_at)', ''],
      ['FOR UPDATE SKIP LOCKED', 'FOR UPDATE'],
      ["'RECONCILE_ONLY'", "'RECORD'"],
      [
        'CREATE CONSTRAINT TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check',
        'CREATE TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check',
      ],
      ['DEFERRABLE INITIALLY DEFERRED', 'NOT DEFERRABLE'],
      [
        'ALTER TABLE provider_position_chain_anchor_record_deadlines ENABLE ALWAYS TRIGGER',
        'ALTER TABLE provider_position_chain_anchor_record_deadlines ENABLE TRIGGER',
      ],
    ] as const) {
      expect(() =>
        assertCriticalIntentContract(up.split(target).join(replacement), verifier),
      ).toThrow();
    }
    expect(() =>
      assertCriticalIntentContract(
        `${up}\nGRANT EXECUTE ON FUNCTION unsafe() TO PUBLIC;`,
        verifier,
      ),
    ).toThrow();
    expect(() =>
      assertCriticalIntentContract(
        up,
        verifier.replace('procedure.proisstrict = expected.strict_function', 'true'),
      ),
    ).toThrow();
    expect(() =>
      assertCriticalIntentContract(
        up,
        verifier.replace('trigger.tgdeferrable = expected.constraint_trigger', 'true'),
      ),
    ).toThrow();
    for (const verifierBoundary of [
      'index_state.indoption = expected.index_options::pg_catalog.int2vector',
      'operator_class.opcname',
      'NOT index_state.indnullsnotdistinct',
      'index_state.indcollation[key_position]',
      'expected.predicate_expression',
    ]) {
      expect(() =>
        assertCriticalIntentContract(up, verifier.split(verifierBoundary).join('true')),
      ).toThrow();
    }
  });
});
