import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createMainnetBalanceAgreementEvidenceMigration } from './0027-create-mainnet-balance-agreement-evidence.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const LOGIN_PREFIX = /^[a-z][a-z0-9_]{0,29}_$/u;

const READ_CHECKPOINT = 'read_balance_sync_checkpoint(uuid,uuid,text)';
const RECORD_CURRENT =
  'record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)';
const MARK_STALE =
  'mark_balance_sync_checkpoint_stale(uuid,uuid,text,bigint,timestamp with time zone,text)';
const REPLACE_AFTER_REORG =
  'replace_balance_sync_after_reorg(uuid,uuid,text,bigint,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)';
const RESOLVE_ACTIVE_ADDRESS = 'resolve_active_wallet_address_ciphertext(uuid,uuid,text)';

const SUSPENDED_WORKER_FUNCTIONS = Object.freeze([
  READ_CHECKPOINT,
  RECORD_CURRENT,
  MARK_STALE,
  REPLACE_AFTER_REORG,
  RESOLVE_ACTIVE_ADDRESS,
] as const);

export interface BalanceConsumerPrincipalNames extends DatabasePrincipalNames {
  readonly balanceConsumerRuntimeRole: string;
  readonly balanceConsumerLoginPrefix: string;
}

export const PRODUCTION_BALANCE_CONSUMER_PRINCIPALS: BalanceConsumerPrincipalNames = Object.freeze({
  ...PRODUCTION_DATABASE_PRINCIPALS,
  balanceConsumerRuntimeRole: 'crypto_balance_consumer_runtime',
  balanceConsumerLoginPrefix: 'crypto_balance_consumer_login_',
});

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

function loginPrefixLiteral(value: string): string {
  if (!LOGIN_PREFIX.test(value)) {
    throw new Error(
      'balanceConsumerLoginPrefix must be a bounded lowercase PostgreSQL role prefix',
    );
  }
  return `'${value}'`;
}

function validateBalancePrincipalNames(names: BalanceConsumerPrincipalNames): void {
  identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  loginPrefixLiteral(names.balanceConsumerLoginPrefix);
  const roles = [
    names.bootstrapRole,
    names.schemaOwnerRole,
    names.migrationRole,
    names.apiRuntimeRole,
    names.workerRuntimeRole,
    names.legacyRuntimeRole,
    names.balanceConsumerRuntimeRole,
  ];
  if (new Set(roles).size !== roles.length) {
    throw new Error('balanceConsumerRuntimeRole must be distinct from every existing principal');
  }
  for (const existingPrefix of [names.apiLoginPrefix, names.workerLoginPrefix]) {
    if (
      existingPrefix.startsWith(names.balanceConsumerLoginPrefix) ||
      names.balanceConsumerLoginPrefix.startsWith(existingPrefix)
    ) {
      throw new Error('balanceConsumerLoginPrefix must be disjoint from existing login prefixes');
    }
  }
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0028 predecessor verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function resolverAclGrantExpectation(names: DatabasePrincipalNames): string {
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  return `SELECT pg_catalog.count(*) = 1
            AND pg_catalog.bool_and(grantee.rolname = ${worker})
            AND pg_catalog.bool_and(acl.privilege_type = 'EXECUTE')
            AND pg_catalog.bool_and(NOT acl.is_grantable)
          FROM pg_catalog.pg_proc AS procedure
          INNER JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
          LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
          WHERE namespace.nspname = pg_catalog.current_schema()
            AND procedure.oid = pg_catalog.to_regprocedure('${RESOLVE_ACTIVE_ADDRESS}')
            AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))`;
}

function resolverAclDenialExpectation(names: DatabasePrincipalNames): string {
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  return `SELECT pg_catalog.count(*) = 0
          FROM pg_catalog.pg_proc AS procedure
          INNER JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
          LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
          WHERE namespace.nspname = pg_catalog.current_schema()
            AND procedure.oid = pg_catalog.to_regprocedure('${RESOLVE_ACTIVE_ADDRESS}')
            AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))`;
}

function rewritePriorVerifier(priorVerifier: string, names: DatabasePrincipalNames): string {
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  let verifier = priorVerifier;
  for (const functionIdentity of SUSPENDED_WORKER_FUNCTIONS) {
    const allowed = `pg_catalog.has_function_privilege(${worker}, '${functionIdentity}', 'EXECUTE')`;
    verifier = replaceExactlyOnce(verifier, allowed, `NOT ${allowed}`);
  }
  return replaceExactlyOnce(
    verifier,
    resolverAclGrantExpectation(names),
    resolverAclDenialExpectation(names),
  );
}

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  return SUSPENDED_WORKER_FUNCTIONS.map(
    (functionIdentity) => `REVOKE EXECUTE ON FUNCTION ${functionIdentity} FROM ${worker};`,
  ).join('\n    ');
}

