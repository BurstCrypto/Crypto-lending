import { createHash } from 'node:crypto';

import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createWalletKeyRotationBoundaryMigration } from './0022-create-wallet-key-rotation-boundary.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MAINNET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const RESOLVE_ACTIVE_ADDRESS = 'resolve_active_wallet_address_ciphertext(uuid,uuid,text)';

// This is the exact worker allowlist produced by migration 0022's cumulative
// verifier. Migration 0023 extends it by one function and nothing else.
const PRIOR_WORKER_FUNCTIONS = [
  'verify_wallet_revocation_state()',
  'read_aave_v3_ethereum_finalized_checkpoint(text)',
  'record_aave_v3_ethereum_finalized_checkpoint(bigint,uuid,text,text,text,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone)',
  'recover_aave_v3_ethereum_finalized_checkpoint(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb)',
  'read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint)',
  'record_stablecoin_depeg_latch(bigint,uuid,text,text,smallint,text,text,text,smallint,timestamp with time zone,text,text,text,text,text)',
  'read_balance_sync_checkpoint(uuid,uuid,text)',
  'record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
  'mark_balance_sync_checkpoint_stale(uuid,uuid,text,bigint,timestamp with time zone,text)',
  'replace_balance_sync_after_reorg(uuid,uuid,text,bigint,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
  'record_stablecoin_price_evidence(uuid,text,text,timestamp with time zone,text,text,text,smallint,text,text,text,text,smallint,text,text,numeric,text,timestamp with time zone,timestamp with time zone,numeric,smallint,text,numeric,smallint,text,text,text)',
] as const;

const RESOLVER_BODY = `
    SELECT
      wallet.wallet_id AS resolved_wallet_id,
      wallet.account_id AS resolved_account_id,
      wallet.registered_by_challenge_id AS resolved_challenge_id,
      wallet.chain_namespace || ':' || wallet.chain_reference AS resolved_network_id,
      wallet.address_digest_version AS resolved_address_digest_version,
      wallet.address_digest AS resolved_address_digest,
      wallet.address_key_version AS resolved_address_key_version,
      wallet.address_ciphertext AS resolved_address_ciphertext,
      wallet.address_iv AS resolved_address_iv,
      wallet.address_auth_tag AS resolved_address_auth_tag
    FROM registered_wallets AS wallet
    WHERE requested_network_id IN (
        'eip155:1',
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      )
      AND wallet.account_id = requested_account_id
      AND wallet.wallet_id = requested_wallet_id
      AND wallet.chain_namespace || ':' || wallet.chain_reference = requested_network_id
      AND wallet.status = 'ACTIVE'
      AND wallet.revoked_at IS NULL
      AND wallet.registry_environment = 'MAINNET'
      AND wallet.registry_version = 1
      AND wallet.registry_fingerprint_sha256 = '${MAINNET_REGISTRY_FINGERPRINT}'
      AND wallet.address_encryption_algorithm = 'AES_256_GCM'
      AND wallet.address_key_version > 0
      AND pg_catalog.octet_length(wallet.address_digest) = 32
      AND pg_catalog.octet_length(wallet.address_ciphertext) BETWEEN 1 AND 128
      AND pg_catalog.octet_length(wallet.address_iv) = 12
      AND pg_catalog.octet_length(wallet.address_auth_tag) = 16
      AND EXISTS (
        SELECT 1
        FROM registered_wallet_identity_digests AS alias
        INNER JOIN wallet_identity_key_policy AS policy
          ON policy.policy_name = 'wallet-registration-identity-hmac'
          AND policy.schema_version = 1
          AND alias.address_digest_version = ANY (policy.accepted_read_versions)
        WHERE alias.wallet_id = wallet.wallet_id
          AND alias.account_id = wallet.account_id
          AND alias.chain_namespace = wallet.chain_namespace
          AND alias.chain_reference = wallet.chain_reference
          AND alias.status = 'ACTIVE'
          AND alias.revoked_at IS NULL
          AND alias.registered_at = wallet.registered_at
          AND alias.revoked_at IS NOT DISTINCT FROM wallet.revoked_at
      );
    `;

const RESOLVER_BODY_SHA256 = createHash('sha256').update(RESOLVER_BODY, 'utf8').digest('hex');

