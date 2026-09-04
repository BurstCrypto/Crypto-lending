import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createAuthenticationHmacKeyRotationMigration } from './0025-create-authentication-hmac-key-rotation.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

const DEPEG_READ = 'read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint)';
const DEPEG_RECORD =
  'record_stablecoin_depeg_latch(bigint,uuid,text,text,smallint,text,text,text,smallint,timestamp with time zone,text,text,text,text,text)';
const DEPEG_CLEAR =
  'clear_stablecoin_depeg_latch(uuid,text,smallint,text,text,text,smallint,text,text,timestamp with time zone,bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,text,text,text)';
const PRICE_READ =
  'read_stablecoin_price_evidence(text,smallint,text,text,text,text,smallint,timestamp with time zone)';
const PRICE_RECORD =
  'record_stablecoin_price_evidence(uuid,text,text,timestamp with time zone,text,text,text,smallint,text,text,text,text,smallint,text,text,numeric,text,timestamp with time zone,timestamp with time zone,numeric,smallint,text,numeric,smallint,text,text,text)';

const READ_FUNCTIONS = Object.freeze([DEPEG_READ, PRICE_READ] as const);
const MUTATION_FUNCTIONS = Object.freeze([DEPEG_RECORD, DEPEG_CLEAR, PRICE_RECORD] as const);
const ALL_FUNCTIONS = Object.freeze([...READ_FUNCTIONS, ...MUTATION_FUNCTIONS] as const);
const GUARDED_TABLES = Object.freeze([
  'stablecoin_depeg_latch_events',
  'stablecoin_depeg_latch_projections',
  'stablecoin_price_source_registry',
  'stablecoin_price_evidence',
  'stablecoin_price_observations',
  'stablecoin_price_watermark_events',
  'stablecoin_price_source_watermarks',
] as const);

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
    throw new Error('Migration 0026 verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function revokeAll(functionIdentity: string, roles: string): string {
  return `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${roles};`;
}

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${migration}`;

  return `${ALL_FUNCTIONS.map((functionIdentity) => revokeAll(functionIdentity, guardedRoles)).join(
    '\n    ',
  )}
    GRANT EXECUTE ON FUNCTION ${DEPEG_READ} TO ${api};
    GRANT EXECUTE ON FUNCTION ${PRICE_READ} TO ${api};`;
}

function createDownSql(): string {
  return `DO $refuse_stablecoin_ingestion_authority_regrant$
    BEGIN
      RAISE EXCEPTION
        'cannot roll back suspended stablecoin ingestion authority because rollback would regrant unapproved mutation capability'
        USING ERRCODE = '55000';
    END;
    $refuse_stablecoin_ingestion_authority_regrant$;`;
}

function denyPriorRuntimeMutationExpectations(
  priorVerifier: string,
  names: DatabasePrincipalNames,
): string {
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  let verifier = priorVerifier;
  for (const functionIdentity of [DEPEG_READ, DEPEG_RECORD, PRICE_RECORD]) {
    const allowed = `pg_catalog.has_function_privilege(${worker}, '${functionIdentity}', 'EXECUTE')`;
    verifier = replaceExactlyOnce(verifier, allowed, `NOT ${allowed}`);
  }
  return verifier;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createAuthenticationHmacKeyRotationMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0025 must expose verification SQL');

  const prior = denyPriorRuntimeMutationExpectations(priorMigration.verifySql, names);
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const guardedRoles = [api, worker, legacy, migration, "'public'"] as const;

  return `SELECT (prior.valid AND function_privileges.valid AND direct_objects.valid) AS valid
  FROM (${prior}) AS prior
  CROSS JOIN (
    SELECT (
      ${READ_FUNCTIONS.map(
        (functionIdentity) =>
          `pg_catalog.has_function_privilege(${api}, '${functionIdentity}', 'EXECUTE')`,
      ).join('\n      AND ')}
      AND ${guardedRoles
        .filter((role) => role !== api)
        .flatMap((role) =>
          READ_FUNCTIONS.map(
            (functionIdentity) =>
              `NOT pg_catalog.has_function_privilege(${role}, '${functionIdentity}', 'EXECUTE')`,
          ),
        )
        .join('\n      AND ')}
      AND ${guardedRoles
        .flatMap((role) =>
          MUTATION_FUNCTIONS.map(
            (functionIdentity) =>
              `NOT pg_catalog.has_function_privilege(${role}, '${functionIdentity}', 'EXECUTE')`,
          ),
        )
        .join('\n      AND ')}
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
        ) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = pg_catalog.current_schema()
          AND procedure.oid IN (
            ${ALL_FUNCTIONS.map(
              (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
            ).join(',\n            ')}
          )
          AND NOT (
            acl.privilege_type = 'EXECUTE'
            AND (
              acl.grantee = procedure.proowner
              OR (
                grantee.rolname = ${api}
                AND NOT acl.is_grantable
                AND procedure.oid IN (
                  ${READ_FUNCTIONS.map(
                    (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
                  ).join(',\n                  ')}
                )
              )
            )
          )
      )
    ) AS valid
  ) AS function_privileges
  CROSS JOIN (
    SELECT NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault(
            CASE relation.relkind WHEN 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
            relation.relowner
          )
        )
      ) AS acl
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND (
          relation.relname IN (${GUARDED_TABLES.map((table) => `'${table}'`).join(', ')})
          OR (relation.relkind = 'S' AND relation.relname LIKE 'stablecoin\\_%' ESCAPE '\\')
        )
        AND acl.grantee <> relation.relowner
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type AS guarded_type
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = guarded_type.typnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(guarded_type.typacl, pg_catalog.acldefault('T', guarded_type.typowner))
      ) AS acl
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND guarded_type.typname IN (${GUARDED_TABLES.map((table) => `'${table}'`).join(', ')})
        AND acl.grantee <> guarded_type.typowner
    ) AS valid
  ) AS direct_objects`;
}

export function createStablecoinIngestionAuthoritySuspensionMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0026',
    description: 'suspend unapproved stablecoin ingestion mutation authority',
    upSql: createUpSql(names),
    downSql: createDownSql(),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0025'],
  };
}

export const suspendStablecoinIngestionAuthorityMigrationV0026 =
  createStablecoinIngestionAuthoritySuspensionMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026 =
  createStablecoinIngestionAuthoritySuspensionMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
