\set ON_ERROR_STOP on

-- Required psql variables (identifiers, never passwords):
--   database, bootstrap_role, schema_owner_role, migration_role,
--   legacy_runtime_role, api_runtime_role, worker_runtime_role,
--   api_login_prefix, worker_login_prefix, api_login, worker_login
-- The versioned LOGIN roles must already exist with synthetic/local or
-- authoritative secret-managed SCRAM credentials. This script never accepts,
-- prints, or stores a password.
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

BEGIN;

SELECT :'database' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'bootstrap_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'schema_owner_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'migration_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'legacy_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'api_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'worker_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'api_login_prefix' ~ '^[a-z][a-z0-9_]{0,29}_$'
   AND :'worker_login_prefix' ~ '^[a-z][a-z0-9_]{0,29}_$'
   AND :'api_login' ~ '^[a-z][a-z0-9_]{0,62}$'
   AND :'worker_login' ~ '^[a-z][a-z0-9_]{0,62}$' AS identifiers_valid
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
     SELECT count(DISTINCT role_name) = 8
     FROM pg_catalog.unnest(ARRAY[
       :'bootstrap_role', :'schema_owner_role', :'migration_role', :'legacy_runtime_role',
       :'api_runtime_role', :'worker_runtime_role', :'api_login', :'worker_login'
     ]) AS supplied_role(role_name)
   )
   AND pg_catalog.left(:'api_login_prefix', pg_catalog.length(:'worker_login_prefix'))
         <> :'worker_login_prefix'
   AND pg_catalog.left(:'worker_login_prefix', pg_catalog.length(:'api_login_prefix'))
         <> :'api_login_prefix'
   AND :'api_login' ~ ('^' || :'api_login_prefix' || '[a-z0-9]{1,32}$')
   AND :'worker_login' ~ ('^' || :'worker_login_prefix' || '[a-z0-9]{1,32}$')
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.unnest(ARRAY[
       :'bootstrap_role', :'schema_owner_role', :'migration_role', :'legacy_runtime_role',
       :'api_runtime_role', :'worker_runtime_role'
     ]) AS capability(role_name)
     WHERE role_name ~ ('^' || :'api_login_prefix' || '[a-z0-9]{1,32}$')
        OR role_name ~ ('^' || :'worker_login_prefix' || '[a-z0-9]{1,32}$')
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
      WHERE rolname = :'migration_role' AND rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    )
   AND NOT EXISTS (
     SELECT 1
     FROM pg_catalog.pg_roles
     WHERE rolname IN (
       :'schema_owner_role', :'legacy_runtime_role',
       :'api_runtime_role', :'worker_runtime_role'
     )
       AND rolcanlogin
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
        :'api_runtime_role', :'worker_runtime_role'
      )
      OR usename ~ ('^' || :'api_login_prefix' || '[a-z0-9]{1,32}$')
      OR usename ~ ('^' || :'worker_login_prefix' || '[a-z0-9]{1,32}$')
    )
    AND pid <> pg_catalog.pg_backend_pid()
) AS scoped_sessions_drained
\gset
\if :scoped_sessions_drained
\else
  \echo 'migration, capability, legacy, API, and worker sessions must be drained and terminated first'
  ROLLBACK;
  DO $scoped_sessions_active$ BEGIN
    RAISE EXCEPTION 'migration, capability, legacy, API, and worker sessions must be drained and terminated first';
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
END;
$body$;
  $create_capability_roles$,
  :'schema_owner_role',
  :'legacy_runtime_role',
  :'api_runtime_role',
  :'worker_runtime_role'
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

REVOKE ALL PRIVILEGES ON DATABASE :"database" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE :"database"
  FROM :"schema_owner_role", :"legacy_runtime_role", :"api_runtime_role", :"worker_runtime_role",
       :"migration_role", :"api_login", :"worker_login";
SELECT pg_catalog.format(
  'GRANT CONNECT ON DATABASE %I TO %I, %I, %I',
  :'database', :'migration_role', :'api_login', :'worker_login'
) AS bootstrap_statement
\gexec
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;

COMMIT;
