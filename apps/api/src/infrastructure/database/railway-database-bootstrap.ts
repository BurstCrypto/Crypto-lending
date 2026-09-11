import type { Pool } from 'pg';

/**
 * The bootstrap runs inside the API service, whose environment carries the
 * runtime database and Redis credentials. loadMigrationDatabaseConfig is the
 * privileged migration principal and fails closed if it sees any
 * APPLICATION_WORKLOAD, DATABASE_RUNTIME_*, or REDIS_* variable, so strip them
 * before loading it. (The migration.cli step already drops these via `env -u`;
 * the bootstrap must do the same or it crashes the API preDeploy.)
 */
export function sanitizeBootstrapMigrationEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const migrationEnvironment = { ...source };
  delete migrationEnvironment.APPLICATION_WORKLOAD;
  for (const name of Object.keys(migrationEnvironment)) {
    if (name.startsWith('DATABASE_RUNTIME_') || name.startsWith('REDIS_')) {
      delete migrationEnvironment[name];
    }
  }
  return migrationEnvironment;
}

export type RailwayDatabaseWorkload = 'api' | 'worker';

export interface RailwayRuntimeDatabasePrincipal {
  readonly workload: RailwayDatabaseWorkload;
  readonly username: string;
  readonly password: string;
}

const LOGIN_BY_WORKLOAD = Object.freeze({
  api: 'crypto_api_login_railway',
  worker: 'crypto_worker_login_railway',
} as const);

const CAPABILITY_BY_WORKLOAD = Object.freeze({
  api: 'crypto_api_runtime',
  worker: 'crypto_worker_runtime',
} as const);

const RAILWAY_CAPABILITY_ROLES_SQL = `
DO $railway_roles$
DECLARE
  role_contract record;
BEGIN
  FOR role_contract IN
    SELECT * FROM (VALUES
      ('crypto_schema_owner', false, false),
      ('crypto_migration', false, false),
      ('crypto_api_runtime', false, true),
      ('crypto_worker_runtime', false, false),
      ('crypto_balance_consumer_runtime', false, false),
      ('crypto_runtime', false, false)
    ) AS expected(role_name, can_login, inherits)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_contract.role_name) THEN
      EXECUTE pg_catalog.format(
        'CREATE ROLE %I NOLOGIN %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        role_contract.role_name,
        CASE WHEN role_contract.inherits THEN 'INHERIT' ELSE 'NOINHERIT' END
      );
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = role_contract.role_name
        AND rolcanlogin = role_contract.can_login
        AND rolinherit = role_contract.inherits
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    ) THEN
      RAISE EXCEPTION 'Railway database role contract mismatch';
    END IF;
  END LOOP;
END;
$railway_roles$;

GRANT crypto_schema_owner, crypto_migration TO CURRENT_USER
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

DO $railway_memberships$
DECLARE
  membership record;
  expected boolean;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_name, member.rolname AS member_name
    FROM pg_catalog.pg_auth_members AS edge
    INNER JOIN pg_catalog.pg_roles AS granted ON granted.oid = edge.roleid
    INNER JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
    WHERE granted.rolname IN (
      'crypto_schema_owner', 'crypto_migration', 'crypto_api_runtime',
      'crypto_worker_runtime', 'crypto_balance_consumer_runtime', 'crypto_runtime'
    )
       OR member.rolname IN (
      'crypto_schema_owner', 'crypto_migration', 'crypto_api_runtime',
      'crypto_worker_runtime', 'crypto_balance_consumer_runtime', 'crypto_runtime',
      'crypto_api_login_railway', 'crypto_worker_login_railway'
    )
  LOOP
    expected :=
      (membership.member_name = current_user
        AND membership.granted_name IN ('crypto_schema_owner', 'crypto_migration'))
      OR (membership.member_name = 'crypto_api_login_railway'
        AND membership.granted_name = 'crypto_api_runtime')
      OR (membership.member_name = 'crypto_worker_login_railway'
        AND membership.granted_name = 'crypto_worker_runtime');
    IF NOT expected THEN
      EXECUTE pg_catalog.format(
        'REVOKE %I FROM %I', membership.granted_name, membership.member_name
      );
    END IF;
  END LOOP;

  EXECUTE pg_catalog.format(
    'REVOKE crypto_schema_owner, crypto_migration FROM %I', current_user
  );
  EXECUTE pg_catalog.format(
    'GRANT crypto_schema_owner, crypto_migration TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
    current_user
  );
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'crypto_api_login_railway') THEN
    REVOKE crypto_api_runtime FROM crypto_api_login_railway;
    GRANT crypto_api_runtime TO crypto_api_login_railway
      WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'crypto_worker_login_railway') THEN
    REVOKE crypto_worker_runtime FROM crypto_worker_login_railway;
    GRANT crypto_worker_runtime TO crypto_worker_login_railway
      WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS edge
    INNER JOIN pg_catalog.pg_roles AS granted ON granted.oid = edge.roleid
    INNER JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
    WHERE (
      granted.rolname IN (
        'crypto_schema_owner', 'crypto_migration', 'crypto_api_runtime',
        'crypto_worker_runtime', 'crypto_balance_consumer_runtime', 'crypto_runtime'
      )
      OR member.rolname IN (
        'crypto_schema_owner', 'crypto_migration', 'crypto_api_runtime',
        'crypto_worker_runtime', 'crypto_balance_consumer_runtime', 'crypto_runtime',
        'crypto_api_login_railway', 'crypto_worker_login_railway'
      )
    )
    AND NOT (
      (member.rolname = current_user
        AND granted.rolname IN ('crypto_schema_owner', 'crypto_migration'))
      OR (member.rolname = 'crypto_api_login_railway'
        AND granted.rolname = 'crypto_api_runtime')
      OR (member.rolname = 'crypto_worker_login_railway'
        AND granted.rolname = 'crypto_worker_runtime')
    )
  ) THEN
    RAISE EXCEPTION 'Railway database role membership contract mismatch';
  END IF;
END;
$railway_memberships$;

DO $railway_public_schema$
DECLARE
  owner_name text;
BEGIN
  SELECT owner.rolname INTO owner_name
  FROM pg_catalog.pg_namespace AS namespace
  INNER JOIN pg_catalog.pg_roles AS owner ON owner.oid = namespace.nspowner
  WHERE namespace.nspname = 'public';

  IF owner_name IS DISTINCT FROM 'crypto_schema_owner' THEN
    ALTER SCHEMA public OWNER TO crypto_schema_owner;
  END IF;
END;
$railway_public_schema$;
`;

