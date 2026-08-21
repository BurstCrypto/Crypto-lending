import type { DatabaseMigration } from './migration';

export interface DatabasePrincipalNames {
  bootstrapRole: string;
  schemaOwnerRole: string;
  migrationRole: string;
  apiRuntimeRole: string;
  workerRuntimeRole: string;
  apiLoginPrefix: string;
  workerLoginPrefix: string;
  legacyRuntimeRole: string;
}

export const PRODUCTION_DATABASE_PRINCIPALS: Readonly<DatabasePrincipalNames> = Object.freeze({
  bootstrapRole: 'crypto_admin',
  schemaOwnerRole: 'crypto_schema_owner',
  migrationRole: 'crypto_migration',
  apiRuntimeRole: 'crypto_api_runtime',
  workerRuntimeRole: 'crypto_worker_runtime',
  apiLoginPrefix: 'crypto_api_login_',
  workerLoginPrefix: 'crypto_worker_login_',
  legacyRuntimeRole: 'crypto_runtime',
});

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

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

/**
 * Builds the additive privilege boundary. Stable NOLOGIN roles own capabilities;
 * rotatable LOGIN slots only receive membership and can overlap during rollout.
 */
export function createDatabasePrincipalBoundaryMigration(
  names: DatabasePrincipalNames,
): DatabaseMigration {
  const owner = identifier(names.schemaOwnerRole, 'schemaOwnerRole');
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const bootstrapLiteral = literal(names.bootstrapRole, 'bootstrapRole');
  const ownerLiteral = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const migrationLiteral = literal(names.migrationRole, 'migrationRole');
  const apiLiteral = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const workerLiteral = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const apiPrefixLiteral = literal(names.apiLoginPrefix, 'apiLoginPrefix');
  const workerPrefixLiteral = literal(names.workerLoginPrefix, 'workerLoginPrefix');
  const legacyRuntimeLiteral = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');

  const roleContractExpression = `
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = ${ownerLiteral}
        AND NOT rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = ${apiLiteral}
        AND NOT rolcanlogin AND rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = ${legacyRuntimeLiteral}
        AND NOT rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = ${workerLiteral}
        AND NOT rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = ${migrationLiteral}
        AND rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity
      WHERE usename IN (
        ${ownerLiteral}, ${legacyRuntimeLiteral}, ${apiLiteral}, ${workerLiteral}
      )
        AND pid <> pg_catalog.pg_backend_pid()
    )
    AND (
      SELECT count(*) = 1
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      WHERE member_role.rolname = ${migrationLiteral}
        AND granted_role.rolname = ${ownerLiteral}
        AND NOT membership.admin_option
        AND NOT membership.inherit_option
        AND membership.set_option
    )
    AND (
      SELECT count(*) = 1
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      WHERE member_role.rolname = ${apiLiteral}
        AND granted_role.rolname = ${legacyRuntimeLiteral}
        AND NOT membership.admin_option
        AND membership.inherit_option
        AND NOT membership.set_option
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      WHERE (
        member_role.rolname IN (${ownerLiteral}, ${workerLiteral}, ${legacyRuntimeLiteral})
      ) OR (
        member_role.rolname = ${apiLiteral}
        AND granted_role.rolname <> ${legacyRuntimeLiteral}
      ) OR (
        member_role.rolname = ${migrationLiteral}
        AND granted_role.rolname <> ${ownerLiteral}
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      WHERE granted_role.rolname = ${migrationLiteral}
        OR granted_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
        OR granted_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      WHERE granted_role.rolname = ${apiLiteral}
        AND member_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      WHERE granted_role.rolname = ${workerLiteral}
        AND member_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      WHERE granted_role.rolname IN (
          ${ownerLiteral}, ${apiLiteral}, ${workerLiteral}, ${legacyRuntimeLiteral}
        )
        AND NOT (
          granted_role.rolname = ${legacyRuntimeLiteral}
          AND member_role.rolname = ${apiLiteral}
          AND NOT membership.admin_option
          AND membership.inherit_option
          AND NOT membership.set_option
        )
        AND NOT (
          granted_role.rolname = ${ownerLiteral}
          AND member_role.rolname = ${migrationLiteral}
          AND NOT membership.admin_option
          AND NOT membership.inherit_option
          AND membership.set_option
        )
        AND NOT (
          granted_role.rolname = ${apiLiteral}
          AND member_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
          AND member_role.rolcanlogin AND NOT member_role.rolinherit
          AND NOT member_role.rolsuper AND NOT member_role.rolcreaterole
          AND NOT member_role.rolcreatedb AND NOT member_role.rolreplication
          AND NOT member_role.rolbypassrls
          AND NOT membership.admin_option
          AND NOT membership.inherit_option
          AND membership.set_option
        )
        AND NOT (
          granted_role.rolname = ${workerLiteral}
          AND member_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
          AND member_role.rolcanlogin AND NOT member_role.rolinherit
          AND NOT member_role.rolsuper AND NOT member_role.rolcreaterole
          AND NOT member_role.rolcreatedb AND NOT member_role.rolreplication
          AND NOT member_role.rolbypassrls
          AND NOT membership.admin_option
          AND NOT membership.inherit_option
          AND membership.set_option
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS login_role
      WHERE login_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
        AND (
          NOT login_role.rolcanlogin OR login_role.rolinherit
          OR login_role.rolsuper OR login_role.rolcreaterole OR login_role.rolcreatedb
          OR login_role.rolreplication OR login_role.rolbypassrls
          OR 1 <> (
            SELECT count(*)
            FROM pg_catalog.pg_auth_members AS membership
            INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
            WHERE membership.member = login_role.oid
              AND granted_role.rolname = ${apiLiteral}
              AND NOT membership.admin_option
              AND NOT membership.inherit_option
              AND membership.set_option
          )
          OR 1 <> (
            SELECT count(*) FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = login_role.oid
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_database AS database
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(database.datacl, pg_catalog.acldefault('d', database.datdba))
      ) AS acl
      INNER JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE database.datname = pg_catalog.current_database()
        AND (
          grantee.rolname = ${migrationLiteral}
          OR grantee.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
          OR grantee.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
        )
        AND (acl.privilege_type <> 'CONNECT' OR acl.is_grantable)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS login_role
      WHERE login_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
        AND (
          NOT login_role.rolcanlogin OR login_role.rolinherit
          OR login_role.rolsuper OR login_role.rolcreaterole OR login_role.rolcreatedb
          OR login_role.rolreplication OR login_role.rolbypassrls
          OR 1 <> (
            SELECT count(*)
            FROM pg_catalog.pg_auth_members AS membership
            INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
            WHERE membership.member = login_role.oid
              AND granted_role.rolname = ${workerLiteral}
              AND NOT membership.admin_option
              AND NOT membership.inherit_option
              AND membership.set_option
          )
          OR 1 <> (
            SELECT count(*) FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = login_role.oid
          )
        )
    )
  `;

  const validateRolesSql = `
    DO $validate_database_principal_roles$
    BEGIN
      IF current_user <> ${ownerLiteral}
        OR session_user <> ${migrationLiteral}
      THEN
        RAISE EXCEPTION 'database migrations require the reviewed migration login and schema-owner startup role';
      END IF;
      IF NOT (${roleContractExpression}) THEN
        RAISE EXCEPTION 'database principal attributes or membership graph do not match the reviewed contract';
      END IF;
    END;
    $validate_database_principal_roles$;
  `;

  const secureDatabaseAndSchemaSql = `
    DO $secure_database_and_schema$
    DECLARE
      database_name text := pg_catalog.current_database();
      migration_schema text := pg_catalog.current_schema();
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = database.datdba
        WHERE database.datname = database_name
          AND owner_role.rolname = ${bootstrapLiteral}
      ) THEN
        RAISE EXCEPTION 'application database must remain owned by bootstrap role ${names.bootstrapRole}';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace
        INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
        WHERE namespace.nspname = migration_schema
          AND owner_role.rolname = ${ownerLiteral}
      ) OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS object
        INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = object.relowner
        WHERE object.relnamespace = pg_catalog.to_regnamespace(migration_schema)
          AND object.relkind IN ('r', 'p', 'S', 'v', 'm', 'i')
          AND owner_role.rolname <> ${ownerLiteral}
      ) OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
        WHERE procedure.pronamespace = pg_catalog.to_regnamespace(migration_schema)
          AND owner_role.rolname <> ${ownerLiteral}
      ) OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type AS type_object
        INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = type_object.typowner
        WHERE type_object.typnamespace = pg_catalog.to_regnamespace(migration_schema)
          AND owner_role.rolname <> ${ownerLiteral}
      ) THEN
        RAISE EXCEPTION 'bootstrap ownership reconciliation must complete before migration 0005';
      END IF;
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM PUBLIC, %I, %I',
        migration_schema,
        ${apiLiteral},
        ${workerLiteral}
      );
      EXECUTE pg_catalog.format(
        'GRANT USAGE ON SCHEMA %I TO %I, %I',
        migration_schema,
        ${apiLiteral},
        ${workerLiteral}
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC, %I, %I',
        migration_schema,
        ${apiLiteral},
        ${workerLiteral}
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, %I, %I',
        migration_schema,
        ${apiLiteral},
        ${workerLiteral}
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, %I, %I',
        migration_schema,
        ${apiLiteral},
        ${workerLiteral}
      );

      -- PostgreSQL has no REVOKE ... ON ALL TYPES IN SCHEMA form. Reconcile
      -- every non-array application type explicitly; array privileges follow
      -- their element type and PostgreSQL rejects direct ACL changes to them.
      DECLARE
        application_type record;
        audited_role record;
      BEGIN
        FOR application_type IN
          SELECT namespace.nspname AS schema_name, catalog_type.typname AS type_name
          FROM pg_catalog.pg_type AS catalog_type
          INNER JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = catalog_type.typnamespace
          WHERE namespace.nspname = migration_schema
            AND NOT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_type AS element_type
              WHERE element_type.typarray = catalog_type.oid
            )
        LOOP
          EXECUTE pg_catalog.format(
            'REVOKE ALL PRIVILEGES ON TYPE %I.%I FROM PUBLIC',
            application_type.schema_name,
            application_type.type_name
          );
          FOR audited_role IN
            SELECT role.rolname
            FROM pg_catalog.pg_roles AS role
            WHERE role.rolname IN (
                ${migrationLiteral}, ${legacyRuntimeLiteral}, ${apiLiteral}, ${workerLiteral}
              )
              OR role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
              OR role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
          LOOP
            EXECUTE pg_catalog.format(
              'REVOKE ALL PRIVILEGES ON TYPE %I.%I FROM %I',
              application_type.schema_name,
              application_type.type_name,
              audited_role.rolname
            );
          END LOOP;
        END LOOP;
      END;
    END;
    $secure_database_and_schema$;
  `;

  const configureDefaultsSql = `
    DO $configure_database_default_privileges$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC, %I, %I, %I',
        ${ownerLiteral}, migration_schema, ${apiLiteral}, ${workerLiteral}, ${legacyRuntimeLiteral}
      );
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC, %I, %I, %I',
        ${ownerLiteral}, migration_schema, ${apiLiteral}, ${workerLiteral}, ${legacyRuntimeLiteral}
      );
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
        ${ownerLiteral}
      );
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE USAGE ON TYPES FROM PUBLIC',
        ${ownerLiteral}
      );
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %I, %I, %I',
        ${ownerLiteral}, migration_schema, ${apiLiteral}, ${workerLiteral}, ${legacyRuntimeLiteral}
      );
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TYPES FROM %I, %I, %I',
        ${ownerLiteral}, migration_schema, ${apiLiteral}, ${workerLiteral}, ${legacyRuntimeLiteral}
      );
    END;
    $configure_database_default_privileges$;
  `;

  const verifySql = `
    SELECT (
      SELECT database_owner.rolname = ${bootstrapLiteral}
      FROM pg_catalog.pg_database AS database
      INNER JOIN pg_catalog.pg_roles AS database_owner ON database_owner.oid = database.datdba
      WHERE database.datname = pg_catalog.current_database()
    )
    AND (
      SELECT schema_owner.rolname = ${ownerLiteral}
      FROM pg_catalog.pg_namespace AS namespace
      INNER JOIN pg_catalog.pg_roles AS schema_owner ON schema_owner.oid = namespace.nspowner
      WHERE namespace.nspname = pg_catalog.current_schema()
    )
    AND (${roleContractExpression})
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_database AS database
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(database.datacl, pg_catalog.acldefault('d', database.datdba))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE database.datname = pg_catalog.current_database()
        AND (
          acl.grantee = 0
          OR NOT coalesce((
            (grantee.rolname = ${bootstrapLiteral})
            OR (
              grantee.rolname = ${migrationLiteral}
              AND acl.privilege_type = 'CONNECT'
              AND NOT acl.is_grantable
            )
            OR (
              grantee.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
              AND acl.privilege_type = 'CONNECT'
              AND NOT acl.is_grantable
            )
            OR (
              grantee.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
              AND acl.privilege_type = 'CONNECT'
              AND NOT acl.is_grantable
            )
          ), false)
        )
    )
    AND pg_catalog.has_database_privilege(${migrationLiteral}, pg_catalog.current_database(), 'CONNECT')
    AND NOT pg_catalog.has_database_privilege(${migrationLiteral}, pg_catalog.current_database(), 'CREATE,TEMP')
    AND NOT pg_catalog.has_database_privilege(${ownerLiteral}, pg_catalog.current_database(), 'CONNECT,CREATE,TEMP')
    AND NOT pg_catalog.has_database_privilege(${legacyRuntimeLiteral}, pg_catalog.current_database(), 'CONNECT,CREATE,TEMP')
    AND NOT pg_catalog.has_database_privilege(${apiLiteral}, pg_catalog.current_database(), 'CONNECT,CREATE,TEMP')
    AND NOT pg_catalog.has_database_privilege(${workerLiteral}, pg_catalog.current_database(), 'CONNECT,CREATE,TEMP')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS login_role
      WHERE login_role.rolname ~ (
        '^(' || ${apiPrefixLiteral} || '|' || ${workerPrefixLiteral} || ')[a-z0-9]{1,32}$'
      )
        AND (
          NOT pg_catalog.has_database_privilege(login_role.oid, pg_catalog.current_database(), 'CONNECT')
          OR pg_catalog.has_database_privilege(login_role.oid, pg_catalog.current_database(), 'CREATE,TEMP')
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_database AS other_database
      CROSS JOIN pg_catalog.pg_roles AS audited_role
      WHERE other_database.datname <> pg_catalog.current_database()
        AND other_database.datallowconn
        AND NOT other_database.datistemplate
        AND (
          audited_role.rolname IN (
            ${ownerLiteral}, ${migrationLiteral}, ${legacyRuntimeLiteral},
            ${apiLiteral}, ${workerLiteral}
          )
          OR audited_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
          OR audited_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
        )
        AND pg_catalog.has_database_privilege(
          audited_role.oid, other_database.oid, 'CONNECT'
        )
    )
    AND pg_catalog.has_schema_privilege(${apiLiteral}, pg_catalog.current_schema(), 'USAGE')
    AND NOT pg_catalog.has_schema_privilege(${apiLiteral}, pg_catalog.current_schema(), 'CREATE')
    AND pg_catalog.has_schema_privilege(${workerLiteral}, pg_catalog.current_schema(), 'USAGE')
    AND NOT pg_catalog.has_schema_privilege(${workerLiteral}, pg_catalog.current_schema(), 'CREATE')
    AND pg_catalog.has_schema_privilege(${legacyRuntimeLiteral}, pg_catalog.current_schema(), 'USAGE')
    AND NOT pg_catalog.has_schema_privilege(${legacyRuntimeLiteral}, pg_catalog.current_schema(), 'CREATE')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND (
          acl.grantee = 0
          OR NOT coalesce((
            (grantee.rolname = ${ownerLiteral})
            OR (
              grantee.rolname IN (${apiLiteral}, ${workerLiteral}, ${legacyRuntimeLiteral})
              AND acl.privilege_type = 'USAGE'
              AND NOT acl.is_grantable
            )
          ), false)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS login_role
      WHERE (
          login_role.rolname = ${migrationLiteral}
          OR login_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
          OR login_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
        )
        AND (
          pg_catalog.has_schema_privilege(
            login_role.oid, pg_catalog.current_schema(), 'USAGE,CREATE'
          )
          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_class AS object
            WHERE object.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
              AND pg_catalog.has_table_privilege(
                login_role.oid, object.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
          )
          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc AS procedure
            WHERE procedure.pronamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
              AND pg_catalog.has_function_privilege(login_role.oid, procedure.oid, 'EXECUTE')
          )
          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_class AS sequence
            WHERE sequence.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
              AND CASE
                WHEN sequence.relkind = 'S' THEN
                  pg_catalog.has_sequence_privilege(
                    login_role.oid, sequence.oid, 'USAGE,SELECT,UPDATE'
                  )
                ELSE false
              END
          )
          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_type AS type_object
            WHERE type_object.typnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_type AS element_type
                WHERE element_type.typarray = type_object.oid
              )
              AND pg_catalog.has_type_privilege(login_role.oid, type_object.oid, 'USAGE')
          )
        )
    )
    AND pg_catalog.has_table_privilege(${apiLiteral}, 'schema_migrations', 'SELECT')
    AND NOT pg_catalog.has_table_privilege(${apiLiteral}, 'schema_migrations', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND pg_catalog.has_table_privilege(${apiLiteral}, 'accounts', 'SELECT')
    AND NOT pg_catalog.has_table_privilege(${apiLiteral}, 'accounts', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND pg_catalog.has_table_privilege(${apiLiteral}, 'account_profiles', 'SELECT')
    AND NOT pg_catalog.has_table_privilege(${apiLiteral}, 'account_profiles', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege(${apiLiteral}, 'account_profile_audit', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege(${apiLiteral}, 'job_outbox', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND pg_catalog.has_column_privilege(${apiLiteral}, 'job_outbox', 'id', 'INSERT')
    AND pg_catalog.has_column_privilege(${apiLiteral}, 'job_outbox', 'queue_name', 'INSERT')
    AND pg_catalog.has_column_privilege(${apiLiteral}, 'job_outbox', 'payload', 'INSERT')
    AND pg_catalog.has_column_privilege(${apiLiteral}, 'job_outbox', 'message_attributes', 'INSERT')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass('job_outbox')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND attribute.attname NOT IN ('id', 'queue_name', 'payload', 'message_attributes')
        AND pg_catalog.has_column_privilege(${apiLiteral}, attribute.attrelid, attribute.attnum, 'INSERT')
    )
    AND pg_catalog.has_table_privilege(${workerLiteral}, 'schema_migrations', 'SELECT')
    AND NOT pg_catalog.has_table_privilege(${workerLiteral}, 'schema_migrations', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege(${workerLiteral}, 'accounts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege(${workerLiteral}, 'account_profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege(${workerLiteral}, 'account_profile_audit', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND pg_catalog.has_table_privilege(${workerLiteral}, 'job_outbox', 'SELECT,DELETE')
    AND NOT pg_catalog.has_table_privilege(${workerLiteral}, 'job_outbox', 'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass('job_outbox')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND (
          (
            attribute.attname IN (
              'status', 'attempts', 'available_at', 'last_error', 'locked_by',
              'locked_until', 'published_at', 'failed_at'
            )
            AND NOT pg_catalog.has_column_privilege(
              ${workerLiteral}, attribute.attrelid, attribute.attnum, 'UPDATE'
            )
          ) OR (
            attribute.attname NOT IN (
              'status', 'attempts', 'available_at', 'last_error', 'locked_by',
              'locked_until', 'published_at', 'failed_at'
            )
            AND pg_catalog.has_column_privilege(
              ${workerLiteral}, attribute.attrelid, attribute.attnum, 'UPDATE'
            )
          )
        )
    )
    AND pg_catalog.has_function_privilege(
      ${apiLiteral},
      to_regprocedure('provision_account_profile(uuid,text,text,text,uuid,text)'),
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      ${apiLiteral},
      to_regprocedure('update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)'),
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      ${workerLiteral},
      to_regprocedure('provision_account_profile(uuid,text,text,text,uuid,text)'),
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      ${workerLiteral},
      to_regprocedure('update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)'),
      'EXECUTE'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS object
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = object.relnamespace
      INNER JOIN pg_catalog.pg_roles AS object_owner ON object_owner.oid = object.relowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND object.relkind IN ('r', 'p', 'S', 'v', 'm', 'i')
        AND object_owner.rolname <> ${ownerLiteral}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND function_owner.rolname <> ${ownerLiteral}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type AS type_object
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_object.typnamespace
      INNER JOIN pg_catalog.pg_roles AS type_owner ON type_owner.oid = type_object.typowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND type_owner.rolname <> ${ownerLiteral}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS object
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = object.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(object.relacl) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND (
          acl.grantee = 0
          OR NOT coalesce((
            (grantee.rolname = ${ownerLiteral})
            OR (
              grantee.rolname = ${legacyRuntimeLiteral}
              AND object.relname IN ('accounts', 'account_profiles')
              AND acl.privilege_type = 'SELECT'
              AND NOT acl.is_grantable
            )
            OR (
              grantee.rolname = ${apiLiteral}
              AND object.relname = 'schema_migrations'
              AND acl.privilege_type = 'SELECT'
              AND NOT acl.is_grantable
            )
            OR (
              grantee.rolname = ${workerLiteral}
              AND (
                (object.relname = 'schema_migrations' AND acl.privilege_type = 'SELECT')
                OR (
                  object.relname = 'job_outbox'
                  AND acl.privilege_type IN ('SELECT', 'DELETE')
                )
              )
              AND NOT acl.is_grantable
            )
          ), false)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND (
          acl.grantee = 0
          OR NOT coalesce((
            (grantee.rolname = ${ownerLiteral})
            OR (
              grantee.rolname = ${legacyRuntimeLiteral}
              AND procedure.oid IN (
                to_regprocedure('provision_account_profile(uuid,text,text,text,uuid,text)'),
                to_regprocedure(
                  'update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)'
                )
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )
          ), false)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      INNER JOIN pg_catalog.pg_class AS object ON object.oid = attribute.attrelid
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = object.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND (
          acl.grantee = 0
          OR NOT coalesce((
            (
              grantee.rolname = ${apiLiteral}
              AND object.relname = 'job_outbox'
              AND attribute.attname IN ('id', 'queue_name', 'payload', 'message_attributes')
              AND acl.privilege_type = 'INSERT'
              AND NOT acl.is_grantable
            )
            OR (
              grantee.rolname = ${workerLiteral}
              AND object.relname = 'job_outbox'
              AND attribute.attname IN (
                'status', 'attempts', 'available_at', 'last_error', 'locked_by',
                'locked_until', 'published_at', 'failed_at'
              )
              AND acl.privilege_type = 'UPDATE'
              AND NOT acl.is_grantable
            )
          ), false)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type AS type_object
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_object.typnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(type_object.typacl) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND (
          acl.grantee = 0
          OR NOT coalesce(grantee.rolname = ${ownerLiteral}, false)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS sequence
      CROSS JOIN pg_catalog.pg_roles AS audited_role
      WHERE sequence.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND (
          audited_role.rolname IN (
            ${migrationLiteral}, ${legacyRuntimeLiteral}, ${apiLiteral}, ${workerLiteral}
          )
          OR audited_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
          OR audited_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
        )
        AND CASE
          WHEN sequence.relkind = 'S' THEN
            pg_catalog.has_sequence_privilege(
              audited_role.oid, sequence.oid, 'USAGE,SELECT,UPDATE'
            )
          ELSE false
        END
    )
    AND NOT EXISTS (
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
            ${migrationLiteral}, ${legacyRuntimeLiteral}, ${apiLiteral}, ${workerLiteral}
          )
          OR audited_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
          OR audited_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
        )
        AND pg_catalog.has_type_privilege(audited_role.oid, type_object.oid, 'USAGE')
    )
    AND (
      SELECT object.relrowsecurity AND object.relforcerowsecurity
      FROM pg_catalog.pg_class AS object
      WHERE object.oid = to_regclass('job_outbox')
    )
    AND (
      SELECT count(*) = 5
      FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = to_regclass('job_outbox')
        AND policy.polname IN (
          'job_outbox_schema_owner_all', 'job_outbox_api_insert',
          'job_outbox_worker_select', 'job_outbox_worker_update',
          'job_outbox_worker_delete'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = to_regclass('job_outbox')
        AND CASE policy.polname
          WHEN 'job_outbox_schema_owner_all' THEN NOT (
            policy.polpermissive
            AND policy.polcmd = '*'
            AND policy.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${ownerLiteral})]::oid[]
            AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
            AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true'
          )
          WHEN 'job_outbox_api_insert' THEN NOT (
            policy.polpermissive
            AND policy.polcmd = 'a'
            AND policy.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${apiLiteral})]::oid[]
            AND policy.polqual IS NULL
            AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) =
              '((status = ''pending''::text) AND (attempts = 0) AND (last_error IS NULL) AND (locked_by IS NULL) AND (locked_until IS NULL) AND (published_at IS NULL) AND (failed_at IS NULL))'
          )
          WHEN 'job_outbox_worker_select' THEN NOT (
            policy.polpermissive
            AND policy.polcmd = 'r'
            AND policy.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${workerLiteral})]::oid[]
            AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
            AND policy.polwithcheck IS NULL
          )
          WHEN 'job_outbox_worker_update' THEN NOT (
            policy.polpermissive
            AND policy.polcmd = 'w'
            AND policy.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${workerLiteral})]::oid[]
            AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) =
              '(status = ''pending''::text)'
            AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) =
              '(status = ANY (ARRAY[''pending''::text, ''published''::text, ''failed''::text]))'
          )
          WHEN 'job_outbox_worker_delete' THEN NOT (
            policy.polpermissive
            AND policy.polcmd = 'd'
            AND policy.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${workerLiteral})]::oid[]
            AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) =
              '(status = ANY (ARRAY[''published''::text, ''failed''::text]))'
            AND policy.polwithcheck IS NULL
          )
          ELSE true
        END
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
      CROSS JOIN pg_catalog.pg_roles AS audited_role
      WHERE namespace.nspname <> pg_catalog.current_schema()
        AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname !~ '^pg_(toast|temp)'
        AND (
          audited_role.rolname IN (
            ${ownerLiteral}, ${migrationLiteral}, ${legacyRuntimeLiteral},
            ${apiLiteral}, ${workerLiteral}
          )
          OR audited_role.rolname ~ ('^' || ${apiPrefixLiteral} || '[a-z0-9]{1,32}$')
          OR audited_role.rolname ~ ('^' || ${workerPrefixLiteral} || '[a-z0-9]{1,32}$')
        )
        AND (
          pg_catalog.has_schema_privilege(audited_role.oid, namespace.oid, 'USAGE,CREATE')
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class AS object
            WHERE object.relnamespace = namespace.oid
              AND CASE
                WHEN object.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
                  pg_catalog.has_table_privilege(
                    audited_role.oid,
                    object.oid,
                    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                  )
                ELSE false
              END
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class AS sequence
            WHERE sequence.relnamespace = namespace.oid
              AND CASE
                WHEN sequence.relkind = 'S' THEN
                  pg_catalog.has_sequence_privilege(
                    audited_role.oid, sequence.oid, 'USAGE,SELECT,UPDATE'
                  )
                ELSE false
              END
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc AS procedure
            WHERE procedure.pronamespace = namespace.oid
              AND pg_catalog.has_function_privilege(
                audited_role.oid, procedure.oid, 'EXECUTE'
              )
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_type AS type_object
            WHERE type_object.typnamespace = namespace.oid
              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_type AS element_type
                WHERE element_type.typarray = type_object.oid
              )
              AND pg_catalog.has_type_privilege(
                audited_role.oid, type_object.oid, 'USAGE'
              )
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_default_acl AS defaults
      LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
      WHERE defaults.defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${ownerLiteral})
        AND (
          defaults.defaclnamespace = 0
          OR namespace.nspname = pg_catalog.current_schema()
        )
        AND acl.grantee <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${ownerLiteral})
    )
    AND (
      SELECT count(*) = 2
      FROM pg_catalog.pg_default_acl AS defaults
      WHERE defaults.defaclrole = (
          SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${ownerLiteral}
        )
        AND defaults.defaclnamespace = 0
        AND defaults.defaclobjtype IN ('f', 'T')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_default_acl AS defaults
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND defaults.defaclrole <> (
          SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${ownerLiteral}
        )
    ) AS valid
  `;

  return {
    id: '0005',
    description: 'enforce database principal ownership and least privilege',
    upSql: [
      validateRolesSql,
      secureDatabaseAndSchemaSql,
      `GRANT SELECT ON TABLE schema_migrations TO ${api}, ${worker}`,
      `GRANT INSERT (id, queue_name, payload, message_attributes) ON TABLE job_outbox TO ${api}`,
      `GRANT SELECT, DELETE ON TABLE job_outbox TO ${worker}`,
      `GRANT UPDATE (
         status, attempts, available_at, last_error, locked_by, locked_until,
         published_at, failed_at
       ) ON TABLE job_outbox TO ${worker}`,
      `ALTER TABLE job_outbox ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE job_outbox FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY job_outbox_schema_owner_all ON job_outbox
         FOR ALL TO ${owner} USING (true) WITH CHECK (true)`,
      `CREATE POLICY job_outbox_api_insert ON job_outbox
         FOR INSERT TO ${api}
         WITH CHECK (
           status = 'pending' AND attempts = 0 AND last_error IS NULL
           AND locked_by IS NULL AND locked_until IS NULL
           AND published_at IS NULL AND failed_at IS NULL
         )`,
      `CREATE POLICY job_outbox_worker_select ON job_outbox
         FOR SELECT TO ${worker} USING (true)`,
      `CREATE POLICY job_outbox_worker_update ON job_outbox
         FOR UPDATE TO ${worker}
         USING (status = 'pending')
         WITH CHECK (status IN ('pending', 'published', 'failed'))`,
      `CREATE POLICY job_outbox_worker_delete ON job_outbox
         FOR DELETE TO ${worker} USING (status IN ('published', 'failed'))`,
      configureDefaultsSql,
    ],
    downSql: [
      `DROP POLICY IF EXISTS job_outbox_worker_delete ON job_outbox`,
      `DROP POLICY IF EXISTS job_outbox_worker_update ON job_outbox`,
      `DROP POLICY IF EXISTS job_outbox_worker_select ON job_outbox`,
      `DROP POLICY IF EXISTS job_outbox_api_insert ON job_outbox`,
      `DROP POLICY IF EXISTS job_outbox_schema_owner_all ON job_outbox`,
      `REVOKE ALL PRIVILEGES ON TABLE schema_migrations, accounts, account_profiles, account_profile_audit, job_outbox FROM ${api}, ${worker}`,
      `REVOKE ALL PRIVILEGES ON FUNCTION provision_account_profile(uuid, text, text, text, uuid, text) FROM ${api}, ${worker}`,
      `REVOKE ALL PRIVILEGES ON FUNCTION update_account_profile(uuid, integer, boolean, text, boolean, text, boolean, text, uuid, text) FROM ${api}, ${worker}`,
      `DO $revoke_runtime_schema_access$
       DECLARE migration_schema text := pg_catalog.current_schema();
       BEGIN
         EXECUTE pg_catalog.format(
           'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %I, %I',
           migration_schema,
           ${apiLiteral},
           ${workerLiteral}
         );
       END;
       $revoke_runtime_schema_access$;`,
    ],
    verifySql,
  };
}

export const enforceDatabasePrincipalBoundariesMigration = createDatabasePrincipalBoundaryMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
);
