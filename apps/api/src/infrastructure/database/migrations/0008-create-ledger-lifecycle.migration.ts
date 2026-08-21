import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createImmutableLedgerMigration } from './0007-create-immutable-ledger.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

const IMMUTABLE_LEDGER_TABLES = [
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
] as const;

const LIFECYCLE_TABLES = [
  'ledger_lifecycle_transition_rules',
  'ledger_recovery_transition_rules',
  'ledger_transaction_lifecycle_events',
  'ledger_leg_lifecycle_events',
  'ledger_recovery_state_events',
] as const;

const LIFECYCLE_FUNCTION_IDENTITIES = [
  'validate_ledger_transaction_lifecycle_event()',
  'validate_ledger_leg_lifecycle_event()',
  'validate_ledger_recovery_state_event()',
  'record_ledger_lifecycle_event(uuid,uuid,uuid,text,text,text,timestamptz,uuid,uuid)',
  'transition_ledger_transaction_state(uuid,uuid,text,text,text,timestamptz,uuid)',
  'transition_ledger_leg_state(uuid,uuid,uuid,text,text,text,timestamptz,uuid)',
  'transition_ledger_recovery_state(uuid,uuid,uuid,text,text,text,timestamptz,uuid)',
  'post_ledger_journal_with_lifecycle(text,uuid,uuid,uuid,text,timestamptz,timestamptz,text,uuid,text)',
  'reverse_ledger_journal_with_lifecycle(text,uuid,text,timestamptz,timestamptz,uuid)',
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
    throw new Error('Migration 0007 verifier extension anchor must occur exactly once');
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
      `Migration 0007 verifier extension anchor expected ${expectedOccurrences} occurrences, found ${occurrences}`,
    );
  }
  return source.split(target).join(replacement);
}

