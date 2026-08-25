import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createWalletOwnershipRegistrationMigration } from './0011-create-wallet-ownership-registration.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

const YIELD_OPERATION_TABLES = [
  'yield_operations',
  'yield_operation_transition_events',
  'yield_operation_commands',
  'yield_operation_command_results',
  'yield_operation_submissions',
] as const;

const YIELD_OPERATION_FUNCTION_IDENTITIES = [
  'reject_yield_operation_audit_mutation()',
  'enforce_yield_operation_identity_immutability()',
  'validate_yield_operation_command_completion()',
  'claim_yield_operation_command(uuid,text,smallint,text,smallint,text,boolean)',
  'yield_operation_command_result(uuid,text)',
  'create_yield_operation(uuid,uuid,text,uuid,uuid,uuid,timestamp with time zone,uuid,smallint,text,smallint,text)',
  'transition_yield_operation(uuid,uuid,text,text,text,timestamp with time zone,uuid,uuid,smallint,text,smallint,text)',
] as const;

const YIELD_OPERATION_API_FUNCTION_IDENTITIES = [
  YIELD_OPERATION_FUNCTION_IDENTITIES[5],
  YIELD_OPERATION_FUNCTION_IDENTITIES[6],
] as const;

const WALLET_REGISTRATION_API_FUNCTION_IDENTITIES = [
  'begin_wallet_ownership_challenge(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid)',
  'prepare_wallet_ownership_challenge(uuid,uuid,uuid)',
  'reject_wallet_ownership_challenge(uuid,uuid,text,uuid)',
  'complete_wallet_registration(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
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

function createYieldOperationTablesSql(): string {
  return `
    CREATE TABLE yield_operations (
      operation_id uuid PRIMARY KEY,
      actor_account_id uuid NOT NULL,
      operation_type text NOT NULL,
      current_state text NOT NULL,
      ledger_transaction_id uuid NOT NULL,
      ledger_book_id uuid NOT NULL,
      plan_reference_id uuid NOT NULL,
      quote_reference_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT yield_operations_id_uuid_v4_check CHECK (
        substring(operation_id::text FROM 15 FOR 1) = '4'
        AND substring(operation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT yield_operations_ledger_scope_fk FOREIGN KEY (
        ledger_transaction_id, ledger_book_id, actor_account_id
      ) REFERENCES ledger_transactions (transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_operations_type_check CHECK (
        operation_type IN ('ALLOCATE', 'WITHDRAW', 'REBALANCE')
      ),
      CONSTRAINT yield_operations_state_check CHECK (
        current_state IN (
          'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT yield_operations_plan_uuid_v4_check CHECK (
        substring(plan_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(plan_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT yield_operations_quote_uuid_v4_check CHECK (
        substring(quote_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(quote_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT yield_operations_recorded_at_check CHECK (isfinite(recorded_at)),
      CONSTRAINT yield_operations_ledger_transaction_unique UNIQUE (ledger_transaction_id),
      CONSTRAINT yield_operations_scope_unique UNIQUE (
        operation_id, actor_account_id, ledger_transaction_id, ledger_book_id
      )
    );

    CREATE TABLE yield_operation_transition_events (
      transition_event_id uuid PRIMARY KEY,
      operation_id uuid NOT NULL,
      actor_account_id uuid NOT NULL,
      event_sequence bigint NOT NULL,
      previous_state text,
      next_state text NOT NULL,
      reason_code text NOT NULL,
      effective_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      correlation_id uuid NOT NULL,
      ledger_transaction_id uuid NOT NULL,
      ledger_book_id uuid NOT NULL,
      ledger_journal_id uuid,
      CONSTRAINT yield_transition_event_ledger_event_fk FOREIGN KEY (transition_event_id)
        REFERENCES ledger_transaction_lifecycle_events (lifecycle_event_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_transition_event_operation_fk FOREIGN KEY (
        operation_id, actor_account_id, ledger_transaction_id, ledger_book_id
      ) REFERENCES yield_operations (
        operation_id, actor_account_id, ledger_transaction_id, ledger_book_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_transition_event_journal_fk FOREIGN KEY (ledger_journal_id)
        REFERENCES ledger_journals (journal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_transition_event_sequence_check CHECK (event_sequence > 0),
      CONSTRAINT yield_transition_event_previous_state_check CHECK (
        previous_state IS NULL OR previous_state IN (
          'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT yield_transition_event_next_state_check CHECK (
        next_state IN (
          'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT yield_transition_event_reason_check CHECK (
        reason_code IN (
          'INTENT_CREATED', 'QUOTE_CREATED', 'USER_APPROVAL_RECORDED',
          'SUBMISSION_RECORDED', 'OUTCOME_PENDING', 'SETTLEMENT_RECORDED',
          'PREFLIGHT_FAILED', 'USER_REJECTED', 'QUOTE_EXPIRED',
          'PROVIDER_REJECTED', 'TERMINAL_FAILURE_CONFIRMED',
          'FULL_REVERSAL_RECORDED'
        )
      ),
      CONSTRAINT yield_transition_event_initial_shape_check CHECK (
        (previous_state IS NULL) = (next_state = 'CREATED' AND reason_code = 'INTENT_CREATED')
      ),
      CONSTRAINT yield_transition_event_journal_shape_check CHECK (
        (ledger_journal_id IS NOT NULL) = (next_state IN ('SETTLED', 'REVERSED'))
      ),
      CONSTRAINT yield_transition_event_time_check CHECK (
        isfinite(effective_at) AND isfinite(recorded_at)
      ),
      CONSTRAINT yield_transition_event_correlation_uuid_v4_check CHECK (
        substring(correlation_id::text FROM 15 FOR 1) = '4'
        AND substring(correlation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT yield_transition_event_sequence_unique UNIQUE (
        operation_id, event_sequence
      )
    );

    CREATE INDEX yield_transition_event_audit_idx
      ON yield_operation_transition_events (
        operation_id, recorded_at, transition_event_id
      );
    CREATE INDEX yield_transition_event_correlation_idx
      ON yield_operation_transition_events (
        correlation_id, recorded_at, transition_event_id
      );

    CREATE TABLE yield_operation_commands (
      command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_account_id uuid NOT NULL,
      command_kind text NOT NULL,
      contract_version smallint NOT NULL,
      key_digest bytea NOT NULL,
      fingerprint_version smallint NOT NULL,
      request_fingerprint bytea NOT NULL,
      outbox_id text,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT yield_operation_commands_id_uuid_v4_check CHECK (
        substring(command_id::text FROM 15 FOR 1) = '4'
        AND substring(command_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT yield_operation_commands_actor_fk FOREIGN KEY (actor_account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_operation_commands_kind_check CHECK (
        command_kind IN ('CREATE', 'TRANSITION')
      ),
      CONSTRAINT yield_operation_commands_contract_check CHECK (contract_version = 1),
      CONSTRAINT yield_operation_commands_key_digest_check CHECK (
        octet_length(key_digest) = 32
      ),
      CONSTRAINT yield_operation_commands_fingerprint_version_check CHECK (
        fingerprint_version = 1
      ),
      CONSTRAINT yield_operation_commands_fingerprint_check CHECK (
        octet_length(request_fingerprint) = 32
      ),
      CONSTRAINT yield_operation_commands_outbox_uuid_v4_check CHECK (
        outbox_id IS NULL OR outbox_id ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ),
      CONSTRAINT yield_operation_commands_recorded_at_check CHECK (isfinite(recorded_at)),
      CONSTRAINT yield_operation_commands_scope_unique UNIQUE (
        actor_account_id, command_kind, contract_version, key_digest
      ),
      CONSTRAINT yield_operation_commands_outbox_unique UNIQUE (outbox_id)
    );

    CREATE TABLE yield_operation_command_results (
      command_id uuid PRIMARY KEY,
      operation_id uuid NOT NULL,
      transition_event_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT yield_operation_command_results_command_fk FOREIGN KEY (command_id)
        REFERENCES yield_operation_commands (command_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_operation_command_results_operation_fk FOREIGN KEY (operation_id)
        REFERENCES yield_operations (operation_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_operation_command_results_event_fk FOREIGN KEY (transition_event_id)
        REFERENCES yield_operation_transition_events (transition_event_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_operation_command_results_time_check CHECK (isfinite(recorded_at)),
      CONSTRAINT yield_operation_command_results_event_unique UNIQUE (transition_event_id)
    );

    CREATE TABLE yield_operation_submissions (
      submission_id uuid PRIMARY KEY,
      operation_id uuid NOT NULL,
      command_id uuid NOT NULL,
      outbox_id text NOT NULL,
      submission_target text NOT NULL,
      requested_at timestamptz NOT NULL,
      CONSTRAINT yield_operation_submissions_id_uuid_v4_check CHECK (
        substring(submission_id::text FROM 15 FOR 1) = '4'
        AND substring(submission_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT yield_operation_submissions_operation_fk FOREIGN KEY (operation_id)
        REFERENCES yield_operations (operation_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_operation_submissions_command_fk FOREIGN KEY (command_id)
        REFERENCES yield_operation_commands (command_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT yield_operation_submissions_target_check CHECK (
        submission_target = 'PROVIDER_OR_CHAIN_ADAPTER'
      ),
      CONSTRAINT yield_operation_submissions_time_check CHECK (isfinite(requested_at)),
      CONSTRAINT yield_operation_submissions_operation_unique UNIQUE (operation_id),
      CONSTRAINT yield_operation_submissions_command_unique UNIQUE (command_id),
      CONSTRAINT yield_operation_submissions_outbox_unique UNIQUE (outbox_id),
      CONSTRAINT yield_operation_submissions_identity_check CHECK (
        submission_id::text = outbox_id
      )
    );
  `;
}

function yieldOperationResultColumns(): string {
  return `
      command_id uuid,
      operation_id uuid,
      operation_type text,
      current_state text,
      ledger_transaction_id uuid,
      plan_reference_id uuid,
      quote_reference_id uuid,
      operation_recorded_at timestamptz,
      transition_event_id uuid,
      actor_account_id uuid,
      previous_state text,
      next_state text,
      reason_code text,
      effective_at timestamptz,
      transition_recorded_at timestamptz,
      correlation_id uuid,
      ledger_journal_id uuid,
      submission_id uuid,
      outcome text`;
}

function createYieldOperationHelperFunctionsSql(): string {
  return `
    CREATE FUNCTION reject_yield_operation_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $function$
    BEGIN
      RAISE EXCEPTION 'yield operation audit records are append-only'
        USING ERRCODE = '55000';
    END;
    $function$;

    CREATE FUNCTION enforce_yield_operation_identity_immutability()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $function$
    BEGIN
      IF NEW.operation_id IS DISTINCT FROM OLD.operation_id
        OR NEW.actor_account_id IS DISTINCT FROM OLD.actor_account_id
        OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
        OR NEW.ledger_transaction_id IS DISTINCT FROM OLD.ledger_transaction_id
        OR NEW.ledger_book_id IS DISTINCT FROM OLD.ledger_book_id
        OR NEW.plan_reference_id IS DISTINCT FROM OLD.plan_reference_id
        OR NEW.quote_reference_id IS DISTINCT FROM OLD.quote_reference_id
        OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
        OR NEW.current_state IS NOT DISTINCT FROM OLD.current_state
        OR NOT EXISTS (
          SELECT 1
          FROM yield_operation_transition_events AS event_state
          WHERE event_state.operation_id = OLD.operation_id
            AND event_state.actor_account_id = OLD.actor_account_id
            AND event_state.previous_state = OLD.current_state
            AND event_state.next_state = NEW.current_state
        )
      THEN
        RAISE EXCEPTION 'yield operation identity and unproven state are immutable'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION validate_yield_operation_command_completion()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $function$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM yield_operation_command_results AS result_state
        WHERE result_state.command_id = NEW.command_id
      ) THEN
        RAISE EXCEPTION 'yield operation command must complete in its claim transaction'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.outbox_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM yield_operation_submissions AS submission_state
        INNER JOIN job_outbox AS outbox_state
          ON outbox_state.id = submission_state.outbox_id
        WHERE submission_state.command_id = NEW.command_id
          AND submission_state.outbox_id = NEW.outbox_id
      ) THEN
        RAISE EXCEPTION 'yield submission command must atomically enqueue one outbox job'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION claim_yield_operation_command(
      requested_actor_account_id uuid,
      requested_command_kind text,
      requested_contract_version smallint,
      requested_key_digest_hex text,
      requested_fingerprint_version smallint,
      requested_request_fingerprint_hex text,
      requested_requires_outbox boolean
    ) RETURNS TABLE (
      claimed_command_id uuid,
      claimed_outbox_id text,
      claim_outcome text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      inserted_command_id uuid;
      inserted_outbox_id text;
      existing_command_id uuid;
      existing_outbox_id text;
      existing_fingerprint_version smallint;
      existing_request_fingerprint bytea;
      decoded_key_digest bytea;
      decoded_request_fingerprint bytea;
    BEGIN
      IF requested_actor_account_id IS NULL
        OR requested_command_kind NOT IN ('CREATE', 'TRANSITION')
        OR requested_contract_version IS DISTINCT FROM 1
        OR requested_key_digest_hex IS NULL
        OR requested_key_digest_hex !~ '^[0-9a-f]{64}$'
        OR requested_fingerprint_version IS DISTINCT FROM 1
        OR requested_request_fingerprint_hex IS NULL
        OR requested_request_fingerprint_hex !~ '^[0-9a-f]{64}$'
        OR requested_requires_outbox IS NULL
      THEN
        RAISE EXCEPTION 'invalid yield operation idempotency context'
          USING ERRCODE = '22023';
      END IF;

      decoded_key_digest := decode(requested_key_digest_hex, 'hex');
      decoded_request_fingerprint := decode(requested_request_fingerprint_hex, 'hex');

      INSERT INTO yield_operation_commands AS command_state (
        actor_account_id,
        command_kind,
        contract_version,
        key_digest,
        fingerprint_version,
        request_fingerprint,
        outbox_id
      ) VALUES (
        requested_actor_account_id,
        requested_command_kind,
        requested_contract_version,
        decoded_key_digest,
        requested_fingerprint_version,
        decoded_request_fingerprint,
        CASE WHEN requested_requires_outbox THEN gen_random_uuid()::text ELSE NULL END
      )
      ON CONFLICT (actor_account_id, command_kind, contract_version, key_digest)
        DO NOTHING
      RETURNING command_state.command_id, command_state.outbox_id
      INTO inserted_command_id, inserted_outbox_id;

      IF inserted_command_id IS NOT NULL THEN
        RETURN QUERY SELECT inserted_command_id, inserted_outbox_id, 'CLAIMED'::text;
        RETURN;
      END IF;

      SELECT
        command_state.command_id,
        command_state.outbox_id,
        command_state.fingerprint_version,
        command_state.request_fingerprint
      INTO
        existing_command_id,
        existing_outbox_id,
        existing_fingerprint_version,
        existing_request_fingerprint
      FROM yield_operation_commands AS command_state
      WHERE command_state.actor_account_id = requested_actor_account_id
        AND command_state.command_kind = requested_command_kind
        AND command_state.contract_version = requested_contract_version
        AND command_state.key_digest = decoded_key_digest
      FOR UPDATE;

      IF existing_command_id IS NULL
        OR (existing_outbox_id IS NOT NULL) IS DISTINCT FROM requested_requires_outbox
      THEN
        RAISE EXCEPTION 'yield operation command claim is unavailable'
          USING ERRCODE = '55000';
      END IF;
      IF existing_fingerprint_version IS DISTINCT FROM requested_fingerprint_version
        OR existing_request_fingerprint IS DISTINCT FROM decoded_request_fingerprint
      THEN
        RAISE EXCEPTION 'yield operation idempotency conflict'
          USING ERRCODE = 'Y8601';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM yield_operation_command_results AS result_state
        WHERE result_state.command_id = existing_command_id
      ) THEN
        RAISE EXCEPTION 'yield operation command result is unavailable'
          USING ERRCODE = '55000';
      END IF;

      RETURN QUERY SELECT existing_command_id, existing_outbox_id, 'REPLAYED'::text;
    END;
    $function$;

    CREATE FUNCTION yield_operation_command_result(
      requested_command_id uuid,
      requested_outcome text
    ) RETURNS TABLE (${yieldOperationResultColumns()})
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    PARALLEL SAFE
    AS $function$
      SELECT
        command_state.command_id,
        operation_state.operation_id,
        operation_state.operation_type,
        transition_state.next_state AS current_state,
        operation_state.ledger_transaction_id,
        operation_state.plan_reference_id,
        operation_state.quote_reference_id,
        operation_state.recorded_at AS operation_recorded_at,
        transition_state.transition_event_id,
        transition_state.actor_account_id,
        transition_state.previous_state,
        transition_state.next_state,
        transition_state.reason_code,
        transition_state.effective_at,
        transition_state.recorded_at AS transition_recorded_at,
        transition_state.correlation_id,
        transition_state.ledger_journal_id,
        submission_state.submission_id,
        requested_outcome AS outcome
      FROM yield_operation_commands AS command_state
      INNER JOIN yield_operation_command_results AS result_state
        ON result_state.command_id = command_state.command_id
      INNER JOIN yield_operations AS operation_state
        ON operation_state.operation_id = result_state.operation_id
      INNER JOIN yield_operation_transition_events AS transition_state
        ON transition_state.transition_event_id = result_state.transition_event_id
      LEFT JOIN yield_operation_submissions AS submission_state
        ON submission_state.command_id = command_state.command_id
      WHERE command_state.command_id = requested_command_id
        AND requested_outcome IN ('COMMITTED', 'REPLAYED');
    $function$;
  `;
}

function createYieldOperationBoundaryFunctionsSql(): string {
  return `
    CREATE FUNCTION create_yield_operation(
      requested_actor_account_id uuid,
      requested_operation_id uuid,
      requested_operation_type text,
      requested_ledger_transaction_id uuid,
      requested_plan_reference_id uuid,
      requested_quote_reference_id uuid,
      requested_effective_at timestamptz,
      requested_correlation_id uuid,
      requested_contract_version smallint,
      requested_key_digest_hex text,
      requested_fingerprint_version smallint,
      requested_request_fingerprint_hex text
    ) RETURNS TABLE (${yieldOperationResultColumns()})
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      claimed_command_id uuid;
      claimed_outbox_id text;
      claim_outcome text;
      target_book_id uuid;
      generated_event_id uuid;
      generated_event_sequence bigint;
      generated_recorded_at timestamptz;
      operation_recorded_at timestamptz;
    BEGIN
      IF requested_actor_account_id IS NULL
        OR requested_operation_id IS NULL
        OR requested_operation_type NOT IN ('ALLOCATE', 'WITHDRAW', 'REBALANCE')
        OR requested_ledger_transaction_id IS NULL
        OR requested_plan_reference_id IS NULL
        OR requested_quote_reference_id IS NULL
        OR requested_effective_at IS NULL
        OR NOT isfinite(requested_effective_at)
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid yield operation create command'
          USING ERRCODE = '22023';
      END IF;

      SELECT claim.claimed_command_id, claim.claimed_outbox_id, claim.claim_outcome
      INTO claimed_command_id, claimed_outbox_id, claim_outcome
      FROM claim_yield_operation_command(
        requested_actor_account_id,
        'CREATE',
        requested_contract_version,
        requested_key_digest_hex,
        requested_fingerprint_version,
        requested_request_fingerprint_hex,
        false
      ) AS claim;

      IF claim_outcome = 'REPLAYED' THEN
        RETURN QUERY
          SELECT * FROM yield_operation_command_result(claimed_command_id, 'REPLAYED');
        RETURN;
      END IF;

      SELECT transaction_state.book_id
      INTO target_book_id
      FROM ledger_transactions AS transaction_state
      WHERE transaction_state.transaction_id = requested_ledger_transaction_id
        AND transaction_state.tenant_account_id = requested_actor_account_id
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'yield operation ledger transaction is not authorized'
          USING ERRCODE = '42501';
      END IF;

      operation_recorded_at := clock_timestamp();
      INSERT INTO yield_operations (
        operation_id,
        actor_account_id,
        operation_type,
        current_state,
        ledger_transaction_id,
        ledger_book_id,
        plan_reference_id,
        quote_reference_id,
        recorded_at
      ) VALUES (
        requested_operation_id,
        requested_actor_account_id,
        requested_operation_type,
        'CREATED',
        requested_ledger_transaction_id,
        target_book_id,
        requested_plan_reference_id,
        requested_quote_reference_id,
        operation_recorded_at
      );

      generated_event_id := transition_ledger_transaction_state(
        requested_actor_account_id,
        requested_ledger_transaction_id,
        NULL,
        'CREATED',
        'INTENT_CREATED',
        requested_effective_at,
        requested_correlation_id
      );
      SELECT event_state.event_sequence, event_state.recorded_at
      INTO generated_event_sequence, generated_recorded_at
      FROM ledger_transaction_lifecycle_events AS event_state
      WHERE event_state.lifecycle_event_id = generated_event_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'yield operation ledger event was not recorded'
          USING ERRCODE = '55000';
      END IF;

      INSERT INTO yield_operation_transition_events (
        transition_event_id,
        operation_id,
        actor_account_id,
        event_sequence,
        previous_state,
        next_state,
        reason_code,
        effective_at,
        recorded_at,
        correlation_id,
        ledger_transaction_id,
        ledger_book_id,
        ledger_journal_id
      ) VALUES (
        generated_event_id,
        requested_operation_id,
        requested_actor_account_id,
        generated_event_sequence,
        NULL,
        'CREATED',
        'INTENT_CREATED',
        requested_effective_at,
        generated_recorded_at,
        requested_correlation_id,
        requested_ledger_transaction_id,
        target_book_id,
        NULL
      );
      INSERT INTO yield_operation_command_results (
        command_id, operation_id, transition_event_id
      ) VALUES (
        claimed_command_id, requested_operation_id, generated_event_id
      );

      RETURN QUERY
        SELECT * FROM yield_operation_command_result(claimed_command_id, 'COMMITTED');
    END;
    $function$;

    CREATE FUNCTION transition_yield_operation(
      requested_actor_account_id uuid,
      requested_operation_id uuid,
      requested_expected_state text,
      requested_next_state text,
      requested_reason_code text,
      requested_effective_at timestamptz,
      requested_ledger_journal_id uuid,
      requested_correlation_id uuid,
      requested_contract_version smallint,
      requested_key_digest_hex text,
      requested_fingerprint_version smallint,
      requested_request_fingerprint_hex text
    ) RETURNS TABLE (${yieldOperationResultColumns()})
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      claimed_command_id uuid;
      claimed_outbox_id text;
      claim_outcome text;
      operation_state yield_operations%ROWTYPE;
      generated_event_id uuid;
      generated_event_sequence bigint;
      generated_recorded_at timestamptz;
    BEGIN
      IF requested_actor_account_id IS NULL
        OR requested_operation_id IS NULL
        OR requested_expected_state IS NULL
        OR requested_next_state IS NULL
        OR requested_reason_code IS NULL
        OR requested_effective_at IS NULL
        OR NOT isfinite(requested_effective_at)
        OR requested_correlation_id IS NULL
        OR (requested_ledger_journal_id IS NOT NULL)
          IS DISTINCT FROM (requested_next_state IN ('SETTLED', 'REVERSED'))
      THEN
        RAISE EXCEPTION 'invalid yield operation transition command'
          USING ERRCODE = '22023';
      END IF;

      SELECT claim.claimed_command_id, claim.claimed_outbox_id, claim.claim_outcome
      INTO claimed_command_id, claimed_outbox_id, claim_outcome
      FROM claim_yield_operation_command(
        requested_actor_account_id,
        'TRANSITION',
        requested_contract_version,
        requested_key_digest_hex,
        requested_fingerprint_version,
        requested_request_fingerprint_hex,
        requested_next_state = 'SUBMITTED'
      ) AS claim;

      IF claim_outcome = 'REPLAYED' THEN
        RETURN QUERY
          SELECT * FROM yield_operation_command_result(claimed_command_id, 'REPLAYED');
        RETURN;
      END IF;

      SELECT operation_row.*
      INTO operation_state
      FROM yield_operations AS operation_row
      WHERE operation_row.operation_id = requested_operation_id
        AND operation_row.actor_account_id = requested_actor_account_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'yield operation transition is not authorized'
          USING ERRCODE = '42501';
      END IF;
      IF operation_state.current_state IS DISTINCT FROM requested_expected_state THEN
        RAISE EXCEPTION 'illegal ledger lifecycle transition'
          USING ERRCODE = 'L4201';
      END IF;

      IF requested_ledger_journal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM ledger_journals AS journal_state
        WHERE journal_state.journal_id = requested_ledger_journal_id
          AND journal_state.transaction_id = operation_state.ledger_transaction_id
          AND journal_state.book_id = operation_state.ledger_book_id
          AND journal_state.actor_account_id = operation_state.actor_account_id
      ) THEN
        RAISE EXCEPTION 'yield operation journal reference is not authorized'
          USING ERRCODE = '42501';
      END IF;

      generated_event_id := transition_ledger_transaction_state(
        requested_actor_account_id,
        operation_state.ledger_transaction_id,
        requested_expected_state,
        requested_next_state,
        requested_reason_code,
        requested_effective_at,
        requested_correlation_id
      );
      SELECT event_state.event_sequence, event_state.recorded_at
      INTO generated_event_sequence, generated_recorded_at
      FROM ledger_transaction_lifecycle_events AS event_state
      WHERE event_state.lifecycle_event_id = generated_event_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'yield operation ledger event was not recorded'
          USING ERRCODE = '55000';
      END IF;

      INSERT INTO yield_operation_transition_events (
        transition_event_id,
        operation_id,
        actor_account_id,
        event_sequence,
        previous_state,
        next_state,
        reason_code,
        effective_at,
        recorded_at,
        correlation_id,
        ledger_transaction_id,
        ledger_book_id,
        ledger_journal_id
      ) VALUES (
        generated_event_id,
        operation_state.operation_id,
        operation_state.actor_account_id,
        generated_event_sequence,
        requested_expected_state,
        requested_next_state,
        requested_reason_code,
        requested_effective_at,
        generated_recorded_at,
        requested_correlation_id,
        operation_state.ledger_transaction_id,
        operation_state.ledger_book_id,
        requested_ledger_journal_id
      );

      UPDATE yield_operations AS operation_row
      SET current_state = requested_next_state
      WHERE operation_row.operation_id = operation_state.operation_id;

      IF requested_next_state = 'SUBMITTED' THEN
        INSERT INTO yield_operation_submissions (
          submission_id,
          operation_id,
          command_id,
          outbox_id,
          submission_target,
          requested_at
        ) VALUES (
          claimed_outbox_id::uuid,
          operation_state.operation_id,
          claimed_command_id,
          claimed_outbox_id,
          'PROVIDER_OR_CHAIN_ADAPTER',
          generated_recorded_at
        );
      END IF;

      INSERT INTO yield_operation_command_results (
        command_id, operation_id, transition_event_id
      ) VALUES (
        claimed_command_id, operation_state.operation_id, generated_event_id
      );

      RETURN QUERY
        SELECT * FROM yield_operation_command_result(claimed_command_id, 'COMMITTED');
    END;
    $function$;
  `;
}

function createYieldOperationTriggersAndAclSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const tableList = YIELD_OPERATION_TABLES.join(', ');
  const functionIdentities = YIELD_OPERATION_FUNCTION_IDENTITIES.map(
    (identityValue) => `'${identityValue}'`,
  ).join(',\n        ');
  const revokeFunctions = YIELD_OPERATION_FUNCTION_IDENTITIES.map(
    (identityValue) =>
      `REVOKE ALL ON FUNCTION ${identityValue} FROM PUBLIC, ${api}, ${worker}, ${legacy};`,
  ).join('\n    ');
  const grantApiFunctions = YIELD_OPERATION_API_FUNCTION_IDENTITIES.map(
    (identityValue) => `GRANT EXECUTE ON FUNCTION ${identityValue} TO ${api};`,
  ).join('\n    ');

  return `
    CREATE TRIGGER yield_operation_identity_immutable
      BEFORE UPDATE ON yield_operations
      FOR EACH ROW EXECUTE FUNCTION enforce_yield_operation_identity_immutability();

    CREATE TRIGGER yield_operation_transition_append_only_row
      BEFORE UPDATE OR DELETE ON yield_operation_transition_events
      FOR EACH ROW EXECUTE FUNCTION reject_yield_operation_audit_mutation();
    CREATE TRIGGER yield_operation_transition_append_only_truncate
      BEFORE TRUNCATE ON yield_operation_transition_events
      FOR EACH STATEMENT EXECUTE FUNCTION reject_yield_operation_audit_mutation();
    CREATE TRIGGER yield_operation_commands_append_only_row
      BEFORE UPDATE OR DELETE ON yield_operation_commands
      FOR EACH ROW EXECUTE FUNCTION reject_yield_operation_audit_mutation();
    CREATE TRIGGER yield_operation_commands_append_only_truncate
      BEFORE TRUNCATE ON yield_operation_commands
      FOR EACH STATEMENT EXECUTE FUNCTION reject_yield_operation_audit_mutation();
    CREATE TRIGGER yield_operation_results_append_only_row
      BEFORE UPDATE OR DELETE ON yield_operation_command_results
      FOR EACH ROW EXECUTE FUNCTION reject_yield_operation_audit_mutation();
    CREATE TRIGGER yield_operation_results_append_only_truncate
      BEFORE TRUNCATE ON yield_operation_command_results
      FOR EACH STATEMENT EXECUTE FUNCTION reject_yield_operation_audit_mutation();
    CREATE TRIGGER yield_operation_submissions_append_only_row
      BEFORE UPDATE OR DELETE ON yield_operation_submissions
      FOR EACH ROW EXECUTE FUNCTION reject_yield_operation_audit_mutation();
    CREATE TRIGGER yield_operation_submissions_append_only_truncate
      BEFORE TRUNCATE ON yield_operation_submissions
      FOR EACH STATEMENT EXECUTE FUNCTION reject_yield_operation_audit_mutation();

    CREATE CONSTRAINT TRIGGER yield_operation_command_complete_insert
      AFTER INSERT ON yield_operation_commands
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_yield_operation_command_completion();

    ALTER TABLE yield_operations
      ENABLE ALWAYS TRIGGER yield_operation_identity_immutable;
    ALTER TABLE yield_operation_transition_events
      ENABLE ALWAYS TRIGGER yield_operation_transition_append_only_row;
    ALTER TABLE yield_operation_transition_events
      ENABLE ALWAYS TRIGGER yield_operation_transition_append_only_truncate;
    ALTER TABLE yield_operation_commands
      ENABLE ALWAYS TRIGGER yield_operation_commands_append_only_row;
    ALTER TABLE yield_operation_commands
      ENABLE ALWAYS TRIGGER yield_operation_commands_append_only_truncate;
    ALTER TABLE yield_operation_command_results
      ENABLE ALWAYS TRIGGER yield_operation_results_append_only_row;
    ALTER TABLE yield_operation_command_results
      ENABLE ALWAYS TRIGGER yield_operation_results_append_only_truncate;
    ALTER TABLE yield_operation_submissions
      ENABLE ALWAYS TRIGGER yield_operation_submissions_append_only_row;
    ALTER TABLE yield_operation_submissions
      ENABLE ALWAYS TRIGGER yield_operation_submissions_append_only_truncate;
    ALTER TABLE yield_operation_commands
      ENABLE ALWAYS TRIGGER yield_operation_command_complete_insert;

    DO $set_yield_operation_function_paths$
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
    $set_yield_operation_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${tableList}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    ${revokeFunctions}

    ${grantApiFunctions}
  `;
}

