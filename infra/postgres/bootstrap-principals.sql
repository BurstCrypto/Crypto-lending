\set ON_ERROR_STOP on

-- Required psql variables (identifiers, never passwords):
--   database, bootstrap_role, schema_owner_role, migration_role,
--   legacy_runtime_role, api_runtime_role, worker_runtime_role,
--   balance_consumer_runtime_role, api_login_prefix, worker_login_prefix,
--   balance_consumer_login_prefix, api_login, worker_login,
--   balance_consumer_login
-- Production versioned LOGIN roles must already exist with authoritative
-- secret-managed SCRAM credentials. The explicitly dormant local balance
-- fixture may instead use PASSWORD NULL. This script never accepts, prints,
-- or stores a password.
\if :{?database}
\else
  \echo 'missing required psql variable: database'
  DO $missing_database$ BEGIN RAISE EXCEPTION 'missing required psql variable: database'; END $missing_database$;
\endif
\if :{?bootstrap_role}
\else
  \echo 'missing required psql variable: bootstrap_role'
  DO $missing_bootstrap_role$ BEGIN RAISE EXCEPTION 'missing required psql variable: bootstrap_role'; END $missing_bootstrap_role$;
\endif
\if :{?schema_owner_role}
\else
  \echo 'missing required psql variable: schema_owner_role'
  DO $missing_schema_owner_role$ BEGIN RAISE EXCEPTION 'missing required psql variable: schema_owner_role'; END $missing_schema_owner_role$;
\endif
\if :{?migration_role}
\else
  \echo 'missing required psql variable: migration_role'
  DO $missing_migration_role$ BEGIN RAISE EXCEPTION 'missing required psql variable: migration_role'; END $missing_migration_role$;
\endif
\if :{?legacy_runtime_role}
\else
  \echo 'missing required psql variable: legacy_runtime_role'
  DO $missing_legacy_runtime_role$ BEGIN RAISE EXCEPTION 'missing required psql variable: legacy_runtime_role'; END $missing_legacy_runtime_role$;
\endif
\if :{?api_runtime_role}
\else
  \echo 'missing required psql variable: api_runtime_role'
  DO $missing_api_runtime_role$ BEGIN RAISE EXCEPTION 'missing required psql variable: api_runtime_role'; END $missing_api_runtime_role$;
\endif
\if :{?worker_runtime_role}
\else
  \echo 'missing required psql variable: worker_runtime_role'
  DO $missing_worker_runtime_role$ BEGIN RAISE EXCEPTION 'missing required psql variable: worker_runtime_role'; END $missing_worker_runtime_role$;
\endif
\if :{?balance_consumer_runtime_role}
\else
  \echo 'missing required psql variable: balance_consumer_runtime_role'
  DO $missing_balance_consumer_runtime_role$ BEGIN RAISE EXCEPTION 'missing required psql variable: balance_consumer_runtime_role'; END $missing_balance_consumer_runtime_role$;
\endif
\if :{?api_login_prefix}
\else
  \echo 'missing required psql variable: api_login_prefix'
  DO $missing_api_login_prefix$ BEGIN RAISE EXCEPTION 'missing required psql variable: api_login_prefix'; END $missing_api_login_prefix$;
\endif
\if :{?worker_login_prefix}
\else
  \echo 'missing required psql variable: worker_login_prefix'
  DO $missing_worker_login_prefix$ BEGIN RAISE EXCEPTION 'missing required psql variable: worker_login_prefix'; END $missing_worker_login_prefix$;
\endif
\if :{?balance_consumer_login_prefix}
\else
  \echo 'missing required psql variable: balance_consumer_login_prefix'
  DO $missing_balance_consumer_login_prefix$ BEGIN RAISE EXCEPTION 'missing required psql variable: balance_consumer_login_prefix'; END $missing_balance_consumer_login_prefix$;
\endif
\if :{?api_login}
\else
  \echo 'missing required psql variable: api_login'
  DO $missing_api_login$ BEGIN RAISE EXCEPTION 'missing required psql variable: api_login'; END $missing_api_login$;
\endif
\if :{?worker_login}
\else
  \echo 'missing required psql variable: worker_login'
  DO $missing_worker_login$ BEGIN RAISE EXCEPTION 'missing required psql variable: worker_login'; END $missing_worker_login$;
\endif
\if :{?balance_consumer_login}
\else
  \echo 'missing required psql variable: balance_consumer_login'
  DO $missing_balance_consumer_login$ BEGIN RAISE EXCEPTION 'missing required psql variable: balance_consumer_login'; END $missing_balance_consumer_login$;