const RAILWAY_RUNTIME_LOGIN_SQL = `
DO $railway_login$
DECLARE
  login_name text := pg_catalog.current_setting('crypto.runtime_login', true);
  login_password text := pg_catalog.current_setting('crypto.runtime_password', true);
  capability_name text := pg_catalog.current_setting('crypto.runtime_capability', true);
BEGIN
  IF login_name NOT IN ('crypto_api_login_railway', 'crypto_worker_login_railway')
     OR capability_name NOT IN ('crypto_api_runtime', 'crypto_worker_runtime')
     OR (login_name = 'crypto_api_login_railway') <> (capability_name = 'crypto_api_runtime')
     OR login_password IS NULL OR login_password = ''
  THEN
    RAISE EXCEPTION 'Invalid Railway runtime database principal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = login_name) THEN
    EXECUTE pg_catalog.format(
      'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
      login_name,
      login_password
    );
  ELSE
    EXECUTE pg_catalog.format(
      'ALTER ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
      login_name,
      login_password
    );
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE crypto_schema_owner, crypto_migration, crypto_api_runtime, crypto_worker_runtime, crypto_balance_consumer_runtime, crypto_runtime FROM %I',
    login_name
  );
  EXECUTE pg_catalog.format(
    'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
    capability_name,
    login_name
  );
END;
$railway_login$;
`;

function validatePrincipal(principal: RailwayRuntimeDatabasePrincipal): void {
  if (principal.username !== LOGIN_BY_WORKLOAD[principal.workload]) {
    throw new Error(
      `Railway ${principal.workload} database username does not match its fixed login`,
    );
  }
  if (!principal.password || !principal.password.trim() || /[\0\r\n]/u.test(principal.password)) {
    throw new Error('Railway runtime database password is invalid');
  }
}

/** Creates/rotates one login and grants only its own NOLOGIN capability. */
export async function bootstrapRailwayDatabase(
  pool: Pick<Pool, 'query'>,
  principal: RailwayRuntimeDatabasePrincipal,
): Promise<void> {
  validatePrincipal(principal);
  await pool.query('BEGIN');
  try {
    await pool.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crypto-lending:railway-bootstrap:v1', 0))`,
    );
    await pool.query(RAILWAY_CAPABILITY_ROLES_SQL);
    await pool.query(
      `SELECT
         pg_catalog.set_config('crypto.runtime_login', $1, true),
         pg_catalog.set_config('crypto.runtime_password', $2, true),
         pg_catalog.set_config('crypto.runtime_capability', $3, true)`,
      [principal.username, principal.password, CAPABILITY_BY_WORKLOAD[principal.workload]],
    );
    await pool.query(RAILWAY_RUNTIME_LOGIN_SQL);
    await pool.query('COMMIT');
  } catch (error) {
    try {
      await pool.query('ROLLBACK');
    } catch {
      // Preserve the original bootstrap failure.
    }
    throw error;
  }
}
