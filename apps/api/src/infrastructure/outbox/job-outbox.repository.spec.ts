import type { PostgresService } from '../database/postgres.service';
import { createJobEnvelope } from './job-envelope';
import { JobOutboxRepository, type NewOutboxJob } from './job-outbox.repository';
import { TransactionalJobPublisher } from './transactional-job-publisher.service';

const ids = {
  correlation: '00000000-0000-4000-8000-000000000001',
  job: '00000000-0000-4000-8000-000000000002',
  command: '00000000-0000-4000-8000-000000000003',
  journal: '00000000-0000-4000-8000-000000000004',
} as const;

function setup(activeTransaction = true): {
  repository: JobOutboxRepository;
  query: jest.Mock;
} {
  const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  const postgres = {
    hasActiveTransaction: jest.fn(() => activeTransaction),
    query,
  } as unknown as PostgresService;
  return { repository: new JobOutboxRepository(postgres), query };
}

function job(): NewOutboxJob {
  return {
    destination: 'jobs',
    envelope: createJobEnvelope(
      'ledger.journal-committed',
      { journalId: ids.journal, operation: 'POST_JOURNAL' },
      {
        id: ids.job,
        occurredAt: '2026-08-21T20:00:00.000Z',
        correlation: { correlationId: ids.correlation },
      },
    ),
    messageAttributes: {},
  } as const;
}

describe('JobOutboxRepository ledger linkage', () => {
  it('forwards ledger linkage through the transactional publisher', async () => {
    const insert = jest.fn().mockResolvedValue(undefined);
    const publisher = new TransactionalJobPublisher({ insert } as unknown as JobOutboxRepository);

    await publisher.enqueue({
      id: ids.job,
      kind: 'ledger.journal-committed',
      occurredAt: '2026-08-21T20:00:00.000Z',
      payload: { journalId: ids.journal, operation: 'POST_JOURNAL' },
      correlation: { correlationId: ids.correlation },
      ledgerLink: { commandId: ids.command, journalId: ids.journal },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        ledgerLink: { commandId: ids.command, journalId: ids.journal },
      }),
    );
  });

  it('rejects an accessor-backed publisher link without invoking it', async () => {
    const insert = jest.fn().mockResolvedValue(undefined);
    const publisher = new TransactionalJobPublisher({ insert } as unknown as JobOutboxRepository);
    const linkGetter = jest.fn(() => ({ commandId: ids.command, journalId: ids.journal }));
    const request = {
      id: ids.job,
      kind: 'ledger.journal-committed',
      occurredAt: '2026-08-21T20:00:00.000Z',
      payload: { journalId: ids.journal, operation: 'POST_JOURNAL' },
      correlation: { correlationId: ids.correlation },
    };
    Object.defineProperty(request, 'ledgerLink', { enumerable: true, get: linkGetter });

    await expect(publisher.enqueue(request)).rejects.toThrow('Invalid ledger outbox link');
    expect(linkGetter).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('keeps generic outbox inserts unlinked', async () => {
    const { repository, query } = setup();

    await repository.insert(job());

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ledger_command_id, ledger_journal_id');
    expect(values.slice(-2)).toEqual([null, null]);
  });

  it('persists an exact command and journal link', async () => {
    const { repository, query } = setup();

    await repository.insert({
      ...job(),
      ledgerLink: { commandId: ids.command, journalId: ids.journal },
    });

    const [, values] = query.mock.calls[0] as [string, unknown[]];
    expect(values.slice(-2)).toEqual([ids.command, ids.journal]);
  });

  it('rejects malformed or accessor-backed links before querying', async () => {
    const { repository, query } = setup();

    await expect(
      repository.insert({ ...job(), ledgerLink: { commandId: 'invalid', journalId: ids.journal } }),
    ).rejects.toThrow('Invalid outbox job');

    const commandGetter = jest.fn(() => ids.command);
    const ledgerLink = { journalId: ids.journal } as Record<string, unknown>;
    Object.defineProperty(ledgerLink, 'commandId', { enumerable: true, get: commandGetter });
    await expect(repository.insert({ ...job(), ledgerLink: ledgerLink as never })).rejects.toThrow(
      'Invalid outbox job',
    );

    expect(commandGetter).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('still requires an active transaction', async () => {
    const { repository, query } = setup(false);

    await expect(repository.insert(job())).rejects.toThrow(
      'Outbox enqueue requires an active PostgreSQL transaction',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