\endif

BEGIN;

SELECT :'database' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'bootstrap_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'schema_owner_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'migration_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'legacy_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'api_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'worker_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'balance_consumer_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'api_login_prefix' ~ '^[a-z][a-z0-9_]{0,29}_$'
   AND :'worker_login_prefix' ~ '^[a-z][a-z0-9_]{0,29}_$'
   AND :'balance_consumer_login_prefix' ~ '^[a-z][a-z0-9_]{0,29}_$'
   AND :'api_login' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'worker_login' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'balance_consumer_login' ~ '^[a-z][a-z0-9_]{0,62}$' AS identifiers_valid
\gset
\if :identifiers_valid
\else
  \echo 'bootstrap principal inputs must be lowercase PostgreSQL identifiers'
  ROLLBACK;
  DO $invalid_identifiers$ BEGIN
    RAISE EXCEPTION 'bootstrap principal inputs must be lowercase PostgreSQL identifiers';
  END $invalid_identifiers$;
\endif

-- Validate every authority-bearing input before the first role mutation. The
-- pairwise and prefix checks prevent an operator alias from demoting the
-- bootstrap owner or making a capability role reachable as a LOGIN slot.
SELECT current_database() = :'database'
   AND session_user = :'bootstrap_role'
   AND current_user = :'bootstrap_role'
   AND EXISTS (
     SELECT 1
     FROM pg_catalog.pg_database AS database
     INNER JOIN pg_catalog.pg_roles AS database_owner ON database_owner.oid = database.datdba
     WHERE database.datname = pg_catalog.current_database()
       AND database_owner.rolname = :'bootstrap_role'
   )
   AND (
     SELECT count(DISTINCT role_name) = 10
     FROM pg_catalog.unnest(ARRAY[
       :'bootstrap_role', :'schema_owner_role', :'migration_role', :'legacy_runtime_role',
       :'api_runtime_role', :'worker_runtime_role', :'balance_consumer_runtime_role',
       :'api_login', :'worker_login', :'balance_consumer_login'
     ]) AS supplied_role(role_name)
   )
   AND pg_catalog.left(:'api_login_prefix', pg_catalog.length(:'worker_login_prefix'))
         <> :'worker_login_prefix'
   AND pg_catalog.left(:'worker_login_prefix', pg_catalog.length(:'api_login_prefix'))
         <> :'api_login_prefix'
   AND pg_catalog.left(
         :'api_login_prefix', pg_catalog.length(:'balance_consumer_login_prefix')
       ) <> :'balance_consumer_login_prefix'
   AND pg_catalog.left(
         :'balance_consumer_login_prefix', pg_catalog.length(:'api_login_prefix')
       ) <> :'api_login_prefix'
   AND pg_catalog.left(
         :'worker_login_prefix', pg_catalog.length(:'balance_consumer_login_prefix')
       ) <> :'balance_consumer_login_prefix'
   AND pg_catalog.left(
         :'balance_consumer_login_prefix', pg_catalog.length(:'worker_login_prefix')
       ) <> :'worker_login_prefix'
   AND :'api_login' ~ ('^' || :'api_login_prefix' || '[a-z0-9]{1,32}$')
   AND :'worker_login' ~ ('^' || :'worker_login_prefix' || '[a-z0-9]{1,32}$')
   AND :'balance_consumer_login' ~ (
     '^' || :'balance_consumer_login_prefix' || '[a-z0-9]{1,32}$'
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.unnest(ARRAY[
       :'bootstrap_role', :'schema_owner_role', :'migration_role', :'legacy_runtime_role',
       :'api_runtime_role', :'worker_runtime_role', :'balance_consumer_runtime_role'
     ]) AS capability(role_name)
     WHERE role_name ~ ('^' || :'api_login_prefix' || '[a-z0-9]{1,32}$')
         OR role_name ~ ('^' || :'worker_login_prefix' || '[a-z0-9]{1,32}$')
         OR role_name ~ ('^' || :'balance_consumer_login_prefix' || '[a-z0-9]{1,32}$')
   )
   AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = :'api_login' AND rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
       AND NOT rolreplication AND NOT rolbypassrls
   )
   AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = :'worker_login' AND rolcanlogin AND NOT rolinherit
         AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    )
   AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = :'balance_consumer_login' AND rolcanlogin AND NOT rolinherit
         AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
         AND NOT rolreplication AND NOT rolbypassrls
    )
   AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = :'migration_role' AND rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles
      WHERE rolname IN (
        :'schema_owner_role', :'legacy_runtime_role',
        :'api_runtime_role', :'worker_runtime_role', :'balance_consumer_runtime_role'
      )
        AND rolcanlogin
   )
   AND (
     SELECT count(*) BETWEEN 1 AND 2
     FROM pg_catalog.pg_roles AS login_role
     WHERE pg_catalog.left(
       login_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
     ) = :'balance_consumer_login_prefix'
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles AS login_role
     WHERE pg_catalog.left(
         login_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
       ) = :'balance_consumer_login_prefix'
       AND (
         login_role.rolname !~ (
           '^' || :'balance_consumer_login_prefix' || '[a-z0-9]{1,32}$'
         )
         OR NOT login_role.rolcanlogin OR login_role.rolinherit
         OR login_role.rolsuper OR login_role.rolcreaterole OR login_role.rolcreatedb
         OR login_role.rolreplication OR login_role.rolbypassrls
       )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_auth_members AS membership
     INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
     INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
     WHERE member_role.rolname = :'balance_consumer_runtime_role'
       OR pg_catalog.left(
         granted_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
       ) = :'balance_consumer_login_prefix'
       OR (
         pg_catalog.left(
           member_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
         AND NOT (
           granted_role.rolname = :'balance_consumer_runtime_role'
           AND NOT membership.admin_option
           AND NOT membership.inherit_option
           AND membership.set_option
         )
       ) OR (
         granted_role.rolname = :'balance_consumer_runtime_role'
         AND NOT (
           member_role.rolname ~ (
             '^' || :'balance_consumer_login_prefix' || '[a-z0-9]{1,32}$'
           )
           AND NOT membership.admin_option
           AND NOT membership.inherit_option
           AND membership.set_option
         )
       )
   ) AS bootstrap_inputs_valid
\gset
\if :bootstrap_inputs_valid
\else
  \echo 'bootstrap owner, distinct principals, login prefixes, pre-provisioned restricted LOGIN roles, or committed capability NOLOGIN state do not match the reviewed contract'
  ROLLBACK;
  DO $invalid_contract$ BEGIN
    RAISE EXCEPTION 'bootstrap owner, distinct principals, login prefixes, pre-provisioned restricted LOGIN roles, or committed capability NOLOGIN state do not match the reviewed contract';
  END $invalid_contract$;
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity
  WHERE (
      usename IN (
        :'schema_owner_role', :'migration_role', :'legacy_runtime_role',
        :'api_runtime_role', :'worker_runtime_role', :'balance_consumer_runtime_role'
      )
      OR usename ~ ('^' || :'api_login_prefix' || '[a-z0-9]{1,32}$')
      OR usename ~ ('^' || :'worker_login_prefix' || '[a-z0-9]{1,32}$')
      OR pg_catalog.left(
        usename, pg_catalog.length(:'balance_consumer_login_prefix')
      ) = :'balance_consumer_login_prefix'
    )
    AND pid <> pg_catalog.pg_backend_pid()
) AS scoped_sessions_drained
\gset
\if :scoped_sessions_drained
\else
  \echo 'migration, capability, legacy, API, worker, and balance-consumer sessions must be drained and terminated first'
  ROLLBACK;
  DO $scoped_sessions_active$ BEGIN
    RAISE EXCEPTION 'migration, capability, legacy, API, worker, and balance-consumer sessions must be drained and terminated first';
  END $scoped_sessions_active$;
