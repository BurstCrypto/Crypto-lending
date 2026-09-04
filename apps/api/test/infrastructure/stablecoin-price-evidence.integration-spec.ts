import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PRODUCTION_DATABASE_PRINCIPALS } from '../../src/infrastructure/database/migrations/0005-enforce-database-principal-boundaries.migration';
import { createBalanceSyncReadModelTestSchemaMigrationV0020 } from '../../src/infrastructure/database/migrations/0020-create-balance-sync-read-model.migration';
import { createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021 } from '../../src/infrastructure/database/migrations/0021-create-stablecoin-price-evidence-read-model.migration';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
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

describeWithPostgres('stablecoin price evidence PostgreSQL controls', () => {
  jest.setTimeout(120_000);

  const schema = `price_evidence_${randomBytes(8).toString('hex')}`;
  const migrations = [...DATABASE_TEST_SCHEMA_MIGRATION_LIST];
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
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole)}`,
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
      await adminPool.end();
    }
  });

  it('keeps empty history unavailable and separates API read from worker write', async () => {
    const reader = new PostgresPortfolioPriceEvidenceReader(postgres);
    const request = {
      asset: ETHEREUM_USDC,
      evaluatedAt: at(baseTime, 30_000),
      correlationId: randomUUID(),
    };
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole, () =>
        reader.readPriceEvidence(request),
      ),
    ).resolves.toMatchObject({ observations: [] });
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, () =>
        reader.readPriceEvidence(request),
      ),
    ).rejects.toBeInstanceOf(StablecoinPriceEvidencePersistenceError);

    const writer = new PostgresStablecoinPriceEvidenceWriter(postgres);
    const write = recordRequest({
      asset: ETHEREUM_USDC,
      sequence: '1',
      updateId: 'a'.repeat(64),
      observedAt: at(baseTime, -4_000),
      verifiedAt: at(baseTime, -3_000),
    });
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole, () => writer.record(write)),
    ).rejects.toBeInstanceOf(StablecoinPriceEvidencePersistenceError);
    await expect(
      queryAsRole(
        operationPool,
        PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole,
        'SELECT * FROM stablecoin_price_observations',
      ),
    ).rejects.toBeDefined();
  });

  it('accepts monotonic evidence, exact replay, and the same bundled update in another asset scope', async () => {
    const writer = new PostgresStablecoinPriceEvidenceWriter(postgres);
    const first = recordRequest({
      asset: ETHEREUM_USDC,
      sequence: '1',
      updateId: 'a'.repeat(64),
      observedAt: at(baseTime, -4_000),
      verifiedAt: at(baseTime, -3_000),
      evidenceFingerprint: '1'.repeat(64),
    });
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, () =>
        writer.record(first),
      ),
    ).resolves.toMatchObject({ outcome: 'ACCEPTED', watermarkRevision: 1 });
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, () =>
        writer.record(first),
      ),
    ).resolves.toMatchObject({ outcome: 'IDEMPOTENT_REPLAY', watermarkRevision: 1 });
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, () =>
        writer.record({ ...first, correlationId: randomUUID() }),
      ),
    ).resolves.toMatchObject({ outcome: 'REPLAYED_UPDATE_ID', watermarkRevision: null });

    const solana = recordRequest({
      asset: SOLANA_USDC,
      sequence: '1',
      updateId: 'a'.repeat(64),
      observedAt: at(baseTime, -4_000),
      verifiedAt: at(baseTime, -3_000),
      evidenceFingerprint: '1'.repeat(64),
    });
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, () =>
        writer.record(solana),
      ),
    ).resolves.toMatchObject({ outcome: 'ACCEPTED', watermarkRevision: 1 });

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
      concurrentSolana.map((candidate) =>
        asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, () =>
          writer.record(candidate),
        ),
      ),
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
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, () =>
        writer.record(second),
      ),
    ).resolves.toMatchObject({ outcome: 'ACCEPTED', watermarkRevision: 2 });
    const regressed = recordRequest({
      asset: ETHEREUM_USDC,
      sequence: '1',
      updateId: 'c'.repeat(64),
      observedAt: at(baseTime, -1_000),
      verifiedAt: baseTime,
    });
    await expect(
      asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, () =>
        writer.record(regressed),
      ),
    ).resolves.toMatchObject({ outcome: 'NON_MONOTONIC', watermarkRevision: null });

    const now = await operationPool.query<{ now: Date }>(
      "SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) AS now",
    );
    const evaluatedAt = now.rows[0]?.now.toISOString() ?? '';
    const reader = new PostgresPortfolioPriceEvidenceReader(postgres);
    const snapshot = await asRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole, () =>
      reader.readPriceEvidence({
        asset: ETHEREUM_USDC,
        evaluatedAt,
        correlationId: randomUUID(),
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
      createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021.verifySql ??
        'SELECT false AS valid',
    );
    expect(invalid.rows).toEqual([{ valid: false }]);
    await operationPool.query(
      `REVOKE EXECUTE ON FUNCTION ${READ_FUNCTION} FROM ${quoteIdentifier(
        PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      )}`,
    );
    const valid = await operationPool.query<{ valid: boolean }>(
      createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021.verifySql ??
        'SELECT false AS valid',
    );
    expect(valid.rows).toEqual([{ valid: true }]);

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
      createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021.verifySql ??
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
      createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021.verifySql ??
        'SELECT false AS valid',
    );
    expect(recoveredTriggerBinding.rows).toEqual([{ valid: true }]);
    const targetRollbackSql =
      createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021.downSql;
    if (typeof targetRollbackSql !== 'string') {
      throw new Error('Expected the stablecoin price evidence rollback to be one SQL statement');
    }
    await expect(operationPool.query(targetRollbackSql)).rejects.toThrow(
      'cannot roll back stablecoin price evidence after use',
    );
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });
});
