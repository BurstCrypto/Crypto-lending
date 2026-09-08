import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionFinalityPrerequisiteReadMigration } from './0036-read-mainnet-financial-action-finality-prerequisite.migration';
import { createMainnetFinancialActionAtomicFinalityPersistenceMigration } from './0037-atomically-persist-mainnet-financial-action-finality.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const MAINNET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

const RECONCILIATION_PREREQUISITE_V1 =
  'read_mainnet_financial_action_reconciliation_prerequisite_v1';
const RECONCILIATION_PREREQUISITE_V2 =
  'read_mainnet_financial_action_reconciliation_prerequisite_v2';
const POST_FINALITY_PREREQUISITE_V1 = 'read_mainnet_financial_action_post_finality_prerequisite_v1';
const POST_FINALITY_PREREQUISITE_V2 = 'read_mainnet_financial_action_post_finality_prerequisite_v2';
const ADMISSION_V2 = 'record_authenticated_mainnet_financial_action_reconciliation_v2';
const ADMISSION_V3 = 'record_authenticated_mainnet_financial_action_reconciliation_v3';
const REVIEW_V2 = 'record_mainnet_financial_action_post_finality_review_v2';
const REVIEW_V3 = 'record_mainnet_financial_action_post_finality_review_v3';
const RECOVERY_WALLET = 'read_mainnet_financial_action_recovery_wallet_v1';

const RECONCILIATION_PREREQUISITE_V1_IDENTITY = `${RECONCILIATION_PREREQUISITE_V1}(uuid,uuid,bigint,text,text,timestamp with time zone)`;
const RECONCILIATION_PREREQUISITE_V2_IDENTITY = `${RECONCILIATION_PREREQUISITE_V2}(uuid,uuid,bigint,text,text,timestamp with time zone)`;
const POST_FINALITY_PREREQUISITE_V1_IDENTITY = `${POST_FINALITY_PREREQUISITE_V1}(uuid,uuid,bigint,text,text,text,text,bigint,text,text,timestamp with time zone)`;
const POST_FINALITY_PREREQUISITE_V2_IDENTITY = `${POST_FINALITY_PREREQUISITE_V2}(uuid,uuid,bigint,text,text,text,text,bigint,text,text,timestamp with time zone)`;
const ADMISSION_V2_IDENTITY = `${ADMISSION_V2}(uuid,uuid,bigint,text,uuid,text,text,numeric,text,numeric,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid)`;
const ADMISSION_V3_IDENTITY = ADMISSION_V2_IDENTITY.replace(ADMISSION_V2, ADMISSION_V3);
const REVIEW_V2_IDENTITY = `${REVIEW_V2}(uuid,uuid,bigint,text,bigint,text,uuid,text,text,text,numeric,text,numeric,text,text,uuid,text,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid)`;
const REVIEW_V3_IDENTITY = REVIEW_V2_IDENTITY.replace(REVIEW_V2, REVIEW_V3);
const RECOVERY_WALLET_IDENTITY = `${RECOVERY_WALLET}(uuid,uuid,bigint,text,text,timestamp with time zone)`;

const RECOVERY_ARGUMENTS = Object.freeze([
  ['requested_account_id', 'uuid'],
  ['requested_intent_id', 'uuid'],
  ['requested_lifecycle_revision', 'bigint'],
  ['requested_lifecycle_snapshot_sha256', 'text'],
  ['requested_purpose', 'text'],
  ['requested_deadline_at', 'timestamp with time zone'],
] as const);

const RECOVERY_RESULT = `
      account_id uuid,
      intent_id uuid,
      wallet_registration_id uuid,
      registered_by_challenge_id uuid,
      network_id text,
      lifecycle_revision bigint,
      lifecycle_snapshot_sha256 text,
      lifecycle_stage text,
      wallet_chain_namespace text,
      wallet_chain_reference text,
      registry_environment text,
      registry_version integer,
      registry_fingerprint_sha256 text,
      wallet_identity_digest_version smallint,
      wallet_identity_digest bytea,
      verification_identity_digest_version smallint,
      verification_identity_digest bytea,
      address_key_version smallint,
      address_ciphertext bytea,
      address_iv bytea,
      address_auth_tag bytea,
      registered_at timestamptz,
      wallet_status text,
      revoked_at timestamptz,
      verified_at timestamptz`;