\endif

SELECT pg_catalog.format(
  $create_capability_roles$
  DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = %1$L) THEN
    CREATE ROLE %1$I
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = %2$L) THEN
    CREATE ROLE %2$I
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = %3$L) THEN
    CREATE ROLE %3$I
      NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = %4$L) THEN
    CREATE ROLE %4$I
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = %5$L) THEN
    CREATE ROLE %5$I
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  ALTER ROLE %2$I
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD NULL;
  ALTER ROLE %1$I
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD NULL;
  ALTER ROLE %3$I
    NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD NULL;
  ALTER ROLE %4$I
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD NULL;
  ALTER ROLE %5$I
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD NULL;
END;
$body$;
  $create_capability_roles$,
  :'schema_owner_role',
  :'legacy_runtime_role',
  :'api_runtime_role',
  :'worker_runtime_role',
  :'balance_consumer_runtime_role'
) AS bootstrap_statement
\gexec

-- The bootstrap owner temporarily receives only the owner-role membership
-- required by PostgreSQL to transfer existing application objects. It is
-- removed before commit and is forbidden by migration 0005 verification.
SELECT pg_catalog.format(
  'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
  :'schema_owner_role', :'bootstrap_role'
) AS bootstrap_statement
\gexec

SELECT pg_catalog.format('ALTER SCHEMA public OWNER TO %I', :'schema_owner_role')
  AS bootstrap_statement
