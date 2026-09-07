import { createHash } from 'node:crypto';

import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createMainnetFinancialActionLifecycleMigration,
  createMainnetFinancialActionLifecycleMigrationV0033,
  createMainnetFinancialActionLifecycleTestSchemaMigrationV0033,
  MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS,
} from './0033-create-mainnet-financial-action-lifecycle.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function functionBody(source: string, functionName: string, nextFunctionName: string): string {
  const start = source.indexOf(`CREATE FUNCTION ${functionName}`);
  const endMarker = nextFunctionName.startsWith('DO ')
    ? nextFunctionName
    : `CREATE FUNCTION ${nextFunctionName}`;
  const end = source.indexOf(endMarker, start + 1);
  if (start < 0 || end < 0) throw new Error(`missing SQL function boundary: ${functionName}`);
  return source.slice(start, end);
}

function encodeClmaFp1(
  domain: string,
  names: readonly string[],
  values: readonly (string | null)[],
): Buffer {
  const chunks: Buffer[] = [Buffer.from('434c4d41465001', 'hex')];
  const append = (name: string, value: string | null): void => {
    const nameBytes = Buffer.from(name, 'utf8');
    const nameLength = Buffer.alloc(2);
    nameLength.writeUInt16BE(Buffer.byteLength(name, 'utf8'));
    chunks.push(nameLength, nameBytes);
    if (value === null) {
      const valueLength = Buffer.alloc(4);
      valueLength.writeUInt32BE(0);
      chunks.push(Buffer.from([0]), valueLength);
      return;
    }
    const valueBytes = Buffer.from(value, 'utf8');
    const valueLength = Buffer.alloc(4);
    valueLength.writeUInt32BE(Buffer.byteLength(value, 'utf8'));
    chunks.push(Buffer.from([1]), valueLength, valueBytes);
  };
  append('domain', domain);
  names.forEach((name, index) => append(name, values[index] ?? null));
  return Buffer.concat(chunks);
}