function createYieldOperationDownSql(names: DatabasePrincipalNames): readonly string[] {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  return [
    `DO $refuse_populated_yield_operation_rollback$
     BEGIN
       IF EXISTS (SELECT 1 FROM yield_operations)
         OR EXISTS (SELECT 1 FROM yield_operation_transition_events)
         OR EXISTS (SELECT 1 FROM yield_operation_commands)
         OR EXISTS (SELECT 1 FROM yield_operation_command_results)
         OR EXISTS (SELECT 1 FROM yield_operation_submissions)
       THEN
         RAISE EXCEPTION 'cannot roll back retained yield operation audit state'
           USING ERRCODE = '55000';
       END IF;
     END;
     $refuse_populated_yield_operation_rollback$;`,
    `REVOKE EXECUTE ON FUNCTION ${YIELD_OPERATION_API_FUNCTION_IDENTITIES[1]} FROM ${api}`,
    `REVOKE EXECUTE ON FUNCTION ${YIELD_OPERATION_API_FUNCTION_IDENTITIES[0]} FROM ${api}`,
    `DROP FUNCTION ${YIELD_OPERATION_FUNCTION_IDENTITIES[6]}`,
    `DROP FUNCTION ${YIELD_OPERATION_FUNCTION_IDENTITIES[5]}`,
    `DROP FUNCTION ${YIELD_OPERATION_FUNCTION_IDENTITIES[4]}`,
    `DROP FUNCTION ${YIELD_OPERATION_FUNCTION_IDENTITIES[3]}`,
    'DROP TABLE yield_operation_submissions',
    'DROP TABLE yield_operation_command_results',
    'DROP TABLE yield_operation_commands',
    'DROP TABLE yield_operation_transition_events',
    'DROP TABLE yield_operations',
    `DROP FUNCTION ${YIELD_OPERATION_FUNCTION_IDENTITIES[2]}`,
    `DROP FUNCTION ${YIELD_OPERATION_FUNCTION_IDENTITIES[1]}`,
    `DROP FUNCTION ${YIELD_OPERATION_FUNCTION_IDENTITIES[0]}`,
  ];
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0011 yield verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function extendPriorLedgerCatalogForYieldOperations(priorVerifier: string): string {
  // The three yield-to-ledger foreign keys are deliberately included in the
  // cumulative ledger catalog. Each FK adds one touching constraint and four
  // PostgreSQL-owned enforcement triggers across the child and parent tables.
  const ledgerCatalogReplacements = [
    [
      'SELECT object_count = 395 FROM constraint_catalog',
      'SELECT object_count = 398 FROM constraint_catalog',
    ],
    [
      'f1dc6b99d451f1c03312b892837a733a5776f7b0ee9b9a1bcd0db0ce787a417e',
      '9c7de8437cd535aaedab9697db5b684b01fc0a8a65ecf000e1c76064608be2b5',
    ],
    [
      'SELECT object_count = 348 FROM internal_fk_trigger_catalog',
      'SELECT object_count = 360 FROM internal_fk_trigger_catalog',
    ],
    [
      'a02223eacacc746c393c044217ba644764e0041446644270fcd9f02c12de8146',
      'f5f2a36b42302d1e4b2997b751a90083878ce19478d92fbeebe5cf78d71a3c19',
    ],
  ] as const;
  let verifier = priorVerifier;
  for (const [oldValue, newValue] of ledgerCatalogReplacements) {
    verifier = replaceExactlyOnce(verifier, oldValue, newValue);
  }
  return verifier;
}

function extendPriorVerifierForYieldOperations(
  names: DatabasePrincipalNames,
  priorVerifier: string,
): string {
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const walletAllowance = `            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                ${WALLET_REGISTRATION_API_FUNCTION_IDENTITIES.map(
                  (identityValue) => `to_regprocedure('${identityValue}')`,
                ).join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const yieldAllowance = `${walletAllowance}
            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                ${YIELD_OPERATION_API_FUNCTION_IDENTITIES.map(
                  (identityValue) => `to_regprocedure('${identityValue}')`,
                ).join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const tableLiterals = YIELD_OPERATION_TABLES.map((table) => `'${table}'`).join(', ');
  const loginTypePrivilegeAnchor =
    "              AND pg_catalog.has_type_privilege(login_role.oid, type_object.oid, 'USAGE')";
  const auditedTypePrivilegeAnchor =
    "        AND pg_catalog.has_type_privilege(audited_role.oid, type_object.oid, 'USAGE')";
  const loginTypePrivilegeReplacement = `              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class AS yield_operation_row_table
                WHERE yield_operation_row_table.oid = type_object.typrelid
                  AND yield_operation_row_table.relnamespace =
                    pg_catalog.to_regnamespace(pg_catalog.current_schema())
                  AND yield_operation_row_table.relkind = 'r'
                  AND yield_operation_row_table.relname IN (${tableLiterals})
              )
${loginTypePrivilegeAnchor}`;
  const auditedTypePrivilegeReplacement = `        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS yield_operation_row_table
          WHERE yield_operation_row_table.oid = type_object.typrelid
            AND yield_operation_row_table.relnamespace =
              pg_catalog.to_regnamespace(pg_catalog.current_schema())
            AND yield_operation_row_table.relkind = 'r'
            AND yield_operation_row_table.relname IN (${tableLiterals})
        )
${auditedTypePrivilegeAnchor}`;

  let verifier = replaceExactlyOnce(priorVerifier, walletAllowance, yieldAllowance);
  verifier = replaceExactlyOnce(verifier, loginTypePrivilegeAnchor, loginTypePrivilegeReplacement);
  verifier = replaceExactlyOnce(
    verifier,
    auditedTypePrivilegeAnchor,
    auditedTypePrivilegeReplacement,
  );

  // The three yield-to-ledger foreign keys are deliberately included in the
  // cumulative ledger catalog. Each FK adds one touching constraint and four
  // PostgreSQL-owned enforcement triggers across the child and parent tables.
  const ledgerCatalogReplacements = [
    [
      'SELECT object_count = 395 FROM constraint_catalog',
      'SELECT object_count = 398 FROM constraint_catalog',
    ],
    [
      'f1dc6b99d451f1c03312b892837a733a5776f7b0ee9b9a1bcd0db0ce787a417e',
      '9c7de8437cd535aaedab9697db5b684b01fc0a8a65ecf000e1c76064608be2b5',
    ],
    [
      'SELECT object_count = 348 FROM internal_fk_trigger_catalog',
      'SELECT object_count = 360 FROM internal_fk_trigger_catalog',
    ],
    [
      'a02223eacacc746c393c044217ba644764e0041446644270fcd9f02c12de8146',
      'f5f2a36b42302d1e4b2997b751a90083878ce19478d92fbeebe5cf78d71a3c19',
    ],
  ] as const;
  for (const [oldValue, newValue] of ledgerCatalogReplacements) {
    verifier = replaceExactlyOnce(verifier, oldValue, newValue);
  }

  return verifier;
}

function createYieldOperationVerifierSql(
  names: DatabasePrincipalNames,
  cumulativePrincipalVerification: boolean,
): string {
  const priorMigration = createWalletOwnershipRegistrationMigration(names, {
    cumulativePrincipalVerification,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0011 must expose verification SQL');
  const priorVerifier = cumulativePrincipalVerification
    ? extendPriorVerifierForYieldOperations(names, priorMigration.verifySql)
    : extendPriorLedgerCatalogForYieldOperations(priorMigration.verifySql);
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const tableLiterals = YIELD_OPERATION_TABLES.map((table) => `'${table}'`).join(', ');
  const allFunctionRegprocedures = YIELD_OPERATION_FUNCTION_IDENTITIES.map(
    (identityValue) => `to_regprocedure('${identityValue}')`,
  ).join(',\n        ');
  const apiFunctionRegprocedures = YIELD_OPERATION_API_FUNCTION_IDENTITIES.map(
    (identityValue) => `to_regprocedure('${identityValue}')`,
  ).join(',\n          ');
  const ownerVerification = cumulativePrincipalVerification
    ? `AND table_owner.rolname = ${owner}`
    : '';
  const functionOwnerVerification = cumulativePrincipalVerification
    ? `AND function_owner.rolname = ${owner}`
    : '';

  const yieldVerifier = `WITH yield_tables AS MATERIALIZED (
    SELECT table_state.*
    FROM pg_catalog.pg_class AS table_state
    WHERE table_state.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
      AND table_state.relkind = 'r'
      AND table_state.relname IN (${tableLiterals})
  ),
  yield_functions AS MATERIALIZED (
    SELECT procedure.*
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
      AND procedure.oid IN (
        ${allFunctionRegprocedures}
      )
  )
  SELECT (
    (SELECT pg_catalog.count(*) = ${YIELD_OPERATION_TABLES.length} FROM yield_tables)
    AND (SELECT pg_catalog.count(*) = ${YIELD_OPERATION_TABLES.length}
      FROM yield_tables AS table_state
      INNER JOIN pg_catalog.pg_roles AS table_owner ON table_owner.oid = table_state.relowner
      WHERE true ${ownerVerification})
    AND (SELECT pg_catalog.count(*) = ${YIELD_OPERATION_FUNCTION_IDENTITIES.length}
      FROM yield_functions)
    AND (SELECT pg_catalog.count(*) = ${YIELD_OPERATION_FUNCTION_IDENTITIES.length}
      FROM yield_functions AS function_state
      INNER JOIN pg_catalog.pg_roles AS function_owner
        ON function_owner.oid = function_state.proowner
      WHERE true ${functionOwnerVerification})
    AND NOT EXISTS (
      SELECT expected.oid
      FROM pg_catalog.unnest(ARRAY[
        ${allFunctionRegprocedures}
      ]::oid[]) AS expected(oid)
      WHERE expected.oid IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM yield_tables AS table_state
      CROSS JOIN pg_catalog.pg_roles AS runtime_role
      WHERE runtime_role.rolname IN (${api}, ${worker}, ${legacy})
        AND pg_catalog.has_table_privilege(
          runtime_role.oid,
          table_state.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM yield_tables AS table_state
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(table_state.relacl, pg_catalog.acldefault('r', table_state.relowner))
      ) AS acl
      WHERE acl.grantee <> table_state.relowner
    )
    AND (SELECT pg_catalog.count(*) = 10
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid IN (
          SELECT table_state.oid FROM yield_tables AS table_state
        )
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgenabled = 'A')
    AND NOT EXISTS (
      SELECT expected.constraint_name
      FROM pg_catalog.unnest(ARRAY[
        'yield_operations_ledger_scope_fk',
        'yield_operations_ledger_transaction_unique',
        'yield_transition_event_ledger_event_fk',
        'yield_transition_event_initial_shape_check',
        'yield_transition_event_journal_shape_check',
        'yield_operation_commands_scope_unique',
        'yield_operation_command_results_event_unique',
        'yield_operation_submissions_operation_unique'
      ]::text[]) AS expected(constraint_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.connamespace =
            pg_catalog.to_regnamespace(pg_catalog.current_schema())
          AND constraint_state.conname = expected.constraint_name
          AND constraint_state.convalidated
      )
    )
    AND NOT EXISTS (
      -- Outbox rows have bounded operational retention. Yield audit records
      -- keep the immutable ID after cleanup, so reverse FKs are prohibited.
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.contype = 'f'
        AND constraint_state.conrelid IN (
          SELECT table_state.oid FROM yield_tables AS table_state
        )
        AND constraint_state.confrelid = pg_catalog.to_regclass(
          pg_catalog.format(
            '%I.%I', pg_catalog.current_schema(), 'job_outbox'
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM yield_functions AS function_state
      WHERE NOT function_state.prosecdef
        OR function_state.proconfig IS DISTINCT FROM ARRAY[
          'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
        ]::text[]
    )
    AND NOT EXISTS (
      SELECT 1
      FROM yield_functions AS function_state
      WHERE function_state.oid IN (
          ${apiFunctionRegprocedures}
        )
        AND (
          NOT function_state.prosecdef
          OR function_state.provolatile <> 'v'
          OR function_state.proparallel <> 'u'
          OR function_state.proconfig IS DISTINCT FROM ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          OR NOT pg_catalog.has_function_privilege(${api}, function_state.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege(${worker}, function_state.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege(${legacy}, function_state.oid, 'EXECUTE')
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM yield_functions AS function_state
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(function_state.proacl, pg_catalog.acldefault('f', function_state.proowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE acl.grantee <> function_state.proowner
        AND NOT (
          grantee.rolname = ${api}
          AND function_state.oid IN (
            ${apiFunctionRegprocedures}
          )
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
        )
    )
  ) AS valid`;

  return `SELECT (prior.valid AND yield_operation.valid) AS valid
    FROM (${priorVerifier}) AS prior
    CROSS JOIN (${yieldVerifier}) AS yield_operation`;
}

export function createYieldOperationControlsMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0012',
    description: 'create idempotent immutable yield operation controls',
    upSql: [
      createYieldOperationTablesSql(),
      createYieldOperationHelperFunctionsSql(),
      createYieldOperationBoundaryFunctionsSql(),
      createYieldOperationTriggersAndAclSql(names),
    ],
    downSql: createYieldOperationDownSql(names),
    verifySql: createYieldOperationVerifierSql(names, cumulativePrincipalVerification),
    supersedesVerificationOf: ['0011'],
  };
}

export const createYieldOperationControlsMigrationV0012 = createYieldOperationControlsMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createYieldOperationControlsTestSchemaMigrationV0012 =
  createYieldOperationControlsMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
