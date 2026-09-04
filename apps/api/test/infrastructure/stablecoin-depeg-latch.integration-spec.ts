import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PRODUCTION_DATABASE_PRINCIPALS } from '../../src/infrastructure/database/migrations/0005-enforce-database-principal-boundaries.migration';
import { createStablecoinDepegLatchTestSchemaMigrationV0019 } from '../../src/infrastructure/database/migrations/0019-create-stablecoin-depeg-latches.migration';
import { suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026 } from '../../src/infrastructure/database/migrations/0026-suspend-stablecoin-ingestion-authority.migration';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import type {
  ClearStablecoinDepegLatchRequest,
  RecordStablecoinDepegLatchRequest,
  StablecoinDepegRecoveryAuthorization,
} from '../../src/valuation/application/ports/stablecoin-depeg-latch.port';
import {
  fingerprintStablecoinDepegEvidence,
  fingerprintStablecoinDepegRecoveryAuthorization,
  fingerprintStablecoinDepegRecoveryEvidence,
  normalizeClearStablecoinDepegLatchCommand,
  normalizeRecordStablecoinDepegLatchCommand,
  stablecoinDepegRecoveryAuthorizationId,
  type StablecoinDepegRecoveryAuthorizationFingerprintMaterial,
} from '../../src/valuation/domain/stablecoin-depeg-latch';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  type StablecoinPriceObservation,
  type StablecoinRecoveryRequest,
  type StablecoinValuationAssetReference,
  type StablecoinValuationRequest,
  type StablecoinValuationSourceId,
} from '../../src/valuation/domain/stablecoin-valuation-policy';
import {
  PostgresStablecoinDepegLatchRepository,
  StablecoinDepegLatchPersistenceError,
} from '../../src/valuation/infrastructure/postgres/postgres-stablecoin-depeg-latch.repository';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

const ETHEREUM_PYUSD: StablecoinValuationAssetReference = Object.freeze({
  registryEnvironment: 'MAINNET',
  registryVersion: 1,
  registryFingerprintSha256: REGISTRY_FINGERPRINT,
  stablecoin: 'PYUSD',
  networkId: 'eip155:1',
  identity: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
  decimals: 6,
});
const SOLANA_USDC: StablecoinValuationAssetReference = Object.freeze({
  registryEnvironment: 'MAINNET',
  registryVersion: 1,
  registryFingerprintSha256: REGISTRY_FINGERPRINT,
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
    throw new Error('Stablecoin depeg latch integration test requires loopback PostgreSQL');
  }
}

function at(base: string, offsetMilliseconds: number): string {
  return new Date(Date.parse(base) + offsetMilliseconds).toISOString();
}

function observation(
  asset: StablecoinValuationAssetReference,
  sourceId: StablecoinValuationSourceId,
  evaluatedAt: string,
  sequence: string,
  price: string,
): StablecoinPriceObservation {
  return {
    asset,
    sourceId,
    sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin][sourceId],
    sourceSequence: sequence,
    sourceUpdateId: sourceId === 'PYTH_CORE' ? sequence.padStart(64, '0') : sequence,
    pricedAt: at(evaluatedAt, -3_000),
    observedAt: evaluatedAt,
    usdRateMantissa: price,
    usdRateScale: 8,
    confidence:
      sourceId === 'PYTH_CORE'
        ? { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '5000', scale: 8 }
        : { kind: 'NOT_PUBLISHED' },
  };
}

function valuation(
  asset: StablecoinValuationAssetReference,
  evaluatedAt: string,
  sequence = '1',
): StablecoinValuationRequest {
  return {
    asset,
    amountAtomic: '1000000',
    evaluatedAt,
    sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
    observations: [
      observation(asset, 'PYTH_CORE', evaluatedAt, sequence, '97000000'),
      observation(asset, 'CHAINLINK_DATA_FEEDS', evaluatedAt, sequence, '97000000'),
    ],
  };
}

