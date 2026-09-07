import { createHash, randomBytes } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PRODUCTION_DATABASE_PRINCIPALS } from '../../src/infrastructure/database/migrations/0005-enforce-database-principal-boundaries.migration';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

type NetworkId = typeof ETHEREUM | typeof SOLANA;

const EVIDENCE_ARGUMENT_CASTS = Object.freeze([
  'text',
  'text',
  'text',
  'text',
  'text',
  'jsonb',
  'jsonb',
  'timestamptz',
  'timestamptz',
  'jsonb',
  'timestamptz',
  'jsonb',
  'timestamptz',
  'text',
  'text',
  'text',
  'text',
  'text',
  'text',
  'text',
  'text',
  'text',
  'timestamptz',
] as const);
const EVIDENCE_ARGUMENT_SQL = EVIDENCE_ARGUMENT_CASTS.map(
  (cast, index) => `$${index + 1}::${cast}`,
).join(', ');
const PREPARE_SQL = `SELECT *
  FROM prepare_provider_position_chain_anchor_record_intent(
    ${EVIDENCE_ARGUMENT_SQL}, $24::timestamptz
  )`;
const DIRECT_RECORD_SQL = `SELECT *
  FROM record_provider_position_chain_anchor_evidence_guarded(
    ${EVIDENCE_ARGUMENT_SQL}, $24::timestamptz, $25::text
  )`;

interface EvidenceFixture {
  readonly networkId: NetworkId;
  readonly values: readonly unknown[];
  readonly producerDeadlineAt: string;
}

interface PreparedIntentRow extends QueryResultRow {
  intent_state: string;
  prepared_record_intent_fingerprint_sha256: string;
  prepared_evidence_fingerprint_sha256: string;
  prepared_read_binding_fingerprint_sha256: string;
  prepared_deadline_binding_sha256: string | null;
  prepared_evidence_recorded_at: Date | null;
  prepared_resolved_at: Date | null;
  prepared_producer_deadline_at: Date;
}

interface ClaimedIntentRow extends QueryResultRow {
  intent_state: string;
  claimed_record_intent_fingerprint_sha256: string;
  claimed_deadline_binding_sha256: string | null;
  claimed_evidence_recorded_at: Date | null;
  claimed_resolved_at: Date | null;
}

interface ExecutedIntentRow extends QueryResultRow {
  intent_state: string;
  executed_record_intent_fingerprint_sha256: string;
  executed_evidence_fingerprint_sha256: string;
  executed_read_binding_fingerprint_sha256: string;
  executed_deadline_binding_sha256: string | null;
  executed_evidence_recorded_at: Date | null;
  executed_resolved_at: Date | null;
  executed_producer_deadline_at: Date;
}

interface LeasedIntentRow extends QueryResultRow {
  leased_record_intent_fingerprint_sha256: string;
  leased_evidence_fingerprint_sha256: string;
  leased_intent_state: string;
  leased_producer_deadline_at: Date;
  leased_reconciliation_attempt_count: string;
  leased_at: Date;
  lease_expires_at: Date;
}

interface ReconciledIntentRow extends QueryResultRow {
  intent_state: string;
  reconciled_record_intent_fingerprint_sha256: string;
  reconciled_evidence_fingerprint_sha256: string;
  reconciled_read_binding_fingerprint_sha256: string;
  reconciled_deadline_binding_sha256: string | null;
  reconciled_evidence_recorded_at: Date | null;
  reconciled_resolved_at: Date | null;
  reconciled_producer_deadline_at: Date;
}

interface DirectRecordRow extends QueryResultRow {
  record_outcome: string;
  recorded_evidence_fingerprint_sha256: string | null;
  evidence_recorded_at: Date | null;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Provider chain-anchor intent integration requires loopback PostgreSQL');
  }
}

function timestamp(baseMilliseconds: number, offsetMilliseconds: number): string {
  return new Date(baseMilliseconds + offsetMilliseconds).toISOString();
}

