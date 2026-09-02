import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createLedgerFeeAdjustmentIntegrityMigration } from './0013-repair-ledger-fee-adjustment-integrity.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY = 'list_active_wallet_registrations(uuid)';
const ACTIVE_WALLET_CAP_FUNCTION_IDENTITY = 'enforce_active_wallet_account_capacity()';
const ACTIVE_WALLET_CAP_TRIGGER = 'registered_wallet_account_capacity';
const MAX_ACTIVE_WALLETS = 32;

const ACTIVE_WALLET_ROSTER_PREFLIGHT = `
    DO $validate_active_wallet_roster$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM registered_wallets AS wallet
        WHERE wallet.status = 'ACTIVE'
        GROUP BY wallet.account_id
        HAVING pg_catalog.count(*) > ${MAX_ACTIVE_WALLETS}
      ) THEN
        RAISE EXCEPTION 'existing active wallet registration capacity violation'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM registered_wallets AS wallet
        WHERE wallet.status = 'ACTIVE'
          AND NOT (
            (wallet.registry_environment = 'MAINNET' AND (
              (wallet.chain_namespace = 'eip155' AND wallet.chain_reference IN ('1', '8453'))
              OR (wallet.chain_namespace = 'solana'
                AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
            ))
            OR (wallet.registry_environment = 'TESTNET' AND (
              (wallet.chain_namespace = 'eip155' AND wallet.chain_reference IN ('11155111', '84532'))
              OR (wallet.chain_namespace = 'solana'
                AND wallet.chain_reference = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
            ))
          )
      ) THEN
        RAISE EXCEPTION 'existing active wallet registration is outside the launch allowlist'
          USING ERRCODE = '23514';
      END IF;
    END;
    $validate_active_wallet_roster$;
`;

const WALLET_REGISTRATION_API_FUNCTION_IDENTITIES = [
  'begin_wallet_ownership_challenge(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid)',
  'prepare_wallet_ownership_challenge(uuid,uuid,uuid)',
  'reject_wallet_ownership_challenge(uuid,uuid,text,uuid)',
  'complete_wallet_registration(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
] as const;

const LIST_ACTIVE_WALLETS_BODY = `
      SELECT
        wallet.wallet_id AS active_wallet_id,
        wallet.account_id AS active_account_id,
        wallet.registered_by_challenge_id AS active_registered_by_challenge_id,
        wallet.chain_namespace AS active_chain_namespace,
        wallet.chain_reference AS active_chain_reference,
        wallet.registry_environment AS active_registry_environment,
        wallet.registry_version AS active_registry_version,
        wallet.registry_fingerprint_sha256 AS active_registry_fingerprint_sha256,
        wallet.address_digest_version AS active_address_digest_version,
        wallet.address_digest AS active_address_digest,
        wallet.address_key_version AS active_address_key_version,
        wallet.address_ciphertext AS active_address_ciphertext,
        wallet.address_iv AS active_address_iv,
        wallet.address_auth_tag AS active_address_auth_tag,
        wallet.registered_at AS active_registered_at
      FROM registered_wallets AS wallet
      WHERE wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE'
      ORDER BY wallet.registered_at DESC, wallet.wallet_id
      LIMIT ${MAX_ACTIVE_WALLETS + 1}
    `;

