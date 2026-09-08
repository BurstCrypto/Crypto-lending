import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { createMigrationPool } from '../../src/infrastructure/database/migration-pool';
import {
  createActiveWalletRegistrationListMigration,
  createAaveV3EthereumFinalizedCheckpointMigration,
  createAuthenticationHmacKeyRotationMigration,
  createAuthenticationSessionsMigration,
  createBalanceConsumerWalletAddressBoundaryMigration,
  createBalanceSyncReadModelMigration,
  createDatabasePrincipalBoundaryMigration,
  createGenericWorkerBalanceAuthoritySuspensionMigration,
  createImmutableLedgerMigration,
  createLedgerCommandIdempotencyMigration,
  createLedgerFeeAdjustmentIntegrityMigration,
  createLedgerLifecycleMigration,
  createMainnetWalletLaunchNarrowingMigration,
  createMainnetBalanceAgreementEvidenceMigration,
  createReviewedJobOutboxAdmissionMigration,
  createStablecoinDepegLatchMigration,
  createStablecoinIngestionAuthoritySuspensionMigration,
  createStablecoinPriceEvidenceReadModelMigration,
  createWalletKeyRotationBoundaryMigration,
  createWalletMetadataRewrapBoundaryMigration,
  createWalletRegistrationRevocationMigration,
  createWalletOwnershipRegistrationMigration,
  createYieldOperationControlsMigration,
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
  type DatabaseMigration,
  type DatabasePrincipalNames,
} from '../../src/infrastructure/database/migrations';
import { createPostgresPool } from '../../src/infrastructure/database/runtime-postgres-pool';
import { testInfrastructureConfig } from './fixtures';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MAINNET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

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

interface ReviewedBalanceSyncIdentity {
  readonly accountId: string;
  readonly walletId: string;
  readonly networkId: 'eip155:1' | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
}

interface ReviewedYieldSubmission {
  readonly actorAccountId: string;
  readonly correlationId: string;
  readonly ledgerTransactionId: string;
  readonly occurredAt: string;
  readonly operationId: string;
  readonly operationType: 'ALLOCATE' | 'WITHDRAW' | 'REBALANCE';
  readonly planReferenceId: string;
  readonly quoteReferenceId: string;
}

interface SubmittedYieldRow {
  readonly submission_id: string | null;
  readonly transition_recorded_at: Date;
}

function reviewedBalanceSyncEnvelope(
  id: string,
  identity: ReviewedBalanceSyncIdentity = {
    accountId: randomUUID(),
    walletId: randomUUID(),
    networkId: 'eip155:1',
  },
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id,
    kind: 'blockchain.balance-sync',
    version: 1,
    occurredAt: '2026-09-04T12:00:00.000Z',
    correlation: Object.freeze({ correlationId: randomUUID() }),
    payload: Object.freeze({
      schemaVersion: 1,
      accountId: identity.accountId,
      walletId: identity.walletId,
      networkId: identity.networkId,
      requiredTier: 'PROVISIONAL',
      cause: 'SCHEDULED',
      attempt: 1,
      rescanFromPosition: null,
    }),
  });
}

