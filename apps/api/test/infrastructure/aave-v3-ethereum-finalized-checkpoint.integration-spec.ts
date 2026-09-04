import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PRODUCTION_DATABASE_PRINCIPALS } from '../../src/infrastructure/database/migrations/0005-enforce-database-principal-boundaries.migration';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import type { AaveV3EthereumDeploymentEvidence } from '../../src/smart-lending/application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import type {
  AaveV3EthereumCheckpointRecoveryAuthorization,
  AaveV3EthereumHistoricalDeploymentObservation,
  RecoverAaveV3EthereumFinalizedCheckpointRequest,
} from '../../src/smart-lending/application/ports/aave-v3-ethereum-finalized-checkpoint.port';
import {
  AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT,
  fingerprintAaveV3EthereumDeploymentEvidence,
} from '../../src/smart-lending/domain/aave-v3-ethereum-deployment-evidence-fingerprint';
import {
  AAVE_V3_ETHEREUM_HISTORICAL_RECOVERY_READ_PLAN_FINGERPRINT_SHA256,
  fingerprintAaveV3EthereumCheckpointRecoveryAuthorization,
  fingerprintAaveV3EthereumHistoricalDeploymentObservation,
  type AaveV3EthereumHistoricalObservationFingerprintMaterial,
  type AaveV3EthereumRecoveryAuthorizationFingerprintMaterial,
} from '../../src/smart-lending/domain/aave-v3-ethereum-finalized-checkpoint-recovery';
import {
  AaveV3EthereumFinalizedCheckpointPersistenceError,
  PostgresAaveV3EthereumFinalizedCheckpointRepository,
} from '../../src/smart-lending/infrastructure/postgres/postgres-aave-v3-ethereum-finalized-checkpoint.repository';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

type Hash = `0x${string}`;

interface EvidenceOptions {
  readonly blockHash?: Hash;
  readonly blockNumber?: bigint;
  readonly blockTimestamp?: string;
  readonly observedAt?: string;
  readonly parentHash?: Hash;
  readonly sourceObservationId?: string;
  readonly sourceReferenceId: string;
  readonly stateRoot?: Hash;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Aave finalized checkpoint integration test requires loopback PostgreSQL');
  }
}

function hash(byte: number): Hash {
  return `0x${byte.toString(16).padStart(2, '0').repeat(32)}`;
}

function evidence(options: EvidenceOptions): AaveV3EthereumDeploymentEvidence {
  const contract = AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT;
  const placeholder = '00'.repeat(32);
  const observedAt = options.observedAt ?? new Date(Date.now() - 30_000).toISOString();
  const candidate: AaveV3EthereumDeploymentEvidence = {
    schemaVersion: 1,
    sourceId: 'AAVE_V3_ETHEREUM_FINALIZED_RPC',
    use: 'DEPLOYMENT_CORROBORATION_ONLY',
    mayEstablishRecommendationEligibility: false,
    mayAuthorizeFinancialAction: false,
    networkId: 'eip155:1',
    chainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    observedChainIdentityMatchesPolicy: true,
    manifestBindingValidated: true,
    observedDeploymentTopologyMatchesManifest: true,
    blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED',
    runtimeCodeApprovalStatus: 'UNVERIFIED',
    sourceProviderApproved: false,
    exactHostEgressApproved: false,
    liveCapabilityProofValidated: false,
    independentFinalizedSourcesAgree: false,
    freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
    finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
    sourceReferenceId: options.sourceReferenceId,
    sourceObservationId: options.sourceObservationId ?? `rpc-observation:${randomUUID()}`,
    deploymentManifestFingerprintSha256: contract.deploymentManifestFingerprintSha256,
    assetRegistryFingerprintSha256: contract.assetRegistryFingerprintSha256,
    readPlanFingerprintSha256: contract.readPlanFingerprintSha256,
    evidenceFingerprintSha256: placeholder,
    evidenceId: `aave-v3-ethereum-deployment:${placeholder}`,
    observedAt,
    finalizedBlock: {
      number: options.blockNumber ?? 20_000_000n,
      hash: options.blockHash ?? hash(0x11),
      parentHash: options.parentHash ?? hash(0x10),
      stateRoot: options.stateRoot ?? hash(0x33),
      timestamp: options.blockTimestamp ?? new Date(Date.parse(observedAt) - 12_000).toISOString(),
    },
    runtimeCodeKeccak256: {
      poolAddressesProvider: hash(0x41),
      poolProxy: hash(0x42),
      poolImplementation: hash(0x43),
      protocolDataProvider: hash(0x44),
      usdcAToken: hash(0x45),
      usdcVariableDebtToken: hash(0x46),
      usdtAToken: hash(0x47),
      usdtVariableDebtToken: hash(0x48),
    },
    reserves: contract.reserves,
  };
  const fingerprint = fingerprintAaveV3EthereumDeploymentEvidence(candidate, observedAt);
  return {
    ...candidate,
    evidenceFingerprintSha256: fingerprint,
    evidenceId: `aave-v3-ethereum-deployment:${fingerprint}`,
  };
}

