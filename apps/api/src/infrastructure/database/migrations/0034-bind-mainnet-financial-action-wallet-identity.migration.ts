import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionLifecycleMigration } from './0033-create-mainnet-financial-action-lifecycle.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const PREPARE_V2 =
  'prepare_mainnet_financial_action_lifecycle_v2(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,integer,text,text,text,smallint,text,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,uuid,smallint[],text[])';
const PREPARE_V2_INPUT_ARGUMENTS = Object.freeze([
  ['requested_intent_id', 'uuid'],
  ['requested_account_id', 'uuid'],
  ['requested_yield_operation_id', 'uuid'],
  ['requested_yield_submission_id', 'uuid'],
  ['requested_ledger_transaction_id', 'uuid'],
  ['requested_ledger_book_id', 'uuid'],
  ['requested_wallet_id', 'uuid'],
  ['requested_volatile_intent_commitment_sha256', 'text'],
  ['requested_idempotency_key_digest_sha256', 'text'],
  ['requested_replay_protection_id', 'uuid'],
  ['requested_network_id', 'text'],
  ['requested_provider_id', 'text'],
  ['requested_protocol_id', 'text'],
  ['requested_market_id', 'text'],
  ['requested_asset_registry_version', 'integer'],
  ['requested_asset_registry_fingerprint_sha256', 'text'],
  ['requested_asset_symbol', 'text'],
  ['requested_asset_identity', 'text'],
  ['requested_asset_decimals', 'smallint'],
  ['requested_action_type', 'text'],
  ['requested_amount_atomic', 'text'],
  ['requested_requested_value_usd_micros', 'text'],
  ['requested_maximum_network_fee_atomic', 'text'],
  ['requested_maximum_network_fee_basis_points', 'integer'],
  ['requested_minimum_post_action_native_balance_atomic', 'text'],
  ['requested_allowance_mode', 'text'],
  ['requested_allowance_amount_atomic', 'text'],
  ['requested_issued_at', 'timestamp with time zone'],
  ['requested_expires_at', 'timestamp with time zone'],
  ['requested_correlation_id', 'uuid'],
  ['requested_wallet_identity_digest_versions', 'smallint[]'],
  ['requested_wallet_identity_digests_hex', 'text[]'],
] as const);
const HISTORY_TABLES = Object.freeze([
  'mainnet_financial_action_intents',
  'mainnet_financial_action_events',
  'mainnet_financial_action_evidence_claims',
] as const);

function identifier(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  }
  return value;
}

function literal(value: string, name: string): string {
  identifier(value, name);
  return `'${value}'`;
}

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function resultColumns(): string {
  return `
      record_outcome text,
      result_intent_id uuid,
      lifecycle_stage text,
      lifecycle_revision bigint,
      current_snapshot_sha256 text,
      intent_record_fingerprint_sha256 text,
      volatile_intent_commitment_sha256 text,
      fingerprint_encoding_version smallint,
      account_id uuid,
      yield_operation_id uuid,
      yield_submission_id uuid,
      ledger_transaction_id uuid,
      ledger_book_id uuid,
      wallet_id uuid,
      wallet_chain_namespace text,
      wallet_chain_reference text,
      wallet_identity_digest_version smallint,
      wallet_identity_digest_hex text,
      network_id text,
      provider_id text,
      protocol_id text,
      market_id text,
      asset_registry_version integer,
      asset_registry_fingerprint_sha256 text,
      asset_symbol text,
      asset_identity text,
      asset_decimals smallint,
      action_type text,
      amount_atomic numeric,
      requested_value_usd_micros numeric,
      maximum_network_fee_atomic numeric,
      maximum_network_fee_basis_points integer,
      minimum_post_action_native_balance_atomic numeric,
      allowance_mode text,
      allowance_amount_atomic numeric,
      idempotency_key_digest_sha256 text,
      replay_protection_id uuid,
      chain_transaction_id text,
      submission_fingerprint_sha256 text,
      observation_id uuid,
      broadcast_outcome text,
      reconciliation_outcome text,
      transaction_position numeric,
      transaction_block_id text,
      transaction_block_identity_sha256 text,
      finalized_position numeric,
      finalized_block_id text,
      finalized_block_identity_sha256 text,
      last_observed_transaction_position numeric,
      last_observed_transaction_block_id text,
      last_observed_transaction_block_identity_sha256 text,
      effective_at timestamptz,
      expires_at timestamptz,
      terminal boolean,
      requires_manual_reconciliation boolean,
      database_replay_protection_enforced boolean,
      ledger_settlement_authority boolean,
      recorded_at timestamptz`;
}