function createLifecycleTablesSql(): string {
  return `
    CREATE TABLE ledger_lifecycle_transition_rules (
      scope_kind text NOT NULL,
      previous_state text NOT NULL,
      next_state text NOT NULL,
      reason_code text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_lifecycle_transition_rules_pkey PRIMARY KEY (
        scope_kind, previous_state, next_state, reason_code
      ),
      CONSTRAINT ledger_lifecycle_rules_scope_check CHECK (
        scope_kind IN ('TRANSACTION', 'LEG')
      ),
      CONSTRAINT ledger_lifecycle_rules_previous_state_check CHECK (
        previous_state IN (
          'NONE', 'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT ledger_lifecycle_rules_next_state_check CHECK (
        next_state IN (
          'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT ledger_lifecycle_rules_reason_check CHECK (
        reason_code IN (
          'INTENT_CREATED', 'QUOTE_CREATED', 'USER_APPROVAL_RECORDED',
          'SUBMISSION_RECORDED', 'OUTCOME_PENDING', 'SETTLEMENT_RECORDED',
          'PREFLIGHT_FAILED', 'USER_REJECTED', 'QUOTE_EXPIRED',
          'PROVIDER_REJECTED', 'TERMINAL_FAILURE_CONFIRMED',
          'FULL_REVERSAL_RECORDED'
        )
      ),
      CONSTRAINT ledger_lifecycle_rules_transition_check CHECK (
        (previous_state, next_state, reason_code) IN (
          ('NONE', 'CREATED', 'INTENT_CREATED'),
          ('CREATED', 'QUOTED', 'QUOTE_CREATED'),
          ('CREATED', 'FAILED', 'PREFLIGHT_FAILED'),
          ('QUOTED', 'USER_APPROVED', 'USER_APPROVAL_RECORDED'),
          ('QUOTED', 'FAILED', 'PREFLIGHT_FAILED'),
          ('QUOTED', 'FAILED', 'USER_REJECTED'),
          ('QUOTED', 'FAILED', 'QUOTE_EXPIRED'),
          ('USER_APPROVED', 'SUBMITTED', 'SUBMISSION_RECORDED'),
          ('USER_APPROVED', 'FAILED', 'PREFLIGHT_FAILED'),
          ('USER_APPROVED', 'FAILED', 'USER_REJECTED'),
          ('SUBMITTED', 'PENDING', 'OUTCOME_PENDING'),
          ('SUBMITTED', 'SETTLED', 'SETTLEMENT_RECORDED'),
          ('SUBMITTED', 'FAILED', 'PROVIDER_REJECTED'),
          ('PENDING', 'SETTLED', 'SETTLEMENT_RECORDED'),
          ('PENDING', 'FAILED', 'TERMINAL_FAILURE_CONFIRMED'),
          ('SETTLED', 'REVERSED', 'FULL_REVERSAL_RECORDED')
        )
      ),
      CONSTRAINT ledger_lifecycle_rules_distinct_state_check CHECK (
        previous_state = 'NONE' OR previous_state <> next_state
      ),
      CONSTRAINT ledger_lifecycle_rules_recorded_at_check CHECK (isfinite(recorded_at))
    );

    INSERT INTO ledger_lifecycle_transition_rules (
      scope_kind, previous_state, next_state, reason_code
    )
    SELECT scope.scope_kind, rule.previous_state, rule.next_state, rule.reason_code
    FROM (VALUES ('TRANSACTION'::text), ('LEG'::text)) AS scope(scope_kind)
    CROSS JOIN (VALUES
      ('NONE'::text, 'CREATED'::text, 'INTENT_CREATED'::text),
      ('CREATED', 'QUOTED', 'QUOTE_CREATED'),
      ('CREATED', 'FAILED', 'PREFLIGHT_FAILED'),
      ('QUOTED', 'USER_APPROVED', 'USER_APPROVAL_RECORDED'),
      ('QUOTED', 'FAILED', 'PREFLIGHT_FAILED'),
      ('QUOTED', 'FAILED', 'USER_REJECTED'),
      ('QUOTED', 'FAILED', 'QUOTE_EXPIRED'),
      ('USER_APPROVED', 'SUBMITTED', 'SUBMISSION_RECORDED'),
      ('USER_APPROVED', 'FAILED', 'PREFLIGHT_FAILED'),
      ('USER_APPROVED', 'FAILED', 'USER_REJECTED'),
      ('SUBMITTED', 'PENDING', 'OUTCOME_PENDING'),
      ('SUBMITTED', 'SETTLED', 'SETTLEMENT_RECORDED'),
      ('SUBMITTED', 'FAILED', 'PROVIDER_REJECTED'),
      ('PENDING', 'SETTLED', 'SETTLEMENT_RECORDED'),
      ('PENDING', 'FAILED', 'TERMINAL_FAILURE_CONFIRMED'),
      ('SETTLED', 'REVERSED', 'FULL_REVERSAL_RECORDED')
    ) AS rule(previous_state, next_state, reason_code);

    CREATE TABLE ledger_recovery_transition_rules (
      previous_state text NOT NULL,
      next_state text NOT NULL,
      reason_code text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_recovery_transition_rules_pkey PRIMARY KEY (
        previous_state, next_state, reason_code
      ),
      CONSTRAINT ledger_recovery_rules_previous_state_check CHECK (
        previous_state IN ('NOT_REQUIRED', 'REQUIRED', 'IN_PROGRESS')
      ),
      CONSTRAINT ledger_recovery_rules_next_state_check CHECK (
        next_state IN ('REQUIRED', 'IN_PROGRESS', 'RESOLVED')
      ),
      CONSTRAINT ledger_recovery_rules_reason_check CHECK (
        reason_code IN ('RECOVERY_REQUIRED', 'RECOVERY_STARTED', 'RECOVERY_RESOLVED')
      ),
      CONSTRAINT ledger_recovery_rules_transition_check CHECK (
        (previous_state, next_state, reason_code) IN (
          ('NOT_REQUIRED', 'REQUIRED', 'RECOVERY_REQUIRED'),
          ('REQUIRED', 'IN_PROGRESS', 'RECOVERY_STARTED'),
          ('REQUIRED', 'RESOLVED', 'RECOVERY_RESOLVED'),
          ('IN_PROGRESS', 'RESOLVED', 'RECOVERY_RESOLVED')
        )
      ),
      CONSTRAINT ledger_recovery_rules_distinct_state_check CHECK (
        previous_state <> next_state
      ),
      CONSTRAINT ledger_recovery_rules_recorded_at_check CHECK (isfinite(recorded_at))
    );

    INSERT INTO ledger_recovery_transition_rules (
      previous_state, next_state, reason_code
    ) VALUES
      ('NOT_REQUIRED', 'REQUIRED', 'RECOVERY_REQUIRED'),
      ('REQUIRED', 'IN_PROGRESS', 'RECOVERY_STARTED'),
      ('REQUIRED', 'RESOLVED', 'RECOVERY_RESOLVED'),
      ('IN_PROGRESS', 'RESOLVED', 'RECOVERY_RESOLVED');

    CREATE TABLE ledger_transaction_lifecycle_events (
      lifecycle_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      actor_account_id uuid NOT NULL,
      event_sequence bigint NOT NULL,
      previous_state text,
      next_state text NOT NULL,
      reason_code text NOT NULL,
      effective_at timestamptz NOT NULL,
      correlation_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT ledger_tx_lifecycle_event_id_uuid_v4_check CHECK (
        substring(lifecycle_event_id::text FROM 15 FOR 1) = '4'
        AND substring(lifecycle_event_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_tx_lifecycle_transaction_fk FOREIGN KEY (
        transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_transactions (transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_tx_lifecycle_sequence_check CHECK (event_sequence > 0),
      CONSTRAINT ledger_tx_lifecycle_previous_state_check CHECK (
        previous_state IS NULL OR previous_state IN (
          'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT ledger_tx_lifecycle_next_state_check CHECK (
        next_state IN (
          'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT ledger_tx_lifecycle_distinct_state_check CHECK (
        previous_state IS NULL OR previous_state <> next_state
      ),
      CONSTRAINT ledger_tx_lifecycle_reason_check CHECK (
        reason_code IN (
          'INTENT_CREATED', 'QUOTE_CREATED', 'USER_APPROVAL_RECORDED',
          'SUBMISSION_RECORDED', 'OUTCOME_PENDING', 'SETTLEMENT_RECORDED',
          'PREFLIGHT_FAILED', 'USER_REJECTED', 'QUOTE_EXPIRED',
          'PROVIDER_REJECTED', 'TERMINAL_FAILURE_CONFIRMED',
          'FULL_REVERSAL_RECORDED'
        )
      ),
      CONSTRAINT ledger_tx_lifecycle_effective_at_check CHECK (isfinite(effective_at)),
      CONSTRAINT ledger_tx_lifecycle_correlation_uuid_v4_check CHECK (
        substring(correlation_id::text FROM 15 FOR 1) = '4'
        AND substring(correlation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_tx_lifecycle_recorded_at_check CHECK (isfinite(recorded_at)),
      CONSTRAINT ledger_tx_lifecycle_sequence_unique UNIQUE (
        transaction_id, event_sequence
      )
    );

    CREATE INDEX ledger_tx_lifecycle_recorded_idx
      ON ledger_transaction_lifecycle_events (
        transaction_id, recorded_at, lifecycle_event_id
      );

    CREATE TABLE ledger_leg_lifecycle_events (
      lifecycle_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      book_id uuid NOT NULL,
      actor_account_id uuid NOT NULL,
      event_sequence bigint NOT NULL,
      previous_state text,
      next_state text NOT NULL,
      reason_code text NOT NULL,
      effective_at timestamptz NOT NULL,
      correlation_id uuid NOT NULL,
      journal_id uuid,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT ledger_leg_lifecycle_event_id_uuid_v4_check CHECK (
        substring(lifecycle_event_id::text FROM 15 FOR 1) = '4'
        AND substring(lifecycle_event_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_lifecycle_leg_fk FOREIGN KEY (
        leg_id, transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_legs (leg_id, transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_lifecycle_journal_fk FOREIGN KEY (
        journal_id, leg_id, transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_journals (
        journal_id, leg_id, transaction_id, book_id, actor_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_lifecycle_sequence_check CHECK (event_sequence > 0),
      CONSTRAINT ledger_leg_lifecycle_previous_state_check CHECK (
        previous_state IS NULL OR previous_state IN (
          'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT ledger_leg_lifecycle_next_state_check CHECK (
        next_state IN (
          'CREATED', 'QUOTED', 'USER_APPROVED', 'SUBMITTED',
          'PENDING', 'SETTLED', 'FAILED', 'REVERSED'
        )
      ),
      CONSTRAINT ledger_leg_lifecycle_distinct_state_check CHECK (
        previous_state IS NULL OR previous_state <> next_state
      ),
      CONSTRAINT ledger_leg_lifecycle_reason_check CHECK (
        reason_code IN (
          'INTENT_CREATED', 'QUOTE_CREATED', 'USER_APPROVAL_RECORDED',
          'SUBMISSION_RECORDED', 'OUTCOME_PENDING', 'SETTLEMENT_RECORDED',
          'PREFLIGHT_FAILED', 'USER_REJECTED', 'QUOTE_EXPIRED',
          'PROVIDER_REJECTED', 'TERMINAL_FAILURE_CONFIRMED',
          'FULL_REVERSAL_RECORDED'
        )
      ),
      CONSTRAINT ledger_leg_lifecycle_journal_shape_check CHECK (
        (journal_id IS NOT NULL) = (next_state IN ('SETTLED', 'REVERSED'))
      ),
      CONSTRAINT ledger_leg_lifecycle_effective_at_check CHECK (isfinite(effective_at)),
      CONSTRAINT ledger_leg_lifecycle_correlation_uuid_v4_check CHECK (
        substring(correlation_id::text FROM 15 FOR 1) = '4'
        AND substring(correlation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_lifecycle_recorded_at_check CHECK (isfinite(recorded_at)),
      CONSTRAINT ledger_leg_lifecycle_sequence_unique UNIQUE (leg_id, event_sequence),
      CONSTRAINT ledger_leg_lifecycle_journal_unique UNIQUE (journal_id)
    );

    CREATE INDEX ledger_leg_lifecycle_recorded_idx
      ON ledger_leg_lifecycle_events (leg_id, recorded_at, lifecycle_event_id);

    CREATE TABLE ledger_recovery_state_events (
      recovery_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id uuid NOT NULL,
      leg_id uuid,
      book_id uuid NOT NULL,
      actor_account_id uuid NOT NULL,
      event_sequence bigint NOT NULL,
      previous_state text NOT NULL,
      next_state text NOT NULL,
      reason_code text NOT NULL,
      effective_at timestamptz NOT NULL,
      correlation_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT ledger_recovery_event_id_uuid_v4_check CHECK (
        substring(recovery_event_id::text FROM 15 FOR 1) = '4'
        AND substring(recovery_event_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_recovery_transaction_fk FOREIGN KEY (
        transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_transactions (transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_recovery_leg_fk FOREIGN KEY (
        leg_id, transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_legs (leg_id, transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_recovery_sequence_check CHECK (event_sequence > 0),
      CONSTRAINT ledger_recovery_previous_state_check CHECK (
        previous_state IN ('NOT_REQUIRED', 'REQUIRED', 'IN_PROGRESS')
      ),
      CONSTRAINT ledger_recovery_next_state_check CHECK (
        next_state IN ('REQUIRED', 'IN_PROGRESS', 'RESOLVED')
      ),
      CONSTRAINT ledger_recovery_distinct_state_check CHECK (
        previous_state <> next_state
      ),
      CONSTRAINT ledger_recovery_reason_check CHECK (
        reason_code IN ('RECOVERY_REQUIRED', 'RECOVERY_STARTED', 'RECOVERY_RESOLVED')
      ),
      CONSTRAINT ledger_recovery_effective_at_check CHECK (isfinite(effective_at)),
      CONSTRAINT ledger_recovery_correlation_uuid_v4_check CHECK (
        substring(correlation_id::text FROM 15 FOR 1) = '4'
        AND substring(correlation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_recovery_recorded_at_check CHECK (isfinite(recorded_at)),
      CONSTRAINT ledger_recovery_sequence_unique UNIQUE NULLS NOT DISTINCT (
        transaction_id, leg_id, event_sequence
      )
    );

    CREATE INDEX ledger_recovery_recorded_idx
      ON ledger_recovery_state_events (
        transaction_id, leg_id, recorded_at, recovery_event_id
      );
  `;
}