interface HistoricalObservationOptions {
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly observedAt: string;
  readonly finalizedAnchor: AaveV3EthereumDeploymentEvidence['finalizedBlock'];
  readonly historicalBlock: AaveV3EthereumDeploymentEvidence['finalizedBlock'];
}

function historicalObservation(
  options: HistoricalObservationOptions,
): AaveV3EthereumHistoricalDeploymentObservation {
  const contract = AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT;
  const material: AaveV3EthereumHistoricalObservationFingerprintMaterial = {
    schemaVersion: 1,
    sourceId: 'AAVE_V3_ETHEREUM_HISTORICAL_FINALIZED_LINEAGE_RPC',
    use: 'CHECKPOINT_LINEAGE_REPAIR_ONLY',
    mayEstablishRecommendationEligibility: false,
    mayAuthorizeFinancialAction: false,
    deploymentId: 'AAVE_V3_ETHEREUM',
    networkId: 'eip155:1',
    chainId: '0x1',
    finalizedAnchorSelector: 'finalized',
    historicalBlockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    sourceReferenceId: options.sourceReferenceId,
    sourceObservationId: options.sourceObservationId,
    deploymentManifestFingerprintSha256: contract.deploymentManifestFingerprintSha256,
    assetRegistryFingerprintSha256: contract.assetRegistryFingerprintSha256,
    historicalReadPlanFingerprintSha256:
      AAVE_V3_ETHEREUM_HISTORICAL_RECOVERY_READ_PLAN_FINGERPRINT_SHA256,
    observedAt: options.observedAt,
    finalizedAnchor: options.finalizedAnchor,
    historicalBlock: options.historicalBlock,
    runtimeCodeKeccak256: {
      poolAddressesProvider: hash(0x41),
      poolProxy: hash(0x42),
      poolImplementation: hash(0x43),
      protocolDataProvider: hash(0x44),
      usdcAToken: hash(0x45),
      usdcVariableDebtToken: hash(0x46),
      usdtAToken: hash(0x47),
      usdtVariableDebtToken: hash(0x48),
    },
    reserves: contract.reserves,
  };
  const fingerprint = fingerprintAaveV3EthereumHistoricalDeploymentObservation(material);
  return {
    ...material,
    evidenceFingerprintSha256: fingerprint,
    evidenceId: `aave-v3-ethereum-historical-lineage:${fingerprint}`,
  };
}