function reviewedYieldSubmissionEnvelope(
  id: string,
  submission: ReviewedYieldSubmission,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id,
    kind: 'yield.operation.submit',
    version: 1,
    occurredAt: submission.occurredAt,
    correlation: Object.freeze({
      correlationId: submission.correlationId,
      initiatorActorId: submission.actorAccountId,
      transactionId: submission.ledgerTransactionId,
      quoteId: submission.quoteReferenceId,
    }),
    payload: Object.freeze({
      submissionId: id,
      operationId: submission.operationId,
      operationType: submission.operationType,
      ledgerTransactionId: submission.ledgerTransactionId,
      planReferenceId: submission.planReferenceId,
      quoteReferenceId: submission.quoteReferenceId,
    }),
  });
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
  return DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(({ id }) =>
    ['0001', '0002', '0003', '0004', '0006'].includes(id),
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

interface BootstrapPrincipalNames extends DatabasePrincipalNames {
  readonly balanceConsumerRuntimeRole: string;
  readonly balanceConsumerLoginPrefix: string;
}

async function runBootstrapArtifact(
  database: string,
  names: BootstrapPrincipalNames,
  apiLogin: string,
  workerLogin: string,
  balanceConsumerLogin: string,
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
    balance_consumer_runtime_role: names.balanceConsumerRuntimeRole,
    api_login_prefix: names.apiLoginPrefix,
    worker_login_prefix: names.workerLoginPrefix,
    balance_consumer_login_prefix: names.balanceConsumerLoginPrefix,
    api_login: apiLogin,
    worker_login: workerLogin,
    balance_consumer_login: balanceConsumerLogin,
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
    const names: BootstrapPrincipalNames = {
      bootstrapRole,
      schemaOwnerRole: `k232_owner_${suffix}`,
      migrationRole: `k232_migrate_${suffix}`,
      apiRuntimeRole: `k232_api_cap_${suffix}`,
      workerRuntimeRole: `k232_worker_cap_${suffix}`,
      balanceConsumerRuntimeRole: `k232_balance_cap_${suffix}`,
      apiLoginPrefix: `k232_api_${suffix}_`,
      workerLoginPrefix: `k232_worker_${suffix}_`,
      balanceConsumerLoginPrefix: `k232_balance_${suffix}_`,
      legacyRuntimeRole: `k232_legacy_${suffix}`,
    };
    const apiOld = `${names.apiLoginPrefix}a`;
    const apiNew = `${names.apiLoginPrefix}b`;
    const workerLogin = `${names.workerLoginPrefix}a`;
    const workerNew = `${names.workerLoginPrefix}b`;
    const balanceConsumerLogin = `${names.balanceConsumerLoginPrefix}a`;
    const balanceConsumerNew = `${names.balanceConsumerLoginPrefix}b`;
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
            statementTimeoutMs: 30_000,
            sessionRole: workload === 'api' ? names.apiRuntimeRole : names.workerRuntimeRole,
          },
        },
        {
          api: names.apiRuntimeRole,
          balanceConsumer: 'unused_balance_consumer_runtime',
          worker: names.workerRuntimeRole,
        },
      );
    const migrationPrincipalPool = (connectionString: string): Pool =>
      createMigrationPool(
        {
          ...infrastructureFixture.database,
          connectionString,
          poolMax: 1,
          statementTimeoutMs: 30_000,
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
        balanceConsumerLogin,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
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
          balanceConsumerLogin,
        ),
      ).rejects.toThrow(/do(?:es)? not match the reviewed contract/u);
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
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerLogin),
      ).rejects.toThrow('pre-provisioned restricted LOGIN roles');
      await admin.query(`ALTER ROLE ${quoteIdentifier(names.migrationRole)} LOGIN`);

      await createRole(
        names.schemaOwnerRole,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      );
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerLogin),
      ).rejects.toThrow('committed capability NOLOGIN state');
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
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerLogin),
      ).rejects.toThrow(
        'migration, capability, legacy, API, worker, and balance-consumer sessions must be drained and terminated first',
      );
      await terminateExactSessions(names.legacyRuntimeRole);
      await expect(activeLegacyClient.query('SELECT 1')).rejects.toBeDefined();
      activeLegacyClient.release(true);
      await legacyPool.end().catch(() => undefined);
      legacyPool = undefined;
      const retiredLegacyPool = new Pool({ connectionString: legacyUrl, max: 1 });
      await expect(retiredLegacyPool.query('SELECT 1')).rejects.toBeDefined();
      await retiredLegacyPool.end().catch(() => undefined);

      await expect(
        runBootstrapArtifact(
          database,
          { ...names, balanceConsumerRuntimeRole: names.workerRuntimeRole },
          apiOld,
          workerLogin,
          balanceConsumerLogin,
        ),
      ).rejects.toThrow('distinct principals');

      await admin.query(
        `GRANT ${quoteIdentifier(names.legacyRuntimeRole)}
         TO ${quoteIdentifier(balanceConsumerLogin)}`,
      );
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerLogin),
      ).rejects.toThrow(/do(?:es)? not match the reviewed contract/u);
      await admin.query(
        `REVOKE ${quoteIdentifier(names.legacyRuntimeRole)}
         FROM ${quoteIdentifier(balanceConsumerLogin)}`,
      );

      const malformedBalanceConsumerLogin = `${names.balanceConsumerLoginPrefix}_bad`;
      await createRole(
        malformedBalanceConsumerLogin,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      );
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerLogin),
      ).rejects.toThrow(/do(?:es)? not match the reviewed contract/u);
      await admin.query(`DROP ROLE ${quoteIdentifier(malformedBalanceConsumerLogin)}`);
      createdRoles.splice(createdRoles.indexOf(malformedBalanceConsumerLogin), 1);

      const excessBalanceConsumerLogin = `${names.balanceConsumerLoginPrefix}b`;
      await createRole(
        excessBalanceConsumerLogin,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      );
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerLogin),
      ).rejects.toThrow(/do(?:es)? not match the reviewed contract/u);
      await admin.query(`DROP ROLE ${quoteIdentifier(excessBalanceConsumerLogin)}`);
      createdRoles.splice(createdRoles.indexOf(excessBalanceConsumerLogin), 1);

      await runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerLogin);
      createdRoles.push(
        names.apiRuntimeRole,
        names.workerRuntimeRole,
        names.balanceConsumerRuntimeRole,
      );
      await expect(
        admin.query<{ password_retired: boolean }>(
          `SELECT rolpassword IS NULL AS password_retired
           FROM pg_catalog.pg_authid WHERE rolname = $1`,
          [names.legacyRuntimeRole],
        ),
      ).resolves.toMatchObject({ rows: [{ password_retired: true }] });
      await expect(
        admin.query<{
          capability_restricted: boolean;
          exact_membership: boolean;
          credential_disabled: boolean;
          login_database_denied: boolean;
          capability_database_denied: boolean;
          capability_schema_denied: boolean;
        }>(
          `SELECT
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_roles
               WHERE rolname = $1
                 AND NOT rolcanlogin AND NOT rolinherit
                 AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
                 AND NOT rolreplication AND NOT rolbypassrls
             ) AS capability_restricted,
             (
               SELECT count(*) = 1
               FROM pg_catalog.pg_auth_members AS membership
               INNER JOIN pg_catalog.pg_roles AS granted_role
                 ON granted_role.oid = membership.roleid
               INNER JOIN pg_catalog.pg_roles AS member_role
                 ON member_role.oid = membership.member
               WHERE granted_role.rolname = $1
                 AND member_role.rolname = $2
                 AND NOT membership.admin_option
                 AND NOT membership.inherit_option
                 AND membership.set_option
             ) AS exact_membership,
             (
               SELECT rolpassword IS NULL
               FROM pg_catalog.pg_authid
               WHERE rolname = $2
             ) AS credential_disabled,
             NOT pg_catalog.has_database_privilege($2, $3, 'CONNECT')
               AND NOT pg_catalog.has_database_privilege($2, $3, 'CREATE')
               AND NOT pg_catalog.has_database_privilege($2, $3, 'TEMP')
               AS login_database_denied,
             NOT pg_catalog.has_database_privilege($1, $3, 'CONNECT')
               AND NOT pg_catalog.has_database_privilege($1, $3, 'CREATE')
               AND NOT pg_catalog.has_database_privilege($1, $3, 'TEMP')
               AS capability_database_denied,
             NOT pg_catalog.has_schema_privilege($1, 'public', 'USAGE')
               AND NOT pg_catalog.has_schema_privilege($1, 'public', 'CREATE')
               AS capability_schema_denied`,
          [names.balanceConsumerRuntimeRole, balanceConsumerLogin, database],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            capability_restricted: true,
            exact_membership: true,
            credential_disabled: true,
            login_database_denied: true,
            capability_database_denied: true,
            capability_schema_denied: true,
          },
        ],
      });
      const deniedBalanceConsumerPool = new Pool({
        connectionString: roleUrl(
          testDatabaseUrl as string,
          database,
          balanceConsumerLogin,
          randomBytes(24).toString('hex'),
        ),
        max: 1,
      });
      await expect(deniedBalanceConsumerPool.query('SELECT 1')).rejects.toBeDefined();
      await deniedBalanceConsumerPool.end().catch(() => undefined);

      await createRole(
        balanceConsumerNew,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      );
      await runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerNew);
      await expect(
        admin.query<{ bounded_overlap_valid: boolean }>(
          `SELECT count(*) = 2
             AND pg_catalog.bool_and(
               NOT pg_catalog.has_database_privilege(login_role.oid, $3, 'CONNECT')
               AND 1 = (
                 SELECT count(*)
                 FROM pg_catalog.pg_auth_members AS membership
                 INNER JOIN pg_catalog.pg_roles AS granted_role
                   ON granted_role.oid = membership.roleid
                 WHERE membership.member = login_role.oid
                   AND granted_role.rolname = $2
                   AND NOT membership.admin_option
                   AND NOT membership.inherit_option
                   AND membership.set_option
               )
             ) AS bounded_overlap_valid
           FROM pg_catalog.pg_roles AS login_role
           WHERE pg_catalog.left(login_role.rolname, pg_catalog.length($1)) = $1`,
          [names.balanceConsumerLoginPrefix, names.balanceConsumerRuntimeRole, database],
        ),
      ).resolves.toMatchObject({ rows: [{ bounded_overlap_valid: true }] });

      const excessBalanceConsumerSuccessor = `${names.balanceConsumerLoginPrefix}c`;
      await createRole(
        excessBalanceConsumerSuccessor,
        'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      );
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerNew),
      ).rejects.toThrow(/do(?:es)? not match the reviewed contract/u);
      await admin.query(`DROP ROLE ${quoteIdentifier(excessBalanceConsumerSuccessor)}`);
      createdRoles.splice(createdRoles.indexOf(excessBalanceConsumerSuccessor), 1);

      await admin.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(deniedDatabase)}
         TO ${quoteIdentifier(balanceConsumerLogin)}`,
      );
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerNew),
      ).rejects.toThrow('database boundary does not match');
      await admin.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(deniedDatabase)}
         FROM ${quoteIdentifier(balanceConsumerLogin)}`,
      );

      await admin.query(
        `GRANT CREATE, TEMP ON DATABASE ${quoteIdentifier(deniedDatabase)}
         TO ${quoteIdentifier(balanceConsumerLogin)}`,
      );
      await expect(
        runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerNew),
      ).rejects.toThrow('database boundary does not match');
      await admin.query(
        `REVOKE CREATE, TEMP ON DATABASE ${quoteIdentifier(deniedDatabase)}
         FROM ${quoteIdentifier(balanceConsumerLogin)}`,
      );

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
        // The bootstrap catalogs are scoped to this isolated database.
        await databaseAdmin.query(
          `GRANT SELECT (id) ON TABLE public.job_outbox
           TO ${quoteIdentifier(balanceConsumerLogin)}`,
        );
        await expect(
          runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerNew),
        ).rejects.toThrow('database boundary does not match');
      } finally {
        await databaseAdmin.query(
          `REVOKE SELECT (id) ON TABLE public.job_outbox
           FROM ${quoteIdentifier(balanceConsumerLogin)}`,
        );
        await databaseAdmin.end();
        databaseAdmin = undefined;
      }

      await admin.query(`ALTER ROLE ${quoteIdentifier(balanceConsumerLogin)} NOLOGIN`);
      await admin.query(
        `REVOKE ${quoteIdentifier(names.balanceConsumerRuntimeRole)}
         FROM ${quoteIdentifier(balanceConsumerLogin)}`,
      );
      await terminateExactSessions(balanceConsumerLogin);
      await admin.query(`DROP ROLE ${quoteIdentifier(balanceConsumerLogin)}`);
      createdRoles.splice(createdRoles.indexOf(balanceConsumerLogin), 1);
      await runBootstrapArtifact(database, names, apiOld, workerLogin, balanceConsumerNew);
      await expect(
        admin.query<{ steady_state_valid: boolean }>(
          `SELECT count(*) = 1
             AND pg_catalog.bool_and(
               rolname = $2
               AND rolcanlogin AND NOT rolinherit
               AND NOT pg_catalog.has_database_privilege(oid, $3, 'CONNECT')
             ) AS steady_state_valid
           FROM pg_catalog.pg_roles
           WHERE pg_catalog.left(rolname, pg_catalog.length($1)) = $1`,
          [names.balanceConsumerLoginPrefix, balanceConsumerNew, database],
        ),
      ).resolves.toMatchObject({ rows: [{ steady_state_valid: true }] });

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
      const mainnetWalletLaunchMigration = createMainnetWalletLaunchNarrowingMigration(names);
      const walletRevocationMigration = createWalletRegistrationRevocationMigration(names);
      const aaveCheckpointMigration = createAaveV3EthereumFinalizedCheckpointMigration(names);
      const reviewedJobAdmissionMigration = createReviewedJobOutboxAdmissionMigration(names);
      const stablecoinDepegLatchMigration = createStablecoinDepegLatchMigration(names);
      const balanceSyncReadModelMigration = createBalanceSyncReadModelMigration(names);
      const stablecoinPriceEvidenceMigration =
        createStablecoinPriceEvidenceReadModelMigration(names);
      const walletKeyRotationMigration = createWalletKeyRotationBoundaryMigration(names);
      const balanceConsumerAddressMigration =
        createBalanceConsumerWalletAddressBoundaryMigration(names);
      const walletMetadataRewrapMigration = createWalletMetadataRewrapBoundaryMigration(names);
      const authenticationHmacRotationMigration =
        createAuthenticationHmacKeyRotationMigration(names);
      const stablecoinIngestionSuspensionMigration =
        createStablecoinIngestionAuthoritySuspensionMigration(names);
      const mainnetBalanceAgreementEvidenceMigration =
        createMainnetBalanceAgreementEvidenceMigration(names);
      const genericWorkerBalanceAuthoritySuspensionMigration =
        createGenericWorkerBalanceAuthoritySuspensionMigration(names);
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
      if (!mainnetWalletLaunchMigration.verifySql) {
        throw new Error('Mainnet wallet launch migration must be verifiable');
      }
      if (!walletRevocationMigration.verifySql) {
        throw new Error('Wallet revocation migration must be verifiable');
      }
      if (!aaveCheckpointMigration.verifySql) {
        throw new Error('Aave checkpoint migration must be verifiable');
      }
      if (!reviewedJobAdmissionMigration.verifySql) {
        throw new Error('Reviewed outbox admission migration must be verifiable');
      }
      if (!stablecoinDepegLatchMigration.verifySql) {
        throw new Error('Stablecoin depeg latch migration must be verifiable');
      }
      if (!balanceSyncReadModelMigration.verifySql) {
        throw new Error('Balance sync read model migration must be verifiable');
      }
      if (!stablecoinPriceEvidenceMigration.verifySql) {
        throw new Error('Stablecoin price evidence migration must be verifiable');
      }
      if (!walletKeyRotationMigration.verifySql) {
        throw new Error('Wallet key rotation migration must be verifiable');
      }
      if (!balanceConsumerAddressMigration.verifySql) {
        throw new Error('Balance consumer address migration must be verifiable');
      }
      if (!walletMetadataRewrapMigration.verifySql) {
        throw new Error('Wallet metadata rewrap migration must be verifiable');
      }
      if (!authenticationHmacRotationMigration.verifySql) {
        throw new Error('Authentication HMAC rotation migration must be verifiable');
      }
      if (!stablecoinIngestionSuspensionMigration.verifySql) {
        throw new Error('Stablecoin ingestion suspension migration must be verifiable');
      }
      if (!mainnetBalanceAgreementEvidenceMigration.verifySql) {
        throw new Error('Mainnet balance agreement evidence migration must be verifiable');
      }
      if (!genericWorkerBalanceAuthoritySuspensionMigration.verifySql) {
        throw new Error('Generic worker balance authority suspension migration must be verifiable');
      }
      const cumulativeVerifySql = authenticationHmacRotationMigration.verifySql;
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
        mainnetWalletLaunchMigration,
        walletRevocationMigration,
        aaveCheckpointMigration,
        reviewedJobAdmissionMigration,
        stablecoinDepegLatchMigration,
        balanceSyncReadModelMigration,
        stablecoinPriceEvidenceMigration,
        walletKeyRotationMigration,
        balanceConsumerAddressMigration,
        walletMetadataRewrapMigration,
        authenticationHmacRotationMigration,
      ];
      const migrationsThrough0012 = migrations.filter(({ id }) => id < '0013');
      const migrationsThrough0015 = migrations.filter(({ id }) => id < '0016');
      const preRepairRunner = new MigrationRunner(migrationPool, migrationsThrough0012);
      const preRevocationRunner = new MigrationRunner(migrationPool, migrationsThrough0015);
      const runner = new MigrationRunner(migrationPool, migrations);
      const forwardOnlyMigrations = [
        ...migrations,
        stablecoinIngestionSuspensionMigration,
        mainnetBalanceAgreementEvidenceMigration,
        genericWorkerBalanceAuthoritySuspensionMigration,
      ];

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
      await expect(preRevocationRunner.up()).resolves.toEqual(['0013', '0014', '0015']);
      await expect(
        migrationPool.query<{ valid: boolean }>(mainnetWalletLaunchMigration.verifySql),
      ).resolves.toMatchObject({ rows: [{ valid: true }] });

      const rolloutApiPool = runtimePool(
        'api',
        roleUrl(testDatabaseUrl as string, database, apiOld, apiOldPassword),
      );
      const rolloutWorkerPool = runtimePool(
        'worker',
        roleUrl(testDatabaseUrl as string, database, workerLogin, workerPassword),
      );
      try {
        const oldApiRunner = new MigrationRunner(rolloutApiPool, migrationsThrough0015);
        const oldWorkerRunner = new MigrationRunner(rolloutWorkerPool, migrationsThrough0015);
        const newApiRunner = new MigrationRunner(rolloutApiPool, migrations);
        const newWorkerRunner = new MigrationRunner(rolloutWorkerPool, migrations);

        await expect(oldApiRunner.assertUpToDate()).resolves.toBeUndefined();
        await expect(oldWorkerRunner.assertUpToDate()).resolves.toBeUndefined();
        await expect(newApiRunner.assertUpToDate()).rejects.toThrow(
          'Database migration 0016 has not been applied',
        );
        await expect(newWorkerRunner.assertUpToDate()).rejects.toThrow(
          'Database migration 0016 has not been applied',
        );

        await expect(runner.up()).resolves.toEqual([
          '0016',
          '0017',
          '0018',
          '0019',
          '0020',
          '0021',
          '0022',
          '0023',
          '0024',
          '0025',
        ]);
        await expect(
          migrationPool.query<{ valid: boolean }>(mainnetWalletLaunchMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(walletRevocationMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(reviewedJobAdmissionMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(stablecoinDepegLatchMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(balanceSyncReadModelMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(stablecoinPriceEvidenceMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(walletKeyRotationMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(balanceConsumerAddressMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(walletMetadataRewrapMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: false }] });
        await expect(
          migrationPool.query<{ valid: boolean }>(authenticationHmacRotationMigration.verifySql),
        ).resolves.toMatchObject({ rows: [{ valid: true }] });

        await expect(oldApiRunner.assertUpToDate()).rejects.toThrow(
          'Database migration 0015 schema verification failed',
        );
        await expect(oldWorkerRunner.assertUpToDate()).rejects.toThrow(
          'Database migration 0015 schema verification failed',
        );
        await expect(newApiRunner.assertUpToDate()).resolves.toBeUndefined();
        await expect(newWorkerRunner.assertUpToDate()).resolves.toBeUndefined();
      } finally {
        await rolloutApiPool.end().catch(() => undefined);
        await rolloutWorkerPool.end().catch(() => undefined);
      }

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
          'Database migration 0025 schema verification failed',
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
      for (let readinessAttempt = 0; readinessAttempt < 3; readinessAttempt += 1) {
        await expect(
          Promise.all([apiRunner.assertUpToDate(), workerRunner.assertUpToDate()]),
        ).resolves.toEqual([undefined, undefined]);
      }
      const resolverIdentity = 'resolve_active_wallet_address_ciphertext(uuid,uuid,text)';
      await expect(
        migrationPool.query(
          `SELECT
             pg_catalog.has_function_privilege($1, $5, 'EXECUTE') AS worker_execute,
             NOT pg_catalog.has_function_privilege($2, $5, 'EXECUTE') AS api_denied,
             NOT pg_catalog.has_function_privilege($3, $5, 'EXECUTE') AS legacy_denied,
             NOT pg_catalog.has_function_privilege($4, $5, 'EXECUTE') AS migration_denied`,
          [
            names.workerRuntimeRole,
            names.apiRuntimeRole,
            names.legacyRuntimeRole,
            names.migrationRole,
            resolverIdentity,
          ],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            worker_execute: true,
            api_denied: true,
            legacy_denied: true,
            migration_denied: true,
          },
        ],
      });
      await expect(
        workerPool.query(
          `SELECT * FROM resolve_active_wallet_address_ciphertext(
             $1::uuid, $2::uuid, 'eip155:1'::text
           )`,
          [randomUUID(), randomUUID()],
        ),
      ).resolves.toMatchObject({ rows: [] });
      await expectPostgresDenied(
        apiPool.query(
          `SELECT * FROM resolve_active_wallet_address_ciphertext(
             $1::uuid, $2::uuid, 'eip155:1'::text
           )`,
          [randomUUID(), randomUUID()],
        ),
        ['42501'],
      );
      await expectPostgresDenied(
        workerPool.query('SELECT address_ciphertext FROM registered_wallets'),
        ['42501'],
      );
      await migrationPool.query(
        `GRANT EXECUTE ON FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text)
         TO ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0025 schema verification failed',
      );
      await migrationPool.query(
        `REVOKE EXECUTE ON FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text)
         FROM ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();
      const rewrapFunctionIdentities = [
        'wallet_metadata_rewrap_state_sha256(smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea)',
        'enforce_wallet_metadata_rewrap_command_lifecycle()',
        'reject_wallet_metadata_rewrap_history_mutation()',
        'guard_wallet_metadata_seal_material()',
        'prepare_wallet_metadata_rewrap(uuid,uuid,uuid,smallint)',
        'complete_wallet_metadata_rewrap(uuid,uuid,uuid,text,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea)',
        'wallet_metadata_seal_key_retirement_readiness(smallint)',
        'verify_wallet_metadata_rewrap_state()',
      ] as const;
      await expect(
        migrationPool.query<{ runtime_denied: boolean }>(
          `SELECT pg_catalog.bool_and(
             NOT pg_catalog.has_function_privilege(runtime_role.role_name, identity, 'EXECUTE')
           ) AS runtime_denied
           FROM pg_catalog.unnest($1::text[]) AS runtime_role(role_name)
           CROSS JOIN pg_catalog.unnest($2::text[]) AS protected(identity)`,
          [
            [names.apiRuntimeRole, names.workerRuntimeRole, names.legacyRuntimeRole],
            rewrapFunctionIdentities,
          ],
        ),
      ).resolves.toMatchObject({ rows: [{ runtime_denied: true }] });
      for (const runtime of [apiPool, workerPool]) {
        const runtimeClient = await runtime.connect();
        try {
          await runtimeClient.query('BEGIN');
          await expect(
            runtimeClient.query(
              `SELECT pg_catalog.set_config(
                 'crypto_lending.wallet_metadata_rewrap_command', $1, true
               )`,
              [randomUUID()],
            ),
          ).resolves.toBeDefined();
          await expectPostgresDenied(
            runtimeClient.query(
              `UPDATE registered_wallets
               SET address_iv = $1::bytea
               WHERE wallet_id = $2::uuid`,
              [randomBytes(12), randomUUID()],
            ),
            ['42501'],
          );
        } finally {
          await runtimeClient.query('ROLLBACK').catch(() => undefined);
          runtimeClient.release();
        }
      }
      await expectPostgresDenied(
        apiPool.query(
          'SELECT * FROM prepare_wallet_metadata_rewrap($1::uuid, $2::uuid, $3::uuid, 2::smallint)',
          [randomUUID(), randomUUID(), randomUUID()],
        ),
        ['42501'],
      );
      await expectPostgresDenied(
        workerPool.query(
          'SELECT * FROM wallet_metadata_seal_key_retirement_readiness(1::smallint)',
        ),
        ['42501'],
      );
      const authKeyringRuntimeFunctionIdentities = [
        'complete_auth_login_keyring(uuid,text,text,smallint,bytea,smallint[],text[],uuid,uuid,uuid,uuid,smallint,bytea,smallint,bytea,integer,integer,text,text,text,uuid)',
        'resolve_auth_session_keyring(uuid,smallint[],text[],boolean,smallint[],text[],uuid)',
        'rotate_auth_session_keyring(uuid,smallint[],text[],uuid,smallint,bytea,smallint,bytea,uuid)',
        'revoke_auth_session_keyring(uuid,smallint[],text[],uuid)',
        'consume_auth_rate_limit_keyring(text,smallint[],text[],integer,integer,uuid)',
      ] as const;
      await expect(
        migrationPool.query<{ exact_acl: boolean }>(
          `SELECT pg_catalog.bool_and(
             pg_catalog.has_function_privilege($1, identity, 'EXECUTE')
             AND NOT pg_catalog.has_function_privilege($2, identity, 'EXECUTE')
             AND NOT pg_catalog.has_function_privilege($3, identity, 'EXECUTE')
             AND NOT pg_catalog.has_function_privilege($4, identity, 'EXECUTE')
           ) AS exact_acl
           FROM pg_catalog.unnest($5::text[]) AS runtime_function(identity)`,
          [
            names.apiRuntimeRole,
            names.workerRuntimeRole,
            names.legacyRuntimeRole,
            names.migrationRole,
            authKeyringRuntimeFunctionIdentities,
          ],
        ),
      ).resolves.toMatchObject({ rows: [{ exact_acl: true }] });
      await expect(
        apiPool.query(
          `SELECT * FROM resolve_auth_session_keyring(
             $1::uuid, ARRAY[1]::smallint[], ARRAY[$2::text]::text[],
             false, NULL::smallint[], NULL::text[], $3::uuid
           )`,
          [randomUUID(), randomBytes(32).toString('hex'), randomUUID()],
        ),
      ).resolves.toMatchObject({
        rows: [{ authentication_outcome: 'INVALID', account_id: null, session_family_id: null }],
      });
      await expectPostgresDenied(
        apiPool.query("SELECT * FROM auth_hmac_key_retirement_readiness('SESSION', 1::smallint)"),
        ['42501'],
      );
      const authMutationClient = await apiPool.connect();
      try {
        await authMutationClient.query('BEGIN');
        await expect(
          authMutationClient.query(
            `SELECT pg_catalog.set_config(
               'crypto_lending.auth_hmac_rotation_command', $1, true
             )`,
            [randomUUID()],
          ),
        ).resolves.toBeDefined();
        await authMutationClient.query('SAVEPOINT auth_base_update_denial');
        await expectPostgresDenied(
          authMutationClient.query(
            `UPDATE authentication_oidc_identities
             SET subject_digest = subject_digest
             WHERE false`,
          ),
          ['42501'],
        );
        await authMutationClient.query('ROLLBACK TO SAVEPOINT auth_base_update_denial');
        await authMutationClient.query('SAVEPOINT auth_alias_insert_denial');
        await expectPostgresDenied(
          authMutationClient.query(
            `INSERT INTO auth_oidc_identity_digest_aliases (
               identity_id, account_id, provider_key, issuer,
               subject_digest_version, subject_digest
             ) VALUES (
               $1::uuid, $2::uuid, 'primary', 'https://identity.example.test/tenant',
               1::smallint, $3::bytea
             )`,
            [randomUUID(), randomUUID(), randomBytes(32)],
          ),
          ['42501'],
        );
        await authMutationClient.query('ROLLBACK TO SAVEPOINT auth_alias_insert_denial');
      } finally {
        await authMutationClient.query('ROLLBACK').catch(() => undefined);
        authMutationClient.release();
      }
      for (const protectedWalletRotationTable of [
        'wallet_identity_key_policy',
        'wallet_ownership_challenge_identity_digests',
        'registered_wallet_identity_digests',
        'wallet_metadata_seal_iv_registry',
        'wallet_metadata_rewrap_commands',
        'wallet_metadata_rewrap_audit_events',
        'auth_hmac_key_policies',
        'auth_oidc_identity_digest_aliases',
      ]) {
        await expectPostgresDenied(apiPool.query(`SELECT * FROM ${protectedWalletRotationTable}`), [
          '42501',
        ]);
        await expectPostgresDenied(
          workerPool.query(`SELECT * FROM ${protectedWalletRotationTable}`),
          ['42501'],
        );
      }
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
             NOT pg_catalog.has_column_privilege(
               $1, 'job_outbox', 'ledger_command_id', 'INSERT'
             )
             AND NOT pg_catalog.has_column_privilege(
               $1, 'job_outbox', 'ledger_journal_id', 'INSERT'
             ) AS api_direct_ledger_link_insert_denied,
             pg_catalog.has_function_privilege(
               $1,
               to_regprocedure('enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)'),
               'EXECUTE'
             ) AS api_can_enqueue_reviewed_job,
             NOT pg_catalog.has_function_privilege(
               $2,
               to_regprocedure('enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)'),
               'EXECUTE'
             ) AS worker_enqueue_reviewed_job_denied,
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
            api_direct_ledger_link_insert_denied: true,
            api_can_enqueue_reviewed_job: true,
            worker_enqueue_reviewed_job_denied: true,
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
        'Database migration 0025 schema verification failed',
      );
      await migrationPool.query('REVOKE USAGE ON TYPE future_default_enum FROM PUBLIC');
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query(
        'CREATE TABLE future_non_ledger_row_type_probe (value integer NOT NULL)',
      );
      try {
        await expect(apiRunner.assertUpToDate()).rejects.toThrow(
          'Database migration 0025 schema verification failed',
        );
      } finally {
        await migrationPool.query('DROP TABLE future_non_ledger_row_type_probe');
      }
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query(
        `GRANT SELECT (book_id) ON TABLE ledger_books TO ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0025 schema verification failed',
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
        'Database migration 0025 schema verification failed',
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
        'Database migration 0025 schema verification failed',
      );
      await migrationPool.query(
        'REVOKE USAGE, SELECT, UPDATE ON SEQUENCE future_default_sequence FROM PUBLIC',
      );
      await expect(apiRunner.assertUpToDate()).resolves.toBeUndefined();

      await migrationPool.query('GRANT INSERT (id) ON TABLE job_outbox TO PUBLIC');
      await expect(apiRunner.assertUpToDate()).rejects.toThrow(
        'Database migration 0025 schema verification failed',
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
        'Database migration 0025 schema verification failed',
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
        'Database migration 0025 schema verification failed',
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
        'Database migration 0025 schema verification failed',
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

      const principalMigrationPool = migrationPool;
      if (!principalMigrationPool) throw new Error('Migration pool was not initialized');
      const registerWallet = async (
        ownerAccountId: string,
        networkId: ReviewedBalanceSyncIdentity['networkId'],
      ): Promise<string> => {
        const challengeId = randomUUID();
        const walletId = randomUUID();
        const addressDigest = randomBytes(32);
        const isEthereum = networkId === 'eip155:1';
        const chainNamespace = isEthereum ? 'eip155' : 'solana';
        const chainReference = isEthereum ? '1' : '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
        const proofScheme = isEthereum ? 'EVM_ERC4361_ERC191' : 'SOLANA_SIWS_SIGN_MESSAGE';
        await principalMigrationPool.query(
          `INSERT INTO wallet_ownership_challenges (
             challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
             registry_environment, registry_version, registry_fingerprint_sha256,
             address_digest_version, address_digest,
             domain_digest_version, domain_digest,
             message_digest_version, message_digest,
             nonce_digest_version, nonce_digest,
             status, created_at, issued_at, expires_at, completed_at, payload_destroyed_at
           ) VALUES (
             $1, $2, $3, $4, $5, 'MAINNET', 1, $6,
             1, $7, 1, $8, 1, $9, 1, $10,
             'REGISTERED', statement_timestamp() - interval '2 minutes',
             statement_timestamp() - interval '2 minutes',
             statement_timestamp() + interval '5 minutes',
             statement_timestamp() - interval '1 minute',
             statement_timestamp() - interval '1 minute'
           )`,
          [
            challengeId,
            ownerAccountId,
            proofScheme,
            chainNamespace,
            chainReference,
            MAINNET_REGISTRY_FINGERPRINT,
            addressDigest,
            randomBytes(32),
            randomBytes(32),
            randomBytes(32),
          ],
        );
        await principalMigrationPool.query(
          `INSERT INTO wallet_ownership_challenge_identity_digests (
             challenge_id, account_id, chain_namespace, chain_reference,
             address_digest_version, address_digest
           ) VALUES ($1, $2, $3, $4, 1, $5)`,
          [challengeId, ownerAccountId, chainNamespace, chainReference, addressDigest],
        );
        await principalMigrationPool.query(
          `INSERT INTO registered_wallets (
             wallet_id, account_id, registered_by_challenge_id,
             chain_namespace, chain_reference,
             registry_environment, registry_version, registry_fingerprint_sha256,
             address_digest_version, address_digest,
             address_key_version, address_ciphertext, address_iv, address_auth_tag,
             metadata_key_version, metadata_ciphertext, metadata_iv, metadata_auth_tag
           ) VALUES (
             $1, $2, $3, $4, $5, 'MAINNET', 1, $6,
             1, $7, 1, $8, $9, $10, 1, $11, $12, $13
           )`,
          [
            walletId,
            ownerAccountId,
            challengeId,
            chainNamespace,
            chainReference,
            MAINNET_REGISTRY_FINGERPRINT,
            addressDigest,
            Buffer.from('kan232-encrypted-address'),
            randomBytes(12),
            randomBytes(16),
            Buffer.from('kan232-encrypted-metadata'),
            randomBytes(12),
            randomBytes(16),
          ],
        );
        return walletId;
      };

      const ethereumWalletId = await registerWallet(accountId, 'eip155:1');
      const solanaWalletId = await registerWallet(
        accountId,
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      );
      const revokedWalletId = await registerWallet(accountId, 'eip155:1');
      const otherAccountId = randomUUID();
      await apiPool.query(
        `SELECT * FROM provision_account_profile($1, $2, NULL, 'US', $1, 'kan232:provision')`,
        [otherAccountId, 'kan232-other@example.test'],
      );
      const otherAccountWalletId = await registerWallet(otherAccountId, 'eip155:1');

      const firstOutboxId = 'kan232-job';
      const firstEnvelope = reviewedBalanceSyncEnvelope(firstOutboxId, {
        accountId,
        walletId: ethereumWalletId,
        networkId: 'eip155:1',
      });
      await expectPostgresDenied(
        apiPool.query(
          `INSERT INTO job_outbox (id, queue_name, payload, message_attributes)
           VALUES ($1, 'jobs', $2::jsonb, '{}'::jsonb)`,
          [firstOutboxId, firstEnvelope],
        ),
        ['42501'],
      );
      await expect(
        apiPool.query(
          `SELECT enqueue_reviewed_job_v1(
             $1::text, $2::text, $3::jsonb, $4::jsonb, $5::text, $6::text
           )`,
          [firstOutboxId, 'jobs', firstEnvelope, {}, null, null],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      const canonicalSolanaClient = await apiPool.connect();
      try {
        await canonicalSolanaClient.query('BEGIN');
        const canonicalSolanaId = 'kan232-solana-canonical';
        await expect(
          canonicalSolanaClient.query(
            `SELECT enqueue_reviewed_job_v1(
               $1::text, $2::text, $3::jsonb, $4::jsonb, $5::text, $6::text
             )`,
            [
              canonicalSolanaId,
              'jobs',
              reviewedBalanceSyncEnvelope(canonicalSolanaId, {
                accountId,
                walletId: solanaWalletId,
                networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
              }),
              {},
              null,
              null,
            ],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await canonicalSolanaClient.query('ROLLBACK');
        canonicalSolanaClient.release();
      }

      const rejectedCanary = 'private-key-rejected-outbox-canary';
      const destinationRejectedId = 'kan232-reject-destination';
      const kindRejectedId = 'kan232-reject-kind';
      const rootRejectedId = 'kan232-reject-root';
      const correlationRejectedId = 'kan232-reject-correlation';
      const networkRejectedId = 'kan232-reject-network';
      const attributesRejectedId = 'kan232-reject-attributes';
      const linkRejectedId = 'kan232-reject-link';
      const rejectedCases: ReadonlyArray<
        readonly [string, string, unknown, unknown, unknown, unknown]
      > = [
        [
          destinationRejectedId,
          'alternate-jobs',
          reviewedBalanceSyncEnvelope(destinationRejectedId),
          {},
          null,
          null,
        ],
        [
          kindRejectedId,
          'jobs',
          {
            ...reviewedBalanceSyncEnvelope(kindRejectedId),
            kind: 'future.unreviewed',
            payload: { rejectedCanary },
          },
          {},
          null,
          null,
        ],
        [
          rootRejectedId,
          'jobs',
          {
            ...reviewedBalanceSyncEnvelope(rootRejectedId),
            unexpected: rejectedCanary,
          },
          {},
          null,
          null,
        ],
        [
          correlationRejectedId,
          'jobs',
          {
            ...reviewedBalanceSyncEnvelope(correlationRejectedId),
            correlation: {
              correlationId: randomUUID(),
              requestId: randomUUID(),
            },
          },
          {},
          null,
          null,
        ],
        [
          networkRejectedId,
          'jobs',
          {
            ...reviewedBalanceSyncEnvelope(networkRejectedId),
            payload: {
              ...(reviewedBalanceSyncEnvelope(networkRejectedId).payload as Readonly<
                Record<string, unknown>
              >),
              networkId: 'eip155:8453',
            },
          },
          {},
          null,
          null,
        ],
        [
          attributesRejectedId,
          'jobs',
          reviewedBalanceSyncEnvelope(attributesRejectedId),
          { diagnostic: rejectedCanary },
          null,
          null,
        ],
        [
          linkRejectedId,
          'jobs',
          reviewedBalanceSyncEnvelope(linkRejectedId),
          {},
          randomUUID(),
          randomUUID(),
        ],
      ];
      for (const [id, destination, envelope, attributes, commandId, journalId] of rejectedCases) {
        let rejection: unknown;
        try {
          await apiPool.query(
            `SELECT enqueue_reviewed_job_v1(
               $1::text, $2::text, $3::jsonb, $4::jsonb, $5::text, $6::text
             )`,
            [id, destination, envelope, attributes, commandId, journalId],
          );
        } catch (error) {
          rejection = error;
        }
        expect(rejection).toMatchObject({
          code: '22023',
          message: 'reviewed outbox job rejected',
        });
        expect(String(rejection)).not.toContain(rejectedCanary);
        expect((rejection as { detail?: unknown }).detail).toBeUndefined();
        expect((rejection as { hint?: unknown }).hint).toBeUndefined();
      }

      const relationalRejections: ReadonlyArray<
        readonly [string, Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>]
      > = [
        [
          'kan232-reject-fabricated-wallet',
          reviewedBalanceSyncEnvelope('kan232-reject-fabricated-wallet', {
            accountId,
            walletId: randomUUID(),
            networkId: 'eip155:1',
          }),
          {},
        ],
        [
          'kan232-reject-cross-account-wallet',
          reviewedBalanceSyncEnvelope('kan232-reject-cross-account-wallet', {
            accountId,
            walletId: otherAccountWalletId,
            networkId: 'eip155:1',
          }),
          {},
        ],
        [
          'kan232-reject-wrong-wallet-network',
          reviewedBalanceSyncEnvelope('kan232-reject-wrong-wallet-network', {
            accountId,
            walletId: ethereumWalletId,
            networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          }),
          {},
        ],
        [
          'kan232-reject-fabricated-yield',
          reviewedYieldSubmissionEnvelope('kan232-reject-fabricated-yield', {
            actorAccountId: accountId,
            correlationId: randomUUID(),
            ledgerTransactionId: randomUUID(),
            occurredAt: '2026-09-04T12:00:00.000Z',
            operationId: randomUUID(),
            operationType: 'ALLOCATE',
            planReferenceId: randomUUID(),
            quoteReferenceId: randomUUID(),
          }),
          { operationType: 'ALLOCATE' },
        ],
      ];
      for (const [id, envelope, attributes] of relationalRejections) {
        let rejection: unknown;
        try {
          await apiPool.query(
            `SELECT enqueue_reviewed_job_v1(
               $1::text, 'jobs'::text, $2::jsonb, $3::jsonb, NULL::text, NULL::text
             )`,
            [id, envelope, attributes],
          );
        } catch (error) {
          rejection = error;
        }
        expect(rejection).toMatchObject({
          code: '22023',
          message: 'reviewed outbox job rejected',
        });
        expect((rejection as { detail?: unknown }).detail).toBeUndefined();
        expect((rejection as { hint?: unknown }).hint).toBeUndefined();
      }

      const revokedAdmissionClient = await apiPool.connect();
      try {
        await revokedAdmissionClient.query('BEGIN');
        await expect(
          revokedAdmissionClient.query('SELECT * FROM revoke_wallet_registration($1, $2, $3)', [
            accountId,
            revokedWalletId,
            randomUUID(),
          ]),
        ).resolves.toMatchObject({ rows: [{ revocation_outcome: 'REVOKED' }] });
        let revokedRejection: unknown;
        try {
          const revokedId = 'kan232-reject-revoked-wallet';
          await revokedAdmissionClient.query(
            `SELECT enqueue_reviewed_job_v1(
               $1::text, 'jobs'::text, $2::jsonb, '{}'::jsonb, NULL::text, NULL::text
             )`,
            [
              revokedId,
              reviewedBalanceSyncEnvelope(revokedId, {
                accountId,
                walletId: revokedWalletId,
                networkId: 'eip155:1',
              }),
            ],
          );
        } catch (error) {
          revokedRejection = error;
        }
        expect(revokedRejection).toMatchObject({
          code: '22023',
          message: 'reviewed outbox job rejected',
        });
        expect((revokedRejection as { detail?: unknown }).detail).toBeUndefined();
        expect((revokedRejection as { hint?: unknown }).hint).toBeUndefined();
      } finally {
        await revokedAdmissionClient.query('ROLLBACK');
        revokedAdmissionClient.release();
      }
      await expect(
        workerPool.query("SELECT id FROM job_outbox WHERE id LIKE 'kan232-reject-%'"),
      ).resolves.toMatchObject({ rows: [] });

      let duplicateRejection: unknown;
      try {
        await apiPool.query(
          `SELECT enqueue_reviewed_job_v1(
             $1::text, $2::text, $3::jsonb, $4::jsonb, $5::text, $6::text
           )`,
          [firstOutboxId, 'jobs', firstEnvelope, {}, null, null],
        );
      } catch (error) {
        duplicateRejection = error;
      }
      expect(duplicateRejection).toMatchObject({
        code: '22023',
        message: 'reviewed outbox job rejected',
      });
      await expect(
        workerPool.query('SELECT count(*)::integer AS count FROM job_outbox WHERE id = $1', [
          firstOutboxId,
        ]),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
      await expectPostgresDenied(
        workerPool.query(
          `SELECT enqueue_reviewed_job_v1(
             $1::text, $2::text, $3::jsonb, $4::jsonb, $5::text, $6::text
           )`,
          [
            'worker-function-denied',
            'jobs',
            reviewedBalanceSyncEnvelope('worker-function-denied'),
            {},
            null,
            null,
          ],
        ),
        ['42501'],
      );
      await expect(workerPool.query('SELECT id FROM job_outbox')).resolves.toMatchObject({
        rows: [{ id: firstOutboxId }],
      });
      await expect(
        workerPool.query(
          `UPDATE job_outbox SET locked_by = 'worker', locked_until = clock_timestamp() + interval '1 minute'
           WHERE id = $1`,
          [firstOutboxId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        workerPool.query(
          `UPDATE job_outbox
           SET attempts = attempts + 1, status = 'failed', available_at = clock_timestamp(),
               last_error = 'OUTBOX_TRANSPORT_FAILED', failed_at = clock_timestamp(),
               locked_by = NULL, locked_until = NULL
           WHERE id = $1 AND status = 'pending'`,
          [firstOutboxId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        workerPool.query("DELETE FROM job_outbox WHERE id = $1 AND status = 'failed'", [
          firstOutboxId,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
      const yieldLedgerTransactionId = randomUUID();
      const yieldOperationId = randomUUID();
      const yieldPlanReferenceId = randomUUID();
      const yieldQuoteReferenceId = randomUUID();
      const yieldCorrelationId = randomUUID();
      const yieldBook = await migrationPool.query<{ book_id: string }>(
        "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
      );
      const yieldBookId = yieldBook.rows[0]?.book_id;
      if (!yieldBookId) throw new Error('Operational ledger book was not provisioned');
      await migrationPool.query(
        `GRANT INSERT (
           transaction_id, tenant_account_id, book_id, intent_type,
           configuration_revision_reference_id
         ) ON ledger_transactions TO ${quoteIdentifier(names.apiRuntimeRole)}`,
      );
      const yieldEffectiveBase = Date.now() - 60_000;
      const yieldDigest = (): string => randomBytes(32).toString('hex');
      const yieldSubmitClient = await apiPool.connect();
      let canonicalYieldAccepted = false;
      try {
        await yieldSubmitClient.query('BEGIN');
        await yieldSubmitClient.query(
          `INSERT INTO ledger_transactions (
             transaction_id, tenant_account_id, book_id, intent_type,
             configuration_revision_reference_id
           ) VALUES ($1, $2, $3, 'DIRECT_SETTLEMENT', $4)`,
          [yieldLedgerTransactionId, accountId, yieldBookId, randomUUID()],
        );
        await yieldSubmitClient.query(
          `SELECT * FROM create_yield_operation(
             $1::uuid, $2::uuid, 'ALLOCATE', $3::uuid, $4::uuid, $5::uuid,
             $6::timestamptz, $7::uuid, 1::smallint, $8::text, 1::smallint, $9::text
           )`,
          [
            accountId,
            yieldOperationId,
            yieldLedgerTransactionId,
            yieldPlanReferenceId,
            yieldQuoteReferenceId,
            new Date(yieldEffectiveBase),
            yieldCorrelationId,
            yieldDigest(),
            yieldDigest(),
          ],
        );
        const transitionYield = (
          expectedState: string,
          nextState: string,
          reason: string,
          effectiveOffset: number,
        ): Promise<unknown> =>
          yieldSubmitClient.query(
            `SELECT * FROM transition_yield_operation(
               $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
               $6::timestamptz, NULL::uuid, $7::uuid, 1::smallint,
               $8::text, 1::smallint, $9::text
             )`,
            [
              accountId,
              yieldOperationId,
              expectedState,
              nextState,
              reason,
              new Date(yieldEffectiveBase + effectiveOffset),
              yieldCorrelationId,
              yieldDigest(),
              yieldDigest(),
            ],
          );
        await transitionYield('CREATED', 'QUOTED', 'QUOTE_CREATED', 1_000);
        await transitionYield('QUOTED', 'USER_APPROVED', 'USER_APPROVAL_RECORDED', 2_000);
        const submitted = await yieldSubmitClient.query<SubmittedYieldRow>(
          `SELECT submission_id, transition_recorded_at
           FROM transition_yield_operation(
             $1::uuid, $2::uuid, 'USER_APPROVED', 'SUBMITTED',
             'SUBMISSION_RECORDED', $3::timestamptz, NULL::uuid, $4::uuid,
             1::smallint, $5::text, 1::smallint, $6::text
           )`,
          [
            accountId,
            yieldOperationId,
            new Date(yieldEffectiveBase + 3_000),
            yieldCorrelationId,
            yieldDigest(),
            yieldDigest(),
          ],
        );
        const submittedRow = submitted.rows[0];
        if (!submittedRow?.submission_id) {
          throw new Error('Yield submission identifier was not created');
        }
        const submittedEnvelope = reviewedYieldSubmissionEnvelope(submittedRow.submission_id, {
          actorAccountId: accountId,
          correlationId: yieldCorrelationId,
          ledgerTransactionId: yieldLedgerTransactionId,
          occurredAt: submittedRow.transition_recorded_at.toISOString(),
          operationId: yieldOperationId,
          operationType: 'ALLOCATE',
          planReferenceId: yieldPlanReferenceId,
          quoteReferenceId: yieldQuoteReferenceId,
        });
        await yieldSubmitClient.query(
          `SELECT enqueue_reviewed_job_v1(
             $1::text, 'jobs'::text, $2::jsonb, $3::jsonb, NULL::text, NULL::text
           )`,
          [submittedRow.submission_id, submittedEnvelope, { operationType: 'ALLOCATE' }],
        );
        canonicalYieldAccepted = true;
      } finally {
        await yieldSubmitClient.query('ROLLBACK');
        yieldSubmitClient.release();
        await migrationPool.query(
          `REVOKE INSERT (
             transaction_id, tenant_account_id, book_id, intent_type,
             configuration_revision_reference_id
           ) ON ledger_transactions FROM ${quoteIdentifier(names.apiRuntimeRole)}`,
        );
      }
      expect(canonicalYieldAccepted).toBe(true);

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

      // These source rows exist only to exercise admission as the real runtime
      // principal. Remove them without weakening any trigger definition so the
      // suite can still prove the guarded full rollback on an empty schema.
      const fixtureCleanupAdmin = new Pool({
        connectionString: roleUrl(
          testDatabaseUrl as string,
          database,
          bootstrapRole,
          adminUrl.password,
        ),
        max: 1,
      });
      try {
        await fixtureCleanupAdmin.query("SET session_replication_role = 'replica'");
        await fixtureCleanupAdmin.query(
          `DELETE FROM wallet_registration_audit_events
           WHERE account_id = ANY($1::uuid[])`,
          [[accountId, otherAccountId]],
        );
        await fixtureCleanupAdmin.query(
          `DELETE FROM registered_wallets WHERE account_id = ANY($1::uuid[])`,
          [[accountId, otherAccountId]],
        );
        await fixtureCleanupAdmin.query(
          `DELETE FROM wallet_ownership_challenges WHERE account_id = ANY($1::uuid[])`,
          [[accountId, otherAccountId]],
        );
        // 0024 intentionally retains its IV/material evidence forever in real
        // operation. This local empty-schema rollback rehearsal removes only
        // test-generated evidence under the bootstrap superuser after the
        // corresponding source fixtures have been deleted.
        await fixtureCleanupAdmin.query(
          `ALTER TABLE wallet_metadata_seal_iv_registry
           DISABLE TRIGGER wallet_metadata_seal_iv_registry_append_only_row`,
        );
        await fixtureCleanupAdmin.query('DELETE FROM wallet_metadata_seal_iv_registry');
        await fixtureCleanupAdmin.query(
          `ALTER TABLE wallet_metadata_seal_iv_registry
           ENABLE ALWAYS TRIGGER wallet_metadata_seal_iv_registry_append_only_row`,
        );
      } finally {
        await fixtureCleanupAdmin.query('RESET session_replication_role').catch(() => undefined);
        await fixtureCleanupAdmin.end();
      }

      const beforeRuntimeMigration = await migrationPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM schema_migrations',
      );
      await expect(new MigrationRunner(apiPool, migrations).down(1)).rejects.toBeDefined();
      const pendingMigrations = [
        ...migrations,
        {
          id: '9999',
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
                  EXISTS (SELECT 1 FROM schema_migrations WHERE id = '9999') AS recorded`,
        ),
      ).resolves.toMatchObject({ rows: [{ object: null, recorded: false }] });

      await expect(runner.down(25)).resolves.toEqual([
        '0025',
        '0024',
        '0023',
        '0022',
        '0021',
        '0020',
        '0019',
        '0018',
        '0017',
        '0016',
        '0015',
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
        '0015',
        '0016',
        '0017',
        '0018',
        '0019',
        '0020',
        '0021',
        '0022',
        '0023',
        '0024',
        '0025',
      ]);
      for (let readinessAttempt = 0; readinessAttempt < 3; readinessAttempt += 1) {
        await expect(
          new MigrationRunner(apiPool, migrations).assertUpToDate(),
        ).resolves.toBeUndefined();
        await expect(
          new MigrationRunner(workerPool, migrations).assertUpToDate(),
        ).resolves.toBeUndefined();
      }

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
        rows: [{ count: 25 }],
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

      const forwardOnlyRunner = new MigrationRunner(migrationPool, forwardOnlyMigrations);
      await expect(forwardOnlyRunner.up()).resolves.toEqual(['0026', '0027', '0028']);
      await expect(forwardOnlyRunner.assertUpToDate()).resolves.toBeUndefined();
      await expect(
        migrationPool.query<{ valid: boolean }>(
          genericWorkerBalanceAuthoritySuspensionMigration.verifySql,
        ),
      ).resolves.toMatchObject({ rows: [{ valid: true }] });
      for (const runtimePoolInstance of [apiNewPool, workerNewPool]) {
        await expect(
          new MigrationRunner(runtimePoolInstance, forwardOnlyMigrations).assertUpToDate(),
        ).resolves.toBeUndefined();
        await expect(
          runtimePoolInstance.query('SELECT * FROM balance_sync_financial_agreement_evidence'),
        ).rejects.toBeDefined();
        await expect(
          runtimePoolInstance.query(
            "SELECT record_balance_sync_financial_agreement_evidence('{}'::jsonb)",
          ),
        ).rejects.toBeDefined();
      }
      await expect(
        workerNewPool.query<{ may_record_stablecoin_price: boolean }>(
          `SELECT pg_catalog.has_function_privilege(
             current_user,
             'record_stablecoin_price_evidence(uuid,text,text,timestamp with time zone,text,text,text,smallint,text,text,text,text,smallint,text,text,numeric,text,timestamp with time zone,timestamp with time zone,numeric,smallint,text,numeric,smallint,text,text,text)',
             'EXECUTE'
           ) AS may_record_stablecoin_price`,
        ),
      ).resolves.toMatchObject({ rows: [{ may_record_stablecoin_price: false }] });
      await expect(
        workerNewPool.query<{ balance_authority_suspended: boolean }>(
          `SELECT pg_catalog.bool_and(
             NOT pg_catalog.has_function_privilege(current_user, function_identity, 'EXECUTE')
           ) AS balance_authority_suspended
           FROM pg_catalog.unnest(ARRAY[
             'read_balance_sync_checkpoint(uuid,uuid,text)',
             'record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
             'mark_balance_sync_checkpoint_stale(uuid,uuid,text,bigint,timestamp with time zone,text)',
             'replace_balance_sync_after_reorg(uuid,uuid,text,bigint,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
             'resolve_active_wallet_address_ciphertext(uuid,uuid,text)'
           ]::text[]) AS suspended(function_identity)`,
        ),
      ).resolves.toMatchObject({ rows: [{ balance_authority_suspended: true }] });

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