function fingerprint(label: string): string {
  const value = createHash('sha256').update(label, 'utf8').digest('hex');
  if (!SHA256.test(value) || value === '0'.repeat(64)) {
    throw new Error('Synthetic test fingerprint generation failed');
  }
  return value;
}

function requireRow<Row extends QueryResultRow>(rows: readonly Row[], context: string): Row {
  const row = rows[0];
  if (!row || rows.length !== 1) throw new Error(`${context} did not return exactly one row`);
  return row;
}

describeWithPostgres('provider position chain-anchor record intents PostgreSQL controls', () => {
  jest.setTimeout(180_000);

  const schema = `anchor_intents_${randomBytes(8).toString('hex')}`;
  const expectedMigrationIds = DATABASE_TEST_SCHEMA_MIGRATION_LIST.map(({ id }) => id);
  let fixtureSequence = 0;
  let appliedMigrationIds: string[] = [];
  let adminPool: Pool;
  let operationPool: Pool;
  let runner: MigrationRunner;

  async function databaseNowMilliseconds(): Promise<number> {
    const result = await operationPool.query<{ database_now: Date }>(
      "SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) AS database_now",
    );
    const databaseNow = requireRow(result.rows, 'database clock').database_now;
    return databaseNow.getTime();
  }

  async function evidenceFixture(
    networkId: NetworkId,
    deadlineOffsetMilliseconds = 20_000,
  ): Promise<EvidenceFixture> {
    fixtureSequence += 1;
    const sequence = fixtureSequence;
    const now = await databaseNowMilliseconds();
    const basePosition =
      networkId === ETHEREUM
        ? 20_000_000n + BigInt(sequence * 100)
        : 440_000_000n + BigInt(sequence * 100);
    const fixtureDomain = `${schema}:${networkId}:${sequence}`;
    const continuityFloor =
      networkId === ETHEREUM
        ? {
            kind: 'EVM_BLOCK',
            blockNumber: basePosition.toString(),
            blockHash: `0x${fingerprint(`${fixtureDomain}:floor`)}`,
          }
        : {
            kind: 'SOLANA_SLOT',
            slot: basePosition.toString(),
            root: (basePosition - 5n).toString(),
          };
    const chainAnchor =
      networkId === ETHEREUM
        ? {
            kind: 'EVM_BLOCK',
            blockNumber: (basePosition + 1n).toString(),
            blockHash: `0x${fingerprint(`${fixtureDomain}:anchor`)}`,
          }
        : {
            kind: 'SOLANA_SLOT',
            slot: (basePosition + 2n).toString(),
            root: (basePosition - 3n).toString(),
          };
    const agreedCurrentHead =
      networkId === ETHEREUM
        ? {
            kind: 'EVM_BLOCK',
            blockNumber: (basePosition + 10n).toString(),
            blockHash: `0x${fingerprint(`${fixtureDomain}:current`)}`,
          }
        : {
            kind: 'SOLANA_SLOT',
            slot: (basePosition + 10n).toString(),
            root: (basePosition + 8n).toString(),
          };
    const agreedFinalizedHead =
      networkId === ETHEREUM
        ? {
            kind: 'EVM_BLOCK',
            blockNumber: (basePosition + 5n).toString(),
            blockHash: `0x${fingerprint(`${fixtureDomain}:finalized`)}`,
          }
        : {
            kind: 'SOLANA_SLOT',
            slot: (basePosition + 8n).toString(),
            root: (basePosition + 8n).toString(),
          };
    const observedAt = timestamp(now, -1_000);
    const assessedAt = timestamp(now, 0);
    const producerDeadlineAt = timestamp(now, deadlineOffsetMilliseconds);
    const sourceObservationId =
      networkId === ETHEREUM
        ? `ethereum-block-${chainAnchor.blockNumber}`
        : `solana-slot-${chainAnchor.slot}`;

    return {
      networkId,
      producerDeadlineAt,
      values: [
        networkId,
        'family-a',
        'source-a',
        'RPC',
        sourceObservationId,
        continuityFloor,
        chainAnchor,
        observedAt,
        assessedAt,
        agreedCurrentHead,
        timestamp(now, -500),
        agreedFinalizedHead,
        timestamp(now, -500),
        fingerprint(`${fixtureDomain}:identity-proof`),
        fingerprint(`${fixtureDomain}:capability-proof`),
        fingerprint(`${fixtureDomain}:lineage-proof`),
        'family-a',
        'source-a',
        'family-b',
        'source-b',
        `approval-${sequence}`,
        REGISTRY_FINGERPRINT,
        timestamp(now, 300_000),
      ],
    };
  }

  async function prepare(fixture: EvidenceFixture): Promise<PreparedIntentRow> {
    const result = await operationPool.query<PreparedIntentRow>(PREPARE_SQL, [
      ...fixture.values,
      fixture.producerDeadlineAt,
    ]);
    return requireRow(result.rows, 'intent preparation');
  }

  async function waitUntilDeadline(producerDeadlineAt: string): Promise<void> {
    for (;;) {
      const remainingMilliseconds =
        Date.parse(producerDeadlineAt) - (await databaseNowMilliseconds());
      if (remainingMilliseconds <= 0) return;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(remainingMilliseconds + 25, 500)),
      );
    }
  }

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
    const identity = requireRow(fixtureIdentity.rows, 'local principal fixture identity');
    assertLocalPrincipalFixture({
      database: identity.database,
      bootstrapRole: identity.bootstrap_role,
      marker: identity.marker,
    });
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.legacyRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.migrationRole)}`,
    );
    operationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    runner = new MigrationRunner(operationPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);
    appliedMigrationIds = await runner.up();
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('applies migration 0031 and its cumulative live catalog verifier returns true', async () => {
    expect(appliedMigrationIds).toEqual(expectedMigrationIds);
    const migration = DATABASE_TEST_SCHEMA_MIGRATION_LIST.find(({ id }) => id === '0031');
    if (!migration?.verifySql) throw new Error('Migration 0031 verifier is missing');
    await expect(operationPool.query<{ valid: boolean }>(migration.verifySql)).resolves.toEqual(
      expect.objectContaining({ rows: [{ valid: true }] }),
    );

    await expect(runner.down(1)).resolves.toEqual(['0031']);
    await expect(
      operationPool.query<{
        intent_table: string | null;
        claim_function: string | null;
        deadline_intent_constraint: string | null;
      }>(
        `SELECT
           pg_catalog.to_regclass(
             'provider_position_chain_anchor_record_intents'
           )::text AS intent_table,
           pg_catalog.to_regprocedure(
             'claim_provider_position_chain_anchor_record_dispatch(text,bytea)'
           )::text AS claim_function,
           (
             SELECT constraint_record.conname::text
             FROM pg_catalog.pg_constraint AS constraint_record
             WHERE constraint_record.conname =
               'provider_position_chain_anchor_deadline_intent_fk'
               AND constraint_record.conrelid = pg_catalog.to_regclass(
                 'provider_position_chain_anchor_record_deadlines'
               )
           ) AS deadline_intent_constraint`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          intent_table: null,
          claim_function: null,
          deadline_intent_constraint: null,
        },
      ],
    });
    await expect(runner.up()).resolves.toEqual(['0031']);
    await expect(operationPool.query<{ valid: boolean }>(migration.verifySql)).resolves.toEqual(
      expect.objectContaining({ rows: [{ valid: true }] }),
    );
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });

  it('prepares distinct dynamic Ethereum and Solana record intents', async () => {
    const fixtures = await Promise.all([evidenceFixture(ETHEREUM), evidenceFixture(SOLANA)]);
    const prepared = await Promise.all(fixtures.map((fixture) => prepare(fixture)));

    expect(prepared.map(({ intent_state }) => intent_state)).toEqual(['NEW', 'NEW']);
    for (const [index, row] of prepared.entries()) {
      const fixture = fixtures[index];
      if (!fixture) throw new Error('Prepared fixture is missing');
      expect(row).toMatchObject({
        intent_state: 'NEW',
        prepared_deadline_binding_sha256: null,
        prepared_evidence_recorded_at: null,
        prepared_resolved_at: null,
      });
      expect(row.prepared_record_intent_fingerprint_sha256).toMatch(SHA256);
      expect(row.prepared_evidence_fingerprint_sha256).toMatch(SHA256);
      expect(row.prepared_read_binding_fingerprint_sha256).toMatch(SHA256);
      expect(row.prepared_producer_deadline_at.toISOString()).toBe(fixture.producerDeadlineAt);
    }

    const stored = await operationPool.query<{ network_id: string }>(
      `SELECT network_id
       FROM provider_position_chain_anchor_record_intents
       WHERE record_intent_fingerprint_sha256 = ANY($1::text[])
       ORDER BY network_id`,
      [prepared.map((row) => row.prepared_record_intent_fingerprint_sha256)],
    );
    expect(stored.rows.map(({ network_id }) => network_id).sort()).toEqual(
      [ETHEREUM, SOLANA].sort(),
    );

    for (const row of prepared) {
      const dispatchToken = randomBytes(32);
      await operationPool.query(
        `SELECT * FROM claim_provider_position_chain_anchor_record_dispatch(
           $1::text, $2::bytea
         )`,
        [row.prepared_record_intent_fingerprint_sha256, dispatchToken],
      );
      await expect(
        operationPool.query(
          `SELECT * FROM execute_provider_position_chain_anchor_record_intent(
             $1::text, $2::bytea
           )`,
          [row.prepared_record_intent_fingerprint_sha256, dispatchToken],
        ),
      ).resolves.toMatchObject({ rows: [{ intent_state: 'RECORDED' }] });
    }
  });

  it('claims and executes once, then observes the same terminal record idempotently', async () => {
    const fixture = await evidenceFixture(ETHEREUM);
    const prepared = await prepare(fixture);
    const dispatchToken = randomBytes(32);

    const claim = requireRow(
      (
        await operationPool.query<ClaimedIntentRow>(
          `SELECT * FROM claim_provider_position_chain_anchor_record_dispatch(
             $1::text, $2::bytea
           )`,
          [prepared.prepared_record_intent_fingerprint_sha256, dispatchToken],
        )
      ).rows,
      'dispatch claim',
    );
    expect(claim).toMatchObject({
      intent_state: 'RECORD_DISPATCHED',
      claimed_record_intent_fingerprint_sha256: prepared.prepared_record_intent_fingerprint_sha256,
      claimed_deadline_binding_sha256: null,
      claimed_evidence_recorded_at: null,
      claimed_resolved_at: null,
    });

    const execute = async (): Promise<ExecutedIntentRow> =>
      requireRow(
        (
          await operationPool.query<ExecutedIntentRow>(
            `SELECT * FROM execute_provider_position_chain_anchor_record_intent(
               $1::text, $2::bytea
             )`,
            [prepared.prepared_record_intent_fingerprint_sha256, dispatchToken],
          )
        ).rows,
        'record intent execution',
      );
    const recorded = await execute();
    expect(recorded).toMatchObject({
      intent_state: 'RECORDED',
      executed_record_intent_fingerprint_sha256: prepared.prepared_record_intent_fingerprint_sha256,
      executed_evidence_fingerprint_sha256: prepared.prepared_evidence_fingerprint_sha256,
      executed_read_binding_fingerprint_sha256: prepared.prepared_read_binding_fingerprint_sha256,
    });
    expect(recorded.executed_deadline_binding_sha256).toMatch(SHA256);
    expect(recorded.executed_evidence_recorded_at).toBeInstanceOf(Date);
    expect(recorded.executed_resolved_at).toBeInstanceOf(Date);
    expect(recorded.executed_producer_deadline_at.toISOString()).toBe(fixture.producerDeadlineAt);

    const replay = await execute();
    expect(replay).toEqual(recorded);
    const preparedReplay = await prepare(fixture);
    expect(preparedReplay).toMatchObject({
      intent_state: 'RECORDED',
      prepared_record_intent_fingerprint_sha256: prepared.prepared_record_intent_fingerprint_sha256,
      prepared_evidence_fingerprint_sha256: prepared.prepared_evidence_fingerprint_sha256,
      prepared_deadline_binding_sha256: recorded.executed_deadline_binding_sha256,
      prepared_evidence_recorded_at: recorded.executed_evidence_recorded_at,
      prepared_resolved_at: recorded.executed_resolved_at,
    });
    await expect(
      operationPool.query<{ evidence_count: string; deadline_count: string }>(
        `SELECT
           (SELECT pg_catalog.count(*)::text
            FROM provider_position_chain_anchor_evidence
            WHERE evidence_fingerprint_sha256 = $1) AS evidence_count,
           (SELECT pg_catalog.count(*)::text
            FROM provider_position_chain_anchor_record_deadlines
            WHERE evidence_fingerprint_sha256 = $1) AS deadline_count`,
        [prepared.prepared_evidence_fingerprint_sha256],
      ),
    ).resolves.toMatchObject({
      rows: [{ evidence_count: '1', deadline_count: '1' }],
    });
  });

  it('leases an expired NEW intent and resolves it source-only as NOT_RECORDED', async () => {
    const fixture = await evidenceFixture(SOLANA, 1_000);
    const prepared = await prepare(fixture);
    await waitUntilDeadline(fixture.producerDeadlineAt);
    const leaseToken = randomBytes(32);
    const leased = requireRow(
      (
        await operationPool.query<LeasedIntentRow>(
          `SELECT *
           FROM lease_provider_chain_anchor_record_intent_reconciliation(
             $1::bytea, interval '5 seconds'
           )`,
          [leaseToken],
        )
      ).rows,
      'reconciliation lease',
    );
    expect(leased).toMatchObject({
      leased_record_intent_fingerprint_sha256: prepared.prepared_record_intent_fingerprint_sha256,
      leased_evidence_fingerprint_sha256: prepared.prepared_evidence_fingerprint_sha256,
      leased_intent_state: 'NEW',
      leased_reconciliation_attempt_count: '1',
    });
    expect(leased.leased_at.getTime()).toBeGreaterThanOrEqual(
      leased.leased_producer_deadline_at.getTime(),
    );
    expect(leased.lease_expires_at.getTime()).toBeGreaterThan(leased.leased_at.getTime());

    const reconciled = requireRow(
      (
        await operationPool.query<ReconciledIntentRow>(
          `SELECT * FROM reconcile_provider_position_chain_anchor_record_intent(
             $1::text, $2::bytea
           )`,
          [prepared.prepared_record_intent_fingerprint_sha256, leaseToken],
        )
      ).rows,
      'record intent reconciliation',
    );
    expect(reconciled).toMatchObject({
      intent_state: 'NOT_RECORDED',
      reconciled_record_intent_fingerprint_sha256:
        prepared.prepared_record_intent_fingerprint_sha256,
      reconciled_evidence_fingerprint_sha256: prepared.prepared_evidence_fingerprint_sha256,
      reconciled_read_binding_fingerprint_sha256: prepared.prepared_read_binding_fingerprint_sha256,
      reconciled_deadline_binding_sha256: null,
      reconciled_evidence_recorded_at: null,
    });
    expect(reconciled.reconciled_resolved_at).toBeInstanceOf(Date);
    expect(reconciled.reconciled_resolved_at?.getTime()).toBeGreaterThanOrEqual(
      reconciled.reconciled_producer_deadline_at.getTime(),
    );
    await expect(
      operationPool.query<{ evidence_count: string }>(
        `SELECT pg_catalog.count(*)::text AS evidence_count
         FROM provider_position_chain_anchor_evidence
         WHERE evidence_fingerprint_sha256 = $1`,
        [prepared.prepared_evidence_fingerprint_sha256],
      ),
    ).resolves.toMatchObject({ rows: [{ evidence_count: '0' }] });
  });

  it('rejects zero dispatch tokens and a different token after the one-shot claim', async () => {
    const fixture = await evidenceFixture(ETHEREUM);
    const prepared = await prepare(fixture);
    const intentFingerprint = prepared.prepared_record_intent_fingerprint_sha256;
    const dispatchToken = randomBytes(32);

    await expect(
      operationPool.query(
        `SELECT * FROM claim_provider_position_chain_anchor_record_dispatch(
           $1::text, $2::bytea
         )`,
        [intentFingerprint, Buffer.alloc(32)],
      ),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      operationPool.query(
        `SELECT * FROM claim_provider_position_chain_anchor_record_dispatch(
           $1::text, $2::bytea
         )`,
        [intentFingerprint, dispatchToken],
      ),
    ).resolves.toMatchObject({ rows: [{ intent_state: 'RECORD_DISPATCHED' }] });
    await expect(
      operationPool.query(
        `SELECT * FROM claim_provider_position_chain_anchor_record_dispatch(
           $1::text, $2::bytea
         )`,
        [intentFingerprint, dispatchToken],
      ),
    ).resolves.toMatchObject({ rows: [{ intent_state: 'RECORD_DISPATCHED' }] });
    await expect(
      operationPool.query(
        `SELECT * FROM claim_provider_position_chain_anchor_record_dispatch(
           $1::text, $2::bytea
         )`,
        [intentFingerprint, randomBytes(32)],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      operationPool.query(
        `SELECT * FROM execute_provider_position_chain_anchor_record_intent(
           $1::text, $2::bytea
         )`,
        [intentFingerprint, Buffer.alloc(32)],
      ),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('defers the terminal-intent gate and blocks a direct migration-0030 record at commit', async () => {
    const fixture = await evidenceFixture(SOLANA);
    const prepared = await prepare(fixture);
    const client: PoolClient = await operationPool.connect();
    try {
      await client.query('BEGIN');
      const direct = requireRow(
        (
          await client.query<DirectRecordRow>(DIRECT_RECORD_SQL, [
            ...fixture.values,
            fixture.producerDeadlineAt,
            'RECORD',
          ])
        ).rows,
        'direct guarded record',
      );
      expect(direct).toMatchObject({
        record_outcome: 'RECORDED',
        recorded_evidence_fingerprint_sha256: prepared.prepared_evidence_fingerprint_sha256,
      });
      expect(direct.evidence_recorded_at).toBeInstanceOf(Date);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    await expect(
      operationPool.query<{
        evidence_count: string;
        deadline_count: string;
        intent_state: string;
      }>(
        `SELECT
           (SELECT pg_catalog.count(*)::text
            FROM provider_position_chain_anchor_evidence
            WHERE evidence_fingerprint_sha256 = $1) AS evidence_count,
           (SELECT pg_catalog.count(*)::text
            FROM provider_position_chain_anchor_record_deadlines
            WHERE evidence_fingerprint_sha256 = $1) AS deadline_count,
           (SELECT record_state
            FROM provider_position_chain_anchor_record_intents
            WHERE record_intent_fingerprint_sha256 = $2) AS intent_state`,
        [
          prepared.prepared_evidence_fingerprint_sha256,
          prepared.prepared_record_intent_fingerprint_sha256,
        ],
      ),
    ).resolves.toMatchObject({
      rows: [{ evidence_count: '0', deadline_count: '0', intent_state: 'NEW' }],
    });
  });
});
