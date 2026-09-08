import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PRODUCTION_DATABASE_PRINCIPALS } from '../../src/infrastructure/database/migrations/0005-enforce-database-principal-boundaries.migration';
import { createBalanceSyncReadModelTestSchemaMigrationV0020 } from '../../src/infrastructure/database/migrations/0020-create-balance-sync-read-model.migration';
import { createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021 } from '../../src/infrastructure/database/migrations/0021-create-stablecoin-price-evidence-read-model.migration';
import { suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026 } from '../../src/infrastructure/database/migrations/0026-suspend-stablecoin-ingestion-authority.migration';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { postgresStartupOptions } from '../../src/infrastructure/database/postgres-startup-options';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import type { RecordStablecoinPriceEvidenceRequest } from '../../src/valuation/application/ports/stablecoin-price-evidence-store.port';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  type StablecoinPriceObservation,
  type StablecoinValuationAssetReference,
} from '../../src/valuation/domain/stablecoin-valuation-policy';
import {
  PostgresPortfolioPriceEvidenceReader,
  PostgresStablecoinPriceEvidenceWriter,
  StablecoinPriceEvidencePersistenceError,
} from '../../src/valuation/infrastructure/postgres/postgres-stablecoin-price-evidence.store';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const READ_FUNCTION =
  'read_stablecoin_price_evidence(text,smallint,text,text,text,text,smallint,timestamp with time zone)';
const RECORD_FUNCTION =
  'record_stablecoin_price_evidence(uuid,text,text,timestamp with time zone,text,text,text,smallint,text,text,text,text,smallint,text,text,numeric,text,timestamp with time zone,timestamp with time zone,numeric,smallint,text,numeric,smallint,text,text,text)';
const ETHEREUM_USDC: StablecoinValuationAssetReference = Object.freeze({
  registryEnvironment: 'MAINNET',
  registryVersion: 1,
  registryFingerprintSha256: FINGERPRINT,
  stablecoin: 'USDC',
  networkId: 'eip155:1',
  identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
});
const SOLANA_USDC: StablecoinValuationAssetReference = Object.freeze({
  registryEnvironment: 'MAINNET',
  registryVersion: 1,
  registryFingerprintSha256: FINGERPRINT,
  stablecoin: 'USDC',
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  identity: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
});

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Stablecoin price evidence integration test requires loopback PostgreSQL');
  }
}

function at(base: string, offsetMilliseconds: number): string {
  return new Date(Date.parse(base) + offsetMilliseconds).toISOString();
}

function pythObservation(options: {
  readonly asset: StablecoinValuationAssetReference;
  readonly sequence: string;
  readonly updateId: string;
  readonly observedAt: string;
}): StablecoinPriceObservation {
  return {
    asset: options.asset,
    sourceId: 'PYTH_CORE',
    sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES.USDC.PYTH_CORE,
    sourceSequence: options.sequence,
    sourceUpdateId: options.updateId,
    pricedAt: at(options.observedAt, -1_000),
    observedAt: options.observedAt,
    usdRateMantissa: '99990000',
    usdRateScale: 8,
    confidence: { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '5000', scale: 8 },
  };
}

function recordRequest(options: {
  readonly asset: StablecoinValuationAssetReference;
  readonly sequence: string;
  readonly updateId: string;
  readonly observedAt: string;
  readonly verifiedAt: string;
  readonly correlationId?: string;
  readonly evidenceFingerprint?: string;
}): RecordStablecoinPriceEvidenceRequest {
  return {
    correlationId: options.correlationId ?? randomUUID(),
    evidenceActorReferenceId: 'pyth-adapter:postgres-integration',
    evidenceFingerprintSha256: options.evidenceFingerprint ?? randomBytes(32).toString('hex'),
    verifiedAt: options.verifiedAt,
    observation: pythObservation(options),
  };
}