function identifier(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  }
  return `"${value}"`;
}

function literal(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  }
  return `'${value}'`;
}

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error(`Migration 0038 replacement anchor must occur exactly once: ${target}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function functionDefinition(source: string, functionName: string): string {
  const startMarker = `CREATE FUNCTION ${functionName}(`;
  const start = source.indexOf(startMarker);
  if (start < 0 || source.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error(`Migration 0038 predecessor function is unavailable: ${functionName}`);
  }
  const endMarker = '$function$;';
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Migration 0038 predecessor body is unavailable: ${functionName}`);
  return source.slice(start, end + endMarker.length);
}

function functionBody(definition: string): string {
  const startMarker = 'AS $function$';
  const start = definition.indexOf(startMarker);
  const end = definition.lastIndexOf('$function$;');
  if (start < 0 || end <= start) throw new Error('Migration 0038 generated function is malformed');
  return definition.slice(start + startMarker.length, end);
}

const ACTIVE_IDENTITY_GATE = `        AND identity.status = 'ACTIVE'
        AND identity.revoked_at IS NULL`;
const HISTORICAL_IDENTITY_GATE = `        AND identity.registered_at = wallet.registered_at
        AND identity.status = wallet.status
        AND identity.revoked_at IS NOT DISTINCT FROM wallet.revoked_at`;
const ACTIVE_WALLET_GATE = `        AND wallet.status = 'ACTIVE'
        AND wallet.revoked_at IS NULL`;
const HISTORICAL_WALLET_GATE = `        AND (
          (wallet.status = 'ACTIVE' AND wallet.revoked_at IS NULL)
          OR (
            wallet.status = 'REVOKED'
            AND wallet.revoked_at IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM mainnet_financial_action_events AS signed_event
              WHERE signed_event.intent_id = selected_intent.intent_id
                AND signed_event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
                AND signed_event.recorded_at <= wallet.revoked_at
            )
          )
        )`;

function historicalWalletDefinition(definition: string): string {
  return replaceExactlyOnce(
    replaceExactlyOnce(definition, ACTIVE_IDENTITY_GATE, HISTORICAL_IDENTITY_GATE),
    ACTIVE_WALLET_GATE,
    HISTORICAL_WALLET_GATE,
  );
}

function generatedDefinitions(names: BalanceConsumerPrincipalNames): Readonly<{
  reconciliationPrerequisite: string;
  postFinalityPrerequisite: string;
  admission: string;
  review: string;
}> {
  const prerequisiteSql = sql(
    createMainnetFinancialActionFinalityPrerequisiteReadMigration(names).upSql,
  );
  const persistenceSql = sql(
    createMainnetFinancialActionAtomicFinalityPersistenceMigration(names).upSql,
  );

  let reconciliationPrerequisite = functionDefinition(
    prerequisiteSql,
    RECONCILIATION_PREREQUISITE_V1,
  );
  reconciliationPrerequisite = replaceExactlyOnce(
    reconciliationPrerequisite,
    `CREATE FUNCTION ${RECONCILIATION_PREREQUISITE_V1}(`,
    `CREATE FUNCTION ${RECONCILIATION_PREREQUISITE_V2}(`,
  );
  reconciliationPrerequisite = historicalWalletDefinition(reconciliationPrerequisite);
  reconciliationPrerequisite = replaceExactlyOnce(
    reconciliationPrerequisite,
    `'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'`,
    `'WALLET_SIGNED_SUBMISSION_BOUND',
          'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'`,
  );

  let postFinalityPrerequisite = functionDefinition(prerequisiteSql, POST_FINALITY_PREREQUISITE_V1);
  postFinalityPrerequisite = replaceExactlyOnce(
    postFinalityPrerequisite,
    `CREATE FUNCTION ${POST_FINALITY_PREREQUISITE_V1}(`,
    `CREATE FUNCTION ${POST_FINALITY_PREREQUISITE_V2}(`,
  );
  postFinalityPrerequisite = historicalWalletDefinition(postFinalityPrerequisite);

  let admission = functionDefinition(persistenceSql, ADMISSION_V2);
  admission = replaceExactlyOnce(
    admission,
    `CREATE FUNCTION ${ADMISSION_V2}(`,
    `CREATE FUNCTION ${ADMISSION_V3}(`,
  );
  admission = historicalWalletDefinition(admission);
  admission = replaceExactlyOnce(
    admission,
    `${RECONCILIATION_PREREQUISITE_V1}(`,
    `${RECONCILIATION_PREREQUISITE_V2}(`,
  );

  let review = functionDefinition(persistenceSql, REVIEW_V2);
  review = replaceExactlyOnce(
    review,
    `CREATE FUNCTION ${REVIEW_V2}(`,
    `CREATE FUNCTION ${REVIEW_V3}(`,
  );
  review = historicalWalletDefinition(review);
  review = replaceExactlyOnce(
    review,
    `${POST_FINALITY_PREREQUISITE_V1}(`,
    `${POST_FINALITY_PREREQUISITE_V2}(`,
  );

  return Object.freeze({
    reconciliationPrerequisite,
    postFinalityPrerequisite,
    admission,
    review,
  });
}

