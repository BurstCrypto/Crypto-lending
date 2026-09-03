import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { createMigrationPool } from '../../src/infrastructure/database/migration-pool';
import {
  createActiveWalletRegistrationListMigration,
  createAuthenticationSessionsMigration,
  createDatabasePrincipalBoundaryMigration,
  createImmutableLedgerMigration,
  createLedgerCommandIdempotencyMigration,
  createLedgerFeeAdjustmentIntegrityMigration,
  createLedgerLifecycleMigration,
  createWalletOwnershipRegistrationMigration,
  createYieldOperationControlsMigration,
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
  type DatabaseMigration,
  type DatabasePrincipalNames,
} from '../../src/infrastructure/database/migrations';
import { createPostgresPool } from '../../src/infrastructure/database/postgres.module';
import { testInfrastructureConfig } from './fixtures';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function roleUrl(baseUrl: string, database: string, role: string, password: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function schemaMigrationsForIsolatedLegacyRole(
  legacyRuntimeRole: string,
): readonly DatabaseMigration[] {
  if (!IDENTIFIER.test(legacyRuntimeRole)) {
    throw new Error(`Unsafe isolated legacy role: ${legacyRuntimeRole}`);
  }
  const rewrite = (sql: string | readonly string[]): string | readonly string[] =>
    typeof sql === 'string'
      ? sql.replaceAll('crypto_runtime', legacyRuntimeRole)
      : sql.map((statement) => statement.replaceAll('crypto_runtime', legacyRuntimeRole));

  // Migration 0004 is immutable in production. Its role literal is replaced
  // only inside this isolated test database so the suite never mutates the
  // cluster-global canonical crypto_runtime compatibility bridge.
  return DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
    ({ id }) =>
      id !== '0007' &&
      id !== '0008' &&
      id !== '0009' &&
      id !== '0010' &&
      id !== '0011' &&
      id !== '0012' &&
      id !== '0013' &&
      id !== '0014' &&
      id !== '0015',
  ).map((migration) =>
    migration.id === '0004'
      ? {
          ...migration,
          upSql: rewrite(migration.upSql),
          downSql: rewrite(migration.downSql),
          ...(migration.verifySql
            ? { verifySql: migration.verifySql.replaceAll('crypto_runtime', legacyRuntimeRole) }
            : {}),
        }
      : migration,
  );
}

async function expectPostgresDenied(
  operation: Promise<unknown>,
  acceptedCodes: readonly string[],
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(acceptedCodes).toContain((error as { code?: string }).code);
    return;
  }
  throw new Error('Expected PostgreSQL to deny the operation');
}

const repositoryRoot = resolve(__dirname, '..', '..', '..', '..');
const bootstrapPath = resolve(repositoryRoot, 'infra', 'postgres', 'bootstrap-principals.sql');

async function runBootstrapArtifact(
  database: string,
  names: DatabasePrincipalNames,
  apiLogin: string,
  workerLogin: string,
): Promise<void> {
  const bootstrapSql = await readFile(bootstrapPath, 'utf8');
  const composeFile = resolve(repositoryRoot, 'docker-compose.yml');
  const psqlVariables: Readonly<Record<string, string>> = {
    database,
    bootstrap_role: names.bootstrapRole,
    schema_owner_role: names.schemaOwnerRole,
    migration_role: names.migrationRole,
    legacy_runtime_role: names.legacyRuntimeRole,
    api_runtime_role: names.apiRuntimeRole,
    worker_runtime_role: names.workerRuntimeRole,
    api_login_prefix: names.apiLoginPrefix,
    worker_login_prefix: names.workerLoginPrefix,
    api_login: apiLogin,
    worker_login: workerLogin,
  };
  for (const value of Object.values(psqlVariables)) {
    if (!IDENTIFIER.test(value)) throw new Error(`Unsafe bootstrap variable: ${value}`);
  }

  const variableArgs = Object.entries(psqlVariables).flatMap(([name, value]) => [
    '--set',
    `${name}=${value}`,
  ]);
  const args = [
    'compose',
    '--project-directory',
    repositoryRoot,
    '--file',
    composeFile,
    'exec',
    '--no-TTY',
    'postgres',
    'psql',
    '--no-psqlrc',
    '--username',
    names.bootstrapRole,
    '--dbname',
    database,
    '--set',
    'ON_ERROR_STOP=1',
    ...variableArgs,
  ];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('docker', args, {
      cwd: repositoryRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', rejectPromise);
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') rejectPromise(error);
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else {
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ');
        rejectPromise(new Error(`PostgreSQL bootstrap artifact failed: ${detail}`));
      }
    });
    child.stdin.end(bootstrapSql);
  });
}