\gexec

SELECT pg_catalog.set_config(
  'crypto_lending.bootstrap_schema_owner_role',
  :'schema_owner_role',
  true
);

DO $transfer_application_ownership$
DECLARE
  object record;
  schema_owner_role text := pg_catalog.current_setting(
    'crypto_lending.bootstrap_schema_owner_role'
  );
BEGIN
  FOR object IN
    SELECT class.relkind,
           pg_catalog.quote_ident(namespace.nspname) AS schema_name,
           pg_catalog.quote_ident(class.relname) AS object_name
    FROM pg_catalog.pg_class AS class
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p', 'S', 'v', 'm')
      AND class.relowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = schema_owner_role)
  LOOP
    EXECUTE CASE object.relkind
      WHEN 'S' THEN pg_catalog.format(
        'ALTER SEQUENCE %s.%s OWNER TO %I', object.schema_name, object.object_name, schema_owner_role
      )
      WHEN 'v' THEN pg_catalog.format(
        'ALTER VIEW %s.%s OWNER TO %I', object.schema_name, object.object_name, schema_owner_role
      )
      WHEN 'm' THEN pg_catalog.format(
        'ALTER MATERIALIZED VIEW %s.%s OWNER TO %I', object.schema_name, object.object_name, schema_owner_role
      )
      ELSE pg_catalog.format(
        'ALTER TABLE %s.%s OWNER TO %I', object.schema_name, object.object_name, schema_owner_role
      )
    END;
  END LOOP;

  FOR object IN
    SELECT pg_catalog.quote_ident(namespace.nspname) AS schema_name,
           pg_catalog.quote_ident(procedure.proname) AS object_name,
           pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS arguments
    FROM pg_catalog.pg_proc AS procedure
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = schema_owner_role)
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s.%s(%s) OWNER TO %I',
      object.schema_name,
      object.object_name,
      object.arguments,
      schema_owner_role
    );
  END LOOP;

  -- Relation row types follow ALTER TABLE/VIEW ownership above. Transfer every
  -- remaining standalone type/domain through its base object; PostgreSQL moves
  -- the automatically generated array type with it and rejects ALTER TYPE on
  -- the array object itself.
  FOR object IN
    SELECT pg_catalog.quote_ident(namespace.nspname) AS schema_name,
           pg_catalog.quote_ident(type_object.typname) AS object_name
    FROM pg_catalog.pg_type AS type_object
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = type_object.typnamespace
    LEFT JOIN pg_catalog.pg_class AS relation ON relation.oid = type_object.typrelid
    WHERE namespace.nspname = 'public'
      AND type_object.typowner <> (
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname = schema_owner_role
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type AS element_type
        WHERE element_type.typarray = type_object.oid
      )
      AND (type_object.typrelid = 0 OR relation.relkind = 'c')
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TYPE %s.%s OWNER TO %I',
      object.schema_name,
      object.object_name,
      schema_owner_role
    );
  END LOOP;
END;
$transfer_application_ownership$;

SELECT pg_catalog.format('REVOKE %I FROM %I', :'schema_owner_role', :'bootstrap_role')
  AS bootstrap_statement
\gexec

SELECT pg_catalog.format(
  'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
  :'schema_owner_role', :'migration_role'
) AS bootstrap_statement
\gexec
SELECT pg_catalog.format(
  'GRANT %I TO %I WITH ADMIN FALSE, INHERIT TRUE, SET FALSE',
  :'legacy_runtime_role', :'api_runtime_role'
) AS bootstrap_statement
\gexec
SELECT pg_catalog.format(
  'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
  :'api_runtime_role', :'api_login'
) AS bootstrap_statement
\gexec
SELECT pg_catalog.format(
  'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
  :'worker_runtime_role', :'worker_login'
) AS bootstrap_statement
\gexec
SELECT pg_catalog.format(
  'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
  :'balance_consumer_runtime_role', :'balance_consumer_login'
) AS bootstrap_statement
\gexec