function latchRequest(options: {
  readonly asset: StablecoinValuationAssetReference;
  readonly at: string;
  readonly actor?: string;
  readonly correlationId?: string;
  readonly expectedRevision?: number | null;
  readonly latchId?: string;
  readonly sequence?: string;
}): RecordStablecoinDepegLatchRequest {
  const evidenceActorReferenceId = options.actor ?? 'risk-evidence:postgres-integration';
  const valuationRequest = valuation(options.asset, options.at, options.sequence);
  return {
    expectedRevision: options.expectedRevision ?? null,
    correlationId: options.correlationId ?? randomUUID(),
    latchId: options.latchId ?? randomBytes(32).toString('hex'),
    evidenceActorReferenceId,
    depegEvidenceFingerprintSha256: fingerprintStablecoinDepegEvidence({
      evidenceActorReferenceId,
      valuationRequest,
    }),
    valuationRequest,
  };
}

interface ClearOptions {
  readonly asset: StablecoinValuationAssetReference;
  readonly latchId: string;
  readonly latchedAt: string;
  readonly evaluatedAt: string;
  readonly expectedRevision?: number;
  readonly evidenceActor?: string;
  readonly riskApprover?: string;
  readonly clearId?: string;
  readonly correlationId?: string;
  readonly nonce?: string;
  readonly issuedAt?: string;
  readonly notBefore?: string;
  readonly expiresAt?: string;
}

