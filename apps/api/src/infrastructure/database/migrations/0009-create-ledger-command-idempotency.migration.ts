import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createLedgerLifecycleMigration } from './0008-create-ledger-lifecycle.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

const PREVIOUS_LEDGER_TABLES = [
  'ledger_books',
  'ledger_assets',
  'ledger_accounts',
  'ledger_transactions',
  'ledger_legs',
  'ledger_leg_posting_plans',
  'ledger_leg_posting_plan_lines',
  'ledger_leg_recognition_evidence',
  'ledger_leg_valuation_plans',
  'ledger_leg_fee_plans',
  'ledger_leg_posting_plan_seals',
  'ledger_journals',
  'ledger_journal_lines',
  'ledger_reversal_approvals',
  'ledger_command_capabilities',
  'ledger_command_capability_resolutions',
  'ledger_valuation_snapshots',
  'ledger_fee_estimate_snapshots',
  'ledger_fee_components',
  'ledger_external_evidence',
  'ledger_external_evidence_claims',
  'ledger_journal_external_reference_usages',
  'ledger_lifecycle_transition_rules',
  'ledger_recovery_transition_rules',
  'ledger_transaction_lifecycle_events',
  'ledger_leg_lifecycle_events',
  'ledger_recovery_state_events',
] as const;

const IDEMPOTENCY_TABLES = [
  'ledger_command_idempotency',
  'ledger_command_idempotency_results',
  'ledger_provider_submission_identities',
] as const;

const IDEMPOTENCY_FUNCTION_IDENTITIES = [
  'stamp_ledger_command_recorded_at()',
  'validate_ledger_command_completion()',
  'resolve_ledger_command_idempotency(uuid,text,smallint,text,smallint,text)',
  'claim_ledger_command_idempotency(uuid,text,smallint,text,smallint,text)',
  'complete_ledger_command_idempotency(uuid,uuid,uuid)',
] as const;

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
    throw new Error('Migration 0008 verifier extension anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function replaceExactly(
  source: string,
  target: string,
  replacement: string,
  expectedOccurrences: number,
): string {
  const occurrences = source.split(target).length - 1;
  if (occurrences !== expectedOccurrences) {
    throw new Error(
      `Migration 0008 verifier extension anchor expected ${expectedOccurrences} occurrences, found ${occurrences}`,
    );
  }
  return source.split(target).join(replacement);
}

function createIdempotencyTablesSql(): string {
  return `
    CREATE TABLE ledger_command_idempotency (
      command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_account_id uuid NOT NULL,
      operation text NOT NULL,
      contract_version smallint NOT NULL,
      key_digest bytea NOT NULL,
      fingerprint_version smallint NOT NULL,
      request_fingerprint bytea NOT NULL,
      outbox_id uuid NOT NULL DEFAULT gen_random_uuid(),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT ledger_command_idempotency_command_id_uuid_v4_check CHECK (
        substring(command_id::text FROM 15 FOR 1) = '4'
        AND substring(command_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_command_idempotency_actor_fk FOREIGN KEY (actor_account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_idempotency_operation_check CHECK (
        operation IN ('POST_JOURNAL', 'REVERSE_JOURNAL')
      ),
      CONSTRAINT ledger_command_idempotency_contract_version_check CHECK (
        contract_version = 1
      ),
      CONSTRAINT ledger_command_idempotency_key_digest_check CHECK (
        octet_length(key_digest) = 32
      ),
      CONSTRAINT ledger_command_idempotency_fingerprint_version_check CHECK (
        fingerprint_version = 1
      ),
      CONSTRAINT ledger_command_idempotency_fingerprint_check CHECK (
        octet_length(request_fingerprint) = 32
      ),
      CONSTRAINT ledger_command_idempotency_outbox_id_uuid_v4_check CHECK (
        substring(outbox_id::text FROM 15 FOR 1) = '4'
        AND substring(outbox_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_command_idempotency_recorded_at_check CHECK (
        isfinite(recorded_at)
      ),
      CONSTRAINT ledger_command_idempotency_scope_unique UNIQUE (
        actor_account_id, operation, contract_version, key_digest
      ),
      CONSTRAINT ledger_command_idempotency_outbox_unique UNIQUE (outbox_id)
    );

    CREATE TABLE ledger_command_idempotency_results (
      command_id uuid PRIMARY KEY,
      journal_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT ledger_command_results_command_fk FOREIGN KEY (command_id)
        REFERENCES ledger_command_idempotency (command_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_results_journal_fk FOREIGN KEY (journal_id)
        REFERENCES ledger_journals (journal_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_results_recorded_at_check CHECK (isfinite(recorded_at)),
      CONSTRAINT ledger_command_results_journal_unique UNIQUE (journal_id)
    );

    CREATE TABLE ledger_provider_submission_identities (
      submission_identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_account_id uuid NOT NULL,
      book_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      provider_revision_reference_id uuid NOT NULL,
      contract_version smallint NOT NULL,
      key_digest bytea NOT NULL,
      fingerprint_version smallint NOT NULL,
      request_fingerprint bytea NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT ledger_provider_submission_id_uuid_v4_check CHECK (
        substring(submission_identity_id::text FROM 15 FOR 1) = '4'
        AND substring(submission_identity_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_provider_submission_scope_fk FOREIGN KEY (
        leg_id, transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_legs (
        leg_id, transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_provider_submission_provider_uuid_v4_check CHECK (
        substring(provider_revision_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(provider_revision_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_provider_submission_contract_version_check CHECK (
        contract_version = 1
      ),
      CONSTRAINT ledger_provider_submission_key_digest_check CHECK (
        octet_length(key_digest) = 32
      ),
      CONSTRAINT ledger_provider_submission_fingerprint_version_check CHECK (
        fingerprint_version = 1
      ),
      CONSTRAINT ledger_provider_submission_fingerprint_check CHECK (
        octet_length(request_fingerprint) = 32
      ),
      CONSTRAINT ledger_provider_submission_recorded_at_check CHECK (isfinite(recorded_at)),
      CONSTRAINT ledger_provider_submission_scope_unique UNIQUE (
        actor_account_id, book_id, transaction_id, leg_id,
        provider_revision_reference_id, contract_version, key_digest
      )
    );

    ALTER TABLE job_outbox
      ADD COLUMN ledger_command_id uuid,
      ADD COLUMN ledger_journal_id uuid,
      ADD CONSTRAINT job_outbox_ledger_link_pair_check CHECK (
        (ledger_command_id IS NULL) = (ledger_journal_id IS NULL)
      ),
      ADD CONSTRAINT job_outbox_ledger_command_fk FOREIGN KEY (ledger_command_id)
        REFERENCES ledger_command_idempotency (command_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      ADD CONSTRAINT job_outbox_ledger_journal_fk FOREIGN KEY (ledger_journal_id)
        REFERENCES ledger_journals (journal_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT;

    CREATE UNIQUE INDEX job_outbox_ledger_command_unique
      ON job_outbox (ledger_command_id)
      WHERE ledger_command_id IS NOT NULL;
  `;
}

