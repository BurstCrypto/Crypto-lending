import type { QueryResult, QueryResultRow } from 'pg';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import { loggingContext } from '../../infrastructure/logging';
import type { JobPublisherPort } from '../../infrastructure/outbox/job-publisher.port';
import { createLedgerCapability } from '../application/ledger-capability-resolver.port';
import {
  createPostLedgerIdempotencyContext,
  createReverseLedgerIdempotencyContext,
  LedgerIdempotencyError,
  type LedgerIdempotencyContext,
} from '../domain/idempotency';
import {
  normalizePostLedgerJournalCommand,
  normalizeReverseLedgerJournalCommand,
  type PostLedgerJournalCommand,
  type ReverseLedgerJournalCommand,
} from '../domain/ledger';
import {
  LedgerLifecycleValidationError,
  normalizeLedgerLifecycleTransitionCommand,
  normalizeLedgerRecoveryTransitionCommand,
  type LedgerLifecycleTransitionCommand,
  type LedgerRecoveryTransitionCommand,
} from '../domain/transaction-lifecycle';
import { LedgerPersistenceError, PostgresLedgerRepository } from './postgres-ledger.repository';

const ids = {
  actor: '00000000-0000-4000-8000-000000000001',
  correlation: '00000000-0000-4000-8000-000000000002',
  book: '00000000-0000-4000-8000-000000000003',
  transaction: '00000000-0000-4000-8000-000000000004',
  leg: '00000000-0000-4000-8000-000000000005',
  asset: '00000000-0000-4000-8000-000000000006',
  debitAccount: '00000000-0000-4000-8000-000000000007',
  creditAccount: '00000000-0000-4000-8000-000000000008',
  originalJournal: '00000000-0000-4000-8000-000000000009',
  journal: '00000000-0000-4000-8000-00000000000a',
  reversalJournal: '00000000-0000-4000-8000-00000000000b',
  lifecycleEvent: '00000000-0000-4000-8000-00000000000c',
  command: '00000000-0000-4000-8000-00000000000d',
  outbox: '00000000-0000-4000-8000-00000000000e',
} as const;

const POST_CAPABILITY_VALUE = '00'.repeat(32);
const REVERSAL_CAPABILITY_VALUE = '11'.repeat(32);

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function postCommand(): PostLedgerJournalCommand {
  return normalizePostLedgerJournalCommand({
    correlationId: ids.correlation,
    bookId: ids.book,
    transactionId: ids.transaction,
    legId: ids.leg,
    economicEventType: 'SETTLEMENT',
    effectiveAt: '2026-08-21T12:00:00.000Z',
    observedAt: '2026-08-21T12:00:01.000Z',
    reason: 'CHAIN_FINALITY_CONFIRMED',
    postings: [
      {
        accountId: ids.debitAccount,
        assetRevisionId: ids.asset,
        side: 'DEBIT',
        amountAtomic: '9007199254740993',
      },
      {
        accountId: ids.creditAccount,
        assetRevisionId: ids.asset,
        side: 'CREDIT',
        amountAtomic: '9007199254740993',
      },
    ],
  });
}

function reversalCommand(): ReverseLedgerJournalCommand {
  return normalizeReverseLedgerJournalCommand({
    correlationId: ids.correlation,
    originalJournalId: ids.originalJournal,
    reason: 'RECOGNITION_INVALIDATED',
    effectiveAt: '2026-08-21T12:01:00.000Z',
    observedAt: '2026-08-21T12:01:01.000Z',
  });
}

function postIdempotency(): LedgerIdempotencyContext {
  return createPostLedgerIdempotencyContext('post-key', ids.actor, postCommand());
}

function reversalIdempotency(): LedgerIdempotencyContext {
  return createReverseLedgerIdempotencyContext('reverse-key', ids.actor, reversalCommand());
}

function lifecycleCommand(legId: string | null = ids.leg): LedgerLifecycleTransitionCommand {
  return normalizeLedgerLifecycleTransitionCommand({
    actorAccountId: ids.actor,
    correlationId: ids.correlation,
    transactionId: ids.transaction,
    legId,
    expectedState: 'SUBMITTED',
    nextState: 'PENDING',
    reason: 'OUTCOME_PENDING',
    effectiveAt: '2026-08-21T12:02:00.000Z',
  });
}

function recoveryCommand(): LedgerRecoveryTransitionCommand {
  return normalizeLedgerRecoveryTransitionCommand({
    actorAccountId: ids.actor,
    correlationId: ids.correlation,
    transactionId: ids.transaction,
    legId: null,
    expectedRecoveryState: 'NOT_REQUIRED',
    nextRecoveryState: 'REQUIRED',
    reason: 'RECOVERY_REQUIRED',
    effectiveAt: '2026-08-21T12:03:00.000Z',
  });
}