const RECOVERY_WALLET_BODY = `
    DECLARE
      selected_intent mainnet_financial_action_intents%ROWTYPE;
      current_event mainnet_financial_action_events%ROWTYPE;
      submission_event mainnet_financial_action_events%ROWTYPE;
      database_verified_at timestamptz;
    BEGIN
      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR pg_catalog.substring(requested_account_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_account_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR pg_catalog.substring(requested_intent_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_intent_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR requested_lifecycle_revision < 2
        OR requested_lifecycle_snapshot_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_lifecycle_snapshot_sha256 = pg_catalog.repeat('0', 64)
        OR requested_purpose NOT IN ('RECONCILIATION_ADMISSION', 'POST_FINALITY_REVIEW')
        OR NOT pg_catalog.isfinite(requested_deadline_at)
        OR pg_catalog.date_trunc('milliseconds', requested_deadline_at) <>
          requested_deadline_at
        OR database_verified_at >= requested_deadline_at
        OR requested_deadline_at > database_verified_at + interval '30 seconds'
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action recovery wallet read'
          USING ERRCODE = '22023';
      END IF;

      -- Migration 0033 serializes event append on this immutable intent row.
      SELECT stored.* INTO selected_intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR SHARE;
      IF NOT FOUND THEN RETURN; END IF;

      -- Observe revocation and all identity aliases at one account-linearized point.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_account_id::text, 56001)
      );

      SELECT event.* INTO current_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
      ORDER BY event.revision DESC LIMIT 1;
      IF NOT FOUND THEN RETURN; END IF;
      SELECT event.* INTO submission_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
        AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
      IF NOT FOUND THEN RETURN; END IF;

      IF current_event.revision <> requested_lifecycle_revision
        OR current_event.snapshot_sha256 <> requested_lifecycle_snapshot_sha256
        OR submission_event.revision <> 2
        OR submission_event.chain_transaction_id IS NULL
        OR submission_event.wallet_signed_payload_sha256 IS NULL
        OR submission_event.wallet_signature_evidence_sha256 IS NULL
        OR submission_event.wallet_signed_payload_sha256 =
          submission_event.wallet_signature_evidence_sha256
        OR current_event.chain_transaction_id IS DISTINCT FROM
          submission_event.chain_transaction_id
        OR (
          requested_purpose = 'RECONCILIATION_ADMISSION' AND (
            current_event.stage NOT IN (
              'WALLET_SIGNED_SUBMISSION_BOUND',
              'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
            )
            OR current_event.terminal
          )
        )
        OR (
          requested_purpose = 'POST_FINALITY_REVIEW' AND (
            current_event.stage NOT IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')
            OR NOT current_event.terminal
            OR NOT EXISTS (
              SELECT 1
              FROM mainnet_financial_action_reconciliation_admissions AS admission
              WHERE admission.intent_id = current_event.intent_id
                AND admission.admitted_event_revision = current_event.revision
                AND admission.admitted_transition_fingerprint_sha256 =
                  current_event.transition_fingerprint_sha256
                AND admission.admitted_event_snapshot_sha256 = current_event.snapshot_sha256
            )
          )
        )
      THEN
        RETURN;
      END IF;

      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF database_verified_at >= requested_deadline_at THEN RETURN; END IF;

      RETURN QUERY
      SELECT
        selected_intent.account_id,
        selected_intent.intent_id,
        wallet.wallet_id,
        wallet.registered_by_challenge_id,
        selected_intent.network_id,
        current_event.revision,
        current_event.snapshot_sha256,
        current_event.stage,
        wallet.chain_namespace,
        wallet.chain_reference,
        wallet.registry_environment,
        wallet.registry_version,
        wallet.registry_fingerprint_sha256,
        historical_identity.address_digest_version,
        historical_identity.address_digest,
        verification_identity.address_digest_version,
        verification_identity.address_digest,
        wallet.address_key_version,
        wallet.address_ciphertext,
        wallet.address_iv,
        wallet.address_auth_tag,
        wallet.registered_at,
        wallet.status,
        wallet.revoked_at,
        database_verified_at
      FROM registered_wallets AS wallet
      INNER JOIN registered_wallet_identity_digests AS historical_identity
        ON historical_identity.wallet_id = wallet.wallet_id
        AND historical_identity.account_id = wallet.account_id
        AND historical_identity.chain_namespace = wallet.chain_namespace
        AND historical_identity.chain_reference = wallet.chain_reference
        AND historical_identity.address_digest_version =
          selected_intent.wallet_identity_digest_version
        AND historical_identity.address_digest = pg_catalog.decode(
          selected_intent.wallet_identity_digest_hex, 'hex'
        )
        AND historical_identity.registered_at = wallet.registered_at
        AND historical_identity.status = wallet.status
        AND historical_identity.revoked_at IS NOT DISTINCT FROM wallet.revoked_at
      INNER JOIN wallet_identity_key_policy AS key_policy
        ON key_policy.policy_name = 'wallet-registration-identity-hmac'
        AND key_policy.schema_version = 1
        AND key_policy.active_write_version = ANY(key_policy.accepted_read_versions)
      INNER JOIN registered_wallet_identity_digests AS verification_identity
        ON verification_identity.wallet_id = wallet.wallet_id
        AND verification_identity.account_id = wallet.account_id
        AND verification_identity.chain_namespace = wallet.chain_namespace
        AND verification_identity.chain_reference = wallet.chain_reference
        AND verification_identity.address_digest_version = key_policy.active_write_version
        AND verification_identity.registered_at = wallet.registered_at
        AND verification_identity.status = wallet.status
        AND verification_identity.revoked_at IS NOT DISTINCT FROM wallet.revoked_at
      WHERE wallet.wallet_id = selected_intent.wallet_id
        AND wallet.account_id = selected_intent.account_id
        AND wallet.chain_namespace = selected_intent.wallet_chain_namespace
        AND wallet.chain_reference = selected_intent.wallet_chain_reference
        AND wallet.address_digest_version =
          selected_intent.wallet_identity_digest_version
        AND wallet.address_digest = pg_catalog.decode(
          selected_intent.wallet_identity_digest_hex, 'hex'
        )
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 = '${MAINNET_REGISTRY_FINGERPRINT}'
        AND (
          (selected_intent.network_id = '${ETHEREUM}'
            AND wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
          OR
          (selected_intent.network_id = '${SOLANA}'
            AND wallet.chain_namespace = 'solana'
            AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        )
        AND (
          (wallet.status = 'ACTIVE' AND wallet.revoked_at IS NULL)
          OR
          (wallet.status = 'REVOKED' AND wallet.revoked_at IS NOT NULL
            AND submission_event.recorded_at <= wallet.revoked_at)
        )
      FOR SHARE OF wallet, historical_identity, verification_identity, key_policy;
    END;`;