function createIdempotencyFunctionsSql(): string {
  return `
    CREATE FUNCTION stamp_ledger_command_recorded_at()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $function$
    BEGIN
      NEW.recorded_at := clock_timestamp();
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION validate_ledger_command_completion()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $function$
    DECLARE
      command_actor_account_id uuid;
      command_operation text;
      command_outbox_id uuid;
      journal_actor_account_id uuid;
      journal_event_type text;
    BEGIN
      IF TG_TABLE_NAME = 'ledger_command_idempotency' THEN
        IF NOT EXISTS (
          SELECT 1
          FROM ledger_command_idempotency_results AS result
          WHERE result.command_id = NEW.command_id
        ) THEN
          RAISE EXCEPTION 'ledger command must complete in its claim transaction'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;

      SELECT command.actor_account_id, command.operation, command.outbox_id
      INTO command_actor_account_id, command_operation, command_outbox_id
      FROM ledger_command_idempotency AS command
      WHERE command.command_id = NEW.command_id
      FOR KEY SHARE;

      SELECT journal.actor_account_id, journal.economic_event_type
      INTO journal_actor_account_id, journal_event_type
      FROM ledger_journals AS journal
      WHERE journal.journal_id = NEW.journal_id
      FOR KEY SHARE;

      IF command_actor_account_id IS NULL
        OR journal_actor_account_id IS DISTINCT FROM command_actor_account_id
        OR (
          command_operation = 'POST_JOURNAL'
          AND journal_event_type = 'REVERSAL'
        )
        OR (
          command_operation = 'REVERSE_JOURNAL'
          AND journal_event_type IS DISTINCT FROM 'REVERSAL'
        )
      THEN
        RAISE EXCEPTION 'ledger command result does not match its scope'
          USING ERRCODE = '23514';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM job_outbox AS outbox
        WHERE outbox.id = command_outbox_id::text
          AND outbox.ledger_command_id = NEW.command_id
          AND outbox.ledger_journal_id = NEW.journal_id
      ) THEN
        RAISE EXCEPTION 'ledger command result requires its linked outbox row'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION resolve_ledger_command_idempotency(
      requested_actor_account_id uuid,
      requested_operation text,
      requested_contract_version smallint,
      requested_key_digest_hex text,
      requested_fingerprint_version smallint,
      requested_request_fingerprint_hex text
    ) RETURNS TABLE (journal_id uuid)
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $function$
    DECLARE
      existing_command_id uuid;
      existing_fingerprint_version smallint;
      existing_request_fingerprint bytea;
      decoded_key_digest bytea;
      decoded_request_fingerprint bytea;
    BEGIN
      IF requested_actor_account_id IS NULL
        OR requested_operation NOT IN ('POST_JOURNAL', 'REVERSE_JOURNAL')
        OR requested_contract_version IS DISTINCT FROM 1
        OR requested_fingerprint_version IS DISTINCT FROM 1
        OR requested_key_digest_hex IS NULL
        OR requested_key_digest_hex !~ '^[0-9a-f]{64}$'
        OR requested_request_fingerprint_hex IS NULL
        OR requested_request_fingerprint_hex !~ '^[0-9a-f]{64}$'
      THEN
        RAISE EXCEPTION 'invalid ledger command idempotency context'
          USING ERRCODE = '22023';
      END IF;

      decoded_key_digest := decode(requested_key_digest_hex, 'hex');
      decoded_request_fingerprint := decode(requested_request_fingerprint_hex, 'hex');

      SELECT command.command_id, command.fingerprint_version, command.request_fingerprint
      INTO existing_command_id, existing_fingerprint_version, existing_request_fingerprint
      FROM ledger_command_idempotency AS command
      WHERE command.actor_account_id = requested_actor_account_id
        AND command.operation = requested_operation
        AND command.contract_version = requested_contract_version
        AND command.key_digest = decoded_key_digest;

      IF existing_command_id IS NULL THEN
        RETURN;
      END IF;

      IF existing_fingerprint_version IS DISTINCT FROM requested_fingerprint_version
        OR existing_request_fingerprint IS DISTINCT FROM decoded_request_fingerprint
      THEN
        RAISE EXCEPTION 'ledger command idempotency conflict'
          USING ERRCODE = 'L4301';
      END IF;

      RETURN QUERY
      SELECT result.journal_id
      FROM ledger_command_idempotency_results AS result
      WHERE result.command_id = existing_command_id;
    END;
    $function$;

    CREATE FUNCTION claim_ledger_command_idempotency(
      requested_actor_account_id uuid,
      requested_operation text,
      requested_contract_version smallint,
      requested_key_digest_hex text,
      requested_fingerprint_version smallint,
      requested_request_fingerprint_hex text
    ) RETURNS TABLE (
      command_id uuid,
      journal_id uuid,
      outbox_id uuid,
      outcome text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $function$
    DECLARE
      inserted_command_id uuid;
      inserted_outbox_id uuid;
      existing_command_id uuid;
      existing_outbox_id uuid;
      existing_fingerprint_version smallint;
      existing_request_fingerprint bytea;
      existing_journal_id uuid;
      decoded_key_digest bytea;
      decoded_request_fingerprint bytea;
    BEGIN
      IF requested_actor_account_id IS NULL
        OR requested_operation NOT IN ('POST_JOURNAL', 'REVERSE_JOURNAL')
        OR requested_contract_version IS DISTINCT FROM 1
        OR requested_fingerprint_version IS DISTINCT FROM 1
        OR requested_key_digest_hex IS NULL
        OR requested_key_digest_hex !~ '^[0-9a-f]{64}$'
        OR requested_request_fingerprint_hex IS NULL
        OR requested_request_fingerprint_hex !~ '^[0-9a-f]{64}$'
      THEN
        RAISE EXCEPTION 'invalid ledger command idempotency context'
          USING ERRCODE = '22023';
      END IF;

      decoded_key_digest := decode(requested_key_digest_hex, 'hex');
      decoded_request_fingerprint := decode(requested_request_fingerprint_hex, 'hex');

      INSERT INTO ledger_command_idempotency AS command (
        actor_account_id,
        operation,
        contract_version,
        key_digest,
        fingerprint_version,
        request_fingerprint
      ) VALUES (
        requested_actor_account_id,
        requested_operation,
        requested_contract_version,
        decoded_key_digest,
        requested_fingerprint_version,
        decoded_request_fingerprint
      )
      ON CONFLICT (actor_account_id, operation, contract_version, key_digest)
        DO NOTHING
      RETURNING command.command_id, command.outbox_id
      INTO inserted_command_id, inserted_outbox_id;

      IF inserted_command_id IS NOT NULL THEN
        RETURN QUERY SELECT
          inserted_command_id,
          NULL::uuid,
          inserted_outbox_id,
          'CLAIMED'::text;
        RETURN;
      END IF;

      SELECT
        command.command_id,
        command.outbox_id,
        command.fingerprint_version,
        command.request_fingerprint
      INTO
        existing_command_id,
        existing_outbox_id,
        existing_fingerprint_version,
        existing_request_fingerprint
      FROM ledger_command_idempotency AS command
      WHERE command.actor_account_id = requested_actor_account_id
        AND command.operation = requested_operation
        AND command.contract_version = requested_contract_version
        AND command.key_digest = decoded_key_digest
      FOR UPDATE;

      IF existing_command_id IS NULL THEN
        RAISE EXCEPTION 'ledger command idempotency claim is unavailable'
          USING ERRCODE = '55000';
      END IF;

      IF existing_fingerprint_version IS DISTINCT FROM requested_fingerprint_version
        OR existing_request_fingerprint IS DISTINCT FROM decoded_request_fingerprint
      THEN
        RAISE EXCEPTION 'ledger command idempotency conflict'
          USING ERRCODE = 'L4301';
      END IF;

      SELECT result.journal_id
      INTO existing_journal_id
      FROM ledger_command_idempotency_results AS result
      WHERE result.command_id = existing_command_id;

      RETURN QUERY SELECT
        existing_command_id,
        existing_journal_id,
        existing_outbox_id,
        CASE WHEN existing_journal_id IS NULL THEN 'CLAIMED' ELSE 'REPLAYED' END;
    END;
    $function$;

    CREATE FUNCTION complete_ledger_command_idempotency(
      requested_command_id uuid,
      requested_journal_id uuid,
      requested_outbox_id uuid
    ) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $function$
    DECLARE
      command_actor_account_id uuid;
      command_operation text;
      command_outbox_id uuid;
      journal_actor_account_id uuid;
      journal_event_type text;
      existing_journal_id uuid;
    BEGIN
      IF requested_command_id IS NULL
        OR requested_journal_id IS NULL
        OR requested_outbox_id IS NULL
        OR substring(requested_command_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_command_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR substring(requested_journal_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_journal_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR substring(requested_outbox_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_outbox_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
      THEN
        RAISE EXCEPTION 'invalid ledger command completion'
          USING ERRCODE = '22023';
      END IF;

      SELECT command.actor_account_id, command.operation, command.outbox_id
      INTO command_actor_account_id, command_operation, command_outbox_id
      FROM ledger_command_idempotency AS command
      WHERE command.command_id = requested_command_id
      FOR UPDATE;

      IF command_actor_account_id IS NULL
        OR command_outbox_id IS DISTINCT FROM requested_outbox_id
      THEN
        RAISE EXCEPTION 'invalid ledger command completion'
          USING ERRCODE = '23514';
      END IF;

      SELECT result.journal_id
      INTO existing_journal_id
      FROM ledger_command_idempotency_results AS result
      WHERE result.command_id = requested_command_id;

      IF existing_journal_id IS NOT NULL THEN
        IF existing_journal_id IS DISTINCT FROM requested_journal_id THEN
          RAISE EXCEPTION 'invalid ledger command completion'
            USING ERRCODE = '23514';
        END IF;
        RETURN existing_journal_id;
      END IF;

      SELECT journal.actor_account_id, journal.economic_event_type
      INTO journal_actor_account_id, journal_event_type
      FROM ledger_journals AS journal
      WHERE journal.journal_id = requested_journal_id
      FOR KEY SHARE;

      IF journal_actor_account_id IS DISTINCT FROM command_actor_account_id
        OR (
          command_operation = 'POST_JOURNAL'
          AND journal_event_type = 'REVERSAL'
        )
        OR (
          command_operation = 'REVERSE_JOURNAL'
          AND journal_event_type IS DISTINCT FROM 'REVERSAL'
        )
      THEN
        RAISE EXCEPTION 'invalid ledger command completion'
          USING ERRCODE = '23514';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM job_outbox AS outbox
        WHERE outbox.id = requested_outbox_id::text
          AND outbox.ledger_command_id = requested_command_id
          AND outbox.ledger_journal_id = requested_journal_id
      ) THEN
        RAISE EXCEPTION 'invalid ledger command completion'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO ledger_command_idempotency_results (command_id, journal_id)
      VALUES (requested_command_id, requested_journal_id);

      RETURN requested_journal_id;
    END;
    $function$;
  `;
}

function createIdempotencyTriggersAndAclSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const tableList = IDEMPOTENCY_TABLES.join(', ');
  const functionIdentities = IDEMPOTENCY_FUNCTION_IDENTITIES.map(
    (identityValue) => `'${identityValue}'`,
  ).join(',\n        ');

  return `
    CREATE TRIGGER ledger_command_idempotency_stamp_insert
      BEFORE INSERT ON ledger_command_idempotency
      FOR EACH ROW EXECUTE FUNCTION stamp_ledger_command_recorded_at();
    CREATE TRIGGER ledger_command_results_stamp_insert
      BEFORE INSERT ON ledger_command_idempotency_results
      FOR EACH ROW EXECUTE FUNCTION stamp_ledger_command_recorded_at();
    CREATE TRIGGER ledger_provider_submission_stamp_insert
      BEFORE INSERT ON ledger_provider_submission_identities
      FOR EACH ROW EXECUTE FUNCTION stamp_ledger_command_recorded_at();

    CREATE TRIGGER ledger_command_idempotency_append_row
      BEFORE UPDATE OR DELETE ON ledger_command_idempotency
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_command_idempotency_append_truncate
      BEFORE TRUNCATE ON ledger_command_idempotency
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_command_results_append_row
      BEFORE UPDATE OR DELETE ON ledger_command_idempotency_results
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_command_results_append_truncate
      BEFORE TRUNCATE ON ledger_command_idempotency_results
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_provider_submission_append_row
      BEFORE UPDATE OR DELETE ON ledger_provider_submission_identities
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_provider_submission_append_truncate
      BEFORE TRUNCATE ON ledger_provider_submission_identities
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();

    CREATE CONSTRAINT TRIGGER ledger_command_idempotency_complete_insert
      AFTER INSERT ON ledger_command_idempotency
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_command_completion();
    CREATE CONSTRAINT TRIGGER ledger_command_results_validate_insert
      AFTER INSERT ON ledger_command_idempotency_results
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_command_completion();

    ALTER TABLE ledger_command_idempotency
      ENABLE ALWAYS TRIGGER ledger_command_idempotency_stamp_insert;
    ALTER TABLE ledger_command_idempotency_results
      ENABLE ALWAYS TRIGGER ledger_command_results_stamp_insert;
    ALTER TABLE ledger_provider_submission_identities
      ENABLE ALWAYS TRIGGER ledger_provider_submission_stamp_insert;
    ALTER TABLE ledger_command_idempotency
      ENABLE ALWAYS TRIGGER ledger_command_idempotency_append_row;
    ALTER TABLE ledger_command_idempotency
      ENABLE ALWAYS TRIGGER ledger_command_idempotency_append_truncate;
    ALTER TABLE ledger_command_idempotency_results
      ENABLE ALWAYS TRIGGER ledger_command_results_append_row;
    ALTER TABLE ledger_command_idempotency_results
      ENABLE ALWAYS TRIGGER ledger_command_results_append_truncate;
    ALTER TABLE ledger_provider_submission_identities
      ENABLE ALWAYS TRIGGER ledger_provider_submission_append_row;
    ALTER TABLE ledger_provider_submission_identities
      ENABLE ALWAYS TRIGGER ledger_provider_submission_append_truncate;
    ALTER TABLE ledger_command_idempotency
      ENABLE ALWAYS TRIGGER ledger_command_idempotency_complete_insert;
    ALTER TABLE ledger_command_idempotency_results
      ENABLE ALWAYS TRIGGER ledger_command_results_validate_insert;

    DO $qualify_idempotency_function_references$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
      relation_name text;
      function_definition text;
      function_body text;
      qualified_relation text;
    BEGIN
      FOREACH function_identity IN ARRAY ARRAY[
        ${functionIdentities}
      ]
      LOOP
        SELECT pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure(
            pg_catalog.format('%I.%s', migration_schema, function_identity)
          )
        )
        INTO function_definition;
        function_body := pg_catalog.split_part(function_definition, '$function$', 2);

        FOREACH relation_name IN ARRAY ARRAY[
          'accounts',
          'job_outbox',
          'ledger_journals',
          'ledger_command_idempotency',
          'ledger_command_idempotency_results',
          'ledger_provider_submission_identities'
        ]
        LOOP
          qualified_relation := pg_catalog.format('%I.%I', migration_schema, relation_name);
          function_body := pg_catalog.replace(
            function_body,
            'FROM ' || relation_name,
            'FROM ' || qualified_relation
          );
          function_body := pg_catalog.replace(
            function_body,
            'JOIN ' || relation_name,
            'JOIN ' || qualified_relation
          );
          function_body := pg_catalog.replace(
            function_body,
            'INTO ' || relation_name,
            'INTO ' || qualified_relation
          );
          function_body := pg_catalog.replace(
            function_body,
            'UPDATE ' || relation_name,
            'UPDATE ' || qualified_relation
          );
          function_body := pg_catalog.replace(
            function_body,
            'TABLE ' || relation_name,
            'TABLE ' || qualified_relation
          );
        END LOOP;

        function_definition := pg_catalog.split_part(function_definition, '$function$', 1)
          || '$function$'
          || function_body
          || '$function$'
          || pg_catalog.split_part(function_definition, '$function$', 3);
        EXECUTE function_definition;
      END LOOP;
    END;
    $qualify_idempotency_function_references$;

    DO $set_idempotency_function_paths$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
    BEGIN
      FOREACH function_identity IN ARRAY ARRAY[
        ${functionIdentities}
      ]
      LOOP
        EXECUTE pg_catalog.format(
          'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',
          migration_schema,
          function_identity,
          migration_schema
        );
      END LOOP;
    END;
    $set_idempotency_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${tableList}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};

    REVOKE ALL ON FUNCTION stamp_ledger_command_recorded_at()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_command_completion()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION resolve_ledger_command_idempotency(
      uuid, text, smallint, text, smallint, text
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION claim_ledger_command_idempotency(
      uuid, text, smallint, text, smallint, text
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION complete_ledger_command_idempotency(
      uuid, uuid, uuid
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};

    GRANT EXECUTE ON FUNCTION resolve_ledger_command_idempotency(
      uuid, text, smallint, text, smallint, text
    ) TO ${api};
    GRANT EXECUTE ON FUNCTION claim_ledger_command_idempotency(
      uuid, text, smallint, text, smallint, text
    ) TO ${api};
    GRANT EXECUTE ON FUNCTION complete_ledger_command_idempotency(
      uuid, uuid, uuid
    ) TO ${api};
    GRANT INSERT (ledger_command_id, ledger_journal_id)
      ON TABLE job_outbox TO ${api};
  `;
}

