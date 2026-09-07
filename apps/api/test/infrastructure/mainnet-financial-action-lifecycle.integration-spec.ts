import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import {
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
  type DatabaseMigration,
} from '../../src/infrastructure/database/migrations';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MIGRATIONS_THROUGH_0033 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id <= '0033',
);

interface HistoryCounts {
  intent_count: number;
  event_count: number;
  evidence_count: number;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Mainnet financial action integration requires loopback PostgreSQL');
  }
}

function requirePostgres16(serverVersionNum: number | undefined): void {
  if (
    serverVersionNum === undefined ||
    !Number.isInteger(serverVersionNum) ||
    serverVersionNum < 160_000 ||
    serverVersionNum >= 170_000
  ) {
    throw new Error('Mainnet financial action integration requires PostgreSQL 16');
  }
}

async function inRolledBackTransaction(
  pool: Pool,
  callback: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await callback(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

describeWithPostgres('mainnet financial action lifecycle PostgreSQL controls', () => {
  jest.setTimeout(180_000);

  const schema = `mainnet_action_${randomBytes(8).toString('hex')}`;
  const expectedMigrationIds = MIGRATIONS_THROUGH_0033.map(({ id }) => id);
  let adminPool: Pool | undefined;
  let operationPool: Pool | undefined;
  let runner: MigrationRunner | undefined;
  let schemaCreated = false;

  function requireOperationPool(): Pool {
    if (!operationPool) throw new Error('Mainnet financial action test pool is unavailable');
    return operationPool;
  }

  function requireRunner(): MigrationRunner {
    if (!runner) throw new Error('Mainnet financial action migration runner is unavailable');
    return runner;
  }

  function requireMigration0033(): DatabaseMigration {
    const migration = MIGRATIONS_THROUGH_0033.find(({ id }) => id === '0033');
    if (!migration?.verifySql) throw new Error('Migration 0033 verifier is missing');
    return migration;
  }

  async function historyCounts(): Promise<HistoryCounts[]> {
    const result = await requireOperationPool().query<HistoryCounts>(
      `SELECT
         (SELECT pg_catalog.count(*)::integer
          FROM mainnet_financial_action_intents) AS intent_count,
         (SELECT pg_catalog.count(*)::integer
          FROM mainnet_financial_action_events) AS event_count,
         (SELECT pg_catalog.count(*)::integer
          FROM mainnet_financial_action_evidence_claims) AS evidence_count`,
    );
    return result.rows;
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const server = await adminPool.query<{
      server_version_num: number;
    }>(
      `SELECT pg_catalog.current_setting('server_version_num')::integer
         AS server_version_num`,
    );
    requirePostgres16(server.rows[0]?.server_version_num);

    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    schemaCreated = true;
    operationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 2,
      options: `-c search_path=${schema}`,
    });
    runner = new MigrationRunner(operationPool, MIGRATIONS_THROUGH_0033);
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      try {
        if (schemaCreated) {
          await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
        }
      } finally {
        await adminPool.end();
      }
    }
  });

  it('applies the test migration chain through 0033 and verifies it as up to date', async () => {
    await expect(requireRunner().up()).resolves.toEqual(expectedMigrationIds);
    await expect(requireRunner().assertUpToDate()).resolves.toBeUndefined();
    await expect(
      requireOperationPool().query<{ valid: boolean }>(requireMigration0033().verifySql ?? ''),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
  });

  it('detects reconciliation-index and normalized-intent CHECK drift', async () => {
    const pool = requireOperationPool();
    const verifySql = requireMigration0033().verifySql ?? '';

    await inRolledBackTransaction(pool, async (client) => {
      await client.query('DROP INDEX mainnet_action_event_reconciliation_timeline');
      await client.query(
        `CREATE INDEX mainnet_action_event_reconciliation_timeline
           ON mainnet_financial_action_events (intent_id, revision ASC)
           WHERE reconciliation_outcome IS NOT NULL`,
      );
      await expect(client.query<{ valid: boolean }>(verifySql)).resolves.toMatchObject({
        rows: [{ valid: false }],
      });
    });

    await inRolledBackTransaction(pool, async (client) => {
      await client.query(
        `ALTER TABLE mainnet_financial_action_intents
           DROP CONSTRAINT mainnet_action_intent_normalized_shape_check`,
      );
      await client.query(
        `ALTER TABLE mainnet_financial_action_intents
           ADD CONSTRAINT mainnet_action_intent_normalized_shape_check CHECK (true)`,
      );
      await expect(client.query<{ valid: boolean }>(verifySql)).resolves.toMatchObject({
        rows: [{ valid: false }],
      });
    });

    await expect(pool.query<{ valid: boolean }>(verifySql)).resolves.toMatchObject({
      rows: [{ valid: true }],
    });
  });

  it('rejects a NULL reconciliation revision before writing lifecycle history', async () => {
    expect(await historyCounts()).toEqual([{ intent_count: 0, event_count: 0, evidence_count: 0 }]);

    await expect(
      requireOperationPool().query(
        `SELECT *
         FROM record_mainnet_financial_action_reconciliation_observation(
           $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::text,
           $7::text, $8::numeric, $9::text, $10::numeric, $11::text,
           $12::text, $13::text, $14::text, $15::timestamptz, $16::uuid
         )`,
        [
          randomUUID(),
          randomUUID(),
          null,
          'a'.repeat(64),
          randomUUID(),
          `0x${'b'.repeat(64)}`,
          'UNKNOWN',
          null,
          null,
          '1',
          `0x${'c'.repeat(64)}`,
          null,
          null,
          'd'.repeat(64),
          '2026-01-01T00:00:00.000Z',
          randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ code: '22023' });

    expect(await historyCounts()).toEqual([{ intent_count: 0, event_count: 0, evidence_count: 0 }]);
  });
});