describeWithPostgres('KAN-232 PostgreSQL principal boundary', () => {
  jest.setTimeout(90_000);

  it('enforces ownership, least privilege, migration control, and rotation revocation', async () => {
    const adminUrl = new URL(testDatabaseUrl as string);
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(adminUrl.hostname.toLowerCase())) {
      throw new Error('KAN-232 principal integration test requires a loopback PostgreSQL URL');
    }
    const bootstrapRole = decodeURIComponent(adminUrl.username);
    if (!IDENTIFIER.test(bootstrapRole)) {
      throw new Error('TEST_DATABASE_URL must use a lowercase PostgreSQL bootstrap role');
    }

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const database = `k232_db_${suffix}`;
    const deniedDatabase = `k232_denied_${suffix}`;
    const names: DatabasePrincipalNames = {
      bootstrapRole,
      schemaOwnerRole: `k232_owner_${suffix}`,
      migrationRole: `k232_migrate_${suffix}`,
      apiRuntimeRole: `k232_api_cap_${suffix}`,
      workerRuntimeRole: `k232_worker_cap_${suffix}`,
      apiLoginPrefix: `k232_api_${suffix}_`,
      workerLoginPrefix: `k232_worker_${suffix}_`,
      legacyRuntimeRole: `k232_legacy_${suffix}`,
    };
    const apiOld = `${names.apiLoginPrefix}a`;
    const apiNew = `${names.apiLoginPrefix}b`;
    const workerLogin = `${names.workerLoginPrefix}a`;
    const workerNew = `${names.workerLoginPrefix}b`;
    const outsider = `k232_outsider_${suffix}`;
    const migrationPassword = randomBytes(24).toString('hex');
    const migrationNewPassword = randomBytes(24).toString('hex');
    const schemaOwnerPassword = randomBytes(24).toString('hex');
    const legacyPassword = randomBytes(24).toString('hex');
    const apiOldPassword = randomBytes(24).toString('hex');
    const apiNewPassword = randomBytes(24).toString('hex');
    const workerPassword = randomBytes(24).toString('hex');
    const workerNewPassword = randomBytes(24).toString('hex');
    const outsiderPassword = randomBytes(24).toString('hex');
    const createdRoles: string[] = [];
    const schemaMigrations = schemaMigrationsForIsolatedLegacyRole(names.legacyRuntimeRole);
    const lastErrorConstraintMigration = schemaMigrations.find(({ id }) => id === '0006');
    if (!lastErrorConstraintMigration) {
      throw new Error('Schema migration list must include migration 0006');
    }
    const schemaMigrationsBeforePrincipalBoundary = schemaMigrations.filter(
      ({ id }) => id !== '0006',
    );
    const admin = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    let legacyPool: Pool | undefined;
    let databaseAdmin: Pool | undefined;
    let migrationPool: Pool | undefined;
    let apiPool: Pool | undefined;
    let workerPool: Pool | undefined;
    let workerNewPool: Pool | undefined;
    let apiNewPool: Pool | undefined;
    const infrastructureFixture = testInfrastructureConfig();
    const runtimePool = (workload: 'api' | 'worker', connectionString: string, max = 1): Pool =>
      createPostgresPool(
        {
          ...infrastructureFixture,
          workload,
          database: {
            ...infrastructureFixture.database,
            connectionString,
            poolMax: max,
            sessionRole: workload === 'api' ? names.apiRuntimeRole : names.workerRuntimeRole,
          },
        },
        { api: names.apiRuntimeRole, worker: names.workerRuntimeRole },
      );
    const migrationPrincipalPool = (connectionString: string): Pool =>
      createMigrationPool(
        {
          ...infrastructureFixture.database,
          connectionString,
          poolMax: 1,
          sessionRole: names.schemaOwnerRole,
        },
        names.schemaOwnerRole,
      );

    const createRole = async (
      role: string,
      attributes: string,
      password?: string,
    ): Promise<void> => {
      await admin.query(
        `CREATE ROLE ${quoteIdentifier(role)} ${attributes}${
          password ? ` PASSWORD ${quoteLiteral(password)}` : ''
        }`,
      );
      createdRoles.push(role);
    };
    const grantSetMembership = async (capability: string, login: string): Promise<void> => {
      await admin.query(
        `GRANT ${quoteIdentifier(capability)} TO ${quoteIdentifier(login)}
         WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
      );
    };
    const grantDatabaseConnect = async (role: string): Promise<void> => {
      await admin.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(database)} TO ${quoteIdentifier(role)}`,
      );
    };
    const terminateExactSessions = async (role: string): Promise<void> => {
      await admin.query(
        `SELECT pg_catalog.pg_terminate_backend(pid)
         FROM pg_catalog.pg_stat_activity
         WHERE usename = $1 AND pid <> pg_catalog.pg_backend_pid()`,
        [role],
      );
    };

    try {
      const fixtureIdentity = await admin.query<{
        database: string;
        bootstrap_role: string;
        marker: string | null;
      }>(
        `SELECT pg_catalog.current_database() AS database,
                session_user AS bootstrap_role,
                pg_catalog.current_setting(
                  'crypto_lending.local_principal_fixture', true
                ) AS marker`,
      );
      assertLocalPrincipalFixture({
        database: fixtureIdentity.rows[0]?.database ?? '',
        bootstrapRole: fixtureIdentity.rows[0]?.bootstrap_role ?? '',
        marker: fixtureIdentity.rows[0]?.marker ?? null,
      });

      await createRole(
        names.legacyRuntimeRole,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        legacyPassword,
      );
      await createRole(
        names.migrationRole,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        migrationPassword,
      );
      await createRole(
        apiOld,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        apiOldPassword,
      );
      await createRole(
        workerLogin,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        workerPassword,
      );
      await createRole(
        outsider,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        outsiderPassword,
      );
      await admin.query(
        `CREATE DATABASE ${quoteIdentifier(database)} OWNER ${quoteIdentifier(bootstrapRole)}`,
      );
      await admin.query(
        `CREATE DATABASE ${quoteIdentifier(deniedDatabase)} OWNER ${quoteIdentifier(bootstrapRole)}`,
      );
      await admin.query(`REVOKE ALL ON DATABASE ${quoteIdentifier(deniedDatabase)} FROM PUBLIC`);
      databaseAdmin = new Pool({
        connectionString: roleUrl(
          testDatabaseUrl as string,
          database,
          bootstrapRole,
          adminUrl.password,
        ),
        max: 1,
      });
      try {
        const legacyRunner = new MigrationRunner(databaseAdmin, schemaMigrations);
        await expect(legacyRunner.up()).resolves.toEqual(['0001', '0002', '0003', '0004', '0006']);
        await expect(legacyRunner.assertUpToDate()).resolves.toBeUndefined();
        await databaseAdmin.query("CREATE TYPE bootstrap_owned_enum AS ENUM ('safe')");
        await databaseAdmin.query(
          "CREATE DOMAIN bootstrap_owned_domain AS text CHECK (VALUE <> '')",
        );
        await databaseAdmin.query(
          `CREATE SCHEMA private_admin AUTHORIZATION ${quoteIdentifier(bootstrapRole)}`,
        );
        await databaseAdmin.query('REVOKE ALL ON SCHEMA private_admin FROM PUBLIC');
        await databaseAdmin.query('CREATE TABLE private_admin.break_glass(value text)');
        await databaseAdmin.query("CREATE TYPE private_admin.break_glass_enum AS ENUM ('safe')");
        await databaseAdmin.query(
          'REVOKE ALL ON TYPE private_admin.break_glass, private_admin.break_glass_enum FROM PUBLIC',
        );
      } finally {
        await databaseAdmin.end();
        databaseAdmin = undefined;
      }

      const bootstrapBeforeAliasProbe = await admin.query(
        `SELECT rolcanlogin, rolpassword
         FROM pg_catalog.pg_authid WHERE rolname = $1`,
        [bootstrapRole],
      );
      await expect(
        runBootstrapArtifact(
          database,
          { ...names, apiRuntimeRole: bootstrapRole },
          apiOld,
          workerLogin,
        ),
      ).rejects.toThrow('do not match the reviewed contract');
      await expect(
        admin.query(
          `SELECT rolcanlogin, rolpassword
           FROM pg_catalog.pg_authid WHERE rolname = $1`,
          [bootstrapRole],
        ),
      ).resolves.toMatchObject({ rows: bootstrapBeforeAliasProbe.rows });
      await expect(
        admin.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1
           ) AS capability_created`,
          [names.schemaOwnerRole],
        ),
      ).resolves.toMatchObject({ rows: [{ capability_created: false }] });

      await admin.query(`ALTER ROLE ${quoteIdentifier(names.migrationRole)} NOLOGIN`);
      await expect(runBootstrapArtifact(database, names, apiOld, workerLogin)).rejects.toThrow(
        'pre-provisioned restricted LOGIN roles',
      );
      await admin.query(`ALTER ROLE ${quoteIdentifier(names.migrationRole)} LOGIN`);

      await createRole(
        names.schemaOwnerRole,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      );
      await expect(runBootstrapArtifact(database, names, apiOld, workerLogin)).rejects.toThrow(
        'committed capability NOLOGIN state',
      );
      await expect(
        admin.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1
           ) AS capability_created`,
          [names.apiRuntimeRole],
        ),
      ).resolves.toMatchObject({ rows: [{ capability_created: false }] });
      await admin.query(`ALTER ROLE ${quoteIdentifier(names.schemaOwnerRole)} NOLOGIN`);

      const legacyUrl = roleUrl(
        testDatabaseUrl as string,
        database,
        names.legacyRuntimeRole,
        legacyPassword,
      );
      legacyPool = new Pool({ connectionString: legacyUrl, max: 1 });
      legacyPool.on('error', () => undefined);
      const activeLegacyClient = await legacyPool.connect();
      activeLegacyClient.on('error', () => undefined);
      await expect(
        activeLegacyClient.query('SELECT count(*) FROM accounts'),
      ).resolves.toBeDefined();
      await admin.query(`ALTER ROLE ${quoteIdentifier(names.legacyRuntimeRole)} NOLOGIN`);
      await expect(
        activeLegacyClient.query('SELECT count(*) FROM accounts'),
      ).resolves.toBeDefined();
      await expect(runBootstrapArtifact(database, names, apiOld, workerLogin)).rejects.toThrow(
        'migration, capability, legacy, API, and worker sessions must be drained and terminated first',
      );
      await terminateExactSessions(names.legacyRuntimeRole);
      await expect(activeLegacyClient.query('SELECT 1')).rejects.toBeDefined();
      activeLegacyClient.release(true);
      await legacyPool.end().catch(() => undefined);
      legacyPool = undefined;
      const retiredLegacyPool = new Pool({ connectionString: legacyUrl, max: 1 });
      await expect(retiredLegacyPool.query('SELECT 1')).rejects.toBeDefined();
      await retiredLegacyPool.end().catch(() => undefined);
      await runBootstrapArtifact(database, names, apiOld, workerLogin);
      createdRoles.push(names.apiRuntimeRole, names.workerRuntimeRole);
      await expect(
        admin.query<{ password_retired: boolean }>(
          `SELECT rolpassword IS NULL AS password_retired
           FROM pg_catalog.pg_authid WHERE rolname = $1`,
          [names.legacyRuntimeRole],
        ),
      ).resolves.toMatchObject({ rows: [{ password_retired: true }] });

      const migrationUrl = roleUrl(
        testDatabaseUrl as string,
        database,
        names.migrationRole,
        migrationPassword,
      );
      migrationPool = migrationPrincipalPool(migrationUrl);
      const principalMigration = createDatabasePrincipalBoundaryMigration(names);
      const ledgerMigration = createImmutableLedgerMigration(names);
      const lifecycleMigration = createLedgerLifecycleMigration(names);
      const idempotencyMigration = createLedgerCommandIdempotencyMigration(names);
      const authenticationMigration = createAuthenticationSessionsMigration(names);
      const walletRegistrationMigration = createWalletOwnershipRegistrationMigration(names);
      const yieldOperationMigration = createYieldOperationControlsMigration(names);
      const feeAdjustmentIntegrityMigration = createLedgerFeeAdjustmentIntegrityMigration(names);
      const activeWalletListMigration = createActiveWalletRegistrationListMigration(names);
      if (!principalMigration.verifySql) throw new Error('Principal migration must be verifiable');
      if (!ledgerMigration.verifySql) throw new Error('Ledger migration must be verifiable');
      if (!lifecycleMigration.verifySql) {
        throw new Error('Lifecycle migration must be verifiable');
      }
      if (!idempotencyMigration.verifySql) {
        throw new Error('Idempotency migration must be verifiable');
      }
      if (!authenticationMigration.verifySql) {
        throw new Error('Authentication migration must be verifiable');
      }
      if (!walletRegistrationMigration.verifySql) {
        throw new Error('Wallet registration migration must be verifiable');
      }
      if (!yieldOperationMigration.verifySql) {
        throw new Error('Yield operation migration must be verifiable');
      }
      if (!feeAdjustmentIntegrityMigration.verifySql) {
        throw new Error('Fee adjustment integrity migration must be verifiable');
      }
      if (!activeWalletListMigration.verifySql) {
        throw new Error('Active wallet list migration must be verifiable');
      }
      const cumulativeVerifySql = activeWalletListMigration.verifySql;
      const migrations = [
        ...schemaMigrationsBeforePrincipalBoundary,
        principalMigration,
        lastErrorConstraintMigration,
        ledgerMigration,
        lifecycleMigration,
        idempotencyMigration,
        authenticationMigration,
        walletRegistrationMigration,
        yieldOperationMigration,
        feeAdjustmentIntegrityMigration,
        activeWalletListMigration,
      ];
      const migrationsThrough0012 = migrations.filter(({ id }) => id !== '0013' && id !== '0014');
      const preRepairRunner = new MigrationRunner(migrationPool, migrationsThrough0012);
      const runner = new MigrationRunner(migrationPool, migrations);

      await expect(
        migrationPool.query(
          "SELECT session_user, current_user, current_setting('search_path') AS search_path",
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            session_user: names.migrationRole,
            current_user: names.schemaOwnerRole,
            search_path: 'public,pg_temp',
          },
        ],
      });
      await expect(preRepairRunner.up()).resolves.toEqual([
        '0005',
        '0007',
        '0008',
        '0009',
        '0010',
        '0011',
        '0012',
      ]);
      await expect(preRepairRunner.assertUpToDate()).resolves.toBeUndefined();
      await expect(runner.up()).resolves.toEqual(['0013', '0014']);
      await expect(runner.assertUpToDate()).resolves.toBeUndefined();

      await admin.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(database)} TO ${quoteIdentifier(names.schemaOwnerRole)}`,
      );
      await admin.query(
        `ALTER ROLE ${quoteIdentifier(names.schemaOwnerRole)} LOGIN PASSWORD ${quoteLiteral(schemaOwnerPassword)}`,
      );
      const directOwnerPool = new Pool({
        connectionString: roleUrl(
          testDatabaseUrl as string,
          database,
          names.schemaOwnerRole,
          schemaOwnerPassword,
        ),
        max: 1,
      });
      directOwnerPool.on('error', () => undefined);
      const directOwnerClient = await directOwnerPool.connect();
      directOwnerClient.on('error', () => undefined);
      try {
        await expect(directOwnerClient.query('SELECT 1')).resolves.toBeDefined();
        await admin.query(
          `ALTER ROLE ${quoteIdentifier(names.schemaOwnerRole)} NOLOGIN PASSWORD NULL`,
        );
        await admin.query(
          `REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(names.schemaOwnerRole)}`,
        );
        await expect(runner.assertUpToDate()).rejects.toThrow(
          'Database migration 0014 schema verification failed',
        );
      } finally {
        await terminateExactSessions(names.schemaOwnerRole);
        directOwnerClient.release(true);
        await directOwnerPool.end().catch(() => undefined);
        await admin.query(
          `ALTER ROLE ${quoteIdentifier(names.schemaOwnerRole)} NOLOGIN PASSWORD NULL`,
        );
        await admin.query(
          `REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(names.schemaOwnerRole)}`,
        );
      }
      await expect(runner.assertUpToDate()).resolves.toBeUndefined();
      await expect(
        migrationPool.query(
          `SELECT type_object.typname, owner_role.rolname AS owner,
                  NOT EXISTS (
                    SELECT 1
                    FROM pg_catalog.aclexplode(type_object.typacl) AS acl
                    WHERE acl.grantee = 0
                  ) AS public_denied
           FROM pg_catalog.pg_type AS type_object
           INNER JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = type_object.typnamespace
           INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = type_object.typowner
           WHERE namespace.nspname = 'public'
             AND type_object.typname IN ('bootstrap_owned_domain', 'bootstrap_owned_enum')
           ORDER BY type_object.typname`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            typname: 'bootstrap_owned_domain',
            owner: names.schemaOwnerRole,
            public_denied: true,
          },
          {
            typname: 'bootstrap_owned_enum',
            owner: names.schemaOwnerRole,
            public_denied: true,
          },
        ],
      });

      const apiUrl = roleUrl(testDatabaseUrl as string, database, apiOld, apiOldPassword);
      const workerUrl = roleUrl(testDatabaseUrl as string, database, workerLogin, workerPassword);
      const rawApiPool = new Pool({ connectionString: apiUrl, max: 1 });
      try {
        await expectPostgresDenied(rawApiPool.query('SELECT * FROM schema_migrations'), [
          '42501',
          '42P01',
        ]);
      } finally {
        await rawApiPool.end();
      }
      // CONNECT is granted only for this negative startup-role probe and is
      // revoked immediately so the exact database ACL remains drift-free.
      const wrongRolePool = runtimePool(
        'api',
        roleUrl(testDatabaseUrl as string, database, outsider, outsiderPassword),
      );
      await grantDatabaseConnect(outsider);
      await expect(wrongRolePool.query('SELECT 1')).rejects.toMatchObject({ code: '42501' });
      await wrongRolePool.end().catch(() => undefined);
      await admin.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(outsider)}`,
      );

      apiPool = runtimePool('api', apiUrl, 2);
      workerPool = runtimePool('worker', workerUrl, 2);
      await expect(
        apiPool.query(
          "SELECT session_user, current_user, current_setting('search_path') AS search_path",
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            session_user: apiOld,
            current_user: names.apiRuntimeRole,
            search_path: 'public,pg_temp',
          },
        ],
      });
      const apiRunner = new MigrationRunner(apiPool, migrations);
      const workerRunner = new MigrationRunner(workerPool, migrations);
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();
      await expect(workerRunner.assertUpToDate()).resolves.toBeUndefined();
      await expect(
        migrationPool.query(
          `SELECT
             pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'post_ledger_journal_with_lifecycle(text,uuid,uuid,uuid,text,timestamptz,timestamptz,text,uuid,text)'
               ),
               'EXECUTE'
             ) AS api_can_post,
             pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'reverse_ledger_journal_with_lifecycle(text,uuid,text,timestamptz,timestamptz,uuid)'
               ),
               'EXECUTE'
             ) AS api_can_reverse,
             pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'transition_ledger_transaction_state(uuid,uuid,text,text,text,timestamptz,uuid)'
               ),
               'EXECUTE'
             )
             AND pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'transition_ledger_leg_state(uuid,uuid,uuid,text,text,text,timestamptz,uuid)'
               ),
               'EXECUTE'
             )
             AND pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'transition_ledger_recovery_state(uuid,uuid,uuid,text,text,text,timestamptz,uuid)'
               ),
               'EXECUTE'
             ) AS api_can_transition,
             pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'resolve_ledger_command_idempotency(uuid,text,smallint,text,smallint,text)'
               ),
               'EXECUTE'
             )
             AND pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'claim_ledger_command_idempotency(uuid,text,smallint,text,smallint,text)'
               ),
               'EXECUTE'
             )
             AND pg_catalog.has_function_privilege(
               $1,
               to_regprocedure('complete_ledger_command_idempotency(uuid,uuid,uuid)'),
               'EXECUTE'
             ) AS api_can_use_idempotency,
             pg_catalog.has_column_privilege(
               $1, 'job_outbox', 'ledger_command_id', 'INSERT'
             )
             AND pg_catalog.has_column_privilege(
               $1, 'job_outbox', 'ledger_journal_id', 'INSERT'
             ) AS api_can_link_ledger_outbox,
             NOT pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'post_ledger_journal(text,uuid,uuid,uuid,text,timestamptz,timestamptz,text,uuid,text)'
               ),
               'EXECUTE'
             )
             AND NOT pg_catalog.has_function_privilege(
               $1,
               to_regprocedure(
                 'reverse_ledger_journal(text,uuid,text,timestamptz,timestamptz,uuid)'
               ),
               'EXECUTE'
             ) AS api_base_journal_functions_denied,
             NOT pg_catalog.has_function_privilege(
               $1, to_regprocedure('compute_ledger_posting_plan_digest(uuid)'), 'EXECUTE'
             ) AS api_helper_denied,
             NOT pg_catalog.has_function_privilege(
               $2,
               to_regprocedure(
                 'post_ledger_journal_with_lifecycle(text,uuid,uuid,uuid,text,timestamptz,timestamptz,text,uuid,text)'
               ),
               'EXECUTE'
             ) AS worker_post_denied,
             NOT pg_catalog.has_function_privilege(
               $2,
               to_regprocedure(
                 'resolve_ledger_command_idempotency(uuid,text,smallint,text,smallint,text)'
               ),
               'EXECUTE'
             )
             AND NOT pg_catalog.has_function_privilege(
               $2,
               to_regprocedure(
                 'claim_ledger_command_idempotency(uuid,text,smallint,text,smallint,text)'
               ),
               'EXECUTE'
             )
             AND NOT pg_catalog.has_function_privilege(
               $2,
               to_regprocedure('complete_ledger_command_idempotency(uuid,uuid,uuid)'),
               'EXECUTE'
             ) AS worker_idempotency_denied,
             NOT pg_catalog.has_column_privilege(
               $2, 'job_outbox', 'ledger_command_id', 'UPDATE'
             )
             AND NOT pg_catalog.has_column_privilege(
               $2, 'job_outbox', 'ledger_journal_id', 'UPDATE'
             ) AS worker_ledger_link_update_denied,
             NOT EXISTS (
               SELECT 1
               FROM pg_catalog.pg_class AS ledger_table
               WHERE ledger_table.relnamespace =
                       pg_catalog.to_regnamespace(pg_catalog.current_schema())
                 AND ledger_table.relkind = 'r'
                 AND pg_catalog.left(ledger_table.relname, 7) = 'ledger_'
                 AND (
                   pg_catalog.has_table_privilege(
                     $1, ledger_table.oid,
                     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                   )
                   OR pg_catalog.has_table_privilege(
                     $2, ledger_table.oid,
                     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                   )
                 )
             ) AS runtime_table_access_denied`,
          [names.apiRuntimeRole, names.workerRuntimeRole],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            api_can_post: true,
            api_can_reverse: true,
            api_can_transition: true,
            api_can_use_idempotency: true,
            api_can_link_ledger_outbox: true,
            api_base_journal_functions_denied: true,
            api_helper_denied: true,
            worker_post_denied: true,
            worker_idempotency_denied: true,
            worker_ledger_link_update_denied: true,
            runtime_table_access_denied: true,
          },
        ],
      });

      await migrationPool.query(
        'CREATE FUNCTION future_default_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
      );
      await migrationPool.query("CREATE TYPE future_default_enum AS ENUM ('safe')");
      await migrationPool.query('CREATE SEQUENCE future_default_sequence');
      await expectPostgresDenied(apiPool.query('SELECT future_default_probe()'), ['42501']);
      await expectPostgresDenied(workerPool.query('SELECT future_default_probe()'), ['42501']);
      await expectPostgresDenied(apiPool.query("SELECT nextval('future_default_sequence')"), [
        '42501',
      ]);
      await expectPostgresDenied(workerPool.query("SELECT nextval('future_default_sequence')"), [
        '42501',
      ]);
      await expect(
        migrationPool.query(
          `SELECT
             NOT pg_catalog.has_function_privilege(
               $1, 'future_default_probe()', 'EXECUTE'
             ) AS legacy_function_denied,
              NOT pg_catalog.has_type_privilege(
                $1, 'future_default_enum', 'USAGE'
              ) AS legacy_type_denied,
              NOT pg_catalog.has_sequence_privilege(
                $1, 'future_default_sequence', 'USAGE,SELECT,UPDATE'
              ) AS legacy_sequence_denied,
             NOT EXISTS (
               SELECT 1
               FROM pg_catalog.pg_proc AS procedure
               CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
               WHERE procedure.oid = to_regprocedure('future_default_probe()')
                 AND acl.grantee = 0
             ) AS public_function_denied,
              NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_type AS type
               CROSS JOIN LATERAL pg_catalog.aclexplode(type.typacl) AS acl
               WHERE type.oid = to_regtype('future_default_enum')
                  AND acl.grantee = 0
              ) AS public_type_denied,
              NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class AS sequence
                CROSS JOIN LATERAL pg_catalog.aclexplode(sequence.relacl) AS acl
                WHERE sequence.oid = to_regclass('future_default_sequence')
                  AND acl.grantee = 0
              ) AS public_sequence_denied`,
          [names.legacyRuntimeRole],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            legacy_function_denied: true,
            legacy_type_denied: true,
            legacy_sequence_denied: true,
            public_function_denied: true,
            public_type_denied: true,
            public_sequence_denied: true,
          },
        ],
      });

      await migrationPool.query('GRANT USAGE ON TYPE future_default_enum TO PUBLIC');
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0014 schema verification failed',
      );
      await migrationPool.query('REVOKE USAGE ON TYPE future_default_enum FROM PUBLIC');
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query(
        'CREATE TABLE future_non_ledger_row_type_probe (value integer NOT NULL)',
      );
      try {
        await expect(apiRunner.assertUpToDate()).rejects.toThrow(
          'Database migration 0014 schema verification failed',
        );
      } finally {
        await migrationPool.query('DROP TABLE future_non_ledger_row_type_probe');
      }
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query(
        `GRANT SELECT (book_id) ON TABLE ledger_books TO ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0014 schema verification failed',
      );
      await migrationPool.query(
        `REVOKE SELECT (book_id) ON TABLE ledger_books FROM ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query(
        `GRANT EXECUTE ON FUNCTION compute_ledger_posting_plan_digest(uuid)
         TO ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0014 schema verification failed',
      );
      await migrationPool.query(
        `REVOKE EXECUTE ON FUNCTION compute_ledger_posting_plan_digest(uuid)
         FROM ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query(
        'GRANT USAGE, SELECT, UPDATE ON SEQUENCE future_default_sequence TO PUBLIC',
      );
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0014 schema verification failed',
      );
      await migrationPool.query(
        'REVOKE USAGE, SELECT, UPDATE ON SEQUENCE future_default_sequence FROM PUBLIC',
      );
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query('GRANT INSERT (id) ON TABLE job_outbox TO PUBLIC');
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0014 schema verification failed',
      );
      await migrationPool.query('REVOKE INSERT (id) ON TABLE job_outbox FROM PUBLIC');
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query('DROP SEQUENCE future_default_sequence');
      await migrationPool.query('DROP FUNCTION future_default_probe()');
      await migrationPool.query('DROP TYPE future_default_enum');

      // Each drift mutation is restored before the next one so a failing
      // assertion identifies the exact privilege or policy boundary that leaked.
      await migrationPool.query(
        `GRANT UPDATE ON TABLE accounts TO ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0014 schema verification failed',
      );
      await migrationPool.query(
        `REVOKE UPDATE ON TABLE accounts FROM ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query(
        `GRANT CREATE ON SCHEMA public TO ${quoteIdentifier(names.legacyRuntimeRole)}`,
      );
      await expect(apiPool.query<{ valid: boolean }>(cumulativeVerifySql)).resolves.toMatchObject({
        rows: [{ valid: false }],
      });
      await migrationPool.query(
        `REVOKE CREATE ON SCHEMA public FROM ${quoteIdentifier(names.legacyRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query('ALTER POLICY job_outbox_worker_delete ON job_outbox USING (true)');
      await expect(workerRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0014 schema verification failed',
      );
      await migrationPool.query(
        "ALTER POLICY job_outbox_worker_delete ON job_outbox USING (status IN ('published', 'failed'))",
      );
      await expect(workerRunner.assertUpToDate()).resolves.toBeUndefined();

      await admin.query(
        `GRANT ${quoteIdentifier(outsider)} TO ${quoteIdentifier(names.legacyRuntimeRole)}
         WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
      );
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0014 schema verification failed',
      );
      await admin.query(
        `REVOKE ${quoteIdentifier(outsider)} FROM ${quoteIdentifier(names.legacyRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      const boundaryAdmin = new Pool({
        connectionString: roleUrl(
          testDatabaseUrl as string,
          database,
          bootstrapRole,
          adminUrl.password,
        ),
        max: 1,
      });
      const directGrantClient = await apiPool.connect();
      try {
        await boundaryAdmin.query(
          `GRANT USAGE ON TYPE private_admin.break_glass_enum TO ${quoteIdentifier(names.apiRuntimeRole)}`,
        );
        await expect(
          directGrantClient.query<{ valid: boolean }>(cumulativeVerifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await boundaryAdmin.query(
          `REVOKE USAGE ON TYPE private_admin.break_glass_enum FROM ${quoteIdentifier(names.apiRuntimeRole)}`,
        );
        await expect(
          directGrantClient.query<{ valid: boolean }>(cumulativeVerifySql),
        ).resolves.toMatchObject({ rows: [{ valid: true }] });

        await boundaryAdmin.query(
          `GRANT USAGE ON SCHEMA private_admin TO ${quoteIdentifier(apiOld)}`,
        );
        await boundaryAdmin.query(
          `GRANT SELECT ON TABLE private_admin.break_glass TO ${quoteIdentifier(apiOld)}`,
        );
        await expect(
          directGrantClient.query<{ valid: boolean }>(cumulativeVerifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await directGrantClient.query('SET ROLE NONE');
        await expect(
          directGrantClient.query('SELECT * FROM private_admin.break_glass'),
        ).resolves.toBeDefined();
        await directGrantClient.query(`SET ROLE ${quoteIdentifier(names.apiRuntimeRole)}`);
        await boundaryAdmin.query(
          `REVOKE SELECT ON TABLE private_admin.break_glass FROM ${quoteIdentifier(apiOld)}`,
        );
        await boundaryAdmin.query(
          `REVOKE USAGE ON SCHEMA private_admin FROM ${quoteIdentifier(apiOld)}`,
        );
        await directGrantClient.query('SET ROLE NONE');
        await expectPostgresDenied(
          directGrantClient.query('SELECT * FROM private_admin.break_glass'),
          ['42501', '42P01'],
        );
        await directGrantClient.query(`SET ROLE ${quoteIdentifier(names.apiRuntimeRole)}`);
      } finally {
        directGrantClient.release();
        await boundaryAdmin.end();
      }
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();
      const resetClient = await apiPool.connect();
      try {
        await resetClient.query('RESET ROLE');
        await expect(resetClient.query('SELECT current_user')).resolves.toMatchObject({
          rows: [{ current_user: names.apiRuntimeRole }],
        });
        await resetClient.query('SET ROLE NONE');
        await expectPostgresDenied(resetClient.query('SELECT * FROM schema_migrations'), [
          '42501',
          '42P01',
        ]);
        await resetClient.query(`SET ROLE ${quoteIdentifier(names.apiRuntimeRole)}`);
        await expect(
          resetClient.query(`SET ROLE ${quoteIdentifier(names.legacyRuntimeRole)}`),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        resetClient.release();
      }

      const accountId = randomUUID();
      await expect(
        apiPool.query(
          `SELECT * FROM provision_account_profile($1, $2, NULL, 'US', $1, 'kan232:provision')`,
          [accountId, 'kan232@example.test'],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        apiPool.query('SELECT account_id FROM accounts WHERE account_id = $1', [accountId]),
      ).resolves.toMatchObject({ rows: [{ account_id: accountId }] });
      await expect(
        apiPool.query(
          `INSERT INTO job_outbox (id, queue_name, payload, message_attributes)
           VALUES ('kan232-job', 'jobs', '{}'::jsonb, '{}'::jsonb)`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(workerPool.query('SELECT id FROM job_outbox')).resolves.toMatchObject({
        rows: [{ id: 'kan232-job' }],
      });
      await expect(
        workerPool.query(
          `UPDATE job_outbox SET locked_by = 'worker', locked_until = clock_timestamp() + interval '1 minute'
           WHERE id = 'kan232-job'`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        workerPool.query(
          `UPDATE job_outbox
           SET attempts = attempts + 1, status = 'failed', available_at = clock_timestamp(),
               last_error = 'OUTBOX_TRANSPORT_FAILED', failed_at = clock_timestamp(),
               locked_by = NULL, locked_until = NULL
           WHERE id = 'kan232-job' AND status = 'pending'`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        workerPool.query("DELETE FROM job_outbox WHERE id = 'kan232-job' AND status = 'failed'"),
      ).resolves.toMatchObject({ rowCount: 1 });
      await apiPool.query(
        `INSERT INTO job_outbox (id, queue_name, payload, message_attributes)
         VALUES ('kan232-published', 'jobs', '{}'::jsonb, '{}'::jsonb)`,
      );
      await workerPool.query(
        `UPDATE job_outbox
         SET status = 'published', published_at = clock_timestamp(),
             failed_at = NULL, last_error = NULL, locked_by = NULL, locked_until = NULL
         WHERE id = 'kan232-published' AND status = 'pending'`,
      );
      await expect(
        workerPool.query(
          "DELETE FROM job_outbox WHERE id = 'kan232-published' AND status = 'published'",
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      const deniedOperations: Array<() => Promise<unknown>> = [
        () => apiPool!.query('SELECT * FROM job_outbox'),
        () => apiPool!.query("UPDATE accounts SET eligibility_status = 'eligible'"),
        () => apiPool!.query('DELETE FROM account_profiles'),
        () => apiPool!.query('CREATE TABLE runtime_ddl(id integer)'),
        () => apiPool!.query('CREATE TEMP TABLE runtime_temp(id integer)'),
        () => apiPool!.query(`SET ROLE ${quoteIdentifier(names.schemaOwnerRole)}`),
        () => apiPool!.query('CREATE ROLE runtime_escalation'),
        () => apiPool!.query('CREATE DATABASE runtime_escalation'),
        () => apiPool!.query('CREATE EXTENSION hstore'),
        () => apiPool!.query("COPY (SELECT 1) TO PROGRAM 'false'"),
        () => apiPool!.query('SELECT * FROM private_admin.break_glass'),
        () => workerPool!.query('SELECT * FROM accounts'),
        () =>
          workerPool!.query(
            `INSERT INTO job_outbox (id, queue_name, payload, message_attributes)
           VALUES ('worker-insert', 'jobs', '{}'::jsonb, '{}'::jsonb)`,
          ),
        () => workerPool!.query('UPDATE job_outbox SET payload = \'{"tampered":true}\'::jsonb'),
      ];
      for (const deniedOperation of deniedOperations) {
        await expect(deniedOperation()).rejects.toBeDefined();
      }

      const beforeRuntimeMigration = await migrationPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM schema_migrations',
      );
      await expect(new MigrationRunner(apiPool, migrations).down(1)).rejects.toBeDefined();
      const pendingMigrations = [
        ...migrations,
        {
          id: '0015',
          description: 'synthetic runtime migration denial',
          upSql: 'CREATE TABLE runtime_migration_escape(id integer)',
          downSql: 'DROP TABLE runtime_migration_escape',
          verifySql: "SELECT to_regclass('runtime_migration_escape') IS NOT NULL AS valid",
        },
      ];
      await expect(new MigrationRunner(apiPool, pendingMigrations).up()).rejects.toBeDefined();
      await expect(
        migrationPool.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM schema_migrations',
        ),
      ).resolves.toMatchObject({ rows: beforeRuntimeMigration.rows });
      await expect(
        migrationPool.query(
          `SELECT to_regclass('runtime_migration_escape') AS object,
                  EXISTS (SELECT 1 FROM schema_migrations WHERE id = '0015') AS recorded`,
        ),
      ).resolves.toMatchObject({ rows: [{ object: null, recorded: false }] });

      await expect(runner.down(14)).resolves.toEqual([
        '0014',
        '0013',
        '0012',
        '0011',
        '0010',
        '0009',
        '0008',
        '0007',
        '0006',
        '0005',
        '0004',
        '0003',
        '0002',
        '0001',
      ]);
      await expect(runner.up()).resolves.toEqual([
        '0001',
        '0002',
        '0003',
        '0004',
        '0005',
        '0006',
        '0007',
        '0008',
        '0009',
        '0010',
        '0011',
        '0012',
        '0013',
        '0014',
      ]);
      await expect(
        new MigrationRunner(apiPool, migrations).assertUpToDate(),
      ).resolves.toBeUndefined();

      await createRole(
        apiNew,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        apiNewPassword,
      );
      await grantSetMembership(names.apiRuntimeRole, apiNew);
      await grantDatabaseConnect(apiNew);
      apiNewPool = runtimePool(
        'api',
        roleUrl(testDatabaseUrl as string, database, apiNew, apiNewPassword),
      );
      await expect(
        apiNewPool.query('SELECT count(*)::integer AS count FROM schema_migrations'),
      ).resolves.toMatchObject({
        rows: [{ count: 14 }],
      });

      const activeOldClient = await apiPool.connect();
      apiPool.on('error', () => undefined);
      activeOldClient.on('error', () => undefined);
      await activeOldClient.query('SELECT 1');
      await admin.query(`ALTER ROLE ${quoteIdentifier(apiOld)} NOLOGIN`);
      await admin.query(
        `REVOKE ${quoteIdentifier(names.apiRuntimeRole)} FROM ${quoteIdentifier(apiOld)}`,
      );
      await admin.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(apiOld)}`,
      );
      await expect(
        activeOldClient.query('SELECT count(*) FROM schema_migrations'),
      ).resolves.toBeDefined();
      await terminateExactSessions(apiOld);
      await expect(activeOldClient.query('SELECT 1')).rejects.toBeDefined();
      activeOldClient.release(true);
      const revokedPool = runtimePool('api', apiUrl);
      await expect(revokedPool.query('SELECT 1')).rejects.toBeDefined();
      await revokedPool.end().catch(() => undefined);

      // Local rollback rehearsal: restore the old slot, prove it can start, then
      // repeat the cutover and retire it only after the new slot stays healthy.
      await admin.query(`ALTER ROLE ${quoteIdentifier(apiOld)} LOGIN`);
      await grantSetMembership(names.apiRuntimeRole, apiOld);
      await grantDatabaseConnect(apiOld);
      const rollbackPool = runtimePool('api', apiUrl);
      await expect(rollbackPool.query('SELECT 1')).resolves.toBeDefined();
      await rollbackPool.end();
      await admin.query(`ALTER ROLE ${quoteIdentifier(apiOld)} NOLOGIN`);
      await admin.query(
        `REVOKE ${quoteIdentifier(names.apiRuntimeRole)} FROM ${quoteIdentifier(apiOld)}`,
      );
      await admin.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(apiOld)}`,
      );
      await terminateExactSessions(apiOld);
      await apiPool.end().catch(() => undefined);
      apiPool = undefined;
      await admin.query(`DROP ROLE ${quoteIdentifier(apiOld)}`);
      createdRoles.splice(createdRoles.indexOf(apiOld), 1);
      await expect(
        apiNewPool.query('SELECT count(*) FROM schema_migrations'),
      ).resolves.toBeDefined();
      await expect(
        new MigrationRunner(apiNewPool, migrations).assertUpToDate(),
      ).resolves.toBeUndefined();

      await createRole(
        workerNew,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        workerNewPassword,
      );
      await grantSetMembership(names.workerRuntimeRole, workerNew);
      await grantDatabaseConnect(workerNew);
      workerNewPool = runtimePool(
        'worker',
        roleUrl(testDatabaseUrl as string, database, workerNew, workerNewPassword),
      );
      await expect(
        workerPool.query('SELECT count(*) FROM schema_migrations'),
      ).resolves.toBeDefined();
      await expect(
        workerNewPool.query('SELECT count(*) FROM schema_migrations'),
      ).resolves.toBeDefined();

      const activeOldWorker = await workerPool.connect();
      workerPool.on('error', () => undefined);
      activeOldWorker.on('error', () => undefined);
      await activeOldWorker.query('SELECT 1');
      await admin.query(`ALTER ROLE ${quoteIdentifier(workerLogin)} NOLOGIN`);
      await admin.query(
        `REVOKE ${quoteIdentifier(names.workerRuntimeRole)} FROM ${quoteIdentifier(workerLogin)}`,
      );
      await admin.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(workerLogin)}`,
      );
      await expect(
        activeOldWorker.query('SELECT count(*) FROM schema_migrations'),
      ).resolves.toBeDefined();
      await terminateExactSessions(workerLogin);
      await expect(activeOldWorker.query('SELECT 1')).rejects.toBeDefined();
      activeOldWorker.release(true);
      const revokedWorkerPool = runtimePool('worker', workerUrl);
      await expect(revokedWorkerPool.query('SELECT 1')).rejects.toBeDefined();
      await revokedWorkerPool.end().catch(() => undefined);

      await admin.query(`ALTER ROLE ${quoteIdentifier(workerLogin)} LOGIN`);
      await grantSetMembership(names.workerRuntimeRole, workerLogin);
      await grantDatabaseConnect(workerLogin);
      const workerRollbackPool = runtimePool('worker', workerUrl);
      await expect(workerRollbackPool.query('SELECT 1')).resolves.toBeDefined();
      await workerRollbackPool.end();
      await admin.query(`ALTER ROLE ${quoteIdentifier(workerLogin)} NOLOGIN`);
      await admin.query(
        `REVOKE ${quoteIdentifier(names.workerRuntimeRole)} FROM ${quoteIdentifier(workerLogin)}`,
      );
      await admin.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(workerLogin)}`,
      );
      await terminateExactSessions(workerLogin);
      await workerPool.end().catch(() => undefined);
      workerPool = undefined;
      await admin.query(`DROP ROLE ${quoteIdentifier(workerLogin)}`);
      createdRoles.splice(createdRoles.indexOf(workerLogin), 1);
      await expect(
        new MigrationRunner(workerNewPool, migrations).assertUpToDate(),
      ).resolves.toBeUndefined();

      // The migration identity is one-off rather than long-lived. Rotate only
      // after an exact session drain, prove the old verifier fails, rehearse a
      // rollback, then reapply the new credential before any new invocation.
      await migrationPool.end();
      migrationPool = undefined;
      await terminateExactSessions(names.migrationRole);
      await expect(
        admin.query<{ active: string }>(
          `SELECT count(*)::text AS active
           FROM pg_catalog.pg_stat_activity WHERE usename = $1`,
          [names.migrationRole],
        ),
      ).resolves.toMatchObject({ rows: [{ active: '0' }] });
      await admin.query(
        `ALTER ROLE ${quoteIdentifier(names.migrationRole)} PASSWORD ${quoteLiteral(migrationNewPassword)}`,
      );
      const oldMigrationCredentialPool = migrationPrincipalPool(migrationUrl);
      await expect(oldMigrationCredentialPool.query('SELECT 1')).rejects.toMatchObject({
        code: '28P01',
      });
      await oldMigrationCredentialPool.end().catch(() => undefined);
      const migrationNewUrl = roleUrl(
        testDatabaseUrl as string,
        database,
        names.migrationRole,
        migrationNewPassword,
      );
      const newMigrationCredentialPool = migrationPrincipalPool(migrationNewUrl);
      await expect(newMigrationCredentialPool.query('SELECT 1')).resolves.toBeDefined();
      await newMigrationCredentialPool.end();

      await admin.query(
        `ALTER ROLE ${quoteIdentifier(names.migrationRole)} PASSWORD ${quoteLiteral(migrationPassword)}`,
      );
      const migrationRollbackPool = migrationPrincipalPool(migrationUrl);
      await expect(migrationRollbackPool.query('SELECT 1')).resolves.toBeDefined();
      await migrationRollbackPool.end();
      await admin.query(
        `ALTER ROLE ${quoteIdentifier(names.migrationRole)} PASSWORD ${quoteLiteral(migrationNewPassword)}`,
      );
      migrationPool = migrationPrincipalPool(migrationNewUrl);
      await expect(
        new MigrationRunner(migrationPool, migrations).assertUpToDate(),
      ).resolves.toBeUndefined();

      const deniedCrossDatabase = new Pool({
        connectionString: roleUrl(
          testDatabaseUrl as string,
          deniedDatabase,
          apiNew,
          apiNewPassword,
        ),
        max: 1,
      });
      await expect(deniedCrossDatabase.query('SELECT 1')).rejects.toBeDefined();
      await deniedCrossDatabase.end().catch(() => undefined);
    } finally {
      await legacyPool?.end().catch(() => undefined);
      await databaseAdmin?.end().catch(() => undefined);
      await apiNewPool?.end().catch(() => undefined);
      await apiPool?.end().catch(() => undefined);
      await workerNewPool?.end().catch(() => undefined);
      await workerPool?.end().catch(() => undefined);
      await migrationPool?.end().catch(() => undefined);
      for (const role of createdRoles) await terminateExactSessions(role).catch(() => undefined);
      await admin
        .query(
          `REVOKE ${quoteIdentifier(names.legacyRuntimeRole)}
           FROM ${quoteIdentifier(names.apiRuntimeRole)}`,
        )
        .catch(() => undefined);
      await admin
        .query(
          `SELECT pg_catalog.pg_terminate_backend(pid)
         FROM pg_catalog.pg_stat_activity
         WHERE datname IN ($1, $2) AND pid <> pg_catalog.pg_backend_pid()`,
          [database, deniedDatabase],
        )
        .catch(() => undefined);
      await admin
        .query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`)
        .catch(() => undefined);
      await admin
        .query(`DROP DATABASE IF EXISTS ${quoteIdentifier(deniedDatabase)}`)
        .catch(() => undefined);
      for (const role of [...createdRoles].reverse()) {
        await admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`).catch(() => undefined);
      }
      await admin.end();
    }
  });
});