async function queryAsRole<Row extends QueryResultRow>(
  pool: Pool,
  role: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    const result = await client.query<Row>(text, values as unknown[]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function asRole<T>(
  postgres: PostgresService,
  role: string,
  work: () => Promise<T>,
): Promise<T> {
  return postgres.withTransaction(async (client: PoolClient) => {
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    return work();
  });
}

async function priceReaderAsRole<T>(
  schema: string,
  role: string,
  work: (reader: PostgresPortfolioPriceEvidenceReader) => Promise<T>,
): Promise<T> {
  if (!IDENTIFIER.test(schema)) throw new Error('Unsafe price evidence test schema');
  const rolePool = new Pool({
    connectionString: testDatabaseUrl,
    max: 1,
    options: `${postgresStartupOptions(role)} -c search_path=${schema},pg_temp`,
  });
  try {
    return await work(new PostgresPortfolioPriceEvidenceReader(new PostgresService(rolePool)));
  } finally {
    await rolePool.end();
  }
}

describeWithPostgres('stablecoin price evidence PostgreSQL controls', () => {
  jest.setTimeout(120_000);

  const schema = `price_evidence_${randomBytes(8).toString('hex')}`;
  const genericRole = `price_evidence_generic_${randomBytes(6).toString('hex')}`;
  // Audit the 0026 suspension catalog before successor authority changes.
  const migrations = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(({ id }) => id <= '0026');
  if (!migrations.some(({ id }) => id === '0020')) {
    migrations.push(createBalanceSyncReadModelTestSchemaMigrationV0020);
  }
  if (!migrations.some(({ id }) => id === '0021')) {
    migrations.push(createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021);
  }
  const expectedMigrationIds = migrations.map(({ id }) => id);
  let adminPool: Pool;
  let operationPool: Pool;
  let postgres: PostgresService;
  let runner: MigrationRunner;
  let baseTime: string;

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const fixtureIdentity = await adminPool.query<{
      database: string;
      bootstrap_role: string;
      marker: string | null;
    }>(
      `SELECT pg_catalog.current_database() AS database, session_user AS bootstrap_role,
              pg_catalog.current_setting(
                'crypto_lending.local_principal_fixture', true
              ) AS marker`,
    );
    assertLocalPrincipalFixture({
      database: fixtureIdentity.rows[0]?.database ?? '',
      bootstrapRole: fixtureIdentity.rows[0]?.bootstrap_role ?? '',
      marker: fixtureIdentity.rows[0]?.marker ?? null,
    });
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(genericRole)} NOLOGIN`);
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.legacyRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.migrationRole)},
       ${quoteIdentifier(genericRole)}`,
    );
    operationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 8,
      options: `-c search_path=${schema}`,
    });
    postgres = new PostgresService(operationPool);
    runner = new MigrationRunner(operationPool, migrations);
    await expect(runner.up()).resolves.toEqual(expectedMigrationIds);
    const clock = await operationPool.query<{ now: Date }>(
      "SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) AS now",
    );
    baseTime = clock.rows[0]?.now.toISOString() ?? '';
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(genericRole)}`);
      await adminPool.end();
    }
  });

  it('keeps API reads while every runtime and PUBLIC-only role is denied ingestion', async () => {
    const api = PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole;
    const deniedRoles = [
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      PRODUCTION_DATABASE_PRINCIPALS.legacyRuntimeRole,
      PRODUCTION_DATABASE_PRINCIPALS.migrationRole,
      genericRole,
    ] as const;
    const request = {
      asset: ETHEREUM_USDC,
      evaluatedAt: at(baseTime, 30_000),
      correlationId: randomUUID(),
      signal: new AbortController().signal,
    };
    await expect(
      priceReaderAsRole(schema, api, (reader) => reader.readPriceEvidence(request)),
    ).resolves.toMatchObject({ observations: [] });
    for (const role of deniedRoles) {
      await expect(
        priceReaderAsRole(schema, role, (reader) => reader.readPriceEvidence(request)),
      ).rejects.toBeInstanceOf(StablecoinPriceEvidencePersistenceError);
    }

    const writer = new PostgresStablecoinPriceEvidenceWriter(postgres);
    const write = recordRequest({
      asset: ETHEREUM_USDC,
      sequence: '1',
      updateId: 'a'.repeat(64),
      observedAt: at(baseTime, -4_000),
      verifiedAt: at(baseTime, -3_000),
    });
    for (const role of [api, ...deniedRoles]) {
      await expect(asRole(postgres, role, () => writer.record(write))).rejects.toBeInstanceOf(
        StablecoinPriceEvidencePersistenceError,
      );
      await expect(
        queryAsRole(operationPool, role, 'SELECT * FROM stablecoin_price_observations'),
      ).rejects.toBeDefined();
    }

    const typeAcl = await operationPool.query<{ role: string; usage: boolean }>(
      `SELECT role_state.role,
              pg_catalog.has_type_privilege(role_state.role, type_state.oid, 'USAGE') AS usage
       FROM pg_catalog.unnest($1::text[]) AS role_state(role)
       CROSS JOIN pg_catalog.pg_type AS type_state
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = type_state.typnamespace
       WHERE namespace.nspname = pg_catalog.current_schema()
         AND type_state.typname = 'stablecoin_price_observations'
       ORDER BY role_state.role`,
      [[api, ...deniedRoles]],
    );
    expect(typeAcl.rows).toHaveLength(deniedRoles.length + 1);
    expect(typeAcl.rows.every(({ usage }) => usage === false)).toBe(true);

    const sequenceCount = await operationPool.query<{ count: string }>(
      `SELECT pg_catalog.count(*)::text AS count
       FROM pg_catalog.pg_class AS sequence
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = sequence.relnamespace
       WHERE namespace.nspname = pg_catalog.current_schema()
         AND sequence.relkind = 'S'
         AND sequence.relname LIKE 'stablecoin\\_%' ESCAPE '\\'`,
    );
    expect(sequenceCount.rows).toEqual([{ count: '0' }]);
  });

  it('lets only the local test-schema owner exercise positive ingestion behavior', async () => {
    const writer = new PostgresStablecoinPriceEvidenceWriter(postgres);
    const first = recordRequest({
      asset: ETHEREUM_USDC,
      sequence: '1',
      updateId: 'a'.repeat(64),
      observedAt: at(baseTime, -4_000),
      verifiedAt: at(baseTime, -3_000),
      evidenceFingerprint: '1'.repeat(64),
    });
    await expect(writer.record(first)).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      watermarkRevision: 1,
    });
    await expect(writer.record(first)).resolves.toMatchObject({
      outcome: 'IDEMPOTENT_REPLAY',
      watermarkRevision: 1,
    });
    await expect(writer.record({ ...first, correlationId: randomUUID() })).resolves.toMatchObject({
      outcome: 'REPLAYED_UPDATE_ID',
      watermarkRevision: null,
    });

    const solana = recordRequest({
      asset: SOLANA_USDC,
      sequence: '1',
      updateId: 'a'.repeat(64),
      observedAt: at(baseTime, -4_000),
      verifiedAt: at(baseTime, -3_000),
      evidenceFingerprint: '1'.repeat(64),
    });
    await expect(writer.record(solana)).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      watermarkRevision: 1,
    });

    const concurrentSolana = ['d', 'e'].map((hex) =>
      recordRequest({
        asset: SOLANA_USDC,
        sequence: '2',
        updateId: hex.repeat(64),
        observedAt: at(baseTime, -2_000),
        verifiedAt: at(baseTime, -1_000),
        evidenceFingerprint: hex.repeat(64),
      }),
    );
    const concurrentOutcomes = await Promise.all(
      concurrentSolana.map((candidate) => writer.record(candidate)),
    );
    expect(concurrentOutcomes.map(({ outcome }) => outcome).sort()).toEqual([
      'ACCEPTED',
      'NON_MONOTONIC',
    ]);

    const second = recordRequest({
      asset: ETHEREUM_USDC,
      sequence: '2',
      updateId: 'b'.repeat(64),
      observedAt: at(baseTime, -2_000),
      verifiedAt: at(baseTime, -1_000),
      evidenceFingerprint: '2'.repeat(64),
    });
    await expect(writer.record(second)).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      watermarkRevision: 2,
    });
    const regressed = recordRequest({
      asset: ETHEREUM_USDC,
      sequence: '1',
      updateId: 'c'.repeat(64),
      observedAt: at(baseTime, -1_000),
      verifiedAt: baseTime,
    });
    await expect(writer.record(regressed)).resolves.toMatchObject({
      outcome: 'NON_MONOTONIC',
      watermarkRevision: null,
    });

    const now = await operationPool.query<{ now: Date }>(
      "SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) AS now",
    );
    const evaluatedAt = now.rows[0]?.now.toISOString() ?? '';
    const snapshot = await priceReaderAsRole(
      schema,
      PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole,
      (reader) =>
        reader.readPriceEvidence({
          asset: ETHEREUM_USDC,
          evaluatedAt,
          correlationId: randomUUID(),
          signal: new AbortController().signal,
        }),
    );
    expect(snapshot.observations).toHaveLength(1);
    expect(snapshot.observations[0]?.sourceSequence).toBe('2');
    expect(snapshot.sourceWatermarks[0]).toMatchObject({
      sourceId: 'PYTH_CORE',
      lastAcceptedSequence: '1',
      lastAcceptedUpdateId: 'a'.repeat(64),
    });
    expect(snapshot.sourceWatermarks[0]?.lastAcceptedUpdateId).not.toBe(
      snapshot.observations[0]?.sourceUpdateId,
    );
  });

  it('enforces immutable history, exact ACL verification, and rollback refusal', async () => {
    await expect(
      operationPool.query('UPDATE stablecoin_price_observations SET recorded_at = recorded_at'),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      operationPool.query('DELETE FROM stablecoin_price_watermark_events'),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      operationPool.query(
        `TRUNCATE TABLE stablecoin_price_source_watermarks,
          stablecoin_price_watermark_events, stablecoin_price_observations,
          stablecoin_price_evidence, stablecoin_price_source_registry`,
      ),
    ).rejects.toMatchObject({ code: '55000' });

    await operationPool.query(
      `GRANT EXECUTE ON FUNCTION ${READ_FUNCTION} TO ${quoteIdentifier(
        PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      )}`,
    );
    const invalid = await operationPool.query<{ valid: boolean }>(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql ??
        'SELECT false AS valid',
    );
    expect(invalid.rows).toEqual([{ valid: false }]);
    await operationPool.query(
      `REVOKE EXECUTE ON FUNCTION ${READ_FUNCTION} FROM ${quoteIdentifier(
        PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      )}`,
    );
    const valid = await operationPool.query<{ valid: boolean }>(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql ??
        'SELECT false AS valid',
    );
    expect(valid.rows).toEqual([{ valid: true }]);

    await operationPool.query(`GRANT EXECUTE ON FUNCTION ${RECORD_FUNCTION} TO PUBLIC`);
    const publicMutation = await operationPool.query<{ valid: boolean }>(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql ??
        'SELECT false AS valid',
    );
    expect(publicMutation.rows).toEqual([{ valid: false }]);
    await operationPool.query(`REVOKE EXECUTE ON FUNCTION ${RECORD_FUNCTION} FROM PUBLIC`);

    await operationPool.query(`
      CREATE FUNCTION reject_stablecoin_price_tamper_probe()
      RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE
      SET search_path = pg_catalog
      AS $function$ BEGIN RETURN OLD; END; $function$;
      DROP TRIGGER stablecoin_price_watermarks_no_delete
        ON stablecoin_price_source_watermarks;
      CREATE TRIGGER stablecoin_price_watermarks_no_delete
        BEFORE UPDATE ON stablecoin_price_evidence
        FOR EACH ROW EXECUTE FUNCTION reject_stablecoin_price_tamper_probe();
      ALTER TABLE stablecoin_price_evidence ENABLE ALWAYS TRIGGER
        stablecoin_price_watermarks_no_delete;
    `);
    const triggerSubstitution = await operationPool.query<{ valid: boolean }>(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql ??
        'SELECT false AS valid',
    );
    expect(triggerSubstitution.rows).toEqual([{ valid: false }]);
    await operationPool.query(`
      DROP TRIGGER stablecoin_price_watermarks_no_delete
        ON stablecoin_price_evidence;
      DROP FUNCTION reject_stablecoin_price_tamper_probe();
      CREATE TRIGGER stablecoin_price_watermarks_no_delete
        BEFORE DELETE ON stablecoin_price_source_watermarks
        FOR EACH ROW EXECUTE FUNCTION reject_stablecoin_price_history_mutation();
      ALTER TABLE stablecoin_price_source_watermarks ENABLE ALWAYS TRIGGER
        stablecoin_price_watermarks_no_delete;
    `);
    const recoveredTriggerBinding = await operationPool.query<{ valid: boolean }>(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql ??
        'SELECT false AS valid',
    );
    expect(recoveredTriggerBinding.rows).toEqual([{ valid: true }]);
    const targetRollbackSql = suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.downSql;
    if (typeof targetRollbackSql !== 'string') {
      throw new Error('Expected stablecoin authority rollback to be one SQL statement');
    }
    await expect(operationPool.query(targetRollbackSql)).rejects.toThrow(
      'cannot roll back suspended stablecoin ingestion authority because rollback would regrant',
    );
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });
});