function createLifecycleFunctionsSql(): string {
  return `
    CREATE FUNCTION validate_ledger_transaction_lifecycle_event()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      transaction_book_id uuid;
      transaction_actor_id uuid;
      current_state text;
      current_sequence bigint;
      recovery_state text;
    BEGIN
      SELECT transaction_state.book_id, transaction_state.tenant_account_id
        INTO transaction_book_id, transaction_actor_id
      FROM ledger_transactions AS transaction_state
      WHERE transaction_state.transaction_id = NEW.transaction_id
      FOR NO KEY UPDATE;

      IF NOT FOUND
        OR transaction_book_id <> NEW.book_id
        OR transaction_actor_id <> NEW.actor_account_id
      THEN
        RAISE EXCEPTION 'ledger lifecycle transition is not authorized'
          USING ERRCODE = '42501';
      END IF;

      SELECT event_state.next_state, event_state.event_sequence
        INTO current_state, current_sequence
      FROM ledger_transaction_lifecycle_events AS event_state
      WHERE event_state.transaction_id = NEW.transaction_id
      ORDER BY event_state.event_sequence DESC
      LIMIT 1;

      IF current_state IS DISTINCT FROM NEW.previous_state
        OR NOT EXISTS (
          SELECT 1
          FROM ledger_lifecycle_transition_rules AS rule_state
          WHERE rule_state.scope_kind = 'TRANSACTION'
            AND rule_state.previous_state = COALESCE(current_state, 'NONE')
            AND rule_state.next_state = NEW.next_state
            AND rule_state.reason_code = NEW.reason_code
        )
      THEN
        RAISE EXCEPTION 'illegal ledger lifecycle transition'
          USING ERRCODE = 'L4201';
      END IF;

      IF NEW.next_state = 'SETTLED' AND (
        NOT EXISTS (
          SELECT 1
          FROM ledger_legs AS leg_state
          WHERE leg_state.transaction_id = NEW.transaction_id
        )
        OR EXISTS (
          SELECT 1
          FROM ledger_legs AS leg_state
          LEFT JOIN LATERAL (
            SELECT lifecycle_state.next_state
            FROM ledger_leg_lifecycle_events AS lifecycle_state
            WHERE lifecycle_state.leg_id = leg_state.leg_id
            ORDER BY lifecycle_state.event_sequence DESC
            LIMIT 1
          ) AS latest_state ON true
          WHERE leg_state.transaction_id = NEW.transaction_id
            AND latest_state.next_state IS DISTINCT FROM 'SETTLED'
        )
      ) THEN
        RAISE EXCEPTION 'transaction cannot settle before all legs settle'
          USING ERRCODE = 'L4201';
      END IF;

      IF NEW.next_state = 'REVERSED' AND EXISTS (
        SELECT 1
        FROM ledger_legs AS leg_state
        LEFT JOIN LATERAL (
          SELECT lifecycle_state.next_state
          FROM ledger_leg_lifecycle_events AS lifecycle_state
          WHERE lifecycle_state.leg_id = leg_state.leg_id
          ORDER BY lifecycle_state.event_sequence DESC
          LIMIT 1
        ) AS latest_state ON true
        WHERE leg_state.transaction_id = NEW.transaction_id
          AND latest_state.next_state IS DISTINCT FROM 'REVERSED'
      ) THEN
        RAISE EXCEPTION 'transaction cannot reverse before all legs reverse'
          USING ERRCODE = 'L4201';
      END IF;

      IF NEW.next_state = 'FAILED'
        AND EXISTS (
          SELECT 1
          FROM ledger_journals AS journal_state
          WHERE journal_state.transaction_id = NEW.transaction_id
        )
      THEN
        SELECT recovery_state_event.next_state
          INTO recovery_state
        FROM ledger_recovery_state_events AS recovery_state_event
        WHERE recovery_state_event.transaction_id = NEW.transaction_id
          AND recovery_state_event.leg_id IS NULL
        ORDER BY recovery_state_event.event_sequence DESC
        LIMIT 1;
        IF COALESCE(recovery_state, 'NOT_REQUIRED') = 'NOT_REQUIRED' THEN
          RAISE EXCEPTION 'financial failure requires recovery visibility'
            USING ERRCODE = 'L4201';
        END IF;
      END IF;

      NEW.event_sequence := COALESCE(current_sequence, 0) + 1;
      NEW.previous_state := current_state;
      NEW.recorded_at := clock_timestamp();
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION validate_ledger_leg_lifecycle_event()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      leg_book_id uuid;
      leg_actor_id uuid;
      dependency_leg_id uuid;
      current_state text;
      current_sequence bigint;
      current_journal_id uuid;
      dependency_state text;
      recovery_state text;
      journal_event_type text;
      reversed_journal_id uuid;
    BEGIN
      PERFORM 1
      FROM ledger_transactions AS transaction_state
      WHERE transaction_state.transaction_id = NEW.transaction_id
        AND transaction_state.book_id = NEW.book_id
        AND transaction_state.tenant_account_id = NEW.actor_account_id
      FOR NO KEY UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger lifecycle transition is not authorized'
          USING ERRCODE = '42501';
      END IF;

      SELECT leg_state.book_id,
             leg_state.tenant_account_id,
             leg_state.depends_on_leg_id
        INTO leg_book_id, leg_actor_id, dependency_leg_id
      FROM ledger_legs AS leg_state
      WHERE leg_state.leg_id = NEW.leg_id
        AND leg_state.transaction_id = NEW.transaction_id
      FOR NO KEY UPDATE;

      IF NOT FOUND
        OR leg_book_id <> NEW.book_id
        OR leg_actor_id <> NEW.actor_account_id
      THEN
        RAISE EXCEPTION 'ledger lifecycle transition is not authorized'
          USING ERRCODE = '42501';
      END IF;

      SELECT event_state.next_state,
             event_state.event_sequence,
             event_state.journal_id
        INTO current_state, current_sequence, current_journal_id
      FROM ledger_leg_lifecycle_events AS event_state
      WHERE event_state.leg_id = NEW.leg_id
      ORDER BY event_state.event_sequence DESC
      LIMIT 1;

      IF current_state IS DISTINCT FROM NEW.previous_state
        OR NOT EXISTS (
          SELECT 1
          FROM ledger_lifecycle_transition_rules AS rule_state
          WHERE rule_state.scope_kind = 'LEG'
            AND rule_state.previous_state = COALESCE(current_state, 'NONE')
            AND rule_state.next_state = NEW.next_state
            AND rule_state.reason_code = NEW.reason_code
        )
      THEN
        RAISE EXCEPTION 'illegal ledger lifecycle transition'
          USING ERRCODE = 'L4201';
      END IF;

      IF NEW.next_state = 'SUBMITTED' AND dependency_leg_id IS NOT NULL THEN
        SELECT event_state.next_state
          INTO dependency_state
        FROM ledger_leg_lifecycle_events AS event_state
        WHERE event_state.leg_id = dependency_leg_id
        ORDER BY event_state.event_sequence DESC
        LIMIT 1;
        IF dependency_state IS DISTINCT FROM 'SETTLED' THEN
          RAISE EXCEPTION 'dependent leg is not settled'
            USING ERRCODE = 'L4201';
        END IF;
      END IF;

      IF NEW.next_state IN ('SETTLED', 'REVERSED') THEN
        SELECT journal_state.economic_event_type,
               journal_state.reverses_journal_id
          INTO journal_event_type, reversed_journal_id
        FROM ledger_journals AS journal_state
        WHERE journal_state.journal_id = NEW.journal_id
          AND journal_state.leg_id = NEW.leg_id
          AND journal_state.transaction_id = NEW.transaction_id
          AND journal_state.book_id = NEW.book_id
          AND journal_state.actor_account_id = NEW.actor_account_id;

        IF NOT FOUND
          OR (NEW.next_state = 'SETTLED' AND journal_event_type = 'REVERSAL')
          OR (
            NEW.next_state = 'REVERSED'
            AND (
              journal_event_type <> 'REVERSAL'
              OR reversed_journal_id IS DISTINCT FROM current_journal_id
            )
          )
        THEN
          RAISE EXCEPTION 'financial lifecycle transition requires its journal'
            USING ERRCODE = 'L4201';
        END IF;
      END IF;

      IF NEW.next_state = 'FAILED'
        AND EXISTS (
          SELECT 1
          FROM ledger_journals AS journal_state
          WHERE journal_state.leg_id = NEW.leg_id
        )
      THEN
        SELECT recovery_state_event.next_state
          INTO recovery_state
        FROM ledger_recovery_state_events AS recovery_state_event
        WHERE recovery_state_event.transaction_id = NEW.transaction_id
          AND recovery_state_event.leg_id = NEW.leg_id
        ORDER BY recovery_state_event.event_sequence DESC
        LIMIT 1;
        IF COALESCE(recovery_state, 'NOT_REQUIRED') = 'NOT_REQUIRED' THEN
          RAISE EXCEPTION 'financial failure requires recovery visibility'
            USING ERRCODE = 'L4201';
        END IF;
      END IF;

      NEW.event_sequence := COALESCE(current_sequence, 0) + 1;
      NEW.previous_state := current_state;
      NEW.recorded_at := clock_timestamp();
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION validate_ledger_recovery_state_event()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      target_book_id uuid;
      target_actor_id uuid;
      current_state text;
      current_sequence bigint;
    BEGIN
      SELECT transaction_state.book_id, transaction_state.tenant_account_id
        INTO target_book_id, target_actor_id
      FROM ledger_transactions AS transaction_state
      WHERE transaction_state.transaction_id = NEW.transaction_id
      FOR NO KEY UPDATE;

      IF NEW.leg_id IS NOT NULL AND FOUND THEN
        SELECT leg_state.book_id, leg_state.tenant_account_id
          INTO target_book_id, target_actor_id
        FROM ledger_legs AS leg_state
        WHERE leg_state.leg_id = NEW.leg_id
          AND leg_state.transaction_id = NEW.transaction_id
        FOR NO KEY UPDATE;
      END IF;

      IF NOT FOUND
        OR target_book_id <> NEW.book_id
        OR target_actor_id <> NEW.actor_account_id
      THEN
        RAISE EXCEPTION 'ledger recovery transition is not authorized'
          USING ERRCODE = '42501';
      END IF;

      SELECT event_state.next_state, event_state.event_sequence
        INTO current_state, current_sequence
      FROM ledger_recovery_state_events AS event_state
      WHERE event_state.transaction_id = NEW.transaction_id
        AND event_state.leg_id IS NOT DISTINCT FROM NEW.leg_id
      ORDER BY event_state.event_sequence DESC
      LIMIT 1;

      current_state := COALESCE(current_state, 'NOT_REQUIRED');
      IF current_state IS DISTINCT FROM NEW.previous_state
        OR NOT EXISTS (
          SELECT 1
          FROM ledger_recovery_transition_rules AS rule_state
          WHERE rule_state.previous_state = current_state
            AND rule_state.next_state = NEW.next_state
            AND rule_state.reason_code = NEW.reason_code
        )
      THEN
        RAISE EXCEPTION 'illegal ledger lifecycle transition'
          USING ERRCODE = 'L4201';
      END IF;

      NEW.event_sequence := COALESCE(current_sequence, 0) + 1;
      NEW.previous_state := current_state;
      NEW.recorded_at := clock_timestamp();
      RETURN NEW;
    END;
    $function$;
  `;
}