function canonicalResult(value: string): string {
  return `TABLE(${value
    .replace(/\btimestamptz\b/gu, 'timestamp with time zone')
    .replace(/\s+/gu, ' ')
    .trim()})`;
}

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  const definitions = generatedDefinitions(names);

  return `${definitions.reconciliationPrerequisite}

    ${definitions.postFinalityPrerequisite}

    ${definitions.admission}

    ${definitions.review}

    CREATE FUNCTION ${RECOVERY_WALLET}(
      ${RECOVERY_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${RECOVERY_RESULT})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${RECOVERY_WALLET_BODY}$function$;

    DO $set_mainnet_action_revocation_recovery_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      ${[
        RECONCILIATION_PREREQUISITE_V2_IDENTITY,
        POST_FINALITY_PREREQUISITE_V2_IDENTITY,
        ADMISSION_V3_IDENTITY,
        REVIEW_V3_IDENTITY,
        RECOVERY_WALLET_IDENTITY,
      ]
        .map(
          (functionIdentity) => `EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${functionIdentity}
          SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );`,
        )
        .join('\n      ')}
    END;
    $set_mainnet_action_revocation_recovery_paths$;

    ${[
      RECONCILIATION_PREREQUISITE_V2_IDENTITY,
      POST_FINALITY_PREREQUISITE_V2_IDENTITY,
      ADMISSION_V3_IDENTITY,
      REVIEW_V3_IDENTITY,
      RECOVERY_WALLET_IDENTITY,
    ]
      .map((functionIdentity) => `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guarded};`)
      .join('\n    ')}`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  return `${[
    RECOVERY_WALLET_IDENTITY,
    REVIEW_V3_IDENTITY,
    ADMISSION_V3_IDENTITY,
    POST_FINALITY_PREREQUISITE_V2_IDENTITY,
    RECONCILIATION_PREREQUISITE_V2_IDENTITY,
  ]
    .map(
      (functionIdentity) =>
        `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guarded};\n    DROP FUNCTION ${functionIdentity};`,
    )
    .join('\n    ')}`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createMainnetFinancialActionAtomicFinalityPersistenceMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0037 must expose verification SQL');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const definitions = generatedDefinitions(names);
  const expectations = [
    [
      RECONCILIATION_PREREQUISITE_V2_IDENTITY,
      RECONCILIATION_PREREQUISITE_V1_IDENTITY,
      functionBody(definitions.reconciliationPrerequisite),
      true,
    ],
    [
      POST_FINALITY_PREREQUISITE_V2_IDENTITY,
      POST_FINALITY_PREREQUISITE_V1_IDENTITY,
      functionBody(definitions.postFinalityPrerequisite),
      false,
    ],
    [ADMISSION_V3_IDENTITY, ADMISSION_V2_IDENTITY, functionBody(definitions.admission), false],
    [REVIEW_V3_IDENTITY, REVIEW_V2_IDENTITY, functionBody(definitions.review), false],
  ] as const;
  const cloneValues = expectations
    .map(
      ([functionIdentity, predecessorIdentity, body, strict]) =>
        `('${functionIdentity}', '${predecessorIdentity}', '${sourceSha256(body)}', ${strict})`,
    )
    .join(',\n        ');
  const recoveryResultArguments = RECOVERY_RESULT.split(',').map((column) => {
    const [name = '', ...typeParts] = column.trim().split(/\s+/u);
    return [name, typeParts.join(' ').replace('timestamptz', 'timestamp with time zone')] as const;
  });
  const recoveryInputTypes = RECOVERY_ARGUMENTS.map(
    ([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`,
  );
  const recoveryAllTypes = [
    ...recoveryInputTypes,
    ...recoveryResultArguments.map(([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`),
  ];

  return `SELECT (prior.valid AND clones.valid AND recovery.valid) AS valid
    FROM (${previous.verifySql}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 4
        AND pg_catalog.count(procedure.oid) = 4
        AND pg_catalog.bool_and(
          procedure.prokind = 'f'
          AND NOT procedure.proleakproof
          AND procedure.prosecdef
          AND procedure.proisstrict = expected.is_strict
          AND procedure.provolatile = 'v'
          AND procedure.proparallel = 'u'
          AND procedure.proretset
          AND procedure.pronargs = predecessor.pronargs
          AND procedure.pronargdefaults = 0
          AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
          AND procedure.proargnames = predecessor.proargnames
          AND procedure.proargtypes = predecessor.proargtypes
          AND procedure.proallargtypes = predecessor.proallargtypes
          AND procedure.proargmodes = predecessor.proargmodes
          AND pg_catalog.pg_get_function_result(procedure.oid) =
            pg_catalog.pg_get_function_result(predecessor.oid)
          AND language.lanname = 'plpgsql'
          AND procedure.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = expected.body_sha256
          AND function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND NOT pg_catalog.has_function_privilege(${api}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${worker}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${legacy}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${balance}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${migration}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('public', expected.function_identity, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
            ) AS acl
            WHERE acl.grantee <> procedure.proowner
          )
        ) AS valid
      FROM (VALUES
        ${cloneValues}
      ) AS expected(function_identity, predecessor_identity, body_sha256, is_strict)
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_proc AS predecessor
        ON predecessor.oid = pg_catalog.to_regprocedure(expected.predecessor_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
    ) AS clones
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.count(procedure.oid) = 1
        AND pg_catalog.bool_and(
          procedure.prokind = 'f'
          AND NOT procedure.proleakproof
          AND procedure.prosecdef
          AND procedure.proisstrict
          AND procedure.provolatile = 'v'
          AND procedure.proparallel = 'u'
          AND procedure.proretset
          AND procedure.pronargs = ${RECOVERY_ARGUMENTS.length}
          AND procedure.pronargdefaults = 0
          AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
          AND procedure.proargnames = ARRAY[
            ${[
              ...RECOVERY_ARGUMENTS.map(([name]) => `'${name}'`),
              ...recoveryResultArguments.map(([name]) => `'${name}'`),
            ].join(', ')}
          ]::text[]
          AND pg_catalog.array_to_string(procedure.proargtypes::oid[], ',') =
            pg_catalog.array_to_string(ARRAY[${recoveryInputTypes.join(', ')}]::oid[], ',')
          AND procedure.proallargtypes = ARRAY[${recoveryAllTypes.join(', ')}]::oid[]
          AND procedure.proargmodes = ARRAY[
            ${[
              ...RECOVERY_ARGUMENTS.map(() => `'i'::"char"`),
              ...recoveryResultArguments.map(() => `'t'::"char"`),
            ].join(', ')}
          ]::"char"[]
          AND pg_catalog.pg_get_function_result(procedure.oid) =
            '${canonicalResult(RECOVERY_RESULT)}'
          AND language.lanname = 'plpgsql'
          AND procedure.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = '${sourceSha256(RECOVERY_WALLET_BODY)}'
          AND function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND NOT pg_catalog.has_function_privilege(${api}, '${RECOVERY_WALLET_IDENTITY}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${worker}, '${RECOVERY_WALLET_IDENTITY}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${legacy}, '${RECOVERY_WALLET_IDENTITY}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${balance}, '${RECOVERY_WALLET_IDENTITY}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${migration}, '${RECOVERY_WALLET_IDENTITY}', 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('public', '${RECOVERY_WALLET_IDENTITY}', 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
            ) AS acl
            WHERE acl.grantee <> procedure.proowner
          )
        ) AS valid
      FROM (VALUES ('${RECOVERY_WALLET_IDENTITY}')) AS expected(function_identity)
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
    ) AS recovery`;
}

export function createMainnetFinancialActionRevocationRecoveryMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0038',
    description: 'preserve post-bind mainnet action recovery after wallet revocation',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0037'],
  };
}

export const createMainnetFinancialActionRevocationRecoveryMigrationV0038 =
  createMainnetFinancialActionRevocationRecoveryMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetFinancialActionRevocationRecoveryTestSchemaMigrationV0038 =
  createMainnetFinancialActionRevocationRecoveryMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