function createDownSql(): string {
  return `DO $refuse_generic_worker_balance_authority_restore$
    BEGIN
      RAISE EXCEPTION
        'cannot roll back suspended generic worker balance authority because rollback would regrant an unapproved consumer capability'
        USING ERRCODE = '55000';
    END;
    $refuse_generic_worker_balance_authority_restore$;`;
}

function createWorkerAuthorityVerifier(names: DatabasePrincipalNames): string {
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  return `SELECT (
      ${SUSPENDED_WORKER_FUNCTIONS.map(
        (functionIdentity) =>
          `NOT pg_catalog.has_function_privilege(${worker}, '${functionIdentity}', 'EXECUTE')`,
      ).join('\n      AND ')}
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
        INNER JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = pg_catalog.current_schema()
          AND procedure.oid IN (
            ${SUSPENDED_WORKER_FUNCTIONS.map(
              (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
            ).join(',\n            ')}
          )
          AND grantee.rolname = ${worker}
      )
    ) AS valid`;
}

function createDormantBalancePrincipalVerifier(names: BalanceConsumerPrincipalNames): string {
  const capability = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const prefix = loginPrefixLiteral(names.balanceConsumerLoginPrefix);
  const loginNamePredicate = `pg_catalog.left(
            audited_role.rolname, pg_catalog.length(${prefix})
          ) = ${prefix}`;

  return `SELECT (
      capability.valid AND inventory.valid AND memberships.valid
      AND databases.valid AND schemas.valid AND objects.valid AND defaults.valid
    ) AS valid
    FROM (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(NOT role.rolcanlogin AND NOT role.rolinherit)
        AND pg_catalog.bool_and(
          NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
          AND NOT role.rolreplication AND NOT role.rolbypassrls
        ) AS valid
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = ${capability}
    ) AS capability
    CROSS JOIN (
      SELECT pg_catalog.count(*) BETWEEN 1 AND 2
        AND pg_catalog.bool_and(
          role.rolname ~ ('^' || ${prefix} || '[a-z0-9]{1,32}$')
          AND role.rolcanlogin AND NOT role.rolinherit
          AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
          AND NOT role.rolreplication AND NOT role.rolbypassrls
        ) AS valid
      FROM pg_catalog.pg_roles AS role
      WHERE pg_catalog.left(role.rolname, pg_catalog.length(${prefix})) = ${prefix}
    ) AS inventory
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS login_role
        WHERE pg_catalog.left(login_role.rolname, pg_catalog.length(${prefix})) = ${prefix}
          AND 1 <> (
            SELECT pg_catalog.count(*)
            FROM pg_catalog.pg_auth_members AS membership
            INNER JOIN pg_catalog.pg_roles AS granted_role
              ON granted_role.oid = membership.roleid
            WHERE membership.member = login_role.oid
              AND granted_role.rolname = ${capability}
              AND NOT membership.admin_option
              AND NOT membership.inherit_option
              AND membership.set_option
          )
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members AS membership
        INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
        INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
        WHERE member_role.rolname = ${capability}
          OR pg_catalog.left(granted_role.rolname, pg_catalog.length(${prefix})) = ${prefix}
          OR (
            pg_catalog.left(member_role.rolname, pg_catalog.length(${prefix})) = ${prefix}
            AND NOT (
              granted_role.rolname = ${capability}
              AND NOT membership.admin_option
              AND NOT membership.inherit_option
              AND membership.set_option
            )
          )
          OR (
            granted_role.rolname = ${capability}
            AND NOT (
              pg_catalog.left(member_role.rolname, pg_catalog.length(${prefix})) = ${prefix}
              AND member_role.rolname ~ ('^' || ${prefix} || '[a-z0-9]{1,32}$')
              AND NOT membership.admin_option
              AND NOT membership.inherit_option
              AND membership.set_option
            )
          )
      ) AS valid
    ) AS memberships
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        CROSS JOIN pg_catalog.pg_roles AS audited_role
        WHERE database.datallowconn AND NOT database.datistemplate
          AND (audited_role.rolname = ${capability} OR ${loginNamePredicate})
          AND (
            pg_catalog.has_database_privilege(audited_role.oid, database.oid, 'CONNECT')
            OR pg_catalog.has_database_privilege(audited_role.oid, database.oid, 'CREATE')
            OR pg_catalog.has_database_privilege(audited_role.oid, database.oid, 'TEMP')
          )
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        CROSS JOIN LATERAL pg_catalog.aclexplode(database.datacl) AS acl
        INNER JOIN pg_catalog.pg_roles AS audited_role ON audited_role.oid = acl.grantee
        WHERE audited_role.rolname = ${capability} OR ${loginNamePredicate}
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        INNER JOIN pg_catalog.pg_roles AS audited_role ON audited_role.oid = database.datdba
        WHERE audited_role.rolname = ${capability} OR ${loginNamePredicate}
      ) AS valid
    ) AS databases
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace
        CROSS JOIN pg_catalog.pg_roles AS audited_role
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname !~ '^pg_(toast|temp)'
          AND (audited_role.rolname = ${capability} OR ${loginNamePredicate})
          AND pg_catalog.has_schema_privilege(audited_role.oid, namespace.oid, 'USAGE,CREATE')
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) AS acl
        INNER JOIN pg_catalog.pg_roles AS audited_role ON audited_role.oid = acl.grantee
        WHERE audited_role.rolname = ${capability} OR ${loginNamePredicate}
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace
        INNER JOIN pg_catalog.pg_roles AS audited_role ON audited_role.oid = namespace.nspowner
        WHERE audited_role.rolname = ${capability} OR ${loginNamePredicate}
      ) AS valid
    ) AS schemas
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS object
        CROSS JOIN LATERAL pg_catalog.aclexplode(object.relacl) AS acl
        INNER JOIN pg_catalog.pg_roles AS audited_role ON audited_role.oid = acl.grantee
        WHERE audited_role.rolname = ${capability} OR ${loginNamePredicate}
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        INNER JOIN pg_catalog.pg_roles AS audited_role ON audited_role.oid = acl.grantee
        WHERE audited_role.rolname = ${capability} OR ${loginNamePredicate}
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
        INNER JOIN pg_catalog.pg_roles AS audited_role ON audited_role.oid = acl.grantee
        WHERE audited_role.rolname = ${capability} OR ${loginNamePredicate}
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type AS type_object
        CROSS JOIN LATERAL pg_catalog.aclexplode(type_object.typacl) AS acl
        INNER JOIN pg_catalog.pg_roles AS audited_role ON audited_role.oid = acl.grantee
        WHERE audited_role.rolname = ${capability} OR ${loginNamePredicate}
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS audited_role
        WHERE (audited_role.rolname = ${capability} OR ${loginNamePredicate})
          AND (
            EXISTS (SELECT 1 FROM pg_catalog.pg_class AS object WHERE object.relowner = audited_role.oid)
            OR EXISTS (
              SELECT 1 FROM pg_catalog.pg_proc AS procedure
              WHERE procedure.proowner = audited_role.oid
            )
            OR EXISTS (
              SELECT 1 FROM pg_catalog.pg_type AS type_object
              WHERE type_object.typowner = audited_role.oid
            )
          )
      ) AS valid
    ) AS objects
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_default_acl AS owned_defaults
        INNER JOIN pg_catalog.pg_roles AS default_owner
          ON default_owner.oid = owned_defaults.defaclrole
        WHERE default_owner.rolname = ${capability}
          OR pg_catalog.left(
            default_owner.rolname, pg_catalog.length(${prefix})
          ) = ${prefix}
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_default_acl AS defaults
        CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE grantee.rolname = ${capability}
          OR pg_catalog.left(grantee.rolname, pg_catalog.length(${prefix})) = ${prefix}
      ) AS valid
    ) AS defaults`;
}