function createIdempotencyDownSql(names: DatabasePrincipalNames): readonly string[] {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  return [
    `DO $refuse_populated_idempotency_rollback$
     BEGIN
       IF EXISTS (SELECT 1 FROM ledger_command_idempotency)
         OR EXISTS (SELECT 1 FROM ledger_command_idempotency_results)
         OR EXISTS (SELECT 1 FROM ledger_provider_submission_identities)
         OR EXISTS (
           SELECT 1 FROM job_outbox
           WHERE ledger_command_id IS NOT NULL OR ledger_journal_id IS NOT NULL
         )
       THEN
         RAISE EXCEPTION 'cannot roll back retained ledger command identities'
           USING ERRCODE = '55000';
       END IF;
     END;
     $refuse_populated_idempotency_rollback$;`,
    `REVOKE EXECUTE ON FUNCTION resolve_ledger_command_idempotency(
       uuid, text, smallint, text, smallint, text
     ) FROM ${api}`,
    `REVOKE EXECUTE ON FUNCTION claim_ledger_command_idempotency(
       uuid, text, smallint, text, smallint, text
     ) FROM ${api}`,
    `REVOKE EXECUTE ON FUNCTION complete_ledger_command_idempotency(
       uuid, uuid, uuid
     ) FROM ${api}`,
    `REVOKE INSERT (ledger_command_id, ledger_journal_id)
       ON TABLE job_outbox FROM ${api}`,
    'DROP INDEX job_outbox_ledger_command_unique',
    `ALTER TABLE job_outbox
       DROP CONSTRAINT job_outbox_ledger_journal_fk,
       DROP CONSTRAINT job_outbox_ledger_command_fk,
       DROP CONSTRAINT job_outbox_ledger_link_pair_check,
       DROP COLUMN ledger_journal_id,
       DROP COLUMN ledger_command_id`,
    'DROP TABLE ledger_command_idempotency_results',
    'DROP TABLE ledger_provider_submission_identities',
    'DROP TABLE ledger_command_idempotency',
    'DROP FUNCTION complete_ledger_command_idempotency(uuid, uuid, uuid)',
    `DROP FUNCTION claim_ledger_command_idempotency(
       uuid, text, smallint, text, smallint, text
     )`,
    `DROP FUNCTION resolve_ledger_command_idempotency(
       uuid, text, smallint, text, smallint, text
     )`,
    'DROP FUNCTION validate_ledger_command_completion()',
    'DROP FUNCTION stamp_ledger_command_recorded_at()',
  ];
}