function clearRequest(options: ClearOptions): ClearStablecoinDepegLatchRequest {
  const evidenceActorReferenceId = options.evidenceActor ?? 'risk-evidence:postgres-integration';
  const clearId = options.clearId ?? randomBytes(32).toString('hex');
  const issuedAt = options.issuedAt ?? options.evaluatedAt;
  const recoveryRequest: StablecoinRecoveryRequest = {
    asset: options.asset,
    evaluatedAt: options.evaluatedAt,
    depegLatch: {
      asset: options.asset,
      latchId: options.latchId,
      latchedAt: options.latchedAt,
    },
    manualRiskClear: {
      asset: options.asset,
      latchId: options.latchId,
      clearId,
      clearedAt: issuedAt,
    },
    samples: [0, 1, 2, 3].map((index) => {
      const evaluatedAt = at(options.evaluatedAt, -1_800_000 + index * 600_000);
      const sequence = String(index + 10);
      return {
        evaluatedAt,
        observations: [
          observation(options.asset, 'PYTH_CORE', evaluatedAt, sequence, '99990000'),
          observation(options.asset, 'CHAINLINK_DATA_FEEDS', evaluatedAt, sequence, '99980000'),
        ],
      };
    }),
  };
  const material: StablecoinDepegRecoveryAuthorizationFingerprintMaterial = {
    schemaVersion: 1,
    authorizationType: 'STABLECOIN_DEPEG_LATCH_RECOVERY',
    scope: 'DEPEG_LATCH_CLEAR_ONLY',
    mayAuthorizeFinancialAction: false,
    operation: 'CLEAR_STABLECOIN_DEPEG_LATCH',
    asset: options.asset,
    expectedLatchId: options.latchId,
    expectedRevision: options.expectedRevision ?? 1,
    clearId,
    recoveryEvidenceFingerprintSha256: fingerprintStablecoinDepegRecoveryEvidence(recoveryRequest),
    evidenceActorReferenceId,
    riskApproverReferenceId: options.riskApprover ?? 'risk-approver:postgres-integration',
    riskApproverRole: 'RISK_APPROVER',
    issuedAt,
    notBefore: options.notBefore ?? issuedAt,
    expiresAt: options.expiresAt ?? at(issuedAt, 600_000),
    nonce: options.nonce ?? randomUUID(),
  };
  const fingerprint = fingerprintStablecoinDepegRecoveryAuthorization(material);
  const authorization: StablecoinDepegRecoveryAuthorization = {
    ...material,
    authorizationFingerprintSha256: fingerprint,
    authorizationId: stablecoinDepegRecoveryAuthorizationId(fingerprint),
  };
  return {
    evaluatedAt: options.evaluatedAt,
    correlationId: options.correlationId ?? randomUUID(),
    recoveryRequest,
    authorization,
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

async function repositoryAsRole<T>(
  postgres: PostgresService,
  role: string,
  work: (repository: PostgresStablecoinDepegLatchRepository) => Promise<T>,
): Promise<T> {
  const repository = new PostgresStablecoinDepegLatchRepository(postgres);
  return postgres.withTransaction(async (client: PoolClient) => {
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    return work(repository);
  });
}

describeWithPostgres('stablecoin depeg latch PostgreSQL controls', () => {
  jest.setTimeout(120_000);

  const schema = `stablecoin_latch_${randomBytes(8).toString('hex')}`;
  const genericRole = `stablecoin_latch_generic_${randomBytes(6).toString('hex')}`;
  const migrations = DATABASE_TEST_SCHEMA_MIGRATION_LIST.some(({ id }) => id === '0019')
    ? DATABASE_TEST_SCHEMA_MIGRATION_LIST
    : [...DATABASE_TEST_SCHEMA_MIGRATION_LIST, createStablecoinDepegLatchTestSchemaMigrationV0019];
  const expectedMigrationIds = migrations.map(({ id }) => id);
  let adminPool: Pool;
  let operationPool: Pool;
  let postgres: PostgresService;
  let runner: MigrationRunner;
  let databaseNow: string;

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const fixtureIdentity = await adminPool.query<{
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
    databaseNow = clock.rows[0]?.now.toISOString() ?? '';
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(genericRole)}`);
      await adminPool.end();
    }
  });

  it('lets only the local test-schema owner exercise latch and clear behavior', async () => {
    const repository = new PostgresStablecoinDepegLatchRepository(postgres);
    const latchedAt = at(databaseNow, -2_400_000);
    const latch = latchRequest({ asset: ETHEREUM_PYUSD, at: latchedAt });
    await expect(repository.record(latch)).resolves.toMatchObject({
      outcome: 'LATCHED',
      latch: { revision: 1, status: 'LATCHED' },
    });
    await expect(repository.record(latch)).resolves.toMatchObject({
      outcome: 'IDEMPOTENT_REPLAY',
      latch: { revision: 1 },
    });

    const normalizedLatch = normalizeRecordStablecoinDepegLatchCommand(latch);
    await expect(
      operationPool.query(
        `SELECT * FROM record_stablecoin_depeg_latch(
           $1::bigint, $2::uuid, $3::text, $4::text, $5::smallint,
           $6::text, $7::text, $8::text, $9::smallint, $10::timestamptz,
           $11::text, $12::text, $13::text, $14::text, $15::text
         )`,
        [
          normalizedLatch.expectedRevision,
          normalizedLatch.correlationId,
          normalizedLatch.latchId,
          normalizedLatch.asset.registryEnvironment,
          normalizedLatch.asset.registryVersion,
          normalizedLatch.asset.registryFingerprintSha256,
          normalizedLatch.asset.stablecoin,
          normalizedLatch.asset.networkId,
          normalizedLatch.asset.decimals,
          normalizedLatch.latchedAt,
          normalizedLatch.asset.identity,
          'risk-evidence:conflicting-replay',
          normalizedLatch.depegEvidenceFingerprintSha256,
          normalizedLatch.commandFingerprintSha256,
          normalizedLatch.eventFingerprintSha256,
        ],
      ),
    ).rejects.toMatchObject({ code: 'D1901' });

    await expect(
      repository.record({ ...latch, correlationId: randomUUID() }),
    ).rejects.toBeInstanceOf(StablecoinDepegLatchPersistenceError);

    const wrongRevision = clearRequest({
      asset: ETHEREUM_PYUSD,
      latchId: latch.latchId,
      latchedAt,
      evaluatedAt: databaseNow,
      expectedRevision: 2,
    });
    await expect(repository.clear(wrongRevision)).resolves.toMatchObject({
      outcome: 'REVISION_CONFLICT',
      latch: { revision: 1, status: 'LATCHED' },
    });

    const wrongLatch = clearRequest({
      asset: ETHEREUM_PYUSD,
      latchId: 'a'.repeat(64),
      latchedAt,
      evaluatedAt: databaseNow,
    });
    await expect(repository.clear(wrongLatch)).resolves.toMatchObject({
      outcome: 'LATCH_BINDING_MISMATCH',
      latch: { latchId: latch.latchId },
    });

    const wrongEvidence = clearRequest({
      asset: ETHEREUM_PYUSD,
      latchId: latch.latchId,
      latchedAt,
      evaluatedAt: databaseNow,
    });
    await expect(
      repository.clear({
        ...wrongEvidence,
        authorization: {
          ...wrongEvidence.authorization,
          recoveryEvidenceFingerprintSha256: 'a'.repeat(64),
        },
      }),
    ).rejects.toBeInstanceOf(StablecoinDepegLatchPersistenceError);
    await expect(
      queryAsRole(
        operationPool,
        PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole,
        `SELECT * FROM read_stablecoin_depeg_latch(
           'MAINNET'::text, 1::smallint, $1::text, 'PYUSD'::text,
           'eip155:1'::text, $2::text, 6::smallint
         )`,
        [REGISTRY_FINGERPRINT, '0x0000000000000000000000000000000000000000'],
      ),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(repository.loadCurrent(ETHEREUM_PYUSD)).resolves.toMatchObject({
      revision: 1,
      status: 'LATCHED',
    });

    const expired = clearRequest({
      asset: ETHEREUM_PYUSD,
      latchId: latch.latchId,
      latchedAt,
      evaluatedAt: at(databaseNow, -1),
      issuedAt: at(databaseNow, -1),
      expiresAt: databaseNow,
    });
    await expect(repository.clear(expired)).resolves.toMatchObject({
      outcome: 'AUTHORIZATION_EXPIRED',
      latch: { status: 'LATCHED' },
    });

    const clear = clearRequest({
      asset: ETHEREUM_PYUSD,
      latchId: latch.latchId,
      latchedAt,
      evaluatedAt: databaseNow,
    });
    await expect(repository.clear(clear)).resolves.toMatchObject({
      outcome: 'CLEARED',
      latch: { revision: 2, status: 'CLEARED' },
    });
    await expect(repository.clear(clear)).resolves.toMatchObject({
      outcome: 'IDEMPOTENT_REPLAY',
      latch: { revision: 2, status: 'CLEARED' },
    });

    const normalizedClear = normalizeClearStablecoinDepegLatchCommand(clear);
    await expect(
      operationPool.query(
        `SELECT * FROM clear_stablecoin_depeg_latch(
           $1::uuid, $2::text, $3::smallint, $4::text, $5::text,
           $6::text, $7::smallint, $8::text, $9::text, $10::timestamptz,
           $11::bigint, $12::text, $13::text, $14::text, $15::text,
           $16::text, $17::timestamptz, $18::timestamptz, $19::timestamptz,
           $20::timestamptz, $21::timestamptz, $22::uuid, $23::text,
           $24::text, $25::text, $26::text
         )`,
        [
          normalizedClear.correlationId,
          normalizedClear.asset.registryEnvironment,
          normalizedClear.asset.registryVersion,
          normalizedClear.asset.registryFingerprintSha256,
          normalizedClear.asset.stablecoin,
          normalizedClear.asset.networkId,
          normalizedClear.asset.decimals,
          normalizedClear.asset.identity,
          normalizedClear.clearId,
          normalizedClear.latchedAt,
          normalizedClear.expectedRevision,
          normalizedClear.latchId,
          normalizedClear.recoveryEvidenceFingerprintSha256,
          normalizedClear.evidenceActorReferenceId,
          normalizedClear.riskApproverReferenceId,
          normalizedClear.riskApproverRole,
          normalizedClear.clearedAt,
          normalizedClear.authorizationIssuedAt,
          normalizedClear.authorizationNotBefore,
          normalizedClear.authorizationExpiresAt,
          normalizedClear.evaluatedAt,
          randomUUID(),
          normalizedClear.authorizationFingerprintSha256,
          normalizedClear.authorizationId,
          normalizedClear.commandFingerprintSha256,
          normalizedClear.eventFingerprintSha256,
        ],
      ),
    ).rejects.toMatchObject({ code: 'D1902' });

    await expect(
      operationPool.query(
        `SELECT * FROM clear_stablecoin_depeg_latch(
           $1::uuid, $2::text, $3::smallint, $4::text, $5::text,
           $6::text, $7::smallint, $8::text, $9::text, $10::timestamptz,
           $11::bigint, $12::text, $13::text, $14::text, $15::text,
           $16::text, $17::timestamptz, $18::timestamptz, $19::timestamptz,
           $20::timestamptz, $21::timestamptz, $22::uuid, $23::text,
           $24::text, $25::text, $26::text
         )`,
        [
          randomUUID(),
          'MAINNET',
          1,
          REGISTRY_FINGERPRINT,
          'PYUSD',
          'eip155:1',
          6,
          ETHEREUM_PYUSD.identity,
          'b'.repeat(64),
          latchedAt,
          1,
          latch.latchId,
          normalizedClear.recoveryEvidenceFingerprintSha256,
          normalizedClear.evidenceActorReferenceId,
          normalizedClear.riskApproverReferenceId,
          'RISK_APPROVER',
          normalizedClear.clearedAt,
          normalizedClear.authorizationIssuedAt,
          normalizedClear.authorizationNotBefore,
          normalizedClear.authorizationExpiresAt,
          normalizedClear.evaluatedAt,
          normalizedClear.authorizationNonce,
          normalizedClear.authorizationFingerprintSha256,
          normalizedClear.authorizationId,
          'a'.repeat(64),
          'b'.repeat(64),
        ],
      ),
    ).rejects.toMatchObject({ code: 'D1903' });

    const history = await operationPool.query<{ count: string }>(
      `SELECT pg_catalog.count(*)::text AS count
       FROM stablecoin_depeg_latch_events
       WHERE stablecoin = 'PYUSD' AND network_id = 'eip155:1'`,
    );
    expect(history.rows).toEqual([{ count: '2' }]);

    const staleRelatch = latchRequest({
      asset: ETHEREUM_PYUSD,
      at: at(databaseNow, -1),
      expectedRevision: 2,
      sequence: '19',
    });
    await expect(repository.record(staleRelatch)).rejects.toBeInstanceOf(
      StablecoinDepegLatchPersistenceError,
    );
    const staleCommand = normalizeRecordStablecoinDepegLatchCommand(staleRelatch);
    await expect(
      operationPool.query(
        `SELECT * FROM record_stablecoin_depeg_latch(
           $1::bigint, $2::uuid, $3::text, $4::text, $5::smallint,
           $6::text, $7::text, $8::text, $9::smallint, $10::timestamptz,
           $11::text, $12::text, $13::text, $14::text, $15::text
         )`,
        [
          2,
          randomUUID(),
          randomBytes(32).toString('hex'),
          'MAINNET',
          1,
          REGISTRY_FINGERPRINT,
          'PYUSD',
          'eip155:1',
          6,
          '-infinity',
          ETHEREUM_PYUSD.identity,
          staleCommand.evidenceActorReferenceId,
          staleCommand.depegEvidenceFingerprintSha256,
          randomBytes(32).toString('hex'),
          randomBytes(32).toString('hex'),
        ],
      ),
    ).rejects.toMatchObject({ code: '22023' });

    const corruptionClient = await operationPool.connect();
    try {
      await corruptionClient.query('BEGIN');
      const inserted = await corruptionClient.query<{ recorded_at: Date }>(
        `INSERT INTO stablecoin_depeg_latch_events (
           event_id, correlation_id, event_type, registry_environment,
           registry_version, registry_fingerprint_sha256, stablecoin, network_id,
           asset_identity, asset_decimals, revision, latch_id,
           depeg_evidence_fingerprint_sha256, evidence_actor_reference_id,
           command_fingerprint_sha256, event_fingerprint_sha256,
           effective_at, evaluated_at, recorded_at
         ) VALUES (
           $1, $2, 'LATCHED', 'MAINNET', 1, $3, 'PYUSD', 'eip155:1',
           $4, 6, 3, $1, $5, $6, $7, $8, $9, $9,
           pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
         ) RETURNING recorded_at`,
        [
          staleCommand.latchId,
          staleCommand.correlationId,
          REGISTRY_FINGERPRINT,
          ETHEREUM_PYUSD.identity,
          staleCommand.depegEvidenceFingerprintSha256,
          staleCommand.evidenceActorReferenceId,
          staleCommand.commandFingerprintSha256,
          staleCommand.eventFingerprintSha256,
          staleCommand.latchedAt,
        ],
      );
      await expect(
        corruptionClient.query(
          `UPDATE stablecoin_depeg_latch_projections
           SET revision = 3, status = 'LATCHED', latch_id = $1,
               latched_at = $2, depeg_evidence_fingerprint_sha256 = $3,
               evidence_actor_reference_id = $4, clear_id = NULL,
               cleared_at = NULL, risk_approver_reference_id = NULL,
               last_event_id = $1, last_event_fingerprint_sha256 = $5,
               updated_at = $6
           WHERE stablecoin = 'PYUSD' AND network_id = 'eip155:1'`,
          [
            staleCommand.latchId,
            staleCommand.latchedAt,
            staleCommand.depegEvidenceFingerprintSha256,
            staleCommand.evidenceActorReferenceId,
            staleCommand.eventFingerprintSha256,
            inserted.rows[0]?.recorded_at,
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await corruptionClient.query('ROLLBACK');
    } finally {
      corruptionClient.release();
    }

    const relatchAt = at(databaseNow, 1);
    await expect(
      repository.record(
        latchRequest({
          asset: ETHEREUM_PYUSD,
          at: relatchAt,
          expectedRevision: 2,
          sequence: '20',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'RELATCHED', latch: { revision: 3, status: 'LATCHED' } });

    await expect(repository.loadCurrent(ETHEREUM_PYUSD)).resolves.toMatchObject({
      revision: 3,
      latchedAt: relatchAt,
    });
  });

  it('serializes concurrent absent-asset latches to one event and one revision', async () => {
    const evaluatedAt = at(databaseNow, -2_000);
    const repository = new PostgresStablecoinDepegLatchRepository(postgres);
    const attempts = await Promise.all(
      ['31', '32'].map((sequence) =>
        repository.record(latchRequest({ asset: SOLANA_USDC, at: evaluatedAt, sequence })),
      ),
    );
    expect(attempts.map(({ outcome }) => outcome).sort()).toEqual(['LATCHED', 'REVISION_CONFLICT']);
    await expect(repository.loadCurrent(SOLANA_USDC)).resolves.toMatchObject({
      revision: 1,
      status: 'LATCHED',
    });
    const events = await operationPool.query<{ count: string }>(
      `SELECT pg_catalog.count(*)::text AS count
       FROM stablecoin_depeg_latch_events
       WHERE stablecoin = 'USDC'
         AND network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'`,
    );
    expect(events.rows).toEqual([{ count: '1' }]);
  });

  it('keeps only API reads while all runtime and PUBLIC-only roles are mutation-denied', async () => {
    const api = PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole;
    const readDeniedRoles = [
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      PRODUCTION_DATABASE_PRINCIPALS.legacyRuntimeRole,
      PRODUCTION_DATABASE_PRINCIPALS.migrationRole,
      genericRole,
    ] as const;
    const mutationDeniedRoles = [api, ...readDeniedRoles] as const;
    await expect(
      repositoryAsRole(postgres, api, (repository) => repository.loadCurrent(ETHEREUM_PYUSD)),
    ).resolves.toMatchObject({ status: 'LATCHED' });
    for (const role of readDeniedRoles) {
      await expect(
        repositoryAsRole(postgres, role, (repository) => repository.loadCurrent(ETHEREUM_PYUSD)),
      ).rejects.toBeInstanceOf(StablecoinDepegLatchPersistenceError);
    }

    const current = await new PostgresStablecoinDepegLatchRepository(postgres).loadCurrent(
      ETHEREUM_PYUSD,
    );
    if (!current) throw new Error('Expected persisted latch projection');
    const firstLatch = await operationPool.query<{ event_id: string; effective_at: Date }>(
      `SELECT event_id, effective_at
       FROM stablecoin_depeg_latch_events
       WHERE stablecoin = 'PYUSD' AND revision = 1`,
    );
    const original = firstLatch.rows[0];
    if (!original) throw new Error('Expected original latch history');
    const dormantClear = clearRequest({
      asset: ETHEREUM_PYUSD,
      latchId: original.event_id,
      latchedAt: original.effective_at.toISOString(),
      evaluatedAt: databaseNow,
      expectedRevision: 1,
    });
    for (const role of mutationDeniedRoles) {
      await expect(
        repositoryAsRole(postgres, role, (repository) =>
          repository.record(
            latchRequest({ asset: ETHEREUM_PYUSD, at: databaseNow, expectedRevision: 3 }),
          ),
        ),
      ).rejects.toBeInstanceOf(StablecoinDepegLatchPersistenceError);
      await expect(
        repositoryAsRole(postgres, role, (repository) => repository.clear(dormantClear)),
      ).rejects.toBeInstanceOf(StablecoinDepegLatchPersistenceError);
      await expect(
        queryAsRole(
          operationPool,
          role,
          `INSERT INTO stablecoin_depeg_latch_events (
             event_id, correlation_id, event_type, registry_environment,
             registry_version, registry_fingerprint_sha256, stablecoin,
             network_id, asset_identity, asset_decimals, revision, latch_id,
             depeg_evidence_fingerprint_sha256, evidence_actor_reference_id,
             command_fingerprint_sha256, event_fingerprint_sha256,
             effective_at, evaluated_at, recorded_at
           ) SELECT event_id, correlation_id, event_type, registry_environment,
                    registry_version, registry_fingerprint_sha256, stablecoin,
                    network_id, asset_identity, asset_decimals, revision, latch_id,
                    depeg_evidence_fingerprint_sha256, evidence_actor_reference_id,
                    command_fingerprint_sha256, event_fingerprint_sha256,
                    effective_at, evaluated_at, recorded_at
             FROM stablecoin_depeg_latch_events LIMIT 1`,
        ),
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
         AND type_state.typname = 'stablecoin_depeg_latch_events'
       ORDER BY role_state.role`,
      [[...mutationDeniedRoles]],
    );
    expect(typeAcl.rows).toHaveLength(mutationDeniedRoles.length);
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

    await expect(
      operationPool.query(
        `UPDATE stablecoin_depeg_latch_events
         SET recorded_at = recorded_at
         WHERE event_id = $1`,
        [current.lastEventId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      operationPool.query('DELETE FROM stablecoin_depeg_latch_events'),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      operationPool.query(
        'TRUNCATE TABLE stablecoin_depeg_latch_events, stablecoin_depeg_latch_projections',
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('makes the verifier fail on accidental runtime clear EXECUTE and refuses destructive rollback', async () => {
    const clearIdentity =
      'clear_stablecoin_depeg_latch(uuid,text,smallint,text,text,text,smallint,text,text,timestamp with time zone,bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,text,text,text)';
    await operationPool.query(
      `GRANT EXECUTE ON FUNCTION ${clearIdentity} TO ${quoteIdentifier(
        PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      )}`,
    );
    const invalid = await operationPool.query<{ valid: boolean }>(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql ??
        'SELECT false AS valid',
    );
    expect(invalid.rows).toEqual([{ valid: false }]);
    await operationPool.query(
      `REVOKE EXECUTE ON FUNCTION ${clearIdentity} FROM ${quoteIdentifier(
        PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      )}`,
    );
    const valid = await operationPool.query<{ valid: boolean }>(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql ??
        'SELECT false AS valid',
    );
    expect(valid.rows).toEqual([{ valid: true }]);
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
