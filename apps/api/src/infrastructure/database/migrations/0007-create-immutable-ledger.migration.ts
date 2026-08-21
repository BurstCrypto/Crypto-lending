import {
  createDatabasePrincipalBoundaryMigration,
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import type { DatabaseMigration } from './migration';

const MAX_ATOMIC_AMOUNT =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const MAX_POSTINGS_JSON_BYTES = 32_768;
const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

const LEDGER_TABLES = [
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
    throw new Error('Migration 0005 verifier extension anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function createLedgerUpSql(): string {
  return `
    CREATE TABLE ledger_books (
      book_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      book_code text NOT NULL UNIQUE,
      accounting_purpose text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_books_id_uuid_v4_check CHECK (
        substring(book_id::text FROM 15 FOR 1) = '4'
        AND substring(book_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_books_code_check CHECK (book_code = 'OPERATIONAL_MEMO'),
      CONSTRAINT ledger_books_purpose_check CHECK (accounting_purpose = 'VALUE_MOVEMENT_MEMORANDUM')
    );

    INSERT INTO ledger_books (book_code, accounting_purpose)
    VALUES ('OPERATIONAL_MEMO', 'VALUE_MOVEMENT_MEMORANDUM');

    CREATE TABLE ledger_assets (
      asset_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_id uuid NOT NULL,
      definition_revision integer NOT NULL,
      network_reference_id uuid NOT NULL,
      asset_kind text NOT NULL,
      settlement_identity_digest bytea NOT NULL,
      base_unit_decimals smallint NOT NULL,
      metadata_source_reference_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_assets_revision_id_uuid_v4_check CHECK (
        substring(asset_revision_id::text FROM 15 FOR 1) = '4'
        AND substring(asset_revision_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_assets_asset_id_uuid_v4_check CHECK (
        substring(asset_id::text FROM 15 FOR 1) = '4'
        AND substring(asset_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_assets_network_id_uuid_v4_check CHECK (
        substring(network_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(network_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_assets_metadata_source_id_uuid_v4_check CHECK (
        substring(metadata_source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(metadata_source_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_assets_revision_check CHECK (definition_revision > 0),
      CONSTRAINT ledger_assets_kind_check CHECK (
        asset_kind IN ('NATIVE', 'CONTRACT', 'MINT', 'PROVIDER_INSTRUMENT')
      ),
      CONSTRAINT ledger_assets_identity_digest_check CHECK (
        octet_length(settlement_identity_digest) = 32
      ),
      CONSTRAINT ledger_assets_decimals_check CHECK (base_unit_decimals BETWEEN 0 AND 36),
      CONSTRAINT ledger_assets_identity_unique UNIQUE (asset_id, definition_revision),
      CONSTRAINT ledger_assets_settlement_revision_unique UNIQUE (
        network_reference_id, asset_kind, settlement_identity_digest, definition_revision
      )
    );

    CREATE TABLE ledger_accounts (
      ledger_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      book_id uuid NOT NULL,
      asset_revision_id uuid NOT NULL,
      owner_kind text NOT NULL,
      owner_account_id uuid,
      counterparty_reference_id uuid,
      location_kind text NOT NULL,
      location_reference_id uuid NOT NULL,
      account_role text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_accounts_id_uuid_v4_check CHECK (
        substring(ledger_account_id::text FROM 15 FOR 1) = '4'
        AND substring(ledger_account_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_accounts_book_fk FOREIGN KEY (book_id)
        REFERENCES ledger_books (book_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_accounts_asset_fk FOREIGN KEY (asset_revision_id)
        REFERENCES ledger_assets (asset_revision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_accounts_owner_account_fk FOREIGN KEY (owner_account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_accounts_owner_kind_check CHECK (
        owner_kind IN ('ACCOUNT', 'PROVIDER', 'NETWORK', 'PLATFORM', 'SYSTEM')
      ),
      CONSTRAINT ledger_accounts_owner_reference_check CHECK (
        (
          owner_kind = 'ACCOUNT'
          AND owner_account_id IS NOT NULL
          AND counterparty_reference_id IS NULL
        ) OR (
          owner_kind <> 'ACCOUNT'
          AND owner_account_id IS NULL
          AND counterparty_reference_id IS NOT NULL
        )
      ),
      CONSTRAINT ledger_accounts_counterparty_id_uuid_v4_check CHECK (
        counterparty_reference_id IS NULL OR (
          substring(counterparty_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(counterparty_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        )
      ),
      CONSTRAINT ledger_accounts_location_id_uuid_v4_check CHECK (
        substring(location_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(location_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_accounts_location_kind_check CHECK (
        location_kind IN ('WALLET', 'CUSTODY', 'PROVIDER', 'CLEARING', 'NETWORK', 'PLATFORM', 'SUSPENSE')
      ),
      CONSTRAINT ledger_accounts_role_check CHECK (
        account_role IN (
          'POSITION', 'EXTERNAL_CLEARING', 'FEE_SINK',
          'PLATFORM_FEE_COLLECTION', 'SUSPENSE'
        )
      ),
      CONSTRAINT ledger_accounts_identity_unique UNIQUE NULLS NOT DISTINCT (
        book_id, asset_revision_id, owner_kind, owner_account_id,
        counterparty_reference_id, location_kind, location_reference_id, account_role
      ),
      CONSTRAINT ledger_accounts_book_asset_unique UNIQUE (
        ledger_account_id, book_id, asset_revision_id
      )
    );

    CREATE TABLE ledger_transactions (
      transaction_id uuid PRIMARY KEY,
      tenant_account_id uuid NOT NULL,
      book_id uuid NOT NULL,
      intent_type text NOT NULL,
      quote_snapshot_reference_id uuid,
      route_revision_reference_id uuid,
      configuration_revision_reference_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_transactions_id_uuid_v4_check CHECK (
        substring(transaction_id::text FROM 15 FOR 1) = '4'
        AND substring(transaction_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_transactions_tenant_fk FOREIGN KEY (tenant_account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_transactions_book_fk FOREIGN KEY (book_id)
        REFERENCES ledger_books (book_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_transactions_intent_check CHECK (
        intent_type IN (
          'DIRECT_SETTLEMENT', 'SAME_CHAIN_SWAP', 'CROSS_CHAIN_BRIDGE',
          'FEE_ONLY', 'ADJUSTMENT', 'COMPENSATION'
        )
      ),
      CONSTRAINT ledger_transactions_quote_id_uuid_v4_check CHECK (
        quote_snapshot_reference_id IS NULL OR (
          substring(quote_snapshot_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(quote_snapshot_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        )
      ),
      CONSTRAINT ledger_transactions_route_id_uuid_v4_check CHECK (
        route_revision_reference_id IS NULL OR (
          substring(route_revision_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(route_revision_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        )
      ),
      CONSTRAINT ledger_transactions_config_id_uuid_v4_check CHECK (
        substring(configuration_revision_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(configuration_revision_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_transactions_book_unique UNIQUE (transaction_id, book_id),
      CONSTRAINT ledger_transactions_scope_unique UNIQUE (
        transaction_id, book_id, tenant_account_id
      )
    );

    CREATE TABLE ledger_legs (
      leg_id uuid PRIMARY KEY,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      leg_sequence integer NOT NULL,
      leg_kind text NOT NULL,
      asset_revision_id uuid NOT NULL,
      source_account_id uuid NOT NULL,
      destination_account_id uuid NOT NULL,
      expected_amount_atomic numeric NOT NULL,
      depends_on_leg_id uuid,
      compensates_journal_id uuid,
      adjusts_journal_id uuid,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_legs_id_uuid_v4_check CHECK (
        substring(leg_id::text FROM 15 FOR 1) = '4'
        AND substring(leg_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_legs_transaction_fk FOREIGN KEY (
        transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_transactions (transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_legs_asset_fk FOREIGN KEY (asset_revision_id)
        REFERENCES ledger_assets (asset_revision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_legs_source_account_fk FOREIGN KEY (
        source_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_legs_destination_account_fk FOREIGN KEY (
        destination_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_legs_sequence_check CHECK (leg_sequence > 0),
      CONSTRAINT ledger_legs_kind_check CHECK (
        leg_kind IN (
          'SOURCE_TRANSFER', 'SWAP_INPUT', 'SWAP_OUTPUT', 'BRIDGE_DEPOSIT',
          'BRIDGE_RELEASE', 'FEE_PAYMENT', 'ADJUSTMENT', 'COMPENSATION'
        )
      ),
      CONSTRAINT ledger_legs_distinct_accounts_check CHECK (
        source_account_id <> destination_account_id
      ),
      CONSTRAINT ledger_legs_expected_amount_check CHECK (
        expected_amount_atomic > 0
        AND expected_amount_atomic = trunc(expected_amount_atomic)
        AND expected_amount_atomic <= ${MAX_ATOMIC_AMOUNT}::numeric
      ),
      CONSTRAINT ledger_legs_compensation_shape_check CHECK (
        (leg_kind = 'COMPENSATION') = (compensates_journal_id IS NOT NULL)
      ),
      CONSTRAINT ledger_legs_adjustment_shape_check CHECK (
        (leg_kind = 'ADJUSTMENT') = (adjusts_journal_id IS NOT NULL)
        AND NOT (compensates_journal_id IS NOT NULL AND adjusts_journal_id IS NOT NULL)
      ),
      CONSTRAINT ledger_legs_dependency_not_self_check CHECK (
        depends_on_leg_id IS NULL OR depends_on_leg_id <> leg_id
      ),
      CONSTRAINT ledger_legs_transaction_sequence_unique UNIQUE (transaction_id, leg_sequence),
      CONSTRAINT ledger_legs_scope_unique UNIQUE (leg_id, transaction_id, book_id),
      CONSTRAINT ledger_legs_tenant_scope_unique UNIQUE (
        leg_id, transaction_id, book_id, tenant_account_id
      )
    );

    CREATE TABLE ledger_leg_posting_plans (
      posting_plan_id uuid PRIMARY KEY,
      leg_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      economic_event_type text NOT NULL,
      reason_code text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_leg_posting_plans_id_uuid_v4_check CHECK (
        substring(posting_plan_id::text FROM 15 FOR 1) = '4'
        AND substring(posting_plan_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_posting_plans_leg_fk FOREIGN KEY (
        leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_legs (leg_id, transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_posting_plans_event_reason_check CHECK (
        (economic_event_type = 'SETTLEMENT' AND reason_code IN (
          'CHAIN_FINALITY_CONFIRMED', 'PROVIDER_SETTLEMENT_VERIFIED'
        )) OR
        (economic_event_type = 'ACTUAL_FEE' AND reason_code = 'ACTUAL_FEE_CONFIRMED') OR
        (economic_event_type = 'ADJUSTMENT' AND reason_code = 'ACCOUNTING_ADJUSTMENT_APPROVED') OR
        (economic_event_type = 'COMPENSATION' AND reason_code = 'COMPENSATION_SETTLED')
      ),
      CONSTRAINT ledger_leg_posting_plans_scope_unique UNIQUE (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ),
      CONSTRAINT ledger_leg_posting_plans_scope_event_unique UNIQUE (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
        economic_event_type
      )
    );

    CREATE TABLE ledger_leg_posting_plan_lines (
      posting_plan_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      plan_line_number integer NOT NULL,
      ledger_account_id uuid NOT NULL,
      asset_revision_id uuid NOT NULL,
      side text NOT NULL,
      amount_atomic numeric NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_leg_posting_plan_lines_pkey PRIMARY KEY (
        posting_plan_id, plan_line_number
      ),
      CONSTRAINT ledger_leg_posting_plan_lines_plan_fk FOREIGN KEY (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_leg_posting_plans (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_posting_plan_lines_account_fk FOREIGN KEY (
        ledger_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_posting_plan_lines_number_check CHECK (
        plan_line_number BETWEEN 1 AND 64
      ),
      CONSTRAINT ledger_leg_posting_plan_lines_side_check CHECK (side IN ('DEBIT', 'CREDIT')),
      CONSTRAINT ledger_leg_posting_plan_lines_amount_check CHECK (
        amount_atomic > 0
        AND amount_atomic = trunc(amount_atomic)
        AND amount_atomic <= ${MAX_ATOMIC_AMOUNT}::numeric
      )
    );

    CREATE INDEX ledger_leg_posting_plan_account_idx
      ON ledger_leg_posting_plan_lines (
        ledger_account_id, posting_plan_id, plan_line_number
      );

    CREATE TABLE ledger_leg_recognition_evidence (
      posting_plan_id uuid PRIMARY KEY,
      leg_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      reference_type text NOT NULL,
      environment text NOT NULL,
      namespace_type text NOT NULL,
      source_reference_id uuid NOT NULL,
      canonical_locator_reference_id uuid NOT NULL,
      external_locator_digest bytea NOT NULL,
      recognition_policy_reference_id uuid NOT NULL,
      recognition_evidence_revision_reference_id uuid NOT NULL,
      effective_at timestamptz NOT NULL,
      observed_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_leg_recognition_evidence_plan_fk FOREIGN KEY (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_leg_posting_plans (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_recognition_evidence_type_check CHECK (
        reference_type IN ('CHAIN_EVENT', 'PROVIDER_EVENT', 'FINALITY_EVIDENCE')
      ),
      CONSTRAINT ledger_leg_recognition_evidence_environment_check CHECK (
        environment IN ('PRODUCTION', 'SANDBOX', 'TEST')
      ),
      CONSTRAINT ledger_leg_recognition_evidence_namespace_check CHECK (
        namespace_type IN ('CHAIN', 'PROVIDER', 'EVIDENCE')
      ),
      CONSTRAINT ledger_leg_recognition_evidence_type_namespace_check CHECK (
        (reference_type = 'CHAIN_EVENT' AND namespace_type = 'CHAIN')
        OR (reference_type = 'PROVIDER_EVENT' AND namespace_type = 'PROVIDER')
        OR (reference_type = 'FINALITY_EVIDENCE' AND namespace_type = 'EVIDENCE')
      ),
      CONSTRAINT ledger_leg_recognition_evidence_source_id_uuid_v4_check CHECK (
        substring(source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(source_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_recognition_evidence_locator_id_uuid_v4_check CHECK (
        substring(canonical_locator_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(canonical_locator_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_recognition_evidence_policy_ids_uuid_v4_check CHECK (
        substring(recognition_policy_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(recognition_policy_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
        AND substring(recognition_evidence_revision_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(recognition_evidence_revision_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_recognition_evidence_digest_check CHECK (
        octet_length(external_locator_digest) = 32
      ),
      CONSTRAINT ledger_leg_recognition_evidence_time_check CHECK (
        isfinite(effective_at)
        AND isfinite(observed_at)
        AND observed_at >= effective_at
        AND observed_at <= recorded_at
      )
    );

    CREATE TABLE ledger_leg_valuation_plans (
      posting_plan_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      valuation_plan_line_number integer NOT NULL,
      valuation_role text NOT NULL,
      fee_plan_line_number integer,
      asset_revision_id uuid NOT NULL,
      availability text NOT NULL,
      valued_amount_atomic numeric NOT NULL,
      usd_rate_mantissa numeric,
      usd_rate_scale smallint,
      usd_value_mantissa numeric,
      rounding_mode text NOT NULL,
      source_reference_id uuid NOT NULL,
      source_policy_reference_id uuid NOT NULL,
      evidence_reference_id uuid NOT NULL,
      priced_at timestamptz,
      observed_at timestamptz NOT NULL,
      freshness_class text NOT NULL,
      confidence_class text NOT NULL,
      depeg_class text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_leg_valuation_plans_pkey PRIMARY KEY (
        posting_plan_id, valuation_plan_line_number
      ),
      CONSTRAINT ledger_leg_valuation_plans_plan_fk FOREIGN KEY (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_leg_posting_plans (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_valuation_plans_asset_fk FOREIGN KEY (asset_revision_id)
        REFERENCES ledger_assets (asset_revision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_valuation_plans_availability_check CHECK (
        availability IN ('AVAILABLE', 'UNAVAILABLE')
      ),
      CONSTRAINT ledger_leg_valuation_plans_line_number_check CHECK (
        valuation_plan_line_number BETWEEN 1 AND 96
      ),
      CONSTRAINT ledger_leg_valuation_plans_role_shape_check CHECK (
        (
          valuation_role = 'JOURNAL_ASSET_TOTAL'
          AND fee_plan_line_number IS NULL
        ) OR (
          valuation_role = 'FEE_COMPONENT'
          AND fee_plan_line_number BETWEEN 1 AND 32
        )
      ),
      CONSTRAINT ledger_leg_valuation_plans_amount_check CHECK (
        valued_amount_atomic > 0
        AND valued_amount_atomic = trunc(valued_amount_atomic)
        AND valued_amount_atomic <= ${MAX_ATOMIC_AMOUNT}::numeric
      ),
      CONSTRAINT ledger_leg_valuation_plans_rounding_check CHECK (
        rounding_mode = 'ROUND_HALF_EVEN'
      ),
      CONSTRAINT ledger_leg_valuation_plans_value_shape_check CHECK (
        (
          availability = 'AVAILABLE'
          AND usd_rate_mantissa IS NOT NULL
          AND usd_rate_mantissa >= 0
          AND usd_rate_mantissa = trunc(usd_rate_mantissa)
          AND usd_rate_mantissa <= 999999999999999999999999999999999999999999999999999999999999999999999999999999::numeric
          AND usd_rate_scale IS NOT NULL
          AND usd_rate_scale BETWEEN 0 AND 36
          AND usd_value_mantissa IS NOT NULL
          AND usd_value_mantissa >= 0
          AND usd_value_mantissa = trunc(usd_value_mantissa)
          AND usd_value_mantissa <= 999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999::numeric
          AND priced_at IS NOT NULL
          AND freshness_class IN ('CURRENT', 'STALE')
          AND confidence_class IN ('HIGH', 'MEDIUM', 'LOW')
        ) OR (
          availability = 'UNAVAILABLE'
          AND usd_rate_mantissa IS NULL
          AND usd_rate_scale IS NULL
          AND usd_value_mantissa IS NULL
          AND priced_at IS NULL
          AND freshness_class = 'UNAVAILABLE'
          AND confidence_class = 'UNAVAILABLE'
        )
      ),
      CONSTRAINT ledger_leg_valuation_plans_source_ids_uuid_v4_check CHECK (
        substring(source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(source_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(source_policy_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(source_policy_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(evidence_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_valuation_plans_time_check CHECK (
        isfinite(observed_at)
        AND (priced_at IS NULL OR (isfinite(priced_at) AND observed_at >= priced_at))
        AND observed_at <= recorded_at
        AND (priced_at IS NULL OR priced_at <= recorded_at)
      ),
      CONSTRAINT ledger_leg_valuation_plans_depeg_check CHECK (
        depeg_class IN ('NOT_ASSESSED', 'WITHIN_POLICY', 'OUTSIDE_POLICY')
      ),
      CONSTRAINT ledger_leg_valuation_plans_fee_line_unique UNIQUE (
        posting_plan_id, fee_plan_line_number
      )
    );

    CREATE UNIQUE INDEX ledger_leg_valuation_plans_asset_total_unique
      ON ledger_leg_valuation_plans (posting_plan_id, asset_revision_id)
      WHERE valuation_role = 'JOURNAL_ASSET_TOTAL';

    CREATE TABLE ledger_leg_fee_plans (
      posting_plan_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      fee_plan_line_number integer NOT NULL,
      category text NOT NULL,
      asset_revision_id uuid NOT NULL,
      amount_atomic numeric NOT NULL,
      payer_account_id uuid NOT NULL,
      recipient_account_id uuid NOT NULL,
      payer_line_number integer NOT NULL,
      recipient_line_number integer NOT NULL,
      payer_allocation_amount_atomic numeric NOT NULL,
      deduction_mode text NOT NULL,
      fee_rule_reference_id uuid NOT NULL,
      quote_reference_id uuid,
      fee_estimate_snapshot_id uuid,
      adjusts_fee_component_id uuid,
      evidence_reference_type text NOT NULL,
      evidence_environment text NOT NULL,
      evidence_namespace_type text NOT NULL,
      evidence_source_reference_id uuid NOT NULL,
      evidence_policy_reference_id uuid NOT NULL,
      evidence_revision_reference_id uuid NOT NULL,
      canonical_locator_reference_id uuid NOT NULL,
      external_locator_digest bytea NOT NULL,
      evidence_observed_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_leg_fee_plans_pkey PRIMARY KEY (
        posting_plan_id, fee_plan_line_number
      ),
      CONSTRAINT ledger_leg_fee_plans_plan_fk FOREIGN KEY (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_leg_posting_plans (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_fee_plans_asset_fk FOREIGN KEY (asset_revision_id)
        REFERENCES ledger_assets (asset_revision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_fee_plans_payer_account_fk FOREIGN KEY (
        payer_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_fee_plans_recipient_account_fk FOREIGN KEY (
        recipient_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_fee_plans_payer_line_fk FOREIGN KEY (
        posting_plan_id, payer_line_number
      ) REFERENCES ledger_leg_posting_plan_lines (posting_plan_id, plan_line_number)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_fee_plans_recipient_line_fk FOREIGN KEY (
        posting_plan_id, recipient_line_number
      ) REFERENCES ledger_leg_posting_plan_lines (posting_plan_id, plan_line_number)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_fee_plans_category_check CHECK (
        category IN ('PLATFORM', 'NETWORK', 'DEX', 'BRIDGE', 'PROVIDER')
      ),
      CONSTRAINT ledger_leg_fee_plans_line_number_check CHECK (
        fee_plan_line_number BETWEEN 1 AND 32
      ),
      CONSTRAINT ledger_leg_fee_plans_amount_check CHECK (
        amount_atomic > 0
        AND amount_atomic = trunc(amount_atomic)
        AND amount_atomic <= ${MAX_ATOMIC_AMOUNT}::numeric
        AND payer_allocation_amount_atomic = amount_atomic
      ),
      CONSTRAINT ledger_leg_fee_plans_distinct_accounts_check CHECK (
        payer_account_id <> recipient_account_id
        AND payer_line_number <> recipient_line_number
      ),
      CONSTRAINT ledger_leg_fee_plans_deduction_check CHECK (
        deduction_mode IN ('ADDED_ON_TOP', 'DEDUCTED_FROM_INPUT', 'DEDUCTED_FROM_OUTPUT')
      ),
      CONSTRAINT ledger_leg_fee_plans_rule_id_uuid_v4_check CHECK (
        substring(fee_rule_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(fee_rule_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_fee_plans_quote_id_uuid_v4_check CHECK (
        quote_reference_id IS NULL OR (
          substring(quote_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(quote_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        )
      ),
      CONSTRAINT ledger_leg_fee_plans_evidence_environment_check CHECK (
        evidence_environment IN ('PRODUCTION', 'SANDBOX', 'TEST')
      ),
      CONSTRAINT ledger_leg_fee_plans_evidence_type_namespace_check CHECK (
        (evidence_reference_type = 'CHAIN_EVENT' AND evidence_namespace_type = 'CHAIN')
        OR (
          evidence_reference_type = 'PROVIDER_EVENT'
          AND evidence_namespace_type = 'PROVIDER'
        )
        OR (
          evidence_reference_type = 'FINALITY_EVIDENCE'
          AND evidence_namespace_type = 'EVIDENCE'
        )
      ),
      CONSTRAINT ledger_leg_fee_plans_evidence_ids_uuid_v4_check CHECK (
        substring(evidence_source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_source_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
        AND substring(evidence_policy_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_policy_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
        AND substring(evidence_revision_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_revision_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
        AND substring(canonical_locator_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(canonical_locator_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_fee_plans_evidence_digest_check CHECK (
        octet_length(external_locator_digest) = 32
      ),
      CONSTRAINT ledger_leg_fee_plans_evidence_time_check CHECK (
        isfinite(evidence_observed_at) AND evidence_observed_at <= recorded_at
      ),
      CONSTRAINT ledger_leg_fee_plans_recipient_line_unique UNIQUE (
        posting_plan_id, recipient_line_number
      )
    );

    ALTER TABLE ledger_leg_valuation_plans
      ADD CONSTRAINT ledger_leg_valuation_plans_fee_plan_fk FOREIGN KEY (
        posting_plan_id, fee_plan_line_number
      ) REFERENCES ledger_leg_fee_plans (
        posting_plan_id, fee_plan_line_number
      ) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

    CREATE TABLE ledger_leg_posting_plan_seals (
      posting_plan_id uuid PRIMARY KEY,
      leg_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      economic_event_type text NOT NULL,
      sealed_plan_digest bytea NOT NULL UNIQUE,
      approval_reference_id uuid NOT NULL,
      sealed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_leg_posting_plan_seals_plan_fk FOREIGN KEY (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
        economic_event_type
      ) REFERENCES ledger_leg_posting_plans (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
        economic_event_type
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_leg_posting_plan_seals_digest_check CHECK (
        octet_length(sealed_plan_digest) = 32
      ),
      CONSTRAINT ledger_leg_posting_plan_seals_approval_uuid_v4_check CHECK (
        substring(approval_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(approval_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_leg_posting_plan_seals_time_check CHECK (
        isfinite(sealed_at) AND sealed_at = recorded_at
      ),
      CONSTRAINT ledger_leg_posting_plan_seals_scope_unique UNIQUE (
        posting_plan_id, sealed_plan_digest
      ),
      CONSTRAINT ledger_leg_posting_plan_seals_leg_event_unique UNIQUE (
        leg_id, economic_event_type
      )
    );

    CREATE TABLE ledger_journals (
      journal_id uuid PRIMARY KEY,
      book_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      actor_account_id uuid NOT NULL,
      posting_plan_id uuid,
      reversal_approval_id uuid,
      capability_id uuid NOT NULL,
      economic_event_type text NOT NULL,
      effective_at timestamptz NOT NULL,
      observed_at timestamptz NOT NULL,
      reason_code text NOT NULL,
      correlation_id uuid NOT NULL,
      reverses_journal_id uuid,
      compensates_journal_id uuid,
      adjusts_journal_id uuid,
      approval_reference_id uuid,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_journals_id_uuid_v4_check CHECK (
        substring(journal_id::text FROM 15 FOR 1) = '4'
        AND substring(journal_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_journals_transaction_actor_fk FOREIGN KEY (
        transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_transactions (transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journals_leg_fk FOREIGN KEY (
        leg_id, transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_legs (leg_id, transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journals_posting_plan_fk FOREIGN KEY (
        posting_plan_id, leg_id, transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_leg_posting_plans (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journals_reverses_fk FOREIGN KEY (
        reverses_journal_id, book_id, actor_account_id
      ) REFERENCES ledger_journals (journal_id, book_id, actor_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journals_compensates_fk FOREIGN KEY (
        compensates_journal_id, book_id, actor_account_id
      ) REFERENCES ledger_journals (journal_id, book_id, actor_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journals_adjusts_fk FOREIGN KEY (
        adjusts_journal_id, book_id, actor_account_id
      ) REFERENCES ledger_journals (journal_id, book_id, actor_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journals_event_check CHECK (
        economic_event_type IN ('SETTLEMENT', 'ACTUAL_FEE', 'ADJUSTMENT', 'COMPENSATION', 'REVERSAL')
      ),
      CONSTRAINT ledger_journals_reason_event_check CHECK (
        (economic_event_type = 'SETTLEMENT' AND reason_code IN (
          'CHAIN_FINALITY_CONFIRMED', 'PROVIDER_SETTLEMENT_VERIFIED'
        )) OR
        (economic_event_type = 'ACTUAL_FEE' AND reason_code = 'ACTUAL_FEE_CONFIRMED') OR
        (economic_event_type = 'ADJUSTMENT' AND reason_code = 'ACCOUNTING_ADJUSTMENT_APPROVED') OR
        (economic_event_type = 'COMPENSATION' AND reason_code = 'COMPENSATION_SETTLED') OR
        (economic_event_type = 'REVERSAL' AND reason_code IN (
          'RECOGNITION_INVALIDATED', 'CHAIN_REORGANIZATION_CONFIRMED',
          'SOURCE_EVIDENCE_CORRECTED'
        ))
      ),
      CONSTRAINT ledger_journals_observation_order_check CHECK (
        isfinite(effective_at)
        AND isfinite(observed_at)
        AND observed_at >= effective_at
        AND observed_at <= recorded_at
      ),
      CONSTRAINT ledger_journals_correlation_id_uuid_v4_check CHECK (
        substring(correlation_id::text FROM 15 FOR 1) = '4'
        AND substring(correlation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_journals_approval_id_uuid_v4_check CHECK (
        approval_reference_id IS NULL OR (
          substring(approval_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(approval_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        )
      ),
      CONSTRAINT ledger_journals_relation_shape_check CHECK (
        (
          economic_event_type = 'REVERSAL'
          AND posting_plan_id IS NULL
          AND reversal_approval_id IS NOT NULL
          AND reverses_journal_id IS NOT NULL
          AND compensates_journal_id IS NULL
          AND adjusts_journal_id IS NULL
          AND approval_reference_id IS NOT NULL
        ) OR (
          economic_event_type = 'COMPENSATION'
          AND posting_plan_id IS NOT NULL
          AND reversal_approval_id IS NULL
          AND reverses_journal_id IS NULL
          AND compensates_journal_id IS NOT NULL
          AND adjusts_journal_id IS NULL
          AND approval_reference_id IS NULL
        ) OR (
          economic_event_type = 'ADJUSTMENT'
          AND posting_plan_id IS NOT NULL
          AND reversal_approval_id IS NULL
          AND reverses_journal_id IS NULL
          AND compensates_journal_id IS NULL
          AND adjusts_journal_id IS NOT NULL
          AND approval_reference_id IS NULL
        ) OR (
          economic_event_type NOT IN ('REVERSAL', 'COMPENSATION', 'ADJUSTMENT')
          AND posting_plan_id IS NOT NULL
          AND reversal_approval_id IS NULL
          AND reverses_journal_id IS NULL
          AND compensates_journal_id IS NULL
          AND adjusts_journal_id IS NULL
          AND approval_reference_id IS NULL
        )
      ),
      CONSTRAINT ledger_journals_no_self_relation_check CHECK (
        journal_id IS DISTINCT FROM reverses_journal_id
        AND journal_id IS DISTINCT FROM compensates_journal_id
        AND journal_id IS DISTINCT FROM adjusts_journal_id
      ),
      CONSTRAINT ledger_journals_reversal_unique UNIQUE (reverses_journal_id),
      CONSTRAINT ledger_journals_posting_plan_unique UNIQUE (posting_plan_id),
      CONSTRAINT ledger_journals_reversal_approval_unique UNIQUE (reversal_approval_id),
      CONSTRAINT ledger_journals_capability_unique UNIQUE (capability_id),
      CONSTRAINT ledger_journals_book_unique UNIQUE (journal_id, book_id),
      CONSTRAINT ledger_journals_tenant_scope_unique UNIQUE (
        journal_id, book_id, actor_account_id
      ),
      CONSTRAINT ledger_journals_full_scope_unique UNIQUE (
        journal_id, leg_id, transaction_id, book_id, actor_account_id
      ),
      CONSTRAINT ledger_journals_reversal_scope_unique UNIQUE (
        reversal_approval_id, journal_id, leg_id,
        transaction_id, book_id, actor_account_id
      )
    );

    ALTER TABLE ledger_legs
      ADD CONSTRAINT ledger_legs_dependency_fk FOREIGN KEY (
        depends_on_leg_id, transaction_id, book_id
      ) REFERENCES ledger_legs (leg_id, transaction_id, book_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      ADD CONSTRAINT ledger_legs_compensates_journal_fk FOREIGN KEY (
        compensates_journal_id, book_id, tenant_account_id
      ) REFERENCES ledger_journals (journal_id, book_id, actor_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      ADD CONSTRAINT ledger_legs_adjusts_journal_fk FOREIGN KEY (
        adjusts_journal_id, book_id, tenant_account_id
      ) REFERENCES ledger_journals (journal_id, book_id, actor_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT;

    CREATE TABLE ledger_journal_lines (
      journal_id uuid NOT NULL,
      line_number integer NOT NULL,
      book_id uuid NOT NULL,
      ledger_account_id uuid NOT NULL,
      asset_revision_id uuid NOT NULL,
      side text NOT NULL,
      amount_atomic numeric NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_journal_lines_pkey PRIMARY KEY (journal_id, line_number),
      CONSTRAINT ledger_journal_lines_journal_fk FOREIGN KEY (journal_id, book_id)
        REFERENCES ledger_journals (journal_id, book_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journal_lines_account_fk FOREIGN KEY (
        ledger_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journal_lines_number_check CHECK (line_number BETWEEN 1 AND 64),
      CONSTRAINT ledger_journal_lines_side_check CHECK (side IN ('DEBIT', 'CREDIT')),
      CONSTRAINT ledger_journal_lines_amount_check CHECK (
        amount_atomic > 0
        AND amount_atomic = trunc(amount_atomic)
        AND amount_atomic <= ${MAX_ATOMIC_AMOUNT}::numeric
      )
    );

    CREATE INDEX ledger_journal_lines_account_timeline_idx
      ON ledger_journal_lines (ledger_account_id, recorded_at, journal_id, line_number);
    CREATE INDEX ledger_journals_transaction_timeline_idx
      ON ledger_journals (transaction_id, recorded_at, journal_id);
    CREATE INDEX ledger_journals_leg_timeline_idx
      ON ledger_journals (leg_id, recorded_at, journal_id);
    CREATE INDEX ledger_journals_correlation_idx
      ON ledger_journals (correlation_id, recorded_at, journal_id);
    CREATE INDEX ledger_journals_compensation_idx
      ON ledger_journals (compensates_journal_id, recorded_at, journal_id)
      WHERE compensates_journal_id IS NOT NULL;

    CREATE TABLE ledger_reversal_approvals (
      reversal_approval_id uuid PRIMARY KEY,
      original_journal_id uuid NOT NULL UNIQUE,
      transaction_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      reason_code text NOT NULL,
      approval_reference_id uuid NOT NULL,
      evidence_reference_id uuid NOT NULL,
      reference_type text NOT NULL,
      environment text NOT NULL,
      namespace_type text NOT NULL,
      source_reference_id uuid NOT NULL,
      canonical_locator_reference_id uuid NOT NULL,
      external_locator_digest bytea NOT NULL,
      effective_at timestamptz NOT NULL,
      observed_at timestamptz NOT NULL,
      sealed_approval_digest bytea NOT NULL UNIQUE,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_reversal_approvals_id_uuid_v4_check CHECK (
        substring(reversal_approval_id::text FROM 15 FOR 1) = '4'
        AND substring(reversal_approval_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_reversal_approvals_original_fk FOREIGN KEY (
        original_journal_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_journals (
        journal_id, leg_id, transaction_id, book_id, actor_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_reversal_approvals_reason_check CHECK (
        reason_code IN (
          'RECOGNITION_INVALIDATED', 'CHAIN_REORGANIZATION_CONFIRMED',
          'SOURCE_EVIDENCE_CORRECTED'
        )
      ),
      CONSTRAINT ledger_reversal_approvals_reference_ids_uuid_v4_check CHECK (
        substring(approval_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(approval_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(evidence_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(source_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(canonical_locator_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(canonical_locator_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_reversal_approvals_reference_type_check CHECK (
        reference_type IN ('CHAIN_EVENT', 'PROVIDER_EVENT', 'FINALITY_EVIDENCE')
      ),
      CONSTRAINT ledger_reversal_approvals_environment_check CHECK (
        environment IN ('PRODUCTION', 'SANDBOX', 'TEST')
      ),
      CONSTRAINT ledger_reversal_approvals_namespace_check CHECK (
        namespace_type IN ('CHAIN', 'PROVIDER', 'EVIDENCE')
      ),
      CONSTRAINT ledger_reversal_approvals_type_namespace_check CHECK (
        (reference_type = 'CHAIN_EVENT' AND namespace_type = 'CHAIN')
        OR (reference_type = 'PROVIDER_EVENT' AND namespace_type = 'PROVIDER')
        OR (reference_type = 'FINALITY_EVIDENCE' AND namespace_type = 'EVIDENCE')
      ),
      CONSTRAINT ledger_reversal_approvals_external_digest_check CHECK (
        octet_length(external_locator_digest) = 32
      ),
      CONSTRAINT ledger_reversal_approvals_time_check CHECK (
        isfinite(effective_at)
        AND isfinite(observed_at)
        AND observed_at >= effective_at
        AND observed_at <= recorded_at
      ),
      CONSTRAINT ledger_reversal_approvals_digest_check CHECK (
        octet_length(sealed_approval_digest) = 32
      ),
      CONSTRAINT ledger_reversal_approvals_scope_unique UNIQUE (
        reversal_approval_id, original_journal_id, leg_id,
        transaction_id, book_id, tenant_account_id
      ),
      CONSTRAINT ledger_reversal_approvals_digest_scope_unique UNIQUE (
        reversal_approval_id, sealed_approval_digest
      )
    );

    ALTER TABLE ledger_journals
      ADD CONSTRAINT ledger_journals_reversal_approval_fk FOREIGN KEY (
        reversal_approval_id, reverses_journal_id, leg_id,
        transaction_id, book_id, actor_account_id
      ) REFERENCES ledger_reversal_approvals (
        reversal_approval_id, original_journal_id, leg_id,
        transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT;

    CREATE TABLE ledger_command_capabilities (
      capability_id uuid PRIMARY KEY,
      capability_purpose text NOT NULL,
      capability_scheme text NOT NULL,
      token_encoding text NOT NULL,
      hash_algorithm text NOT NULL,
      hash_domain text NOT NULL,
      capability_digest bytea NOT NULL UNIQUE,
      target_digest bytea NOT NULL,
      posting_plan_id uuid,
      reversal_approval_id uuid,
      original_journal_id uuid,
      leg_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      issued_to_account_id uuid NOT NULL,
      issuance_source_reference_id uuid NOT NULL,
      approval_reference_id uuid NOT NULL,
      issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      expires_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_command_capabilities_id_uuid_v4_check CHECK (
        substring(capability_id::text FROM 15 FOR 1) = '4'
        AND substring(capability_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_command_capabilities_digest_check CHECK (
        octet_length(capability_digest) = 32 AND octet_length(target_digest) = 32
      ),
      CONSTRAINT ledger_command_capabilities_hash_contract_check CHECK (
        capability_scheme = 'BEARER_256_V1'
        AND token_encoding = 'LOWER_HEX_32'
        AND hash_algorithm = 'SHA256'
        AND (
          (capability_purpose = 'POST' AND hash_domain = 'KAN41:POST:v1')
          OR (capability_purpose = 'REVERSE' AND hash_domain = 'KAN41:REVERSE:v1')
        )
      ),
      CONSTRAINT ledger_command_capabilities_issued_to_fk FOREIGN KEY (issued_to_account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_capabilities_post_plan_fk FOREIGN KEY (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_leg_posting_plans (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_capabilities_post_seal_fk FOREIGN KEY (
        posting_plan_id, target_digest
      ) REFERENCES ledger_leg_posting_plan_seals (
        posting_plan_id, sealed_plan_digest
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_capabilities_reversal_approval_fk FOREIGN KEY (
        reversal_approval_id, original_journal_id, leg_id,
        transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_reversal_approvals (
        reversal_approval_id, original_journal_id, leg_id,
        transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_capabilities_reversal_digest_fk FOREIGN KEY (
        reversal_approval_id, target_digest
      ) REFERENCES ledger_reversal_approvals (
        reversal_approval_id, sealed_approval_digest
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_capabilities_purpose_shape_check CHECK (
        (
          capability_purpose = 'POST'
          AND posting_plan_id IS NOT NULL
          AND reversal_approval_id IS NULL
          AND original_journal_id IS NULL
        ) OR (
          capability_purpose = 'REVERSE'
          AND posting_plan_id IS NULL
          AND reversal_approval_id IS NOT NULL
          AND original_journal_id IS NOT NULL
        )
      ),
      CONSTRAINT ledger_command_capabilities_issued_to_scope_check CHECK (
        issued_to_account_id = tenant_account_id
      ),
      CONSTRAINT ledger_command_capabilities_reference_ids_uuid_v4_check CHECK (
        substring(issuance_source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(issuance_source_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(approval_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(approval_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_command_capabilities_time_check CHECK (
        isfinite(issued_at)
        AND isfinite(expires_at)
        AND issued_at = recorded_at
        AND expires_at > issued_at
      )
    );

    CREATE INDEX ledger_command_capabilities_post_target_idx
      ON ledger_command_capabilities (posting_plan_id, issued_at, capability_id)
      WHERE posting_plan_id IS NOT NULL;
    CREATE INDEX ledger_command_capabilities_reverse_target_idx
      ON ledger_command_capabilities (reversal_approval_id, issued_at, capability_id)
      WHERE reversal_approval_id IS NOT NULL;

    ALTER TABLE ledger_journals
      ADD CONSTRAINT ledger_journals_capability_fk FOREIGN KEY (capability_id)
        REFERENCES ledger_command_capabilities (capability_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT;

    CREATE TABLE ledger_command_capability_resolutions (
      capability_id uuid PRIMARY KEY,
      outcome text NOT NULL,
      journal_id uuid UNIQUE,
      resolution_reason_code text NOT NULL,
      approval_reference_id uuid,
      resolved_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_command_capability_resolutions_capability_fk
        FOREIGN KEY (capability_id) REFERENCES ledger_command_capabilities (capability_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_command_capability_resolutions_journal_fk
        FOREIGN KEY (journal_id) REFERENCES ledger_journals (journal_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT ledger_command_capability_resolutions_shape_check CHECK (
        (
          outcome = 'CONSUMED'
          AND journal_id IS NOT NULL
          AND resolution_reason_code = 'COMMAND_COMMITTED'
          AND approval_reference_id IS NULL
        ) OR (
          outcome = 'REVOKED'
          AND journal_id IS NULL
          AND resolution_reason_code IN (
            'APPROVAL_WITHDRAWN', 'SECURITY_REVOKED', 'SUPERSEDED'
          )
          AND approval_reference_id IS NOT NULL
        )
      ),
      CONSTRAINT ledger_command_capability_resolutions_approval_uuid_v4_check CHECK (
        approval_reference_id IS NULL OR (
          substring(approval_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(approval_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        )
      ),
      CONSTRAINT ledger_command_capability_resolutions_time_check CHECK (
        isfinite(resolved_at) AND resolved_at = recorded_at
      )
    );
  `;
}

function createLedgerMetadataSql(): string {
  return `
    CREATE TABLE ledger_valuation_snapshots (
      valuation_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      book_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      journal_id uuid,
      purpose text NOT NULL,
      valuation_plan_line_number integer,
      valuation_role text NOT NULL,
      fee_plan_line_number integer,
      availability text NOT NULL,
      asset_revision_id uuid NOT NULL,
      valued_amount_atomic numeric NOT NULL,
      usd_rate_mantissa numeric,
      usd_rate_scale smallint,
      usd_value_mantissa numeric,
      rounding_mode text NOT NULL,
      source_reference_id uuid NOT NULL,
      source_policy_reference_id uuid NOT NULL,
      evidence_reference_id uuid NOT NULL,
      reverses_valuation_snapshot_id uuid,
      backfills_valuation_snapshot_id uuid,
      priced_at timestamptz,
      observed_at timestamptz NOT NULL,
      backfilled_at timestamptz,
      freshness_class text NOT NULL,
      confidence_class text NOT NULL,
      depeg_class text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_valuation_snapshots_id_uuid_v4_check CHECK (
        substring(valuation_snapshot_id::text FROM 15 FOR 1) = '4'
        AND substring(valuation_snapshot_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_valuation_snapshots_leg_fk FOREIGN KEY (
        leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_legs (leg_id, transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_valuation_snapshots_journal_fk FOREIGN KEY (
        journal_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_journals (
        journal_id, leg_id, transaction_id, book_id, actor_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_valuation_snapshots_asset_fk FOREIGN KEY (asset_revision_id)
        REFERENCES ledger_assets (asset_revision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_valuation_snapshots_purpose_check CHECK (
        purpose IN ('QUOTE', 'SETTLEMENT', 'REVERSAL', 'ADJUSTMENT', 'BACKFILL')
      ),
      CONSTRAINT ledger_valuation_snapshots_journal_shape_check CHECK (
        (purpose = 'QUOTE' AND journal_id IS NULL)
        OR (purpose <> 'QUOTE' AND journal_id IS NOT NULL)
      ),
      CONSTRAINT ledger_valuation_snapshots_plan_shape_check CHECK (
        (
          purpose = 'QUOTE'
          AND valuation_plan_line_number IS NULL
          AND valuation_role = 'FEE_COMPONENT'
          AND fee_plan_line_number IS NULL
        ) OR (
          purpose <> 'QUOTE'
          AND valuation_plan_line_number BETWEEN 1 AND 96
          AND (
            (
              valuation_role = 'JOURNAL_ASSET_TOTAL'
              AND fee_plan_line_number IS NULL
            ) OR (
              valuation_role = 'FEE_COMPONENT'
              AND fee_plan_line_number BETWEEN 1 AND 32
            )
          )
        )
      ),
      CONSTRAINT ledger_valuation_snapshots_availability_check CHECK (
        availability IN ('AVAILABLE', 'UNAVAILABLE')
      ),
      CONSTRAINT ledger_valuation_snapshots_amount_check CHECK (
        valued_amount_atomic >= 0
        AND valued_amount_atomic = trunc(valued_amount_atomic)
        AND valued_amount_atomic <= ${MAX_ATOMIC_AMOUNT}::numeric
      ),
      CONSTRAINT ledger_valuation_snapshots_rounding_check CHECK (
        rounding_mode = 'ROUND_HALF_EVEN'
      ),
      CONSTRAINT ledger_valuation_snapshots_source_id_uuid_v4_check CHECK (
        substring(source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(source_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_valuation_snapshots_policy_id_uuid_v4_check CHECK (
        substring(source_policy_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(source_policy_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_valuation_snapshots_evidence_id_uuid_v4_check CHECK (
        substring(evidence_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_valuation_snapshots_value_shape_check CHECK (
        (
          availability = 'AVAILABLE'
          AND usd_rate_mantissa IS NOT NULL
          AND usd_rate_mantissa >= 0
          AND usd_rate_mantissa = trunc(usd_rate_mantissa)
          AND usd_rate_mantissa <= 999999999999999999999999999999999999999999999999999999999999999999999999999999::numeric
          AND usd_rate_scale IS NOT NULL
          AND usd_rate_scale BETWEEN 0 AND 36
          AND usd_value_mantissa IS NOT NULL
          AND usd_value_mantissa >= 0
          AND usd_value_mantissa = trunc(usd_value_mantissa)
          AND usd_value_mantissa <= 999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999::numeric
          AND priced_at IS NOT NULL
          AND freshness_class IN ('CURRENT', 'STALE')
          AND confidence_class IN ('HIGH', 'MEDIUM', 'LOW')
        ) OR (
          availability = 'UNAVAILABLE'
          AND usd_rate_mantissa IS NULL
          AND usd_rate_scale IS NULL
          AND usd_value_mantissa IS NULL
          AND priced_at IS NULL
          AND freshness_class = 'UNAVAILABLE'
          AND confidence_class = 'UNAVAILABLE'
        )
      ),
      CONSTRAINT ledger_valuation_snapshots_depeg_check CHECK (
        depeg_class IN ('NOT_ASSESSED', 'WITHIN_POLICY', 'OUTSIDE_POLICY')
      ),
      CONSTRAINT ledger_valuation_snapshots_time_check CHECK (
        isfinite(observed_at)
        AND (priced_at IS NULL OR (isfinite(priced_at) AND observed_at >= priced_at))
        AND observed_at <= recorded_at
        AND (priced_at IS NULL OR priced_at <= recorded_at)
      ),
      CONSTRAINT ledger_valuation_snapshots_backfill_check CHECK (
        (purpose = 'BACKFILL') = (backfilled_at IS NOT NULL)
        AND (
          backfilled_at IS NULL
          OR (
            isfinite(backfilled_at)
            AND backfilled_at >= observed_at
            AND backfilled_at <= recorded_at
          )
        )
      ),
      CONSTRAINT ledger_valuation_snapshots_reversal_shape_check CHECK (
        (purpose = 'REVERSAL') = (reverses_valuation_snapshot_id IS NOT NULL)
        AND (purpose = 'BACKFILL') = (backfills_valuation_snapshot_id IS NOT NULL)
        AND NOT (
          reverses_valuation_snapshot_id IS NOT NULL
          AND backfills_valuation_snapshot_id IS NOT NULL
        )
        AND valuation_snapshot_id IS DISTINCT FROM reverses_valuation_snapshot_id
        AND valuation_snapshot_id IS DISTINCT FROM backfills_valuation_snapshot_id
      ),
      CONSTRAINT ledger_valuation_snapshots_reversal_unique UNIQUE (
        reverses_valuation_snapshot_id
      ),
      CONSTRAINT ledger_valuation_snapshots_scope_unique UNIQUE (
        valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ),
      CONSTRAINT ledger_valuation_snapshots_journal_scope_unique UNIQUE (
        valuation_snapshot_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ),
      CONSTRAINT ledger_valuation_snapshots_reversal_fk FOREIGN KEY (
        reverses_valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) REFERENCES ledger_valuation_snapshots (
        valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_valuation_snapshots_backfill_unique UNIQUE (
        backfills_valuation_snapshot_id
      ),
      CONSTRAINT ledger_valuation_snapshots_backfill_fk FOREIGN KEY (
        backfills_valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) REFERENCES ledger_valuation_snapshots (
        valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT
    );

    CREATE INDEX ledger_valuation_source_timeline_idx
      ON ledger_valuation_snapshots (source_reference_id, observed_at, valuation_snapshot_id);
    CREATE INDEX ledger_valuation_transaction_timeline_idx
      ON ledger_valuation_snapshots (transaction_id, observed_at, valuation_snapshot_id);
    CREATE UNIQUE INDEX ledger_valuation_snapshots_base_plan_line_unique
      ON ledger_valuation_snapshots (journal_id, valuation_plan_line_number)
      WHERE purpose IN ('SETTLEMENT', 'ADJUSTMENT', 'REVERSAL');

    CREATE TABLE ledger_fee_estimate_snapshots (
      fee_estimate_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      book_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      estimate_line_number integer NOT NULL,
      quote_reference_id uuid,
      route_reference_id uuid,
      fee_rule_reference_id uuid NOT NULL,
      provider_revision_reference_id uuid NOT NULL,
      configuration_revision_reference_id uuid NOT NULL,
      category text NOT NULL,
      deduction_mode text NOT NULL,
      asset_revision_id uuid NOT NULL,
      amount_atomic numeric NOT NULL,
      payer_account_id uuid NOT NULL,
      recipient_account_id uuid NOT NULL,
      valuation_snapshot_id uuid NOT NULL,
      evidence_reference_type text NOT NULL,
      evidence_environment text NOT NULL,
      evidence_namespace_type text NOT NULL,
      evidence_source_reference_id uuid NOT NULL,
      evidence_policy_reference_id uuid NOT NULL,
      evidence_revision_reference_id uuid NOT NULL,
      canonical_locator_reference_id uuid NOT NULL,
      external_locator_digest bytea NOT NULL,
      evidence_observed_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_fee_estimate_snapshots_id_uuid_v4_check CHECK (
        substring(fee_estimate_snapshot_id::text FROM 15 FOR 1) = '4'
        AND substring(fee_estimate_snapshot_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_leg_fk FOREIGN KEY (
        leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_legs (leg_id, transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_estimate_snapshots_asset_fk FOREIGN KEY (asset_revision_id)
        REFERENCES ledger_assets (asset_revision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_estimate_snapshots_payer_fk FOREIGN KEY (
        payer_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_estimate_snapshots_recipient_fk FOREIGN KEY (
        recipient_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_estimate_snapshots_valuation_fk FOREIGN KEY (
        valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) REFERENCES ledger_valuation_snapshots (
        valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_estimate_snapshots_reference_ids_uuid_v4_check CHECK (
        (quote_reference_id IS NULL OR (
          substring(quote_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(quote_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        ))
        AND (route_reference_id IS NULL OR (
          substring(route_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(route_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        ))
        AND substring(fee_rule_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(fee_rule_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(provider_revision_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(provider_revision_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(configuration_revision_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(configuration_revision_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
        AND substring(evidence_source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_source_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(evidence_policy_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_policy_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(evidence_revision_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_revision_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(canonical_locator_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(canonical_locator_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_category_check CHECK (
        category IN ('PLATFORM', 'NETWORK', 'DEX', 'BRIDGE', 'PROVIDER')
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_line_number_check CHECK (
        estimate_line_number BETWEEN 1 AND 32
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_deduction_check CHECK (
        deduction_mode IN ('ADDED_ON_TOP', 'DEDUCTED_FROM_INPUT', 'DEDUCTED_FROM_OUTPUT')
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_amount_check CHECK (
        amount_atomic >= 0
        AND amount_atomic = trunc(amount_atomic)
        AND amount_atomic <= ${MAX_ATOMIC_AMOUNT}::numeric
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_distinct_accounts_check CHECK (
        payer_account_id <> recipient_account_id
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_evidence_type_check CHECK (
        evidence_reference_type IN ('QUOTE', 'PROVIDER_EVENT')
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_evidence_environment_check CHECK (
        evidence_environment IN ('PRODUCTION', 'SANDBOX', 'TEST')
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_evidence_namespace_check CHECK (
        evidence_namespace_type IN ('QUOTE', 'PROVIDER')
      ),
      CONSTRAINT ledger_fee_estimate_evidence_type_namespace_check CHECK (
        (evidence_reference_type = 'QUOTE' AND evidence_namespace_type = 'QUOTE')
        OR (
          evidence_reference_type = 'PROVIDER_EVENT'
          AND evidence_namespace_type = 'PROVIDER'
        )
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_evidence_digest_check CHECK (
        octet_length(external_locator_digest) = 32
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_time_check CHECK (
        isfinite(evidence_observed_at) AND evidence_observed_at <= recorded_at
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_quote_line_unique UNIQUE NULLS NOT DISTINCT (
        leg_id, quote_reference_id, estimate_line_number
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_scope_unique UNIQUE (
        fee_estimate_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ),
      CONSTRAINT ledger_fee_estimate_snapshots_valuation_unique UNIQUE (
        valuation_snapshot_id
      )
    );

    CREATE INDEX ledger_fee_estimate_snapshots_transaction_idx
      ON ledger_fee_estimate_snapshots (
        transaction_id, recorded_at, fee_estimate_snapshot_id
      );

    CREATE TABLE ledger_fee_components (
      fee_component_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      book_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      journal_id uuid NOT NULL,
      valuation_snapshot_id uuid NOT NULL,
      source_external_reference_id uuid NOT NULL,
      fee_estimate_snapshot_id uuid,
      category text NOT NULL,
      stage text NOT NULL,
      fee_plan_line_number integer NOT NULL,
      asset_revision_id uuid NOT NULL,
      amount_atomic numeric NOT NULL,
      payer_account_id uuid NOT NULL,
      recipient_account_id uuid NOT NULL,
      payer_line_number integer NOT NULL,
      recipient_line_number integer NOT NULL,
      deduction_mode text NOT NULL,
      fee_rule_reference_id uuid NOT NULL,
      quote_reference_id uuid,
      adjusts_fee_component_id uuid,
      reverses_fee_component_id uuid,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_fee_components_id_uuid_v4_check CHECK (
        substring(fee_component_id::text FROM 15 FOR 1) = '4'
        AND substring(fee_component_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_fee_components_leg_fk FOREIGN KEY (
        leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_legs (leg_id, transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_journal_fk FOREIGN KEY (
        journal_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_journals (
        journal_id, leg_id, transaction_id, book_id, actor_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_asset_fk FOREIGN KEY (asset_revision_id)
        REFERENCES ledger_assets (asset_revision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_payer_fk FOREIGN KEY (
        payer_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_recipient_fk FOREIGN KEY (
        recipient_account_id, book_id, asset_revision_id
      ) REFERENCES ledger_accounts (ledger_account_id, book_id, asset_revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_payer_line_fk FOREIGN KEY (
        journal_id, payer_line_number
      ) REFERENCES ledger_journal_lines (journal_id, line_number)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_recipient_line_fk FOREIGN KEY (
        journal_id, recipient_line_number
      ) REFERENCES ledger_journal_lines (journal_id, line_number)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_valuation_fk FOREIGN KEY (
        valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) REFERENCES ledger_valuation_snapshots (
        valuation_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      )
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_journal_valuation_fk FOREIGN KEY (
        valuation_snapshot_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) REFERENCES ledger_valuation_snapshots (
        valuation_snapshot_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_adjusts_fk FOREIGN KEY (adjusts_fee_component_id)
        REFERENCES ledger_fee_components (fee_component_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_reverses_fk FOREIGN KEY (reverses_fee_component_id)
        REFERENCES ledger_fee_components (fee_component_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_fee_components_category_check CHECK (
        category IN ('PLATFORM', 'NETWORK', 'DEX', 'BRIDGE', 'PROVIDER')
      ),
      CONSTRAINT ledger_fee_components_stage_check CHECK (
        stage IN ('ACTUAL', 'ADJUSTMENT')
      ),
      CONSTRAINT ledger_fee_components_amount_check CHECK (
        amount_atomic > 0
        AND amount_atomic = trunc(amount_atomic)
        AND amount_atomic <= ${MAX_ATOMIC_AMOUNT}::numeric
      ),
      CONSTRAINT ledger_fee_components_distinct_accounts_check CHECK (
        payer_account_id <> recipient_account_id
      ),
      CONSTRAINT ledger_fee_components_deduction_check CHECK (
        deduction_mode IN ('ADDED_ON_TOP', 'DEDUCTED_FROM_INPUT', 'DEDUCTED_FROM_OUTPUT')
      ),
      CONSTRAINT ledger_fee_components_actual_shape_check CHECK (
        fee_plan_line_number BETWEEN 1 AND 32
        AND payer_line_number <> recipient_line_number
      ),
      CONSTRAINT ledger_fee_components_adjustment_shape_check CHECK (
        (stage = 'ADJUSTMENT') = (adjusts_fee_component_id IS NOT NULL)
        AND fee_component_id IS DISTINCT FROM adjusts_fee_component_id
        AND fee_component_id IS DISTINCT FROM reverses_fee_component_id
      ),
      CONSTRAINT ledger_fee_components_rule_id_uuid_v4_check CHECK (
        substring(fee_rule_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(fee_rule_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_fee_components_quote_id_uuid_v4_check CHECK (
        quote_reference_id IS NULL OR (
          substring(quote_reference_id::text FROM 15 FOR 1) = '4'
          AND substring(quote_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        )
      ),
      CONSTRAINT ledger_fee_components_plan_line_unique UNIQUE (
        journal_id, fee_plan_line_number
      ),
      CONSTRAINT ledger_fee_components_reversal_unique UNIQUE (
        reverses_fee_component_id
      )
    );

    CREATE INDEX ledger_fee_components_transaction_idx
      ON ledger_fee_components (transaction_id, recorded_at, fee_component_id);

    CREATE TABLE ledger_external_evidence (
      external_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reference_type text NOT NULL,
      environment text NOT NULL,
      namespace_type text NOT NULL,
      source_reference_id uuid NOT NULL,
      canonical_locator_reference_id uuid NOT NULL,
      external_locator_digest bytea NOT NULL,
      locator_digest_algorithm text NOT NULL,
      canonicalization_version smallint NOT NULL,
      observed_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_external_evidence_id_uuid_v4_check CHECK (
        substring(external_evidence_id::text FROM 15 FOR 1) = '4'
        AND substring(external_evidence_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_external_evidence_type_check CHECK (
        reference_type IN (
          'CHAIN_EVENT', 'PROVIDER_EVENT', 'QUOTE', 'FINALITY_EVIDENCE',
          'REFUND', 'COMPENSATION'
        )
      ),
      CONSTRAINT ledger_external_evidence_environment_check CHECK (
        environment IN ('PRODUCTION', 'SANDBOX', 'TEST')
      ),
      CONSTRAINT ledger_external_evidence_namespace_check CHECK (
        namespace_type IN ('CHAIN', 'PROVIDER', 'QUOTE', 'EVIDENCE')
      ),
      CONSTRAINT ledger_external_evidence_type_namespace_check CHECK (
        (reference_type = 'QUOTE' AND namespace_type = 'QUOTE')
        OR (reference_type = 'CHAIN_EVENT' AND namespace_type = 'CHAIN')
        OR (reference_type = 'PROVIDER_EVENT' AND namespace_type = 'PROVIDER')
        OR (reference_type = 'FINALITY_EVIDENCE' AND namespace_type = 'EVIDENCE')
        OR (
          reference_type IN ('REFUND', 'COMPENSATION')
          AND namespace_type IN ('CHAIN', 'PROVIDER')
        )
      ),
      CONSTRAINT ledger_external_evidence_source_id_uuid_v4_check CHECK (
        substring(source_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(source_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_external_evidence_locator_id_uuid_v4_check CHECK (
        substring(canonical_locator_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(canonical_locator_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_external_evidence_digest_check CHECK (
        octet_length(external_locator_digest) = 32
        AND locator_digest_algorithm = 'SHA256'
        AND canonicalization_version = 1
      ),
      CONSTRAINT ledger_external_evidence_observed_at_check CHECK (
        isfinite(observed_at) AND observed_at <= recorded_at
      ),
      CONSTRAINT ledger_external_evidence_occurrence_unique UNIQUE (
        environment, reference_type, namespace_type, source_reference_id,
        external_locator_digest
      ),
      CONSTRAINT ledger_external_evidence_scope_unique UNIQUE (
        external_evidence_id, environment, reference_type, namespace_type,
        source_reference_id, external_locator_digest
      )
    );

    CREATE TABLE ledger_external_evidence_claims (
      external_evidence_id uuid NOT NULL,
      journal_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      book_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_external_evidence_claims_pkey PRIMARY KEY (
        external_evidence_id, journal_id
      ),
      CONSTRAINT ledger_external_evidence_claims_evidence_fk FOREIGN KEY (
        external_evidence_id
      ) REFERENCES ledger_external_evidence (external_evidence_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_external_evidence_claims_journal_fk FOREIGN KEY (
        journal_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_journals (
        journal_id, leg_id, transaction_id, book_id, actor_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_external_evidence_claims_scope_unique UNIQUE (
        external_evidence_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      )
    );

    CREATE TABLE ledger_journal_external_reference_usages (
      external_reference_usage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      external_evidence_id uuid NOT NULL,
      book_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      leg_id uuid NOT NULL,
      tenant_account_id uuid NOT NULL,
      journal_id uuid NOT NULL,
      posting_plan_id uuid,
      reversal_approval_id uuid,
      related_external_reference_usage_id uuid,
      relation_type text,
      reference_role text NOT NULL,
      reference_usage text NOT NULL,
      policy_reference_id uuid NOT NULL,
      evidence_revision_reference_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT ledger_journal_external_reference_usages_id_uuid_v4_check CHECK (
        substring(external_reference_usage_id::text FROM 15 FOR 1) = '4'
        AND substring(external_reference_usage_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_journal_external_reference_usages_claim_fk FOREIGN KEY (
        external_evidence_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      ) REFERENCES ledger_external_evidence_claims (
        external_evidence_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journal_external_reference_usages_journal_fk FOREIGN KEY (
        journal_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_journals (
        journal_id, leg_id, transaction_id, book_id, actor_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journal_external_reference_usages_posting_plan_fk FOREIGN KEY (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) REFERENCES ledger_leg_posting_plans (
        posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journal_external_reference_usages_reversal_approval_fk FOREIGN KEY (
        reversal_approval_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      ) REFERENCES ledger_journals (
        reversal_approval_id, journal_id, leg_id, transaction_id, book_id,
        actor_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journal_external_reference_usages_related_fk FOREIGN KEY (
        related_external_reference_usage_id
      ) REFERENCES ledger_journal_external_reference_usages (
        external_reference_usage_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ledger_journal_external_reference_usages_role_check CHECK (
        reference_role IN ('SETTLEMENT', 'FEE', 'COMPENSATION', 'ADJUSTMENT', 'REVERSAL')
      ),
      CONSTRAINT ledger_journal_external_reference_usages_usage_check CHECK (
        reference_usage IN ('PRIMARY_RECOGNITION', 'FEE_EVIDENCE')
      ),
      CONSTRAINT ledger_journal_ref_usages_policy_ids_uuid_v4_check CHECK (
        substring(policy_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(policy_reference_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(evidence_revision_reference_id::text FROM 15 FOR 1) = '4'
        AND substring(evidence_revision_reference_id::text FROM 20 FOR 1)
          IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT ledger_journal_external_reference_usages_role_shape_check CHECK (
        (
          reference_usage = 'PRIMARY_RECOGNITION'
          AND reference_role IN ('SETTLEMENT', 'FEE')
          AND posting_plan_id IS NOT NULL
          AND reversal_approval_id IS NULL
          AND related_external_reference_usage_id IS NULL
          AND relation_type IS NULL
        ) OR (
          reference_usage = 'PRIMARY_RECOGNITION'
          AND reference_role IN ('COMPENSATION', 'ADJUSTMENT')
          AND posting_plan_id IS NOT NULL
          AND reversal_approval_id IS NULL
          AND related_external_reference_usage_id IS NOT NULL
          AND relation_type = CASE reference_role
            WHEN 'COMPENSATION' THEN 'COMPENSATES'
            ELSE 'SUPERSEDES'
          END
        ) OR (
          reference_usage = 'PRIMARY_RECOGNITION'
          AND reference_role = 'REVERSAL'
          AND posting_plan_id IS NULL
          AND reversal_approval_id IS NOT NULL
          AND related_external_reference_usage_id IS NOT NULL
          AND relation_type = 'REVERSAL_OF'
        ) OR (
          reference_usage = 'FEE_EVIDENCE'
          AND reference_role = 'FEE'
          AND posting_plan_id IS NOT NULL
          AND reversal_approval_id IS NULL
          AND related_external_reference_usage_id IS NULL
          AND relation_type IS NULL
        ) OR (
          reference_usage = 'FEE_EVIDENCE'
          AND reference_role = 'FEE'
          AND posting_plan_id IS NULL
          AND reversal_approval_id IS NOT NULL
          AND related_external_reference_usage_id IS NOT NULL
          AND relation_type = 'REVERSAL_OF'
        )
      ),
      CONSTRAINT ledger_journal_external_reference_usages_scope_unique UNIQUE (
        external_reference_usage_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      )
    );

    CREATE UNIQUE INDEX ledger_journal_external_reference_usages_primary_unique
      ON ledger_journal_external_reference_usages (journal_id)
      WHERE reference_usage = 'PRIMARY_RECOGNITION';
    CREATE UNIQUE INDEX ledger_journal_external_reference_usages_primary_fact_unique
      ON ledger_journal_external_reference_usages (external_evidence_id)
      WHERE reference_usage = 'PRIMARY_RECOGNITION'
          AND reference_role <> 'REVERSAL';
    CREATE UNIQUE INDEX ledger_journal_external_reference_usages_fee_fact_unique
      ON ledger_journal_external_reference_usages (external_evidence_id)
      WHERE reference_usage = 'FEE_EVIDENCE'
        AND reversal_approval_id IS NULL;
    CREATE UNIQUE INDEX ledger_journal_ref_usages_reversal_relation_unique
      ON ledger_journal_external_reference_usages (
        journal_id, related_external_reference_usage_id
      ) WHERE reversal_approval_id IS NOT NULL;

    ALTER TABLE ledger_fee_components
      ADD CONSTRAINT ledger_fee_components_source_reference_fk FOREIGN KEY (
        source_external_reference_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      ) REFERENCES ledger_journal_external_reference_usages (
        external_reference_usage_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT;


    ALTER TABLE ledger_leg_fee_plans
      ADD CONSTRAINT ledger_leg_fee_plans_estimate_fk FOREIGN KEY (
        fee_estimate_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) REFERENCES ledger_fee_estimate_snapshots (
        fee_estimate_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      ADD CONSTRAINT ledger_leg_fee_plans_adjusts_component_fk FOREIGN KEY (
        adjusts_fee_component_id
      ) REFERENCES ledger_fee_components (fee_component_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT;

    ALTER TABLE ledger_fee_components
      ADD CONSTRAINT ledger_fee_components_estimate_fk FOREIGN KEY (
        fee_estimate_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) REFERENCES ledger_fee_estimate_snapshots (
        fee_estimate_snapshot_id, leg_id, transaction_id, book_id,
        tenant_account_id, asset_revision_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT;

    CREATE INDEX ledger_external_evidence_locator_idx
      ON ledger_external_evidence (
        environment, reference_type, source_reference_id, external_locator_digest
      );
    CREATE INDEX ledger_journal_external_reference_usages_transaction_idx
      ON ledger_journal_external_reference_usages (
        transaction_id, recorded_at, external_reference_usage_id
      );
  `;
}

function createLedgerFunctionsSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const securedRelationNames = ['accounts', ...LEDGER_TABLES]
    .map((relationName) => literal(relationName, 'secured ledger relation'))
    .join(', ');

  return `
    CREATE FUNCTION reject_ledger_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      RAISE EXCEPTION 'ledger records are append-only' USING ERRCODE = '55000';
    END;
    $$;

    CREATE FUNCTION validate_ledger_posting_plan_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      target_leg_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.leg_id ELSE NEW.leg_id END;
      expected_source_account_id uuid;
      expected_destination_account_id uuid;
      expected_asset_revision_id uuid;
      expected_amount_atomic numeric;
      expected_source_posting_amount numeric;
      expected_destination_posting_amount numeric;
      line_count bigint;
      distinct_account_count bigint;
      minimum_line_number integer;
      maximum_line_number integer;
    BEGIN
      SELECT leg.source_account_id,
             leg.destination_account_id,
             leg.asset_revision_id,
             leg.expected_amount_atomic
      INTO expected_source_account_id,
           expected_destination_account_id,
           expected_asset_revision_id,
           expected_amount_atomic
      FROM ledger_legs AS leg
      WHERE leg.leg_id = target_leg_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger posting plan leg is missing' USING ERRCODE = '23503';
      END IF;

      IF target_leg_kind IN ('FEE_PAYMENT', 'ADJUSTMENT') THEN
        expected_source_posting_amount := expected_amount_atomic;
        expected_destination_posting_amount := expected_amount_atomic;
      ELSE
        SELECT expected_amount_atomic + coalesce(sum(fee.amount_atomic) FILTER (
                 WHERE fee.deduction_mode = 'ADDED_ON_TOP'
               ), 0),
               expected_amount_atomic - coalesce(sum(fee.amount_atomic) FILTER (
                 WHERE fee.deduction_mode IN ('DEDUCTED_FROM_INPUT', 'DEDUCTED_FROM_OUTPUT')
               ), 0)
        INTO expected_source_posting_amount, expected_destination_posting_amount
        FROM ledger_leg_fee_plans AS fee
        WHERE fee.posting_plan_id = target_posting_plan_id
          AND fee.asset_revision_id = expected_asset_revision_id;
        IF expected_destination_posting_amount <= 0 THEN
          RAISE EXCEPTION 'ledger fee deductions exhaust the leg amount'
            USING ERRCODE = '23514';
        END IF;
      END IF;

      SELECT count(*),
             count(DISTINCT plan.ledger_account_id),
             min(plan.plan_line_number),
             max(plan.plan_line_number)
      INTO line_count, distinct_account_count, minimum_line_number, maximum_line_number
      FROM ledger_leg_posting_plan_lines AS plan
      WHERE plan.leg_id = target_leg_id;
      IF line_count < 2
        OR distinct_account_count < 2
        OR minimum_line_number <> 1
        OR maximum_line_number <> line_count
      THEN
        RAISE EXCEPTION 'ledger posting plan requires contiguous lines across two accounts'
          USING ERRCODE = '23514';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM ledger_leg_posting_plan_lines AS plan
        WHERE plan.leg_id = target_leg_id
          AND plan.ledger_account_id = expected_source_account_id
          AND plan.asset_revision_id = expected_asset_revision_id
          AND plan.side = 'CREDIT'
          AND plan.amount_atomic = expected_amount_atomic
      ) OR NOT EXISTS (
        SELECT 1 FROM ledger_leg_posting_plan_lines AS plan
        WHERE plan.leg_id = target_leg_id
          AND plan.ledger_account_id = expected_destination_account_id
          AND plan.asset_revision_id = expected_asset_revision_id
          AND plan.side = 'DEBIT'
          AND plan.amount_atomic = expected_amount_atomic
      ) THEN
        RAISE EXCEPTION 'ledger posting plan does not contain the exact leg movement'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_posting_plan_lines AS plan
        INNER JOIN ledger_accounts AS account
          ON account.ledger_account_id = plan.ledger_account_id
        WHERE plan.leg_id = target_leg_id
          AND account.owner_kind = 'ACCOUNT'
          AND account.owner_account_id <> plan.tenant_account_id
      ) THEN
        RAISE EXCEPTION 'ledger posting plan contains an unauthorized account'
          USING ERRCODE = '42501';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_posting_plan_lines AS plan
        WHERE plan.leg_id = target_leg_id
        GROUP BY plan.asset_revision_id
        HAVING sum(CASE WHEN plan.side = 'DEBIT' THEN plan.amount_atomic ELSE 0 END)
          <> sum(CASE WHEN plan.side = 'CREDIT' THEN plan.amount_atomic ELSE 0 END)
      ) THEN
        RAISE EXCEPTION 'ledger posting plan is not balanced by asset' USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_journals AS journal
        WHERE journal.leg_id = target_leg_id
          AND journal.economic_event_type <> 'REVERSAL'
          AND EXISTS (
            SELECT 1
            FROM (
              (
                SELECT plan.plan_line_number,
                       plan.ledger_account_id,
                       plan.asset_revision_id,
                       plan.side,
                       plan.amount_atomic
                FROM ledger_leg_posting_plan_lines AS plan
                WHERE plan.leg_id = target_leg_id
                EXCEPT ALL
                SELECT line.line_number,
                       line.ledger_account_id,
                       line.asset_revision_id,
                       line.side,
                       line.amount_atomic
                FROM ledger_journal_lines AS line
                WHERE line.journal_id = journal.journal_id
              )
              UNION ALL
              (
                SELECT line.line_number,
                       line.ledger_account_id,
                       line.asset_revision_id,
                       line.side,
                       line.amount_atomic
                FROM ledger_journal_lines AS line
                WHERE line.journal_id = journal.journal_id
                EXCEPT ALL
                SELECT plan.plan_line_number,
                       plan.ledger_account_id,
                       plan.asset_revision_id,
                       plan.side,
                       plan.amount_atomic
                FROM ledger_leg_posting_plan_lines AS plan
                WHERE plan.leg_id = target_leg_id
              )
            ) AS journal_mismatch
          )
      ) THEN
        RAISE EXCEPTION 'ledger posting plan cannot diverge from an existing journal'
          USING ERRCODE = '23514';
      END IF;

      RETURN NULL;
    END;
    $$;

    CREATE FUNCTION validate_ledger_journal_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      target_journal_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_id ELSE NEW.journal_id END;
      target_leg_id uuid;
      target_event_type text;
      target_reverses_journal_id uuid;
      target_compensates_journal_id uuid;
      target_adjusts_journal_id uuid;
      expected_compensates_journal_id uuid;
      expected_adjusts_journal_id uuid;
      expected_source_account_id uuid;
      expected_destination_account_id uuid;
      line_count bigint;
      distinct_account_count bigint;
      minimum_line_number integer;
      maximum_line_number integer;
    BEGIN
      SELECT journal.leg_id,
             journal.economic_event_type,
             journal.reverses_journal_id,
             journal.compensates_journal_id,
             journal.adjusts_journal_id,
             leg.compensates_journal_id,
             leg.adjusts_journal_id,
             leg.source_account_id,
             leg.destination_account_id
      INTO target_leg_id,
           target_event_type,
           target_reverses_journal_id,
           target_compensates_journal_id,
           target_adjusts_journal_id,
           expected_compensates_journal_id,
           expected_adjusts_journal_id,
           expected_source_account_id,
           expected_destination_account_id
      FROM ledger_journals AS journal
      INNER JOIN ledger_legs AS leg ON leg.leg_id = journal.leg_id
      WHERE journal.journal_id = target_journal_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger journal integrity target is missing' USING ERRCODE = '23514';
      END IF;

      IF target_event_type = 'ADJUSTMENT'
        AND target_adjusts_journal_id IS DISTINCT FROM expected_adjusts_journal_id
      THEN
        RAISE EXCEPTION 'ledger adjustment relation does not match its leg'
          USING ERRCODE = '23514';
      END IF;

      SELECT count(*),
             count(DISTINCT line.ledger_account_id),
             min(line.line_number),
             max(line.line_number)
      INTO line_count, distinct_account_count, minimum_line_number, maximum_line_number
      FROM ledger_journal_lines AS line
      WHERE line.journal_id = target_journal_id;

      IF line_count < 2
        OR distinct_account_count < 2
        OR minimum_line_number <> 1
        OR maximum_line_number <> line_count
      THEN
        RAISE EXCEPTION 'ledger journal requires contiguous lines across two accounts'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_journal_lines AS line
        WHERE line.journal_id = target_journal_id
        GROUP BY line.asset_revision_id
        HAVING sum(CASE WHEN line.side = 'DEBIT' THEN line.amount_atomic ELSE 0 END)
          <> sum(CASE WHEN line.side = 'CREDIT' THEN line.amount_atomic ELSE 0 END)
      ) THEN
        RAISE EXCEPTION 'ledger journal is not balanced by asset' USING ERRCODE = '23514';
      END IF;

      IF target_event_type <> 'REVERSAL' AND EXISTS (
        SELECT 1
        FROM (
          (
            SELECT plan.plan_line_number,
                   plan.ledger_account_id,
                   plan.asset_revision_id,
                   plan.side,
                   plan.amount_atomic
            FROM ledger_leg_posting_plan_lines AS plan
            WHERE plan.leg_id = target_leg_id
            EXCEPT ALL
            SELECT line.line_number,
                   line.ledger_account_id,
                   line.asset_revision_id,
                   line.side,
                   line.amount_atomic
            FROM ledger_journal_lines AS line
            WHERE line.journal_id = target_journal_id
          )
          UNION ALL
          (
            SELECT line.line_number,
                   line.ledger_account_id,
                   line.asset_revision_id,
                   line.side,
                   line.amount_atomic
            FROM ledger_journal_lines AS line
            WHERE line.journal_id = target_journal_id
            EXCEPT ALL
            SELECT plan.plan_line_number,
                   plan.ledger_account_id,
                   plan.asset_revision_id,
                   plan.side,
                   plan.amount_atomic
            FROM ledger_leg_posting_plan_lines AS plan
            WHERE plan.leg_id = target_leg_id
          )
        ) AS plan_mismatch
      ) THEN
        RAISE EXCEPTION 'ledger journal does not exactly match its immutable posting plan'
          USING ERRCODE = '23514';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM ledger_journal_lines AS line
        WHERE line.journal_id = target_journal_id
          AND line.ledger_account_id = expected_source_account_id
      ) OR NOT EXISTS (
        SELECT 1 FROM ledger_journal_lines AS line
        WHERE line.journal_id = target_journal_id
          AND line.ledger_account_id = expected_destination_account_id
      ) THEN
        RAISE EXCEPTION 'ledger journal does not contain both leg accounts'
          USING ERRCODE = '23514';
      END IF;

      IF target_event_type = 'COMPENSATION'
        AND target_compensates_journal_id IS DISTINCT FROM expected_compensates_journal_id
      THEN
        RAISE EXCEPTION 'ledger compensation relation does not match its leg'
          USING ERRCODE = '23514';
      END IF;

      IF target_event_type = 'REVERSAL' THEN
        IF EXISTS (
          SELECT 1
          FROM ledger_journals AS original
          WHERE original.journal_id = target_reverses_journal_id
            AND original.reverses_journal_id IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'a reversal journal cannot be reversed' USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            (
              SELECT original.line_number,
                     original.ledger_account_id,
                     original.asset_revision_id,
                     CASE original.side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END AS side,
                     original.amount_atomic
              FROM ledger_journal_lines AS original
              WHERE original.journal_id = target_reverses_journal_id
              EXCEPT ALL
              SELECT reversal.line_number,
                     reversal.ledger_account_id,
                     reversal.asset_revision_id,
                     reversal.side,
                     reversal.amount_atomic
              FROM ledger_journal_lines AS reversal
              WHERE reversal.journal_id = target_journal_id
            )
            UNION ALL
            (
              SELECT reversal.line_number,
                     reversal.ledger_account_id,
                     reversal.asset_revision_id,
                     reversal.side,
                     reversal.amount_atomic
              FROM ledger_journal_lines AS reversal
              WHERE reversal.journal_id = target_journal_id
              EXCEPT ALL
              SELECT original.line_number,
                     original.ledger_account_id,
                     original.asset_revision_id,
                     CASE original.side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END AS side,
                     original.amount_atomic
              FROM ledger_journal_lines AS original
              WHERE original.journal_id = target_reverses_journal_id
            )
          ) AS mismatch
        ) THEN
          RAISE EXCEPTION 'ledger reversal does not exactly negate its original journal'
            USING ERRCODE = '23514';
        END IF;

        IF (
          SELECT count(*)
          FROM ledger_valuation_snapshots AS original_valuation
          WHERE original_valuation.journal_id = target_reverses_journal_id
        ) <> (
          SELECT count(*)
          FROM ledger_valuation_snapshots AS reversal_valuation
          WHERE reversal_valuation.journal_id = target_journal_id
            AND reversal_valuation.purpose = 'REVERSAL'
        ) OR EXISTS (
          SELECT 1
          FROM ledger_valuation_snapshots AS original_valuation
          WHERE original_valuation.journal_id = target_reverses_journal_id
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_valuation_snapshots AS reversal_valuation
              WHERE reversal_valuation.journal_id = target_journal_id
                AND reversal_valuation.reverses_valuation_snapshot_id =
                  original_valuation.valuation_snapshot_id
            )
        ) THEN
          RAISE EXCEPTION 'ledger reversal valuation set does not match its original journal'
            USING ERRCODE = '23514';
        END IF;
      END IF;

      RETURN NULL;
    END;
    $$;

    CREATE FUNCTION validate_ledger_metadata_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      asset_decimals smallint;
      numerator numeric;
      denominator numeric;
      quotient numeric;
      remainder numeric;
      expected_usd_value numeric;
    BEGIN
      IF TG_TABLE_NAME = 'ledger_valuation_snapshots' THEN
        IF NEW.availability = 'AVAILABLE' THEN
          SELECT asset.base_unit_decimals
          INTO asset_decimals
          FROM ledger_assets AS asset
          WHERE asset.asset_revision_id = NEW.asset_revision_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'ledger valuation asset is missing' USING ERRCODE = '23503';
          END IF;

          numerator := NEW.valued_amount_atomic
            * NEW.usd_rate_mantissa
            * power(10::numeric, 18::numeric);
          denominator := power(
            10::numeric,
            (asset_decimals::integer + NEW.usd_rate_scale::integer)::numeric
          );
          quotient := trunc(numerator / denominator);
          remainder := mod(numerator, denominator);
          expected_usd_value := CASE
            WHEN remainder * 2 < denominator THEN quotient
            WHEN remainder * 2 > denominator THEN quotient + 1
            WHEN mod(quotient, 2) = 0 THEN quotient
            ELSE quotient + 1
          END;
          IF NEW.usd_value_mantissa IS DISTINCT FROM expected_usd_value THEN
            RAISE EXCEPTION 'ledger valuation does not match the half-even formula'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        IF NEW.purpose = 'REVERSAL' AND NOT EXISTS (
          SELECT 1
          FROM ledger_valuation_snapshots AS original
          WHERE original.valuation_snapshot_id = NEW.reverses_valuation_snapshot_id
            AND original.purpose <> 'REVERSAL'
            AND original.asset_revision_id = NEW.asset_revision_id
            AND original.valued_amount_atomic = NEW.valued_amount_atomic
            AND original.availability = NEW.availability
            AND original.usd_rate_mantissa IS NOT DISTINCT FROM NEW.usd_rate_mantissa
            AND original.usd_rate_scale IS NOT DISTINCT FROM NEW.usd_rate_scale
            AND original.usd_value_mantissa IS NOT DISTINCT FROM NEW.usd_value_mantissa
            AND original.rounding_mode = NEW.rounding_mode
            AND original.source_reference_id = NEW.source_reference_id
            AND original.source_policy_reference_id = NEW.source_policy_reference_id
            AND original.evidence_reference_id = NEW.evidence_reference_id
            AND original.priced_at IS NOT DISTINCT FROM NEW.priced_at
            AND original.freshness_class = NEW.freshness_class
            AND original.confidence_class = NEW.confidence_class
            AND original.depeg_class = NEW.depeg_class
        ) THEN
          RAISE EXCEPTION 'ledger reversal valuation does not match its original'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.purpose = 'BACKFILL' AND NOT EXISTS (
          SELECT 1
          FROM ledger_valuation_snapshots AS original
          WHERE original.valuation_snapshot_id = NEW.backfills_valuation_snapshot_id
            AND original.journal_id = NEW.journal_id
            AND original.purpose IN ('SETTLEMENT', 'ADJUSTMENT')
            AND original.availability = 'UNAVAILABLE'
            AND original.leg_id = NEW.leg_id
            AND original.transaction_id = NEW.transaction_id
            AND original.book_id = NEW.book_id
            AND original.tenant_account_id = NEW.tenant_account_id
            AND original.asset_revision_id = NEW.asset_revision_id
            AND original.valued_amount_atomic = NEW.valued_amount_atomic
        ) THEN
          RAISE EXCEPTION 'ledger valuation backfill does not match an unavailable base snapshot'
            USING ERRCODE = '23514';
        END IF;
      ELSIF TG_TABLE_NAME = 'ledger_fee_components' THEN
        IF NEW.stage IN ('ACTUAL', 'ADJUSTMENT') THEN
          PERFORM 1
          FROM ledger_journals AS journal
          WHERE journal.journal_id = NEW.journal_id
          FOR UPDATE;

          IF NOT EXISTS (
            SELECT 1
            FROM ledger_journals AS journal
            INNER JOIN ledger_journal_lines AS payer_line
              ON payer_line.journal_id = journal.journal_id
             AND payer_line.line_number = NEW.payer_line_number
            INNER JOIN ledger_journal_lines AS recipient_line
              ON recipient_line.journal_id = journal.journal_id
             AND recipient_line.line_number = NEW.recipient_line_number
            WHERE journal.journal_id = NEW.journal_id
              AND journal.leg_id = NEW.leg_id
              AND journal.transaction_id = NEW.transaction_id
              AND journal.book_id = NEW.book_id
              AND journal.actor_account_id = NEW.tenant_account_id
              AND journal.economic_event_type = CASE
                WHEN NEW.stage = 'ACTUAL' THEN 'ACTUAL_FEE'
                ELSE 'ADJUSTMENT'
              END
              AND payer_line.ledger_account_id = NEW.payer_account_id
              AND payer_line.asset_revision_id = NEW.asset_revision_id
              AND payer_line.side = 'CREDIT'
              AND payer_line.amount_atomic = NEW.amount_atomic
              AND recipient_line.ledger_account_id = NEW.recipient_account_id
              AND recipient_line.asset_revision_id = NEW.asset_revision_id
              AND recipient_line.side = 'DEBIT'
              AND recipient_line.amount_atomic = NEW.amount_atomic
          ) THEN
            RAISE EXCEPTION 'ledger fee does not match its payer and recipient lines'
              USING ERRCODE = '23514';
          END IF;

          IF NEW.stage <> 'REVERSAL' AND EXISTS (
            SELECT 1
            FROM ledger_fee_components AS other
            WHERE other.journal_id = NEW.journal_id
              AND other.fee_component_id <> NEW.fee_component_id
              AND (
                NEW.payer_line_number IN (other.payer_line_number, other.recipient_line_number)
                OR NEW.recipient_line_number IN (
                  other.payer_line_number, other.recipient_line_number
                )
              )
          ) THEN
            RAISE EXCEPTION 'ledger fee journal lines are already assigned'
              USING ERRCODE = '23505';
          END IF;
        END IF;

        IF NEW.stage = 'ADJUSTMENT' AND NOT EXISTS (
          SELECT 1
          FROM ledger_fee_components AS original
          WHERE original.fee_component_id = NEW.adjusts_fee_component_id
            AND original.stage IN ('ESTIMATED', 'ACTUAL')
            AND original.tenant_account_id = NEW.tenant_account_id
            AND original.category = NEW.category
            AND original.asset_revision_id = NEW.asset_revision_id
            AND original.payer_account_id = NEW.payer_account_id
            AND original.recipient_account_id = NEW.recipient_account_id
            AND original.fee_component_id <> NEW.fee_component_id
        ) THEN
          RAISE EXCEPTION 'ledger fee adjustment does not match its original component'
            USING ERRCODE = '23514';
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported ledger metadata integrity target' USING ERRCODE = '55000';
      END IF;

      RETURN NULL;
    END;
    $$;


    CREATE FUNCTION reject_frozen_ledger_plan_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      PERFORM 1
      FROM ledger_leg_posting_plans AS plan
      WHERE plan.posting_plan_id = NEW.posting_plan_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger posting plan is missing' USING ERRCODE = '23503';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM ledger_journals AS journal
        WHERE journal.posting_plan_id = NEW.posting_plan_id
      ) OR EXISTS (
        SELECT 1
        FROM ledger_leg_posting_plan_seals AS seal
        WHERE seal.posting_plan_id = NEW.posting_plan_id
      ) THEN
        RAISE EXCEPTION 'ledger posting plan is already sealed or consumed'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION validate_ledger_fee_estimate_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM ledger_valuation_snapshots AS valuation
        INNER JOIN ledger_transactions AS transaction_state
          ON transaction_state.transaction_id = NEW.transaction_id
         AND transaction_state.book_id = NEW.book_id
         AND transaction_state.tenant_account_id = NEW.tenant_account_id
        WHERE valuation.valuation_snapshot_id = NEW.valuation_snapshot_id
          AND valuation.journal_id IS NULL
          AND valuation.purpose = 'QUOTE'
          AND valuation.valuation_plan_line_number IS NULL
          AND valuation.valuation_role = 'FEE_COMPONENT'
          AND valuation.fee_plan_line_number IS NULL
          AND valuation.leg_id = NEW.leg_id
          AND valuation.transaction_id = NEW.transaction_id
          AND valuation.book_id = NEW.book_id
          AND valuation.tenant_account_id = NEW.tenant_account_id
          AND valuation.asset_revision_id = NEW.asset_revision_id
          AND valuation.valued_amount_atomic = NEW.amount_atomic
          AND transaction_state.quote_snapshot_reference_id IS NOT DISTINCT FROM
            NEW.quote_reference_id
          AND transaction_state.route_revision_reference_id IS NOT DISTINCT FROM
            NEW.route_reference_id
          AND transaction_state.configuration_revision_reference_id =
            NEW.configuration_revision_reference_id
      ) THEN
        RAISE EXCEPTION 'ledger fee estimate does not match its quote valuation and revisions'
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;
    $$;

    CREATE OR REPLACE FUNCTION validate_ledger_posting_plan_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      target_posting_plan_id uuid := CASE
        WHEN TG_OP = 'DELETE' THEN OLD.posting_plan_id
        ELSE NEW.posting_plan_id
      END;
      target_leg_id uuid;
      target_event_type text;
      target_reason_code text;
      target_leg_kind text;
      target_source_account_id uuid;
      target_destination_account_id uuid;
      target_asset_revision_id uuid;
      target_leg_amount_atomic numeric;
      target_source_posting_amount numeric;
      target_destination_posting_amount numeric;
      line_count bigint;
      distinct_account_count bigint;
      minimum_line_number integer;
      maximum_line_number integer;
    BEGIN
      SELECT plan.leg_id,
             plan.economic_event_type,
             plan.reason_code,
             leg.leg_kind,
             leg.source_account_id,
             leg.destination_account_id,
             leg.asset_revision_id,
             leg.expected_amount_atomic
      INTO target_leg_id,
           target_event_type,
           target_reason_code,
           target_leg_kind,
           target_source_account_id,
           target_destination_account_id,
           target_asset_revision_id,
           target_leg_amount_atomic
      FROM ledger_leg_posting_plans AS plan
      INNER JOIN ledger_legs AS leg
        ON leg.leg_id = plan.leg_id
       AND leg.transaction_id = plan.transaction_id
       AND leg.book_id = plan.book_id
       AND leg.tenant_account_id = plan.tenant_account_id
      WHERE plan.posting_plan_id = target_posting_plan_id
      FOR UPDATE OF plan;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger posting plan is missing' USING ERRCODE = '23503';
      END IF;

      IF target_leg_kind = 'FEE_PAYMENT' OR (
        target_event_type = 'ADJUSTMENT'
        AND EXISTS (
          SELECT 1
          FROM ledger_leg_fee_plans AS adjustment_fee
          WHERE adjustment_fee.posting_plan_id = target_posting_plan_id
        )
      ) THEN
        target_source_posting_amount := target_leg_amount_atomic;
        target_destination_posting_amount := target_leg_amount_atomic;
      ELSE
        SELECT target_leg_amount_atomic + coalesce(sum(fee.amount_atomic) FILTER (
                 WHERE fee.deduction_mode = 'ADDED_ON_TOP'
               ), 0),
               target_leg_amount_atomic - coalesce(sum(fee.amount_atomic) FILTER (
                 WHERE fee.deduction_mode IN ('DEDUCTED_FROM_INPUT', 'DEDUCTED_FROM_OUTPUT')
               ), 0)
        INTO target_source_posting_amount, target_destination_posting_amount
        FROM ledger_leg_fee_plans AS fee
        WHERE fee.posting_plan_id = target_posting_plan_id
          AND fee.asset_revision_id = target_asset_revision_id;
        IF target_destination_posting_amount <= 0 THEN
          RAISE EXCEPTION 'ledger fee deductions exhaust the leg amount'
            USING ERRCODE = '23514';
        END IF;
      END IF;

      IF NOT (
        (target_leg_kind = 'FEE_PAYMENT' AND target_event_type = 'ACTUAL_FEE') OR
        (target_leg_kind = 'ADJUSTMENT' AND target_event_type = 'ADJUSTMENT') OR
        (target_leg_kind = 'COMPENSATION' AND target_event_type = 'COMPENSATION') OR
        (
          target_leg_kind IN (
            'SOURCE_TRANSFER', 'SWAP_INPUT', 'SWAP_OUTPUT',
            'BRIDGE_DEPOSIT', 'BRIDGE_RELEASE'
          )
          AND target_event_type = 'SETTLEMENT'
        )
      ) THEN
        RAISE EXCEPTION 'ledger posting plan event does not match its leg kind'
          USING ERRCODE = '23514';
      END IF;

      IF NOT (
        (target_event_type = 'SETTLEMENT' AND target_reason_code IN (
          'CHAIN_FINALITY_CONFIRMED', 'PROVIDER_SETTLEMENT_VERIFIED'
        )) OR
        (target_event_type = 'ACTUAL_FEE' AND target_reason_code = 'ACTUAL_FEE_CONFIRMED') OR
        (target_event_type = 'ADJUSTMENT' AND target_reason_code = 'ACCOUNTING_ADJUSTMENT_APPROVED') OR
        (target_event_type = 'COMPENSATION' AND target_reason_code = 'COMPENSATION_SETTLED')
      ) THEN
        RAISE EXCEPTION 'ledger posting plan reason is not approved'
          USING ERRCODE = '23514';
      END IF;

      SELECT count(*),
             count(DISTINCT plan_line.ledger_account_id),
             min(plan_line.plan_line_number),
             max(plan_line.plan_line_number)
      INTO line_count, distinct_account_count, minimum_line_number, maximum_line_number
      FROM ledger_leg_posting_plan_lines AS plan_line
      WHERE plan_line.posting_plan_id = target_posting_plan_id;
      IF line_count < 2
        OR line_count > 64
        OR distinct_account_count < 2
        OR minimum_line_number <> 1
        OR maximum_line_number <> line_count
      THEN
        RAISE EXCEPTION 'ledger posting plan requires contiguous lines across two accounts'
          USING ERRCODE = '23514';
      END IF;

      IF (
        SELECT count(*)
        FROM ledger_leg_posting_plan_lines AS plan_line
        WHERE plan_line.posting_plan_id = target_posting_plan_id
          AND plan_line.ledger_account_id = target_source_account_id
          AND plan_line.asset_revision_id = target_asset_revision_id
          AND plan_line.side = 'CREDIT'
          AND plan_line.amount_atomic = target_source_posting_amount
      ) <> 1 OR (
        SELECT count(*)
        FROM ledger_leg_posting_plan_lines AS plan_line
        WHERE plan_line.posting_plan_id = target_posting_plan_id
          AND plan_line.ledger_account_id = target_destination_account_id
          AND plan_line.asset_revision_id = target_asset_revision_id
          AND plan_line.side = 'DEBIT'
          AND plan_line.amount_atomic = target_destination_posting_amount
      ) <> 1 THEN
        RAISE EXCEPTION 'ledger posting plan does not contain the exact leg movement'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_posting_plan_lines AS plan_line
        INNER JOIN ledger_accounts AS account
          ON account.ledger_account_id = plan_line.ledger_account_id
        WHERE plan_line.posting_plan_id = target_posting_plan_id
          AND account.owner_kind = 'ACCOUNT'
          AND account.owner_account_id <> plan_line.tenant_account_id
      ) THEN
        RAISE EXCEPTION 'ledger posting plan contains an unauthorized identity'
          USING ERRCODE = '42501';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_posting_plan_lines AS plan_line
        WHERE plan_line.posting_plan_id = target_posting_plan_id
        GROUP BY plan_line.asset_revision_id
        HAVING sum(CASE WHEN plan_line.side = 'DEBIT' THEN plan_line.amount_atomic ELSE 0 END)
          <> sum(CASE WHEN plan_line.side = 'CREDIT' THEN plan_line.amount_atomic ELSE 0 END)
      ) THEN
        RAISE EXCEPTION 'ledger posting plan is not balanced by asset'
          USING ERRCODE = '23514';
      END IF;

      IF (
        SELECT count(*)
        FROM ledger_leg_recognition_evidence AS evidence
        WHERE evidence.posting_plan_id = target_posting_plan_id
          AND evidence.leg_id = target_leg_id
      ) <> 1 THEN
        RAISE EXCEPTION 'ledger posting plan requires exact recognition evidence'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM (
          SELECT count(*) AS valuation_count,
                 min(valuation.valuation_plan_line_number) AS minimum_line,
                 max(valuation.valuation_plan_line_number) AS maximum_line
          FROM ledger_leg_valuation_plans AS valuation
          WHERE valuation.posting_plan_id = target_posting_plan_id
        ) AS valuation_shape
        WHERE valuation_shape.valuation_count < 1
           OR valuation_shape.valuation_count > 96
           OR valuation_shape.minimum_line <> 1
           OR valuation_shape.maximum_line <> valuation_shape.valuation_count
      ) THEN
        RAISE EXCEPTION 'ledger valuation plan lines must be bounded and contiguous'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM (
          SELECT plan_line.asset_revision_id,
                 sum(CASE WHEN plan_line.side = 'DEBIT'
                   THEN plan_line.amount_atomic ELSE 0 END) AS valued_amount_atomic
          FROM ledger_leg_posting_plan_lines AS plan_line
          WHERE plan_line.posting_plan_id = target_posting_plan_id
          GROUP BY plan_line.asset_revision_id
        ) AS posted_asset
        LEFT JOIN ledger_leg_valuation_plans AS valuation
          ON valuation.posting_plan_id = target_posting_plan_id
         AND valuation.valuation_role = 'JOURNAL_ASSET_TOTAL'
         AND valuation.asset_revision_id = posted_asset.asset_revision_id
        WHERE valuation.valuation_plan_line_number IS NULL
           OR valuation.valued_amount_atomic IS DISTINCT FROM
                posted_asset.valued_amount_atomic
      ) OR EXISTS (
        SELECT 1
        FROM ledger_leg_valuation_plans AS valuation
        WHERE valuation.posting_plan_id = target_posting_plan_id
          AND valuation.valuation_role = 'JOURNAL_ASSET_TOTAL'
          AND NOT EXISTS (
            SELECT 1
            FROM ledger_leg_posting_plan_lines AS plan_line
            WHERE plan_line.posting_plan_id = target_posting_plan_id
              AND plan_line.asset_revision_id = valuation.asset_revision_id
          )
      ) THEN
        RAISE EXCEPTION 'ledger valuation totals do not exactly cover posted assets'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_fee_plans AS fee
        LEFT JOIN ledger_leg_valuation_plans AS valuation
          ON valuation.posting_plan_id = fee.posting_plan_id
         AND valuation.fee_plan_line_number = fee.fee_plan_line_number
         AND valuation.valuation_role = 'FEE_COMPONENT'
        WHERE fee.posting_plan_id = target_posting_plan_id
          AND (
            valuation.valuation_plan_line_number IS NULL
            OR valuation.asset_revision_id IS DISTINCT FROM fee.asset_revision_id
            OR valuation.valued_amount_atomic IS DISTINCT FROM fee.amount_atomic
          )
      ) OR EXISTS (
        SELECT 1
        FROM ledger_leg_valuation_plans AS valuation
        WHERE valuation.posting_plan_id = target_posting_plan_id
          AND valuation.valuation_role = 'FEE_COMPONENT'
          AND NOT EXISTS (
            SELECT 1
            FROM ledger_leg_fee_plans AS fee
            WHERE fee.posting_plan_id = valuation.posting_plan_id
              AND fee.fee_plan_line_number = valuation.fee_plan_line_number
              AND fee.asset_revision_id = valuation.asset_revision_id
              AND fee.amount_atomic = valuation.valued_amount_atomic
          )
      ) THEN
        RAISE EXCEPTION 'ledger fee valuations do not exactly cover fee quantities'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_valuation_plans AS valuation
        INNER JOIN ledger_assets AS asset
          ON asset.asset_revision_id = valuation.asset_revision_id
        CROSS JOIN LATERAL (
          SELECT valuation.valued_amount_atomic
            * valuation.usd_rate_mantissa
            * power(10::numeric, 18::numeric) AS numerator,
            power(
              10::numeric,
              (asset.base_unit_decimals::integer
                + valuation.usd_rate_scale::integer)::numeric
            ) AS denominator
        ) AS formula
        CROSS JOIN LATERAL (
          SELECT trunc(formula.numerator / formula.denominator) AS quotient,
                 mod(formula.numerator, formula.denominator) AS remainder
        ) AS division
        WHERE valuation.posting_plan_id = target_posting_plan_id
          AND valuation.availability = 'AVAILABLE'
          AND valuation.usd_value_mantissa IS DISTINCT FROM CASE
            WHEN division.remainder * 2 < formula.denominator THEN division.quotient
            WHEN division.remainder * 2 > formula.denominator THEN division.quotient + 1
            WHEN mod(division.quotient, 2) = 0 THEN division.quotient
            ELSE division.quotient + 1
          END
      ) THEN
        RAISE EXCEPTION 'ledger valuation plan violates the half-even formula'
          USING ERRCODE = '23514';
      END IF;

      IF (
        SELECT count(*)
        FROM ledger_leg_fee_plans AS fee_plan
        WHERE fee_plan.posting_plan_id = target_posting_plan_id
      ) > 32 OR EXISTS (
        SELECT 1
        FROM (
          SELECT count(*) AS fee_count,
                 min(fee_plan.fee_plan_line_number) AS minimum_line,
                 max(fee_plan.fee_plan_line_number) AS maximum_line
          FROM ledger_leg_fee_plans AS fee_plan
          WHERE fee_plan.posting_plan_id = target_posting_plan_id
        ) AS fee_shape
        WHERE fee_shape.fee_count > 0
          AND (fee_shape.minimum_line <> 1 OR fee_shape.maximum_line <> fee_shape.fee_count)
      ) THEN
        RAISE EXCEPTION 'ledger fee plan lines must be bounded and contiguous'
          USING ERRCODE = '23514';
      END IF;

      IF target_leg_kind = 'FEE_PAYMENT' AND (
        (
          SELECT count(*)
          FROM ledger_leg_fee_plans AS fee_plan
          WHERE fee_plan.posting_plan_id = target_posting_plan_id
        ) <> 1 OR NOT EXISTS (
          SELECT 1
          FROM ledger_leg_fee_plans AS fee_plan
          INNER JOIN ledger_leg_posting_plan_lines AS payer_line
            ON payer_line.posting_plan_id = fee_plan.posting_plan_id
           AND payer_line.plan_line_number = fee_plan.payer_line_number
          INNER JOIN ledger_leg_posting_plan_lines AS recipient_line
            ON recipient_line.posting_plan_id = fee_plan.posting_plan_id
           AND recipient_line.plan_line_number = fee_plan.recipient_line_number
          WHERE fee_plan.posting_plan_id = target_posting_plan_id
            AND fee_plan.asset_revision_id = target_asset_revision_id
            AND fee_plan.amount_atomic = target_leg_amount_atomic
            AND fee_plan.payer_allocation_amount_atomic = target_leg_amount_atomic
            AND fee_plan.payer_account_id = target_source_account_id
            AND fee_plan.recipient_account_id = target_destination_account_id
            AND payer_line.ledger_account_id = target_source_account_id
            AND payer_line.side = 'CREDIT'
            AND payer_line.amount_atomic = target_leg_amount_atomic
            AND recipient_line.ledger_account_id = target_destination_account_id
            AND recipient_line.side = 'DEBIT'
            AND recipient_line.amount_atomic = target_leg_amount_atomic
        )
      ) THEN
        RAISE EXCEPTION 'ledger fee-payment plan must exactly describe its primary movement'
          USING ERRCODE = '23514';
      END IF;
      IF target_event_type NOT IN ('SETTLEMENT', 'ACTUAL_FEE', 'ADJUSTMENT', 'COMPENSATION')
        AND EXISTS (
          SELECT 1
          FROM ledger_leg_fee_plans AS fee_plan
          WHERE fee_plan.posting_plan_id = target_posting_plan_id
        )
      THEN
        RAISE EXCEPTION 'ledger event cannot carry actual fee metadata'
          USING ERRCODE = '23514';
      END IF;

      IF target_event_type = 'ADJUSTMENT' AND EXISTS (
        SELECT 1
        FROM ledger_leg_fee_plans AS fee
        WHERE fee.posting_plan_id = target_posting_plan_id
      ) AND (
        (
          SELECT count(*)
          FROM ledger_leg_fee_plans AS fee
          WHERE fee.posting_plan_id = target_posting_plan_id
        ) <> 1 OR NOT EXISTS (
          SELECT 1
          FROM ledger_leg_fee_plans AS fee
          INNER JOIN ledger_legs AS leg
            ON leg.leg_id = fee.leg_id
           AND leg.transaction_id = fee.transaction_id
           AND leg.book_id = fee.book_id
           AND leg.tenant_account_id = fee.tenant_account_id
          INNER JOIN ledger_fee_components AS original
            ON original.fee_component_id = fee.adjusts_fee_component_id
          WHERE fee.posting_plan_id = target_posting_plan_id
            AND fee.fee_estimate_snapshot_id IS NULL
            AND fee.amount_atomic = target_leg_amount_atomic
            AND fee.asset_revision_id = target_asset_revision_id
            AND fee.payer_account_id = target_source_account_id
            AND fee.recipient_account_id = target_destination_account_id
            AND original.journal_id = leg.adjusts_journal_id
            AND original.tenant_account_id = fee.tenant_account_id
            AND original.book_id = fee.book_id
            AND original.category = fee.category
            AND original.asset_revision_id = fee.asset_revision_id
        )
      ) THEN
        RAISE EXCEPTION 'ledger fee adjustment plan does not match its corrected component'
          USING ERRCODE = '23514';
      ELSIF target_event_type <> 'ADJUSTMENT' AND EXISTS (
        SELECT 1
        FROM ledger_leg_fee_plans AS fee
        WHERE fee.posting_plan_id = target_posting_plan_id
          AND fee.adjusts_fee_component_id IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'ledger non-adjustment fee plan cannot adjust a component'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_fee_plans AS fee
        WHERE fee.posting_plan_id = target_posting_plan_id
          AND fee.fee_estimate_snapshot_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM ledger_fee_estimate_snapshots AS estimate
            WHERE estimate.fee_estimate_snapshot_id = fee.fee_estimate_snapshot_id
              AND estimate.leg_id = fee.leg_id
              AND estimate.transaction_id = fee.transaction_id
              AND estimate.book_id = fee.book_id
              AND estimate.tenant_account_id = fee.tenant_account_id
              AND estimate.category = fee.category
              AND estimate.asset_revision_id = fee.asset_revision_id
              AND estimate.payer_account_id = fee.payer_account_id
              AND estimate.recipient_account_id = fee.recipient_account_id
              AND estimate.deduction_mode = fee.deduction_mode
              AND estimate.fee_rule_reference_id = fee.fee_rule_reference_id
              AND estimate.quote_reference_id IS NOT DISTINCT FROM fee.quote_reference_id
          )
      ) THEN
        RAISE EXCEPTION 'ledger fee plan estimate linkage is inconsistent'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_fee_plans AS fee_plan
        INNER JOIN ledger_leg_posting_plan_lines AS payer_line
          ON payer_line.posting_plan_id = fee_plan.posting_plan_id
         AND payer_line.plan_line_number = fee_plan.payer_line_number
        INNER JOIN ledger_leg_posting_plan_lines AS recipient_line
          ON recipient_line.posting_plan_id = fee_plan.posting_plan_id
         AND recipient_line.plan_line_number = fee_plan.recipient_line_number
        WHERE fee_plan.posting_plan_id = target_posting_plan_id
          AND (
            payer_line.ledger_account_id <> fee_plan.payer_account_id
            OR payer_line.asset_revision_id <> fee_plan.asset_revision_id
            OR payer_line.side <> 'CREDIT'
            OR payer_line.amount_atomic < fee_plan.payer_allocation_amount_atomic
            OR recipient_line.ledger_account_id <> fee_plan.recipient_account_id
            OR recipient_line.asset_revision_id <> fee_plan.asset_revision_id
            OR recipient_line.side <> 'DEBIT'
            OR recipient_line.amount_atomic <> fee_plan.amount_atomic
          )
      ) OR EXISTS (
        SELECT 1
        FROM ledger_leg_fee_plans AS fee_plan
        INNER JOIN ledger_leg_posting_plan_lines AS payer_line
          ON payer_line.posting_plan_id = fee_plan.posting_plan_id
         AND payer_line.plan_line_number = fee_plan.payer_line_number
        WHERE fee_plan.posting_plan_id = target_posting_plan_id
        GROUP BY fee_plan.payer_line_number, payer_line.amount_atomic
        HAVING sum(fee_plan.payer_allocation_amount_atomic) > payer_line.amount_atomic
      ) THEN
        RAISE EXCEPTION 'ledger fee plan does not match its gross payer and fee sink lines'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_journals AS journal
        WHERE journal.posting_plan_id = target_posting_plan_id
          AND EXISTS (
            SELECT 1
            FROM (
              (
                SELECT plan_line.plan_line_number,
                       plan_line.ledger_account_id,
                       plan_line.asset_revision_id,
                       plan_line.side,
                       plan_line.amount_atomic
                FROM ledger_leg_posting_plan_lines AS plan_line
                WHERE plan_line.posting_plan_id = target_posting_plan_id
                EXCEPT ALL
                SELECT line.line_number,
                       line.ledger_account_id,
                       line.asset_revision_id,
                       line.side,
                       line.amount_atomic
                FROM ledger_journal_lines AS line
                WHERE line.journal_id = journal.journal_id
              )
              UNION ALL
              (
                SELECT line.line_number,
                       line.ledger_account_id,
                       line.asset_revision_id,
                       line.side,
                       line.amount_atomic
                FROM ledger_journal_lines AS line
                WHERE line.journal_id = journal.journal_id
                EXCEPT ALL
                SELECT plan_line.plan_line_number,
                       plan_line.ledger_account_id,
                       plan_line.asset_revision_id,
                       plan_line.side,
                       plan_line.amount_atomic
                FROM ledger_leg_posting_plan_lines AS plan_line
                WHERE plan_line.posting_plan_id = target_posting_plan_id
              )
            ) AS mismatch
          )
      ) THEN
        RAISE EXCEPTION 'ledger posting plan cannot diverge from its consumed journal'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_posting_plan_seals AS seal
        WHERE seal.posting_plan_id = target_posting_plan_id
          AND seal.sealed_plan_digest IS DISTINCT FROM
            compute_ledger_posting_plan_digest(target_posting_plan_id)
      ) THEN
        RAISE EXCEPTION 'ledger posting plan no longer matches its seal'
          USING ERRCODE = '23514';
      END IF;

      RETURN NULL;
    END;
    $$;

    CREATE FUNCTION validate_ledger_reversal_approval_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      PERFORM 1
      FROM ledger_journals AS original
      WHERE original.journal_id = NEW.original_journal_id
        AND original.leg_id = NEW.leg_id
        AND original.transaction_id = NEW.transaction_id
        AND original.book_id = NEW.book_id
        AND original.actor_account_id = NEW.tenant_account_id
        AND original.economic_event_type <> 'REVERSAL'
        AND original.effective_at <= NEW.effective_at
        AND original.observed_at <= NEW.observed_at
        AND original.recorded_at <= NEW.recorded_at
        AND NEW.observed_at <= NEW.recorded_at
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger reversal approval target is invalid'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM ledger_journals AS reversal
        WHERE reversal.reverses_journal_id = NEW.original_journal_id
          AND reversal.reversal_approval_id IS DISTINCT FROM NEW.reversal_approval_id
      ) THEN
        RAISE EXCEPTION 'ledger reversal approval target is already reversed'
          USING ERRCODE = '23505';
      END IF;
      IF NEW.sealed_approval_digest IS DISTINCT FROM
        compute_ledger_reversal_approval_digest(NEW.reversal_approval_id)
      THEN
        RAISE EXCEPTION 'ledger reversal approval seal is invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;
    $$;

    CREATE FUNCTION validate_ledger_capability_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      existing_issued_at timestamptz;
      existing_expires_at timestamptz;
      target_approval_reference_id uuid;
      target_authorized_at timestamptz;
      target_posting_plan_id uuid;
      target_reversal_approval_id uuid;
    BEGIN
      IF TG_TABLE_NAME = 'ledger_command_capabilities' THEN
        IF NEW.issued_at > clock_timestamp()
          OR NEW.issued_at IS DISTINCT FROM NEW.recorded_at
          OR NEW.expires_at <= clock_timestamp()
        THEN
          RAISE EXCEPTION 'ledger capability issuance time is invalid'
            USING ERRCODE = '22023';
        END IF;

        IF NEW.capability_purpose = 'POST' THEN
          SELECT seal.approval_reference_id,
                 seal.sealed_at
          INTO target_approval_reference_id,
               target_authorized_at
          FROM ledger_leg_posting_plans AS plan
          INNER JOIN ledger_leg_posting_plan_seals AS seal
            ON seal.posting_plan_id = plan.posting_plan_id
          WHERE plan.posting_plan_id = NEW.posting_plan_id
            AND plan.leg_id = NEW.leg_id
            AND plan.transaction_id = NEW.transaction_id
            AND plan.book_id = NEW.book_id
            AND plan.tenant_account_id = NEW.tenant_account_id
            AND seal.sealed_plan_digest = NEW.target_digest
            AND seal.sealed_plan_digest =
              compute_ledger_posting_plan_digest(plan.posting_plan_id)
          FOR UPDATE OF plan;
          IF NOT FOUND
            OR target_approval_reference_id <> NEW.approval_reference_id
            OR NEW.issued_at < target_authorized_at
            OR EXISTS (
            SELECT 1
            FROM ledger_journals AS journal
            WHERE journal.posting_plan_id = NEW.posting_plan_id
          ) THEN
            RAISE EXCEPTION 'ledger capability target is unavailable'
              USING ERRCODE = '55000';
          END IF;
        ELSE
          SELECT approval.approval_reference_id,
                 GREATEST(approval.observed_at, approval.recorded_at)
          INTO target_approval_reference_id,
               target_authorized_at
          FROM ledger_reversal_approvals AS approval
          WHERE approval.reversal_approval_id = NEW.reversal_approval_id
            AND approval.original_journal_id = NEW.original_journal_id
            AND approval.leg_id = NEW.leg_id
            AND approval.transaction_id = NEW.transaction_id
            AND approval.book_id = NEW.book_id
            AND approval.tenant_account_id = NEW.tenant_account_id
            AND approval.sealed_approval_digest = NEW.target_digest
            AND approval.sealed_approval_digest =
              compute_ledger_reversal_approval_digest(approval.reversal_approval_id)
          FOR UPDATE;
          IF NOT FOUND
            OR target_approval_reference_id <> NEW.approval_reference_id
            OR NEW.issued_at < target_authorized_at
            OR EXISTS (
              SELECT 1
              FROM ledger_journals AS journal
              WHERE journal.reversal_approval_id = NEW.reversal_approval_id
                 OR journal.reverses_journal_id = NEW.original_journal_id
            )
          THEN
            RAISE EXCEPTION 'ledger capability target is unavailable'
              USING ERRCODE = '55000';
          END IF;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM ledger_command_capabilities AS existing
          WHERE existing.capability_purpose = NEW.capability_purpose
            AND (
              (NEW.capability_purpose = 'POST'
                AND existing.posting_plan_id = NEW.posting_plan_id)
              OR (NEW.capability_purpose = 'REVERSE'
                AND existing.reversal_approval_id = NEW.reversal_approval_id)
            )
            AND existing.expires_at > NEW.issued_at
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_command_capability_resolutions AS resolution
              WHERE resolution.capability_id = existing.capability_id
                AND resolution.resolved_at <= NEW.issued_at
            )
        ) THEN
          RAISE EXCEPTION 'ledger capability target already has an active issuance'
            USING ERRCODE = '23505';
        END IF;
      ELSE
        SELECT capability.issued_at,
               capability.expires_at,
               capability.posting_plan_id,
               capability.reversal_approval_id
        INTO existing_issued_at,
             existing_expires_at,
             target_posting_plan_id,
             target_reversal_approval_id
        FROM ledger_command_capabilities AS capability
        WHERE capability.capability_id = NEW.capability_id
        FOR UPDATE;
        IF NOT FOUND
          OR NEW.resolved_at < existing_issued_at
          OR NEW.resolved_at > clock_timestamp()
          OR (NEW.outcome = 'CONSUMED' AND NEW.resolved_at >= existing_expires_at)
          OR EXISTS (
            SELECT 1
            FROM ledger_journals AS journal
            WHERE journal.capability_id = NEW.capability_id
               OR (
                 target_posting_plan_id IS NOT NULL
                 AND journal.posting_plan_id = target_posting_plan_id
               )
               OR (
                 target_reversal_approval_id IS NOT NULL
                 AND journal.reversal_approval_id = target_reversal_approval_id
               )
          )
        THEN
          RAISE EXCEPTION 'ledger capability is unavailable for resolution'
            USING ERRCODE = '55000';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION validate_ledger_capability_resolution_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      IF NEW.outcome = 'CONSUMED' THEN
        IF NOT EXISTS (
          SELECT 1
          FROM ledger_command_capabilities AS capability
          INNER JOIN ledger_journals AS journal
            ON journal.capability_id = capability.capability_id
           AND journal.journal_id = NEW.journal_id
           AND journal.leg_id = capability.leg_id
           AND journal.transaction_id = capability.transaction_id
           AND journal.book_id = capability.book_id
           AND journal.actor_account_id = capability.tenant_account_id
          WHERE capability.capability_id = NEW.capability_id
            AND NEW.resolved_at >= capability.issued_at
            AND NEW.resolved_at < capability.expires_at
            AND journal.recorded_at >= capability.issued_at
            AND journal.recorded_at = NEW.resolved_at
            AND NEW.recorded_at = NEW.resolved_at
            AND (
              (
                capability.capability_purpose = 'POST'
                AND journal.posting_plan_id = capability.posting_plan_id
                AND journal.reversal_approval_id IS NULL
              ) OR (
                capability.capability_purpose = 'REVERSE'
                AND journal.reversal_approval_id = capability.reversal_approval_id
                AND journal.reverses_journal_id = capability.original_journal_id
                AND journal.posting_plan_id IS NULL
              )
            )
        ) THEN
          RAISE EXCEPTION 'consumed ledger capability does not match its journal'
            USING ERRCODE = '23514';
        END IF;
      ELSIF EXISTS (
        SELECT 1
        FROM ledger_command_capabilities AS capability
        INNER JOIN ledger_journals AS journal
          ON journal.capability_id = capability.capability_id
          OR (
            capability.posting_plan_id IS NOT NULL
            AND journal.posting_plan_id = capability.posting_plan_id
          )
          OR (
            capability.reversal_approval_id IS NOT NULL
            AND journal.reversal_approval_id = capability.reversal_approval_id
          )
        WHERE capability.capability_id = NEW.capability_id
      ) THEN
        RAISE EXCEPTION 'revoked ledger capability cannot be consumed'
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;
    $$;

    CREATE FUNCTION compute_ledger_posting_plan_digest(requested_posting_plan_id uuid)
    RETURNS bytea
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    AS $$
      SELECT pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'domain', 'KAN41:PLAN:v1',
          'postingPlanId', plan.posting_plan_id,
          'legId', plan.leg_id,
          'transactionId', plan.transaction_id,
          'bookId', plan.book_id,
          'tenantAccountId', plan.tenant_account_id,
          'event', plan.economic_event_type,
          'reason', plan.reason_code,
          'compensatesJournalId', (
            SELECT leg.compensates_journal_id
            FROM ledger_legs AS leg
            WHERE leg.leg_id = plan.leg_id
          ),
          'adjustsJournalId', (
            SELECT leg.adjusts_journal_id
            FROM ledger_legs AS leg
            WHERE leg.leg_id = plan.leg_id
          ),
          'lines', coalesce((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_array(
                line.plan_line_number,
                line.ledger_account_id,
                line.asset_revision_id,
                line.side,
                line.amount_atomic::text
              ) ORDER BY line.plan_line_number
            )
            FROM ledger_leg_posting_plan_lines AS line
            WHERE line.posting_plan_id = plan.posting_plan_id
          ), '[]'::jsonb),
          'recognition', (
            SELECT pg_catalog.jsonb_build_object(
              'referenceType', evidence.reference_type,
              'environment', evidence.environment,
              'namespaceType', evidence.namespace_type,
              'sourceReferenceId', evidence.source_reference_id,
              'canonicalLocatorReferenceId', evidence.canonical_locator_reference_id,
              'externalLocatorDigest', pg_catalog.encode(evidence.external_locator_digest, 'hex'),
              'recognitionPolicyReferenceId', evidence.recognition_policy_reference_id,
              'recognitionEvidenceRevisionReferenceId',
                evidence.recognition_evidence_revision_reference_id,
              'effectiveEpoch', EXTRACT(EPOCH FROM evidence.effective_at)::text,
              'observedEpoch', EXTRACT(EPOCH FROM evidence.observed_at)::text
            )
            FROM ledger_leg_recognition_evidence AS evidence
            WHERE evidence.posting_plan_id = plan.posting_plan_id
          ),
          'valuations', coalesce((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'valuationPlanLineNumber', valuation.valuation_plan_line_number,
                'valuationRole', valuation.valuation_role,
                'feePlanLineNumber', valuation.fee_plan_line_number,
                'assetRevisionId', valuation.asset_revision_id,
                'availability', valuation.availability,
                'valuedAmountAtomic', valuation.valued_amount_atomic::text,
                'usdRateMantissa', valuation.usd_rate_mantissa::text,
                'usdRateScale', valuation.usd_rate_scale,
                'usdValueMantissa', valuation.usd_value_mantissa::text,
                'roundingMode', valuation.rounding_mode,
                'sourceReferenceId', valuation.source_reference_id,
                'sourcePolicyReferenceId', valuation.source_policy_reference_id,
                'evidenceReferenceId', valuation.evidence_reference_id,
                'pricedEpoch', CASE WHEN valuation.priced_at IS NULL THEN NULL
                  ELSE EXTRACT(EPOCH FROM valuation.priced_at)::text END,
                'observedEpoch', EXTRACT(EPOCH FROM valuation.observed_at)::text,
                'freshnessClass', valuation.freshness_class,
                'confidenceClass', valuation.confidence_class,
                'depegClass', valuation.depeg_class
              ) ORDER BY valuation.valuation_plan_line_number
            )
            FROM ledger_leg_valuation_plans AS valuation
            WHERE valuation.posting_plan_id = plan.posting_plan_id
          ), '[]'::jsonb),
          'fees', coalesce((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'feePlanLineNumber', fee.fee_plan_line_number,
              'category', fee.category,
              'assetRevisionId', fee.asset_revision_id,
              'amountAtomic', fee.amount_atomic::text,
              'payerAccountId', fee.payer_account_id,
              'recipientAccountId', fee.recipient_account_id,
              'payerLineNumber', fee.payer_line_number,
              'recipientLineNumber', fee.recipient_line_number,
              'payerAllocationAmountAtomic', fee.payer_allocation_amount_atomic::text,
              'deductionMode', fee.deduction_mode,
              'feeRuleReferenceId', fee.fee_rule_reference_id,
              'quoteReferenceId', fee.quote_reference_id,
              'feeEstimateSnapshotId', fee.fee_estimate_snapshot_id,
              'adjustsFeeComponentId', fee.adjusts_fee_component_id,
              'evidenceReferenceType', fee.evidence_reference_type,
              'evidenceEnvironment', fee.evidence_environment,
              'evidenceNamespaceType', fee.evidence_namespace_type,
              'evidenceSourceReferenceId', fee.evidence_source_reference_id,
              'evidencePolicyReferenceId', fee.evidence_policy_reference_id,
              'evidenceRevisionReferenceId', fee.evidence_revision_reference_id,
              'canonicalLocatorReferenceId', fee.canonical_locator_reference_id,
              'externalLocatorDigest', pg_catalog.encode(fee.external_locator_digest, 'hex'),
              'evidenceObservedEpoch', EXTRACT(EPOCH FROM fee.evidence_observed_at)::text
            ) ORDER BY fee.fee_plan_line_number)
            FROM ledger_leg_fee_plans AS fee
            WHERE fee.posting_plan_id = plan.posting_plan_id
          ), '[]'::jsonb)
        )::text,
        'UTF8'
      ))
      FROM ledger_leg_posting_plans AS plan
      WHERE plan.posting_plan_id = requested_posting_plan_id
    $$;

    CREATE FUNCTION compute_ledger_reversal_approval_digest(
      requested_reversal_approval_id uuid
    )
    RETURNS bytea
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    AS $$
      SELECT pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'domain', 'KAN41:REVERSAL_APPROVAL:v1',
          'reversalApprovalId', approval.reversal_approval_id,
          'originalJournalId', approval.original_journal_id,
          'transactionId', approval.transaction_id,
          'legId', approval.leg_id,
          'bookId', approval.book_id,
          'tenantAccountId', approval.tenant_account_id,
          'reason', approval.reason_code,
          'approvalReferenceId', approval.approval_reference_id,
          'evidenceReferenceId', approval.evidence_reference_id,
          'referenceType', approval.reference_type,
          'environment', approval.environment,
          'namespaceType', approval.namespace_type,
          'sourceReferenceId', approval.source_reference_id,
          'canonicalLocatorReferenceId', approval.canonical_locator_reference_id,
          'externalLocatorDigest', pg_catalog.encode(approval.external_locator_digest, 'hex'),
          'effectiveEpoch', EXTRACT(EPOCH FROM approval.effective_at)::text,
          'observedEpoch', EXTRACT(EPOCH FROM approval.observed_at)::text,
          'originalLines', coalesce((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_array(
                line.line_number,
                line.ledger_account_id,
                line.asset_revision_id,
                line.side,
                line.amount_atomic::text
              ) ORDER BY line.line_number
            )
            FROM ledger_journal_lines AS line
            WHERE line.journal_id = approval.original_journal_id
          ), '[]'::jsonb),
          'originalValuations', coalesce((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'valuationSnapshotId', valuation.valuation_snapshot_id,
                'purpose', valuation.purpose,
                'valuationPlanLineNumber', valuation.valuation_plan_line_number,
                'valuationRole', valuation.valuation_role,
                'feePlanLineNumber', valuation.fee_plan_line_number,
                'assetRevisionId', valuation.asset_revision_id,
                'availability', valuation.availability,
                'valuedAmountAtomic', valuation.valued_amount_atomic::text,
                'usdRateMantissa', valuation.usd_rate_mantissa::text,
                'usdRateScale', valuation.usd_rate_scale,
                'usdValueMantissa', valuation.usd_value_mantissa::text,
                'roundingMode', valuation.rounding_mode,
                'sourceReferenceId', valuation.source_reference_id,
                'sourcePolicyReferenceId', valuation.source_policy_reference_id,
                'evidenceReferenceId', valuation.evidence_reference_id,
                'pricedEpoch', CASE WHEN valuation.priced_at IS NULL THEN NULL
                  ELSE EXTRACT(EPOCH FROM valuation.priced_at)::text END,
                'observedEpoch', EXTRACT(EPOCH FROM valuation.observed_at)::text,
                'freshnessClass', valuation.freshness_class,
                'confidenceClass', valuation.confidence_class,
                'depegClass', valuation.depeg_class
              ) ORDER BY valuation.valuation_snapshot_id
            )
            FROM ledger_valuation_snapshots AS valuation
            WHERE valuation.journal_id = approval.original_journal_id
              AND valuation.purpose IN ('SETTLEMENT', 'ADJUSTMENT')
          ), '[]'::jsonb),
          'originalFees', coalesce((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'feeComponentId', fee.fee_component_id,
                'valuationSnapshotId', fee.valuation_snapshot_id,
                'sourceExternalReferenceId', fee.source_external_reference_id,
                'feeEstimateSnapshotId', fee.fee_estimate_snapshot_id,
                'category', fee.category,
                'stage', fee.stage,
                'feePlanLineNumber', fee.fee_plan_line_number,
                'assetRevisionId', fee.asset_revision_id,
                'amountAtomic', fee.amount_atomic::text,
                'payerAccountId', fee.payer_account_id,
                'recipientAccountId', fee.recipient_account_id,
                'payerLineNumber', fee.payer_line_number,
                'recipientLineNumber', fee.recipient_line_number,
                'deductionMode', fee.deduction_mode,
                'feeRuleReferenceId', fee.fee_rule_reference_id,
                'quoteReferenceId', fee.quote_reference_id,
                'adjustsFeeComponentId', fee.adjusts_fee_component_id,
                'reversesFeeComponentId', fee.reverses_fee_component_id
              ) ORDER BY fee.fee_component_id
            )
            FROM ledger_fee_components AS fee
            WHERE fee.journal_id = approval.original_journal_id
          ), '[]'::jsonb),
          'originalReferences', coalesce((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'externalReferenceUsageId', usage.external_reference_usage_id,
                'externalEvidenceId', usage.external_evidence_id,
                'referenceType', evidence.reference_type,
                'referenceRole', usage.reference_role,
                'referenceUsage', usage.reference_usage,
                'relationType', usage.relation_type,
                'relatedExternalReferenceUsageId',
                  usage.related_external_reference_usage_id,
                'environment', evidence.environment,
                'namespaceType', evidence.namespace_type,
                'sourceReferenceId', evidence.source_reference_id,
                'policyReferenceId', usage.policy_reference_id,
                'evidenceRevisionReferenceId', usage.evidence_revision_reference_id,
                'canonicalLocatorReferenceId', evidence.canonical_locator_reference_id,
                'externalLocatorDigest', pg_catalog.encode(
                  evidence.external_locator_digest, 'hex'
                ),
                'observedEpoch', EXTRACT(EPOCH FROM evidence.observed_at)::text
              ) ORDER BY usage.external_reference_usage_id
            )
            FROM ledger_journal_external_reference_usages AS usage
            INNER JOIN ledger_external_evidence AS evidence
              ON evidence.external_evidence_id = usage.external_evidence_id
            WHERE usage.journal_id = approval.original_journal_id
          ), '[]'::jsonb)
        )::text,
        'UTF8'
      ))
      FROM ledger_reversal_approvals AS approval
      WHERE approval.reversal_approval_id = requested_reversal_approval_id
    $$;

    CREATE FUNCTION validate_ledger_posting_plan_seal()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      PERFORM 1
      FROM ledger_leg_posting_plans AS plan
      WHERE plan.posting_plan_id = NEW.posting_plan_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger posting plan is missing' USING ERRCODE = '23503';
      END IF;
      IF NEW.sealed_at > clock_timestamp()
        OR NEW.sealed_at IS DISTINCT FROM NEW.recorded_at
        OR EXISTS (
          SELECT 1
          FROM ledger_leg_posting_plans AS plan
          WHERE plan.posting_plan_id = NEW.posting_plan_id
            AND plan.recorded_at > NEW.sealed_at
        )
        OR EXISTS (
          SELECT 1
          FROM ledger_leg_posting_plan_lines AS plan_line
          WHERE plan_line.posting_plan_id = NEW.posting_plan_id
            AND plan_line.recorded_at > NEW.sealed_at
        )
        OR EXISTS (
          SELECT 1
          FROM ledger_leg_recognition_evidence AS evidence
          WHERE evidence.posting_plan_id = NEW.posting_plan_id
            AND (
              evidence.observed_at > NEW.sealed_at
              OR evidence.recorded_at > NEW.sealed_at
            )
        )
        OR EXISTS (
          SELECT 1
          FROM ledger_leg_valuation_plans AS valuation
          WHERE valuation.posting_plan_id = NEW.posting_plan_id
            AND (
              valuation.observed_at > NEW.sealed_at
              OR valuation.priced_at > NEW.sealed_at
              OR valuation.recorded_at > NEW.sealed_at
            )
        )
        OR EXISTS (
          SELECT 1
          FROM ledger_leg_fee_plans AS fee
          WHERE fee.posting_plan_id = NEW.posting_plan_id
            AND (
              fee.evidence_observed_at > NEW.sealed_at
              OR fee.recorded_at > NEW.sealed_at
            )
        )
        OR EXISTS (
          SELECT 1
          FROM ledger_leg_fee_plans AS fee
          INNER JOIN ledger_fee_estimate_snapshots AS estimate
            ON estimate.fee_estimate_snapshot_id = fee.fee_estimate_snapshot_id
          INNER JOIN ledger_valuation_snapshots AS quote_valuation
            ON quote_valuation.valuation_snapshot_id = estimate.valuation_snapshot_id
          WHERE fee.posting_plan_id = NEW.posting_plan_id
            AND (
              estimate.evidence_observed_at > NEW.sealed_at
              OR estimate.recorded_at > NEW.sealed_at
              OR quote_valuation.observed_at > NEW.sealed_at
              OR quote_valuation.priced_at > NEW.sealed_at
              OR quote_valuation.recorded_at > NEW.sealed_at
            )
        )
        OR NEW.sealed_plan_digest IS DISTINCT FROM
          compute_ledger_posting_plan_digest(NEW.posting_plan_id)
      THEN
        RAISE EXCEPTION 'ledger posting plan seal is invalid' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION post_ledger_journal(
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
    )
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      computed_capability_digest bytea;
      authorized_capability_id uuid;
      authorized_posting_plan_id uuid;
      authorized_book_id uuid;
      authorized_transaction_id uuid;
      authorized_leg_id uuid;
      authorized_actor_account_id uuid;
      authorized_event_type text;
      authorized_reason_code text;
      authorized_effective_at timestamptz;
      authorized_observed_at timestamptz;
      authorized_expires_at timestamptz;
      authorized_compensates_journal_id uuid;
      authorized_adjusts_journal_id uuid;
      generated_journal_id uuid;
      resolution_time timestamptz;
      parsed_postings json;
      posting_value json;
      posting_ordinality bigint;
      posting_key_count bigint;
      posting_distinct_key_count bigint;
      posting_keys text[];
      posting_account_text text;
      posting_asset_revision_text text;
      posting_side text;
      posting_amount_text text;
      posting_account_id uuid;
      posting_asset_revision_id uuid;
      posting_amount numeric;
    BEGIN
      IF requested_capability_token IS NULL
        OR requested_capability_token !~ '^[0-9a-f]{64}$'
      THEN
        RAISE EXCEPTION 'ledger posting capability is unavailable'
          USING ERRCODE = '42501';
      END IF;
      computed_capability_digest := pg_catalog.sha256(
        pg_catalog.convert_to('KAN41:POST:v1', 'UTF8')
        || pg_catalog.decode(requested_capability_token, 'hex')
      );

      SELECT capability.capability_id,
             plan.posting_plan_id,
             plan.book_id,
             plan.transaction_id,
             plan.leg_id,
             plan.tenant_account_id,
             plan.economic_event_type,
             plan.reason_code,
             evidence.effective_at,
             evidence.observed_at,
             capability.expires_at,
             leg.compensates_journal_id,
             leg.adjusts_journal_id
      INTO authorized_capability_id,
           authorized_posting_plan_id,
           authorized_book_id,
           authorized_transaction_id,
           authorized_leg_id,
           authorized_actor_account_id,
           authorized_event_type,
           authorized_reason_code,
           authorized_effective_at,
           authorized_observed_at,
           authorized_expires_at,
           authorized_compensates_journal_id,
           authorized_adjusts_journal_id
      FROM ledger_command_capabilities AS capability
      INNER JOIN ledger_leg_posting_plans AS plan
        ON plan.posting_plan_id = capability.posting_plan_id
       AND plan.leg_id = capability.leg_id
       AND plan.transaction_id = capability.transaction_id
       AND plan.book_id = capability.book_id
       AND plan.tenant_account_id = capability.tenant_account_id
      INNER JOIN ledger_leg_posting_plan_seals AS seal
        ON seal.posting_plan_id = plan.posting_plan_id
       AND seal.sealed_plan_digest = capability.target_digest
      INNER JOIN ledger_leg_recognition_evidence AS evidence
        ON evidence.posting_plan_id = plan.posting_plan_id
      INNER JOIN ledger_legs AS leg
        ON leg.leg_id = plan.leg_id
       AND leg.transaction_id = plan.transaction_id
       AND leg.book_id = plan.book_id
       AND leg.tenant_account_id = plan.tenant_account_id
      WHERE capability.capability_purpose = 'POST'
        AND capability.capability_scheme = 'BEARER_256_V1'
        AND capability.token_encoding = 'LOWER_HEX_32'
        AND capability.hash_algorithm = 'SHA256'
        AND capability.hash_domain = 'KAN41:POST:v1'
        AND capability.capability_digest = computed_capability_digest
      FOR UPDATE OF capability, plan;

      IF NOT FOUND
        OR clock_timestamp() >= authorized_expires_at
        OR EXISTS (
          SELECT 1
          FROM ledger_command_capability_resolutions AS resolution
          WHERE resolution.capability_id = authorized_capability_id
        )
        OR EXISTS (
          SELECT 1
          FROM ledger_journals AS journal
          WHERE journal.posting_plan_id = authorized_posting_plan_id
             OR journal.capability_id = authorized_capability_id
        )
        OR compute_ledger_posting_plan_digest(authorized_posting_plan_id) IS DISTINCT FROM (
          SELECT capability.target_digest
          FROM ledger_command_capabilities AS capability
          WHERE capability.capability_id = authorized_capability_id
        )
        OR requested_book_id IS DISTINCT FROM authorized_book_id
        OR requested_transaction_id IS DISTINCT FROM authorized_transaction_id
        OR requested_leg_id IS DISTINCT FROM authorized_leg_id
        OR requested_economic_event_type IS DISTINCT FROM authorized_event_type
        OR requested_reason_code IS DISTINCT FROM authorized_reason_code
        OR requested_effective_at IS DISTINCT FROM authorized_effective_at
        OR requested_observed_at IS DISTINCT FROM authorized_observed_at
      THEN
        RAISE EXCEPTION 'ledger posting capability is unavailable'
          USING ERRCODE = '42501';
      END IF;

      IF requested_correlation_id IS NULL
        OR substring(requested_correlation_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_correlation_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
      THEN
        RAISE EXCEPTION 'ledger posting request is invalid' USING ERRCODE = '22023';
      END IF;

      IF requested_postings IS NULL
        OR octet_length(requested_postings) < 2
        OR octet_length(requested_postings) > ${MAX_POSTINGS_JSON_BYTES}
      THEN
        RAISE EXCEPTION 'ledger posting request is invalid' USING ERRCODE = '22023';
      END IF;
      BEGIN
        parsed_postings := requested_postings::json;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'ledger posting request is invalid' USING ERRCODE = '22023';
      END;
      IF json_typeof(parsed_postings) <> 'array' THEN
        RAISE EXCEPTION 'ledger posting request is invalid' USING ERRCODE = '22023';
      END IF;
      IF json_array_length(parsed_postings) NOT BETWEEN 2 AND 64 THEN
        RAISE EXCEPTION 'ledger posting request is invalid' USING ERRCODE = '22023';
      END IF;

      FOR posting_value, posting_ordinality IN
        SELECT posting.value, posting.ordinality
        FROM json_array_elements(parsed_postings) WITH ORDINALITY AS posting(value, ordinality)
      LOOP
        IF json_typeof(posting_value) <> 'object' THEN
          RAISE EXCEPTION 'ledger posting request is invalid' USING ERRCODE = '22023';
        END IF;
        SELECT count(*), count(DISTINCT key), array_agg(key ORDER BY key)
        INTO posting_key_count, posting_distinct_key_count, posting_keys
        FROM json_each(posting_value);
        IF posting_key_count <> 4
          OR posting_distinct_key_count <> 4
          OR posting_keys <>
            ARRAY['accountId', 'amountAtomic', 'assetRevisionId', 'side']::text[]
          OR json_typeof(posting_value -> 'accountId') <> 'string'
          OR json_typeof(posting_value -> 'assetRevisionId') <> 'string'
          OR json_typeof(posting_value -> 'side') <> 'string'
          OR json_typeof(posting_value -> 'amountAtomic') <> 'string'
        THEN
          RAISE EXCEPTION 'ledger posting request is invalid' USING ERRCODE = '22023';
        END IF;

        posting_account_text := posting_value ->> 'accountId';
        posting_asset_revision_text := posting_value ->> 'assetRevisionId';
        posting_side := posting_value ->> 'side';
        posting_amount_text := posting_value ->> 'amountAtomic';
        IF posting_account_text !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR posting_asset_revision_text !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR posting_side NOT IN ('DEBIT', 'CREDIT')
          OR posting_amount_text !~ '^[1-9][0-9]{0,77}$'
        THEN
          RAISE EXCEPTION 'ledger posting request is invalid' USING ERRCODE = '22023';
        END IF;
        posting_account_id := posting_account_text::uuid;
        posting_asset_revision_id := posting_asset_revision_text::uuid;
        posting_amount := posting_amount_text::numeric;
        IF posting_amount > ${MAX_ATOMIC_AMOUNT}::numeric OR NOT EXISTS (
          SELECT 1
          FROM ledger_leg_posting_plan_lines AS plan_line
          WHERE plan_line.posting_plan_id = authorized_posting_plan_id
            AND plan_line.plan_line_number = posting_ordinality
            AND plan_line.ledger_account_id = posting_account_id
            AND plan_line.asset_revision_id = posting_asset_revision_id
            AND plan_line.side = posting_side
            AND plan_line.amount_atomic = posting_amount
        ) THEN
          RAISE EXCEPTION 'ledger posting request does not match its capability'
            USING ERRCODE = '42501';
        END IF;
      END LOOP;

      IF (
        SELECT count(*)
        FROM ledger_leg_posting_plan_lines AS plan_line
        WHERE plan_line.posting_plan_id = authorized_posting_plan_id
      ) <> json_array_length(parsed_postings) THEN
        RAISE EXCEPTION 'ledger posting request does not match its capability'
          USING ERRCODE = '42501';
      END IF;

      generated_journal_id := gen_random_uuid();
      resolution_time := clock_timestamp();
      IF resolution_time >= authorized_expires_at THEN
        RAISE EXCEPTION 'ledger posting capability is unavailable'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO ledger_command_capability_resolutions (
        capability_id, outcome, journal_id, resolution_reason_code,
        resolved_at, recorded_at
      ) VALUES (
        authorized_capability_id, 'CONSUMED', generated_journal_id,
        'COMMAND_COMMITTED', resolution_time, resolution_time
      );

      INSERT INTO ledger_journals (
        journal_id, book_id, transaction_id, leg_id, actor_account_id,
        posting_plan_id, reversal_approval_id, capability_id,
        economic_event_type, effective_at, observed_at, reason_code,
        correlation_id, compensates_journal_id, adjusts_journal_id, recorded_at
      ) VALUES (
        generated_journal_id, authorized_book_id, authorized_transaction_id,
        authorized_leg_id, authorized_actor_account_id, authorized_posting_plan_id,
        NULL, authorized_capability_id, authorized_event_type,
        authorized_effective_at, authorized_observed_at, authorized_reason_code,
        requested_correlation_id, authorized_compensates_journal_id,
        authorized_adjusts_journal_id, resolution_time
      );

      INSERT INTO ledger_journal_lines (
        journal_id, line_number, book_id, ledger_account_id,
        asset_revision_id, side, amount_atomic
      )
      SELECT generated_journal_id,
             plan_line.plan_line_number,
             plan_line.book_id,
             plan_line.ledger_account_id,
             plan_line.asset_revision_id,
             plan_line.side,
             plan_line.amount_atomic
      FROM ledger_leg_posting_plan_lines AS plan_line
      WHERE plan_line.posting_plan_id = authorized_posting_plan_id
      ORDER BY plan_line.plan_line_number;

      INSERT INTO ledger_external_evidence (
        reference_type, environment, namespace_type, source_reference_id,
        canonical_locator_reference_id, external_locator_digest,
        locator_digest_algorithm, canonicalization_version, observed_at
      )
      SELECT evidence.reference_type,
             evidence.environment,
             evidence.namespace_type,
             evidence.source_reference_id,
             evidence.canonical_locator_reference_id,
             evidence.external_locator_digest,
             'SHA256',
             1,
             evidence.observed_at
      FROM ledger_leg_recognition_evidence AS evidence
      WHERE evidence.posting_plan_id = authorized_posting_plan_id
      ON CONFLICT ON CONSTRAINT ledger_external_evidence_occurrence_unique DO NOTHING;

      INSERT INTO ledger_external_evidence (
        reference_type, environment, namespace_type, source_reference_id,
        canonical_locator_reference_id, external_locator_digest,
        locator_digest_algorithm, canonicalization_version, observed_at
      )
      SELECT DISTINCT fee.evidence_reference_type,
             fee.evidence_environment,
             fee.evidence_namespace_type,
             fee.evidence_source_reference_id,
             fee.canonical_locator_reference_id,
             fee.external_locator_digest,
             'SHA256',
             1,
             fee.evidence_observed_at
      FROM ledger_leg_fee_plans AS fee
      WHERE fee.posting_plan_id = authorized_posting_plan_id
      ON CONFLICT ON CONSTRAINT ledger_external_evidence_occurrence_unique DO NOTHING;

      INSERT INTO ledger_external_evidence_claims (
        external_evidence_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      )
      SELECT occurrence.external_evidence_id,
             generated_journal_id,
             evidence.leg_id,
             evidence.transaction_id,
             evidence.book_id,
             evidence.tenant_account_id
      FROM ledger_leg_recognition_evidence AS evidence
      INNER JOIN ledger_external_evidence AS occurrence
        ON occurrence.environment = evidence.environment
       AND occurrence.reference_type = evidence.reference_type
       AND occurrence.namespace_type = evidence.namespace_type
       AND occurrence.source_reference_id = evidence.source_reference_id
       AND occurrence.external_locator_digest = evidence.external_locator_digest
      WHERE evidence.posting_plan_id = authorized_posting_plan_id
      ON CONFLICT (external_evidence_id, journal_id) DO NOTHING;

      INSERT INTO ledger_external_evidence_claims (
        external_evidence_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      )
      SELECT DISTINCT occurrence.external_evidence_id,
             generated_journal_id,
             fee.leg_id,
             fee.transaction_id,
             fee.book_id,
             fee.tenant_account_id
      FROM ledger_leg_fee_plans AS fee
      INNER JOIN ledger_external_evidence AS occurrence
        ON occurrence.environment = fee.evidence_environment
       AND occurrence.reference_type = fee.evidence_reference_type
       AND occurrence.namespace_type = fee.evidence_namespace_type
       AND occurrence.source_reference_id = fee.evidence_source_reference_id
       AND occurrence.external_locator_digest = fee.external_locator_digest
      WHERE fee.posting_plan_id = authorized_posting_plan_id
      ON CONFLICT (external_evidence_id, journal_id) DO NOTHING;

      INSERT INTO ledger_journal_external_reference_usages (
        external_evidence_id, book_id, transaction_id, leg_id, tenant_account_id,
        journal_id, posting_plan_id, reversal_approval_id,
        related_external_reference_usage_id, relation_type,
        reference_role, reference_usage, policy_reference_id,
        evidence_revision_reference_id
      )
      SELECT occurrence.external_evidence_id,
             evidence.book_id,
             evidence.transaction_id,
             evidence.leg_id,
             evidence.tenant_account_id,
             generated_journal_id,
             evidence.posting_plan_id,
             NULL,
             CASE authorized_event_type
               WHEN 'COMPENSATION' THEN (
                 SELECT related.external_reference_usage_id
                 FROM ledger_journal_external_reference_usages AS related
                 WHERE related.journal_id = authorized_compensates_journal_id
                   AND related.reference_usage = 'PRIMARY_RECOGNITION'
               )
               WHEN 'ADJUSTMENT' THEN (
                 SELECT related.external_reference_usage_id
                 FROM ledger_journal_external_reference_usages AS related
                 WHERE related.journal_id = authorized_adjusts_journal_id
                   AND related.reference_usage = 'PRIMARY_RECOGNITION'
               )
               ELSE NULL
             END,
             CASE authorized_event_type
               WHEN 'COMPENSATION' THEN 'COMPENSATES'
               WHEN 'ADJUSTMENT' THEN 'SUPERSEDES'
               ELSE NULL
             END,
             CASE authorized_event_type
               WHEN 'SETTLEMENT' THEN 'SETTLEMENT'
               WHEN 'ACTUAL_FEE' THEN 'FEE'
               WHEN 'COMPENSATION' THEN 'COMPENSATION'
               ELSE 'ADJUSTMENT'
             END,
             'PRIMARY_RECOGNITION',
             evidence.recognition_policy_reference_id,
             evidence.recognition_evidence_revision_reference_id
      FROM ledger_leg_recognition_evidence AS evidence
      INNER JOIN ledger_external_evidence AS occurrence
        ON occurrence.environment = evidence.environment
       AND occurrence.reference_type = evidence.reference_type
       AND occurrence.namespace_type = evidence.namespace_type
       AND occurrence.source_reference_id = evidence.source_reference_id
       AND occurrence.external_locator_digest = evidence.external_locator_digest
      WHERE evidence.posting_plan_id = authorized_posting_plan_id;

      INSERT INTO ledger_journal_external_reference_usages (
        external_evidence_id, book_id, transaction_id, leg_id, tenant_account_id,
        journal_id, posting_plan_id, reversal_approval_id,
        related_external_reference_usage_id, relation_type,
        reference_role, reference_usage, policy_reference_id,
        evidence_revision_reference_id
      )
      SELECT DISTINCT occurrence.external_evidence_id,
             fee.book_id,
             fee.transaction_id,
             fee.leg_id,
             fee.tenant_account_id,
             generated_journal_id,
             fee.posting_plan_id,
             NULL::uuid,
             NULL::uuid,
             NULL::text,
             'FEE',
             'FEE_EVIDENCE',
             fee.evidence_policy_reference_id,
             fee.evidence_revision_reference_id
      FROM ledger_leg_fee_plans AS fee
      INNER JOIN ledger_external_evidence AS occurrence
        ON occurrence.environment = fee.evidence_environment
       AND occurrence.reference_type = fee.evidence_reference_type
       AND occurrence.namespace_type = fee.evidence_namespace_type
       AND occurrence.source_reference_id = fee.evidence_source_reference_id
       AND occurrence.external_locator_digest = fee.external_locator_digest
      WHERE fee.posting_plan_id = authorized_posting_plan_id
        AND NOT (
          authorized_event_type = 'ACTUAL_FEE'
          AND EXISTS (
            SELECT 1
            FROM ledger_leg_recognition_evidence AS recognition
            WHERE recognition.posting_plan_id = fee.posting_plan_id
              AND recognition.reference_type = fee.evidence_reference_type
              AND recognition.environment = fee.evidence_environment
              AND recognition.namespace_type = fee.evidence_namespace_type
              AND recognition.source_reference_id = fee.evidence_source_reference_id
              AND recognition.external_locator_digest = fee.external_locator_digest
              AND recognition.recognition_policy_reference_id =
                fee.evidence_policy_reference_id
              AND recognition.recognition_evidence_revision_reference_id =
                fee.evidence_revision_reference_id
          )
        );


      INSERT INTO ledger_valuation_snapshots (
        book_id, transaction_id, leg_id, tenant_account_id, journal_id,
        purpose, valuation_plan_line_number, valuation_role, fee_plan_line_number,
        availability, asset_revision_id, valued_amount_atomic,
        usd_rate_mantissa, usd_rate_scale, usd_value_mantissa, rounding_mode,
        source_reference_id, source_policy_reference_id, evidence_reference_id,
        priced_at, observed_at, freshness_class, confidence_class, depeg_class
      )
      SELECT valuation.book_id,
             valuation.transaction_id,
             valuation.leg_id,
             valuation.tenant_account_id,
             generated_journal_id,
             CASE WHEN authorized_event_type = 'ADJUSTMENT'
               THEN 'ADJUSTMENT' ELSE 'SETTLEMENT' END,
             valuation.valuation_plan_line_number,
             valuation.valuation_role,
             valuation.fee_plan_line_number,
             valuation.availability,
             valuation.asset_revision_id,
             valuation.valued_amount_atomic,
             valuation.usd_rate_mantissa,
             valuation.usd_rate_scale,
             valuation.usd_value_mantissa,
             valuation.rounding_mode,
             valuation.source_reference_id,
             valuation.source_policy_reference_id,
             valuation.evidence_reference_id,
             valuation.priced_at,
             valuation.observed_at,
             valuation.freshness_class,
             valuation.confidence_class,
             valuation.depeg_class
      FROM ledger_leg_valuation_plans AS valuation
      WHERE valuation.posting_plan_id = authorized_posting_plan_id
      ORDER BY valuation.valuation_plan_line_number;

      IF EXISTS (
        SELECT 1
        FROM ledger_leg_fee_plans AS fee
        WHERE fee.posting_plan_id = authorized_posting_plan_id
      ) THEN
        INSERT INTO ledger_fee_components (
          book_id, transaction_id, leg_id, tenant_account_id, journal_id,
          valuation_snapshot_id, source_external_reference_id,
          fee_estimate_snapshot_id, category, stage,
          fee_plan_line_number, asset_revision_id,
          amount_atomic, payer_account_id, recipient_account_id,
          payer_line_number, recipient_line_number, deduction_mode,
          fee_rule_reference_id, quote_reference_id, adjusts_fee_component_id
        )
        SELECT fee.book_id,
               fee.transaction_id,
               fee.leg_id,
               fee.tenant_account_id,
               generated_journal_id,
               valuation.valuation_snapshot_id,
               fee_reference.external_reference_usage_id,
               fee.fee_estimate_snapshot_id,
               fee.category,
               CASE WHEN authorized_event_type = 'ADJUSTMENT'
                 THEN 'ADJUSTMENT' ELSE 'ACTUAL' END,
               fee.fee_plan_line_number,
               fee.asset_revision_id,
               fee.amount_atomic,
               fee.payer_account_id,
               fee.recipient_account_id,
               fee.payer_line_number,
               fee.recipient_line_number,
               fee.deduction_mode,
               fee.fee_rule_reference_id,
               fee.quote_reference_id,
               fee.adjusts_fee_component_id
        FROM ledger_leg_fee_plans AS fee
        INNER JOIN ledger_valuation_snapshots AS valuation
          ON valuation.journal_id = generated_journal_id
         AND valuation.valuation_role = 'FEE_COMPONENT'
         AND valuation.fee_plan_line_number = fee.fee_plan_line_number
         AND valuation.asset_revision_id = fee.asset_revision_id
         AND valuation.valued_amount_atomic = fee.amount_atomic
        INNER JOIN ledger_journal_external_reference_usages AS fee_reference
          ON fee_reference.journal_id = generated_journal_id
         AND fee_reference.posting_plan_id = fee.posting_plan_id
         AND fee_reference.reference_role = 'FEE'
         AND fee_reference.policy_reference_id = fee.evidence_policy_reference_id
         AND fee_reference.evidence_revision_reference_id =
           fee.evidence_revision_reference_id
        INNER JOIN ledger_external_evidence AS fee_evidence
          ON fee_evidence.external_evidence_id = fee_reference.external_evidence_id
         AND fee_evidence.environment = fee.evidence_environment
         AND fee_evidence.reference_type = fee.evidence_reference_type
         AND fee_evidence.namespace_type = fee.evidence_namespace_type
         AND fee_evidence.source_reference_id = fee.evidence_source_reference_id
         AND fee_evidence.external_locator_digest = fee.external_locator_digest
        WHERE fee.posting_plan_id = authorized_posting_plan_id;
      END IF;

      RETURN generated_journal_id;
    END;
    $$;

    CREATE FUNCTION reverse_ledger_journal(
      requested_capability_token text,
      requested_original_journal_id uuid,
      requested_reason_code text,
      requested_effective_at timestamptz,
      requested_observed_at timestamptz,
      requested_correlation_id uuid
    )
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      computed_capability_digest bytea;
      authorized_capability_id uuid;
      authorized_reversal_approval_id uuid;
      authorized_original_journal_id uuid;
      authorized_book_id uuid;
      authorized_transaction_id uuid;
      authorized_leg_id uuid;
      authorized_actor_account_id uuid;
      authorized_reason_code text;
      authorized_approval_reference_id uuid;
      authorized_effective_at timestamptz;
      authorized_observed_at timestamptz;
      authorized_expires_at timestamptz;
      generated_reversal_journal_id uuid;
      resolution_time timestamptz;
    BEGIN
      IF requested_capability_token IS NULL
        OR requested_capability_token !~ '^[0-9a-f]{64}$'
      THEN
        RAISE EXCEPTION 'ledger reversal capability is unavailable'
          USING ERRCODE = '42501';
      END IF;
      computed_capability_digest := pg_catalog.sha256(
        pg_catalog.convert_to('KAN41:REVERSE:v1', 'UTF8')
        || pg_catalog.decode(requested_capability_token, 'hex')
      );

      SELECT capability.capability_id,
             approval.reversal_approval_id,
             approval.original_journal_id,
             approval.book_id,
             approval.transaction_id,
             approval.leg_id,
             approval.tenant_account_id,
             approval.reason_code,
             approval.approval_reference_id,
             approval.effective_at,
             approval.observed_at,
             capability.expires_at
      INTO authorized_capability_id,
           authorized_reversal_approval_id,
           authorized_original_journal_id,
           authorized_book_id,
           authorized_transaction_id,
           authorized_leg_id,
           authorized_actor_account_id,
           authorized_reason_code,
           authorized_approval_reference_id,
           authorized_effective_at,
           authorized_observed_at,
           authorized_expires_at
      FROM ledger_command_capabilities AS capability
      INNER JOIN ledger_reversal_approvals AS approval
        ON approval.reversal_approval_id = capability.reversal_approval_id
       AND approval.original_journal_id = capability.original_journal_id
       AND approval.leg_id = capability.leg_id
       AND approval.transaction_id = capability.transaction_id
       AND approval.book_id = capability.book_id
       AND approval.tenant_account_id = capability.tenant_account_id
       AND approval.sealed_approval_digest = capability.target_digest
      INNER JOIN ledger_journals AS original
        ON original.journal_id = approval.original_journal_id
       AND original.leg_id = approval.leg_id
       AND original.transaction_id = approval.transaction_id
       AND original.book_id = approval.book_id
       AND original.actor_account_id = approval.tenant_account_id
      WHERE capability.capability_purpose = 'REVERSE'
        AND capability.capability_scheme = 'BEARER_256_V1'
        AND capability.token_encoding = 'LOWER_HEX_32'
        AND capability.hash_algorithm = 'SHA256'
        AND capability.hash_domain = 'KAN41:REVERSE:v1'
        AND capability.capability_digest = computed_capability_digest
        AND original.economic_event_type <> 'REVERSAL'
      FOR UPDATE OF capability, approval, original;

      IF NOT FOUND
        OR clock_timestamp() >= authorized_expires_at
        OR EXISTS (
          SELECT 1
          FROM ledger_command_capability_resolutions AS resolution
          WHERE resolution.capability_id = authorized_capability_id
        )
        OR EXISTS (
          SELECT 1
          FROM ledger_journals AS journal
          WHERE journal.reversal_approval_id = authorized_reversal_approval_id
             OR journal.reverses_journal_id = authorized_original_journal_id
             OR journal.capability_id = authorized_capability_id
        )
        OR compute_ledger_reversal_approval_digest(authorized_reversal_approval_id)
          IS DISTINCT FROM (
            SELECT capability.target_digest
            FROM ledger_command_capabilities AS capability
            WHERE capability.capability_id = authorized_capability_id
          )
        OR requested_original_journal_id IS DISTINCT FROM authorized_original_journal_id
        OR requested_reason_code IS DISTINCT FROM authorized_reason_code
        OR requested_effective_at IS DISTINCT FROM authorized_effective_at
        OR requested_observed_at IS DISTINCT FROM authorized_observed_at
      THEN
        RAISE EXCEPTION 'ledger reversal capability is unavailable'
          USING ERRCODE = '42501';
      END IF;

      IF requested_correlation_id IS NULL
        OR substring(requested_correlation_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_correlation_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
      THEN
        RAISE EXCEPTION 'ledger reversal request is invalid' USING ERRCODE = '22023';
      END IF;

      generated_reversal_journal_id := gen_random_uuid();
      resolution_time := clock_timestamp();
      IF resolution_time >= authorized_expires_at THEN
        RAISE EXCEPTION 'ledger reversal capability is unavailable'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO ledger_command_capability_resolutions (
        capability_id, outcome, journal_id, resolution_reason_code,
        resolved_at, recorded_at
      ) VALUES (
        authorized_capability_id, 'CONSUMED', generated_reversal_journal_id,
        'COMMAND_COMMITTED', resolution_time, resolution_time
      );

      INSERT INTO ledger_journals (
        journal_id, book_id, transaction_id, leg_id, actor_account_id,
        posting_plan_id, reversal_approval_id, capability_id,
        economic_event_type, effective_at, observed_at, reason_code,
        correlation_id, reverses_journal_id, approval_reference_id, recorded_at
      ) VALUES (
        generated_reversal_journal_id, authorized_book_id,
        authorized_transaction_id, authorized_leg_id, authorized_actor_account_id,
        NULL, authorized_reversal_approval_id, authorized_capability_id,
        'REVERSAL', authorized_effective_at, authorized_observed_at,
        authorized_reason_code, requested_correlation_id,
        authorized_original_journal_id, authorized_approval_reference_id, resolution_time
      );

      INSERT INTO ledger_journal_lines (
        journal_id, line_number, book_id, ledger_account_id,
        asset_revision_id, side, amount_atomic
      )
      SELECT generated_reversal_journal_id,
             original.line_number,
             original.book_id,
             original.ledger_account_id,
             original.asset_revision_id,
             CASE original.side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
             original.amount_atomic
      FROM ledger_journal_lines AS original
      WHERE original.journal_id = authorized_original_journal_id
      ORDER BY original.line_number;

      INSERT INTO ledger_valuation_snapshots (
        book_id, transaction_id, leg_id, tenant_account_id, journal_id,
        purpose, valuation_plan_line_number, valuation_role, fee_plan_line_number,
        availability, asset_revision_id, valued_amount_atomic,
        usd_rate_mantissa, usd_rate_scale, usd_value_mantissa, rounding_mode,
        source_reference_id, source_policy_reference_id, evidence_reference_id,
        reverses_valuation_snapshot_id, priced_at, observed_at,
        freshness_class, confidence_class, depeg_class
      )
      SELECT original.book_id,
             original.transaction_id,
             original.leg_id,
             original.tenant_account_id,
             generated_reversal_journal_id,
             'REVERSAL',
             original.valuation_plan_line_number,
             original.valuation_role,
             original.fee_plan_line_number,
             original.availability,
             original.asset_revision_id,
             original.valued_amount_atomic,
             original.usd_rate_mantissa,
             original.usd_rate_scale,
             original.usd_value_mantissa,
             original.rounding_mode,
             original.source_reference_id,
             original.source_policy_reference_id,
             original.evidence_reference_id,
             original.valuation_snapshot_id,
             original.priced_at,
             original.observed_at,
             original.freshness_class,
             original.confidence_class,
             original.depeg_class
      FROM ledger_valuation_snapshots AS original
      WHERE original.journal_id = authorized_original_journal_id
        AND original.purpose IN ('SETTLEMENT', 'ADJUSTMENT')
      ORDER BY original.valuation_plan_line_number;

      INSERT INTO ledger_external_evidence (
        reference_type, environment, namespace_type, source_reference_id,
        canonical_locator_reference_id, external_locator_digest,
        locator_digest_algorithm, canonicalization_version, observed_at
      )
      SELECT approval.reference_type,
             approval.environment,
             approval.namespace_type,
             approval.source_reference_id,
             approval.canonical_locator_reference_id,
             approval.external_locator_digest,
             'SHA256',
             1,
             approval.observed_at
      FROM ledger_reversal_approvals AS approval
      WHERE approval.reversal_approval_id = authorized_reversal_approval_id
      ON CONFLICT ON CONSTRAINT ledger_external_evidence_occurrence_unique DO NOTHING;

      INSERT INTO ledger_external_evidence_claims (
        external_evidence_id, journal_id, leg_id, transaction_id, book_id,
        tenant_account_id
      )
      SELECT occurrence.external_evidence_id,
             generated_reversal_journal_id,
             approval.leg_id,
             approval.transaction_id,
             approval.book_id,
             approval.tenant_account_id
      FROM ledger_reversal_approvals AS approval
      INNER JOIN ledger_external_evidence AS occurrence
        ON occurrence.environment = approval.environment
       AND occurrence.reference_type = approval.reference_type
       AND occurrence.namespace_type = approval.namespace_type
       AND occurrence.source_reference_id = approval.source_reference_id
       AND occurrence.external_locator_digest = approval.external_locator_digest
      WHERE approval.reversal_approval_id = authorized_reversal_approval_id
      ON CONFLICT (external_evidence_id, journal_id) DO NOTHING;

      INSERT INTO ledger_journal_external_reference_usages (
        external_evidence_id, book_id, transaction_id, leg_id, tenant_account_id,
        journal_id, posting_plan_id, reversal_approval_id,
        related_external_reference_usage_id, relation_type,
        reference_role, reference_usage, policy_reference_id,
        evidence_revision_reference_id
      )
      SELECT occurrence.external_evidence_id,
             original.book_id,
             original.transaction_id,
             original.leg_id,
             original.tenant_account_id,
             generated_reversal_journal_id,
             NULL::uuid,
             authorized_reversal_approval_id,
             original.external_reference_usage_id,
             'REVERSAL_OF',
             CASE original.reference_usage
               WHEN 'PRIMARY_RECOGNITION' THEN 'REVERSAL'
               ELSE 'FEE'
             END,
             original.reference_usage,
             approval.approval_reference_id,
             approval.evidence_reference_id
      FROM ledger_journal_external_reference_usages AS original
      INNER JOIN ledger_reversal_approvals AS approval
        ON approval.reversal_approval_id = authorized_reversal_approval_id
      INNER JOIN ledger_external_evidence AS occurrence
        ON occurrence.environment = approval.environment
       AND occurrence.reference_type = approval.reference_type
       AND occurrence.namespace_type = approval.namespace_type
       AND occurrence.source_reference_id = approval.source_reference_id
       AND occurrence.external_locator_digest = approval.external_locator_digest
      WHERE original.journal_id = authorized_original_journal_id
      ORDER BY original.external_reference_usage_id;


      INSERT INTO ledger_fee_components (
        book_id, transaction_id, leg_id, tenant_account_id, journal_id,
        valuation_snapshot_id, source_external_reference_id,
        fee_estimate_snapshot_id, category, stage,
        fee_plan_line_number, asset_revision_id,
        amount_atomic, payer_account_id, recipient_account_id,
        payer_line_number, recipient_line_number, deduction_mode,
        fee_rule_reference_id, quote_reference_id, adjusts_fee_component_id,
        reverses_fee_component_id
      )
      SELECT original.book_id,
             original.transaction_id,
             original.leg_id,
             original.tenant_account_id,
             generated_reversal_journal_id,
             reversal_valuation.valuation_snapshot_id,
             reversal_reference.external_reference_usage_id,
             original.fee_estimate_snapshot_id,
             original.category,
             original.stage,
             original.fee_plan_line_number,
             original.asset_revision_id,
             original.amount_atomic,
             original.recipient_account_id,
             original.payer_account_id,
             original.recipient_line_number,
             original.payer_line_number,
             original.deduction_mode,
             original.fee_rule_reference_id,
             original.quote_reference_id,
             original.adjusts_fee_component_id,
             original.fee_component_id
      FROM ledger_fee_components AS original
      INNER JOIN ledger_valuation_snapshots AS original_valuation
        ON original_valuation.valuation_snapshot_id = original.valuation_snapshot_id
      INNER JOIN ledger_valuation_snapshots AS reversal_valuation
        ON reversal_valuation.journal_id = generated_reversal_journal_id
       AND reversal_valuation.reverses_valuation_snapshot_id =
         original_valuation.valuation_snapshot_id
      INNER JOIN ledger_journal_external_reference_usages AS original_source_reference
        ON original_source_reference.external_reference_usage_id =
          original.source_external_reference_id
      INNER JOIN ledger_journal_external_reference_usages AS reversal_reference
        ON reversal_reference.journal_id = generated_reversal_journal_id
       AND reversal_reference.related_external_reference_usage_id =
         original.source_external_reference_id
       AND reversal_reference.reference_usage = original_source_reference.reference_usage
       AND reversal_reference.reference_role = CASE
         WHEN original_source_reference.reference_usage = 'PRIMARY_RECOGNITION'
           THEN 'REVERSAL'
         ELSE 'FEE'
       END
      WHERE original.journal_id = authorized_original_journal_id
        AND original.stage IN ('ACTUAL', 'ADJUSTMENT');

      RETURN generated_reversal_journal_id;
    END;
    $$;

    CREATE FUNCTION assert_ledger_journal_integrity(target_journal_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      target_event_type text;
      target_posting_plan_id uuid;
      target_reversal_approval_id uuid;
      target_reverses_journal_id uuid;
      target_capability_id uuid;
      target_leg_id uuid;
      target_transaction_id uuid;
      target_book_id uuid;
      target_actor_account_id uuid;
      target_reason_code text;
      target_effective_at timestamptz;
      target_observed_at timestamptz;
      target_recorded_at timestamptz;
      target_compensates_journal_id uuid;
      target_adjusts_journal_id uuid;
      line_count bigint;
      distinct_account_count bigint;
      minimum_line_number integer;
      maximum_line_number integer;
    BEGIN
      SELECT journal.economic_event_type,
             journal.posting_plan_id,
             journal.reversal_approval_id,
             journal.reverses_journal_id,
             journal.capability_id,
             journal.leg_id,
             journal.transaction_id,
             journal.book_id,
             journal.actor_account_id,
             journal.reason_code,
             journal.effective_at,
             journal.observed_at,
             journal.recorded_at,
             journal.compensates_journal_id,
             journal.adjusts_journal_id
      INTO target_event_type,
           target_posting_plan_id,
           target_reversal_approval_id,
           target_reverses_journal_id,
           target_capability_id,
           target_leg_id,
           target_transaction_id,
           target_book_id,
           target_actor_account_id,
           target_reason_code,
           target_effective_at,
           target_observed_at,
           target_recorded_at,
           target_compensates_journal_id,
           target_adjusts_journal_id
      FROM ledger_journals AS journal
      WHERE journal.journal_id = target_journal_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger journal integrity target is missing'
          USING ERRCODE = '23514';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM ledger_command_capabilities AS capability
        INNER JOIN ledger_command_capability_resolutions AS resolution
          ON resolution.capability_id = capability.capability_id
         AND resolution.outcome = 'CONSUMED'
         AND resolution.journal_id = target_journal_id
         AND resolution.resolved_at >= capability.issued_at
         AND resolution.resolved_at < capability.expires_at
        WHERE capability.capability_id = target_capability_id
          AND capability.leg_id = target_leg_id
          AND capability.transaction_id = target_transaction_id
          AND capability.book_id = target_book_id
          AND capability.tenant_account_id = target_actor_account_id
          AND (
            (
              target_event_type <> 'REVERSAL'
              AND capability.capability_purpose = 'POST'
              AND capability.posting_plan_id = target_posting_plan_id
            ) OR (
              target_event_type = 'REVERSAL'
              AND capability.capability_purpose = 'REVERSE'
              AND capability.reversal_approval_id = target_reversal_approval_id
              AND capability.original_journal_id = target_reverses_journal_id
            )
          )
      ) THEN
        RAISE EXCEPTION 'ledger journal lacks exact capability consumption proof'
          USING ERRCODE = '23514';
      END IF;

      SELECT count(*),
             count(DISTINCT line.ledger_account_id),
             min(line.line_number),
             max(line.line_number)
      INTO line_count, distinct_account_count, minimum_line_number, maximum_line_number
      FROM ledger_journal_lines AS line
      WHERE line.journal_id = target_journal_id;
      IF line_count < 2
        OR line_count > 64
        OR distinct_account_count < 2
        OR minimum_line_number <> 1
        OR maximum_line_number <> line_count
      THEN
        RAISE EXCEPTION 'ledger journal requires contiguous lines across two accounts'
          USING ERRCODE = '23514';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM ledger_journal_lines AS line
        WHERE line.journal_id = target_journal_id
        GROUP BY line.asset_revision_id
        HAVING sum(CASE WHEN line.side = 'DEBIT' THEN line.amount_atomic ELSE 0 END)
          <> sum(CASE WHEN line.side = 'CREDIT' THEN line.amount_atomic ELSE 0 END)
      ) THEN
        RAISE EXCEPTION 'ledger journal is not balanced by asset' USING ERRCODE = '23514';
      END IF;

      IF target_event_type <> 'REVERSAL' THEN
        IF NOT EXISTS (
          SELECT 1
          FROM ledger_leg_posting_plans AS plan
          INNER JOIN ledger_legs AS leg
            ON leg.leg_id = plan.leg_id
           AND leg.transaction_id = plan.transaction_id
           AND leg.book_id = plan.book_id
           AND leg.tenant_account_id = plan.tenant_account_id
          WHERE plan.posting_plan_id = target_posting_plan_id
            AND plan.leg_id = target_leg_id
            AND plan.transaction_id = target_transaction_id
            AND plan.book_id = target_book_id
            AND plan.tenant_account_id = target_actor_account_id
            AND plan.economic_event_type = target_event_type
            AND plan.reason_code = target_reason_code
            AND leg.compensates_journal_id IS NOT DISTINCT FROM
              target_compensates_journal_id
            AND leg.adjusts_journal_id IS NOT DISTINCT FROM target_adjusts_journal_id
            AND (
              (leg.leg_kind = 'FEE_PAYMENT' AND target_event_type = 'ACTUAL_FEE') OR
              (leg.leg_kind = 'ADJUSTMENT' AND target_event_type = 'ADJUSTMENT') OR
              (leg.leg_kind = 'COMPENSATION' AND target_event_type = 'COMPENSATION') OR
              (
                leg.leg_kind IN (
                  'SOURCE_TRANSFER', 'SWAP_INPUT', 'SWAP_OUTPUT',
                  'BRIDGE_DEPOSIT', 'BRIDGE_RELEASE'
                )
                AND target_event_type = 'SETTLEMENT'
              )
            )
        ) THEN
          RAISE EXCEPTION 'ledger journal does not match its economic plan'
            USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            (
              SELECT plan_line.plan_line_number,
                     plan_line.ledger_account_id,
                     plan_line.asset_revision_id,
                     plan_line.side,
                     plan_line.amount_atomic
              FROM ledger_leg_posting_plan_lines AS plan_line
              WHERE plan_line.posting_plan_id = target_posting_plan_id
              EXCEPT ALL
              SELECT line.line_number,
                     line.ledger_account_id,
                     line.asset_revision_id,
                     line.side,
                     line.amount_atomic
              FROM ledger_journal_lines AS line
              WHERE line.journal_id = target_journal_id
            )
            UNION ALL
            (
              SELECT line.line_number,
                     line.ledger_account_id,
                     line.asset_revision_id,
                     line.side,
                     line.amount_atomic
              FROM ledger_journal_lines AS line
              WHERE line.journal_id = target_journal_id
              EXCEPT ALL
              SELECT plan_line.plan_line_number,
                     plan_line.ledger_account_id,
                     plan_line.asset_revision_id,
                     plan_line.side,
                     plan_line.amount_atomic
              FROM ledger_leg_posting_plan_lines AS plan_line
              WHERE plan_line.posting_plan_id = target_posting_plan_id
            )
          ) AS line_mismatch
        ) THEN
          RAISE EXCEPTION 'ledger journal does not exactly match its posting plan'
            USING ERRCODE = '23514';
        END IF;

        IF (
          SELECT count(*)
          FROM ledger_journal_external_reference_usages AS usage
          INNER JOIN ledger_external_evidence AS occurrence
            ON occurrence.external_evidence_id = usage.external_evidence_id
          INNER JOIN ledger_leg_recognition_evidence AS evidence
            ON evidence.posting_plan_id = usage.posting_plan_id
          WHERE usage.journal_id = target_journal_id
            AND usage.posting_plan_id = target_posting_plan_id
            AND usage.reference_usage = 'PRIMARY_RECOGNITION'
            AND usage.reference_role = CASE target_event_type
              WHEN 'SETTLEMENT' THEN 'SETTLEMENT'
              WHEN 'ACTUAL_FEE' THEN 'FEE'
              WHEN 'COMPENSATION' THEN 'COMPENSATION'
              ELSE 'ADJUSTMENT'
            END
            AND usage.policy_reference_id = evidence.recognition_policy_reference_id
            AND usage.evidence_revision_reference_id =
              evidence.recognition_evidence_revision_reference_id
            AND occurrence.reference_type = evidence.reference_type
            AND occurrence.environment = evidence.environment
            AND occurrence.namespace_type = evidence.namespace_type
            AND occurrence.source_reference_id = evidence.source_reference_id
            AND occurrence.canonical_locator_reference_id =
              evidence.canonical_locator_reference_id
            AND occurrence.external_locator_digest = evidence.external_locator_digest
            AND occurrence.observed_at = evidence.observed_at
            AND occurrence.observed_at <= target_recorded_at
            AND (
              (
                target_event_type NOT IN ('COMPENSATION', 'ADJUSTMENT')
                AND usage.related_external_reference_usage_id IS NULL
              ) OR (
                target_event_type = 'COMPENSATION'
                AND EXISTS (
                  SELECT 1
                  FROM ledger_journal_external_reference_usages AS related
                  WHERE related.external_reference_usage_id =
                    usage.related_external_reference_usage_id
                    AND related.journal_id = target_compensates_journal_id
                    AND related.reference_usage = 'PRIMARY_RECOGNITION'
                )
              ) OR (
                target_event_type = 'ADJUSTMENT'
                AND EXISTS (
                  SELECT 1
                  FROM ledger_journal_external_reference_usages AS related
                  WHERE related.external_reference_usage_id =
                    usage.related_external_reference_usage_id
                    AND related.journal_id = target_adjusts_journal_id
                    AND related.reference_usage = 'PRIMARY_RECOGNITION'
                )
              )
            )
        ) <> 1 THEN
          RAISE EXCEPTION 'ledger journal recognition evidence is incomplete'
            USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM ledger_leg_fee_plans AS fee
          WHERE fee.posting_plan_id = target_posting_plan_id
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_journal_external_reference_usages AS usage
              INNER JOIN ledger_external_evidence AS occurrence
                ON occurrence.external_evidence_id = usage.external_evidence_id
              WHERE usage.journal_id = target_journal_id
                AND usage.reference_role = 'FEE'
                AND (
                  usage.reference_usage = 'FEE_EVIDENCE'
                  OR (
                    target_event_type = 'ACTUAL_FEE'
                    AND usage.reference_usage = 'PRIMARY_RECOGNITION'
                  )
                )
                AND usage.policy_reference_id = fee.evidence_policy_reference_id
                AND usage.evidence_revision_reference_id =
                  fee.evidence_revision_reference_id
                AND occurrence.reference_type = fee.evidence_reference_type
                AND occurrence.environment = fee.evidence_environment
                AND occurrence.namespace_type = fee.evidence_namespace_type
                AND occurrence.source_reference_id = fee.evidence_source_reference_id
                AND occurrence.canonical_locator_reference_id =
                  fee.canonical_locator_reference_id
                AND occurrence.external_locator_digest = fee.external_locator_digest
                AND occurrence.observed_at = fee.evidence_observed_at
                AND occurrence.observed_at <= target_recorded_at
            )
        ) OR EXISTS (
          SELECT 1
          FROM ledger_journal_external_reference_usages AS usage
          INNER JOIN ledger_external_evidence AS occurrence
            ON occurrence.external_evidence_id = usage.external_evidence_id
          WHERE usage.journal_id = target_journal_id
            AND usage.reference_usage = 'FEE_EVIDENCE'
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_leg_fee_plans AS fee
              WHERE fee.posting_plan_id = target_posting_plan_id
                AND usage.policy_reference_id = fee.evidence_policy_reference_id
                AND usage.evidence_revision_reference_id =
                  fee.evidence_revision_reference_id
                AND occurrence.reference_type = fee.evidence_reference_type
                AND occurrence.environment = fee.evidence_environment
                AND occurrence.namespace_type = fee.evidence_namespace_type
                AND occurrence.source_reference_id = fee.evidence_source_reference_id
                AND occurrence.canonical_locator_reference_id =
                  fee.canonical_locator_reference_id
                AND occurrence.external_locator_digest = fee.external_locator_digest
                AND occurrence.observed_at = fee.evidence_observed_at
            )
        ) THEN
          RAISE EXCEPTION 'ledger journal fee evidence set is incomplete'
            USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM ledger_external_evidence_claims AS claim
          WHERE claim.journal_id = target_journal_id
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_journal_external_reference_usages AS usage
              WHERE usage.journal_id = claim.journal_id
                AND usage.external_evidence_id = claim.external_evidence_id
            )
        ) THEN
          RAISE EXCEPTION 'ledger journal contains an unused evidence claim'
            USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            (
               SELECT valuation.valuation_plan_line_number,
                      valuation.valuation_role,
                      valuation.fee_plan_line_number,
                      valuation.asset_revision_id,
                     valuation.availability,
                     valuation.valued_amount_atomic,
                     valuation.usd_rate_mantissa,
                     valuation.usd_rate_scale,
                     valuation.usd_value_mantissa,
                     valuation.rounding_mode,
                     valuation.source_reference_id,
                     valuation.source_policy_reference_id,
                     valuation.evidence_reference_id,
                     valuation.priced_at,
                     valuation.observed_at,
                     valuation.freshness_class,
                     valuation.confidence_class,
                     valuation.depeg_class
              FROM ledger_leg_valuation_plans AS valuation
              WHERE valuation.posting_plan_id = target_posting_plan_id
              EXCEPT ALL
               SELECT snapshot.valuation_plan_line_number,
                      snapshot.valuation_role,
                      snapshot.fee_plan_line_number,
                      snapshot.asset_revision_id,
                     snapshot.availability,
                     snapshot.valued_amount_atomic,
                     snapshot.usd_rate_mantissa,
                     snapshot.usd_rate_scale,
                     snapshot.usd_value_mantissa,
                     snapshot.rounding_mode,
                     snapshot.source_reference_id,
                     snapshot.source_policy_reference_id,
                     snapshot.evidence_reference_id,
                     snapshot.priced_at,
                     snapshot.observed_at,
                     snapshot.freshness_class,
                     snapshot.confidence_class,
                     snapshot.depeg_class
              FROM ledger_valuation_snapshots AS snapshot
              WHERE snapshot.journal_id = target_journal_id
                AND snapshot.purpose = CASE WHEN target_event_type = 'ADJUSTMENT'
                  THEN 'ADJUSTMENT' ELSE 'SETTLEMENT' END
            )
            UNION ALL
            (
               SELECT snapshot.valuation_plan_line_number,
                      snapshot.valuation_role,
                      snapshot.fee_plan_line_number,
                      snapshot.asset_revision_id,
                     snapshot.availability,
                     snapshot.valued_amount_atomic,
                     snapshot.usd_rate_mantissa,
                     snapshot.usd_rate_scale,
                     snapshot.usd_value_mantissa,
                     snapshot.rounding_mode,
                     snapshot.source_reference_id,
                     snapshot.source_policy_reference_id,
                     snapshot.evidence_reference_id,
                     snapshot.priced_at,
                     snapshot.observed_at,
                     snapshot.freshness_class,
                     snapshot.confidence_class,
                     snapshot.depeg_class
              FROM ledger_valuation_snapshots AS snapshot
              WHERE snapshot.journal_id = target_journal_id
                AND snapshot.purpose = CASE WHEN target_event_type = 'ADJUSTMENT'
                  THEN 'ADJUSTMENT' ELSE 'SETTLEMENT' END
              EXCEPT ALL
               SELECT valuation.valuation_plan_line_number,
                      valuation.valuation_role,
                      valuation.fee_plan_line_number,
                      valuation.asset_revision_id,
                     valuation.availability,
                     valuation.valued_amount_atomic,
                     valuation.usd_rate_mantissa,
                     valuation.usd_rate_scale,
                     valuation.usd_value_mantissa,
                     valuation.rounding_mode,
                     valuation.source_reference_id,
                     valuation.source_policy_reference_id,
                     valuation.evidence_reference_id,
                     valuation.priced_at,
                     valuation.observed_at,
                     valuation.freshness_class,
                     valuation.confidence_class,
                     valuation.depeg_class
              FROM ledger_leg_valuation_plans AS valuation
              WHERE valuation.posting_plan_id = target_posting_plan_id
            )
          ) AS valuation_mismatch
        ) THEN
          RAISE EXCEPTION 'ledger journal valuation set is incomplete'
            USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            (
              SELECT fee.fee_plan_line_number,
                     fee.category,
                     fee.asset_revision_id,
                     fee.amount_atomic,
                     fee.payer_account_id,
                     fee.recipient_account_id,
                     fee.payer_line_number,
                     fee.recipient_line_number,
                     fee.deduction_mode,
                     fee.fee_rule_reference_id,
                     fee.quote_reference_id
              FROM ledger_leg_fee_plans AS fee
              WHERE fee.posting_plan_id = target_posting_plan_id
              EXCEPT ALL
              SELECT component.fee_plan_line_number,
                     component.category,
                     component.asset_revision_id,
                     component.amount_atomic,
                     component.payer_account_id,
                     component.recipient_account_id,
                     component.payer_line_number,
                     component.recipient_line_number,
                     component.deduction_mode,
                     component.fee_rule_reference_id,
                     component.quote_reference_id
              FROM ledger_fee_components AS component
              WHERE component.journal_id = target_journal_id
                AND component.stage = 'ACTUAL'
            )
            UNION ALL
            (
              SELECT component.fee_plan_line_number,
                     component.category,
                     component.asset_revision_id,
                     component.amount_atomic,
                     component.payer_account_id,
                     component.recipient_account_id,
                     component.payer_line_number,
                     component.recipient_line_number,
                     component.deduction_mode,
                     component.fee_rule_reference_id,
                     component.quote_reference_id
              FROM ledger_fee_components AS component
              WHERE component.journal_id = target_journal_id
              EXCEPT ALL
              SELECT fee.fee_plan_line_number,
                     fee.category,
                     fee.asset_revision_id,
                     fee.amount_atomic,
                     fee.payer_account_id,
                     fee.recipient_account_id,
                     fee.payer_line_number,
                     fee.recipient_line_number,
                     fee.deduction_mode,
                     fee.fee_rule_reference_id,
                     fee.quote_reference_id
              FROM ledger_leg_fee_plans AS fee
              WHERE fee.posting_plan_id = target_posting_plan_id
            )
          ) AS fee_mismatch
        ) THEN
          RAISE EXCEPTION 'ledger journal fee metadata does not match its sealed plan'
            USING ERRCODE = '23514';
        END IF;
      ELSE
        IF NOT EXISTS (
          SELECT 1
          FROM ledger_reversal_approvals AS approval
          INNER JOIN ledger_journals AS original
            ON original.journal_id = approval.original_journal_id
           AND original.economic_event_type <> 'REVERSAL'
          WHERE approval.reversal_approval_id = target_reversal_approval_id
            AND approval.original_journal_id = target_reverses_journal_id
            AND approval.leg_id = target_leg_id
            AND approval.transaction_id = target_transaction_id
            AND approval.book_id = target_book_id
            AND approval.tenant_account_id = target_actor_account_id
            AND approval.reason_code = target_reason_code
            AND approval.effective_at = target_effective_at
            AND approval.observed_at = target_observed_at
        ) THEN
          RAISE EXCEPTION 'ledger reversal does not match its approval'
            USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            (
              SELECT original.line_number,
                     original.ledger_account_id,
                     original.asset_revision_id,
                     CASE original.side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
                     original.amount_atomic
              FROM ledger_journal_lines AS original
              WHERE original.journal_id = target_reverses_journal_id
              EXCEPT ALL
              SELECT reversal.line_number,
                     reversal.ledger_account_id,
                     reversal.asset_revision_id,
                     reversal.side,
                     reversal.amount_atomic
              FROM ledger_journal_lines AS reversal
              WHERE reversal.journal_id = target_journal_id
            )
            UNION ALL
            (
              SELECT reversal.line_number,
                     reversal.ledger_account_id,
                     reversal.asset_revision_id,
                     reversal.side,
                     reversal.amount_atomic
              FROM ledger_journal_lines AS reversal
              WHERE reversal.journal_id = target_journal_id
              EXCEPT ALL
              SELECT original.line_number,
                     original.ledger_account_id,
                     original.asset_revision_id,
                     CASE original.side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
                     original.amount_atomic
              FROM ledger_journal_lines AS original
              WHERE original.journal_id = target_reverses_journal_id
            )
          ) AS reversal_line_mismatch
        ) THEN
          RAISE EXCEPTION 'ledger reversal does not exactly negate its original'
            USING ERRCODE = '23514';
        END IF;

        IF (
          SELECT count(*)
          FROM ledger_journal_external_reference_usages AS original
          WHERE original.journal_id = target_reverses_journal_id
        ) <> (
          SELECT count(*)
          FROM ledger_journal_external_reference_usages AS reversal
          WHERE reversal.journal_id = target_journal_id
        ) OR EXISTS (
          SELECT 1
          FROM ledger_journal_external_reference_usages AS original
          WHERE original.journal_id = target_reverses_journal_id
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_journal_external_reference_usages AS reversal
              INNER JOIN ledger_external_evidence AS occurrence
                ON occurrence.external_evidence_id = reversal.external_evidence_id
              INNER JOIN ledger_reversal_approvals AS approval
                ON approval.reversal_approval_id = target_reversal_approval_id
              WHERE reversal.journal_id = target_journal_id
                AND reversal.related_external_reference_usage_id =
                  original.external_reference_usage_id
                AND reversal.reference_usage = original.reference_usage
                AND reversal.reference_role = CASE original.reference_usage
                  WHEN 'PRIMARY_RECOGNITION' THEN 'REVERSAL'
                  ELSE 'FEE'
                END
                AND reversal.relation_type = 'REVERSAL_OF'
                AND reversal.policy_reference_id = approval.approval_reference_id
                AND reversal.evidence_revision_reference_id = approval.evidence_reference_id
                AND occurrence.reference_type = approval.reference_type
                AND occurrence.environment = approval.environment
                AND occurrence.namespace_type = approval.namespace_type
                AND occurrence.source_reference_id = approval.source_reference_id
                AND occurrence.canonical_locator_reference_id =
                  approval.canonical_locator_reference_id
                AND occurrence.external_locator_digest = approval.external_locator_digest
                AND occurrence.observed_at = approval.observed_at
                AND occurrence.observed_at <= target_recorded_at
            )
        ) OR EXISTS (
          SELECT 1
          FROM ledger_external_evidence_claims AS claim
          WHERE claim.journal_id = target_journal_id
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_journal_external_reference_usages AS usage
              WHERE usage.journal_id = claim.journal_id
                AND usage.external_evidence_id = claim.external_evidence_id
            )
        ) THEN
          RAISE EXCEPTION 'ledger reversal evidence set is incomplete'
            USING ERRCODE = '23514';
        END IF;

        IF (
          SELECT count(*)
          FROM ledger_valuation_snapshots AS original
          WHERE original.journal_id = target_reverses_journal_id
            AND original.purpose IN ('SETTLEMENT', 'ADJUSTMENT')
        ) <> (
          SELECT count(*)
          FROM ledger_valuation_snapshots AS reversal
          WHERE reversal.journal_id = target_journal_id
        ) OR EXISTS (
          SELECT 1
          FROM ledger_valuation_snapshots AS original
          WHERE original.journal_id = target_reverses_journal_id
            AND original.purpose IN ('SETTLEMENT', 'ADJUSTMENT')
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_valuation_snapshots AS reversal
              WHERE reversal.journal_id = target_journal_id
                AND reversal.purpose = 'REVERSAL'
                AND reversal.reverses_valuation_snapshot_id =
                  original.valuation_snapshot_id
                AND reversal.valuation_plan_line_number =
                  original.valuation_plan_line_number
                AND reversal.valuation_role = original.valuation_role
                AND reversal.fee_plan_line_number IS NOT DISTINCT FROM
                  original.fee_plan_line_number
                AND reversal.asset_revision_id = original.asset_revision_id
                AND reversal.valued_amount_atomic = original.valued_amount_atomic
                AND reversal.availability = original.availability
                AND reversal.usd_rate_mantissa IS NOT DISTINCT FROM
                  original.usd_rate_mantissa
                AND reversal.usd_rate_scale IS NOT DISTINCT FROM original.usd_rate_scale
                AND reversal.usd_value_mantissa IS NOT DISTINCT FROM
                  original.usd_value_mantissa
                AND reversal.rounding_mode = original.rounding_mode
                AND reversal.source_reference_id = original.source_reference_id
                AND reversal.source_policy_reference_id =
                  original.source_policy_reference_id
                AND reversal.evidence_reference_id = original.evidence_reference_id
                AND reversal.priced_at IS NOT DISTINCT FROM original.priced_at
                AND reversal.observed_at = original.observed_at
                AND reversal.freshness_class = original.freshness_class
                AND reversal.confidence_class = original.confidence_class
                AND reversal.depeg_class = original.depeg_class
            )
        ) THEN
          RAISE EXCEPTION 'ledger reversal valuation set is incomplete'
            USING ERRCODE = '23514';
        END IF;

        IF (
          SELECT count(*)
          FROM ledger_fee_components AS original
          WHERE original.journal_id = target_reverses_journal_id
        ) <> (
          SELECT count(*)
          FROM ledger_fee_components AS reversal
          WHERE reversal.journal_id = target_journal_id
        ) OR EXISTS (
          SELECT 1
          FROM ledger_fee_components AS original
          WHERE original.journal_id = target_reverses_journal_id
            AND NOT EXISTS (
              SELECT 1
              FROM ledger_fee_components AS reversal
              WHERE reversal.journal_id = target_journal_id
                AND reversal.stage = original.stage
                AND reversal.reverses_fee_component_id = original.fee_component_id
                AND reversal.fee_estimate_snapshot_id IS NOT DISTINCT FROM
                  original.fee_estimate_snapshot_id
                AND reversal.adjusts_fee_component_id IS NOT DISTINCT FROM
                  original.adjusts_fee_component_id
                AND reversal.fee_plan_line_number IS NOT DISTINCT FROM
                  original.fee_plan_line_number
                AND reversal.category = original.category
                AND reversal.asset_revision_id = original.asset_revision_id
                AND reversal.amount_atomic = original.amount_atomic
                AND reversal.payer_account_id = original.recipient_account_id
                AND reversal.recipient_account_id = original.payer_account_id
                AND reversal.payer_line_number = original.recipient_line_number
                AND reversal.recipient_line_number = original.payer_line_number
                AND reversal.deduction_mode = original.deduction_mode
                AND reversal.fee_rule_reference_id = original.fee_rule_reference_id
                AND reversal.quote_reference_id IS NOT DISTINCT FROM
                  original.quote_reference_id
                AND EXISTS (
                  SELECT 1
                  FROM ledger_journal_external_reference_usages AS source_usage
                  WHERE source_usage.external_reference_usage_id =
                    reversal.source_external_reference_id
                    AND source_usage.related_external_reference_usage_id =
                      original.source_external_reference_id
                )
            )
        ) THEN
          RAISE EXCEPTION 'ledger reversal fee set is incomplete'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END;
    $$;

    CREATE OR REPLACE FUNCTION validate_ledger_journal_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      target_journal_id uuid := CASE
        WHEN TG_OP = 'DELETE' THEN OLD.journal_id
        ELSE NEW.journal_id
      END;
    BEGIN
      PERFORM assert_ledger_journal_integrity(target_journal_id);
      RETURN NULL;
    END;
    $$;

    CREATE OR REPLACE FUNCTION validate_ledger_metadata_integrity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      asset_decimals smallint;
      numerator numeric;
      denominator numeric;
      quotient numeric;
      remainder numeric;
      expected_usd_value numeric;
    BEGIN
      IF NEW.journal_id IS NOT NULL THEN
        PERFORM 1
        FROM ledger_journals AS journal
        WHERE journal.journal_id = NEW.journal_id
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ledger metadata journal is missing' USING ERRCODE = '23503';
        END IF;
        IF TG_TABLE_NAME <> 'ledger_valuation_snapshots' THEN
          IF EXISTS (
            SELECT 1
            FROM ledger_reversal_approvals AS approval
            WHERE approval.original_journal_id = NEW.journal_id
          ) OR EXISTS (
            SELECT 1
            FROM ledger_journals AS reversal
            WHERE reversal.reverses_journal_id = NEW.journal_id
          ) THEN
            RAISE EXCEPTION 'metadata cannot be appended after reversal approval'
              USING ERRCODE = '55000';
          END IF;
        ELSIF NEW.purpose <> 'BACKFILL' THEN
          IF EXISTS (
            SELECT 1
            FROM ledger_reversal_approvals AS approval
            WHERE approval.original_journal_id = NEW.journal_id
          ) OR EXISTS (
            SELECT 1
            FROM ledger_journals AS reversal
            WHERE reversal.reverses_journal_id = NEW.journal_id
          ) THEN
            RAISE EXCEPTION 'metadata cannot be appended after reversal approval'
              USING ERRCODE = '55000';
          END IF;
        END IF;
      END IF;

      IF TG_TABLE_NAME = 'ledger_valuation_snapshots' THEN
        IF NEW.availability = 'AVAILABLE' THEN
          SELECT asset.base_unit_decimals
          INTO asset_decimals
          FROM ledger_assets AS asset
          WHERE asset.asset_revision_id = NEW.asset_revision_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'ledger valuation asset is missing' USING ERRCODE = '23503';
          END IF;
          numerator := NEW.valued_amount_atomic
            * NEW.usd_rate_mantissa
            * power(10::numeric, 18::numeric);
          denominator := power(
            10::numeric,
            (asset_decimals::integer + NEW.usd_rate_scale::integer)::numeric
          );
          quotient := trunc(numerator / denominator);
          remainder := mod(numerator, denominator);
          expected_usd_value := CASE
            WHEN remainder * 2 < denominator THEN quotient
            WHEN remainder * 2 > denominator THEN quotient + 1
            WHEN mod(quotient, 2) = 0 THEN quotient
            ELSE quotient + 1
          END;
          IF NEW.usd_value_mantissa IS DISTINCT FROM expected_usd_value THEN
            RAISE EXCEPTION 'ledger valuation does not match the half-even formula'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        IF NEW.purpose = 'REVERSAL' AND NOT EXISTS (
          SELECT 1
          FROM ledger_valuation_snapshots AS original
          INNER JOIN ledger_journals AS reversal_journal
            ON reversal_journal.journal_id = NEW.journal_id
           AND reversal_journal.reverses_journal_id = original.journal_id
          WHERE original.valuation_snapshot_id = NEW.reverses_valuation_snapshot_id
            AND original.purpose IN ('SETTLEMENT', 'ADJUSTMENT')
            AND original.valuation_plan_line_number = NEW.valuation_plan_line_number
            AND original.valuation_role = NEW.valuation_role
            AND original.fee_plan_line_number IS NOT DISTINCT FROM
              NEW.fee_plan_line_number
            AND original.asset_revision_id = NEW.asset_revision_id
            AND original.valued_amount_atomic = NEW.valued_amount_atomic
            AND original.availability = NEW.availability
            AND original.usd_rate_mantissa IS NOT DISTINCT FROM NEW.usd_rate_mantissa
            AND original.usd_rate_scale IS NOT DISTINCT FROM NEW.usd_rate_scale
            AND original.usd_value_mantissa IS NOT DISTINCT FROM NEW.usd_value_mantissa
            AND original.rounding_mode = NEW.rounding_mode
            AND original.source_reference_id = NEW.source_reference_id
            AND original.source_policy_reference_id = NEW.source_policy_reference_id
            AND original.evidence_reference_id = NEW.evidence_reference_id
            AND original.priced_at IS NOT DISTINCT FROM NEW.priced_at
            AND original.observed_at = NEW.observed_at
            AND original.freshness_class = NEW.freshness_class
            AND original.confidence_class = NEW.confidence_class
            AND original.depeg_class = NEW.depeg_class
        ) THEN
          RAISE EXCEPTION 'ledger reversal valuation does not match its original'
            USING ERRCODE = '23514';
        END IF;

        IF NEW.purpose = 'BACKFILL' AND NOT EXISTS (
          SELECT 1
          FROM ledger_valuation_snapshots AS original
          WHERE original.valuation_snapshot_id = NEW.backfills_valuation_snapshot_id
            AND original.valuation_snapshot_id <> NEW.valuation_snapshot_id
            AND original.journal_id = NEW.journal_id
            AND original.purpose IN ('SETTLEMENT', 'ADJUSTMENT')
            AND original.availability = 'UNAVAILABLE'
            AND NEW.availability = 'AVAILABLE'
            AND original.valuation_plan_line_number = NEW.valuation_plan_line_number
            AND original.valuation_role = NEW.valuation_role
            AND original.fee_plan_line_number IS NOT DISTINCT FROM
              NEW.fee_plan_line_number
            AND original.leg_id = NEW.leg_id
            AND original.transaction_id = NEW.transaction_id
            AND original.book_id = NEW.book_id
            AND original.tenant_account_id = NEW.tenant_account_id
            AND original.asset_revision_id = NEW.asset_revision_id
            AND original.valued_amount_atomic = NEW.valued_amount_atomic
        ) THEN
          RAISE EXCEPTION 'ledger valuation backfill does not match an unavailable base snapshot'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.purpose = 'QUOTE' AND (
          SELECT count(*)
          FROM ledger_fee_estimate_snapshots AS estimate
          WHERE estimate.valuation_snapshot_id = NEW.valuation_snapshot_id
        ) <> 1 THEN
          RAISE EXCEPTION 'ledger quote valuation requires one fee estimate snapshot'
            USING ERRCODE = '23514';
        END IF;
      ELSIF TG_TABLE_NAME = 'ledger_fee_components' THEN
        IF NOT EXISTS (
          SELECT 1
          FROM ledger_journals AS journal
          INNER JOIN ledger_journal_lines AS payer_line
            ON payer_line.journal_id = journal.journal_id
           AND payer_line.line_number = NEW.payer_line_number
          INNER JOIN ledger_journal_lines AS recipient_line
            ON recipient_line.journal_id = journal.journal_id
           AND recipient_line.line_number = NEW.recipient_line_number
          INNER JOIN ledger_valuation_snapshots AS valuation
            ON valuation.valuation_snapshot_id = NEW.valuation_snapshot_id
           AND valuation.journal_id = NEW.journal_id
          INNER JOIN ledger_journal_external_reference_usages AS source_usage
            ON source_usage.external_reference_usage_id =
              NEW.source_external_reference_id
           AND source_usage.journal_id = NEW.journal_id
          WHERE journal.journal_id = NEW.journal_id
            AND journal.leg_id = NEW.leg_id
            AND journal.transaction_id = NEW.transaction_id
            AND journal.book_id = NEW.book_id
            AND journal.actor_account_id = NEW.tenant_account_id
            AND (
              (
                NEW.reverses_fee_component_id IS NULL
                AND (
                  (NEW.stage = 'ACTUAL' AND journal.economic_event_type IN (
                    'SETTLEMENT', 'ACTUAL_FEE', 'COMPENSATION'
                  ))
                  OR (
                    NEW.stage = 'ADJUSTMENT'
                    AND journal.economic_event_type = 'ADJUSTMENT'
                  )
                )
                AND source_usage.reference_role = 'FEE'
              ) OR (
                NEW.reverses_fee_component_id IS NOT NULL
                AND journal.economic_event_type = 'REVERSAL'
                AND EXISTS (
                  SELECT 1
                  FROM ledger_fee_components AS original
                  WHERE original.fee_component_id = NEW.reverses_fee_component_id
                    AND source_usage.related_external_reference_usage_id =
                      original.source_external_reference_id
                )
              )
            )
            AND payer_line.ledger_account_id = NEW.payer_account_id
            AND payer_line.asset_revision_id = NEW.asset_revision_id
            AND payer_line.side = 'CREDIT'
            AND payer_line.amount_atomic >= NEW.amount_atomic
            AND recipient_line.ledger_account_id = NEW.recipient_account_id
            AND recipient_line.asset_revision_id = NEW.asset_revision_id
            AND recipient_line.side = 'DEBIT'
            AND recipient_line.amount_atomic = NEW.amount_atomic
            AND valuation.valuation_role = 'FEE_COMPONENT'
            AND valuation.fee_plan_line_number = NEW.fee_plan_line_number
            AND valuation.asset_revision_id = NEW.asset_revision_id
            AND valuation.valued_amount_atomic = NEW.amount_atomic
        ) THEN
          RAISE EXCEPTION 'ledger fee does not match its lines, valuation, and evidence'
            USING ERRCODE = '23514';
        END IF;

        IF NEW.reverses_fee_component_id IS NULL AND EXISTS (
          SELECT 1
          FROM ledger_fee_components AS other
          WHERE other.journal_id = NEW.journal_id
            AND other.fee_component_id <> NEW.fee_component_id
            AND (
              NEW.payer_line_number = other.recipient_line_number
              OR NEW.recipient_line_number IN (
                other.payer_line_number, other.recipient_line_number
              )
            )
        ) THEN
          RAISE EXCEPTION 'ledger fee journal lines are already assigned'
            USING ERRCODE = '23505';
        END IF;

        IF (
          SELECT sum(component.amount_atomic)
          FROM ledger_fee_components AS component
          WHERE component.journal_id = NEW.journal_id
            AND component.payer_line_number = NEW.payer_line_number
        ) > (
          SELECT line.amount_atomic
          FROM ledger_journal_lines AS line
          WHERE line.journal_id = NEW.journal_id
            AND line.line_number = NEW.payer_line_number
        ) THEN
          RAISE EXCEPTION 'ledger fee allocations exceed their gross payer line'
            USING ERRCODE = '23514';
        END IF;

        IF NEW.stage = 'ADJUSTMENT'
          AND NEW.reverses_fee_component_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM ledger_fee_components AS original
            INNER JOIN ledger_journals AS original_journal
              ON original_journal.journal_id = original.journal_id
             AND original_journal.economic_event_type <> 'REVERSAL'
            INNER JOIN ledger_journals AS adjustment_journal
              ON adjustment_journal.journal_id = NEW.journal_id
            INNER JOIN ledger_legs AS adjustment_leg
              ON adjustment_leg.leg_id = adjustment_journal.leg_id
             AND adjustment_leg.adjusts_journal_id = original.journal_id
            WHERE original.fee_component_id = NEW.adjusts_fee_component_id
              AND original.stage IN ('ACTUAL', 'ADJUSTMENT')
              AND original.reverses_fee_component_id IS NULL
              AND original.tenant_account_id = NEW.tenant_account_id
              AND original.book_id = NEW.book_id
              AND original.category = NEW.category
              AND original.asset_revision_id = NEW.asset_revision_id
              AND NOT EXISTS (
                SELECT 1
                FROM ledger_journals AS reversal
                WHERE reversal.reverses_journal_id = original.journal_id
              )
          )
        THEN
          RAISE EXCEPTION 'ledger fee adjustment does not match its original journal'
            USING ERRCODE = '23514';
        END IF;

        IF NEW.reverses_fee_component_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM ledger_fee_components AS original
          INNER JOIN ledger_journals AS reversal_journal
            ON reversal_journal.journal_id = NEW.journal_id
           AND reversal_journal.reverses_journal_id = original.journal_id
          INNER JOIN ledger_valuation_snapshots AS reversal_valuation
            ON reversal_valuation.valuation_snapshot_id = NEW.valuation_snapshot_id
           AND reversal_valuation.reverses_valuation_snapshot_id =
             original.valuation_snapshot_id
          INNER JOIN ledger_journal_external_reference_usages AS reversal_reference
            ON reversal_reference.external_reference_usage_id =
              NEW.source_external_reference_id
           AND reversal_reference.journal_id = NEW.journal_id
           AND reversal_reference.related_external_reference_usage_id =
              original.source_external_reference_id
          WHERE original.fee_component_id = NEW.reverses_fee_component_id
          AND original.stage IN ('ACTUAL', 'ADJUSTMENT')
            AND original.stage = NEW.stage
            AND original.fee_plan_line_number = NEW.fee_plan_line_number
            AND original.fee_estimate_snapshot_id IS NOT DISTINCT FROM
              NEW.fee_estimate_snapshot_id
            AND original.adjusts_fee_component_id IS NOT DISTINCT FROM
              NEW.adjusts_fee_component_id
            AND original.category = NEW.category
            AND original.asset_revision_id = NEW.asset_revision_id
            AND original.amount_atomic = NEW.amount_atomic
            AND original.payer_account_id = NEW.recipient_account_id
            AND original.recipient_account_id = NEW.payer_account_id
            AND original.payer_line_number = NEW.recipient_line_number
            AND original.recipient_line_number = NEW.payer_line_number
            AND original.deduction_mode = NEW.deduction_mode
            AND original.fee_rule_reference_id = NEW.fee_rule_reference_id
            AND original.quote_reference_id IS NOT DISTINCT FROM NEW.quote_reference_id
        ) THEN
          RAISE EXCEPTION 'ledger fee reversal does not match its original'
            USING ERRCODE = '23514';
        END IF;
      ELSIF TG_TABLE_NAME IN (
        'ledger_external_evidence_claims',
        'ledger_journal_external_reference_usages'
      ) THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'unsupported ledger metadata integrity target'
          USING ERRCODE = '55000';
      END IF;

      IF NEW.journal_id IS NOT NULL THEN
        PERFORM assert_ledger_journal_integrity(NEW.journal_id);
      END IF;
      RETURN NULL;
    END;
    $$;

    DO $qualify_ledger_function_references$
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
        'reject_ledger_mutation()',
        'reject_frozen_ledger_plan_change()',
        'validate_ledger_posting_plan_integrity()',
        'validate_ledger_reversal_approval_integrity()',
        'validate_ledger_capability_integrity()',
        'validate_ledger_capability_resolution_integrity()',
        'compute_ledger_posting_plan_digest(uuid)',
        'compute_ledger_reversal_approval_digest(uuid)',
        'validate_ledger_posting_plan_seal()',
        'validate_ledger_fee_estimate_integrity()',
        'assert_ledger_journal_integrity(uuid)',
        'validate_ledger_journal_integrity()',
        'validate_ledger_metadata_integrity()',
        'post_ledger_journal(text,uuid,uuid,uuid,text,timestamptz,timestamptz,text,uuid,text)',
        'reverse_ledger_journal(text,uuid,text,timestamptz,timestamptz,uuid)'
      ]
      LOOP
        SELECT pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure(
            pg_catalog.format('%I.%s', migration_schema, function_identity)
          )
        )
        INTO function_definition;
        function_body := pg_catalog.split_part(function_definition, '$function$', 2);

        FOREACH relation_name IN ARRAY ARRAY[${securedRelationNames}]
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
          'compute_ledger_posting_plan_digest',
          'compute_ledger_reversal_approval_digest',
          'assert_ledger_journal_integrity'
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
    $qualify_ledger_function_references$;

    DO $set_ledger_function_paths$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
    BEGIN
      FOREACH function_identity IN ARRAY ARRAY[
        'reject_ledger_mutation()',
        'reject_frozen_ledger_plan_change()',
        'validate_ledger_posting_plan_integrity()',
        'validate_ledger_reversal_approval_integrity()',
        'validate_ledger_capability_integrity()',
        'validate_ledger_capability_resolution_integrity()',
        'compute_ledger_posting_plan_digest(uuid)',
        'compute_ledger_reversal_approval_digest(uuid)',
        'validate_ledger_posting_plan_seal()',
        'validate_ledger_fee_estimate_integrity()',
        'assert_ledger_journal_integrity(uuid)',
        'validate_ledger_journal_integrity()',
        'validate_ledger_metadata_integrity()',
        'post_ledger_journal(text,uuid,uuid,uuid,text,timestamptz,timestamptz,text,uuid,text)',
        'reverse_ledger_journal(text,uuid,text,timestamptz,timestamptz,uuid)'
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
    $set_ledger_function_paths$;

    REVOKE ALL ON FUNCTION reject_ledger_mutation()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION reject_frozen_ledger_plan_change()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_posting_plan_integrity()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_reversal_approval_integrity()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_capability_integrity()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_capability_resolution_integrity()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION compute_ledger_posting_plan_digest(uuid)
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION compute_ledger_reversal_approval_digest(uuid)
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_posting_plan_seal()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_fee_estimate_integrity()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION assert_ledger_journal_integrity(uuid)
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_journal_integrity()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION validate_ledger_metadata_integrity()
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION post_ledger_journal(
      text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION reverse_ledger_journal(
      text, uuid, text, timestamptz, timestamptz, uuid
    ) FROM PUBLIC, ${api}, ${worker}, ${legacy};
    GRANT EXECUTE ON FUNCTION post_ledger_journal(
      text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
    ) TO ${api};
    GRANT EXECUTE ON FUNCTION reverse_ledger_journal(
      text, uuid, text, timestamptz, timestamptz, uuid
    ) TO ${api};
  `;
}

function createLedgerTriggersAndAclSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const tableList = LEDGER_TABLES.join(', ');
  const planChildTables = [
    'ledger_leg_posting_plan_lines',
    'ledger_leg_recognition_evidence',
    'ledger_leg_valuation_plans',
    'ledger_leg_fee_plans',
  ] as const;
  const planIntegrityTables = [
    'ledger_leg_posting_plans',
    ...planChildTables,
    'ledger_leg_posting_plan_seals',
  ] as const;
  const appendOnlyTriggerStem = (table: (typeof LEDGER_TABLES)[number]): string => {
    if (table === 'ledger_command_capability_resolutions') {
      return 'ledger_capability_resolutions';
    }
    if (table === 'ledger_journal_external_reference_usages') {
      return 'ledger_journal_ref_usages';
    }
    return table;
  };
  const appendOnlyTriggers = LEDGER_TABLES.map((table) => {
    const triggerStem = appendOnlyTriggerStem(table);
    return `
    CREATE TRIGGER ${triggerStem}_append_only_row_trigger
      BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ${triggerStem}_append_only_truncate_trigger
      BEFORE TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
    ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${triggerStem}_append_only_row_trigger;
    ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${triggerStem}_append_only_truncate_trigger;`;
  }).join('\n');
  const frozenPlanTriggers = planChildTables
    .map(
      (table) => `
    CREATE TRIGGER ${table}_freeze_trigger
      BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_frozen_ledger_plan_change();
    ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${table}_freeze_trigger;`,
    )
    .join('\n');
  const planIntegrityTriggers = planIntegrityTables
    .map(
      (table) => `
    CREATE CONSTRAINT TRIGGER ${table}_integrity_trigger
      AFTER INSERT ON ${table}
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_posting_plan_integrity();
    ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${table}_integrity_trigger;`,
    )
    .join('\n');

  return `
    ${appendOnlyTriggers}
    ${frozenPlanTriggers}
    ${planIntegrityTriggers}

    CREATE TRIGGER ledger_leg_posting_plan_seals_validation_trigger
      BEFORE INSERT ON ledger_leg_posting_plan_seals
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_posting_plan_seal();
    CREATE CONSTRAINT TRIGGER ledger_reversal_approvals_integrity_trigger
      AFTER INSERT ON ledger_reversal_approvals
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_reversal_approval_integrity();
    CREATE TRIGGER ledger_command_capabilities_validation_trigger
      BEFORE INSERT ON ledger_command_capabilities
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_capability_integrity();
    CREATE CONSTRAINT TRIGGER ledger_command_capability_resolutions_integrity_trigger
      AFTER INSERT ON ledger_command_capability_resolutions
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_capability_resolution_integrity();

    CREATE CONSTRAINT TRIGGER ledger_journals_integrity_trigger
      AFTER INSERT ON ledger_journals
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_journal_integrity();
    CREATE CONSTRAINT TRIGGER ledger_journal_lines_integrity_trigger
      AFTER INSERT ON ledger_journal_lines
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_journal_integrity();
    CREATE CONSTRAINT TRIGGER ledger_valuation_snapshots_integrity_trigger
      AFTER INSERT ON ledger_valuation_snapshots
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_metadata_integrity();
    CREATE CONSTRAINT TRIGGER ledger_fee_components_integrity_trigger
      AFTER INSERT ON ledger_fee_components
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_metadata_integrity();
    CREATE CONSTRAINT TRIGGER ledger_fee_estimates_integrity_trigger
      AFTER INSERT ON ledger_fee_estimate_snapshots
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_fee_estimate_integrity();
    CREATE CONSTRAINT TRIGGER ledger_evidence_claims_integrity_trigger
      AFTER INSERT ON ledger_external_evidence_claims
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_metadata_integrity();
    CREATE CONSTRAINT TRIGGER ledger_journal_ref_usages_integrity_trigger
      AFTER INSERT ON ledger_journal_external_reference_usages
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_ledger_metadata_integrity();

    ALTER TABLE ledger_leg_posting_plan_seals
      ENABLE ALWAYS TRIGGER ledger_leg_posting_plan_seals_validation_trigger;
    ALTER TABLE ledger_reversal_approvals
      ENABLE ALWAYS TRIGGER ledger_reversal_approvals_integrity_trigger;
    ALTER TABLE ledger_command_capabilities
      ENABLE ALWAYS TRIGGER ledger_command_capabilities_validation_trigger;
    ALTER TABLE ledger_command_capability_resolutions
      ENABLE ALWAYS TRIGGER ledger_command_capability_resolutions_integrity_trigger;

    ALTER TABLE ledger_journals ENABLE ALWAYS TRIGGER ledger_journals_integrity_trigger;
    ALTER TABLE ledger_journal_lines ENABLE ALWAYS TRIGGER ledger_journal_lines_integrity_trigger;
    ALTER TABLE ledger_valuation_snapshots
      ENABLE ALWAYS TRIGGER ledger_valuation_snapshots_integrity_trigger;
    ALTER TABLE ledger_fee_components
      ENABLE ALWAYS TRIGGER ledger_fee_components_integrity_trigger;
    ALTER TABLE ledger_fee_estimate_snapshots
      ENABLE ALWAYS TRIGGER ledger_fee_estimates_integrity_trigger;
    ALTER TABLE ledger_external_evidence_claims
      ENABLE ALWAYS TRIGGER ledger_evidence_claims_integrity_trigger;
    ALTER TABLE ledger_journal_external_reference_usages
      ENABLE ALWAYS TRIGGER ledger_journal_ref_usages_integrity_trigger;

    REVOKE ALL PRIVILEGES ON TABLE ${tableList} FROM PUBLIC, ${api};
  `;
}

