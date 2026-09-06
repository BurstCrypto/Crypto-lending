import {
  createProviderPositionChainAnchorEvidenceMigration,
  createProviderPositionChainAnchorEvidenceMigrationV0029,
  createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029,
} from './0029-create-provider-position-chain-anchor-evidence.migration';
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

describe('migration 0029 provider position chain anchor evidence', () => {
  it('extends the suspended 0028 authority boundary without enabling ingestion', () => {
    const migration = createProviderPositionChainAnchorEvidenceMigrationV0029;

    expect(migration.id).toBe('0029');
    expect(migration.supersedesVerificationOf).toEqual(['0028']);
    expect(migration.transactional).not.toBe(false);
    expect(migration.description).toContain('Ethereum and Solana');
    expect(migration.description).toContain('dormant');
  });

  it('stores global chain facts without account, wallet, address, or ciphertext columns', () => {
    const up = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql);
    const evidenceTable = between(
      up,
      'CREATE TABLE provider_position_chain_anchor_evidence (',
      'COMMENT ON TABLE provider_position_chain_anchor_evidence',
    );
    const controlTable = between(
      up,
      'CREATE TABLE provider_position_chain_anchor_control_events (',
      'COMMENT ON TABLE provider_position_chain_anchor_control_events',
    );

    for (const table of [evidenceTable, controlTable]) {
      expect(table).not.toMatch(/\baccount_id\b/u);
      expect(table).not.toMatch(/\bwallet_id\b/u);
      expect(table).not.toMatch(/\baddress_(?:digest|ciphertext|iv|auth_tag)\b/u);
    }
    expect(up).toContain('global-chain-facts;no-wallet-pii;append-only');
    expect(evidenceTable).toContain('read_binding_fingerprint_sha256 text NOT NULL');
    expect(evidenceTable).toContain('provider_position_chain_anchor_read_binding_unique UNIQUE');
  });

  it('admits only exact Ethereum and Solana anchors with explicit independent proof facts', () => {
    const up = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql);

    expect(up).toContain(
      "requested_network_id NOT IN ('eip155:1', '${SOLANA}')".replace(
        '${SOLANA}',
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      ),
    );
    expect(up).not.toContain('eip155:8453');
    expect(up).not.toContain('eip155:42161');
    expect(up).not.toContain('eip155:11155111');
    for (const field of [
      'identity_proof_sha256',
      'live_capability_proof_sha256',
      'lineage_proof_sha256',
      'agreed_current_head',
      'agreed_finalized_head',
      'current_head_advanced_at',
      'finalized_head_advanced_at',
    ]) {
      expect(up).toContain(`${field} `);
      expect(up).toContain(`requested_${field}`);
    }
    expect(up).toContain("requested_identity_proof_sha256 = pg_catalog.repeat('0', 64)");
    expect(up).toContain("requested_live_capability_proof_sha256 = pg_catalog.repeat('0', 64)");
    expect(up).toContain("requested_lineage_proof_sha256 = pg_catalog.repeat('0', 64)");
    expect(up).toContain("requested_anchor ->> 'blockHash' ~ '^0x[0-9a-f]{64}$'");
    expect(up).toContain("requested_anchor ->> 'root')::numeric <=");
    expect(up).toContain('SELECT COALESCE(CASE requested_network_id');
    expect(up).toContain('END, false);');
    expect(up).toContain(
      "requested_source_observation_id = 'ethereum-block-'\n              || (requested_chain_anchor ->> 'blockNumber')",
    );
    expect(up).toContain(
      "requested_source_observation_id = 'solana-slot-'\n              || (requested_chain_anchor ->> 'slot')",
    );
  });

  it('requires a canonical independent pair containing the selected source', () => {
    const up = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql);
    const record = between(
      up,
      'CREATE FUNCTION record_provider_position_chain_anchor_evidence(',
      'CREATE FUNCTION invalidate_provider_position_chain_anchor_evidence(',
    );

    expect(record).toContain('requested_primary_source_family_id COLLATE "C"');
    expect(record).toContain('requested_corroborating_source_family_id COLLATE "C"');
    expect(record).toContain(
      'requested_primary_source_family_id = requested_corroborating_source_family_id',
    );
    expect(record).toContain('requested_primary_source_id = requested_corroborating_source_id');
    expect(record).toContain('requested_source_family_id = requested_primary_source_family_id');
    expect(record).toContain(
      'requested_source_family_id = requested_corroborating_source_family_id',
    );
    expect(record).toContain('requested_source_pair_approval_expires_at');
    expect(record).toContain('requested_source_pair_registry_fingerprint_sha256');
  });

  it('binds every proof and head fact into immutable evidence and a unique exact read key', () => {
    const up = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql);

    expect(up).toContain("'crypto-lending:provider-position-chain-anchor-read-binding:v1'");
    expect(up).toContain("'crypto-lending:provider-position-chain-anchor-evidence:v1'");
    expect(up).toContain(
      'requested_read_binding_fingerprint_sha256 =\n        provider_position_chain_anchor_read_binding_fingerprint(',
    );
    expect(up).toContain(
      'requested_evidence_fingerprint_sha256 =\n        provider_position_chain_anchor_evidence_fingerprint(',
    );
    for (const requested of [
      'requested_agreed_current_head',
      'requested_current_head_advanced_at',
      'requested_agreed_finalized_head',
      'requested_finalized_head_advanced_at',
      'requested_identity_proof_sha256',
      'requested_live_capability_proof_sha256',
      'requested_lineage_proof_sha256',
      'requested_source_pair_approval_id',
      'requested_source_pair_approval_expires_at',
    ]) {
      expect(count(up, requested)).toBeGreaterThanOrEqual(4);
    }
    expect(up).toContain(
      'WHERE evidence.read_binding_fingerprint_sha256 = requested_read_binding_fingerprint',
    );
    expect(up).not.toContain('ORDER BY evidence.assessed_at DESC');
    expect(up).not.toContain('LIMIT 1\n      FOR SHARE OF evidence');
    expect(up).toContain('SELECT evidence.* INTO STRICT selected_evidence');
    expect(up).toContain('WHEN NO_DATA_FOUND THEN');
    expect(up).toContain('WHEN TOO_MANY_ROWS THEN');
    expect(up).toContain("USING ERRCODE = '21000'");
  });

  it('checks request time order, evidence cutoff, approval expiry, and both chain windows', () => {
    const up = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql);
    const read = between(
      up,
      'CREATE FUNCTION read_provider_position_chain_anchor_evidence(',
      'DO $set_provider_position_chain_anchor_paths$',
    );

    expect(read).toContain('requested_observed_at > requested_captured_at');
    expect(read).toContain('requested_captured_at > requested_evaluated_at');
    expect(read).toContain('requested_evaluated_at >= requested_deadline_at');
    expect(read).toContain(
      "requested_deadline_at > requested_evaluated_at + interval '30 seconds'",
    );
    expect(read).toContain('requested_evaluated_at > database_read_at');
    expect(read).toContain('database_read_at >= requested_deadline_at');
    expect(read).toContain('evidence.recorded_at <= requested_evaluated_at');
    expect(read).toContain('requested_evaluated_at < evidence.source_pair_approval_expires_at');
    expect(read).toContain("WHEN requested_network_id = 'eip155:1' THEN interval '60 seconds'");
    expect(read).toContain("ELSE interval '15 seconds'");
    expect(read).toContain("WHEN requested_network_id = 'eip155:1' THEN interval '1800 seconds'");
    expect(read).toContain("ELSE interval '90 seconds'");
    expect(read).toContain('evidence.assessed_at <= requested_captured_at');
    expect(count(read, 'database_read_at < evidence.source_pair_approval_expires_at')).toBe(1);
    expect(count(read, 'database_read_at < evidence.current_head_advanced_at')).toBe(1);
    expect(count(read, 'database_read_at < evidence.finalized_head_advanced_at')).toBe(1);
    expect(
      count(read, 'database_read_at >= selected_evidence.source_pair_approval_expires_at'),
    ).toBe(2);
    expect(count(read, 'database_read_at >= selected_evidence.current_head_advanced_at')).toBe(2);
    expect(count(read, 'database_read_at >= selected_evidence.finalized_head_advanced_at')).toBe(2);
  });

  it('validates the active chain-bound wallet under the revocation lock and row lock', () => {
    const up = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql);
    const read = between(
      up,
      'CREATE FUNCTION read_provider_position_chain_anchor_evidence(',
      'DO $set_provider_position_chain_anchor_paths$',
    );
    const accountLock = read.indexOf(
      'pg_catalog.hashtextextended(requested_account_id::text, 56001)',
    );
    const walletRead = read.indexOf('FROM registered_wallets AS wallet');
    const walletLock = read.indexOf('FOR UPDATE OF wallet;');
    const evidenceLock = read.indexOf('FOR SHARE OF evidence;');
    const controlCheck = read.indexOf(
      'FROM provider_position_chain_anchor_control_events AS control',
    );
    const lastClockRead = read.lastIndexOf(
      "database_read_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())",
    );
    const resultReturn = read.indexOf('RETURN QUERY SELECT');

    expect(accountLock).toBeGreaterThanOrEqual(0);
    expect(read).toContain(
      "pg_catalog.current_setting('transaction_isolation') <> 'read committed'",
    );
    expect(walletRead).toBeGreaterThan(accountLock);
    expect(walletLock).toBeGreaterThan(walletRead);
    expect(evidenceLock).toBeGreaterThan(walletLock);
    expect(controlCheck).toBeGreaterThan(evidenceLock);
    expect(count(read, 'database_read_at := pg_catalog.date_trunc')).toBe(4);
    expect(lastClockRead).toBeGreaterThan(controlCheck);
    expect(resultReturn).toBeGreaterThan(lastClockRead);
    expect(read).toContain("wallet.status = 'ACTIVE'");
    expect(read).toContain('wallet.revoked_at IS NULL');
    expect(read).toContain("wallet.registry_environment = 'MAINNET'");
    expect(read).toContain('wallet.chain_namespace = requested_chain_namespace');
    expect(read).toContain('wallet.chain_reference = requested_chain_reference');
  });

  it('makes evidence and invalidation history append-only with conflict-safe replay', () => {
    const up = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql);

    expect(count(up, 'ENABLE ALWAYS TRIGGER')).toBe(4);
    expect(count(up, 'BEFORE UPDATE OR DELETE ON provider_position_chain_anchor_')).toBe(2);
    expect(count(up, 'BEFORE TRUNCATE ON provider_position_chain_anchor_')).toBe(2);
    expect(up).toContain('provider position chain anchor history is append-only');
    expect(up).toContain("RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text");
    expect(up).toContain('provider position chain anchor evidence replay conflict');
    expect(up).toContain('provider position chain anchor control replay conflict');
    expect(up).toContain("requested_control_action NOT IN ('INVALIDATED', 'QUARANTINED')");
    expect(up).toContain("control.control_action IN ('INVALIDATED', 'QUARANTINED')");
  });

  it('gives only API execute on the fixed-path read function', () => {
    const up = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql);
    const readIdentity =
      'read_provider_position_chain_anchor_evidence(uuid,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)';
    const recordIdentity =
      'record_provider_position_chain_anchor_evidence(text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone,jsonb,timestamp with time zone,text,text,text,text,text,text,text,text,text,timestamp with time zone)';

    expect(count(up, 'GRANT EXECUTE ON FUNCTION')).toBe(1);
    expect(up).toContain(`GRANT EXECUTE ON FUNCTION ${readIdentity} TO "crypto_api_runtime";`);
    expect(up).not.toContain('GRANT SELECT');
    expect(up).not.toContain('GRANT INSERT');
    expect(up).not.toMatch(/GRANT EXECUTE[^;]+(?:record|invalidate)_provider_position/u);
    expect(up).toContain(`REVOKE ALL ON FUNCTION ${recordIdentity} FROM PUBLIC`);
    expect(up).toContain(
      'FROM PUBLIC, "crypto_api_runtime", "crypto_worker_runtime", "crypto_runtime", "crypto_balance_consumer_runtime", "crypto_migration";',
    );
    expect(up).toContain(
      `ALTER FUNCTION %I.${readIdentity} SET search_path TO pg_catalog, %I, pg_temp`,
    );
    expect(count(up, 'LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE')).toBe(3);
  });

  it('keeps 0028 suspensions cumulative while extending only the API read allowlist', () => {
    const verifier = createProviderPositionChainAnchorEvidenceMigrationV0029.verifySql ?? '';
    const readIdentity =
      'read_provider_position_chain_anchor_evidence(uuid,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)';

    expect(verifier).toContain(
      `pg_catalog.has_function_privilege('crypto_api_runtime', '${readIdentity}', 'EXECUTE')`,
    );
    expect(verifier).toContain(
      `NOT pg_catalog.has_function_privilege('crypto_worker_runtime', '${readIdentity}', 'EXECUTE')`,
    );
    for (const suspended of [
      'read_balance_sync_checkpoint(uuid,uuid,text)',
      'record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
      'resolve_active_wallet_address_ciphertext(uuid,uuid,text)',
    ]) {
      expect(verifier).toContain(
        `NOT pg_catalog.has_function_privilege('crypto_worker_runtime', '${suspended}', 'EXECUTE')`,
      );
    }
    expect(verifier).toContain("role.rolname = 'crypto_balance_consumer_runtime'");
    expect(verifier).toContain('SELECT pg_catalog.count(*) = 41');
    expect(verifier).toContain('SELECT pg_catalog.count(*) = 6');
    expect(verifier).toContain("WHEN 'provider_position_chain_anchor_read_binding_unique' THEN");
    expect(verifier).toContain('constraint_state.conkey = ARRAY[2]::smallint[]');
    expect(verifier).toContain("relation.relpersistence = 'p'");
    expect(verifier).toContain('NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity');
    expect(verifier).toContain(
      "index_state.indkey = '7 8 9 10 11 14 15 33 1'::pg_catalog.int2vector",
    );
    expect(verifier).toContain(
      "index_state.indoption = '0 0 0 0 0 0 3 3 0'::pg_catalog.int2vector",
    );
    expect(verifier).toContain("WHEN 'provider_position_chain_anchor_evidence_valid_check' THEN");
    expect(verifier).toContain('pg_catalog.pg_get_expr(');
    expect(verifier).toContain("dependency.refobjid = pg_catalog.to_regprocedure('");
    expect(verifier).toContain('pg_catalog.pg_get_function_result(procedure.oid)');
    expect(verifier).toContain("procedure.prokind = 'f'");
    expect(verifier).toContain("trigger.tgattr = ''::pg_catalog.int2vector");
    expect(verifier).toContain(`pg_catalog.to_regprocedure('${readIdentity}')`);
  });

  it('shares DDL with isolated schemas but keeps cluster verification isolated', () => {
    expect(createProviderPositionChainAnchorEvidenceMigrationV0029.upSql).toEqual(
      createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029.upSql,
    );
    expect(createProviderPositionChainAnchorEvidenceMigrationV0029.downSql).toEqual(
      createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029.downSql,
    );
    expect(createProviderPositionChainAnchorEvidenceMigrationV0029.verifySql).not.toEqual(
      createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029.verifySql,
    );
    expect(createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029.verifySql).toContain(
      'SELECT true AS valid',
    );
  });

  it('validates principal identities through the 0028 predecessor contract', () => {
    expect(() =>
      createProviderPositionChainAnchorEvidenceMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        apiRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('apiRuntimeRole');
    expect(() =>
      createProviderPositionChainAnchorEvidenceMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        balanceConsumerRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('balanceConsumerRuntimeRole');
  });

  it('refuses rollback after either history has been used', () => {
    const down = sql(createProviderPositionChainAnchorEvidenceMigrationV0029.downSql);

    expect(down).toContain('IF EXISTS (SELECT 1 FROM provider_position_chain_anchor_evidence)');
    expect(down).toContain(
      'OR EXISTS (SELECT 1 FROM provider_position_chain_anchor_control_events)',
    );
    expect(down).toContain('cannot roll back provider position chain anchor evidence after use');
    expect(down).toContain("USING ERRCODE = '55000'");
    expect(down).toContain(
      'DROP FUNCTION provider_position_chain_anchor_read_binding_fingerprint(',
    );
    expect(down).not.toContain('GRANT');
  });
});
