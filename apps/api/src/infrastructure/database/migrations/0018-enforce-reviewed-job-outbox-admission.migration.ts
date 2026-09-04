import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createAaveV3EthereumFinalizedCheckpointMigration } from './0017-create-aave-finalized-checkpoints.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ADMISSION_FUNCTION_IDENTITY = 'enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)';

const PRIOR_API_FUNCTIONS = [
  'begin_wallet_ownership_challenge(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid)',
  'prepare_wallet_ownership_challenge(uuid,uuid,uuid)',
  'reject_wallet_ownership_challenge(uuid,uuid,text,uuid)',
  'complete_wallet_registration(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
  'list_active_wallet_registrations(uuid)',
  'revoke_wallet_registration(uuid,uuid,uuid)',
  'complete_wallet_registration_guarded(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
  'verify_wallet_revocation_state()',
  'read_aave_v3_ethereum_finalized_checkpoint(text)',
] as const;

const DIRECT_INSERT_COLUMNS = [
  'id',
  'queue_name',
  'payload',
  'message_attributes',
  'status',
  'attempts',
  'available_at',
  'last_error',
  'locked_by',
  'locked_until',
  'created_at',
  'published_at',
  'failed_at',
  'ledger_command_id',
  'ledger_journal_id',
] as const;

const ADMISSION_BODY = `
    DECLARE
      contract_payload jsonb;
      correlation_state jsonb;
      envelope_correlation_id text;
      envelope_kind text;
      occurred_at text;
      optional_key text;
      rescan_position text;
      ledger_command_id uuid;
      ledger_journal_id uuid;
    BEGIN
      IF requested_id IS NULL
        OR requested_destination IS DISTINCT FROM 'jobs'
        OR requested_envelope IS NULL
        OR pg_catalog.jsonb_typeof(requested_envelope) IS DISTINCT FROM 'object'
        OR requested_message_attributes IS NULL
        OR pg_catalog.jsonb_typeof(requested_message_attributes) IS DISTINCT FROM 'object'
        OR (
          SELECT pg_catalog.count(*) <> 6
          FROM pg_catalog.jsonb_object_keys(requested_envelope)
        )
        OR NOT requested_envelope ?& ARRAY[
          'id', 'kind', 'version', 'occurredAt', 'correlation', 'payload'
        ]
        OR pg_catalog.jsonb_typeof(requested_envelope -> 'id') IS DISTINCT FROM 'string'
        OR requested_envelope ->> 'id' IS DISTINCT FROM requested_id
        OR pg_catalog.char_length(requested_id) NOT BETWEEN 1 AND 128
        OR pg_catalog.btrim(requested_id) IS DISTINCT FROM requested_id
        OR pg_catalog.jsonb_typeof(requested_envelope -> 'kind') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(requested_envelope -> 'version') IS DISTINCT FROM 'number'
        OR requested_envelope -> 'version' IS DISTINCT FROM '1'::jsonb
        OR pg_catalog.jsonb_typeof(requested_envelope -> 'occurredAt') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(requested_envelope -> 'correlation') IS DISTINCT FROM 'object'
        OR pg_catalog.jsonb_typeof(requested_envelope -> 'payload') IS DISTINCT FROM 'object'
      THEN
        RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
      END IF;

      envelope_kind := requested_envelope ->> 'kind';
      occurred_at := requested_envelope ->> 'occurredAt';
      contract_payload := requested_envelope -> 'payload';
      correlation_state := requested_envelope -> 'correlation';

      IF envelope_kind NOT IN (
          'ledger.journal-committed',
          'yield.operation.submit',
          'blockchain.balance-sync'
        )
        OR occurred_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'
        OR NOT pg_catalog.isfinite(occurred_at::timestamptz)
        OR pg_catalog.to_char(
          occurred_at::timestamptz AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) IS DISTINCT FROM occurred_at
        OR NOT correlation_state ? 'correlationId'
        OR (
          SELECT pg_catalog.count(*) NOT BETWEEN 1 AND 7
          FROM pg_catalog.jsonb_object_keys(correlation_state)
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_object_keys(correlation_state) AS key_state(name)
          WHERE key_state.name <> ALL (ARRAY[
            'correlationId', 'requestId', 'initiatorActorId', 'intentId',
            'quoteId', 'transactionId', 'ledgerEventId'
          ])
        )
        OR pg_catalog.jsonb_typeof(correlation_state -> 'correlationId') IS DISTINCT FROM 'string'
      THEN
        RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
      END IF;

      envelope_correlation_id := correlation_state ->> 'correlationId';
      IF envelope_correlation_id !~ '^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|legacy:[0-9a-f]{64})$'
      THEN
        RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
      END IF;

      FOREACH optional_key IN ARRAY ARRAY[
        'requestId', 'initiatorActorId', 'intentId', 'quoteId',
        'transactionId', 'ledgerEventId'
      ]
      LOOP
        IF correlation_state ? optional_key
          AND (
            pg_catalog.jsonb_typeof(correlation_state -> optional_key) IS DISTINCT FROM 'string'
            OR correlation_state ->> optional_key !~
              '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;
      END LOOP;

      IF (
          correlation_state ? 'requestId'
          AND correlation_state ->> 'requestId' IS DISTINCT FROM envelope_correlation_id
        )
        OR (
          envelope_correlation_id LIKE 'legacy:%'
          AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(correlation_state)) <> 1
        )
      THEN
        RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
      END IF;

      IF envelope_kind = 'ledger.journal-committed' THEN
        IF (
            SELECT pg_catalog.count(*) <> 2
            FROM pg_catalog.jsonb_object_keys(contract_payload)
          )
          OR NOT contract_payload ?& ARRAY['journalId', 'operation']
          OR pg_catalog.jsonb_typeof(contract_payload -> 'journalId') IS DISTINCT FROM 'string'
          OR contract_payload ->> 'journalId' !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR pg_catalog.jsonb_typeof(contract_payload -> 'operation') IS DISTINCT FROM 'string'
          OR contract_payload ->> 'operation' NOT IN ('POST_JOURNAL', 'REVERSE_JOURNAL')
          OR correlation_state ->> 'ledgerEventId' IS DISTINCT FROM contract_payload ->> 'journalId'
          OR requested_message_attributes IS DISTINCT FROM '{}'::jsonb
          OR requested_ledger_command_id IS NULL
          OR requested_ledger_journal_id IS NULL
          OR requested_ledger_command_id !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR requested_ledger_journal_id !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR requested_ledger_journal_id IS DISTINCT FROM contract_payload ->> 'journalId'
        THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;

        ledger_command_id := requested_ledger_command_id::uuid;
        ledger_journal_id := requested_ledger_journal_id::uuid;
        IF NOT EXISTS (
          SELECT 1
          FROM ledger_command_idempotency AS command_state
          INNER JOIN ledger_journals AS journal_state
            ON journal_state.journal_id = ledger_journal_id
           AND journal_state.actor_account_id = command_state.actor_account_id
          WHERE command_state.command_id = ledger_command_id
            AND command_state.outbox_id::text = requested_id
            AND command_state.operation = contract_payload ->> 'operation'
            AND (
              (
                command_state.operation = 'POST_JOURNAL'
                AND journal_state.economic_event_type <> 'REVERSAL'
              )
              OR (
                command_state.operation = 'REVERSE_JOURNAL'
                AND journal_state.economic_event_type = 'REVERSAL'
              )
            )
        )
        THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;
      ELSIF envelope_kind = 'yield.operation.submit' THEN
        IF (
            SELECT pg_catalog.count(*) <> 6
            FROM pg_catalog.jsonb_object_keys(contract_payload)
          )
          OR NOT contract_payload ?& ARRAY[
            'submissionId', 'operationId', 'operationType',
            'ledgerTransactionId', 'planReferenceId', 'quoteReferenceId'
          ]
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_each(contract_payload) AS payload_field(name, value)
            WHERE payload_field.name IN (
                'submissionId', 'operationId', 'ledgerTransactionId',
                'planReferenceId', 'quoteReferenceId'
              )
              AND (
                pg_catalog.jsonb_typeof(payload_field.value) IS DISTINCT FROM 'string'
                OR payload_field.value #>> '{}' !~
                  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              )
          )
          OR pg_catalog.jsonb_typeof(contract_payload -> 'operationType') IS DISTINCT FROM 'string'
          OR contract_payload ->> 'operationType' NOT IN ('ALLOCATE', 'WITHDRAW', 'REBALANCE')
          OR requested_id IS DISTINCT FROM contract_payload ->> 'submissionId'
          OR correlation_state ->> 'transactionId' IS DISTINCT FROM
            contract_payload ->> 'ledgerTransactionId'
          OR correlation_state ->> 'quoteId' IS DISTINCT FROM
            contract_payload ->> 'quoteReferenceId'
          OR requested_message_attributes IS DISTINCT FROM pg_catalog.jsonb_build_object(
            'operationType', contract_payload ->> 'operationType'
          )
          OR requested_ledger_command_id IS NOT NULL
          OR requested_ledger_journal_id IS NOT NULL
        THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;

        PERFORM 1
        FROM yield_operation_submissions AS submission_state
        INNER JOIN yield_operation_commands AS command_state
          ON command_state.command_id = submission_state.command_id
        INNER JOIN yield_operation_command_results AS result_state
          ON result_state.command_id = command_state.command_id
         AND result_state.operation_id = submission_state.operation_id
        INNER JOIN yield_operations AS operation_state
          ON operation_state.operation_id = submission_state.operation_id
        INNER JOIN yield_operation_transition_events AS transition_state
          ON transition_state.transition_event_id = result_state.transition_event_id
         AND transition_state.operation_id = operation_state.operation_id
         AND transition_state.actor_account_id = operation_state.actor_account_id
         AND transition_state.ledger_transaction_id = operation_state.ledger_transaction_id
         AND transition_state.ledger_book_id = operation_state.ledger_book_id
        WHERE submission_state.submission_id::text = requested_id
          AND submission_state.outbox_id = requested_id
          AND submission_state.submission_target = 'PROVIDER_OR_CHAIN_ADAPTER'
          AND command_state.outbox_id = requested_id
          AND command_state.actor_account_id = operation_state.actor_account_id
          AND command_state.command_kind = 'TRANSITION'
          AND command_state.contract_version = 1
          AND operation_state.operation_id::text = contract_payload ->> 'operationId'
          AND operation_state.current_state = 'SUBMITTED'
          AND operation_state.operation_type = contract_payload ->> 'operationType'
          AND operation_state.ledger_transaction_id::text =
            contract_payload ->> 'ledgerTransactionId'
          AND operation_state.plan_reference_id::text = contract_payload ->> 'planReferenceId'
          AND operation_state.quote_reference_id::text = contract_payload ->> 'quoteReferenceId'
          AND transition_state.previous_state = 'USER_APPROVED'
          AND transition_state.next_state = 'SUBMITTED'
          AND transition_state.reason_code = 'SUBMISSION_RECORDED'
          AND transition_state.event_sequence = (
            SELECT pg_catalog.max(latest_event.event_sequence)
            FROM yield_operation_transition_events AS latest_event
            WHERE latest_event.operation_id = operation_state.operation_id
          )
          AND transition_state.ledger_journal_id IS NULL
          AND transition_state.correlation_id::text = envelope_correlation_id
          AND correlation_state ->> 'initiatorActorId' =
            operation_state.actor_account_id::text
          AND submission_state.requested_at = transition_state.recorded_at
          AND pg_catalog.date_trunc('milliseconds', transition_state.recorded_at) =
            occurred_at::timestamptz
        FOR SHARE OF submission_state, command_state, result_state,
          operation_state, transition_state;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;
      ELSE
        IF (
            SELECT pg_catalog.count(*) <> 8
            FROM pg_catalog.jsonb_object_keys(contract_payload)
          )
          OR NOT contract_payload ?& ARRAY[
            'schemaVersion', 'accountId', 'walletId', 'networkId',
            'requiredTier', 'cause', 'attempt', 'rescanFromPosition'
          ]
          OR pg_catalog.jsonb_typeof(contract_payload -> 'schemaVersion') IS DISTINCT FROM 'number'
          OR contract_payload -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb
          OR pg_catalog.jsonb_typeof(contract_payload -> 'accountId') IS DISTINCT FROM 'string'
          OR contract_payload ->> 'accountId' !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR pg_catalog.jsonb_typeof(contract_payload -> 'walletId') IS DISTINCT FROM 'string'
          OR contract_payload ->> 'walletId' !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR pg_catalog.jsonb_typeof(contract_payload -> 'networkId') IS DISTINCT FROM 'string'
          OR contract_payload ->> 'networkId' NOT IN (
            'eip155:1',
            'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          )
          OR pg_catalog.jsonb_typeof(contract_payload -> 'requiredTier') IS DISTINCT FROM 'string'
          OR contract_payload ->> 'requiredTier' NOT IN ('PROVISIONAL', 'CANONICAL', 'FINANCIAL')
          OR pg_catalog.jsonb_typeof(contract_payload -> 'cause') IS DISTINCT FROM 'string'
          OR contract_payload ->> 'cause' NOT IN ('SCHEDULED', 'RETRY', 'MANUAL_RECOVERY')
          OR pg_catalog.jsonb_typeof(contract_payload -> 'attempt') IS DISTINCT FROM 'number'
          OR contract_payload ->> 'attempt' !~ '^[1-3]$'
          OR pg_catalog.jsonb_typeof(contract_payload -> 'rescanFromPosition')
            NOT IN ('null', 'string')
          OR requested_message_attributes IS DISTINCT FROM '{}'::jsonb
          OR requested_ledger_command_id IS NOT NULL
          OR requested_ledger_journal_id IS NOT NULL
        THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;

        rescan_position := contract_payload ->> 'rescanFromPosition';
        IF rescan_position IS NOT NULL
          AND (
            rescan_position !~ '^(?:0|[1-9][0-9]{0,77})$'
            OR pg_catalog.char_length(rescan_position) > 78
            OR (
              pg_catalog.char_length(rescan_position) = 78
              AND rescan_position >
                '115792089237316195423570985008687907853269984665640564039457584007913129639935'
            )
          )
        THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;

        IF (
            contract_payload ->> 'cause' = 'SCHEDULED'
            AND (
              contract_payload ->> 'attempt' <> '1'
              OR rescan_position IS NOT NULL
            )
          )
          OR (
            contract_payload ->> 'cause' = 'RETRY'
            AND (contract_payload ->> 'attempt')::integer < 2
          )
          OR (
            contract_payload ->> 'cause' = 'MANUAL_RECOVERY'
            AND rescan_position IS NULL
          )
        THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;

        PERFORM 1
        FROM registered_wallets AS wallet_state
        WHERE wallet_state.wallet_id::text = contract_payload ->> 'walletId'
          AND wallet_state.account_id::text = contract_payload ->> 'accountId'
          AND wallet_state.status = 'ACTIVE'
          AND wallet_state.revoked_at IS NULL
          AND wallet_state.registry_environment = 'MAINNET'
          AND (
            (
              contract_payload ->> 'networkId' = 'eip155:1'
              AND wallet_state.chain_namespace = 'eip155'
              AND wallet_state.chain_reference = '1'
            )
            OR (
              contract_payload ->> 'networkId' =
                'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
              AND wallet_state.chain_namespace = 'solana'
              AND wallet_state.chain_reference =
                '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
            )
          )
        FOR SHARE OF wallet_state;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
        END IF;
      END IF;

      INSERT INTO job_outbox (
        id, queue_name, payload, message_attributes,
        ledger_command_id, ledger_journal_id
      ) VALUES (
        requested_id,
        'jobs',
        requested_envelope,
        requested_message_attributes,
        ledger_command_id,
        ledger_journal_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'reviewed outbox job rejected' USING ERRCODE = '22023';
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
    throw new Error('Migration 0018 verifier anchor must occur exactly once');
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
  const insertColumns = DIRECT_INSERT_COLUMNS.join(', ');
  return `REVOKE INSERT ON TABLE job_outbox FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE INSERT (${insertColumns}) ON TABLE job_outbox
      FROM PUBLIC, ${api}, ${worker}, ${legacy};

    CREATE FUNCTION enqueue_reviewed_job_v1(
      requested_id text,
      requested_destination text,
      requested_envelope jsonb,
      requested_message_attributes jsonb,
      requested_ledger_command_id text,
      requested_ledger_journal_id text
    ) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    SET search_path = pg_catalog
    AS $function$${ADMISSION_BODY}$function$;

    DO $set_reviewed_job_admission_path$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${ADMISSION_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $set_reviewed_job_admission_path$;

    REVOKE ALL ON FUNCTION ${ADMISSION_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    GRANT EXECUTE ON FUNCTION ${ADMISSION_FUNCTION_IDENTITY} TO ${api};`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  return `REVOKE EXECUTE ON FUNCTION ${ADMISSION_FUNCTION_IDENTITY} FROM ${api};
    DROP FUNCTION ${ADMISSION_FUNCTION_IDENTITY};
    GRANT INSERT (
      id, queue_name, payload, message_attributes,
      ledger_command_id, ledger_journal_id
    ) ON TABLE job_outbox TO ${api};`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createAaveV3EthereumFinalizedCheckpointMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0017 must expose verification SQL');

  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  let prior = priorMigration.verifySql;

  if (cumulative) {
    prior = replaceExactlyOnce(
      prior,
      functionAllowance(api, PRIOR_API_FUNCTIONS),
      functionAllowance(api, [...PRIOR_API_FUNCTIONS, ADMISSION_FUNCTION_IDENTITY]),
    );
    for (const column of [
      'id',
      'queue_name',
      'payload',
      'message_attributes',
      'ledger_command_id',
      'ledger_journal_id',
    ] as const) {
      const privilege = `pg_catalog.has_column_privilege(${api}, 'job_outbox', '${column}', 'INSERT')`;
      prior = replaceExactlyOnce(prior, `AND ${privilege}`, `AND NOT ${privilege}`);
    }
  }

  const ownerCheck = cumulative ? `AND owner_role.rolname = ${owner}` : '';
  return `SELECT (
    prior.valid
    AND admission_function.valid
    AND admission_privileges.valid
  ) AS valid
  FROM (${prior}) AS prior
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        function_state.prosecdef
        AND function_state.provolatile = 'v'
        AND function_state.proparallel = 'u'
        AND NOT function_state.proleakproof
        ${ownerCheck}
        AND function_state.proconfig = ARRAY[
          'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
        ]::text[]
        AND pg_catalog.pg_get_function_identity_arguments(function_state.oid) =
          'requested_id text, requested_destination text, requested_envelope jsonb, requested_message_attributes jsonb, requested_ledger_command_id text, requested_ledger_journal_id text'
        AND function_state.prosrc = $expected_admission_body$${ADMISSION_BODY}$expected_admission_body$
      ) AS valid
    FROM pg_catalog.pg_proc AS function_state
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function_state.pronamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = function_state.proowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND function_state.proname = 'enqueue_reviewed_job_v1'
  ) AS admission_function
  CROSS JOIN (
    SELECT (
      pg_catalog.has_function_privilege(
        ${api}, '${ADMISSION_FUNCTION_IDENTITY}', 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        ${worker}, '${ADMISSION_FUNCTION_IDENTITY}', 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        ${legacy}, '${ADMISSION_FUNCTION_IDENTITY}', 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        ${migration}, '${ADMISSION_FUNCTION_IDENTITY}', 'EXECUTE'
      )
      AND NOT pg_catalog.has_table_privilege(${api}, 'job_outbox', 'INSERT')
      AND NOT pg_catalog.has_table_privilege(${worker}, 'job_outbox', 'INSERT')
      AND NOT pg_catalog.has_table_privilege(${legacy}, 'job_outbox', 'INSERT')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = pg_catalog.to_regclass('job_outbox')
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND (
            pg_catalog.has_column_privilege(
              ${api}, attribute.attrelid, attribute.attnum, 'INSERT'
            )
            OR pg_catalog.has_column_privilege(
              ${worker}, attribute.attrelid, attribute.attnum, 'INSERT'
            )
            OR pg_catalog.has_column_privilege(
              ${legacy}, attribute.attrelid, attribute.attnum, 'INSERT'
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = pg_catalog.current_schema()
          AND procedure.proname = 'enqueue_reviewed_job_v1'
          AND (
            acl.grantee = 0
            OR NOT (
              (acl.grantee = procedure.proowner OR grantee.rolname = ${api})
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS table_state
        CROSS JOIN LATERAL pg_catalog.aclexplode(table_state.relacl) AS acl
        WHERE table_state.oid = pg_catalog.to_regclass('job_outbox')
          AND acl.grantee = 0
          AND acl.privilege_type = 'INSERT'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = pg_catalog.to_regclass('job_outbox')
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee = 0
          AND acl.privilege_type = 'INSERT'
      )
    ) AS valid
  ) AS admission_privileges`;
}

export function createReviewedJobOutboxAdmissionMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0018',
    description: 'enforce database admission for reviewed outbox job contracts',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0017'],
  };
}

export const enforceReviewedJobOutboxAdmissionMigrationV0018 =
  createReviewedJobOutboxAdmissionMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const enforceReviewedJobOutboxAdmissionTestSchemaMigrationV0018 =
  createReviewedJobOutboxAdmissionMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