REVOKE ALL PRIVILEGES ON DATABASE :"database" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE :"database"
  FROM :"schema_owner_role", :"legacy_runtime_role", :"api_runtime_role", :"worker_runtime_role",
       :"balance_consumer_runtime_role", :"migration_role", :"api_login", :"worker_login",
       :"balance_consumer_login";
SELECT pg_catalog.format(
  'GRANT CONNECT ON DATABASE %I TO %I, %I, %I',
  :'database', :'migration_role', :'api_login', :'worker_login'
) AS bootstrap_statement
\gexec
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;

-- The balance consumer remains dormant at this checkpoint. Bootstrap binds
-- only its stable NOLOGIN capability, exact externally credentialed rotation
-- LOGIN, while keeping database, schema, and object access denied. A later
-- coordinated migration and privileged transition own CONNECT and deliberately
-- narrow schema/function ACLs without changing immutable migration 0005.
SELECT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles
     WHERE rolname = :'balance_consumer_runtime_role'
       AND NOT rolcanlogin AND NOT rolinherit
       AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
       AND NOT rolreplication AND NOT rolbypassrls
   )
   AND EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles
     WHERE rolname = :'balance_consumer_login'
       AND rolcanlogin AND NOT rolinherit
       AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
       AND NOT rolreplication AND NOT rolbypassrls
   )
   AND (
     SELECT count(*) BETWEEN 1 AND 2
     FROM pg_catalog.pg_roles AS login_role
     WHERE pg_catalog.left(
       login_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
     ) = :'balance_consumer_login_prefix'
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles AS login_role
     WHERE pg_catalog.left(
         login_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
       ) = :'balance_consumer_login_prefix'
       AND (
         login_role.rolname !~ (
           '^' || :'balance_consumer_login_prefix' || '[a-z0-9]{1,32}$'
         )
         OR NOT login_role.rolcanlogin OR login_role.rolinherit
         OR login_role.rolsuper OR login_role.rolcreaterole OR login_role.rolcreatedb
         OR login_role.rolreplication OR login_role.rolbypassrls
       )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles AS login_role
     WHERE pg_catalog.left(
         login_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
       ) = :'balance_consumer_login_prefix'
       AND 1 <> (
         SELECT count(*)
         FROM pg_catalog.pg_auth_members AS membership
         INNER JOIN pg_catalog.pg_roles AS granted_role
           ON granted_role.oid = membership.roleid
         WHERE membership.member = login_role.oid
           AND granted_role.rolname = :'balance_consumer_runtime_role'
           AND NOT membership.admin_option
           AND NOT membership.inherit_option
           AND membership.set_option
       )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_auth_members AS membership
     INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
     INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
     WHERE member_role.rolname = :'balance_consumer_runtime_role'
       OR pg_catalog.left(
         granted_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
       ) = :'balance_consumer_login_prefix'
       OR (
         pg_catalog.left(
           member_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
         AND NOT (
           granted_role.rolname = :'balance_consumer_runtime_role'
           AND NOT membership.admin_option
           AND NOT membership.inherit_option
           AND membership.set_option
         )
       ) OR (
         granted_role.rolname = :'balance_consumer_runtime_role'
         AND NOT (
           member_role.rolname ~ (
             '^' || :'balance_consumer_login_prefix' || '[a-z0-9]{1,32}$'
           )
           AND NOT membership.admin_option
           AND NOT membership.inherit_option
           AND membership.set_option
         )
       )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles AS login_role
     WHERE pg_catalog.left(
         login_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
       ) = :'balance_consumer_login_prefix'
       AND (
         pg_catalog.has_database_privilege(
           login_role.oid, pg_catalog.current_database(), 'CONNECT'
         )
         OR pg_catalog.has_database_privilege(
           login_role.oid, pg_catalog.current_database(), 'CREATE'
         )
         OR pg_catalog.has_database_privilege(
           login_role.oid, pg_catalog.current_database(), 'TEMP'
         )
       )
   )
   AND NOT pg_catalog.has_database_privilege(
     :'balance_consumer_runtime_role', pg_catalog.current_database(), 'CONNECT'
   )
   AND NOT pg_catalog.has_database_privilege(
     :'balance_consumer_runtime_role', pg_catalog.current_database(), 'CREATE'
   )
   AND NOT pg_catalog.has_database_privilege(
     :'balance_consumer_runtime_role', pg_catalog.current_database(), 'TEMP'
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
         grantee.rolname = :'balance_consumer_runtime_role'
         OR pg_catalog.left(
           grantee.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
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
         audited_role.rolname = :'balance_consumer_runtime_role'
         OR pg_catalog.left(
           audited_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
       )
        AND (
          pg_catalog.has_database_privilege(
            audited_role.oid, other_database.oid, 'CONNECT'
          )
          OR pg_catalog.has_database_privilege(
            audited_role.oid, other_database.oid, 'CREATE'
          )
          OR pg_catalog.has_database_privilege(
            audited_role.oid, other_database.oid, 'TEMP'
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_database AS explicitly_granted_database
      CROSS JOIN LATERAL pg_catalog.aclexplode(explicitly_granted_database.datacl) AS acl
      INNER JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE explicitly_granted_database.datname <> pg_catalog.current_database()
        AND (
          grantee.rolname = :'balance_consumer_runtime_role'
          OR pg_catalog.left(
            grantee.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
          ) = :'balance_consumer_login_prefix'
        )
    )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles AS audited_role
     WHERE (
         audited_role.rolname = :'balance_consumer_runtime_role'
         OR pg_catalog.left(
           audited_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
       )
       AND (
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_database AS owned_database
           WHERE owned_database.datdba = audited_role.oid
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_namespace AS owned_namespace
           WHERE owned_namespace.nspowner = audited_role.oid
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_class AS owned_object
           WHERE owned_object.relowner = audited_role.oid
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc AS owned_procedure
           WHERE owned_procedure.proowner = audited_role.oid
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_type AS owned_type
           WHERE owned_type.typowner = audited_role.oid
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_default_acl AS owned_defaults
           WHERE owned_defaults.defaclrole = audited_role.oid
         )
       )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_namespace AS namespace
     CROSS JOIN pg_catalog.pg_roles AS audited_role
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND namespace.nspname !~ '^pg_(toast|temp)'
       AND (
         audited_role.rolname = :'balance_consumer_runtime_role'
         OR pg_catalog.left(
           audited_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
       )
       AND pg_catalog.has_schema_privilege(audited_role.oid, namespace.oid, 'USAGE,CREATE')
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_class AS object
     INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = object.relnamespace
     CROSS JOIN pg_catalog.pg_roles AS audited_role
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND namespace.nspname !~ '^pg_(toast|temp)'
       AND (
         audited_role.rolname = :'balance_consumer_runtime_role'
         OR pg_catalog.left(
           audited_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
       )
       AND (
         EXISTS (
           SELECT 1
           FROM pg_catalog.aclexplode(object.relacl) AS acl
           WHERE acl.grantee = audited_role.oid
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
           WHERE attribute.attrelid = object.oid
             AND NOT attribute.attisdropped
             AND acl.grantee = audited_role.oid
         )
       )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_proc AS procedure
     INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     CROSS JOIN pg_catalog.pg_roles AS audited_role
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND namespace.nspname !~ '^pg_(toast|temp)'
       AND (
         audited_role.rolname = :'balance_consumer_runtime_role'
         OR pg_catalog.left(
           audited_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
       )
       AND EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(procedure.proacl) AS acl
         WHERE acl.grantee = audited_role.oid
       )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_type AS type_object
     INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_object.typnamespace
     CROSS JOIN pg_catalog.pg_roles AS audited_role
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND namespace.nspname !~ '^pg_(toast|temp)'
       AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_type AS element_type
         WHERE element_type.typarray = type_object.oid
       )
       AND (
         audited_role.rolname = :'balance_consumer_runtime_role'
         OR pg_catalog.left(
           audited_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
       )
       AND EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(type_object.typacl) AS acl
         WHERE acl.grantee = audited_role.oid
       )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_default_acl AS defaults
     CROSS JOIN pg_catalog.pg_roles AS audited_role
     WHERE (
         audited_role.rolname = :'balance_consumer_runtime_role'
         OR pg_catalog.left(
           audited_role.rolname, pg_catalog.length(:'balance_consumer_login_prefix')
         ) = :'balance_consumer_login_prefix'
       )
       AND EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(defaults.defaclacl) AS acl
         WHERE acl.grantee = audited_role.oid
       )
   ) AS balance_consumer_boundary_valid
\gset
\if :balance_consumer_boundary_valid
\else
  \echo 'balance-consumer capability, exact rotation login, membership, or database boundary does not match the reviewed contract'
  ROLLBACK;
  DO $invalid_balance_consumer_boundary$ BEGIN
    RAISE EXCEPTION 'balance-consumer capability, exact rotation login, membership, or database boundary does not match the reviewed contract';
  END $invalid_balance_consumer_boundary$;
\endif

COMMIT;