function recoveryAuthorization(
  material: AaveV3EthereumRecoveryAuthorizationFingerprintMaterial,
): AaveV3EthereumCheckpointRecoveryAuthorization {
  const fingerprint = fingerprintAaveV3EthereumCheckpointRecoveryAuthorization(material);
  return {
    ...material,
    authorizationFingerprintSha256: fingerprint,
    authorizationId: `aave-v3-ethereum-checkpoint-lineage-repair:${fingerprint}`,
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
  work: (repository: PostgresAaveV3EthereumFinalizedCheckpointRepository) => Promise<T>,
): Promise<T> {
  const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
  return postgres.withTransaction(async (client: PoolClient) => {
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    return work(repository);
  });
}

describeWithPostgres('Aave V3 Ethereum finalized checkpoint PostgreSQL controls', () => {
  jest.setTimeout(120_000);

  const schema = `aave_checkpoint_${randomBytes(8).toString('hex')}`;
  const expectedMigrationIds = DATABASE_TEST_SCHEMA_MIGRATION_LIST.map(({ id }) => id);
  let adminPool: Pool;
  let operationPool: Pool;
  let postgres: PostgresService;
  let runner: MigrationRunner;

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

    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    // Migration 0005 owns schema USAGE in production but is intentionally absent
    // from the isolated-schema migration list. Mirror only that prerequisite so
    // the real worker/API capability grants on migration 0017 can be exercised.
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
    runner = new MigrationRunner(operationPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);
    await expect(runner.up()).resolves.toEqual(expectedMigrationIds);
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('creates, advances, and reobserves immutable content under a fresh observation id', async () => {
    const sourceReferenceId = 'rpc-primary:checkpoint-lifecycle';
    const at = (offset: number): string => new Date(Date.now() - 60_000 + offset).toISOString();
    const firstHash = hash(0x51);
    const secondHash = hash(0x52);
    const first = evidence({
      sourceReferenceId,
      sourceObservationId: 'rpc-observation:lifecycle-1',
      blockNumber: 20_000_100n,
      blockHash: firstHash,
      parentHash: hash(0x50),
      blockTimestamp: at(0),
      observedAt: at(10_000),
    });
    const created = await repositoryAsRole(
      postgres,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      (repository) =>
        repository.record({ expectedRevision: null, correlationId: randomUUID(), evidence: first }),
    );
    expect(created).toMatchObject({
      outcome: 'CREATED',
      checkpoint: { revision: 1, status: 'ACTIVE', finalizedBlock: { hash: firstHash } },
    });

    const advancedEvidence = evidence({
      sourceReferenceId,
      sourceObservationId: 'rpc-observation:lifecycle-2',
      blockNumber: 20_000_101n,
      blockHash: secondHash,
      parentHash: firstHash,
      blockTimestamp: at(12_000),
      observedAt: at(20_000),
    });
    const advanced = await repositoryAsRole(
      postgres,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      (repository) =>
        repository.record({
          expectedRevision: 1,
          correlationId: randomUUID(),
          evidence: advancedEvidence,
        }),
    );
    expect(advanced).toMatchObject({
      outcome: 'ADVANCED',
      checkpoint: { revision: 2, finalizedBlock: { hash: secondHash } },
    });

    const reobservedEvidence = evidence({
      sourceReferenceId,
      sourceObservationId: 'rpc-observation:lifecycle-3',
      blockNumber: 20_000_101n,
      blockHash: secondHash,
      parentHash: firstHash,
      stateRoot: advancedEvidence.finalizedBlock.stateRoot,
      blockTimestamp: advancedEvidence.finalizedBlock.timestamp,
      observedAt: at(30_000),
    });
    const reobserved = await repositoryAsRole(
      postgres,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      (repository) =>
        repository.record({
          expectedRevision: 2,
          correlationId: randomUUID(),
          evidence: reobservedEvidence,
        }),
    );
    expect(reobserved).toMatchObject({
      outcome: 'REOBSERVED',
      checkpoint: {
        revision: 3,
        sourceObservationId: 'rpc-observation:lifecycle-3',
        finalizedBlock: { hash: secondHash },
      },
    });
    expect(reobserved.checkpoint?.finalizedAdvancedAt).toBe(advancedEvidence.observedAt);
    expect(reobserved.checkpoint?.lastValidatedAt).toBe(reobservedEvidence.observedAt);
  });

  it('replays an identical command without appending or changing revision', async () => {
    const sourceReferenceId = 'rpc-primary:idempotency';
    const command = {
      expectedRevision: null,
      correlationId: randomUUID(),
      evidence: evidence({ sourceReferenceId }),
    } as const;
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
    await expect(repository.record(command)).resolves.toMatchObject({
      outcome: 'CREATED',
      checkpoint: { revision: 1 },
    });
    await expect(repository.record(command)).resolves.toMatchObject({
      outcome: 'IDEMPOTENT_REPLAY',
      checkpoint: { revision: 1 },
    });
    await expect(
      operationPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM aave_v3_ethereum_finalized_checkpoint_events
         WHERE source_reference_id = $1`,
        [sourceReferenceId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  });

  it('serializes concurrent writers so only one matching revision can advance', async () => {
    const sourceReferenceId = 'rpc-primary:concurrent';
    const firstHash = hash(0x61);
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
    await repository.record({
      expectedRevision: null,
      correlationId: randomUUID(),
      evidence: evidence({
        sourceReferenceId,
        blockNumber: 20_000_200n,
        blockHash: firstHash,
        parentHash: hash(0x60),
      }),
    });
    const observedAt = new Date(Date.now() - 5_000).toISOString();
    const attempts = await Promise.all(
      [0x62, 0x63].map((byte) =>
        repository.record({
          expectedRevision: 1,
          correlationId: randomUUID(),
          evidence: evidence({
            sourceReferenceId,
            sourceObservationId: `rpc-observation:concurrent-${byte}`,
            blockNumber: 20_000_201n,
            blockHash: hash(byte),
            parentHash: firstHash,
            observedAt,
          }),
        }),
      ),
    );
    expect(attempts.map(({ outcome }) => outcome).sort()).toEqual([
      'ADVANCED',
      'REVISION_CONFLICT',
    ]);
    expect((await repository.loadCurrent(sourceReferenceId))?.revision).toBe(2);
  });

  it('records a continuity gap without mutating the current head', async () => {
    const sourceReferenceId = 'rpc-primary:gap';
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
    const created = await repository.record({
      expectedRevision: null,
      correlationId: randomUUID(),
      evidence: evidence({
        sourceReferenceId,
        blockNumber: 20_000_300n,
        blockHash: hash(0x71),
        parentHash: hash(0x70),
      }),
    });
    const gap = await repository.record({
      expectedRevision: 1,
      correlationId: randomUUID(),
      evidence: evidence({
        sourceReferenceId,
        blockNumber: 20_000_302n,
        blockHash: hash(0x73),
        parentHash: hash(0x72),
      }),
    });
    expect(gap).toMatchObject({
      outcome: 'CONTINUITY_REQUIRED',
      checkpoint: { revision: 1, finalizedBlock: created.checkpoint?.finalizedBlock },
    });
  });

  it('heals an active continuity gap through a bounded two-source historical backfill', async () => {
    const sourceReferenceId = 'rpc-primary:active-backfill';
    const corroboratingSourceReferenceId = 'rpc-secondary:active-backfill';
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
    const initialEvidence = evidence({
      sourceReferenceId,
      sourceObservationId: 'rpc-observation:backfill-current-1',
      blockNumber: 20_000_350n,
      blockHash: hash(0x74),
      parentHash: hash(0x73),
    });
    const created = await repository.record({
      expectedRevision: null,
      correlationId: randomUUID(),
      evidence: initialEvidence,
    });
    const firstBackfillBlock = {
      number: 20_000_351n,
      hash: hash(0x75),
      parentHash: initialEvidence.finalizedBlock.hash,
      stateRoot: hash(0xb1),
      timestamp: new Date(
        Date.parse(initialEvidence.finalizedBlock.timestamp) + 12_000,
      ).toISOString(),
    } as const;
    const targetBlock = {
      number: 20_000_352n,
      hash: hash(0x76),
      parentHash: firstBackfillBlock.hash,
      stateRoot: hash(0xb2),
      timestamp: new Date(
        Date.parse(initialEvidence.finalizedBlock.timestamp) + 24_000,
      ).toISOString(),
    } as const;
    await expect(
      repository.record({
        expectedRevision: 1,
        correlationId: randomUUID(),
        evidence: evidence({
          sourceReferenceId,
          sourceObservationId: 'rpc-observation:backfill-gap',
          blockNumber: targetBlock.number,
          blockHash: targetBlock.hash,
          parentHash: targetBlock.parentHash,
          stateRoot: targetBlock.stateRoot,
          blockTimestamp: targetBlock.timestamp,
          observedAt: new Date().toISOString(),
        }),
      }),
    ).resolves.toMatchObject({
      outcome: 'CONTINUITY_REQUIRED',
      checkpoint: { revision: 1, status: 'ACTIVE' },
    });
    const checkpoint = created.checkpoint;
    if (!checkpoint) throw new Error('Expected an active checkpoint');
    const databaseClock = await operationPool.query<{ now: Date }>(
      `SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) AS now`,
    );
    const issuedAt = new Date(
      Math.max(databaseClock.rows[0]?.now.getTime() ?? 0, Date.parse(checkpoint.lastValidatedAt)),
    ).toISOString();
    const evaluatedAt = issuedAt;
    const expiresAt = new Date(Date.parse(issuedAt) + 10 * 60_000).toISOString();
    const lineage = [firstBackfillBlock, targetBlock].map((historicalBlock, index) => ({
      primary: historicalObservation({
        sourceReferenceId,
        sourceObservationId: `rpc-observation:backfill-primary-${index + 1}`,
        observedAt: evaluatedAt,
        finalizedAnchor: targetBlock,
        historicalBlock,
      }),
      corroborating: historicalObservation({
        sourceReferenceId: corroboratingSourceReferenceId,
        sourceObservationId: `rpc-observation:backfill-corroborating-${index + 1}`,
        observedAt: evaluatedAt,
        finalizedAnchor: targetBlock,
        historicalBlock,
      }),
    }));
    const backfillRequest: RecoverAaveV3EthereumFinalizedCheckpointRequest = {
      evaluatedAt,
      recoveryId: randomUUID(),
      authorization: recoveryAuthorization({
        schemaVersion: 1,
        authorizationType: 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_LINEAGE_REPAIR',
        scope: 'CHECKPOINT_LINEAGE_REPAIR_ONLY',
        mayAuthorizeFinancialAction: false,
        operation: 'CONTINUITY_BACKFILL',
        deploymentId: 'AAVE_V3_ETHEREUM',
        networkId: 'eip155:1',
        sourceReferenceId,
        corroboratingSourceReferenceId,
        authorizedByReferenceId: 'operations-approver:backfill-integration',
        sourcePairIndependenceApprovalId: 'source-pair-approval:backfill-integration',
        expectedRevision: checkpoint.revision,
        expectedStatus: 'ACTIVE',
        expectedQuarantineReason: null,
        expectedQuarantinedAt: null,
        expectedLastValidatedAt: checkpoint.lastValidatedAt,
        expectedLastGoodBlock: checkpoint.finalizedBlock,
        expectedLastGoodContentFingerprintSha256: checkpoint.contentFingerprintSha256,
        recoverThroughBlock: { number: targetBlock.number, hash: targetBlock.hash },
        reasonCode: 'BACKFILL_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE',
        issuedAt,
        expiresAt,
        nonce: randomUUID(),
      }),
      lineage,
    };

    await expect(repository.backfill(backfillRequest)).resolves.toMatchObject({
      outcome: 'BACKFILLED',
      checkpoint: { revision: 2, status: 'ACTIVE', finalizedBlock: targetBlock },
    });
    await expect(
      operationPool.query<{ operation: string }>(
        `SELECT operation
         FROM aave_v3_ethereum_finalized_checkpoint_recovery_events
         WHERE recovery_id = $1`,
        [backfillRequest.recoveryId],
      ),
    ).resolves.toMatchObject({ rows: [{ operation: 'CONTINUITY_BACKFILL' }] });
  });

  it('quarantines a parent mismatch, retains the last good block, and stays quarantined', async () => {
    const sourceReferenceId = 'rpc-primary:quarantine';
    const firstHash = hash(0x81);
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
    await repository.record({
      expectedRevision: null,
      correlationId: randomUUID(),
      evidence: evidence({
        sourceReferenceId,
        blockNumber: 20_000_400n,
        blockHash: firstHash,
        parentHash: hash(0x80),
      }),
    });
    const quarantined = await repository.record({
      expectedRevision: 1,
      correlationId: randomUUID(),
      evidence: evidence({
        sourceReferenceId,
        blockNumber: 20_000_401n,
        blockHash: hash(0x82),
        parentHash: hash(0x7f),
      }),
    });
    expect(quarantined).toMatchObject({
      outcome: 'QUARANTINED',
      checkpoint: {
        revision: 2,
        status: 'QUARANTINED',
        quarantineReason: 'FINALIZED_PARENT_MISMATCH',
        finalizedBlock: { number: 20_000_400n, hash: firstHash },
      },
    });
    const sticky = await repository.record({
      expectedRevision: 2,
      correlationId: randomUUID(),
      evidence: evidence({
        sourceReferenceId,
        blockNumber: 20_000_401n,
        blockHash: hash(0x83),
        parentHash: firstHash,
      }),
    });
    expect(sticky).toMatchObject({
      outcome: 'ALREADY_QUARANTINED',
      checkpoint: { revision: 2, status: 'QUARANTINED', finalizedBlock: { hash: firstHash } },
    });
    await expect(
      operationPool.query(
        `UPDATE aave_v3_ethereum_finalized_checkpoint_heads
         SET revision = revision + 1, status = 'ACTIVE', quarantine_reason = NULL,
             quarantined_at = NULL, quarantine_event_id = NULL,
             updated_at = pg_catalog.clock_timestamp()
         WHERE source_reference_id = $1`,
        [sourceReferenceId],
      ),
    ).rejects.toBeDefined();
    await expect(repository.loadCurrent(sourceReferenceId)).resolves.toMatchObject({
      revision: 2,
      status: 'QUARANTINED',
    });
  });

  it('recovers only through an authorized, contiguous, two-source finalized lineage', async () => {
    const sourceReferenceId = 'rpc-primary:authorized-recovery';
    const corroboratingSourceReferenceId = 'rpc-secondary:authorized-recovery';
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
    const firstEvidence = evidence({
      sourceReferenceId,
      sourceObservationId: 'rpc-observation:recovery-current-1',
      blockNumber: 20_000_500n,
      blockHash: hash(0x91),
      parentHash: hash(0x90),
    });
    await repository.record({
      expectedRevision: null,
      correlationId: randomUUID(),
      evidence: firstEvidence,
    });
    const quarantined = await repository.record({
      expectedRevision: 1,
      correlationId: randomUUID(),
      evidence: evidence({
        sourceReferenceId,
        sourceObservationId: 'rpc-observation:recovery-bad-parent',
        blockNumber: 20_000_501n,
        blockHash: hash(0x92),
        parentHash: hash(0x8f),
      }),
    });
    expect(quarantined).toMatchObject({
      outcome: 'QUARANTINED',
      checkpoint: { revision: 2, status: 'QUARANTINED' },
    });
    const checkpoint = quarantined.checkpoint;
    if (!checkpoint?.quarantinedAt) throw new Error('Expected a quarantined checkpoint');

    const firstRecoveredBlock = {
      number: 20_000_501n,
      hash: hash(0x92),
      parentHash: firstEvidence.finalizedBlock.hash,
      stateRoot: hash(0xa1),
      timestamp: new Date(
        Date.parse(firstEvidence.finalizedBlock.timestamp) + 12_000,
      ).toISOString(),
    } as const;
    const targetBlock = {
      number: 20_000_502n,
      hash: hash(0x93),
      parentHash: firstRecoveredBlock.hash,
      stateRoot: hash(0xa2),
      timestamp: new Date(
        Date.parse(firstEvidence.finalizedBlock.timestamp) + 24_000,
      ).toISOString(),
    } as const;
    const issuedAt = checkpoint.quarantinedAt;
    const databaseClock = await operationPool.query<{ now: Date }>(
      `SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) AS now`,
    );
    const evaluatedAt = new Date(
      Math.max(databaseClock.rows[0]?.now.getTime() ?? 0, Date.parse(issuedAt)),
    ).toISOString();
    const expiresAt = new Date(Date.parse(issuedAt) + 10 * 60_000).toISOString();
    const lineage = [firstRecoveredBlock, targetBlock].map((historicalBlock, index) => ({
      primary: historicalObservation({
        sourceReferenceId,
        sourceObservationId: `rpc-observation:recovery-primary-${index + 1}`,
        observedAt: evaluatedAt,
        finalizedAnchor: targetBlock,
        historicalBlock,
      }),
      corroborating: historicalObservation({
        sourceReferenceId: corroboratingSourceReferenceId,
        sourceObservationId: `rpc-observation:recovery-corroborating-${index + 1}`,
        observedAt: evaluatedAt,
        finalizedAnchor: targetBlock,
        historicalBlock,
      }),
    }));
    const authorizationMaterial: AaveV3EthereumRecoveryAuthorizationFingerprintMaterial = {
      schemaVersion: 1,
      authorizationType: 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_LINEAGE_REPAIR',
      scope: 'CHECKPOINT_LINEAGE_REPAIR_ONLY',
      mayAuthorizeFinancialAction: false,
      operation: 'QUARANTINE_RECOVERY',
      deploymentId: 'AAVE_V3_ETHEREUM',
      networkId: 'eip155:1',
      sourceReferenceId,
      corroboratingSourceReferenceId,
      authorizedByReferenceId: 'operations-approver:recovery-integration',
      sourcePairIndependenceApprovalId: 'source-pair-approval:recovery-integration',
      expectedRevision: checkpoint.revision,
      expectedStatus: 'QUARANTINED',
      expectedQuarantineReason: 'FINALIZED_PARENT_MISMATCH',
      expectedQuarantinedAt: checkpoint.quarantinedAt,
      expectedLastValidatedAt: checkpoint.lastValidatedAt,
      expectedLastGoodBlock: checkpoint.finalizedBlock,
      expectedLastGoodContentFingerprintSha256: checkpoint.contentFingerprintSha256,
      recoverThroughBlock: { number: targetBlock.number, hash: targetBlock.hash },
      reasonCode: 'RESTORE_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE',
      issuedAt,
      expiresAt,
      nonce: randomUUID(),
    };
    const expiringAuthorization = recoveryAuthorization({
      ...authorizationMaterial,
      expiresAt: new Date(Date.parse(evaluatedAt) + 1).toISOString(),
      nonce: randomUUID(),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(
      repository.recover({
        evaluatedAt,
        recoveryId: randomUUID(),
        authorization: expiringAuthorization,
        lineage,
      }),
    ).resolves.toMatchObject({
      outcome: 'AUTHORIZATION_EXPIRED',
      checkpoint: { revision: 2, status: 'QUARANTINED' },
    });
    const rejectedBinding = await repository.recover({
      evaluatedAt,
      recoveryId: randomUUID(),
      authorization: recoveryAuthorization({
        ...authorizationMaterial,
        expectedLastGoodContentFingerprintSha256: 'ff'.repeat(32),
      }),
      lineage,
    });
    expect(rejectedBinding).toMatchObject({
      outcome: 'HEAD_BINDING_MISMATCH',
      checkpoint: { revision: 2, status: 'QUARANTINED' },
    });

    const authorization = recoveryAuthorization(authorizationMaterial);
    const recoveryRequest: RecoverAaveV3EthereumFinalizedCheckpointRequest = {
      evaluatedAt,
      recoveryId: randomUUID(),
      authorization,
      lineage,
    };

    const recovered = await repositoryAsRole(
      postgres,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      (workerRepository) => workerRepository.recover(recoveryRequest),
    );
    expect(recovered).toMatchObject({
      outcome: 'RECOVERED',
      checkpoint: {
        revision: 3,
        status: 'ACTIVE',
        quarantineReason: null,
        quarantinedAt: null,
        finalizedBlock: targetBlock,
      },
    });
    await expect(repository.recover(recoveryRequest)).resolves.toMatchObject({
      outcome: 'IDEMPOTENT_REPLAY',
      checkpoint: { revision: 3, status: 'ACTIVE' },
    });
    await expect(
      repository.recover({ ...recoveryRequest, recoveryId: randomUUID() }),
    ).rejects.toBeInstanceOf(AaveV3EthereumFinalizedCheckpointPersistenceError);

    const auditCounts = await operationPool.query<{
      recoveries: string;
      lineage: string;
      sources: string;
      checkpoint_events: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM aave_v3_ethereum_finalized_checkpoint_recovery_events
           WHERE source_reference_id = $1) AS recoveries,
         (SELECT count(*)::text FROM aave_v3_ethereum_finalized_checkpoint_recovery_lineage
           WHERE recovery_id = $2) AS lineage,
         (SELECT count(*)::text FROM aave_v3_ethereum_finalized_checkpoint_recovery_sources
           WHERE recovery_id = $2) AS sources,
         (SELECT count(*)::text FROM aave_v3_ethereum_finalized_checkpoint_events
           WHERE source_reference_id = $1) AS checkpoint_events`,
      [sourceReferenceId, recoveryRequest.recoveryId],
    );
    expect(auditCounts.rows[0]).toEqual({
      recoveries: '1',
      lineage: '2',
      sources: '4',
      checkpoint_events: '3',
    });

    const reobserved = await repository.record({
      expectedRevision: 3,
      correlationId: randomUUID(),
      evidence: evidence({
        sourceReferenceId,
        sourceObservationId: 'rpc-observation:recovery-current-2',
        blockNumber: targetBlock.number,
        blockHash: targetBlock.hash,
        parentHash: targetBlock.parentHash,
        stateRoot: targetBlock.stateRoot,
        blockTimestamp: targetBlock.timestamp,
        observedAt: new Date(
          Date.parse(recovered.checkpoint?.lastValidatedAt ?? evaluatedAt) + 1,
        ).toISOString(),
      }),
    });
    expect(reobserved).toMatchObject({
      outcome: 'REOBSERVED',
      checkpoint: { revision: 4, status: 'ACTIVE', finalizedBlock: targetBlock },
    });

    await expect(
      repositoryAsRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole, (apiRepository) =>
        apiRepository.recover(recoveryRequest),
      ),
    ).rejects.toBeDefined();
  });

  it('persists across repository instances and enforces runtime privilege boundaries', async () => {
    const sourceReferenceId = 'rpc-primary:restart';
    const firstRepository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
    await firstRepository.record({
      expectedRevision: null,
      correlationId: randomUUID(),
      evidence: evidence({ sourceReferenceId }),
    });
    const restartedRepository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(
      new PostgresService(operationPool),
    );
    await expect(
      repositoryAsRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole, (repository) =>
        repository.loadCurrent(sourceReferenceId),
      ),
    ).resolves.toMatchObject({ revision: 1, sourceReferenceId });
    await expect(restartedRepository.loadCurrent(sourceReferenceId)).resolves.toMatchObject({
      revision: 1,
      sourceReferenceId,
    });

    await expect(
      repositoryAsRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole, (repository) =>
        repository.record({
          expectedRevision: null,
          correlationId: randomUUID(),
          evidence: evidence({ sourceReferenceId: 'rpc-primary:api-denied' }),
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      queryAsRole(
        operationPool,
        PRODUCTION_DATABASE_PRINCIPALS.legacyRuntimeRole,
        'SELECT * FROM read_aave_v3_ethereum_finalized_checkpoint($1::text)',
        [sourceReferenceId],
      ),
    ).rejects.toBeDefined();
    for (const role of [
      PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
    ]) {
      await expect(
        queryAsRole(
          operationPool,
          role,
          'SELECT count(*) FROM aave_v3_ethereum_finalized_checkpoint_events',
        ),
      ).rejects.toBeDefined();
    }
  });

  it('blocks owner mutation of append-only history and refuses destructive rollback after use', async () => {
    for (const statement of [
      'UPDATE aave_v3_ethereum_finalized_checkpoint_events SET recorded_at = clock_timestamp()',
      'DELETE FROM aave_v3_ethereum_finalized_checkpoint_events',
      'TRUNCATE aave_v3_ethereum_finalized_checkpoint_events',
      'UPDATE aave_v3_ethereum_finalized_checkpoint_recovery_events SET recorded_at = clock_timestamp()',
      'DELETE FROM aave_v3_ethereum_finalized_checkpoint_recovery_lineage',
      'TRUNCATE aave_v3_ethereum_finalized_checkpoint_recovery_sources',
    ]) {
      await expect(operationPool.query(statement)).rejects.toBeDefined();
    }
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres);
    const beforeRollbackAttempt = await repository.loadCurrent('rpc-primary:active-backfill');
    await expect(
      operationPool.query(
        `UPDATE aave_v3_ethereum_finalized_checkpoint_heads
         SET revision = revision + 1,
             last_good_event_id = (
               SELECT event_id
               FROM aave_v3_ethereum_finalized_checkpoint_events
               WHERE source_reference_id = $1 AND outcome = 'CREATED'
             ),
             updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
         WHERE source_reference_id = $1`,
        ['rpc-primary:active-backfill'],
      ),
    ).rejects.toBeDefined();
    await expect(repository.loadCurrent('rpc-primary:active-backfill')).resolves.toEqual(
      beforeRollbackAttempt,
    );
    await expect(runner.down()).rejects.toThrow(
      'cannot roll back Aave finalized checkpoints after use',
    );
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });
});
