import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createYieldOperationControlsMigration } from './0012-create-yield-operation-controls.migration';
import type { DatabaseMigration } from './migration';

const ORIGINAL_STAGE_PREDICATE = "AND component.stage = 'ACTUAL'";
const REPAIRED_STAGE_PREDICATE = `AND component.stage = CASE
                  WHEN target_event_type = 'ADJUSTMENT' THEN 'ADJUSTMENT'
                  ELSE 'ACTUAL'
                END`;

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0013 verifier repair anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function createFunctionRepairSql(expectedPredicate: string, replacementPredicate: string): string {
  return `
    DO $repair_ledger_fee_adjustment_integrity$
    DECLARE
      target_function regprocedure :=
        to_regprocedure('assert_ledger_journal_integrity(uuid)');
      function_definition text;
      function_body text;
      expected_occurrences integer;
    BEGIN
      IF target_function IS NULL THEN
        RAISE EXCEPTION 'ledger journal integrity function is missing'
          USING ERRCODE = '42883';
      END IF;

      SELECT pg_catalog.pg_get_functiondef(target_function)
      INTO STRICT function_definition;
      function_body := pg_catalog.split_part(function_definition, '$function$', 2);
      expected_occurrences := (
        pg_catalog.length(function_body)
          - pg_catalog.length(
              pg_catalog.replace(
                function_body,
                $expected$${expectedPredicate}$expected$,
                ''
              )
            )
      ) / pg_catalog.length($expected$${expectedPredicate}$expected$);

      IF expected_occurrences <> 1
        OR pg_catalog.strpos(
          function_body,
          $replacement$${replacementPredicate}$replacement$
        ) > 0
      THEN
        RAISE EXCEPTION
          'ledger journal integrity function does not match the expected repair source'
          USING ERRCODE = '55000';
      END IF;

      function_body := pg_catalog.replace(
        function_body,
        $expected$${expectedPredicate}$expected$,
        $replacement$${replacementPredicate}$replacement$
      );
      function_definition :=
        pg_catalog.split_part(function_definition, '$function$', 1)
        || '$function$'
        || function_body
        || '$function$'
        || pg_catalog.split_part(function_definition, '$function$', 3);
      EXECUTE function_definition;
    END;
    $repair_ledger_fee_adjustment_integrity$
  `;
}

function createRollbackGuardSql(): string {
  return `
    DO $guard_ledger_fee_adjustment_integrity_rollback$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM ledger_fee_components AS component
        WHERE component.stage = 'ADJUSTMENT'
      ) THEN
        RAISE EXCEPTION
          'cannot roll back fee-adjustment integrity after adjustment facts exist'
          USING ERRCODE = '55000';
      END IF;
    END;
    $guard_ledger_fee_adjustment_integrity_rollback$
  `;
}

function normalizeRepairedFunctionForPriorVerifier(priorVerifier: string): string {
  const catalogStartAnchor = '  function_catalog AS MATERIALIZED (';
  const catalogEndAnchor = '  runtime_roles AS MATERIALIZED (';
  const catalogStart = priorVerifier.indexOf(catalogStartAnchor);
  const catalogEnd = priorVerifier.indexOf(catalogEndAnchor, catalogStart);
  if (
    catalogStart < 0 ||
    catalogEnd < 0 ||
    priorVerifier.indexOf(catalogStartAnchor, catalogStart + catalogStartAnchor.length) >= 0
  ) {
    throw new Error('Migration 0013 ledger function catalog anchor must occur exactly once');
  }
  const sourceAnchor = `              function_state.prosrc,
                context.qualified_schema_prefix,`;
  const normalizedSource = `              CASE
                WHEN function_state.proname = 'assert_ledger_journal_integrity'
                  AND function_state.identity_arguments = 'target_journal_id uuid'
                THEN pg_catalog.replace(
                  function_state.prosrc,
                  $repaired$${REPAIRED_STAGE_PREDICATE}$repaired$,
                  $original$${ORIGINAL_STAGE_PREDICATE}$original$
                )
                ELSE function_state.prosrc
              END,
                context.qualified_schema_prefix,`;
  const catalog = priorVerifier.slice(catalogStart, catalogEnd);
  return `${priorVerifier.slice(0, catalogStart)}${replaceExactlyOnce(
    catalog,
    sourceAnchor,
    normalizedSource,
  )}${priorVerifier.slice(catalogEnd)}`;
}

function createRepairVerifierSql(priorVerifier: string): string {
  const normalizedPriorVerifier = normalizeRepairedFunctionForPriorVerifier(priorVerifier);
  return `
    SELECT (prior.valid AND repair.valid) AS valid
    FROM (${normalizedPriorVerifier}) AS prior
    CROSS JOIN (
      SELECT (
        pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(
          (
            pg_catalog.length(function_state.prosrc)
              - pg_catalog.length(
                  pg_catalog.replace(
                    function_state.prosrc,
                    $repaired$${REPAIRED_STAGE_PREDICATE}$repaired$,
                    ''
                  )
                )
          ) / pg_catalog.length(
            $repaired$${REPAIRED_STAGE_PREDICATE}$repaired$
          ) = 1
          AND pg_catalog.strpos(
            function_state.prosrc,
            $original$${ORIGINAL_STAGE_PREDICATE}$original$
          ) = 0
        )
      ) AS valid
      FROM pg_catalog.pg_proc AS function_state
      INNER JOIN pg_catalog.pg_namespace AS namespace_state
        ON namespace_state.oid = function_state.pronamespace
      WHERE namespace_state.nspname = pg_catalog.current_schema()
        AND function_state.oid =
          to_regprocedure('assert_ledger_journal_integrity(uuid)')
    ) AS repair
  `;
}

export function createLedgerFeeAdjustmentIntegrityMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const priorMigration = createYieldOperationControlsMigration(names, options);
  return createMigrationForPrior(priorMigration);
}

function createMigrationForPrior(priorMigration: DatabaseMigration): DatabaseMigration {
  if (!priorMigration.verifySql) {
    throw new Error(`Migration ${priorMigration.id} must expose verification SQL`);
  }
  return {
    id: '0013',
    description: 'repair immutable ledger fee-adjustment integrity stage matching',
    upSql: createFunctionRepairSql(ORIGINAL_STAGE_PREDICATE, REPAIRED_STAGE_PREDICATE),
    downSql: [
      createRollbackGuardSql(),
      createFunctionRepairSql(REPAIRED_STAGE_PREDICATE, ORIGINAL_STAGE_PREDICATE),
    ],
    verifySql: createRepairVerifierSql(priorMigration.verifySql),
    supersedesVerificationOf: [priorMigration.id],
  };
}

export const createLedgerFeeAdjustmentIntegrityMigrationV0013 =
  createLedgerFeeAdjustmentIntegrityMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createLedgerFeeAdjustmentIntegrityTestSchemaMigrationV0013 =
  createLedgerFeeAdjustmentIntegrityMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
