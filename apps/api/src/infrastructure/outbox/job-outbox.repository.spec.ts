import type { PostgresService } from '../database/postgres.service';
import { createDeterministicBalanceSyncJobEnvelope } from '../../blockchain-sync/domain/balance-sync';
import { createJobEnvelope } from './job-envelope';
import { JobOutboxRepository, type NewOutboxJob } from './job-outbox.repository';
import { TransactionalJobPublisher } from './transactional-job-publisher.service';

const ids = {
  correlation: '00000000-0000-4000-8000-000000000001',
  job: '00000000-0000-4000-8000-000000000002',
  command: '00000000-0000-4000-8000-000000000003',
  journal: '00000000-0000-4000-8000-000000000004',
  submission: '00000000-0000-4000-8000-000000000005',
  operation: '00000000-0000-4000-8000-000000000006',
  transaction: '00000000-0000-4000-8000-000000000007',
  plan: '00000000-0000-4000-8000-000000000008',
  quote: '00000000-0000-4000-8000-000000000009',
  account: '00000000-0000-4000-8000-000000000010',
  wallet: '00000000-0000-4000-8000-000000000011',
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
        correlation: { correlationId: ids.correlation, ledgerEventId: ids.journal },
      },
    ),
    messageAttributes: {},
  } as const;
}

function yieldJob(): NewOutboxJob {
  return {
    destination: 'jobs',
    envelope: createJobEnvelope(
      'yield.operation.submit',
      {
        submissionId: ids.submission,
        operationId: ids.operation,
        operationType: 'ALLOCATE',
        ledgerTransactionId: ids.transaction,
        planReferenceId: ids.plan,
        quoteReferenceId: ids.quote,
      },
      {
        id: ids.submission,
        occurredAt: '2026-08-21T20:00:00.000Z',
        correlation: {
          correlationId: ids.correlation,
          transactionId: ids.transaction,
          quoteId: ids.quote,
        },
      },
    ),
    messageAttributes: { operationType: 'ALLOCATE' },
  };
}

function balanceSyncJob(): NewOutboxJob {
  return {
    destination: 'jobs',
    envelope: createDeterministicBalanceSyncJobEnvelope(
      {
        schemaVersion: 1,
        accountId: ids.account,
        walletId: ids.wallet,
        networkId: 'eip155:1',
        requiredTier: 'PROVISIONAL',
        cause: 'SCHEDULED',
        attempt: 1,
        rescanFromPosition: null,
      },
      {
        id: ids.job,
        occurredAt: '2026-08-21T20:00:00.000Z',
        correlation: { correlationId: ids.correlation },
      },
    ),
    messageAttributes: {},
  };
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
      correlation: { correlationId: ids.correlation, ledgerEventId: ids.journal },
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

  it('rejects a ledger event that is not bound to its command and journal', async () => {
    const { repository, query } = setup();

    await expect(repository.insert(job())).rejects.toThrow('Invalid outbox job');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a structurally valid but unreviewed job before persistence', async () => {
    const { repository, query } = setup();

    await expect(
      repository.insert({
        destination: 'jobs',
        envelope: createJobEnvelope(
          'future.unreviewed',
          { harmless: true },
          {
            id: ids.job,
            occurredAt: '2026-08-21T20:00:00.000Z',
            correlation: { correlationId: ids.correlation },
          },
        ),
        messageAttributes: {},
      }),
    ).rejects.toThrow('Invalid outbox job: UNREVIEWED_JOB_CONTRACT');
    expect(query).not.toHaveBeenCalled();
  });

  it('persists an exact command and journal link', async () => {
    const { repository, query } = setup();

    await repository.insert({
      ...job(),
      ledgerLink: { commandId: ids.command, journalId: ids.journal },
    });

    const [statement, values] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain('SELECT enqueue_reviewed_job_v1(');
    expect(statement).not.toContain('INSERT INTO job_outbox');
    expect(values.slice(0, 2)).toEqual([ids.job, 'jobs']);
    expect(values.slice(-2)).toEqual([ids.command, ids.journal]);
  });

  it('persists the exact current yield and Ethereum balance-sync producer contracts', async () => {
    const { repository, query } = setup();

    await repository.insert(yieldJob());
    await repository.insert(balanceSyncJob());

    expect(query).toHaveBeenCalledTimes(2);
    const persistedEnvelopes = query.mock.calls.map(([, values]) =>
      JSON.parse((values as unknown[])[2] as string),
    ) as Array<{ kind: string; payload: { networkId?: string } }>;
    expect(persistedEnvelopes).toMatchObject([
      { kind: 'yield.operation.submit' },
      { kind: 'blockchain.balance-sync', payload: { networkId: 'eip155:1' } },
    ]);
  });

  it('binds persistence to the jobs destination and exact data-only root shape', async () => {
    const { repository, query } = setup();
    const destinationGetter = jest.fn(() => 'jobs');
    const accessorRoot = {
      envelope: job().envelope,
      messageAttributes: {},
      ledgerLink: { commandId: ids.command, journalId: ids.journal },
    } as Record<string, unknown>;
    Object.defineProperty(accessorRoot, 'destination', {
      enumerable: true,
      get: destinationGetter,
    });

    await expect(
      repository.insert({ ...job(), destination: 'alternate-queue' as never }),
    ).rejects.toThrow('Invalid outbox job: INVALID_REVIEWED_JOB_DESTINATION');
    await expect(repository.insert(accessorRoot as never)).rejects.toThrow('Invalid outbox job');
    expect(destinationGetter).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('validates the exact serialized payload instead of rereading a stateful source object', async () => {
    const { repository, query } = setup();
    const secret = 'private-key-stateful-proxy-canary';
    let ownKeyReads = 0;
    const payload = new Proxy(Object.create(null) as Record<string, unknown>, {
      ownKeys: () => {
        ownKeyReads += 1;
        return ownKeyReads === 1
          ? ['journalId', 'operation', 'privateKey']
          : ['journalId', 'operation'];
      },
      getOwnPropertyDescriptor: (_target, key) => ({
        configurable: true,
        enumerable: true,
        writable: true,
        value: key === 'journalId' ? ids.journal : key === 'operation' ? 'POST_JOURNAL' : secret,
      }),
      getPrototypeOf: () => null,
    });
    const candidate = {
      ...job(),
      envelope: createJobEnvelope('ledger.journal-committed', payload, {
        id: ids.job,
        occurredAt: '2026-08-21T20:00:00.000Z',
        correlation: { correlationId: ids.correlation, ledgerEventId: ids.journal },
      }),
      ledgerLink: { commandId: ids.command, journalId: ids.journal },
    };

    let rejection: unknown;
    try {
      await repository.insert(candidate);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(Error);
    expect(String(rejection)).toBe('Error: Invalid outbox job: INVALID_REVIEWED_JOB_PAYLOAD');
    expect(String(rejection)).not.toContain(secret);
    expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(ownKeyReads).toBe(1);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not leak database error details through the persistence boundary', async () => {
    const { repository, query } = setup();
    const databaseCanary = 'postgresql://user:secret@internal/outbox';
    query.mockRejectedValueOnce(new Error(databaseCanary));

    let rejection: unknown;
    try {
      await repository.insert({
        ...job(),
        ledgerLink: { commandId: ids.command, journalId: ids.journal },
      });
    } catch (error) {
      rejection = error;
    }
    expect(String(rejection)).toBe('Error: Outbox persistence failed');
    expect(String(rejection)).not.toContain(databaseCanary);
    expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
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
