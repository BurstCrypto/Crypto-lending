import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoinAsset,
} from '../../src/blockchain/domain/supported-asset-registry';
import type { BalanceSyncScope } from '../../src/blockchain-sync/application/ports/balance-sync.ports';
import {
  BalanceSyncCheckpointPersistenceError,
  PostgresBalanceSyncCheckpointRepository,
} from '../../src/blockchain-sync/infrastructure/postgres/postgres-balance-sync-checkpoint.repository';
import {
  PortfolioBalancePersistenceError,
  PostgresPortfolioBalanceReader,
} from '../../src/blockchain-sync/infrastructure/postgres/postgres-portfolio-balance.reader';
import {
  createBalanceSyncObservationId,
  type BalanceSyncObservation,
  type BalanceSyncPosition,
} from '../../src/blockchain-sync/domain/balance-sync';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PRODUCTION_DATABASE_PRINCIPALS } from '../../src/infrastructure/database/migrations/0005-enforce-database-principal-boundaries.migration';
import { createBalanceSyncReadModelTestSchemaMigrationV0020 } from '../../src/infrastructure/database/migrations/0020-create-balance-sync-read-model.migration';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Balance sync integration test requires loopback PostgreSQL');
  }
}

function at(base: string, offsetMilliseconds: number): string {
  return new Date(Date.parse(base) + offsetMilliseconds).toISOString();
}

function hash(character: string): string {
  return `0x${character.repeat(64)}`;
}

function positionId(networkId: string, assetIdentity: string): string {
  return createHash('sha256').update(`${networkId}\0${assetIdentity}`, 'utf8').digest('hex');
}

function positions(networkId: typeof ETHEREUM | typeof SOLANA): readonly BalanceSyncPosition[] {
  return Object.freeze(
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets
      .filter(
        (asset): asset is SupportedStablecoinAsset =>
          asset.networkId === networkId && asset.activationState === 'ACTIVE',
      )
      .map((asset, index) =>
        Object.freeze({
          positionId: positionId(networkId, asset.identity),
          stablecoin: asset.stablecoin,
          assetIdentity: asset.identity,
          amountAtomic: String((index + 1) * 1_000_000),
        }),
      ),
  );
}

function observation(options: {
  readonly scope: BalanceSyncScope;
  readonly position: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly at: string;
  readonly amountOffset?: number;
}): BalanceSyncObservation {
  const candidatePositions = positions(
    options.scope.networkId as typeof ETHEREUM | typeof SOLANA,
  ).map((position, index) => ({
    ...position,
    amountAtomic: String(Number(position.amountAtomic) + (options.amountOffset ?? 0) + index),
  }));
  const source = Object.freeze({
    position: options.position,
    hash: options.hash,
    parentHash: options.parentHash,
    selector: options.scope.networkId === ETHEREUM ? ('latest' as const) : ('confirmed' as const),
    retrievedAt: options.at,
  });
  return Object.freeze({
    observationId: createBalanceSyncObservationId({
      ...options.scope,
      tier: 'PROVISIONAL',
      source,
      positions: candidatePositions,
    }),
    ...options.scope,
    tier: 'PROVISIONAL',
    source,
    headAdvancedAt: options.at,
    positions: Object.freeze(candidatePositions),
  });
}

async function asRole<Row extends QueryResultRow>(
  pool: Pool,
  role: string,
  sql: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    const result = await client.query<Row>(sql, values);
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
  operation: (repository: PostgresBalanceSyncCheckpointRepository) => Promise<T>,
): Promise<T> {
  return postgres.withTransaction(async (client: PoolClient) => {
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    return operation(new PostgresBalanceSyncCheckpointRepository(postgres));
  });
}