const ACTIVE_WALLET_CAP_BODY = `
    DECLARE
      active_wallet_count bigint;
    BEGIN
      IF NEW.status <> 'ACTIVE'
        OR (TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE')
      THEN
        RETURN NEW;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(NEW.account_id::text, 56003)
      );
      EXECUTE pg_catalog.format(
        'SELECT pg_catalog.count(*) FROM %s AS wallet
         WHERE wallet.account_id = $1 AND wallet.status = ''ACTIVE''',
        TG_RELID::pg_catalog.regclass
      )
      INTO STRICT active_wallet_count
      USING NEW.account_id;

      IF active_wallet_count >= ${MAX_ACTIVE_WALLETS} THEN
        RAISE EXCEPTION 'active wallet registration capacity reached'
          USING ERRCODE = '54000';
      END IF;
      RETURN NEW;
    END;
    `;

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
    throw new Error('Migration 0014 wallet-list verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function walletFunctionAllowance(api: string, functions: readonly string[]): string {
  return `            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                ${functions
                  .map((identityValue) => `to_regprocedure('${identityValue}')`)
                  .join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
}

function extendPriorVerifier(names: DatabasePrincipalNames, priorVerifier: string): string {
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const existing = walletFunctionAllowance(api, WALLET_REGISTRATION_API_FUNCTION_IDENTITIES);
  const extended = walletFunctionAllowance(api, [
    ...WALLET_REGISTRATION_API_FUNCTION_IDENTITIES,
    LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY,
  ]);
  const existingTriggerVerification = `    AND (SELECT pg_catalog.count(*) = 4
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid IN (
          SELECT table_state.oid FROM wallet_registration_tables AS table_state
        )
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgenabled = 'A'
        AND trigger_state.tgname IN (
          'wallet_ownership_challenge_binding_immutable',
          'registered_wallet_identity_immutable',
          'wallet_registration_audit_append_only_row',
          'wallet_registration_audit_append_only_truncate'
        ))`;
  const extendedTriggerVerification = `    AND (SELECT pg_catalog.count(*) = 5
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid IN (
          SELECT table_state.oid FROM wallet_registration_tables AS table_state
        )
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgenabled = 'A'
        AND trigger_state.tgname IN (
          'wallet_ownership_challenge_binding_immutable',
          'registered_wallet_identity_immutable',
          'wallet_registration_audit_append_only_row',
          'wallet_registration_audit_append_only_truncate',
          '${ACTIVE_WALLET_CAP_TRIGGER}'
        ))`;
  return replaceExactlyOnce(
    replaceExactlyOnce(priorVerifier, existing, extended),
    existingTriggerVerification,
    extendedTriggerVerification,
  );
}

function createFunctionSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  return `${ACTIVE_WALLET_ROSTER_PREFLIGHT}
    CREATE FUNCTION list_active_wallet_registrations(requested_account_id uuid) RETURNS TABLE (
      active_wallet_id uuid,
      active_account_id uuid,
      active_registered_by_challenge_id uuid,
      active_chain_namespace text,
      active_chain_reference text,
      active_registry_environment text,
      active_registry_version integer,
      active_registry_fingerprint_sha256 text,
      active_address_digest_version smallint,
      active_address_digest bytea,
      active_address_key_version smallint,
      active_address_ciphertext bytea,
      active_address_iv bytea,
      active_address_auth_tag bytea,
      active_registered_at timestamptz
    )
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    STRICT
    PARALLEL UNSAFE
    ROWS ${MAX_ACTIVE_WALLETS + 1}
    AS $function$${LIST_ACTIVE_WALLETS_BODY}$function$;

    CREATE FUNCTION ${ACTIVE_WALLET_CAP_FUNCTION_IDENTITY}
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$${ACTIVE_WALLET_CAP_BODY}$function$;

    CREATE TRIGGER ${ACTIVE_WALLET_CAP_TRIGGER}
      BEFORE INSERT OR UPDATE OF status ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION ${ACTIVE_WALLET_CAP_FUNCTION_IDENTITY};
    ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER ${ACTIVE_WALLET_CAP_TRIGGER};

    DO $set_wallet_list_function_path$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $set_wallet_list_function_path$;

    REVOKE ALL ON FUNCTION ${LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${ACTIVE_WALLET_CAP_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    GRANT EXECUTE ON FUNCTION ${LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY} TO ${api};
  `;
}

function createDownSql(names: DatabasePrincipalNames): readonly string[] {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  return [
    `REVOKE EXECUTE ON FUNCTION ${LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY} FROM ${api}`,
    `DROP TRIGGER ${ACTIVE_WALLET_CAP_TRIGGER} ON registered_wallets`,
    `DROP FUNCTION ${ACTIVE_WALLET_CAP_FUNCTION_IDENTITY}`,
    `DROP FUNCTION ${LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY}`,
  ];
}

function createVerifierSql(
  names: DatabasePrincipalNames,
  cumulativePrincipalVerification: boolean,
): string {
  const priorMigration = createLedgerFeeAdjustmentIntegrityMigration(names, {
    cumulativePrincipalVerification,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0013 must expose verification SQL');
  const priorVerifier = cumulativePrincipalVerification
    ? extendPriorVerifier(names, priorMigration.verifySql)
    : priorMigration.verifySql;
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const ownerVerification = cumulativePrincipalVerification
    ? `AND function_owner.rolname = ${owner}`
    : '';

  const walletListVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(
      language.lanname = 'sql'
      AND function_state.prokind = 'f'
      AND function_state.provolatile = 's'
      AND function_state.proparallel = 'u'
      AND function_state.prosecdef
      AND NOT function_state.proleakproof
      AND function_state.proisstrict
      AND function_state.proretset
      AND function_state.pronargs = 1
      AND function_state.pronargdefaults = 0
      AND function_state.prorows = ${MAX_ACTIVE_WALLETS + 1}
      AND pg_catalog.pg_get_function_identity_arguments(function_state.oid) =
        'requested_account_id uuid'
      AND pg_catalog.pg_get_function_result(function_state.oid) =
        'TABLE(active_wallet_id uuid, active_account_id uuid, active_registered_by_challenge_id uuid, active_chain_namespace text, active_chain_reference text, active_registry_environment text, active_registry_version integer, active_registry_fingerprint_sha256 text, active_address_digest_version smallint, active_address_digest bytea, active_address_key_version smallint, active_address_ciphertext bytea, active_address_iv bytea, active_address_auth_tag bytea, active_registered_at timestamp with time zone)'
      AND function_state.proconfig IS DISTINCT FROM NULL
      AND function_state.proconfig = ARRAY[
        'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
      ]::text[]
      AND function_state.prosrc = $expected_body$${LIST_ACTIVE_WALLETS_BODY}$expected_body$
      AND pg_catalog.has_function_privilege(${api}, function_state.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, function_state.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, function_state.oid, 'EXECUTE')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS allowed_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          allowed_function.proacl,
          pg_catalog.acldefault('f', allowed_function.proowner)
        )
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE allowed_function.oid =
          to_regprocedure('${LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY}')
        AND acl.grantee <> allowed_function.proowner
        AND NOT (
          grantee.rolname = ${api}
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
        )
    )
  ) AS valid
  FROM pg_catalog.pg_proc AS function_state
  INNER JOIN pg_catalog.pg_namespace AS namespace_state
    ON namespace_state.oid = function_state.pronamespace
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
  WHERE namespace_state.nspname = pg_catalog.current_schema()
    AND function_state.oid = to_regprocedure('${LIST_ACTIVE_WALLETS_FUNCTION_IDENTITY}')
    ${ownerVerification}`;

  const capacityVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(
      language.lanname = 'plpgsql'
      AND function_state.prokind = 'f'
      AND function_state.provolatile = 'v'
      AND function_state.proparallel = 'u'
      AND NOT function_state.prosecdef
      AND NOT function_state.proleakproof
      AND NOT function_state.proisstrict
      AND NOT function_state.proretset
      AND function_state.pronargs = 0
      AND function_state.pronargdefaults = 0
      AND pg_catalog.pg_get_function_result(function_state.oid) = 'trigger'
      AND function_state.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND function_state.prosrc = $expected_cap_body$${ACTIVE_WALLET_CAP_BODY}$expected_cap_body$
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS denied_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(denied_function.proacl, pg_catalog.acldefault('f', denied_function.proowner))
      ) AS acl
      WHERE denied_function.oid =
          to_regprocedure('${ACTIVE_WALLET_CAP_FUNCTION_IDENTITY}')
        AND acl.grantee <> denied_function.proowner
    )
    AND (SELECT pg_catalog.count(*) = 1
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid = pg_catalog.to_regclass(
          pg_catalog.format('%I.%I', pg_catalog.current_schema(), 'registered_wallets')
        )
        AND trigger_state.tgfoid =
          to_regprocedure('${ACTIVE_WALLET_CAP_FUNCTION_IDENTITY}')
        AND trigger_state.tgname = '${ACTIVE_WALLET_CAP_TRIGGER}'
        AND trigger_state.tgtype = 23
        AND trigger_state.tgenabled = 'A'
        AND NOT trigger_state.tgisinternal
        AND pg_catalog.strpos(
          pg_catalog.pg_get_triggerdef(trigger_state.oid, false),
          'BEFORE INSERT OR UPDATE OF status'
        ) > 0)
  ) AS valid
  FROM pg_catalog.pg_proc AS function_state
  INNER JOIN pg_catalog.pg_namespace AS namespace_state
    ON namespace_state.oid = function_state.pronamespace
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
  WHERE namespace_state.nspname = pg_catalog.current_schema()
    AND function_state.oid = to_regprocedure('${ACTIVE_WALLET_CAP_FUNCTION_IDENTITY}')
    ${ownerVerification}`;

  return `SELECT (prior.valid AND wallet_list.valid AND wallet_capacity.valid) AS valid
    FROM (${priorVerifier}) AS prior
    CROSS JOIN (${walletListVerifier}) AS wallet_list
    CROSS JOIN (${capacityVerifier}) AS wallet_capacity`;
}

export function createActiveWalletRegistrationListMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0014',
    description: 'add bounded account-scoped active wallet registration read boundary',
    upSql: createFunctionSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulativePrincipalVerification),
    supersedesVerificationOf: ['0013'],
  };
}

export const createActiveWalletRegistrationListMigrationV0014 =
  createActiveWalletRegistrationListMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createActiveWalletRegistrationListTestSchemaMigrationV0014 =
  createActiveWalletRegistrationListMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