function resultColumnNames(): readonly string[] {
  return resultColumns()
    .split(',')
    .map((column) => column.trim().split(/\s+/u)[0] ?? '');
}

const PREPARE_V2_BODY = `
    DECLARE
      policy_accepted_read_versions smallint[];
      target_wallet_chain_namespace text;
      target_wallet_chain_reference text;
      candidate_count integer;
      candidate_index integer;
    BEGIN
      IF requested_wallet_identity_digest_versions IS NULL
        OR requested_wallet_identity_digests_hex IS NULL
        OR pg_catalog.array_ndims(requested_wallet_identity_digest_versions) IS DISTINCT FROM 1
        OR pg_catalog.array_ndims(requested_wallet_identity_digests_hex) IS DISTINCT FROM 1
        OR pg_catalog.array_lower(requested_wallet_identity_digest_versions, 1) IS DISTINCT FROM 1
        OR pg_catalog.array_lower(requested_wallet_identity_digests_hex, 1) IS DISTINCT FROM 1
        OR pg_catalog.cardinality(requested_wallet_identity_digest_versions) NOT BETWEEN 1 AND 3
        OR pg_catalog.cardinality(requested_wallet_identity_digest_versions)
          IS DISTINCT FROM pg_catalog.cardinality(requested_wallet_identity_digests_hex)
        OR pg_catalog.array_position(requested_wallet_identity_digest_versions, NULL) IS NOT NULL
        OR pg_catalog.array_position(requested_wallet_identity_digests_hex, NULL) IS NOT NULL
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action wallet identity candidates'
          USING ERRCODE = '22023';
      END IF;

      candidate_count := pg_catalog.cardinality(requested_wallet_identity_digest_versions);
      FOR candidate_index IN 1..candidate_count LOOP
        IF requested_wallet_identity_digest_versions[candidate_index] <= 0
          OR (
            candidate_index > 1
            AND requested_wallet_identity_digest_versions[candidate_index]
              <= requested_wallet_identity_digest_versions[candidate_index - 1]
          )
          OR requested_wallet_identity_digests_hex[candidate_index] !~ '^[0-9a-f]{64}$'
        THEN
          RAISE EXCEPTION 'invalid mainnet financial action wallet identity candidates'
            USING ERRCODE = '22023';
        END IF;
      END LOOP;

      IF candidate_count <> (
        SELECT pg_catalog.count(DISTINCT candidate.digest_hex)
        FROM pg_catalog.unnest(requested_wallet_identity_digests_hex)
          AS candidate(digest_hex)
      ) THEN
        RAISE EXCEPTION 'invalid mainnet financial action wallet identity candidates'
          USING ERRCODE = '22023';
      END IF;

      SELECT policy.accepted_read_versions
      INTO policy_accepted_read_versions
      FROM wallet_identity_key_policy AS policy
      WHERE policy.policy_name = 'wallet-registration-identity-hmac'
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet identity key policy is unavailable' USING ERRCODE = '55000';
      END IF;
      IF requested_wallet_identity_digest_versions
        IS DISTINCT FROM policy_accepted_read_versions
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action wallet identity candidates'
          USING ERRCODE = '22023';
      END IF;

      PERFORM 1
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
      FOR UPDATE;

      SELECT wallet.chain_namespace, wallet.chain_reference
      INTO
        target_wallet_chain_namespace,
        target_wallet_chain_reference
      FROM yield_operations AS operation
      INNER JOIN yield_operation_submissions AS submission
        ON submission.operation_id = operation.operation_id
      INNER JOIN ledger_transactions AS ledger_transaction
        ON ledger_transaction.transaction_id = operation.ledger_transaction_id
        AND ledger_transaction.book_id = operation.ledger_book_id
        AND ledger_transaction.tenant_account_id = operation.actor_account_id
      INNER JOIN registered_wallets AS wallet ON wallet.wallet_id = requested_wallet_id
      WHERE operation.operation_id = requested_yield_operation_id
        AND operation.actor_account_id = requested_account_id
        AND operation.ledger_transaction_id = requested_ledger_transaction_id
        AND operation.ledger_book_id = requested_ledger_book_id
        AND submission.submission_id = requested_yield_submission_id
        AND wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE'
        AND wallet.registry_environment = 'MAINNET'
        AND requested_network_id = wallet.chain_namespace || ':' || wallet.chain_reference
      FOR UPDATE OF operation, submission, ledger_transaction, wallet;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mainnet financial action wallet identity does not match'
          USING ERRCODE = '22023';
      END IF;

      IF candidate_count <> (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.generate_subscripts(
            requested_wallet_identity_digest_versions, 1
          ) AS candidate(candidate_index)
          INNER JOIN registered_wallet_identity_digests AS alias
            ON alias.wallet_id = requested_wallet_id
            AND alias.account_id = requested_account_id
            AND alias.chain_namespace = target_wallet_chain_namespace
            AND alias.chain_reference = target_wallet_chain_reference
            AND alias.address_digest_version =
              requested_wallet_identity_digest_versions[candidate.candidate_index]
            AND alias.address_digest = pg_catalog.decode(
              requested_wallet_identity_digests_hex[candidate.candidate_index], 'hex'
            )
            AND alias.status = 'ACTIVE'
            AND alias.revoked_at IS NULL
        )
      THEN
        RAISE EXCEPTION 'mainnet financial action wallet identity does not match'
          USING ERRCODE = '22023';
      END IF;

      RETURN QUERY SELECT * FROM prepare_mainnet_financial_action_lifecycle(
        requested_intent_id, requested_account_id,
        requested_yield_operation_id, requested_yield_submission_id,
        requested_ledger_transaction_id, requested_ledger_book_id,
        requested_wallet_id, requested_volatile_intent_commitment_sha256,
        requested_idempotency_key_digest_sha256, requested_replay_protection_id,
        requested_network_id, requested_provider_id, requested_protocol_id,
        requested_market_id, requested_asset_registry_version,
        requested_asset_registry_fingerprint_sha256, requested_asset_symbol,
        requested_asset_identity, requested_asset_decimals,
        requested_action_type, requested_amount_atomic,
        requested_requested_value_usd_micros, requested_maximum_network_fee_atomic,
        requested_maximum_network_fee_basis_points,
        requested_minimum_post_action_native_balance_atomic,
        requested_allowance_mode, requested_allowance_amount_atomic,
        requested_issued_at, requested_expires_at, requested_correlation_id
      );
    END;`;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `LOCK TABLE ${HISTORY_TABLES.join(', ')} IN ACCESS EXCLUSIVE MODE;
    DO $refuse_unbound_mainnet_action_history$
    BEGIN
      IF ${HISTORY_TABLES.map((table) => `EXISTS (SELECT 1 FROM ${table})`).join('\n        OR ')}
      THEN
        RAISE EXCEPTION 'mainnet financial action wallet binding requires empty lifecycle history'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_unbound_mainnet_action_history$;

    CREATE FUNCTION prepare_mainnet_financial_action_lifecycle_v2(
      ${PREPARE_V2_INPUT_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${PREPARE_V2_BODY}$function$;

    DO $set_mainnet_action_wallet_binding_function_path$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${PREPARE_V2} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_mainnet_action_wallet_binding_function_path$;

    REVOKE ALL ON FUNCTION ${PREPARE_V2} FROM ${guardedRoles};`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `LOCK TABLE ${HISTORY_TABLES.join(', ')} IN ACCESS EXCLUSIVE MODE;
    DO $refuse_bound_mainnet_action_history_loss$
    BEGIN
      IF ${HISTORY_TABLES.map((table) => `EXISTS (SELECT 1 FROM ${table})`).join('\n        OR ')}
      THEN
        RAISE EXCEPTION 'cannot roll back mainnet action wallet binding after lifecycle use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_bound_mainnet_action_history_loss$;

    REVOKE ALL ON FUNCTION ${PREPARE_V2} FROM ${guardedRoles};
    DROP FUNCTION ${PREPARE_V2};`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createMainnetFinancialActionLifecycleMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0033 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const expectedResult = `TABLE(${resultColumns()
    .replace(/\btimestamptz\b/gu, 'timestamp with time zone')
    .replace(/\s+/gu, ' ')
    .trim()})`;
  const expectedArgumentNames = [
    ...PREPARE_V2_INPUT_ARGUMENTS.map(([name]) => name),
    ...resultColumnNames(),
  ]
    .map((name) => `'${name}'`)
    .join(', ');
  const expectedArgumentTypes = PREPARE_V2_INPUT_ARGUMENTS.map(
    ([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`,
  ).join(', ');
  const outputArgumentCount = resultColumnNames().length;

  return `SELECT (prior.valid AND function_state.valid) AS valid
    FROM (${previous.verifySql}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.count(procedure.oid) = 1
        AND pg_catalog.bool_and(
          function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND procedure.prokind = 'f'
          AND NOT procedure.proleakproof
          AND procedure.prosecdef
          AND NOT procedure.proisstrict
          AND procedure.provolatile = 'v'
          AND procedure.proparallel = 'u'
          AND procedure.proretset
          AND procedure.pronargs = 32
          AND procedure.pronargdefaults = 0
          AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
          AND procedure.proargnames = ARRAY[${expectedArgumentNames}]::text[]
          AND procedure.proargtypes = ARRAY[${expectedArgumentTypes}]::pg_catalog.oidvector
          AND procedure.proargmodes = pg_catalog.array_cat(
            pg_catalog.array_fill('i'::"char", ARRAY[32]),
            pg_catalog.array_fill('t'::"char", ARRAY[${outputArgumentCount}])
          )
          AND language.lanname = 'plpgsql'
          AND pg_catalog.pg_get_function_result(procedure.oid) = '${expectedResult}'
          AND procedure.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = '${sourceSha256(PREPARE_V2_BODY)}'
          AND NOT pg_catalog.has_function_privilege(${api}, '${PREPARE_V2}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${worker}, '${PREPARE_V2}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${legacy}, '${PREPARE_V2}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${balance}, '${PREPARE_V2}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${migration}, '${PREPARE_V2}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('public', '${PREPARE_V2}', 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(
                procedure.proacl,
                pg_catalog.acldefault('f', procedure.proowner)
              )
            ) AS acl
            WHERE acl.grantee <> procedure.proowner
          )
        ) AS valid
      FROM (VALUES ('${PREPARE_V2}')) AS expected(function_identity)
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
    ) AS function_state`;
}

export function createMainnetFinancialActionWalletIdentityBindingMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0034',
    description:
      'bind dormant mainnet financial action preparation to registered wallet identity digests',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0033'],
  };
}

export const createMainnetFinancialActionWalletIdentityBindingMigrationV0034 =
  createMainnetFinancialActionWalletIdentityBindingMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
  );

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034 =
  createMainnetFinancialActionWalletIdentityBindingMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
    { cumulativePrincipalVerification: false },
  );