function createLifecycleBoundaryFunctionsSql(): string {
  return `
    CREATE FUNCTION record_ledger_lifecycle_event(
      requested_actor_account_id uuid,
      requested_transaction_id uuid,
      requested_leg_id uuid,
      requested_expected_state text,
      requested_next_state text,
      requested_reason_code text,
      requested_effective_at timestamptz,
      requested_correlation_id uuid,
      requested_journal_id uuid
    ) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      target_book_id uuid;
      generated_event_id uuid;
    BEGIN
      IF requested_actor_account_id IS NULL
        OR requested_transaction_id IS NULL
        OR requested_next_state IS NULL
        OR requested_reason_code IS NULL
        OR requested_effective_at IS NULL
        OR NOT isfinite(requested_effective_at)
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid ledger lifecycle command'
          USING ERRCODE = '22023';
      END IF;

      SELECT transaction_state.book_id
        INTO target_book_id
      FROM ledger_transactions AS transaction_state
      WHERE transaction_state.transaction_id = requested_transaction_id
        AND transaction_state.tenant_account_id = requested_actor_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger lifecycle transition is not authorized'
          USING ERRCODE = '42501';
      END IF;

      IF requested_leg_id IS NULL THEN
        IF requested_journal_id IS NOT NULL THEN
          RAISE EXCEPTION 'transaction lifecycle event cannot bind a leg journal'
            USING ERRCODE = '22023';
        END IF;
        INSERT INTO ledger_transaction_lifecycle_events (
          transaction_id,
          book_id,
          actor_account_id,
          previous_state,
          next_state,
          reason_code,
          effective_at,
          correlation_id
        ) VALUES (
          requested_transaction_id,
          target_book_id,
          requested_actor_account_id,
          requested_expected_state,
          requested_next_state,
          requested_reason_code,
          requested_effective_at,
          requested_correlation_id
        ) RETURNING lifecycle_event_id INTO generated_event_id;
      ELSE
        IF requested_next_state IN ('SETTLED', 'REVERSED')
          AND requested_journal_id IS NULL
        THEN
          RAISE EXCEPTION 'financial lifecycle transition requires composition'
            USING ERRCODE = 'L4201';
        END IF;
        IF requested_next_state NOT IN ('SETTLED', 'REVERSED')
          AND requested_journal_id IS NOT NULL
        THEN
          RAISE EXCEPTION 'non-financial lifecycle event cannot bind a journal'
            USING ERRCODE = '22023';
        END IF;

        INSERT INTO ledger_leg_lifecycle_events (
          transaction_id,
          leg_id,
          book_id,
          actor_account_id,
          previous_state,
          next_state,
          reason_code,
          effective_at,
          correlation_id,
          journal_id
        ) VALUES (
          requested_transaction_id,
          requested_leg_id,
          target_book_id,
          requested_actor_account_id,
          requested_expected_state,
          requested_next_state,
          requested_reason_code,
          requested_effective_at,
          requested_correlation_id,
          requested_journal_id
        ) RETURNING lifecycle_event_id INTO generated_event_id;
      END IF;

      RETURN generated_event_id;
    END;
    $function$;

    CREATE FUNCTION transition_ledger_transaction_state(
      requested_actor_account_id uuid,
      requested_transaction_id uuid,
      requested_expected_state text,
      requested_next_state text,
      requested_reason_code text,
      requested_effective_at timestamptz,
      requested_correlation_id uuid
    ) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    BEGIN
      RETURN record_ledger_lifecycle_event(
        requested_actor_account_id,
        requested_transaction_id,
        NULL,
        requested_expected_state,
        requested_next_state,
        requested_reason_code,
        requested_effective_at,
        requested_correlation_id,
        NULL
      );
    END;
    $function$;

    CREATE FUNCTION transition_ledger_leg_state(
      requested_actor_account_id uuid,
      requested_transaction_id uuid,
      requested_leg_id uuid,
      requested_expected_state text,
      requested_next_state text,
      requested_reason_code text,
      requested_effective_at timestamptz,
      requested_correlation_id uuid
    ) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    BEGIN
      IF requested_leg_id IS NULL THEN
        RAISE EXCEPTION 'ledger leg lifecycle command requires a leg'
          USING ERRCODE = '22023';
      END IF;
      RETURN record_ledger_lifecycle_event(
        requested_actor_account_id,
        requested_transaction_id,
        requested_leg_id,
        requested_expected_state,
        requested_next_state,
        requested_reason_code,
        requested_effective_at,
        requested_correlation_id,
        NULL
      );
    END;
    $function$;

    CREATE FUNCTION transition_ledger_recovery_state(
      requested_actor_account_id uuid,
      requested_transaction_id uuid,
      requested_leg_id uuid,
      requested_expected_state text,
      requested_next_state text,
      requested_reason_code text,
      requested_effective_at timestamptz,
      requested_correlation_id uuid
    ) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      target_book_id uuid;
      generated_event_id uuid;
    BEGIN
      IF requested_actor_account_id IS NULL
        OR requested_transaction_id IS NULL
        OR requested_expected_state IS NULL
        OR requested_next_state IS NULL
        OR requested_reason_code IS NULL
        OR requested_effective_at IS NULL
        OR NOT isfinite(requested_effective_at)
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid ledger recovery command'
          USING ERRCODE = '22023';
      END IF;

      SELECT transaction_state.book_id
        INTO target_book_id
      FROM ledger_transactions AS transaction_state
      WHERE transaction_state.transaction_id = requested_transaction_id
        AND transaction_state.tenant_account_id = requested_actor_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger recovery transition is not authorized'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO ledger_recovery_state_events (
        transaction_id,
        leg_id,
        book_id,
        actor_account_id,
        previous_state,
        next_state,
        reason_code,
        effective_at,
        correlation_id
      ) VALUES (
        requested_transaction_id,
        requested_leg_id,
        target_book_id,
        requested_actor_account_id,
        requested_expected_state,
        requested_next_state,
        requested_reason_code,
        requested_effective_at,
        requested_correlation_id
      ) RETURNING recovery_event_id INTO generated_event_id;

      RETURN generated_event_id;
    END;
    $function$;

    CREATE FUNCTION post_ledger_journal_with_lifecycle(
      requested_capability_token text,
      requested_book_id uuid,
      requested_transaction_id uuid,
      requested_leg_id uuid,
      requested_economic_event_type text,
      requested_effective_at timestamptz,
      requested_observed_at timestamptz,
      requested_reason_code text,
      requested_correlation_id uuid,
      requested_postings text
    ) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      generated_journal_id uuid;
      journal_actor_id uuid;
      current_leg_state text;
    BEGIN
      generated_journal_id := post_ledger_journal(
        requested_capability_token,
        requested_book_id,
        requested_transaction_id,
        requested_leg_id,
        requested_economic_event_type,
        requested_effective_at,
        requested_observed_at,
        requested_reason_code,
        requested_correlation_id,
        requested_postings
      );

      SELECT journal_state.actor_account_id
        INTO journal_actor_id
      FROM ledger_journals AS journal_state
      WHERE journal_state.journal_id = generated_journal_id
        AND journal_state.transaction_id = requested_transaction_id
        AND journal_state.leg_id = requested_leg_id
        AND journal_state.book_id = requested_book_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'posted journal does not match lifecycle scope'
          USING ERRCODE = '23514';
      END IF;

      SELECT event_state.next_state
        INTO current_leg_state
      FROM ledger_leg_lifecycle_events AS event_state
      WHERE event_state.leg_id = requested_leg_id
      ORDER BY event_state.event_sequence DESC
      LIMIT 1;
      IF current_leg_state NOT IN ('SUBMITTED', 'PENDING') THEN
        RAISE EXCEPTION 'illegal ledger lifecycle transition'
          USING ERRCODE = 'L4201';
      END IF;

      PERFORM record_ledger_lifecycle_event(
        journal_actor_id,
        requested_transaction_id,
        requested_leg_id,
        current_leg_state,
        'SETTLED',
        'SETTLEMENT_RECORDED',
        requested_effective_at,
        requested_correlation_id,
        generated_journal_id
      );
      RETURN generated_journal_id;
    END;
    $function$;

    CREATE FUNCTION reverse_ledger_journal_with_lifecycle(
      requested_capability_token text,
      requested_original_journal_id uuid,
      requested_reason_code text,
      requested_effective_at timestamptz,
      requested_observed_at timestamptz,
      requested_correlation_id uuid
    ) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      generated_journal_id uuid;
      journal_actor_id uuid;
      journal_transaction_id uuid;
      journal_leg_id uuid;
      current_leg_state text;
    BEGIN
      generated_journal_id := reverse_ledger_journal(
        requested_capability_token,
        requested_original_journal_id,
        requested_reason_code,
        requested_effective_at,
        requested_observed_at,
        requested_correlation_id
      );

      SELECT journal_state.actor_account_id,
             journal_state.transaction_id,
             journal_state.leg_id
        INTO journal_actor_id, journal_transaction_id, journal_leg_id
      FROM ledger_journals AS journal_state
      WHERE journal_state.journal_id = generated_journal_id
        AND journal_state.reverses_journal_id = requested_original_journal_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'reversal journal does not match lifecycle scope'
          USING ERRCODE = '23514';
      END IF;

      SELECT event_state.next_state
        INTO current_leg_state
      FROM ledger_leg_lifecycle_events AS event_state
      WHERE event_state.leg_id = journal_leg_id
      ORDER BY event_state.event_sequence DESC
      LIMIT 1;
      IF current_leg_state IS DISTINCT FROM 'SETTLED' THEN
        RAISE EXCEPTION 'illegal ledger lifecycle transition'
          USING ERRCODE = 'L4201';
      END IF;

      PERFORM record_ledger_lifecycle_event(
        journal_actor_id,
        journal_transaction_id,
        journal_leg_id,
        'SETTLED',
        'REVERSED',
        'FULL_REVERSAL_RECORDED',
        requested_effective_at,
        requested_correlation_id,
        generated_journal_id
      );
      RETURN generated_journal_id;
    END;
    $function$;
  `;
}

function createLifecycleTriggersAndAclSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const functionIdentities = LIFECYCLE_FUNCTION_IDENTITIES.map(
    (identityValue) => `'${identityValue}'`,
  ).join(',\n        ');
  const tableList = LIFECYCLE_TABLES.join(', ');

  return `
    CREATE TRIGGER ledger_lifecycle_rules_append_row
      BEFORE UPDATE OR DELETE ON ledger_lifecycle_transition_rules
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_lifecycle_rules_append_truncate
      BEFORE TRUNCATE ON ledger_lifecycle_transition_rules
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_recovery_rules_append_row
      BEFORE UPDATE OR DELETE ON ledger_recovery_transition_rules
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_recovery_rules_append_truncate
      BEFORE TRUNCATE ON ledger_recovery_transition_rules
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_tx_lifecycle_append_row
      BEFORE UPDATE OR DELETE ON ledger_transaction_lifecycle_events
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_tx_lifecycle_append_truncate
      BEFORE TRUNCATE ON ledger_transaction_lifecycle_events
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_leg_lifecycle_append_row
      BEFORE UPDATE OR DELETE ON ledger_leg_lifecycle_events
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_leg_lifecycle_append_truncate
      BEFORE TRUNCATE ON ledger_leg_lifecycle_events
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_recovery_state_append_row
      BEFORE UPDATE OR DELETE ON ledger_recovery_state_events
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ledger_recovery_state_append_truncate
      BEFORE TRUNCATE ON ledger_recovery_state_events
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();

    CREATE TRIGGER ledger_tx_lifecycle_validate_insert
      BEFORE INSERT ON ledger_transaction_lifecycle_events
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_transaction_lifecycle_event();
    CREATE TRIGGER ledger_leg_lifecycle_validate_insert
      BEFORE INSERT ON ledger_leg_lifecycle_events
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_leg_lifecycle_event();
    CREATE TRIGGER ledger_recovery_state_validate_insert
      BEFORE INSERT ON ledger_recovery_state_events
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_recovery_state_event();

    ALTER TABLE ledger_lifecycle_transition_rules
      ENABLE ALWAYS TRIGGER ledger_lifecycle_rules_append_row;
    ALTER TABLE ledger_lifecycle_transition_rules
      ENABLE ALWAYS TRIGGER ledger_lifecycle_rules_append_truncate;
    ALTER TABLE ledger_recovery_transition_rules
      ENABLE ALWAYS TRIGGER ledger_recovery_rules_append_row;
    ALTER TABLE ledger_recovery_transition_rules
      ENABLE ALWAYS TRIGGER ledger_recovery_rules_append_truncate;
    ALTER TABLE ledger_transaction_lifecycle_events
      ENABLE ALWAYS TRIGGER ledger_tx_lifecycle_append_row;
    ALTER TABLE ledger_transaction_lifecycle_events
      ENABLE ALWAYS TRIGGER ledger_tx_lifecycle_append_truncate;
    ALTER TABLE ledger_transaction_lifecycle_events
      ENABLE ALWAYS TRIGGER ledger_tx_lifecycle_validate_insert;
    ALTER TABLE ledger_leg_lifecycle_events
      ENABLE ALWAYS TRIGGER ledger_leg_lifecycle_append_row;
    ALTER TABLE ledger_leg_lifecycle_events
      ENABLE ALWAYS TRIGGER ledger_leg_lifecycle_append_truncate;
    ALTER TABLE ledger_leg_lifecycle_events
      ENABLE ALWAYS TRIGGER ledger_leg_lifecycle_validate_insert;
    ALTER TABLE ledger_recovery_state_events
      ENABLE ALWAYS TRIGGER ledger_recovery_state_append_row;
    ALTER TABLE ledger_recovery_state_events
      ENABLE ALWAYS TRIGGER ledger_recovery_state_append_truncate;
    ALTER TABLE ledger_recovery_state_events
      ENABLE ALWAYS TRIGGER ledger_recovery_state_validate_insert;

    DO $qualify_lifecycle_function_references$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
      relation_name text;
      function_definition text;
      function_body text;
      qualified_relation text;
      qualified_helper text;
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
          'ledger_transactions',
          'ledger_legs',
          'ledger_journals',
          'ledger_lifecycle_transition_rules',
          'ledger_recovery_transition_rules',
          'ledger_transaction_lifecycle_events',
          'ledger_leg_lifecycle_events',
          'ledger_recovery_state_events'
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

        FOREACH qualified_helper IN ARRAY ARRAY[
          'record_ledger_lifecycle_event',
          'post_ledger_journal',
          'reverse_ledger_journal'
        ]
        LOOP
          function_body := pg_catalog.replace(
            function_body,
            qualified_helper || '(',
            pg_catalog.format('%I.%I(', migration_schema, qualified_helper)
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
    $qualify_lifecycle_function_references$;

    DO $set_lifecycle_function_paths$
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
    $set_lifecycle_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${tableList}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};

    REVOKE ALL ON FUNCTION validate_ledger_transaction_lifecycle_event()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_leg_lifecycle_event()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_recovery_state_event()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION record_ledger_lifecycle_event(
      uuid, uuid, uuid, text, text, text, timestamptz, uuid, uuid
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION transition_ledger_transaction_state(
      uuid, uuid, text, text, text, timestamptz, uuid
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION transition_ledger_leg_state(
      uuid, uuid, uuid, text, text, text, timestamptz, uuid
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION transition_ledger_recovery_state(
      uuid, uuid, uuid, text, text, text, timestamptz, uuid
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION post_ledger_journal_with_lifecycle(
      text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION reverse_ledger_journal_with_lifecycle(
      text, uuid, text, timestamptz, timestamptz, uuid
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};

    REVOKE EXECUTE ON FUNCTION post_ledger_journal(
      text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
    ) FROM ${api};
    REVOKE EXECUTE ON FUNCTION reverse_ledger_journal(
      text, uuid, text, timestamptz, timestamptz, uuid
    ) FROM ${api};

    GRANT EXECUTE ON FUNCTION transition_ledger_transaction_state(
      uuid, uuid, text, text, text, timestamptz, uuid
    ) TO ${api};
    GRANT EXECUTE ON FUNCTION transition_ledger_leg_state(
      uuid, uuid, uuid, text, text, text, timestamptz, uuid
    ) TO ${api};
    GRANT EXECUTE ON FUNCTION transition_ledger_recovery_state(
      uuid, uuid, uuid, text, text, text, timestamptz, uuid
    ) TO ${api};
    GRANT EXECUTE ON FUNCTION post_ledger_journal_with_lifecycle(
      text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
    ) TO ${api};
    GRANT EXECUTE ON FUNCTION reverse_ledger_journal_with_lifecycle(
      text, uuid, text, timestamptz, timestamptz, uuid
    ) TO ${api};
  `;
}

