import type { PostgresService } from '../database/postgres.service';
import { PostgresJobQueueConsumer } from './postgres-job-queue-consumer.service';

const JOURNAL_ID = '35f22956-fba5-4e1e-8308-73ac62cc1872';

function queuedJob(attempts: number): Record<string, unknown> {
  return {
    id: 'a68f6c70-412d-42c0-adcc-9eb189f11df4',
    queue_name: 'jobs',
    payload: {
      id: 'a68f6c70-412d-42c0-adcc-9eb189f11df4',
      kind: 'ledger.journal-committed',
      version: 1,
      occurredAt: '2026-09-09T20:00:00.000Z',
      correlation: {
        correlationId: 'b68f6c70-412d-42c0-adcc-9eb189f11df4',
        ledgerEventId: JOURNAL_ID,
      },
      payload: { journalId: JOURNAL_ID, operation: 'POST_JOURNAL' },
    },
    message_attributes: {},
    ledger_command_id: 'c68f6c70-412d-42c0-adcc-9eb189f11df4',
    ledger_journal_id: JOURNAL_ID,
    attempts,
  };
}

function consumerFixture(attempts: number): {
  readonly consumer: PostgresJobQueueConsumer;
  readonly query: jest.Mock;
} {
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows: [queuedJob(attempts)], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  const postgres = {
    query,
    withTransaction: (work: () => Promise<unknown>) => work(),
  } as unknown as PostgresService;
  return { consumer: new PostgresJobQueueConsumer(postgres), query };
}

describe('PostgresJobQueueConsumer', () => {
  it('claims with SKIP LOCKED and retries a reviewed job without executing dormant handlers', async () => {
    const { consumer, query } = consumerFixture(1);

    await expect(consumer.processBatch()).resolves.toEqual({
      claimed: 1,
      failed: 0,
      retried: 1,
    });
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[1]?.[1]?.slice(2)).toEqual([
      'queued',
      1,
      'RAILWAY_JOB_HANDLER_DORMANT',
    ]);
  });

  it('counts every expired lease reclaim toward the five-attempt bound', async () => {
    const { consumer, query } = consumerFixture(2);

    await consumer.processBatch();

    const claimSql = query.mock.calls[0]?.[0] as string;
    expect(claimSql).toContain(
      "status = 'processing' AND locked_until <= clock_timestamp() AND attempts < $4",
    );
    expect(claimSql).not.toContain('attempts <= $4');
    expect(claimSql).toContain('attempts = queued.attempts + 1');
    expect(claimSql).not.toContain('attempts = CASE');
  });

  it('terminalizes a reviewed job after the bounded fifth attempt', async () => {
    const { consumer, query } = consumerFixture(5);

    await expect(consumer.processBatch()).resolves.toEqual({
      claimed: 1,
      failed: 1,
      retried: 0,
    });
    expect(query.mock.calls[1]?.[1]?.slice(2)).toEqual([
      'failed',
      0,
      'RAILWAY_JOB_HANDLER_DORMANT',
    ]);
  });

  it('deletes only terminal records older than the fixed retention window', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 3 });
    const consumer = new PostgresJobQueueConsumer({ query } as unknown as PostgresService);

    await expect(consumer.cleanupExpired()).resolves.toBe(3);
    expect(query.mock.calls[0]?.[0]).toContain("WHERE status = 'failed'");
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[0]?.[1]).toEqual([30]);
  });
});