function createLedgerDownSql(names: DatabasePrincipalNames): readonly string[] {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  return [
    `DO $refuse_populated_ledger_rollback$
     BEGIN
       IF EXISTS (SELECT 1 FROM ledger_assets)
         OR EXISTS (SELECT 1 FROM ledger_accounts)
         OR EXISTS (SELECT 1 FROM ledger_transactions)
         OR EXISTS (SELECT 1 FROM ledger_legs)
         OR EXISTS (SELECT 1 FROM ledger_leg_posting_plans)
         OR EXISTS (SELECT 1 FROM ledger_leg_posting_plan_lines)
         OR EXISTS (SELECT 1 FROM ledger_leg_recognition_evidence)
         OR EXISTS (SELECT 1 FROM ledger_leg_valuation_plans)
         OR EXISTS (SELECT 1 FROM ledger_leg_fee_plans)
         OR EXISTS (SELECT 1 FROM ledger_leg_posting_plan_seals)
         OR EXISTS (SELECT 1 FROM ledger_journals)
         OR EXISTS (SELECT 1 FROM ledger_journal_lines)
         OR EXISTS (SELECT 1 FROM ledger_reversal_approvals)
         OR EXISTS (SELECT 1 FROM ledger_command_capabilities)
         OR EXISTS (SELECT 1 FROM ledger_command_capability_resolutions)
         OR EXISTS (SELECT 1 FROM ledger_valuation_snapshots)
         OR EXISTS (SELECT 1 FROM ledger_fee_estimate_snapshots)
         OR EXISTS (SELECT 1 FROM ledger_fee_components)
         OR EXISTS (SELECT 1 FROM ledger_external_evidence)
         OR EXISTS (SELECT 1 FROM ledger_external_evidence_claims)
         OR EXISTS (SELECT 1 FROM ledger_journal_external_reference_usages)
         OR (SELECT count(*) <> 1 FROM ledger_books)
         OR NOT EXISTS (
           SELECT 1 FROM ledger_books
           WHERE book_code = 'OPERATIONAL_MEMO'
             AND accounting_purpose = 'VALUE_MOVEMENT_MEMORANDUM'
         )
       THEN
         RAISE EXCEPTION 'refusing to roll back populated immutable ledger tables'
           USING ERRCODE = '55000';
       END IF;
     END;
     $refuse_populated_ledger_rollback$;`,
    `REVOKE ALL ON FUNCTION post_ledger_journal(
       text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
     ) FROM ${api}`,
    `REVOKE ALL ON FUNCTION reverse_ledger_journal(
       text, uuid, text, timestamptz, timestamptz, uuid
     ) FROM ${api}`,
    `DROP FUNCTION reverse_ledger_journal(
       text, uuid, text, timestamptz, timestamptz, uuid
     )`,
    `DROP FUNCTION post_ledger_journal(
       text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
     )`,
    'DROP FUNCTION compute_ledger_reversal_approval_digest(uuid)',
    'DROP FUNCTION compute_ledger_posting_plan_digest(uuid)',
    'DROP FUNCTION assert_ledger_journal_integrity(uuid)',
    'DROP TABLE ledger_leg_valuation_plans',
    'DROP TABLE ledger_leg_fee_plans',
    'DROP TABLE ledger_fee_components',
    'DROP TABLE ledger_journal_external_reference_usages',
    'DROP TABLE ledger_external_evidence_claims',
    'DROP TABLE ledger_external_evidence',
    'DROP TABLE ledger_fee_estimate_snapshots',
    'DROP TABLE ledger_valuation_snapshots',
    'DROP TABLE ledger_command_capability_resolutions',
    'ALTER TABLE ledger_journals DROP CONSTRAINT ledger_journals_capability_fk',
    'ALTER TABLE ledger_journals DROP CONSTRAINT ledger_journals_reversal_approval_fk',
    'DROP TABLE ledger_command_capabilities',
    'DROP TABLE ledger_reversal_approvals',
    'DROP TABLE ledger_journal_lines',
    'ALTER TABLE ledger_legs DROP CONSTRAINT ledger_legs_adjusts_journal_fk',
    'ALTER TABLE ledger_legs DROP CONSTRAINT ledger_legs_compensates_journal_fk',
    'DROP TABLE ledger_journals',
    'DROP TABLE ledger_leg_posting_plan_seals',
    'DROP TABLE ledger_leg_recognition_evidence',
    'DROP TABLE ledger_leg_posting_plan_lines',
    'DROP TABLE ledger_leg_posting_plans',
    'DROP TABLE ledger_legs',
    'DROP TABLE ledger_transactions',
    'DROP TABLE ledger_accounts',
    'DROP TABLE ledger_assets',
    'DROP TABLE ledger_books',
    'DROP FUNCTION validate_ledger_metadata_integrity()',
    'DROP FUNCTION validate_ledger_fee_estimate_integrity()',
    'DROP FUNCTION validate_ledger_journal_integrity()',
    'DROP FUNCTION validate_ledger_posting_plan_seal()',
    'DROP FUNCTION validate_ledger_capability_resolution_integrity()',
    'DROP FUNCTION validate_ledger_capability_integrity()',
    'DROP FUNCTION validate_ledger_reversal_approval_integrity()',
    'DROP FUNCTION validate_ledger_posting_plan_integrity()',
    'DROP FUNCTION reject_frozen_ledger_plan_change()',
    'DROP FUNCTION reject_ledger_mutation()',
  ];
}

