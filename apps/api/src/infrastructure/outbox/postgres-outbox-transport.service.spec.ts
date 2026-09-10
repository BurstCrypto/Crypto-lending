import type { PostgresService } from '../database/postgres.service';
import type { JobEnvelope } from './job-envelope';
import { PostgresOutboxTransport } from './postgres-outbox-transport.service';

const envelope: JobEnvelope = Object.freeze({
  id: '35f22956-fba5-4e1e-8308-73ac62cc1872',
  kind: 'portfolio.refresh.requested',
  version: 1,
  occurredAt: '2026-09-09T20:00:00.000Z',
  correlation: Object.freeze({ correlationId: 'b68f6c70-412d-42c0-adcc-9eb189f11df4' }),
  payload: Object.freeze({ accountId: '21b6e20c-86d8-41a7-aa69-8d39e1aef0b8' }),
});

describe('PostgresOutboxTransport', () => {
  it('publishes an immutable envelope with its ID as the transport idempotency key', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ matches: true }], rowCount: 1 });
    const transport = new PostgresOutboxTransport({ query } as unknown as PostgresService);

    await expect(
      transport.publish({ destination: 'jobs', envelope, messageAttributes: {} }),
    ).resolves.toEqual({ transportMessageId: envelope.id });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT (id) DO NOTHING');
    expect(query.mock.calls[0]?.[1]?.[0]).toBe(envelope.id);
  });

  it('fails closed when an existing ID has different immutable contents', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ matches: false }], rowCount: 1 });
    const transport = new PostgresOutboxTransport({ query } as unknown as PostgresService);

    await expect(
      transport.publish({ destination: 'jobs', envelope, messageAttributes: {} }),
    ).rejects.toThrow('PostgreSQL outbox idempotency conflict');
  });

  it('honors cancellation before database I/O and checks the durable queue for health', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ready: true }], rowCount: 1 });
    const transport = new PostgresOutboxTransport({ query } as unknown as PostgresService);
    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.publish(
        { destination: 'jobs', envelope, messageAttributes: {} },
        controller.signal,
      ),
    ).rejects.toThrow('aborted');
    expect(query).not.toHaveBeenCalled();

    await transport.healthCheck();
    expect(query).toHaveBeenCalledWith(
      "SELECT to_regclass('public.railway_job_queue') IS NOT NULL AS ready",
    );
  });

  it('fails health when the durable queue migration is absent', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ready: false }], rowCount: 1 });
    const transport = new PostgresOutboxTransport({ query } as unknown as PostgresService);

    await expect(transport.healthCheck()).rejects.toThrow('PostgreSQL queue is not ready');
  });
});