function setup(): {
  query: jest.Mock;
  withTransaction: jest.Mock;
  publisher: jest.Mocked<JobPublisherPort>;
  repository: PostgresLedgerRepository;
} {
  const query = jest.fn();
  const withTransaction = jest.fn(async (work: () => Promise<unknown>) => work());
  const postgres = { query, withTransaction } as unknown as PostgresService;
  const publisher = {
    enqueue: jest.fn(async (request: { id?: string }) => ({ id: request.id })),
  } as unknown as jest.Mocked<JobPublisherPort>;
  return {
    query,
    withTransaction,
    publisher,
    repository: new PostgresLedgerRepository(postgres, publisher),
  };
}

function mockClaimedWrite(query: jest.Mock, journalId: string): void {
  query
    .mockResolvedValueOnce(
      result([
        {
          command_id: ids.command,
          journal_id: null,
          outbox_id: ids.outbox,
          outcome: 'CLAIMED',
        },
      ]),
    )
    .mockResolvedValueOnce(result([{ journal_id: journalId }]))
    .mockResolvedValueOnce(result([{ journal_id: journalId }]));
}

describe('PostgresLedgerRepository', () => {
  it('resolves an absent or identical committed idempotency result through the fixed function', async () => {
    const { query, repository } = setup();
    const idempotency = postIdempotency();
    query
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ journal_id: ids.journal }]));

    await expect(repository.resolveIdempotency(idempotency)).resolves.toBeNull();
    await expect(repository.resolveIdempotency(idempotency)).resolves.toBe(ids.journal);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('public.resolve_ledger_command_idempotency(');
    expect(values).toEqual([
      ids.actor,
      'POST_JOURNAL',
      1,
      idempotency.keyDigest,
      1,
      idempotency.requestFingerprint,
    ]);
  });

  it('returns a concurrent replay from claim before revealing or consuming a capability', async () => {
    const { query, publisher, repository } = setup();
    query.mockResolvedValue(
      result([
        {
          command_id: ids.command,
          journal_id: ids.journal,
          outbox_id: ids.outbox,
          outcome: 'REPLAYED',
        },
      ]),
    );

    await expect(
      repository.postJournal(postCommand(), Object.freeze({}) as never, postIdempotency()),
    ).resolves.toBe(ids.journal);

    expect(query).toHaveBeenCalledTimes(1);
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it('maps an idempotency fingerprint mismatch to the fixed domain conflict', async () => {
    const { query, repository } = setup();
    query.mockRejectedValue(Object.assign(new Error('private mismatch detail'), { code: 'L4301' }));

    await expect(repository.resolveIdempotency(postIdempotency())).rejects.toEqual(
      new LedgerIdempotencyError('IDEMPOTENCY_CONFLICT'),
    );
  });

  it('posts only through the fixed function with a bound purpose-scoped capability', async () => {
    const { query, withTransaction, publisher, repository } = setup();
    mockClaimedWrite(query, ids.journal);
    const capability = createLedgerCapability('POST', POST_CAPABILITY_VALUE);
    const idempotency = postIdempotency();
    publisher.enqueue.mockImplementationOnce(async (request: { id?: string }) => {
      expect(loggingContext.current()).toEqual({
        correlationId: ids.correlation,
        initiatorActorId: ids.actor,
        ledgerEventId: ids.journal,
      });
      return { id: request.id } as never;
    });

    await expect(repository.postJournal(postCommand(), capability, idempotency)).resolves.toBe(
      ids.journal,
    );

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(3);
    const [claimSql, claimValues] = query.mock.calls[0] as [string, unknown[]];
    expect(claimSql).toContain('public.claim_ledger_command_idempotency(');
    expect(claimValues).toEqual([
      ids.actor,
      'POST_JOURNAL',
      1,
      idempotency.keyDigest,
      1,
      idempotency.requestFingerprint,
    ]);
    const [sql, values] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('public.post_ledger_journal_with_lifecycle(');
    expect(sql).toContain('$1::text');
    expect(sql).toContain('$2::uuid');
    expect(sql).toContain('$5::text');
    expect(sql).toContain('$6::timestamptz');
    expect(sql).toContain('$9::uuid');
    expect(sql).toContain('$10::text');
    expect(sql).not.toContain('::jsonb');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
    expect(sql).not.toContain(POST_CAPABILITY_VALUE);
    expect(values.slice(0, 9)).toEqual([
      POST_CAPABILITY_VALUE,
      ids.book,
      ids.transaction,
      ids.leg,
      'SETTLEMENT',
      '2026-08-21T12:00:00.000Z',
      '2026-08-21T12:00:01.000Z',
      'CHAIN_FINALITY_CONFIRMED',
      ids.correlation,
    ]);
    expect(values[9]).toBe(
      `[{"accountId":"${ids.debitAccount}","assetRevisionId":"${ids.asset}","side":"DEBIT","amountAtomic":"9007199254740993"},{"accountId":"${ids.creditAccount}","assetRevisionId":"${ids.asset}","side":"CREDIT","amountAtomic":"9007199254740993"}]`,
    );
    expect(publisher.enqueue).toHaveBeenCalledWith({
      id: ids.outbox,
      kind: 'ledger.journal-committed',
      version: 1,
      payload: { journalId: ids.journal, operation: 'POST_JOURNAL' },
      ledgerLink: { commandId: ids.command, journalId: ids.journal },
    });
    const [completeSql, completeValues] = query.mock.calls[2] as [string, unknown[]];
    expect(completeSql).toContain('public.complete_ledger_command_idempotency(');
    expect(completeValues).toEqual([ids.command, ids.journal, ids.outbox]);
    const queryOrder = query.mock.invocationCallOrder;
    const publishOrder = publisher.enqueue.mock.invocationCallOrder[0];
    expect(queryOrder[1]).toBeLessThan(publishOrder as number);
    expect(publishOrder).toBeLessThan(queryOrder[2] as number);
    expect(JSON.stringify(capability)).not.toContain(POST_CAPABILITY_VALUE);
    expect(JSON.stringify(publisher.enqueue.mock.calls)).not.toContain('post-key');
  });

  it('does not complete a claimed command when the transactional outbox enqueue fails', async () => {
    const { query, withTransaction, publisher, repository } = setup();
    query
      .mockResolvedValueOnce(
        result([
          {
            command_id: ids.command,
            journal_id: null,
            outbox_id: ids.outbox,
            outcome: 'CLAIMED',
          },
        ]),
      )
      .mockResolvedValueOnce(result([{ journal_id: ids.journal }]));
    publisher.enqueue.mockRejectedValue(new Error('outbox unavailable'));

    await expect(
      repository.postJournal(
        postCommand(),
        createLedgerCapability('POST', POST_CAPABILITY_VALUE),
        postIdempotency(),
      ),
    ).rejects.toEqual(new LedgerPersistenceError());

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(publisher.enqueue).toHaveBeenCalledTimes(1);
  });

  it('emits exact canonical posting bytes despite hostile prototype toJSON hooks', async () => {
    const { query, repository } = setup();
    mockClaimedWrite(query, ids.journal);
    const objectDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const arrayDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
    const objectToJson = jest.fn(() => ({ attacker: 'rewritten-object' }));
    const arrayToJson = jest.fn(() => [{ attacker: 'rewritten-array' }]);

    try {
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value: objectToJson,
      });
      Object.defineProperty(Array.prototype, 'toJSON', {
        configurable: true,
        value: arrayToJson,
      });
      await repository.postJournal(
        postCommand(),
        createLedgerCapability('POST', POST_CAPABILITY_VALUE),
        postIdempotency(),
      );
    } finally {
      if (objectDescriptor) Object.defineProperty(Object.prototype, 'toJSON', objectDescriptor);
      else delete (Object.prototype as { toJSON?: unknown }).toJSON;
      if (arrayDescriptor) Object.defineProperty(Array.prototype, 'toJSON', arrayDescriptor);
      else delete (Array.prototype as { toJSON?: unknown }).toJSON;
    }

    const values = query.mock.calls[1]?.[1] as unknown[];
    expect(values[9]).toBe(
      `[{"accountId":"${ids.debitAccount}","assetRevisionId":"${ids.asset}","side":"DEBIT","amountAtomic":"9007199254740993"},{"accountId":"${ids.creditAccount}","assetRevisionId":"${ids.asset}","side":"CREDIT","amountAtomic":"9007199254740993"}]`,
    );
    expect(objectToJson).not.toHaveBeenCalled();
    expect(arrayToJson).not.toHaveBeenCalled();
  });

  it('projects only approved fields and preserves repeated-line multiplicity', async () => {
    const { query, repository } = setup();
    mockClaimedWrite(query, ids.journal);
    const base = postCommand();
    const command = normalizePostLedgerJournalCommand({
      ...base,
      postings: [
        { ...base.postings[0], amountAtomic: '4' },
        { ...base.postings[0], amountAtomic: '6' },
        { ...base.postings[1], amountAtomic: '10' },
      ],
    });

    await repository.postJournal(
      command,
      createLedgerCapability('POST', POST_CAPABILITY_VALUE),
      createPostLedgerIdempotencyContext('post-key', ids.actor, command),
    );

    const values = query.mock.calls[1]?.[1] as unknown[];
    expect(JSON.parse(values[9] as string)).toEqual([
      {
        accountId: ids.debitAccount,
        assetRevisionId: ids.asset,
        side: 'DEBIT',
        amountAtomic: '4',
      },
      {
        accountId: ids.debitAccount,
        assetRevisionId: ids.asset,
        side: 'DEBIT',
        amountAtomic: '6',
      },
      {
        accountId: ids.creditAccount,
        assetRevisionId: ids.asset,
        side: 'CREDIT',
        amountAtomic: '10',
      },
    ]);
  });

  it('creates a reversal only through the separate capability domain and fixed function', async () => {
    const { query, repository } = setup();
    mockClaimedWrite(query, ids.reversalJournal);
    const capability = createLedgerCapability('REVERSE', REVERSAL_CAPABILITY_VALUE);

    await expect(
      repository.reverseJournal(reversalCommand(), capability, reversalIdempotency()),
    ).resolves.toBe(ids.reversalJournal);

    const [sql, values] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('public.reverse_ledger_journal_with_lifecycle(');
    expect(sql).toContain('$1::text');
    expect(sql).toContain('$2::uuid');
    expect(sql).toContain('$3::text');
    expect(sql).toContain('$4::timestamptz');
    expect(sql).toContain('$6::uuid');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
    expect(sql).not.toContain(REVERSAL_CAPABILITY_VALUE);
    expect(values).toEqual([
      REVERSAL_CAPABILITY_VALUE,
      ids.originalJournal,
      'RECOGNITION_INVALIDATED',
      '2026-08-21T12:01:00.000Z',
      '2026-08-21T12:01:01.000Z',
      ids.correlation,
    ]);
  });

  it.each([
    {
      command: lifecycleCommand(null),
      functionName: 'transition_ledger_transaction_state',
      values: [
        ids.actor,
        ids.transaction,
        'SUBMITTED',
        'PENDING',
        'OUTCOME_PENDING',
        '2026-08-21T12:02:00.000Z',
        ids.correlation,
      ],
    },
    {
      command: lifecycleCommand(),
      functionName: 'transition_ledger_leg_state',
      values: [
        ids.actor,
        ids.transaction,
        ids.leg,
        'SUBMITTED',
        'PENDING',
        'OUTCOME_PENDING',
        '2026-08-21T12:02:00.000Z',
        ids.correlation,
      ],
    },
  ])('records lifecycle through $functionName', async ({ command, functionName, values }) => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([{ event_id: ids.lifecycleEvent }]));

    await expect(repository.transitionLifecycle(command)).resolves.toBeUndefined();

    const [sql, boundValues] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(`public.${functionName}(`);
    expect(boundValues).toEqual(values);
  });

  it('records recovery independently through its fixed function', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([{ event_id: ids.lifecycleEvent }]));

    await expect(repository.transitionRecovery(recoveryCommand())).resolves.toBeUndefined();

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('public.transition_ledger_recovery_state(');
    expect(values).toEqual([
      ids.actor,
      ids.transaction,
      null,
      'NOT_REQUIRED',
      'REQUIRED',
      'RECOVERY_REQUIRED',
      '2026-08-21T12:03:00.000Z',
      ids.correlation,
    ]);
  });

  it('maps a rejected persisted transition to the lifecycle domain error', async () => {
    const { query, repository } = setup();
    query.mockRejectedValue(Object.assign(new Error('transition rejected'), { code: 'L4201' }));

    await expect(repository.transitionLifecycle(lifecycleCommand())).rejects.toEqual(
      new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION'),
    );
  });

  it('maps a rejected posting lifecycle transition to the lifecycle domain error', async () => {
    const { query, repository } = setup();
    query.mockRejectedValue(Object.assign(new Error('transition rejected'), { code: 'L4201' }));

    await expect(
      repository.postJournal(
        postCommand(),
        createLedgerCapability('POST', POST_CAPABILITY_VALUE),
        postIdempotency(),
      ),
    ).rejects.toEqual(new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION'));
  });

  it('maps a rejected reversal lifecycle transition to the lifecycle domain error', async () => {
    const { query, repository } = setup();
    query.mockRejectedValue(Object.assign(new Error('transition rejected'), { code: 'L4201' }));

    await expect(
      repository.reverseJournal(
        reversalCommand(),
        createLedgerCapability('REVERSE', REVERSAL_CAPABILITY_VALUE),
        reversalIdempotency(),
      ),
    ).rejects.toEqual(new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION'));
  });

  it('rejects an unexpected lifecycle result row', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([{ event_id: 'not-a-uuid' }]));

    await expect(repository.transitionLifecycle(lifecycleCommand())).rejects.toEqual(
      new LedgerPersistenceError(),
    );
  });

  it.each([
    { rows: [] },
    { rows: [{ journal_id: ids.journal }, { journal_id: ids.journal }] },
    { rows: [{ journal_id: '00000000-0000-7000-8000-00000000000a' }] },
    { rows: [{ journal_id: ids.journal, extra: 'unsafe' }] },
  ])('fails closed on an unexpected result row %#', async ({ rows }) => {
    const { query, repository } = setup();
    query
      .mockResolvedValueOnce(
        result([
          {
            command_id: ids.command,
            journal_id: null,
            outbox_id: ids.outbox,
            outcome: 'CLAIMED',
          },
        ]),
      )
      .mockResolvedValueOnce(result(rows));

    await expect(
      repository.postJournal(
        postCommand(),
        createLedgerCapability('POST', POST_CAPABILITY_VALUE),
        postIdempotency(),
      ),
    ).rejects.toEqual(new LedgerPersistenceError());
  });

  it('rejects accessors and forged or cross-purpose capabilities before querying', async () => {
    const { query, repository } = setup();
    const commandGetter = jest.fn(() => ids.book);
    const unsafeCommand = { ...postCommand() } as Record<string, unknown>;
    Object.defineProperty(unsafeCommand, 'bookId', {
      enumerable: true,
      get: commandGetter,
    });

    await expect(
      repository.postJournal(
        unsafeCommand as unknown as PostLedgerJournalCommand,
        createLedgerCapability('POST', POST_CAPABILITY_VALUE),
        postIdempotency(),
      ),
    ).rejects.toEqual(new LedgerPersistenceError());
    expect(commandGetter).not.toHaveBeenCalled();

    query.mockResolvedValueOnce(
      result([
        {
          command_id: ids.command,
          journal_id: null,
          outbox_id: ids.outbox,
          outcome: 'CLAIMED',
        },
      ]),
    );
    await expect(
      repository.postJournal(
        postCommand(),
        createLedgerCapability('REVERSE', REVERSAL_CAPABILITY_VALUE) as never,
        postIdempotency(),
      ),
    ).rejects.toEqual(new LedgerPersistenceError());
    query.mockResolvedValueOnce(
      result([
        {
          command_id: ids.command,
          journal_id: null,
          outbox_id: ids.outbox,
          outcome: 'CLAIMED',
        },
      ]),
    );
    await expect(
      repository.postJournal(postCommand(), Object.freeze({}) as never, postIdempotency()),
    ).rejects.toEqual(new LedgerPersistenceError());
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects accessor-bearing result rows without invoking them', async () => {
    const { query, repository } = setup();
    const rowGetter = jest.fn(() => ids.journal);
    const row = {};
    Object.defineProperty(row, 'journal_id', { enumerable: true, get: rowGetter });
    query.mockResolvedValue(result([row]));

    await expect(
      repository.postJournal(
        postCommand(),
        createLedgerCapability('POST', POST_CAPABILITY_VALUE),
        postIdempotency(),
      ),
    ).rejects.toEqual(new LedgerPersistenceError());
    expect(rowGetter).not.toHaveBeenCalled();
  });

  it('does not propagate PostgreSQL messages, parameters, details, or causes', async () => {
    const { query, repository } = setup();
    query.mockRejectedValue(
      Object.assign(new Error(`ledger raw capability ${POST_CAPABILITY_VALUE}`), {
        detail: 'amountAtomic=999999 and provider_token=secret',
        constraint: 'private_ledger_constraint',
        query: 'SELECT secret-wallet-value',
      }),
    );

    let thrown: unknown;
    try {
      await repository.postJournal(
        postCommand(),
        createLedgerCapability('POST', POST_CAPABILITY_VALUE),
        postIdempotency(),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new LedgerPersistenceError());
    expect(thrown).toMatchObject({
      code: 'LEDGER_PERSISTENCE_FAILED',
      message: 'Ledger persistence operation failed',
    });
    expect(thrown).not.toHaveProperty('cause');
    expect(thrown).not.toHaveProperty('detail');
    expect(thrown).not.toHaveProperty('constraint');
    expect(String(thrown)).not.toContain(POST_CAPABILITY_VALUE);
    expect(String(thrown)).not.toContain('999999');
  });
});