function extendPrincipalVerifierForLedgerBoundary(
  names: DatabasePrincipalNames,
  principalVerifier: string,
): string {
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  // PostgreSQL makes a table's implicit row type effectively USAGE-capable.
  // Exempt only the exact catalog-pinned ledger tables; every other current-schema type stays denied.
  const ledgerTableLiterals = LEDGER_TABLES.map((table) => `'${table}'`).join(', ');
  const existingFunctionAllowance = `            OR (
              grantee.rolname = ${legacy}
              AND procedure.oid IN (
                to_regprocedure('provision_account_profile(uuid,text,text,text,uuid,text)'),
                to_regprocedure(
                  'update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)'
                )
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const ledgerFunctionAllowance = `${existingFunctionAllowance}
            OR (
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
  const existingLoginTypeProbe = `          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_type AS type_object
            WHERE type_object.typnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_type AS element_type
                WHERE element_type.typarray = type_object.oid
              )
              AND pg_catalog.has_type_privilege(login_role.oid, type_object.oid, 'USAGE')
          )`;
  const ledgerLoginTypeProbe = `          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_type AS type_object
            WHERE type_object.typnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_type AS element_type
                WHERE element_type.typarray = type_object.oid
              )
              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class AS ledger_row_table
                WHERE ledger_row_table.oid = type_object.typrelid
                  AND ledger_row_table.relnamespace =
                    pg_catalog.to_regnamespace(pg_catalog.current_schema())
                  AND ledger_row_table.relkind = 'r'
                  AND ledger_row_table.relname IN (${ledgerTableLiterals})
              )
              AND pg_catalog.has_type_privilege(login_role.oid, type_object.oid, 'USAGE')
          )`;
  const existingAuditedTypeProbe = `    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type AS type_object
      CROSS JOIN pg_catalog.pg_roles AS audited_role
      WHERE type_object.typnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_type AS element_type
          WHERE element_type.typarray = type_object.oid
        )
        AND (
          audited_role.rolname IN (
            ${literal(names.migrationRole, 'migrationRole')}, ${legacy}, ${api}, ${literal(names.workerRuntimeRole, 'workerRuntimeRole')}
          )
          OR audited_role.rolname ~ ('^' || ${literal(names.apiLoginPrefix, 'apiLoginPrefix')} || '[a-z0-9]{1,32}$')
          OR audited_role.rolname ~ ('^' || ${literal(names.workerLoginPrefix, 'workerLoginPrefix')} || '[a-z0-9]{1,32}$')
        )
        AND pg_catalog.has_type_privilege(audited_role.oid, type_object.oid, 'USAGE')
    )`;
  const ledgerAuditedTypeProbe = `    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type AS type_object
      CROSS JOIN pg_catalog.pg_roles AS audited_role
      WHERE type_object.typnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_type AS element_type
          WHERE element_type.typarray = type_object.oid
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS ledger_row_table
          WHERE ledger_row_table.oid = type_object.typrelid
            AND ledger_row_table.relnamespace =
              pg_catalog.to_regnamespace(pg_catalog.current_schema())
            AND ledger_row_table.relkind = 'r'
            AND ledger_row_table.relname IN (${ledgerTableLiterals})
        )
        AND (
          audited_role.rolname IN (
            ${literal(names.migrationRole, 'migrationRole')}, ${legacy}, ${api}, ${literal(names.workerRuntimeRole, 'workerRuntimeRole')}
          )
          OR audited_role.rolname ~ ('^' || ${literal(names.apiLoginPrefix, 'apiLoginPrefix')} || '[a-z0-9]{1,32}$')
          OR audited_role.rolname ~ ('^' || ${literal(names.workerLoginPrefix, 'workerLoginPrefix')} || '[a-z0-9]{1,32}$')
        )
        AND pg_catalog.has_type_privilege(audited_role.oid, type_object.oid, 'USAGE')
    )`;

  const withLedgerFunctions = replaceExactlyOnce(
    principalVerifier,
    existingFunctionAllowance,
    ledgerFunctionAllowance,
  );
  const withLedgerLoginRowTypes = replaceExactlyOnce(
    withLedgerFunctions,
    existingLoginTypeProbe,
    ledgerLoginTypeProbe,
  );
  return replaceExactlyOnce(
    withLedgerLoginRowTypes,
    existingAuditedTypeProbe,
    ledgerAuditedTypeProbe,
  );
}

function createLedgerVerifierSql(
  names: DatabasePrincipalNames,
  requireNamedSchemaOwner = false,
): string {
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const apiPrefix = literal(names.apiLoginPrefix, 'apiLoginPrefix');
  const workerPrefix = literal(names.workerLoginPrefix, 'workerLoginPrefix');
  const namedOwnerContract = requireNamedSchemaOwner
    ? `AND (
        SELECT role_state.rolname = ${owner}
        FROM pg_catalog.pg_roles AS role_state
        WHERE role_state.oid = context.ledger_owner
      )`
    : '';

  return `WITH verifier_context AS MATERIALIZED (
    SELECT
      pg_catalog.current_schema() AS target_schema,
      pg_catalog.to_regnamespace(pg_catalog.current_schema()) AS target_namespace,
      pg_catalog.to_regclass(
        pg_catalog.format('%I.ledger_books', pg_catalog.current_schema())
      ) AS book_table
  ),
  context AS MATERIALIZED (
    SELECT
      verifier_context.*,
      book.relowner AS ledger_owner,
      pg_catalog.format('%I.', verifier_context.target_schema) AS qualified_schema_prefix
    FROM verifier_context
    LEFT JOIN pg_catalog.pg_class AS book ON book.oid = verifier_context.book_table
  ),
  ledger_tables AS MATERIALIZED (
    SELECT table_state.*
    FROM context
    INNER JOIN pg_catalog.pg_class AS table_state
      ON table_state.relnamespace = context.target_namespace
     AND table_state.relkind = 'r'
     AND pg_catalog.left(table_state.relname, 7) = 'ledger_'
  ),
  ledger_columns AS MATERIALIZED (
    SELECT
      table_state.relname AS table_name,
      attribute.*,
      default_state.oid AS default_oid,
      default_state.adbin,
      default_state.adrelid,
      collation_namespace.nspname AS collation_schema,
      collation_state.collname AS collation_name
    FROM ledger_tables AS table_state
    INNER JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = table_state.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef AS default_state
      ON default_state.adrelid = attribute.attrelid
     AND default_state.adnum = attribute.attnum
    LEFT JOIN pg_catalog.pg_collation AS collation_state
      ON collation_state.oid = attribute.attcollation
    LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
      ON collation_namespace.oid = collation_state.collnamespace
  ),
  ledger_touching_constraints AS MATERIALIZED (
    SELECT constraint_state.*
    FROM pg_catalog.pg_constraint AS constraint_state
    WHERE EXISTS (
      SELECT 1
      FROM ledger_tables AS table_state
      WHERE table_state.oid = constraint_state.conrelid
         OR table_state.oid = constraint_state.confrelid
    )
  ),
  column_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          column_state.table_name,
          column_state.attnum,
          column_state.attname,
          pg_catalog.format_type(column_state.atttypid, column_state.atttypmod),
          column_state.attnotnull,
          column_state.attidentity,
          column_state.attgenerated,
          column_state.attndims,
          CASE
            WHEN column_state.default_oid IS NULL THEN NULL
            ELSE pg_catalog.pg_get_expr(
              column_state.adbin,
              column_state.adrelid,
              false
            )
          END,
          CASE
            WHEN column_state.attcollation = 0 THEN NULL
            ELSE column_state.collation_schema || '.' || column_state.collation_name
          END,
          column_state.attacl::text,
          column_state.attstorage,
          column_state.attcompression
        ) ORDER BY column_state.table_name, column_state.attnum
      ) AS descriptor
    FROM ledger_columns AS column_state
  ),
  table_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          table_state.relname,
          table_state.relkind,
          table_state.relpersistence,
          table_state.relrowsecurity,
          table_state.relforcerowsecurity,
          table_state.relreplident,
          table_state.relispartition,
          table_state.relhassubclass,
          table_state.relhasrules,
          table_state.reloptions,
          CASE
            WHEN table_state.reltablespace = 0 THEN NULL
            ELSE tablespace.spcname
          END
        ) ORDER BY table_state.relname
      ) AS descriptor
    FROM ledger_tables AS table_state
    LEFT JOIN pg_catalog.pg_tablespace AS tablespace
      ON tablespace.oid = table_state.reltablespace
  ),
  constraint_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          table_state.relname,
          constraint_state.conname,
          constraint_state.contype,
          constraint_state.condeferrable,
          constraint_state.condeferred,
          constraint_state.convalidated,
          constraint_state.connoinherit,
          coalesce(referenced_table.relname, ''),
          constraint_state.confupdtype,
          constraint_state.confdeltype,
          constraint_state.confmatchtype,
          constraint_state.conkey::text,
          constraint_state.confkey::text,
          pg_catalog.replace(
            pg_catalog.pg_get_constraintdef(constraint_state.oid, false),
            context.qualified_schema_prefix,
            '__schema__.'
          )
        ) ORDER BY table_state.relname, constraint_state.conname
      ) AS descriptor
    FROM context
    INNER JOIN ledger_touching_constraints AS constraint_state ON true
    INNER JOIN pg_catalog.pg_class AS table_state
      ON table_state.oid = constraint_state.conrelid
    LEFT JOIN pg_catalog.pg_class AS referenced_table
      ON referenced_table.oid = constraint_state.confrelid
  ),
  index_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          table_state.relname,
          index_table.relname,
          index_state.indisunique,
          index_state.indisprimary,
          index_state.indisexclusion,
          index_state.indimmediate,
          index_state.indisclustered,
          index_state.indisvalid,
          index_state.indcheckxmin,
          index_state.indisready,
          index_state.indislive,
          index_state.indisreplident,
          index_state.indnullsnotdistinct,
          index_state.indnatts,
          index_state.indnkeyatts,
          index_state.indkey::text,
          index_state.indoption::text,
          (
            SELECT pg_catalog.jsonb_agg(
              opclass_namespace.nspname || '.' || opclass.opcname
              ORDER BY key_class.ordinality
            )
            FROM pg_catalog.unnest(index_state.indclass::oid[])
              WITH ORDINALITY AS key_class(opclass_oid, ordinality)
            INNER JOIN pg_catalog.pg_opclass AS opclass
              ON opclass.oid = key_class.opclass_oid
            INNER JOIN pg_catalog.pg_namespace AS opclass_namespace
              ON opclass_namespace.oid = opclass.opcnamespace
          ),
          (
            SELECT pg_catalog.jsonb_agg(
              CASE
                WHEN key_collation.collation_oid = 0 THEN NULL
                ELSE collation_namespace.nspname || '.' || collation_state.collname
              END ORDER BY key_collation.ordinality
            )
            FROM pg_catalog.unnest(index_state.indcollation::oid[])
              WITH ORDINALITY AS key_collation(collation_oid, ordinality)
            LEFT JOIN pg_catalog.pg_collation AS collation_state
              ON collation_state.oid = key_collation.collation_oid
            LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
              ON collation_namespace.oid = collation_state.collnamespace
          ),
          pg_catalog.pg_get_expr(index_state.indexprs, index_state.indrelid, false),
          pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid, false),
          index_table.reloptions,
          CASE
            WHEN index_table.reltablespace = 0 THEN NULL
            ELSE tablespace.spcname
          END,
          pg_catalog.replace(
            pg_catalog.pg_get_indexdef(index_state.indexrelid, 0, false),
            context.qualified_schema_prefix,
            '__schema__.'
          )
        ) ORDER BY table_state.relname, index_table.relname
      ) AS descriptor
    FROM context
    INNER JOIN ledger_tables AS table_state ON true
    INNER JOIN pg_catalog.pg_index AS index_state
      ON index_state.indrelid = table_state.oid
    INNER JOIN pg_catalog.pg_class AS index_table
      ON index_table.oid = index_state.indexrelid
    LEFT JOIN pg_catalog.pg_tablespace AS tablespace
      ON tablespace.oid = index_table.reltablespace
  ),
  ledger_triggers AS MATERIALIZED (
    SELECT
      table_state.relname AS table_name,
      trigger_state.*,
      procedure.proname,
      procedure.proowner,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS function_arguments
    FROM ledger_tables AS table_state
    INNER JOIN pg_catalog.pg_trigger AS trigger_state
      ON trigger_state.tgrelid = table_state.oid
     AND NOT trigger_state.tgisinternal
    INNER JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_state.tgfoid
  ),
  trigger_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          trigger_state.table_name,
          trigger_state.tgname,
          trigger_state.proname,
          trigger_state.function_arguments,
          trigger_state.tgtype,
          trigger_state.tgenabled,
          trigger_state.tgdeferrable,
          trigger_state.tginitdeferred,
          trigger_state.tgattr::text,
          pg_catalog.pg_get_expr(
            trigger_state.tgqual,
            trigger_state.tgrelid,
            false
          ),
          pg_catalog.replace(
            pg_catalog.pg_get_triggerdef(trigger_state.oid, false),
            context.qualified_schema_prefix,
            '__schema__.'
          )
        ) ORDER BY trigger_state.table_name, trigger_state.tgname
      ) AS descriptor
    FROM context
    INNER JOIN ledger_triggers AS trigger_state ON true
  ),
  internal_fk_trigger_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          child_table.relname,
          constraint_state.conname,
          CASE
            WHEN target_namespace.nspname = context.target_schema THEN '__schema__'
            ELSE target_namespace.nspname
          END,
          target_table.relname,
          referenced_table.relname,
          procedure.proname,
          pg_catalog.pg_get_function_identity_arguments(procedure.oid),
          trigger_state.tgtype,
          trigger_state.tgenabled,
          trigger_state.tgisinternal,
          trigger_state.tgdeferrable,
          trigger_state.tginitdeferred,
          trigger_state.tgattr::text,
          pg_catalog.pg_get_expr(
            trigger_state.tgqual,
            trigger_state.tgrelid,
            false
          )
        ) ORDER BY
          child_table.relname,
          constraint_state.conname,
          target_namespace.nspname,
          target_table.relname,
          procedure.proname,
          trigger_state.tgtype
      ) AS descriptor
    FROM context
    INNER JOIN ledger_touching_constraints AS constraint_state
      ON constraint_state.contype = 'f'
    INNER JOIN pg_catalog.pg_class AS child_table
      ON child_table.oid = constraint_state.conrelid
    INNER JOIN pg_catalog.pg_trigger AS trigger_state
      ON trigger_state.tgconstraint = constraint_state.oid
    INNER JOIN pg_catalog.pg_class AS target_table
      ON target_table.oid = trigger_state.tgrelid
    INNER JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_table.relnamespace
    LEFT JOIN pg_catalog.pg_class AS referenced_table
      ON referenced_table.oid = trigger_state.tgconstrrelid
    INNER JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_state.tgfoid
  ),
  ledger_functions AS MATERIALIZED (
    SELECT
      procedure.*,
      language.lanname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
      pg_catalog.pg_get_function_result(procedure.oid) AS function_result
    FROM context
    INNER JOIN pg_catalog.pg_proc AS procedure
      ON procedure.pronamespace = context.target_namespace
     AND (
       pg_catalog.strpos(procedure.proname, 'ledger') > 0
       OR procedure.proname IN ('post_ledger_journal', 'reverse_ledger_journal')
     )
    INNER JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
  ),
  function_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          function_state.proname,
          function_state.identity_arguments,
          function_state.function_result,
          function_state.lanname,
          function_state.prokind,
          function_state.provolatile,
          function_state.proparallel,
          function_state.prosecdef,
          function_state.proleakproof,
          function_state.proisstrict,
          function_state.proretset,
          function_state.pronargs,
          function_state.pronargdefaults,
          function_state.procost,
          function_state.prorows,
          (
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.replace(config_state.config_value, ' ' || context.target_schema || ',',
                ' __schema__,')
              ORDER BY config_state.ordinality
            )
            FROM pg_catalog.unnest(function_state.proconfig)
              WITH ORDINALITY AS config_state(config_value, ordinality)
          ),
          pg_catalog.replace(
            pg_catalog.replace(
              pg_catalog.replace(
                function_state.prosrc,
                context.qualified_schema_prefix,
                '__schema__.'
              ),
              pg_catalog.chr(13) || pg_catalog.chr(10),
              pg_catalog.chr(10)
            ),
            pg_catalog.chr(13),
            pg_catalog.chr(10)
          )
        ) ORDER BY function_state.proname, function_state.identity_arguments
      ) AS descriptor
    FROM context
    INNER JOIN ledger_functions AS function_state ON true
  ),
  runtime_roles AS MATERIALIZED (
    SELECT role_state.oid, role_state.rolname
    FROM pg_catalog.pg_roles AS role_state
    WHERE role_state.rolname IN (${api}, ${worker}, ${legacy})
       OR role_state.rolname LIKE ${apiPrefix} || '%'
       OR role_state.rolname LIKE ${workerPrefix} || '%'
  ),
  table_acl AS MATERIALIZED (
    SELECT table_state.oid AS table_oid, table_state.relowner, acl.*
    FROM ledger_tables AS table_state
    CROSS JOIN LATERAL pg_catalog.aclexplode(table_state.relacl) AS acl
  ),
  function_acl AS MATERIALIZED (
    SELECT function_state.oid AS function_oid, function_state.proname,
      function_state.identity_arguments, function_state.proowner, acl.*
    FROM ledger_functions AS function_state
    CROSS JOIN LATERAL pg_catalog.aclexplode(function_state.proacl) AS acl
  )
  SELECT (
    context.target_namespace IS NOT NULL
    AND context.target_schema <> '__schema__'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS namespace_state
      WHERE namespace_state.nspname = '__schema__'
    )
    AND context.book_table IS NOT NULL
    AND context.ledger_owner IS NOT NULL
    ${namedOwnerContract}
    AND (SELECT object_count = 22 FROM table_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '9ae9153673009e7d049bc919d6bd0cac2a5c68f22244b533464f036f76e81a26'
      FROM table_catalog
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_inherits AS inheritance_state
      INNER JOIN ledger_tables AS table_state
        ON table_state.oid = inheritance_state.inhrelid
        OR table_state.oid = inheritance_state.inhparent
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_rewrite AS rewrite_state
      INNER JOIN ledger_tables AS table_state
        ON table_state.oid = rewrite_state.ev_class
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_functions AS function_state
      WHERE pg_catalog.strpos(function_state.prosrc, '__schema__') > 0
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.unnest(function_state.proconfig) AS config_state(config_value)
           WHERE pg_catalog.strpos(config_state.config_value, '__schema__') > 0
         )
    )
    AND (SELECT object_count = 331 FROM column_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '32d58be18c425eb0f2d87f64b75e8e2574317a89cb6260cb9158cebe48fdf10b'
      FROM column_catalog
    )
    AND (SELECT object_count = 309 FROM constraint_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = 'a94b201b587909d901829382edce3e67bacc72db2a5502a0879b110036370d1c'
      FROM constraint_catalog
    )
    AND (SELECT object_count = 86 FROM index_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '73715e81858f8f2a9f4dcb8c9a1f8bb60f86139c7bb43f8a85d1b953d8609b8c'
      FROM index_catalog
    )
    AND (SELECT object_count = 65 FROM trigger_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = 'fdbd542c971e64191b394752a4993d85b04f88cdc9f437d931740c22eba3b1f3'
      FROM trigger_catalog
    )
    AND (SELECT object_count = 304 FROM internal_fk_trigger_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = 'f5afff3f67177c9166615ac3434d2567a9845d748bb3036a9d61ea953986e2e1'
      FROM internal_fk_trigger_catalog
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgisinternal
        AND (
          EXISTS (
            SELECT 1
            FROM ledger_tables AS table_state
            WHERE table_state.oid = trigger_state.tgrelid
               OR table_state.oid = trigger_state.tgconstrrelid
          )
          OR EXISTS (
            SELECT 1
            FROM ledger_touching_constraints AS constraint_state
            WHERE constraint_state.oid = trigger_state.tgconstraint
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ledger_touching_constraints AS constraint_state
          WHERE constraint_state.oid = trigger_state.tgconstraint
            AND constraint_state.contype = 'f'
        )
    )
    AND (SELECT object_count = 15 FROM function_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '3d95ee145d5531cb7ea0b5582331338d7a1a8e3a81bac269717c2fc1808dbef6'
      FROM function_catalog
    )
    AND NOT EXISTS (
      SELECT 1 FROM ledger_tables AS table_state
      WHERE table_state.relowner <> context.ledger_owner
         OR table_state.relacl IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_state
      INNER JOIN ledger_tables AS table_state ON table_state.oid = index_state.indrelid
      INNER JOIN pg_catalog.pg_class AS index_table ON index_table.oid = index_state.indexrelid
      WHERE index_table.relowner <> context.ledger_owner
    )
    AND NOT EXISTS (
      SELECT 1 FROM ledger_functions AS function_state
      WHERE function_state.proowner <> context.ledger_owner
         OR function_state.proacl IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM ledger_triggers AS trigger_state
      WHERE trigger_state.proowner <> context.ledger_owner
    )
    AND (SELECT pg_catalog.count(*) = 154 FROM table_acl)
    AND NOT EXISTS (
      SELECT 1 FROM table_acl AS acl
      WHERE acl.grantee <> acl.relowner
         OR acl.grantor <> acl.relowner
         OR acl.is_grantable
         OR acl.privilege_type NOT IN (
           'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
         )
    )
    AND NOT EXISTS (
      SELECT 1 FROM ledger_columns AS column_state
      WHERE column_state.attacl IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM runtime_roles AS runtime_role
      CROSS JOIN ledger_tables AS table_state
      WHERE pg_catalog.has_table_privilege(
        runtime_role.oid,
        table_state.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM runtime_roles AS runtime_role
      CROSS JOIN ledger_columns AS column_state
      WHERE pg_catalog.has_column_privilege(
        runtime_role.oid,
        column_state.attrelid,
        column_state.attnum,
        'SELECT,INSERT,UPDATE,REFERENCES'
      )
    )
    AND (SELECT pg_catalog.count(*) = 17 FROM function_acl)
    AND NOT EXISTS (
      SELECT 1 FROM function_acl AS acl
      WHERE acl.grantor <> acl.proowner
         OR acl.is_grantable
         OR acl.privilege_type <> 'EXECUTE'
         OR (
           acl.grantee <> acl.proowner
           AND NOT (
             acl.grantee = (
               SELECT role_state.oid
               FROM pg_catalog.pg_roles AS role_state
               WHERE role_state.rolname = ${api}
             )
             AND (
               (acl.proname = 'post_ledger_journal'
                 AND acl.identity_arguments =
                   'requested_capability_token text, requested_book_id uuid, requested_transaction_id uuid, requested_leg_id uuid, requested_economic_event_type text, requested_effective_at timestamp with time zone, requested_observed_at timestamp with time zone, requested_reason_code text, requested_correlation_id uuid, requested_postings text')
               OR
               (acl.proname = 'reverse_ledger_journal'
                 AND acl.identity_arguments =
                   'requested_capability_token text, requested_original_journal_id uuid, requested_reason_code text, requested_effective_at timestamp with time zone, requested_observed_at timestamp with time zone, requested_correlation_id uuid')
             )
           )
         )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM runtime_roles AS runtime_role
      CROSS JOIN ledger_functions AS function_state
      WHERE pg_catalog.has_function_privilege(
        runtime_role.oid,
        function_state.oid,
        'EXECUTE'
      )
      AND NOT (
        (
          runtime_role.rolname = ${api}
          OR runtime_role.rolname LIKE ${apiPrefix} || '%'
        )
        AND function_state.proname IN ('post_ledger_journal', 'reverse_ledger_journal')
      )
    )
  ) AS valid
  FROM context`;
}

function createCumulativeLedgerVerifierSql(names: DatabasePrincipalNames): string {
  const principalMigration = createDatabasePrincipalBoundaryMigration(names);
  if (!principalMigration.verifySql) {
    throw new Error('Migration 0005 must expose verification SQL');
  }
  const principalVerifier = extendPrincipalVerifierForLedgerBoundary(
    names,
    principalMigration.verifySql,
  );
  return `SELECT (principal.valid AND ledger.valid) AS valid
    FROM (${principalVerifier}) AS principal
    CROSS JOIN (${createLedgerVerifierSql(names, true)}) AS ledger`;
}

export function createImmutableLedgerMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0007',
    description: 'create immutable exact-precision operational ledger',
    upSql: [
      createLedgerUpSql(),
      createLedgerMetadataSql(),
      createLedgerFunctionsSql(names),
      createLedgerTriggersAndAclSql(names),
    ],
    downSql: createLedgerDownSql(names),
    verifySql: cumulativePrincipalVerification
      ? createCumulativeLedgerVerifierSql(names)
      : createLedgerVerifierSql(names),
    ...(cumulativePrincipalVerification ? { supersedesVerificationOf: ['0005'] } : {}),
  };
}

export const createImmutableLedgerMigrationV0007 = createImmutableLedgerMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createImmutableLedgerTestSchemaMigrationV0007 = createImmutableLedgerMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
  { cumulativePrincipalVerification: false },
);
