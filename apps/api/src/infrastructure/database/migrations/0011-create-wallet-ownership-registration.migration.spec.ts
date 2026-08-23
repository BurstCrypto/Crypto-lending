import {
  createWalletOwnershipRegistrationMigration,
  createWalletOwnershipRegistrationMigrationV0011,
  createWalletOwnershipRegistrationTestSchemaMigrationV0011,
} from './0011-create-wallet-ownership-registration.migration';

const joinedSql = (value: string | readonly string[]): string =>
  typeof value === 'string' ? value : value.join('\n');

describe('createWalletOwnershipRegistrationMigration', () => {
  it('publishes matching production and isolated DDL with cumulative verification', () => {
    const canonical = createWalletOwnershipRegistrationMigrationV0011;
    const isolated = createWalletOwnershipRegistrationTestSchemaMigrationV0011;

    expect(canonical.id).toBe('0011');
    expect(canonical.description).toContain('wallet ownership registration');
    expect(canonical.upSql).toEqual(isolated.upSql);
    expect(canonical.downSql).toEqual(isolated.downSql);
    expect(canonical.verifySql).not.toEqual(isolated.verifySql);
    expect(canonical.supersedesVerificationOf).toEqual(['0010']);
    expect(isolated.supersedesVerificationOf).toEqual(['0010']);
  });

  it('stores no plaintext ownership proof, address, origin, nonce, or metadata', () => {
    const sql = joinedSql(createWalletOwnershipRegistrationMigrationV0011.upSql);
    const tableSql = sql.slice(
      sql.indexOf('CREATE TABLE wallet_ownership_challenges'),
      sql.indexOf('CREATE FUNCTION reject_wallet_registration_audit_mutation'),
    );

    expect(tableSql).toContain('address_digest bytea NOT NULL');
    expect(tableSql).toContain('domain_digest bytea NOT NULL');
    expect(tableSql).toContain('message_digest bytea NOT NULL');
    expect(tableSql).toContain('nonce_digest bytea NOT NULL');
    expect(tableSql).toContain('challenge_payload_ciphertext bytea');
    expect(tableSql).toContain('address_ciphertext bytea NOT NULL');
    expect(tableSql).toContain('metadata_ciphertext bytea NOT NULL');
    expect(tableSql).not.toMatch(
      /\n\s+(?:canonical_address|address|origin|uri|message|nonce|signature|connection_metadata)\s+(?:text|bytea)/u,
    );
    expect(tableSql).not.toContain('jsonb');
  });

  it('pins proof schemes and exact KAN-61 environment snapshots to canonical networks', () => {
    const sql = joinedSql(createWalletOwnershipRegistrationMigrationV0011.upSql);

    expect(sql).toContain("'EVM_ERC4361_ERC191'");
    expect(sql).toContain("'SOLANA_SIWS_SIGN_IN'");
    expect(sql).toContain("'SOLANA_SIWS_SIGN_MESSAGE'");
    expect(sql).toContain("registry_environment = 'MAINNET'");
    expect(sql).toContain("registry_environment = 'TESTNET'");
    expect(sql).toContain('5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d');
    expect(sql).toContain('89c158de188fcde7d01642aadef226f3c93724bfe5b53a7f3fcce096180d5ca7');
    expect(sql).toContain("chain_reference IN ('1', '8453', '42161')");
    expect(sql).toContain("chain_reference IN ('11155111', '84532', '421614')");
    expect(sql).toContain("chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'");
    expect(sql).toContain("chain_reference = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'");
  });

  it('limits account challenges under an advisory lock and enforces exact expiry bounds', () => {
    const sql = joinedSql(createWalletOwnershipRegistrationMigrationV0011.upSql);
    const begin = sql.slice(
      sql.indexOf('CREATE FUNCTION begin_wallet_ownership_challenge'),
      sql.indexOf('CREATE FUNCTION prepare_wallet_ownership_challenge'),
    );

    expect(begin).toContain('pg_advisory_xact_lock');
    expect(begin).toContain('challenge.account_id = requested_account_id');
    expect(begin).toContain("challenge.status = 'PENDING'");
    expect(begin).toContain('pending_challenge_count >= 5');
    expect(begin).toContain("requested_issued_at < recorded_at - interval '30 seconds'");
    expect(begin).toContain("requested_expires_at < requested_issued_at + interval '60 seconds'");
    expect(begin).toContain("requested_expires_at > requested_issued_at + interval '10 minutes'");
  });

  it('prepares a ready record without consuming it and atomically shreds expired payloads', () => {
    const sql = joinedSql(createWalletOwnershipRegistrationMigrationV0011.upSql);
    const prepare = sql.slice(
      sql.indexOf('CREATE FUNCTION prepare_wallet_ownership_challenge'),
      sql.indexOf('CREATE FUNCTION reject_wallet_ownership_challenge'),
    );

    expect(prepare).toContain('VOLATILE');
    expect(prepare).toContain('PARALLEL UNSAFE');
    expect(prepare).toContain('challenge.account_id = requested_account_id');
    expect(prepare).toContain("'READY'::text");
    expect(prepare).toContain('prepared_challenge_payload_ciphertext bytea');
    expect(prepare).toContain('prepared_registry_fingerprint_sha256 text');
    expect(prepare).toContain('ownership_challenge.issued_at');
    expect(prepare).toContain('FOR UPDATE');
    expect(prepare).toContain("SET status = 'EXPIRED'");
    expect(prepare).toContain('challenge_payload_ciphertext = NULL');
    expect(prepare).toContain("'CHALLENGE_EXPIRED'");
    expect(sql).not.toContain("status = 'CLAIMED'");
  });

  it('atomically terminalizes rejection, expiry, registration, conflict, and replay', () => {
    const sql = joinedSql(createWalletOwnershipRegistrationMigrationV0011.upSql);
    const terminal = sql.slice(
      sql.indexOf('CREATE FUNCTION reject_wallet_ownership_challenge'),
      sql.indexOf('function createWalletRegistrationTriggersAndAclSql'),
    );

    expect(terminal).toContain('FOR UPDATE');
    expect(terminal).toContain("ownership_challenge.status <> 'PENDING'");
    expect(terminal).toContain("'REPLAYED'::text");
    expect(terminal).toContain("failure_reason = 'OWNERSHIP_CONFLICT'");
    expect(terminal).toContain("'ALREADY_REGISTERED'::text");
    expect(terminal).toContain("'REGISTERED'::text");
    expect(terminal).toContain('payload_destroyed_at = recorded_at');
    expect(terminal).toContain('challenge_payload_ciphertext = NULL');
  });

  it('serializes exact active identity registration and keeps cross-account conflicts opaque', () => {
    const sql = joinedSql(createWalletOwnershipRegistrationMigrationV0011.upSql);
    const completion = sql.slice(sql.indexOf('CREATE FUNCTION complete_wallet_registration'));
    const walletLock = completion.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock');
    const postLockClock = completion.indexOf('recorded_at := clock_timestamp();', walletLock);
    const postLockExpiry = completion.indexOf(
      'IF recorded_at >= ownership_challenge.expires_at THEN',
      postLockClock,
    );
    const walletLookup = completion.indexOf('SELECT wallet.*', postLockExpiry);

    expect(sql).toContain('CREATE UNIQUE INDEX registered_wallets_one_active_identity');
    expect(sql).toContain(
      'chain_namespace, chain_reference, address_digest_version, address_digest',
    );
    expect(sql).toContain("WHERE status = 'ACTIVE'");
    expect(completion).toContain('pg_advisory_xact_lock');
    expect(completion).toContain('active_wallet.account_id IS DISTINCT FROM requested_account_id');
    expect(completion).toContain("'OWNERSHIP_CONFLICT'::text, NULL::uuid, NULL::timestamptz");
    expect(completion).toContain('ownership_challenge.registry_environment');
    expect(completion).toContain('ownership_challenge.registry_fingerprint_sha256');
    expect(walletLock).toBeGreaterThan(-1);
    expect(postLockClock).toBeGreaterThan(walletLock);
    expect(postLockExpiry).toBeGreaterThan(postLockClock);
    expect(walletLookup).toBeGreaterThan(postLockExpiry);
  });

  it('makes bindings and audit immutable while granting only four definer functions', () => {
    const custom = createWalletOwnershipRegistrationMigration({
      bootstrapRole: 'wallet_bootstrap',
      schemaOwnerRole: 'wallet_owner',
      migrationRole: 'wallet_migrator',
      legacyRuntimeRole: 'wallet_legacy',
      apiRuntimeRole: 'wallet_api',
      workerRuntimeRole: 'wallet_worker',
      apiLoginPrefix: 'wallet_api_login_',
      workerLoginPrefix: 'wallet_worker_login_',
    });
    const sql = joinedSql(custom.upSql);
    const grants = sql.match(/GRANT EXECUTE ON FUNCTION [^;]+ TO "wallet_api";/gu) ?? [];

    expect(grants).toHaveLength(4);
    expect(sql).toContain('wallet ownership challenge binding is immutable');
    expect(sql).toContain('registered wallet identity is immutable');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON wallet_registration_audit_events');
    expect(sql).toContain('BEFORE TRUNCATE ON wallet_registration_audit_events');
    expect(sql).toContain('ENABLE ALWAYS TRIGGER wallet_registration_audit_append_only_row');
    expect(sql).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON TABLE/u);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]+TO "wallet_worker"/u);
  });

  it('extends the cumulative principal verifier and checks the wallet boundary', () => {
    const canonical = createWalletOwnershipRegistrationMigrationV0011.verifySql ?? '';
    const isolated = createWalletOwnershipRegistrationTestSchemaMigrationV0011.verifySql ?? '';

    expect(canonical).toContain('prior.valid AND wallet_registration.valid');
    expect(canonical).toContain('complete_authentication_login');
    expect(canonical).toContain('wallet_registration_row_table');
    expect(canonical).toContain('registered_wallets_one_active_identity');
    expect(canonical).toContain('wallet_ownership_challenge_payload_encryption_check');
    expect(canonical).toContain('prepare_wallet_ownership_challenge(uuid,uuid,uuid)');
    expect(isolated).toContain('prior.valid AND wallet_registration.valid');
    expect(isolated).not.toContain('wallet_registration_row_table');
  });

  it('refuses destructive rollback after any retained wallet security state', () => {
    const sql = joinedSql(createWalletOwnershipRegistrationMigrationV0011.downSql);

    expect(sql).toContain('cannot roll back retained wallet ownership security state');
    expect(sql).toContain('EXISTS (SELECT 1 FROM wallet_ownership_challenges)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM registered_wallets)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM wallet_registration_audit_events)');
  });
});