describe('migration 0033 dormant mainnet financial action lifecycle', () => {
  const migration = createMainnetFinancialActionLifecycleMigrationV0033;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';

  it('extends 0032 and registers production and isolated-schema variants before 0034', () => {
    expect(migration.id).toBe('0033');
    expect(migration.supersedesVerificationOf).toEqual(['0032']);
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.at(-2)).toBe(
      createMainnetFinancialActionLifecycleMigrationV0033,
    );
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-2)).toBe(
      createMainnetFinancialActionLifecycleTestSchemaMigrationV0033,
    );
    expect(DATABASE_MIGRATION_LIST.map(({ id }) => id).slice(-6)).toEqual([
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
    ]);
    expect(verifier).toContain('balance_sync_financial_agreement_evidence_v2');
  });

  it('persists normalized intent authority and exact predecessor identities without wallet plaintext', () => {
    for (const table of [
      'mainnet_financial_action_intents',
      'mainnet_financial_action_events',
      'mainnet_financial_action_evidence_claims',
    ]) {
      expect(up).toContain(`CREATE TABLE ${table}`);
      expect(up).toContain(`COMMENT ON TABLE ${table}`);
    }
    for (const column of [
      'yield_operation_id uuid NOT NULL',
      'yield_submission_id uuid NOT NULL',
      'ledger_transaction_id uuid NOT NULL',
      'ledger_book_id uuid NOT NULL',
      'wallet_id uuid NOT NULL',
      'wallet_identity_digest_version smallint NOT NULL',
      'wallet_identity_digest_hex text NOT NULL',
      'provider_id text NOT NULL',
      'protocol_id text NOT NULL',
      'market_id text NOT NULL',
      'asset_registry_fingerprint_sha256 text NOT NULL',
      'amount_atomic numeric(78,0) NOT NULL',
      'chain_transaction_id text',
      'transaction_block_id text',
      'finalized_block_id text',
    ]) {
      expect(up).toContain(column);
    }
    expect(up).toContain('mainnet_action_intent_yield_scope_fk');
    expect(up).toContain('mainnet_action_intent_ledger_scope_fk');
    expect(up).toContain('mainnet_action_intent_wallet_scope_fk');
    expect(up).toContain(
      'REFERENCES registered_wallets (\n        wallet_id, account_id, chain_namespace, chain_reference',
    );
    expect(up).not.toContain('wallet_address text');
    expect(up).not.toContain('signed_payload bytea');
    expect(up).not.toContain('signature bytea');
    expect(up).not.toMatch(/\b(?:calldata|instructions|credential|endpoint)_/u);
  });

  it('uses fixed CLMA-FP-1 named framing with six literal cross-runtime golden vectors', () => {
    expect(MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS).toHaveLength(6);
    for (const vector of MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS) {
      const encoded = encodeClmaFp1(vector.domain, vector.fieldNames, vector.fieldValues);
      expect(encoded.toString('hex')).toBe(vector.encodedHex);
      expect(createHash('sha256').update(encoded).digest('hex')).toBe(vector.sha256);
      expect(verifier).toContain(vector.encodedHex);
      expect(verifier).toContain(vector.sha256);
    }
    expect(up).toContain("pg_catalog.decode('434c4d41465001', 'hex')");
    expect(up).toContain('pg_catalog.int2send');
    expect(up).toContain('pg_catalog.int4send');
    expect(up).toContain("pg_catalog.convert_to(field_value, 'UTF8')");
    expect(up).not.toContain('jsonb_build_array');
    expect(up).not.toContain('JSON.stringify');
    expect(up).not.toContain('pg_catalog.chr(0)');
  });

  it('frames ambiguous inputs distinctly and never equates CLMA-FP-1 with legacy JSON hashing', () => {
    const domain = 'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1';
    const digest = (names: readonly string[], values: readonly (string | null)[]): string =>
      createHash('sha256')
        .update(encodeClmaFp1(domain, names, values))
        .digest('hex');
    expect(digest(['fingerprintEncodingVersion', 'left', 'right'], ['1', 'ab', 'c'])).not.toBe(
      digest(['fingerprintEncodingVersion', 'left', 'right'], ['1', 'a', 'bc']),
    );
    expect(digest(['fingerprintEncodingVersion', 'value'], ['1', null])).not.toBe(
      digest(['fingerprintEncodingVersion', 'value'], ['1', '']),
    );
    expect(digest(['fingerprintEncodingVersion', 'a', 'b'], ['1', 'x', 'y'])).not.toBe(
      digest(['fingerprintEncodingVersion', 'b', 'a'], ['1', 'y', 'x']),
    );
    expect(digest(['fingerprintEncodingVersion', 'value'], ['1', '0'])).not.toBe(
      digest(['fingerprintEncodingVersion', 'value'], ['1', '1']),
    );

    const vector = MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS[0];
    const legacyJsonDigest = createHash('sha256')
      .update(`${vector.domain}\0${JSON.stringify(vector.fieldValues)}`, 'utf8')
      .digest('hex');
    expect(legacyJsonDigest).toBe(
      '90c6037f70d7672e2e3692333e242f1049474aa3006da7de5bc0d2611ac02598',
    );
    expect(vector.sha256).not.toBe(legacyJsonDigest);
    expect(up).toContain('volatile_intent_commitment_sha256');
    expect(up).toContain('intent_record_fingerprint_sha256');
    expect(up).toContain('legacy-json-digest-opaque');
  });

  it('closes provider, asset, action, value, and zero-authority shapes fail-closed', () => {
    for (const binding of [
      "NEW.provider_id = 'aave' AND NEW.protocol_id = 'aave-v3'",
      "NEW.provider_id = 'jupiter' AND NEW.protocol_id = 'jupiter-lend'",
      "NEW.asset_symbol = 'USDC'",
      "NEW.asset_symbol = 'USDT'",
      "NEW.asset_symbol = 'PYUSD'",
      'requested_maximum_network_fee_basis_points NOT BETWEEN 0 AND 10000',
      'allowance_amount_atomic = CASE',
      'database_replay_protection_enforced',
      'volatile_intent_durable_replay_protection_verified',
      'api_may_sign',
      'api_may_broadcast',
    ]) {
      expect(up).toContain(binding);
    }
    expect(up).toContain("requested_action_type NOT IN ('SUPPLY', 'WITHDRAW')");
    expect(up).not.toContain("requested_action_type NOT IN ('SUPPLY', 'WITHDRAW', 'BORROW'");
    expect(up).toContain('BORROW/REPAY have no truthful parent yield-operation type');
    expect(up).toContain("operation_type = 'ALLOCATE' AND NEW.action_type = 'SUPPLY'");
    expect(up).toContain("operation_type = 'WITHDRAW' AND NEW.action_type = 'WITHDRAW'");
  });

  it('serializes CAS transitions, scopes replay per account, and recomputes database fingerprints', () => {
    expect(up).toContain(
      'UNIQUE (account_id, fingerprint_encoding_version, idempotency_key_digest_sha256)',
    );
    expect(up).toContain('UNIQUE (account_id, fingerprint_encoding_version, replay_protection_id)');
    expect(up).toContain(
      "This intent row lock is the lifecycle's per-intent serialization primitive",
    );
    expect(up).toContain('WHERE stored.intent_id = NEW.intent_id\n      FOR UPDATE');
    expect(up).toContain('current_event.revision <> requested_expected_revision');
    expect(up).toContain('current_event.snapshot_sha256 <> requested_expected_snapshot_sha256');
    expect(up).toContain('NEW.transition_fingerprint_sha256 := expected_transition');
    expect(up).toContain('NEW.snapshot_sha256 := expected_snapshot');
    expect(up).toContain('NEW.recorded_at := database_recorded_at');
    expect(up.match(/ENABLE ALWAYS TRIGGER/gu)).toHaveLength(10);
    expect(up).not.toContain('DISABLE TRIGGER');
  });

  it('lets the first signed submission establish its identity and pins every later event to it', () => {
    const eventTrigger = functionBody(
      up,
      'enforce_mainnet_action_event_transition',
      'validate_mainnet_action_intent_completion',
    );
    expect(eventTrigger).toContain(
      "IF NEW.stage <> 'WALLET_SIGNED_SUBMISSION_BOUND' THEN\n          SELECT stored.* INTO STRICT submission_event",
    );
    expect(eventTrigger).toContain(
      "IF NEW.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'\n        AND NEW.submission_fingerprint_sha256 IS DISTINCT FROM expected_transition",
    );
    expect(eventTrigger).toContain(
      "RAISE EXCEPTION 'mainnet financial action submission fingerprint conflict'",
    );
    expect(eventTrigger.indexOf('SELECT stored.* INTO STRICT submission_event')).toBeLessThan(
      eventTrigger.indexOf('NEW.transition_fingerprint_sha256 := expected_transition'),
    );
  });

  it('keeps signing gated but never strands post-bind evidence across expiry or revocation', () => {
    const bind = functionBody(
      up,
      'bind_mainnet_financial_action_submission',
      'record_mainnet_financial_action_broadcast_observation',
    );
    const broadcast = functionBody(
      up,
      'record_mainnet_financial_action_broadcast_observation',
      'record_mainnet_financial_action_reconciliation_observation',
    );
    expect(bind).toContain("wallet.status = 'ACTIVE'");
    expect(bind).toContain('database_recorded_at >= intent.expires_at');
    expect(bind).toContain("operation.current_state = 'SUBMITTED'");
    expect(broadcast).not.toContain("wallet.status = 'ACTIVE'");
    expect(broadcast).not.toContain('intent.expires_at');
    expect(broadcast).not.toContain('yield_operations');
    expect(broadcast).toContain('requested_observed_at < submission_event.effective_at');
    expect(broadcast).toContain('requested_observed_at > database_recorded_at');
  });

  it('closes the lost-broadcast-report crash window without adding resend or broadcast authority', () => {
    const reconcile = functionBody(
      up,
      'record_mainnet_financial_action_reconciliation_observation',
      'DO $set_mainnet_action_function_paths$',
    );
    expect(reconcile).toContain("'WALLET_SIGNED_SUBMISSION_BOUND',");
    expect(reconcile).toContain('broadcast_event.effective_at, submission_event.effective_at');
    expect(reconcile).not.toContain('intent.expires_at');
    expect(reconcile).not.toContain("wallet.status = 'ACTIVE'");
    expect(up).not.toContain('INSERT INTO job_outbox');
    expect(up).not.toMatch(/sendRawTransaction|sendTransaction|eth_sendRawTransaction/u);
    expect(up).toContain('automatic_resend_allowed boolean NOT NULL');
    expect(up).toContain('NOT automatic_resend_allowed');
  });

  it('uses valid PostgreSQL special-form syntax and explicitly rejects every required reconciliation NULL', () => {
    const bind = functionBody(
      up,
      'bind_mainnet_financial_action_submission',
      'record_mainnet_financial_action_broadcast_observation',
    );
    const reconcile = functionBody(
      up,
      'record_mainnet_financial_action_reconciliation_observation',
      'DO $set_mainnet_action_function_paths$',
    );
    expect(up).not.toContain('pg_catalog.extract(');
    expect(up).not.toContain('pg_catalog.coalesce(');
    expect(up).toContain('extract(epoch FROM NEW.issued_at)');
    expect(up).toContain('SELECT COALESCE(');
    expect(bind).not.toContain('evidence_floor_at timestamptz');
    expect(reconcile).toContain('evidence_floor_at timestamptz');
    expect(reconcile).toContain('evidence_floor_at := COALESCE(');
    for (const requiredArgument of [
      'requested_account_id',
      'requested_intent_id',
      'requested_expected_revision',
      'requested_expected_snapshot_sha256',
      'requested_observation_id',
      'requested_transaction_id',
      'requested_outcome',
      'requested_finalized_position',
      'requested_finalized_block_id',
      'requested_source_evidence_sha256',
      'requested_observed_at',
      'requested_correlation_id',
    ]) {
      expect(reconcile).toContain(`${requiredArgument} IS NULL`);
    }
  });

  it('retains monotonic reconciliation anchors across UNKNOWN and quarantines reorgs', () => {
    expect(up).toContain('last_transaction_observation mainnet_financial_action_events%ROWTYPE');
    expect(up).toContain('AND stored.transaction_position IS NOT NULL');
    expect(up).toContain('IF last_reconciliation.intent_id IS NOT NULL');
    expect(up).toContain('IF last_transaction_observation.intent_id IS NOT NULL');
    expect(up).toContain("NEW.reconciliation_outcome <> 'REORGED_OUT'");
    expect(up).toContain("WHEN 'REORGED_OUT' THEN 'REORG_QUARANTINED'");
    expect(up).toContain("NEW.requires_manual_reconciliation := NEW.stage = 'REORG_QUARANTINED'");
    expect(up).toContain('NEW.ledger_settlement_authority := false');
    expect(up).not.toMatch(/UPDATE\s+(?:ledger_|yield_operations)/u);
  });

  it('claims observation, transaction, and role-bound evidence ownership exactly once', () => {
    expect(up).toContain('mainnet_action_event_transaction_owner');
    expect(up).toContain('mainnet_action_event_transaction_fingerprint_owner');
    expect(up).toContain('mainnet_action_event_observation_owner');
    expect(up).toContain('evidence_digest_sha256 text PRIMARY KEY');
    expect(up).toContain('UNIQUE (intent_id, event_revision, evidence_role)');
    expect(up.match(/ORDER BY claim\.digest/gu)).toHaveLength(2);
    expect(up).toContain('mainnet financial action observation ownership conflict');
    expect(up).toContain('mainnet financial action broadcast attempt is already consumed');
  });

  it('exposes only owner-scoped recovery and mutation functions with no runtime grants', () => {
    expect(up).toContain(
      'CREATE FUNCTION read_mainnet_financial_action_lifecycle(\n      requested_account_id uuid, requested_intent_id uuid',
    );
    for (const name of [
      'bind_mainnet_financial_action_submission',
      'record_mainnet_financial_action_broadcast_observation',
      'record_mainnet_financial_action_reconciliation_observation',
    ]) {
      expect(up).toContain(`CREATE FUNCTION ${name}(\n      requested_account_id uuid`);
    }
    expect(up).toContain('volatile_intent_commitment_sha256 text');
    expect(up).toContain('last_observed_transaction_position numeric');
    expect(up).not.toContain('GRANT ');
    for (const role of [
      'crypto_api_runtime',
      'crypto_worker_runtime',
      'crypto_runtime',
      'crypto_balance_consumer_runtime',
      'crypto_migration',
    ]) {
      expect(up).toContain(role);
    }
  });

  it('pins PostgreSQL 16 catalogs, function sources, fixed paths, and owner-only ACLs', () => {
    expect(verifier).toContain("server_version_num')::integer >= 160000");
    expect(verifier).toContain("server_version_num')::integer < 170000");
    expect(verifier).toContain('server_state.valid AND prior.valid');
    expect(verifier).toContain("relation.relpersistence = 'p'");
    expect(verifier).toContain('NOT relation.relrowsecurity');
    expect(verifier).toContain('FROM pg_catalog.pg_policy AS policy');
    expect(verifier).toContain('FROM pg_catalog.pg_rewrite AS rewrite');
    expect(verifier).toContain("attribute.attidentity = ''");
    expect(verifier).toContain("attribute.attgenerated = ''");
    expect(verifier).toContain('constraint_record.convalidated');
    expect(verifier).toContain('constraint_record.confkey = ARRAY[1,2,4,5]::smallint[]');
    expect(verifier).toContain("trigger_record.tgenabled = 'A'");
    expect(verifier).toContain(
      "pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8'))",
    );
    expect(verifier).toContain('pg_catalog.aclexplode(guarded_attribute.attacl)');
    expect(verifier).toContain('acl.grantee <> guarded_function.proowner');
    expect(verifier).toContain(
      "NOT pg_catalog.has_function_privilege('crypto_worker_runtime', 'read_mainnet_financial_action_lifecycle(uuid,uuid)', 'EXECUTE')",
    );
  });

  it('pins exact PostgreSQL-16 relation, constraint, and index structures', () => {
    expect(verifier).toContain("relation.relkind = 'r'");
    expect(verifier).toContain("relation.relreplident = 'd'");
    expect(verifier).toContain('row_type_owner.oid = relation.relowner');
    expect(verifier).toContain('constraint_record.conkey IS NOT DISTINCT FROM');
    expect(verifier).toContain('constraint_record.confkey IS NOT DISTINCT FROM');
    expect(verifier).toContain('constraint_record.conindid = CASE');
    expect(verifier).toContain('constraint_record.confdelsetcols IS NULL');
    expect(verifier).toContain('constraint_record.conpfeqop = constraint_record.conppeqop');
    expect(verifier).toContain('pg_catalog.pg_get_constraintdef(constraint_record.oid, false)');
    expect(verifier).toContain('8a97bca9c11abe88e14c32cb7be154f2c5536df4187d5aed45da502419470ec0');
    expect(verifier).toContain("index_relation.relkind = 'i'");
    expect(verifier).toContain('index_relation.relowner = table_relation.relowner');
    expect(verifier).toContain('index_record.indkey = expected.index_keys');
    expect(verifier).toContain('index_record.indoption = expected.index_options');
    expect(verifier).toContain("operator_namespace.nspname = 'pg_catalog'");
    expect(verifier).toContain('index_record.indcollation[key_position]');
    expect(verifier).toContain('NOT index_record.indnullsnotdistinct');
    expect(verifier).toContain('index_record.indexprs IS NULL');
    expect(verifier).toContain("'(reconciliation_outcomeISNOTNULL)'");
    expect(verifier).toContain("'0 3'");
  });

  it('refuses rollback after any history and removes only the dormant 0033 surface', () => {
    expect(down).toContain(
      'LOCK TABLE mainnet_financial_action_intents, mainnet_financial_action_events, mainnet_financial_action_evidence_claims',
    );
    for (const table of [
      'mainnet_financial_action_intents',
      'mainnet_financial_action_events',
      'mainnet_financial_action_evidence_claims',
    ]) {
      expect(down).toMatch(new RegExp(`(?:IF|OR) EXISTS \\(SELECT 1 FROM ${table}\\)`, 'u'));
      expect(down).toContain(`DROP TABLE ${table}`);
    }
    expect(down).toContain("USING ERRCODE = '55000'");
    expect(down).not.toContain('GRANT ');
    expect(down).not.toContain('DROP TABLE yield_operations');
    expect(down).not.toContain('DROP TABLE registered_wallets');
  });

  it('shares DDL while isolating cumulative principal verification', () => {
    expect(migration.upSql).toEqual(
      createMainnetFinancialActionLifecycleTestSchemaMigrationV0033.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetFinancialActionLifecycleTestSchemaMigrationV0033.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetFinancialActionLifecycleTestSchemaMigrationV0033.verifySql,
    );
  });

  it('rejects unsafe principal identifiers through the cumulative predecessor', () => {
    expect(() =>
      createMainnetFinancialActionLifecycleMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        schemaOwnerRole: 'unsafe-role',
      }),
    ).toThrow('schemaOwnerRole');
  });
});