function identifier(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a lowercase PostgreSQL identifier`);
  }
  return `"${value}"`;
}

function literal(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  }
  return `'${value}'`;
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0023 verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function functionAllowance(role: string, functions: readonly string[]): string {
  return `            OR (
              grantee.rolname = ${role}
              AND procedure.oid IN (
                ${functions.map((value) => `to_regprocedure('${value}')`).join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
}

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  return `CREATE FUNCTION resolve_active_wallet_address_ciphertext(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_network_id text
    ) RETURNS TABLE (
      resolved_wallet_id uuid,
      resolved_account_id uuid,
      resolved_challenge_id uuid,
      resolved_network_id text,
      resolved_address_digest_version smallint,
      resolved_address_digest bytea,
      resolved_address_key_version smallint,
      resolved_address_ciphertext bytea,
      resolved_address_iv bytea,
      resolved_address_auth_tag bytea
    )
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    STRICT
    PARALLEL UNSAFE
    ROWS 1
    AS $function$${RESOLVER_BODY}$function$;

    DO $set_balance_consumer_resolver_path$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RESOLVE_ACTIVE_ADDRESS} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_balance_consumer_resolver_path$;

    REVOKE ALL ON FUNCTION ${RESOLVE_ACTIVE_ADDRESS}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    GRANT EXECUTE ON FUNCTION ${RESOLVE_ACTIVE_ADDRESS} TO ${worker};`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  return `REVOKE EXECUTE ON FUNCTION ${RESOLVE_ACTIVE_ADDRESS} FROM ${worker};
    DROP FUNCTION ${RESOLVE_ACTIVE_ADDRESS} RESTRICT;`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createWalletKeyRotationBoundaryMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0022 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  let prior = priorMigration.verifySql;
  if (cumulative) {
    prior = replaceExactlyOnce(
      prior,
      functionAllowance(worker, PRIOR_WORKER_FUNCTIONS),
      functionAllowance(worker, [...PRIOR_WORKER_FUNCTIONS, RESOLVE_ACTIVE_ADDRESS]),
    );
  }
  return `SELECT (prior.valid AND function_state.valid AND privileges.valid) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
        AND pg_catalog.bool_and(function_state.prosecdef)
        AND pg_catalog.bool_and(function_state.provolatile = 's')
        AND pg_catalog.bool_and(function_state.proisstrict)
        AND pg_catalog.bool_and(function_state.proparallel = 'u')
        AND pg_catalog.bool_and(NOT function_state.proleakproof)
        AND pg_catalog.bool_and(function_state.prorows = 1)
        AND pg_catalog.bool_and(function_state.proconfig = ARRAY[
          'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
        ]::text[])
        AND pg_catalog.bool_and(
          pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(function_state.prosrc, 'UTF8')),
            'hex'
          ) = '${RESOLVER_BODY_SHA256}'
        )
        AND pg_catalog.bool_and(
          pg_catalog.pg_get_function_result(function_state.oid) =
          'TABLE(resolved_wallet_id uuid, resolved_account_id uuid, resolved_challenge_id uuid, resolved_network_id text, resolved_address_digest_version smallint, resolved_address_digest bytea, resolved_address_key_version smallint, resolved_address_ciphertext bytea, resolved_address_iv bytea, resolved_address_auth_tag bytea)'
        ) AS valid
      FROM pg_catalog.pg_proc AS function_state
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function_state.pronamespace
      INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = function_state.proowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND function_state.oid = pg_catalog.to_regprocedure('${RESOLVE_ACTIVE_ADDRESS}')
    ) AS function_state
    CROSS JOIN (
      SELECT (
        pg_catalog.has_function_privilege(${worker}, '${RESOLVE_ACTIVE_ADDRESS}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${api}, '${RESOLVE_ACTIVE_ADDRESS}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${legacy}, '${RESOLVE_ACTIVE_ADDRESS}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${migration}, '${RESOLVE_ACTIVE_ADDRESS}', 'EXECUTE')
        AND (
          SELECT pg_catalog.count(*) = 1
            AND pg_catalog.bool_and(grantee.rolname = ${worker})
            AND pg_catalog.bool_and(acl.privilege_type = 'EXECUTE')
            AND pg_catalog.bool_and(NOT acl.is_grantable)
          FROM pg_catalog.pg_proc AS procedure
          INNER JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
          LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
          WHERE namespace.nspname = pg_catalog.current_schema()
            AND procedure.oid = pg_catalog.to_regprocedure('${RESOLVE_ACTIVE_ADDRESS}')
            AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))
        )
        AND NOT pg_catalog.has_table_privilege(${worker}, 'registered_wallets', 'SELECT')
        AND NOT pg_catalog.has_table_privilege(
          ${worker}, 'registered_wallet_identity_digests', 'SELECT'
        )
        AND NOT pg_catalog.has_table_privilege(${worker}, 'wallet_identity_key_policy', 'SELECT')
      ) AS valid
    ) AS privileges`;
}

export function createBalanceConsumerWalletAddressBoundaryMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0023',
    description: 'create least-privilege balance consumer wallet address boundary',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0022'],
  };
}

export const createBalanceConsumerWalletAddressBoundaryMigrationV0023 =
  createBalanceConsumerWalletAddressBoundaryMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023 =
  createBalanceConsumerWalletAddressBoundaryMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