function createVerifierSql(
  names: BalanceConsumerPrincipalNames,
  cumulativePrincipalVerification: boolean,
): string {
  const priorMigration = createMainnetBalanceAgreementEvidenceMigration(names, {
    cumulativePrincipalVerification,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0027 must expose verification SQL');
  const prior = rewritePriorVerifier(priorMigration.verifySql, names);
  const dormantPrincipals = cumulativePrincipalVerification
    ? createDormantBalancePrincipalVerifier(names)
    : 'SELECT true AS valid';
  return `SELECT (
      prior.valid AND worker_balance_authority.valid AND dormant_balance_principals.valid
    ) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (${createWorkerAuthorityVerifier(names)}) AS worker_balance_authority
    CROSS JOIN (${dormantPrincipals}) AS dormant_balance_principals`;
}

export function createGenericWorkerBalanceAuthoritySuspensionMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  validateBalancePrincipalNames(names);
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0028',
    description: 'suspend generic worker balance authority without activating the consumer',
    upSql: createUpSql(names),
    downSql: createDownSql(),
    verifySql: createVerifierSql(names, cumulativePrincipalVerification),
    supersedesVerificationOf: ['0027'],
  };
}

export const suspendGenericWorkerBalanceAuthorityMigrationV0028 =
  createGenericWorkerBalanceAuthoritySuspensionMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028 =
  createGenericWorkerBalanceAuthoritySuspensionMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