describeWithPostgres('balance sync PostgreSQL read model', () => {
  let adminPool: Pool;
  let operationPool: Pool;
  let postgres: PostgresService;
  let runner: MigrationRunner;
  let databaseNow: string;
  let accountId: string;
  let otherAccountId: string;
  let ethereumWalletId: string;
  let solanaWalletId: string;
  const schema = `balance_sync_${randomBytes(8).toString('hex')}`;
  const expectedMigrationIds = DATABASE_TEST_SCHEMA_MIGRATION_LIST.map(({ id }) => id);

  async function registerWallet(
    ownerAccountId: string,
    networkId: typeof ETHEREUM | typeof SOLANA,
  ): Promise<string> {
    const walletId = randomUUID();
    const challengeId = randomUUID();
    const ethereum = networkId === ETHEREUM;
    const namespace = ethereum ? 'eip155' : 'solana';
    const reference = ethereum ? '1' : '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
    const proofScheme = ethereum ? 'EVM_ERC4361_ERC191' : 'SOLANA_SIWS_SIGN_MESSAGE';
    const addressDigest = randomBytes(32);
    await operationPool.query(
      `INSERT INTO wallet_ownership_challenges (
         challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
         registry_environment, registry_version, registry_fingerprint_sha256,
         address_digest_version, address_digest, domain_digest_version, domain_digest,
         message_digest_version, message_digest, nonce_digest_version, nonce_digest,
         status, created_at, issued_at, expires_at, completed_at, payload_destroyed_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'MAINNET', 1, $6,
         1, $7, 1, $8, 1, $9, 1, $10, 'REGISTERED',
         statement_timestamp() - interval '2 minutes',
         statement_timestamp() - interval '2 minutes',
         statement_timestamp() + interval '5 minutes',
         statement_timestamp() - interval '1 minute',
         statement_timestamp() - interval '1 minute'
       )`,
      [
        challengeId,
        ownerAccountId,
        proofScheme,
        namespace,
        reference,
        REGISTRY_FINGERPRINT,
        addressDigest,
        randomBytes(32),
        randomBytes(32),
        randomBytes(32),
      ],
    );
    await operationPool.query(
      `INSERT INTO wallet_ownership_challenge_identity_digests (
         challenge_id, account_id, chain_namespace, chain_reference,
         address_digest_version, address_digest
       ) VALUES ($1, $2, $3, $4, 1, $5)`,
      [challengeId, ownerAccountId, namespace, reference, addressDigest],
    );
    await operationPool.query(
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
        namespace,
        reference,
        REGISTRY_FINGERPRINT,
        addressDigest,
        Buffer.from('balance-sync-encrypted-address'),
        randomBytes(12),
        randomBytes(16),
        Buffer.from('balance-sync-encrypted-metadata'),
        randomBytes(12),
        randomBytes(16),
      ],
    );
    return walletId;
  }

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    requireLoopback(testDatabaseUrl);
    adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
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
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole)}`,
    );
    operationPool = new Pool({
      connectionString: testDatabaseUrl,
      max: 8,
      options: `-c search_path=${schema}`,
    });
    postgres = new PostgresService(operationPool);
    runner = new MigrationRunner(operationPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);
    try {
      expect(await runner.up()).toEqual(expectedMigrationIds);
    } catch (error) {
      const postgresError = error as Error & {
        position?: string;
        internalPosition?: string;
        internalQuery?: string;
        where?: string;
      };
      throw new Error(
        JSON.stringify({
          message: postgresError.message,
          position: postgresError.position,
          internalPosition: postgresError.internalPosition,
          internalQuery: postgresError.internalQuery,
          where: postgresError.where,
        }),
        { cause: error },
      );
    }
    const clock = await operationPool.query<{ now: Date }>(
      "SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) AS now",
    );
    databaseNow = clock.rows[0]?.now.toISOString() ?? '';
    accountId = randomUUID();
    otherAccountId = randomUUID();
    await operationPool.query('INSERT INTO accounts (account_id) VALUES ($1), ($2)', [
      accountId,
      otherAccountId,
    ]);
    ethereumWalletId = await registerWallet(accountId, ETHEREUM);
    solanaWalletId = await registerWallet(accountId, SOLANA);
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('applies and verifies the complete migration chain', async () => {
    await expect(runner.status()).resolves.toEqual(
      expectedMigrationIds.map((id, index) => ({
        id,
        description: DATABASE_TEST_SCHEMA_MIGRATION_LIST[index]?.description ?? '',
        applied: true,
      })),
    );
    const verified = await operationPool.query<{ valid: boolean }>(
      createBalanceSyncReadModelTestSchemaMigrationV0020.verifySql ?? 'SELECT false AS valid',
    );
    expect(verified.rows).toEqual([{ valid: true }]);

    const client = await operationPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DROP TRIGGER balance_sync_observations_append_only_row ON balance_sync_observations',
      );
      await client.query(
        `CREATE TRIGGER balance_sync_observations_append_only_row
         BEFORE DELETE ON balance_sync_observation_positions
         FOR EACH ROW EXECUTE FUNCTION reject_balance_sync_history_mutation()`,
      );
      const tampered = await client.query<{ valid: boolean }>(
        createBalanceSyncReadModelTestSchemaMigrationV0020.verifySql ?? 'SELECT true AS valid',
      );
      expect(tampered.rows).toEqual([{ valid: false }]);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    const restored = await operationPool.query<{ valid: boolean }>(
      createBalanceSyncReadModelTestSchemaMigrationV0020.verifySql ?? 'SELECT false AS valid',
    );
    expect(restored.rows).toEqual([{ valid: true }]);
  });

  it('persists, replays, advances, and marks exact active-wallet observations stale', async () => {
    const repository = new PostgresBalanceSyncCheckpointRepository(postgres);
    const scope: BalanceSyncScope = { accountId, walletId: ethereumWalletId, networkId: ETHEREUM };
    const first = observation({
      scope,
      position: '100',
      hash: hash('2'),
      parentHash: hash('1'),
      at: at(databaseNow, -5_000),
    });
    await repositoryAsRole(postgres, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, (asWorker) =>
      asWorker.upsertCurrent({
        scope,
        expectedRevision: null,
        observation: first,
        mode: 'CREATED',
        succeededAt: at(databaseNow, -4_000),
      }),
    );
    await expect(
      repository.upsertCurrent({
        scope,
        expectedRevision: null,
        observation: first,
        mode: 'CREATED',
        succeededAt: at(databaseNow, -4_000),
      }),
    ).resolves.toBeUndefined();
    await expect(repository.load(scope)).resolves.toMatchObject({
      revision: 1,
      freshness: 'CURRENT',
      currentObservation: { observationId: first.observationId },
    });

    const second = observation({
      scope,
      position: '101',
      hash: hash('3'),
      parentHash: hash('2'),
      at: at(databaseNow, -3_000),
      amountOffset: 10,
    });
    await repository.upsertCurrent({
      scope,
      expectedRevision: 1,
      observation: second,
      mode: 'UPDATED',
      succeededAt: at(databaseNow, -2_000),
    });
    await repository.preserveLastGoodAndMarkStale({
      scope,
      expectedRevision: 2,
      failedAt: at(databaseNow, -1_000),
      failureCode: 'PROVIDER_TIMEOUT',
    });
    await expect(repository.load(scope)).resolves.toMatchObject({
      revision: 3,
      freshness: 'STALE',
      staleSince: at(databaseNow, -1_000),
      lastFailureCode: 'PROVIDER_TIMEOUT',
      currentObservation: { observationId: second.observationId },
    });
    const counts = await operationPool.query<{ observations: string; events: string }>(
      `SELECT
         (SELECT pg_catalog.count(*)::text FROM balance_sync_observations) AS observations,
         (SELECT pg_catalog.count(*)::text FROM balance_sync_checkpoint_events) AS events`,
    );
    expect(counts.rows).toEqual([{ observations: '2', events: '3' }]);
  });

  it('detects a conflicting raw-observation replay even after aggregate reads', async () => {
    const stored = await operationPool.query<{
      account_id: string;
      wallet_id: string;
      network_id: string;
      tier: string;
      observation_id: string;
      source_position: string;
      source_hash: string;
      source_parent_hash: string;
      selector: string;
      retrieved_at: Date;
      head_advanced_at: Date;
      accepted_at: Date;
      positions: unknown;
    }>(
      `SELECT observation.account_id, observation.wallet_id, observation.network_id,
         observation.tier, observation.observation_id, observation.source_position,
         observation.source_hash, observation.source_parent_hash, observation.selector,
         observation.retrieved_at, observation.head_advanced_at, observation.accepted_at,
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'positionId', position.position_id,
           'stablecoin', position.stablecoin,
           'assetIdentity', position.asset_identity,
           'amountAtomic', position.amount_atomic
         ) ORDER BY position.position_id) AS positions
       FROM balance_sync_observations AS observation
       INNER JOIN balance_sync_observation_positions AS position
         ON position.observation_id = observation.observation_id
       WHERE observation.account_id = $1
         AND observation.wallet_id = $2
         AND observation.source_position = 100
       GROUP BY observation.observation_id`,
      [accountId, ethereumWalletId],
    );
    const row = stored.rows[0];
    if (!row) throw new Error('Expected raw Ethereum observation');
    const client = await operationPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'ALTER TABLE balance_sync_observations DISABLE TRIGGER balance_sync_observations_append_only_row',
      );
      await client.query(
        `UPDATE balance_sync_observations
         SET retrieved_at = retrieved_at - interval '1 second'
         WHERE observation_id = $1`,
        [row.observation_id],
      );
      await client.query(
        'ALTER TABLE balance_sync_observations ENABLE ALWAYS TRIGGER balance_sync_observations_append_only_row',
      );
      await expect(
        client.query(
          `SELECT * FROM record_balance_sync_current(
             $1::uuid, $2::uuid, $3::text, NULL, 'CREATED', $4::text,
             $5::numeric, $6::text, $7::text, $8::text, $9::timestamptz,
             $10::timestamptz, $11::jsonb, $12::timestamptz
           )`,
          [
            row.account_id,
            row.wallet_id,
            row.network_id,
            row.observation_id,
            row.source_position,
            row.source_hash,
            row.source_parent_hash,
            row.selector,
            row.retrieved_at,
            row.head_advanced_at,
            JSON.stringify(row.positions),
            row.accepted_at,
          ],
        ),
      ).rejects.toMatchObject({ code: 'D2001' });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('returns roster-bound current Solana balances without activating portfolio pricing', async () => {
    const scope: BalanceSyncScope = { accountId, walletId: solanaWalletId, networkId: SOLANA };
    const current = observation({
      scope,
      position: '500',
      hash: '2'.repeat(64),
      parentHash: '1'.repeat(64),
      at: at(databaseNow, -5_000),
    });
    const repository = new PostgresBalanceSyncCheckpointRepository(postgres);
    await repository.upsertCurrent({
      scope,
      expectedRevision: null,
      observation: current,
      mode: 'CREATED',
      succeededAt: at(databaseNow, -4_000),
    });
    const reader = new PostgresPortfolioBalanceReader(postgres);
    await expect(
      asRole(
        operationPool,
        PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole,
        `SELECT * FROM read_balance_sync_portfolio($1::uuid, $2::jsonb, $3::timestamptz)`,
        [
          accountId,
          JSON.stringify([
            { walletId: ethereumWalletId, networkId: ETHEREUM },
            { walletId: solanaWalletId, networkId: SOLANA },
          ]),
          databaseNow,
        ],
      ),
    ).resolves.toBeDefined();
    await expect(
      reader.readCurrentBalances({
        accountId: accountId as never,
        evaluatedAt: databaseNow,
        correlationId: randomUUID(),
        expectedWallets: [
          { walletId: ethereumWalletId, networkId: ETHEREUM },
          { walletId: solanaWalletId, networkId: SOLANA },
        ],
      }),
    ).resolves.toMatchObject({
      freshnessClass: 'STALE',
      coverage: {
        status: 'COMPLETE',
        targets: expect.arrayContaining([
          { walletId: ethereumWalletId, networkId: ETHEREUM, status: 'COMPLETE' },
          { walletId: solanaWalletId, networkId: SOLANA, status: 'COMPLETE' },
        ]),
      },
      observations: expect.arrayContaining([
        expect.objectContaining({ walletId: solanaWalletId, networkId: SOLANA }),
      ]),
    });
  });

  it('rejects cross-account, unsupported-network, source-gap, and malformed payload writes', async () => {
    const repository = new PostgresBalanceSyncCheckpointRepository(postgres);
    const wrongScope: BalanceSyncScope = {
      accountId: otherAccountId,
      walletId: ethereumWalletId,
      networkId: ETHEREUM,
    };
    const candidate = observation({
      scope: wrongScope,
      position: '1',
      hash: hash('8'),
      parentHash: hash('7'),
      at: at(databaseNow, -1_000),
    });
    await expect(
      repository.upsertCurrent({
        scope: wrongScope,
        expectedRevision: null,
        observation: candidate,
        mode: 'CREATED',
        succeededAt: databaseNow,
      }),
    ).rejects.toBeInstanceOf(BalanceSyncCheckpointPersistenceError);
    await expect(
      operationPool.query(
        `SELECT * FROM mark_balance_sync_checkpoint_stale(
           $1::uuid, $2::uuid, 'eip155:8453', NULL, $3::timestamptz, 'PROVIDER_TIMEOUT'
         )`,
        [accountId, ethereumWalletId, databaseNow],
      ),
    ).rejects.toMatchObject({ code: '22023' });

    const current = (
      await repository.load({
        accountId,
        walletId: ethereumWalletId,
        networkId: ETHEREUM,
      })
    )?.currentObservation;
    if (!current) throw new Error('Expected Ethereum checkpoint');
    const gap = observation({
      scope: { accountId, walletId: ethereumWalletId, networkId: ETHEREUM },
      position: '103',
      hash: hash('5'),
      parentHash: hash('4'),
      at: databaseNow,
    });
    await expect(
      repository.upsertCurrent({
        scope: { accountId, walletId: ethereumWalletId, networkId: ETHEREUM },
        expectedRevision: 3,
        observation: gap,
        mode: 'UPDATED',
        succeededAt: databaseNow,
      }),
    ).rejects.toBeInstanceOf(BalanceSyncCheckpointPersistenceError);
    await expect(
      repository.upsertCurrent({
        scope: { accountId, walletId: ethereumWalletId, networkId: ETHEREUM },
        expectedRevision: 3,
        observation: { ...current, positions: current.positions.slice(0, 2) },
        mode: 'UNCHANGED',
        succeededAt: databaseNow,
      }),
    ).rejects.toBeInstanceOf(BalanceSyncCheckpointPersistenceError);

    const ethereumCheckpoint = await repository.load({
      accountId,
      walletId: ethereumWalletId,
      networkId: ETHEREUM,
    });
    if (!ethereumCheckpoint?.currentObservation) throw new Error('Expected Ethereum observation');
    await expect(
      operationPool.query(
        `INSERT INTO balance_sync_checkpoint_events (
           event_id, account_id, wallet_id, chain_namespace, chain_reference,
           network_id, revision, expected_revision, event_type, transition_mode,
           current_observation_id, freshness, stale_since, last_failure_code,
           last_finalized_position, last_finalized_hash, last_finalized_parent_hash,
           last_finalized_selector, last_finalized_retrieved_at, effective_at, recorded_at
         ) VALUES (
           $1, $2, $3, 'solana', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
           $4, 9, 8, 'CURRENT_ACCEPTED', 'UPDATED', $5, 'CURRENT', NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, $6, $6
         )`,
        [
          'a'.repeat(64),
          accountId,
          solanaWalletId,
          SOLANA,
          ethereumCheckpoint.currentObservation.observationId,
          databaseNow,
        ],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'balance_sync_event_observation_scope_fk',
    });

    const projectionWalletId = await registerWallet(accountId, ETHEREUM);
    await expect(
      operationPool.query(
        `INSERT INTO balance_sync_checkpoints (
           account_id, wallet_id, chain_namespace, chain_reference, network_id,
           revision, current_observation_id, freshness, stale_since, last_failure_code,
           last_finalized_position, last_finalized_hash, last_finalized_parent_hash,
           last_finalized_selector, last_finalized_retrieved_at, last_event_id, updated_at
         ) VALUES (
           $1, $2, 'eip155', '1', $3, 1, NULL, 'UNAVAILABLE', $4,
           'PROVIDER_UNAVAILABLE', NULL, NULL, NULL, NULL, NULL, $5, $4
         )`,
        [accountId, projectionWalletId, ETHEREUM, databaseNow, 'b'.repeat(64)],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('projection is not bound to its event'),
    });
  });

  it('serializes competing first writes and rolls back the losing raw observation', async () => {
    const walletId = await registerWallet(accountId, SOLANA);
    const scope: BalanceSyncScope = { accountId, walletId, networkId: SOLANA };
    const candidates = ['3', '4'].map((character, index) =>
      observation({
        scope,
        position: '700',
        hash: character.repeat(64),
        parentHash: '1'.repeat(64),
        at: at(databaseNow, -1_000),
        amountOffset: index * 100,
      }),
    );
    const repository = new PostgresBalanceSyncCheckpointRepository(postgres);
    const outcomes = await Promise.allSettled(
      candidates.map((candidate) =>
        repository.upsertCurrent({
          scope,
          expectedRevision: null,
          observation: candidate,
          mode: 'CREATED',
          succeededAt: databaseNow,
        }),
      ),
    );
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(BalanceSyncCheckpointPersistenceError);
    const durable = await operationPool.query<{ observations: string; events: string }>(
      `SELECT
         (SELECT pg_catalog.count(*)::text FROM balance_sync_observations
          WHERE wallet_id = $1) AS observations,
         (SELECT pg_catalog.count(*)::text FROM balance_sync_checkpoint_events
          WHERE wallet_id = $1) AS events`,
      [walletId],
    );
    expect(durable.rows).toEqual([{ observations: '1', events: '1' }]);
  });

  it('records an idempotent finalized anchor and replaces only provisional reorg state', async () => {
    const scope: BalanceSyncScope = { accountId, walletId: ethereumWalletId, networkId: ETHEREUM };
    const anchor = Object.freeze({
      position: '100',
      hash: hash('2'),
      parentHash: hash('1'),
      selector: 'finalized' as const,
      retrievedAt: at(databaseNow, -5_000),
    });
    const anchorParameters = [
      scope.accountId,
      scope.walletId,
      scope.networkId,
      3,
      anchor.position,
      anchor.hash,
      anchor.parentHash,
      anchor.selector,
      anchor.retrievedAt,
      databaseNow,
    ];
    const anchorSql = `SELECT * FROM record_balance_sync_finalized_anchor(
      $1::uuid, $2::uuid, $3::text, $4::bigint, $5::numeric,
      $6::text, $7::text, $8::text, $9::timestamptz, $10::timestamptz
    )`;
    await expect(operationPool.query(anchorSql, anchorParameters)).resolves.toMatchObject({
      rows: [{ write_outcome: 'APPLIED', checkpoint_revision: '4' }],
    });
    await expect(operationPool.query(anchorSql, anchorParameters)).resolves.toMatchObject({
      rows: [{ write_outcome: 'IDEMPOTENT_REPLAY', checkpoint_revision: '4' }],
    });

    const replacement = observation({
      scope,
      position: '101',
      hash: hash('4'),
      parentHash: anchor.hash,
      at: at(databaseNow, -500),
      amountOffset: 500,
    });
    const repository = new PostgresBalanceSyncCheckpointRepository(postgres);
    const recovery = {
      scope,
      expectedRevision: 4,
      lastFinalizedSource: anchor,
      replacement,
      recoveredAt: databaseNow,
    } as const;
    await expect(repository.replaceProvisionalAfterReorg(recovery)).resolves.toBeUndefined();
    await expect(repository.replaceProvisionalAfterReorg(recovery)).resolves.toBeUndefined();
    await expect(repository.load(scope)).resolves.toMatchObject({
      revision: 5,
      freshness: 'CURRENT',
      lastFinalizedSource: anchor,
      currentObservation: { observationId: replacement.observationId },
    });
    const history = await operationPool.query<{ observations: string; recovery_events: string }>(
      `SELECT
         (SELECT pg_catalog.count(*)::text FROM balance_sync_observations
          WHERE wallet_id = $1) AS observations,
         (SELECT pg_catalog.count(*)::text FROM balance_sync_checkpoint_events
          WHERE wallet_id = $1 AND event_type = 'REORG_RECOVERED') AS recovery_events`,
      [scope.walletId],
    );
    expect(history.rows).toEqual([{ observations: '3', recovery_events: '1' }]);
  });

  it('enforces exact runtime ACLs, append-only history, and rollback refusal', async () => {
    const api = PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole;
    const worker = PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole;
    await expect(
      asRole(operationPool, api, 'SELECT * FROM read_balance_sync_checkpoint($1,$2,$3)', [
        accountId,
        ethereumWalletId,
        ETHEREUM,
      ]),
    ).rejects.toBeDefined();
    await expect(
      asRole(operationPool, worker, 'SELECT * FROM read_balance_sync_portfolio($1,$2,$3)', [
        accountId,
        '[]',
        databaseNow,
      ]),
    ).rejects.toBeDefined();
    await expect(
      asRole(operationPool, worker, 'SELECT * FROM balance_sync_observations'),
    ).rejects.toBeDefined();
    await expect(
      asRole(operationPool, api, 'SELECT * FROM balance_sync_checkpoints'),
    ).rejects.toBeDefined();
    await expect(
      asRole(
        operationPool,
        worker,
        `SELECT * FROM record_balance_sync_finalized_anchor(
          $1,$2,$3,3,100,$4,$5,'finalized',$6,$7
        )`,
        [
          accountId,
          ethereumWalletId,
          ETHEREUM,
          hash('2'),
          hash('1'),
          at(databaseNow, -5_000),
          databaseNow,
        ],
      ),
    ).rejects.toBeDefined();
    await expect(
      operationPool.query(`UPDATE balance_sync_checkpoint_events
        SET recorded_at = recorded_at
        WHERE event_id = (
          SELECT event_id FROM balance_sync_checkpoint_events ORDER BY event_id LIMIT 1
        )`),
    ).rejects.toBeDefined();
    const rollbackCountThroughBalanceSync =
      expectedMigrationIds.length - expectedMigrationIds.indexOf('0020');
    await expect(runner.down(rollbackCountThroughBalanceSync)).rejects.toThrow(
      'cannot roll back balance sync read model after use',
    );
    await expect(
      new PostgresPortfolioBalanceReader(postgres).readCurrentBalances({
        accountId: accountId as never,
        evaluatedAt: databaseNow,
        correlationId: randomUUID(),
        expectedWallets: [{ walletId: randomUUID(), networkId: ETHEREUM }],
      }),
    ).rejects.toBeInstanceOf(PortfolioBalancePersistenceError);
  });
});