function createLifecycleDownSql(names: DatabasePrincipalNames): readonly string[] {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  return [
    `DO $refuse_populated_lifecycle_rollback$
     BEGIN
       IF EXISTS (SELECT 1 FROM ledger_transaction_lifecycle_events)
         OR EXISTS (SELECT 1 FROM ledger_leg_lifecycle_events)
         OR EXISTS (SELECT 1 FROM ledger_recovery_state_events)
       THEN
         RAISE EXCEPTION 'cannot roll back immutable ledger lifecycle history'
           USING ERRCODE = '55000';
       END IF;
     END;
     $refuse_populated_lifecycle_rollback$;`,
    `REVOKE EXECUTE ON FUNCTION transition_ledger_transaction_state(
       uuid, uuid, text, text, text, timestamptz, uuid
     ) FROM ${api}`,
    `REVOKE EXECUTE ON FUNCTION transition_ledger_leg_state(
       uuid, uuid, uuid, text, text, text, timestamptz, uuid
     ) FROM ${api}`,
    `REVOKE EXECUTE ON FUNCTION transition_ledger_recovery_state(
       uuid, uuid, uuid, text, text, text, timestamptz, uuid
     ) FROM ${api}`,
    `REVOKE EXECUTE ON FUNCTION post_ledger_journal_with_lifecycle(
       text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
     ) FROM ${api}`,
    `REVOKE EXECUTE ON FUNCTION reverse_ledger_journal_with_lifecycle(
       text, uuid, text, timestamptz, timestamptz, uuid
     ) FROM ${api}`,
    `DROP FUNCTION reverse_ledger_journal_with_lifecycle(
       text, uuid, text, timestamptz, timestamptz, uuid
     )`,
    `DROP FUNCTION post_ledger_journal_with_lifecycle(
       text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
     )`,
    `DROP FUNCTION transition_ledger_recovery_state(
       uuid, uuid, uuid, text, text, text, timestamptz, uuid
     )`,
    `DROP FUNCTION transition_ledger_leg_state(
       uuid, uuid, uuid, text, text, text, timestamptz, uuid
     )`,
    `DROP FUNCTION transition_ledger_transaction_state(
       uuid, uuid, text, text, text, timestamptz, uuid
     )`,
    `DROP FUNCTION record_ledger_lifecycle_event(
       uuid, uuid, uuid, text, text, text, timestamptz, uuid, uuid
     )`,
    'DROP TABLE ledger_recovery_state_events',
    'DROP TABLE ledger_leg_lifecycle_events',
    'DROP TABLE ledger_transaction_lifecycle_events',
    'DROP TABLE ledger_recovery_transition_rules',
    'DROP TABLE ledger_lifecycle_transition_rules',
    'DROP FUNCTION validate_ledger_recovery_state_event()',
    'DROP FUNCTION validate_ledger_leg_lifecycle_event()',
    'DROP FUNCTION validate_ledger_transaction_lifecycle_event()',
    `GRANT EXECUTE ON FUNCTION post_ledger_journal(
       text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
     ) TO ${api}`,
    `GRANT EXECUTE ON FUNCTION reverse_ledger_journal(
       text, uuid, text, timestamptz, timestamptz, uuid
     ) TO ${api}`,
  ];
}