function createIdempotencyVerifierSql(
  names: DatabasePrincipalNames,
  cumulativePrincipalVerification: boolean,
): string {
  const priorMigration = createLedgerLifecycleMigration(names, {
    cumulativePrincipalVerification,
  });
  if (!priorMigration.verifySql) {
    throw new Error('Migration 0008 must expose verification SQL');
  }

  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const previousPrincipalFunctionAllowance = `            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                to_regprocedure(
                  'transition_ledger_transaction_state(uuid,uuid,text,text,text,timestamptz,uuid)'
                ),
                to_regprocedure(
                  'transition_ledger_leg_state(uuid,uuid,uuid,text,text,text,timestamptz,uuid)'
                ),
                to_regprocedure(
                  'transition_ledger_recovery_state(uuid,uuid,uuid,text,text,text,timestamptz,uuid)'
                ),
                to_regprocedure(
                  'post_ledger_journal_with_lifecycle(text,uuid,uuid,uuid,text,timestamptz,timestamptz,text,uuid,text)'
                ),
                to_regprocedure(
                  'reverse_ledger_journal_with_lifecycle(text,uuid,text,timestamptz,timestamptz,uuid)'
                )
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const idempotencyPrincipalFunctionAllowance = previousPrincipalFunctionAllowance.replace(
    `                to_regprocedure(
                  'reverse_ledger_journal_with_lifecycle(text,uuid,text,timestamptz,timestamptz,uuid)'
                )`,
    `                to_regprocedure(
                  'reverse_ledger_journal_with_lifecycle(text,uuid,text,timestamptz,timestamptz,uuid)'
                ),
                to_regprocedure(
                  'resolve_ledger_command_idempotency(uuid,text,smallint,text,smallint,text)'
                ),
                to_regprocedure(
                  'claim_ledger_command_idempotency(uuid,text,smallint,text,smallint,text)'
                ),
                to_regprocedure(
                  'complete_ledger_command_idempotency(uuid,uuid,uuid)'
                )`,
  );

  const previousLedgerFunctionAllowance = `             AND (
               (acl.proname = 'transition_ledger_transaction_state'
                 AND acl.identity_arguments =
                   'requested_actor_account_id uuid, requested_transaction_id uuid, requested_expected_state text, requested_next_state text, requested_reason_code text, requested_effective_at timestamp with time zone, requested_correlation_id uuid')
               OR
               (acl.proname = 'transition_ledger_leg_state'
                 AND acl.identity_arguments =
                   'requested_actor_account_id uuid, requested_transaction_id uuid, requested_leg_id uuid, requested_expected_state text, requested_next_state text, requested_reason_code text, requested_effective_at timestamp with time zone, requested_correlation_id uuid')
               OR
               (acl.proname = 'transition_ledger_recovery_state'
                 AND acl.identity_arguments =
                   'requested_actor_account_id uuid, requested_transaction_id uuid, requested_leg_id uuid, requested_expected_state text, requested_next_state text, requested_reason_code text, requested_effective_at timestamp with time zone, requested_correlation_id uuid')
               OR
               (acl.proname = 'post_ledger_journal_with_lifecycle'
                 AND acl.identity_arguments =
                   'requested_capability_token text, requested_book_id uuid, requested_transaction_id uuid, requested_leg_id uuid, requested_economic_event_type text, requested_effective_at timestamp with time zone, requested_observed_at timestamp with time zone, requested_reason_code text, requested_correlation_id uuid, requested_postings text')
               OR
               (acl.proname = 'reverse_ledger_journal_with_lifecycle'
                 AND acl.identity_arguments =
                   'requested_capability_token text, requested_original_journal_id uuid, requested_reason_code text, requested_effective_at timestamp with time zone, requested_observed_at timestamp with time zone, requested_correlation_id uuid')
             )`;
  const idempotencyLedgerFunctionAllowance = previousLedgerFunctionAllowance.replace(
    `               (acl.proname = 'reverse_ledger_journal_with_lifecycle'
                 AND acl.identity_arguments =
                   'requested_capability_token text, requested_original_journal_id uuid, requested_reason_code text, requested_effective_at timestamp with time zone, requested_observed_at timestamp with time zone, requested_correlation_id uuid')`,
    `               (acl.proname = 'reverse_ledger_journal_with_lifecycle'
                 AND acl.identity_arguments =
                   'requested_capability_token text, requested_original_journal_id uuid, requested_reason_code text, requested_effective_at timestamp with time zone, requested_observed_at timestamp with time zone, requested_correlation_id uuid')
               OR
               (acl.proname = 'resolve_ledger_command_idempotency'
                 AND acl.identity_arguments =
                   'requested_actor_account_id uuid, requested_operation text, requested_contract_version smallint, requested_key_digest_hex text, requested_fingerprint_version smallint, requested_request_fingerprint_hex text')
               OR
               (acl.proname = 'claim_ledger_command_idempotency'
                 AND acl.identity_arguments =
                   'requested_actor_account_id uuid, requested_operation text, requested_contract_version smallint, requested_key_digest_hex text, requested_fingerprint_version smallint, requested_request_fingerprint_hex text')
               OR
               (acl.proname = 'complete_ledger_command_idempotency'
                 AND acl.identity_arguments =
                   'requested_command_id uuid, requested_journal_id uuid, requested_outbox_id uuid')`,
  );

  let verifier = priorMigration.verifySql;
  verifier = replaceExactlyOnce(
    verifier,
    `          constraint_state.conkey::text,
          constraint_state.confkey::text,`,
    `          CASE
            WHEN table_state.relname = 'job_outbox' THEN (
              SELECT pg_catalog.array_agg(
                key_attribute.attname ORDER BY key_column.ordinality
              )::text
              FROM pg_catalog.unnest(constraint_state.conkey)
                WITH ORDINALITY AS key_column(attnum, ordinality)
              INNER JOIN pg_catalog.pg_attribute AS key_attribute
                ON key_attribute.attrelid = constraint_state.conrelid
               AND key_attribute.attnum = key_column.attnum
            )
            ELSE constraint_state.conkey::text
          END,
          constraint_state.confkey::text,`,
  );
  if (cumulativePrincipalVerification) {
    verifier = replaceExactlyOnce(
      verifier,
      previousPrincipalFunctionAllowance,
      idempotencyPrincipalFunctionAllowance,
    );
    verifier = replaceExactly(
      verifier,
      "'id', 'queue_name', 'payload', 'message_attributes'",
      "'id', 'queue_name', 'payload', 'message_attributes', 'ledger_command_id', 'ledger_journal_id'",
      2,
    );
    verifier = replaceExactlyOnce(
      verifier,
      `    AND pg_catalog.has_column_privilege(${api}, 'job_outbox', 'message_attributes', 'INSERT')`,
      `    AND pg_catalog.has_column_privilege(${api}, 'job_outbox', 'message_attributes', 'INSERT')
    AND pg_catalog.has_column_privilege(${api}, 'job_outbox', 'ledger_command_id', 'INSERT')
    AND pg_catalog.has_column_privilege(${api}, 'job_outbox', 'ledger_journal_id', 'INSERT')`,
    );
  }

  const previousLedgerTableLiterals = PREVIOUS_LEDGER_TABLES.map((table) => `'${table}'`).join(
    ', ',
  );
  const idempotencyTableLiterals = [...PREVIOUS_LEDGER_TABLES, ...IDEMPOTENCY_TABLES]
    .map((table) => `'${table}'`)
    .join(', ');
  if (cumulativePrincipalVerification) {
    verifier = replaceExactly(verifier, previousLedgerTableLiterals, idempotencyTableLiterals, 2);
  }

  const exactCatalogReplacements = [
    ['SELECT object_count = 27 FROM table_catalog', 'SELECT object_count = 30 FROM table_catalog'],
    [
      '0bc0dfab851ed4ad9153e91c5feaca20e2d203fa24e6ffc88f3382bfbbb31bd7',
      'f38cc85967dd157b2c911aad42fbcfd59612a94b817e6deda9d1f611a75d2b69',
    ],
    [
      'SELECT object_count = 376 FROM column_catalog',
      'SELECT object_count = 399 FROM column_catalog',
    ],
    [
      '4692a4b7a60c5618c288383cc0c9bf2aa90d35c48f5fe92c960f5c1e806c9447',
      '8a368cce3ca56202e8617ee574f46b2c20923c7b86462e395e2cf9f8007b3e26',
    ],
    [
      'SELECT object_count = 364 FROM constraint_catalog',
      'SELECT object_count = 395 FROM constraint_catalog',
    ],
    [
      'a41b52ade12650900c09346cd5bb4c842247fcd2f8a5b330d817dc983b6eab74',
      'f1dc6b99d451f1c03312b892837a733a5776f7b0ee9b9a1bcd0db0ce787a417e',
    ],
    ['SELECT object_count = 98 FROM index_catalog', 'SELECT object_count = 105 FROM index_catalog'],
    [
      'cbdd318c7200d69056f4d5895e34b93dce1182a1de1e4cc2ceb543e4c5d90619',
      '18457583a9e38d191026f9ada7733b3cf215e9f151c9eb7922236bf59326dcaa',
    ],
    [
      'SELECT object_count = 78 FROM trigger_catalog',
      'SELECT object_count = 89 FROM trigger_catalog',
    ],
    [
      '5d12a03652792fce36ad50ac1b5b6962f1976183424cf1ea195d601d85ee8f3b',
      '57f46b7e98461e296f5c2f2f9b7567e0e14c16e3a7f99dbae6efbf0df6aaadce',
    ],
    [
      'SELECT object_count = 324 FROM internal_fk_trigger_catalog',
      'SELECT object_count = 348 FROM internal_fk_trigger_catalog',
    ],
    [
      'e755071afde23309f6fb86d006067d6f6c6b20494d4c6029012d910fb0adc034',
      'a02223eacacc746c393c044217ba644764e0041446644270fcd9f02c12de8146',
    ],
    [
      'SELECT object_count = 24 FROM function_catalog',
      'SELECT object_count = 29 FROM function_catalog',
    ],
    [
      'bfff8c7dec8a03102ee541201661fb4b7ded3f7894a0da1573294be14b6827c9',
      'daeebcede93b81d380ae116b84fe638857261727253384f3ec1dc13d95c06bf1',
    ],
    [
      'SELECT pg_catalog.count(*) = 189 FROM table_acl',
      'SELECT pg_catalog.count(*) = 210 FROM table_acl',
    ],
    [
      'SELECT pg_catalog.count(*) = 29 FROM function_acl',
      'SELECT pg_catalog.count(*) = 37 FROM function_acl',
    ],
  ] as const;
  for (const [oldValue, newValue] of exactCatalogReplacements) {
    verifier = replaceExactlyOnce(verifier, oldValue, newValue);
  }

  verifier = replaceExactlyOnce(
    verifier,
    previousLedgerFunctionAllowance,
    idempotencyLedgerFunctionAllowance,
  );
  verifier = replaceExactlyOnce(
    verifier,
    `function_state.proname IN (
          'transition_ledger_transaction_state',
          'transition_ledger_leg_state',
          'transition_ledger_recovery_state',
          'post_ledger_journal_with_lifecycle',
          'reverse_ledger_journal_with_lifecycle'
        )`,
    `function_state.proname IN (
          'transition_ledger_transaction_state',
          'transition_ledger_leg_state',
          'transition_ledger_recovery_state',
          'post_ledger_journal_with_lifecycle',
          'reverse_ledger_journal_with_lifecycle',
          'resolve_ledger_command_idempotency',
          'claim_ledger_command_idempotency',
          'complete_ledger_command_idempotency'
        )`,
  );

  const jobOutboxLinkVerifier = `SELECT (
    (
      SELECT pg_catalog.count(*) = 2
        AND pg_catalog.bool_and(
          attribute.attnotnull = false
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
          AND default_state.oid IS NULL
        )
      FROM pg_catalog.pg_attribute AS attribute
      LEFT JOIN pg_catalog.pg_attrdef AS default_state
        ON default_state.adrelid = attribute.attrelid
       AND default_state.adnum = attribute.attnum
      WHERE attribute.attrelid = pg_catalog.to_regclass('job_outbox')
        AND attribute.attname IN ('ledger_command_id', 'ledger_journal_id')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    )
    AND (
      SELECT pg_catalog.count(*) = 3
        AND pg_catalog.bool_and(
          CASE constraint_state.conname
            WHEN 'job_outbox_ledger_link_pair_check' THEN
              constraint_state.contype = 'c'
              AND pg_catalog.pg_get_constraintdef(constraint_state.oid, false) =
                'CHECK (((ledger_command_id IS NULL) = (ledger_journal_id IS NULL)))'
            WHEN 'job_outbox_ledger_command_fk' THEN
              constraint_state.contype = 'f'
              AND pg_catalog.pg_get_constraintdef(constraint_state.oid, false) =
                'FOREIGN KEY (ledger_command_id) REFERENCES ledger_command_idempotency(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT'
            WHEN 'job_outbox_ledger_journal_fk' THEN
              constraint_state.contype = 'f'
              AND pg_catalog.pg_get_constraintdef(constraint_state.oid, false) =
                'FOREIGN KEY (ledger_journal_id) REFERENCES ledger_journals(journal_id) ON UPDATE RESTRICT ON DELETE RESTRICT'
            ELSE false
          END
        )
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.conrelid = pg_catalog.to_regclass('job_outbox')
        AND constraint_state.conname LIKE 'job_outbox_ledger_%'
    )
    AND (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(
          index_state.indisunique
          AND index_state.indisvalid
          AND index_state.indisready
          AND pg_catalog.replace(
            pg_catalog.pg_get_indexdef(index_state.indexrelid, 0, false),
            pg_catalog.format('%I.', pg_catalog.current_schema()),
            '__schema__.'
          ) =
            'CREATE UNIQUE INDEX job_outbox_ledger_command_unique ON __schema__.job_outbox USING btree (ledger_command_id) WHERE (ledger_command_id IS NOT NULL)'
        )
      FROM pg_catalog.pg_index AS index_state
      INNER JOIN pg_catalog.pg_class AS index_table
        ON index_table.oid = index_state.indexrelid
      WHERE index_state.indrelid = pg_catalog.to_regclass('job_outbox')
        AND index_table.relname = 'job_outbox_ledger_command_unique'
    )
  ) AS valid`;
  return `SELECT (prior.valid AND outbox_link.valid) AS valid
    FROM (${verifier}) AS prior
    CROSS JOIN (${jobOutboxLinkVerifier}) AS outbox_link`;
}

export function createLedgerCommandIdempotencyMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0009',
    description: 'create retained ledger command idempotency and outbox linkage',
    upSql: [
      createIdempotencyTablesSql(),
      createIdempotencyFunctionsSql(),
      createIdempotencyTriggersAndAclSql(names),
    ],
    downSql: createIdempotencyDownSql(names),
    verifySql: createIdempotencyVerifierSql(names, cumulativePrincipalVerification),
    supersedesVerificationOf: ['0008'],
  };
}

export const createLedgerCommandIdempotencyMigrationV0009 = createLedgerCommandIdempotencyMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createLedgerCommandIdempotencyTestSchemaMigrationV0009 =
  createLedgerCommandIdempotencyMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
