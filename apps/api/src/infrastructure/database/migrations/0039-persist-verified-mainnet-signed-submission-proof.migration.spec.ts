import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createVerifiedMainnetSignedSubmissionProofMigration,
  createVerifiedMainnetSignedSubmissionProofMigrationV0039,
  createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039,
} from './0039-persist-verified-mainnet-signed-submission-proof.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

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

describe('migration 0039 verified mainnet signed-submission proof', () => {
  const migration = createVerifiedMainnetSignedSubmissionProofMigrationV0039;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';
  const proofGuard = functionBody(
    up,
    'enforce_mainnet_financial_action_signed_submission_proof_v1',
  );
  const completeness = functionBody(
    up,
    'validate_mainnet_financial_action_signed_submission_proof_v1',
  );
  const bind = functionBody(up, 'bind_verified_mainnet_financial_action_submission_v2');

  it('supersedes 0038 but intentionally remains outside coordinated migration registration', () => {
    expect(migration).toMatchObject({ id: '0039', supersedesVerificationOf: ['0038'] });
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.at(-1)?.id).toBe('0038');
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-1)?.id).toBe('0038');
  });

  it('refuses every pre-existing unproved signed-bound event before creating state', () => {
    const preflight = up.indexOf('DO $refuse_unverified_signed_submission_history$');
    const table = up.indexOf('CREATE TABLE mainnet_financial_action_signed_submission_proofs');
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(table).toBeGreaterThan(preflight);
    expect(up.slice(0, preflight)).toContain(
      'LOCK TABLE mainnet_financial_action_events IN ACCESS EXCLUSIVE MODE',
    );
    expect(up.slice(preflight, table)).toContain("WHERE stage = 'WALLET_SIGNED_SUBMISSION_BOUND'");
    expect(up.slice(preflight, table)).toContain("USING ERRCODE = '55000'");
  });

  it('stores only immutable digest proof and exact intent, revision, and event bindings', () => {
    const proofTable = up.slice(
      up.indexOf('CREATE TABLE mainnet_financial_action_signed_submission_proofs'),
      up.indexOf('COMMENT ON TABLE mainnet_financial_action_signed_submission_proofs'),
    );
    for (const marker of [
      'PRIMARY KEY (intent_id, event_revision)',
      'UNIQUE (event_id)',
      'UNIQUE (proof_fingerprint_sha256)',
      'UNIQUE (signed_envelope_sha256)',
      'UNIQUE (chain_replay_identity_sha256)',
      'intent_record_fingerprint_sha256 text NOT NULL',
      'verification_intent_fingerprint_sha256 text NOT NULL',
      'signed_envelope_sha256 text NOT NULL',
      'signing_payload_sha256 text NOT NULL',
      'signature_evidence_sha256 text NOT NULL',
      'provider_write_manifest_fingerprint_sha256 text NOT NULL',
      'provider_action_binding_sha256 text NOT NULL',
      'chain_replay_identity_sha256 text NOT NULL',
      'server_received_and_verified_at timestamptz NOT NULL',
      'proof_fingerprint_sha256 text NOT NULL',
      'REFERENCES mainnet_financial_action_events',
      'REFERENCES mainnet_financial_action_intents (intent_record_fingerprint_sha256)',
    ]) {
      expect(up).toContain(marker);
    }
    for (const forbidden of [
      'raw_signed',
      'signed_transaction',
      'wallet_address',
      'private_key',
      'credential',
      'may_authorize_financial_action',
      'ledger_settlement_authority',
    ]) {
      expect(proofTable).not.toContain(forbidden);
    }
  });

  it('pins exclusive Ethereum nonce and Solana recent-blockhash proof shapes', () => {
    for (const source of [up, proofGuard, bind]) {
      expect(source).toContain("signature_scheme = 'ECDSA_SECP256K1_EIP1559'");
      expect(source).toContain('ethereum_nonce BETWEEN 0 AND 18446744073709551615::numeric');
      expect(source).toContain('solana_recent_blockhash IS NULL');
      expect(source).toContain("signature_scheme = 'ED25519_SOLANA_TRANSACTION'");
      expect(source).toContain('ethereum_nonce IS NULL');
    }
    expect(proofGuard).toContain(
      "mainnet_action_chain_identity_valid(\n              'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', NEW.solana_recent_blockhash, 'BLOCK'",
    );
  });

  it('has the database author the exact proof fingerprint and timestamps', () => {
    expect(proofGuard).toContain(
      "'CRYPTO_LENDING:MAINNET_ACTION:SIGNED_SUBMISSION_PROOF:JSONB-ARRAY:v1'",
    );
    expect(proofGuard).toContain('NEW.recorded_at := database_recorded_at');
    expect(proofGuard).toContain(
      'NEW.server_received_and_verified_at := signed_event.effective_at',
    );
    expect(proofGuard).toContain('NEW.proof_fingerprint_sha256 := pg_catalog.encode(');
    expect(proofGuard).toContain('pg_catalog.sha256(pg_catalog.convert_to(');
    expect(proofGuard).toContain(
      'NEW.server_received_and_verified_at <> signed_event.effective_at',
    );
    expect(up).toContain("recorded_at - server_received_and_verified_at <= interval '30 seconds'");
  });

  it('checks exact replay before calling 0033 and authors new bind time internally', () => {
    const event = bind.indexOf('FROM mainnet_financial_action_events AS event');
    const replay = bind.indexOf('IF FOUND THEN', event);
    const replayDelegate = bind.indexOf('FROM bind_mainnet_financial_action_submission(', replay);
    const databaseTime = bind.indexOf(
      "database_verified_at := pg_catalog.date_trunc(\n        'milliseconds', pg_catalog.clock_timestamp()",
      replayDelegate,
    );
    const newDelegate = bind.indexOf(
      'FROM bind_mainnet_financial_action_submission(',
      replayDelegate + 1,
    );
    const insert = bind.indexOf(
      'INSERT INTO mainnet_financial_action_signed_submission_proofs',
      newDelegate,
    );
    expect(event).toBeGreaterThanOrEqual(0);
    expect(replay).toBeGreaterThan(event);
    expect(replayDelegate).toBeGreaterThan(replay);
    expect(databaseTime).toBeGreaterThan(replayDelegate);
    expect(newDelegate).toBeGreaterThan(databaseTime);
    expect(insert).toBeGreaterThan(newDelegate);
    expect(bind.match(/FROM bind_mainnet_financial_action_submission\(/gu)).toHaveLength(2);
    expect(bind).toContain('requested_signing_payload_sha256');
    expect(bind).toContain('requested_signature_evidence_sha256');
    expect(bind).not.toContain('requested_signed_at');
    expect(bind).not.toContain('requested_server_received_and_verified_at');
    expect(bind).toContain(
      'signed_event.effective_at <>\n            existing_proof.server_received_and_verified_at',
    );
    expect(bind).toContain('signed_event.revision <> requested_expected_revision + 1');
    expect(bind).toContain(
      'signed_event.previous_snapshot_sha256 <>\n            requested_expected_snapshot_sha256',
    );
    expect(bind).toContain(
      'database_verified_at := existing_proof.server_received_and_verified_at',
    );
    expect(bind).toContain("USING ERRCODE = '55000'");
    expect(bind).toContain(
      "RAISE EXCEPTION 'verified mainnet signed-submission proof replay conflict'",
    );
    expect(bind).toContain("USING ERRCODE = '23505'");
  });

  it('makes old-binder bypass fail as a deferred commit-time invariant', () => {
    expect(up).toContain(
      'CREATE CONSTRAINT TRIGGER mainnet_action_signed_submission_proof_after_event',
    );
    expect(up).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(completeness).toContain("NEW.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'");
    expect(completeness).toContain('proof.event_id = NEW.event_id');
    expect(completeness).toContain(
      'proof.signing_payload_sha256 = NEW.wallet_signed_payload_sha256',
    );
    expect(completeness).toContain(
      'proof.signature_evidence_sha256 =\n              NEW.wallet_signature_evidence_sha256',
    );
    expect(completeness).toContain("USING ERRCODE = '23514'");
  });

  it('keeps table and functions owner-only with fixed paths and append-only triggers', () => {
    expect(up).not.toContain('GRANT ');
    expect(up.match(/REVOKE ALL ON FUNCTION/gu)).toHaveLength(3);
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TABLE');
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TYPE');
    expect(up.match(/ENABLE ALWAYS TRIGGER/gu)).toHaveLength(4);
    expect(up).toContain('reject_mainnet_action_history_mutation()');
    expect(up.match(/SET search_path TO pg_catalog, %I, pg_temp/gu)).toHaveLength(3);
  });

  it('verifies exact schema, bodies, ACLs, triggers, data completeness, and 0038', () => {
    for (const marker of [
      'prior.valid AND relation_state.valid AND constraint_state.valid',
      'AND function_state.valid AND trigger_state.valid AND data_state.valid',
      `pg_catalog.count(*) = 23`,
      'expected.body_sha256',
      'acl.grantee <> procedure.proowner',
      'acl.grantee <> relation.relowner',
      'pg_catalog.aclexplode(guarded_attribute.attacl)',
      'acl.grantee <> row_type.typowner',
      'pg_catalog.pg_get_constraintdef(oid, false)',
      'procedure.proargnames[1:procedure.pronargs]',
      'FROM pg_catalog.unnest(procedure.proargtypes::oid[])',
      'procedure.proallargtypes[procedure.pronargs + 1:]',
      "language.lanname = 'plpgsql'",
      "trigger_record.tgenabled = 'A'",
      'trigger_record.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)',
      'trigger_record.tgtype = expected.trigger_type',
      'constraint_record.condeferrable AND constraint_record.condeferred',
      "event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'",
      'proof.intent_id IS NULL',
    ]) {
      expect(verifier).toContain(marker);
    }
  });

  it('is reversibly removable only before proof or signed-bound history exists', () => {
    expect(down).toContain(
      'LOCK TABLE mainnet_financial_action_events, mainnet_financial_action_signed_submission_proofs',
    );
    expect(down).toContain(
      "RAISE EXCEPTION 'cannot roll back verified signed-submission proof history'",
    );
    expect(down).toContain("WHERE stage = 'WALLET_SIGNED_SUBMISSION_BOUND'");
    expect(down.match(/DROP TRIGGER/gu)).toHaveLength(4);
    expect(down.match(/DROP FUNCTION/gu)).toHaveLength(3);
    expect(down).toContain('DROP TABLE mainnet_financial_action_signed_submission_proofs');
    expect(down).not.toContain('DROP FUNCTION bind_mainnet_financial_action_submission');
  });

  it('shares DDL with the test variant and rejects unsafe principals', () => {
    expect(migration.upSql).toEqual(
      createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039.upSql,
    );
    expect(migration.downSql).toEqual(
      createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039.verifySql,
    );
    expect(() =>
      createVerifiedMainnetSignedSubmissionProofMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        migrationRole: 'unsafe-role',
      }),
    ).toThrow('migrationRole');
  });
});