function createLifecycleVerifierSql(
  names: DatabasePrincipalNames,
  cumulativePrincipalVerification: boolean,
): string {
  const priorMigration = createImmutableLedgerMigration(names, {
    cumulativePrincipalVerification,
  });
  if (!priorMigration.verifySql) {
    throw new Error('Migration 0007 must expose verification SQL');
  }

  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const oldPrincipalFunctionAllowance = `            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                to_regprocedure(
                  'post_ledger_journal(text,uuid,uuid,uuid,text,timestamptz,timestamptz,text,uuid,text)'
                ),
                to_regprocedure(
                  'reverse_ledger_journal(text,uuid,text,timestamptz,timestamptz,uuid)'
                )
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const lifecyclePrincipalFunctionAllowance = `            OR (
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

  const oldLedgerFunctionAllowance = `             AND (
               (acl.proname = 'post_ledger_journal'
                 AND acl.identity_arguments =
                   'requested_capability_token text, requested_book_id uuid, requested_transaction_id uuid, requested_leg_id uuid, requested_economic_event_type text, requested_effective_at timestamp with time zone, requested_observed_at timestamp with time zone, requested_reason_code text, requested_correlation_id uuid, requested_postings text')
               OR
               (acl.proname = 'reverse_ledger_journal'
                 AND acl.identity_arguments =
                   'requested_capability_token text, requested_original_journal_id uuid, requested_reason_code text, requested_effective_at timestamp with time zone, requested_observed_at timestamp with time zone, requested_correlation_id uuid')
             )`;
  const lifecycleFunctionAllowance = `             AND (
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

  let verifier = priorMigration.verifySql;
  if (cumulativePrincipalVerification) {
    verifier = replaceExactlyOnce(
      verifier,
      oldPrincipalFunctionAllowance,
      lifecyclePrincipalFunctionAllowance,
    );
    const oldLedgerTableLiterals = IMMUTABLE_LEDGER_TABLES.map((table) => `'${table}'`).join(', ');
    const lifecycleTableLiterals = [...IMMUTABLE_LEDGER_TABLES, ...LIFECYCLE_TABLES]
      .map((table) => `'${table}'`)
      .join(', ');
    verifier = replaceExactly(verifier, oldLedgerTableLiterals, lifecycleTableLiterals, 2);
  }

  const exactCatalogReplacements = [
    ['SELECT object_count = 22 FROM table_catalog', 'SELECT object_count = 27 FROM table_catalog'],
    [
      '9ae9153673009e7d049bc919d6bd0cac2a5c68f22244b533464f036f76e81a26',
      '0bc0dfab851ed4ad9153e91c5feaca20e2d203fa24e6ffc88f3382bfbbb31bd7',
    ],
    [
      'SELECT object_count = 331 FROM column_catalog',
      'SELECT object_count = 376 FROM column_catalog',
    ],
    [
      '32d58be18c425eb0f2d87f64b75e8e2574317a89cb6260cb9158cebe48fdf10b',
      '4692a4b7a60c5618c288383cc0c9bf2aa90d35c48f5fe92c960f5c1e806c9447',
    ],
    [
      'SELECT object_count = 309 FROM constraint_catalog',
      'SELECT object_count = 364 FROM constraint_catalog',
    ],
    [
      'a94b201b587909d901829382edce3e67bacc72db2a5502a0879b110036370d1c',
      'a41b52ade12650900c09346cd5bb4c842247fcd2f8a5b330d817dc983b6eab74',
    ],
    ['SELECT object_count = 86 FROM index_catalog', 'SELECT object_count = 98 FROM index_catalog'],
    [
      '73715e81858f8f2a9f4dcb8c9a1f8bb60f86139c7bb43f8a85d1b953d8609b8c',
      'cbdd318c7200d69056f4d5895e34b93dce1182a1de1e4cc2ceb543e4c5d90619',
    ],
    [
      'SELECT object_count = 65 FROM trigger_catalog',
      'SELECT object_count = 78 FROM trigger_catalog',
    ],
    [
      'fdbd542c971e64191b394752a4993d85b04f88cdc9f437d931740c22eba3b1f3',
      '5d12a03652792fce36ad50ac1b5b6962f1976183424cf1ea195d601d85ee8f3b',
    ],
    [
      'SELECT object_count = 304 FROM internal_fk_trigger_catalog',
      'SELECT object_count = 324 FROM internal_fk_trigger_catalog',
    ],
    [
      'f5afff3f67177c9166615ac3434d2567a9845d748bb3036a9d61ea953986e2e1',
      'e755071afde23309f6fb86d006067d6f6c6b20494d4c6029012d910fb0adc034',
    ],
    [
      'SELECT object_count = 15 FROM function_catalog',
      'SELECT object_count = 24 FROM function_catalog',
    ],
    [
      '3d95ee145d5531cb7ea0b5582331338d7a1a8e3a81bac269717c2fc1808dbef6',
      'bfff8c7dec8a03102ee541201661fb4b7ded3f7894a0da1573294be14b6827c9',
    ],
    [
      'SELECT pg_catalog.count(*) = 154 FROM table_acl',
      'SELECT pg_catalog.count(*) = 189 FROM table_acl',
    ],
    [
      'SELECT pg_catalog.count(*) = 17 FROM function_acl',
      'SELECT pg_catalog.count(*) = 29 FROM function_acl',
    ],
  ] as const;
  for (const [oldValue, newValue] of exactCatalogReplacements) {
    verifier = replaceExactlyOnce(verifier, oldValue, newValue);
  }

  verifier = replaceExactlyOnce(verifier, oldLedgerFunctionAllowance, lifecycleFunctionAllowance);
  verifier = replaceExactlyOnce(
    verifier,
    "function_state.proname IN ('post_ledger_journal', 'reverse_ledger_journal')",
    `function_state.proname IN (
          'transition_ledger_transaction_state',
          'transition_ledger_leg_state',
          'transition_ledger_recovery_state',
          'post_ledger_journal_with_lifecycle',
          'reverse_ledger_journal_with_lifecycle'
        )`,
  );

  return verifier;
}

export function createLedgerLifecycleMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0008',
    description: 'create append-only ledger transaction lifecycle history',
    upSql: [
      createLifecycleTablesSql(),
      createLifecycleFunctionsSql(),
      createLifecycleBoundaryFunctionsSql(),
      createLifecycleTriggersAndAclSql(names),
    ],
    downSql: createLifecycleDownSql(names),
    verifySql: createLifecycleVerifierSql(names, cumulativePrincipalVerification),
    supersedesVerificationOf: ['0007'],
  };
}

export const createLedgerLifecycleMigrationV0008 = createLedgerLifecycleMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createLedgerLifecycleTestSchemaMigrationV0008 = createLedgerLifecycleMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
  { cumulativePrincipalVerification: false },
);
