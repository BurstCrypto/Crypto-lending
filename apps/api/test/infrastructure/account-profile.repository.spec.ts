import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

import { parseAccountId, type AccountId } from '../../src/accounts/domain/account-profile';
import { PostgresAccountProfileRepository } from '../../src/accounts/infrastructure/postgres-account-profile.repository';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;
const RUNTIME_ROLE_LOCK_KEY = 1_923_607_436;

function newAccountId(): AccountId {
  return parseAccountId(randomUUID());
}

describeWithPostgres('PostgreSQL account profile repository', () => {
  const schema = `kan36_profiles_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let runtimeRoleLockClient: PoolClient;
  let pool: Pool;
  let migrations: MigrationRunner;
  let repository: PostgresAccountProfileRepository;
  let runtimeRoleCreated = false;

  async function withRuntimeClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE crypto_runtime');
      return await work(client);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  }

  async function withRuntimeRepository<T>(
    work: (runtimeRepository: PostgresAccountProfileRepository) => Promise<T>,
  ): Promise<T> {
    return withRuntimeClient(async (client) => {
      const runtimePostgres = {
        query: client.query.bind(client),
      } as unknown as PostgresService;
      return work(new PostgresAccountProfileRepository(runtimePostgres));
    });
  }

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: testDatabaseUrl as string });
    runtimeRoleLockClient = await adminPool.connect();
    await runtimeRoleLockClient.query('SELECT pg_advisory_lock($1)', [RUNTIME_ROLE_LOCK_KEY]);
    const runtimeRole = await runtimeRoleLockClient.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'crypto_runtime'
       ) AS exists`,
    );
    if (!runtimeRole.rows[0]?.exists) {
      await runtimeRoleLockClient.query('CREATE ROLE crypto_runtime NOLOGIN NOINHERIT');
      runtimeRoleCreated = true;
    }
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 5,
      options: `-c search_path=${schema}`,
    });
    migrations = new MigrationRunner(pool, DATABASE_SCHEMA_MIGRATION_LIST);
    await migrations.up();
    repository = new PostgresAccountProfileRepository(new PostgresService(pool));
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        if (runtimeRoleCreated) {
          await runtimeRoleLockClient.query('DROP ROLE IF EXISTS crypto_runtime');
        }
      } finally {
        if (runtimeRoleLockClient) {
          await runtimeRoleLockClient.query('SELECT pg_advisory_unlock($1)', [
            RUNTIME_ROLE_LOCK_KEY,
          ]);
          runtimeRoleLockClient.release();
        }
        await adminPool.end();
      }
    }
  });

  it('provisions once through the runtime boundary and rejects a duplicate UUID', async () => {
    const accountId = newAccountId();
    const first = await withRuntimeRepository((runtimeRepository) =>
      runtimeRepository.provisionForAccount(
        {
          accountId,
          contactEmail: 'first@example.test',
          contactPhone: '+12025550123',
          declaredResidencyCountryCode: 'US',
        },
        { actorAccountId: accountId, correlationId: 'request:provision-1' },
      ),
    );

    expect(first).toMatchObject({
      accountId,
      contactEmail: 'first@example.test',
      contactPhone: '+12025550123',
      declaredResidencyCountryCode: 'US',
      eligibilityStatus: 'UNKNOWN',
      version: 1,
    });
    expect(first.createdAt).toBeInstanceOf(Date);
    expect(first.updatedAt).toEqual(first.createdAt);

    await expect(
      withRuntimeRepository((runtimeRepository) =>
        runtimeRepository.provisionForAccount(
          {
            accountId,
            contactEmail: 'mismatch@example.test',
            contactPhone: null,
            declaredResidencyCountryCode: 'GB',
          },
          { actorAccountId: accountId, correlationId: 'request:provision-duplicate' },
        ),
      ),
    ).rejects.toThrow('Account profile persistence operation failed');
    await expect(repository.findByAccountId(accountId)).resolves.toEqual(first);

    const rowCounts = await pool.query<{ accounts: number; profiles: number }>(
      `SELECT
         (SELECT count(*)::integer FROM accounts WHERE account_id = $1) AS accounts,
         (SELECT count(*)::integer FROM account_profiles WHERE account_id = $1) AS profiles`,
      [accountId],
    );
    expect(rowCounts.rows).toEqual([{ accounts: 1, profiles: 1 }]);

    const audit = await pool.query<{
      action: string;
      result: string;
      before_version: number | null;
      after_version: number;
      changed_fields: string[];
      correlation_id: string;
    }>(
      `SELECT action,
              result,
              before_version,
              after_version,
              changed_fields,
              correlation_id
       FROM account_profile_audit
       WHERE account_id = $1`,
      [accountId],
    );
    expect(audit.rows).toEqual([
      {
        action: 'PROVISIONED',
        result: 'SUCCEEDED',
        before_version: null,
        after_version: 1,
        changed_fields: ['contactEmail', 'contactPhone', 'declaredResidencyCountryCode'],
        correlation_id: 'request:provision-1',
      },
    ]);
  });

  it('applies one atomic versioned update and distinguishes stale from missing', async () => {
    const accountId = newAccountId();
    await repository.provisionForAccount(
      {
        accountId,
        contactEmail: 'before@example.test',
        contactPhone: '+442071838750',
        declaredResidencyCountryCode: 'GB',
      },
      { actorAccountId: accountId, correlationId: 'request:update-provision' },
    );

    const updated = await withRuntimeRepository((runtimeRepository) =>
      runtimeRepository.update(
        accountId,
        1,
        {
          contactEmail: 'after@example.test',
          contactPhone: null,
          declaredResidencyCountryCode: 'CA',
        },
        { actorAccountId: accountId, correlationId: 'request:update-1' },
      ),
    );
    expect(updated).toMatchObject({
      status: 'updated',
      profile: {
        accountId,
        contactEmail: 'after@example.test',
        contactPhone: null,
        declaredResidencyCountryCode: 'CA',
        eligibilityStatus: 'UNKNOWN',
        version: 2,
      },
    });
    if (updated.status !== 'updated') throw new Error('Expected updated profile');
    expect(updated.profile.updatedAt.getTime()).toBeGreaterThan(
      updated.profile.createdAt.getTime(),
    );

    await expect(
      withRuntimeRepository((runtimeRepository) =>
        runtimeRepository.update(
          accountId,
          1,
          { contactEmail: 'stale@example.test' },
          { actorAccountId: accountId, correlationId: 'request:update-stale' },
        ),
      ),
    ).resolves.toEqual({ status: 'stale' });

    const missingAccountId = newAccountId();
    await expect(
      withRuntimeRepository((runtimeRepository) =>
        runtimeRepository.update(
          missingAccountId,
          1,
          { contactEmail: 'missing@example.test' },
          {
            actorAccountId: missingAccountId,
            correlationId: 'request:update-missing',
          },
        ),
      ),
    ).resolves.toEqual({ status: 'not-found' });

    const audit = await pool.query<{
      action: string;
      result: string;
      before_version: number | null;
      after_version: number;
      changed_fields: string[];
    }>(
      `SELECT action, result, before_version, after_version, changed_fields
       FROM account_profile_audit
       WHERE account_id = $1
       ORDER BY after_version`,
      [accountId],
    );
    expect(audit.rows).toEqual([
      {
        action: 'PROVISIONED',
        result: 'SUCCEEDED',
        before_version: null,
        after_version: 1,
        changed_fields: ['contactEmail', 'contactPhone', 'declaredResidencyCountryCode'],
      },
      {
        action: 'UPDATED',
        result: 'SUCCEEDED',
        before_version: 1,
        after_version: 2,
        changed_fields: ['contactEmail', 'contactPhone', 'declaredResidencyCountryCode'],
      },
    ]);
  });

  it('denies runtime table mutation and audit access while binding actor to target', async () => {
    const accountId = newAccountId();
    await withRuntimeRepository((runtimeRepository) =>
      runtimeRepository.provisionForAccount(
        {
          accountId,
          contactEmail: 'runtime@example.test',
          contactPhone: null,
          declaredResidencyCountryCode: 'CA',
        },
        { actorAccountId: accountId, correlationId: 'request:runtime-provision' },
      ),
    );

    await withRuntimeClient(async (client) => {
      await expect(
        client.query('INSERT INTO accounts (account_id) VALUES ($1)', [newAccountId()]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query('UPDATE account_profiles SET contact_email = $2 WHERE account_id = $1', [
          accountId,
          'blocked@example.test',
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(
          `INSERT INTO account_profile_audit (
             account_id,
             actor_account_id,
             correlation_id,
             action,
             before_version,
             after_version,
             changed_fields
           ) VALUES ($1, $1, 'request:blocked-audit', 'UPDATED', 1, 2, ARRAY['contactEmail'])`,
          [accountId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(client.query('SELECT * FROM account_profile_audit')).rejects.toMatchObject({
        code: '42501',
      });
    });

    const mismatchedActorId = newAccountId();
    const mismatchedTargetId = newAccountId();
    await expect(
      withRuntimeRepository((runtimeRepository) =>
        runtimeRepository.provisionForAccount(
          {
            accountId: mismatchedTargetId,
            contactEmail: 'forbidden@example.test',
            contactPhone: null,
            declaredResidencyCountryCode: 'US',
          },
          {
            actorAccountId: mismatchedActorId,
            correlationId: 'request:actor-mismatch-provision',
          },
        ),
      ),
    ).rejects.toThrow('Account profile persistence operation failed');
    await expect(
      withRuntimeRepository((runtimeRepository) =>
        runtimeRepository.update(
          accountId,
          1,
          { contactEmail: 'forbidden@example.test' },
          {
            actorAccountId: mismatchedActorId,
            correlationId: 'request:actor-mismatch-update',
          },
        ),
      ),
    ).rejects.toThrow('Account profile persistence operation failed');

    const protectedState = await pool.query<{
      audit_count: number;
      contact_email: string;
      mismatched_target_count: number;
      version: number;
    }>(
      `SELECT profile.contact_email,
              profile.version,
              (
                SELECT count(*)::integer
                FROM account_profile_audit
                WHERE account_id = profile.account_id
              ) AS audit_count,
              (
                SELECT count(*)::integer
                FROM accounts
                WHERE account_id = $2
              ) AS mismatched_target_count
       FROM account_profiles AS profile
       WHERE profile.account_id = $1`,
      [accountId, mismatchedTargetId],
    );
    expect(protectedState.rows).toEqual([
      {
        audit_count: 1,
        contact_email: 'runtime@example.test',
        mismatched_target_count: 0,
        version: 1,
      },
    ]);
  });

  it('rolls back a mutation when an audit insert is suppressed', async () => {
    const existingAccountId = newAccountId();
    await repository.provisionForAccount(
      {
        accountId: existingAccountId,
        contactEmail: 'before-suppression@example.test',
        contactPhone: null,
        declaredResidencyCountryCode: 'US',
      },
      { actorAccountId: existingAccountId, correlationId: 'request:suppression-setup' },
    );

    await pool.query(`
      CREATE FUNCTION suppress_test_account_profile_audit_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog
      AS $$
      BEGIN
        RETURN NULL;
      END;
      $$;
      CREATE TRIGGER suppress_test_account_profile_audit_insert_trigger
        BEFORE INSERT ON account_profile_audit
        FOR EACH ROW EXECUTE FUNCTION suppress_test_account_profile_audit_insert();
    `);

    const suppressedProvisionId = newAccountId();
    try {
      await expect(
        withRuntimeRepository((runtimeRepository) =>
          runtimeRepository.provisionForAccount(
            {
              accountId: suppressedProvisionId,
              contactEmail: 'suppressed@example.test',
              contactPhone: null,
              declaredResidencyCountryCode: 'CA',
            },
            {
              actorAccountId: suppressedProvisionId,
              correlationId: 'request:suppressed-provision',
            },
          ),
        ),
      ).rejects.toThrow('Account profile persistence operation failed');
      await expect(
        withRuntimeRepository((runtimeRepository) =>
          runtimeRepository.update(
            existingAccountId,
            1,
            { contactEmail: 'suppressed-update@example.test' },
            {
              actorAccountId: existingAccountId,
              correlationId: 'request:suppressed-update',
            },
          ),
        ),
      ).rejects.toThrow('Account profile persistence operation failed');
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS suppress_test_account_profile_audit_insert_trigger
           ON account_profile_audit;
         DROP FUNCTION IF EXISTS suppress_test_account_profile_audit_insert();`,
      );
    }

    const persisted = await pool.query<{
      audit_count: number;
      contact_email: string;
      suppressed_account_count: number;
      version: number;
    }>(
      `SELECT profile.contact_email,
              profile.version,
              (
                SELECT count(*)::integer
                FROM account_profile_audit
                WHERE account_id = profile.account_id
              ) AS audit_count,
              (
                SELECT count(*)::integer
                FROM accounts
                WHERE account_id = $2
              ) AS suppressed_account_count
       FROM account_profiles AS profile
       WHERE profile.account_id = $1`,
      [existingAccountId, suppressedProvisionId],
    );
    expect(persisted.rows).toEqual([
      {
        audit_count: 1,
        contact_email: 'before-suppression@example.test',
        suppressed_account_count: 0,
        version: 1,
      },
    ]);
  });

  it('round-trips an injection-shaped valid contact as data through PostgreSQL', async () => {
    const accountId = newAccountId();
    const injectionShapedEmail = "admin'--@example.test";

    const provisioned = await repository.provisionForAccount(
      {
        accountId,
        contactEmail: injectionShapedEmail,
        contactPhone: null,
        declaredResidencyCountryCode: 'US',
      },
      { actorAccountId: accountId, correlationId: 'request:injection-shaped-data' },
    );

    expect(provisioned.contactEmail).toBe(injectionShapedEmail);
    await expect(repository.findByAccountId(accountId)).resolves.toMatchObject({
      accountId,
      contactEmail: injectionShapedEmail,
      eligibilityStatus: 'UNKNOWN',
    });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM accounts'),
    ).resolves.toMatchObject({ rows: [expect.objectContaining({ count: expect.any(Number) })] });
  });

  it.each([
    'tést@example.test',
    'two@@example.test',
    '.start@example.test',
    'double..dot@example.test',
    'name@Example.test',
    'name@-invalid.test',
    'name@example..test',
  ])('rejects malformed contact email at the database boundary: %s', async (contactEmail) => {
    const accountId = newAccountId();
    await pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);
    await expect(
      pool.query(
        `INSERT INTO account_profiles (
           account_id,
           contact_email,
           contact_phone,
           declared_residency_country_code
         ) VALUES ($1, $2, NULL, 'CA')`,
        [accountId, contactEmail],
      ),
    ).rejects.toBeDefined();
  });

  it('enforces assigned countries, UUIDv4 identities, and immutable managed fields', async () => {
    const invalidVersionUuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    await expect(
      pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [invalidVersionUuid]),
    ).rejects.toBeDefined();

    const accountId = newAccountId();
    await pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);
    await expect(
      pool.query(
        `INSERT INTO account_profiles (
           account_id,
           contact_email,
           declared_residency_country_code
         ) VALUES ($1, 'valid@example.test', 'ZZ')`,
        [accountId],
      ),
    ).rejects.toBeDefined();

    await pool.query(
      `INSERT INTO account_profiles (
         account_id,
         contact_email,
         declared_residency_country_code
       ) VALUES ($1, 'valid@example.test', 'CA')`,
      [accountId],
    );
    await expect(
      pool.query("UPDATE accounts SET eligibility_status = 'ELIGIBLE' WHERE account_id = $1", [
        accountId,
      ]),
    ).rejects.toBeDefined();
    await expect(
      pool.query(
        "UPDATE account_profiles SET created_at = created_at - INTERVAL '1 day' WHERE account_id = $1",
        [accountId],
      ),
    ).rejects.toBeDefined();
    await expect(
      pool.query('UPDATE account_profiles SET version = version + 1 WHERE account_id = $1', [
        accountId,
      ]),
    ).rejects.toBeDefined();
  });

  it('keeps audit rows PII-free and append-only', async () => {
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'account_profile_audit'
       ORDER BY ordinal_position`,
      [schema],
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'audit_id',
      'account_id',
      'actor_account_id',
      'correlation_id',
      'action',
      'result',
      'before_version',
      'after_version',
      'changed_fields',
      'occurred_at',
    ]);
    await expect(
      pool.query("UPDATE account_profile_audit SET result = 'SUCCEEDED'"),
    ).rejects.toThrow('append-only');
    await expect(pool.query('DELETE FROM account_profile_audit')).rejects.toThrow('append-only');
    await expect(pool.query('TRUNCATE account_profile_audit')).rejects.toThrow('append-only');
  });

  it('fails migration verification on required column type, nullability, or default drift', async () => {
    try {
      await pool.query(
        'ALTER TABLE account_profile_audit ALTER COLUMN correlation_id TYPE varchar(128)',
      );
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query('ALTER TABLE account_profile_audit ALTER COLUMN correlation_id TYPE text');
    }
    await expect(migrations.assertUpToDate()).resolves.toBeUndefined();

    try {
      await pool.query('ALTER TABLE account_profiles ALTER COLUMN contact_email DROP NOT NULL');
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query('ALTER TABLE account_profiles ALTER COLUMN contact_email SET NOT NULL');
    }
    await expect(migrations.assertUpToDate()).resolves.toBeUndefined();

    try {
      await pool.query('ALTER TABLE account_profiles ALTER COLUMN version SET DEFAULT 2');
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query('ALTER TABLE account_profiles ALTER COLUMN version SET DEFAULT 1');
    }
    await expect(migrations.assertUpToDate()).resolves.toBeUndefined();
  });

  it('fails verification on boundary function or runtime privilege drift', async () => {
    const provisionSignature = 'provision_account_profile(uuid, text, text, text, uuid, text)';
    const originalProvisionFunction = await pool.query<{ definition: string }>(
      `SELECT pg_catalog.pg_get_functiondef(
         to_regprocedure('provision_account_profile(uuid,text,text,text,uuid,text)')
       ) AS definition`,
    );
    const originalDefinition = originalProvisionFunction.rows[0]?.definition;
    if (!originalDefinition) throw new Error('Expected provision boundary function');

    try {
      await pool.query(`
        CREATE OR REPLACE FUNCTION provision_account_profile(
          requested_account_id uuid,
          requested_contact_email text,
          requested_contact_phone text,
          requested_residency_country_code text,
          requested_actor_account_id uuid,
          requested_correlation_id text
        )
        RETURNS TABLE (
          profile_account_id uuid,
          profile_contact_email text,
          profile_contact_phone text,
          profile_residency_country_code text,
          account_eligibility_status text,
          profile_version integer,
          profile_created_at timestamptz,
          profile_updated_at timestamptz
        )
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path TO pg_catalog, "${schema}", pg_temp
        AS $permissive_replacement$
        BEGIN
          RETURN QUERY SELECT requested_account_id,
                              requested_contact_email,
                              requested_contact_phone,
                              requested_residency_country_code,
                              'UNKNOWN'::text,
                              1,
                              statement_timestamp(),
                              statement_timestamp();
        END;
        $permissive_replacement$;
      `);
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query(originalDefinition);
    }
    await expect(migrations.assertUpToDate()).resolves.toBeUndefined();

    try {
      await pool.query(`ALTER FUNCTION ${provisionSignature} SECURITY INVOKER`);
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query(`ALTER FUNCTION ${provisionSignature} SECURITY DEFINER`);
    }

    try {
      await pool.query(`GRANT UPDATE ON TABLE accounts TO crypto_runtime`);
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query(`REVOKE UPDATE ON TABLE accounts FROM crypto_runtime`);
    }

    try {
      await pool.query(`GRANT SELECT ON TABLE accounts TO crypto_runtime WITH GRANT OPTION`);
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query(`REVOKE GRANT OPTION FOR SELECT ON TABLE accounts FROM crypto_runtime`);
    }

    try {
      await pool.query(
        `GRANT EXECUTE ON FUNCTION ${provisionSignature}
         TO crypto_runtime WITH GRANT OPTION`,
      );
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query(
        `REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION ${provisionSignature}
         FROM crypto_runtime`,
      );
    }

    try {
      await pool.query(`GRANT EXECUTE ON FUNCTION ${provisionSignature} TO PUBLIC`);
      await expect(migrations.assertUpToDate()).rejects.toThrow(
        'Database migration 0004 schema verification failed',
      );
    } finally {
      await pool.query(`REVOKE EXECUTE ON FUNCTION ${provisionSignature} FROM PUBLIC`);
    }
    await expect(migrations.assertUpToDate()).resolves.toBeUndefined();
  });

  it('fails migration verification when a required structure is disabled or removed', async () => {
    await pool.query(
      'ALTER TABLE account_profiles DISABLE TRIGGER account_profiles_managed_update_trigger',
    );
    await expect(migrations.assertUpToDate()).rejects.toThrow(
      'Database migration 0004 schema verification failed',
    );
    await pool.query(
      'ALTER TABLE account_profiles ENABLE TRIGGER account_profiles_managed_update_trigger',
    );

    await pool.query(
      'ALTER TABLE account_profiles ENABLE REPLICA TRIGGER account_profiles_managed_update_trigger',
    );
    await expect(migrations.assertUpToDate()).rejects.toThrow(
      'Database migration 0004 schema verification failed',
    );
    await pool.query(
      'ALTER TABLE account_profiles ENABLE TRIGGER account_profiles_managed_update_trigger',
    );
    await expect(migrations.assertUpToDate()).resolves.toBeUndefined();

    await pool.query(`
      CREATE OR REPLACE FUNCTION enforce_account_profile_update()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog
      AS $$
      BEGIN
        RETURN NEW;
      END;
      $$
    `);
    await expect(migrations.assertUpToDate()).rejects.toThrow(
      'Database migration 0004 schema verification failed',
    );
    await pool.query(`
      CREATE OR REPLACE FUNCTION enforce_account_profile_update()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog
      AS $$
      BEGIN
        IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
          RAISE EXCEPTION 'profile account identity is immutable' USING ERRCODE = '23514';
        END IF;
        IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'profile creation timestamp is immutable' USING ERRCODE = '23514';
        END IF;
        IF NEW.version IS DISTINCT FROM OLD.version THEN
          RAISE EXCEPTION 'profile version is managed by the database' USING ERRCODE = '23514';
        END IF;
        IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
          RAISE EXCEPTION 'profile update timestamp is managed by the database'
            USING ERRCODE = '23514';
        END IF;

        NEW.version := OLD.version + 1;
        NEW.updated_at := greatest(
          statement_timestamp(),
          OLD.updated_at + INTERVAL '1 microsecond'
        );
        RETURN NEW;
      END;
      $$
    `);
    await expect(migrations.assertUpToDate()).resolves.toBeUndefined();

    await pool.query('DROP INDEX account_profile_audit_correlation_idx');
    await expect(migrations.assertUpToDate()).rejects.toThrow(
      'Database migration 0004 schema verification failed',
    );
    await pool.query(
      `CREATE INDEX account_profile_audit_correlation_idx
       ON account_profile_audit (correlation_id, occurred_at, audit_id)`,
    );
    await expect(migrations.assertUpToDate()).resolves.toBeUndefined();
  });
});
