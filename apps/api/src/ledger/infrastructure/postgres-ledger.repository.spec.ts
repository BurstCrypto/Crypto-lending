import type { QueryResult, QueryResultRow } from 'pg';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  normalizePostLedgerJournalCommand,
  normalizeReverseLedgerJournalCommand,
  type PostLedgerJournalCommand,
  type ReverseLedgerJournalCommand,
} from '../domain/ledger';
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
  approval: '00000000-0000-4000-8000-00000000000c',
} as const;

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
    actorAccountId: ids.actor,
    journalId: ids.journal,
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
    actorAccountId: ids.actor,
    reversalJournalId: ids.reversalJournal,
    correlationId: ids.correlation,
    originalJournalId: ids.originalJournal,
    reason: 'RECOGNITION_INVALIDATED',
    approvalReference: ids.approval,
    effectiveAt: '2026-08-21T12:01:00.000Z',
    observedAt: '2026-08-21T12:01:01.000Z',
  });
}

function setup(): { query: jest.Mock; repository: PostgresLedgerRepository } {
  const query = jest.fn();
  const postgres = { query } as unknown as PostgresService;
  return { query, repository: new PostgresLedgerRepository(postgres) };
}

describe('PostgresLedgerRepository', () => {
  it('posts only through the fixed schema-qualified function with explicit casts', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([{ journal_id: ids.journal }]));

    await expect(repository.postJournal(postCommand())).resolves.toBe(ids.journal);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('public.post_ledger_journal(');
    expect(sql).toContain('$1::uuid');
    expect(sql).toContain('$6::text');
    expect(sql).toContain('$7::timestamptz');
    expect(sql).toContain('$10::uuid');
    expect(sql).toContain('$11::text');
    expect(sql).not.toContain('::jsonb');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
    expect(sql).not.toContain(ids.journal);
    expect(values.slice(0, 10)).toEqual([
      ids.actor,
      ids.journal,
      ids.book,
      ids.transaction,
      ids.leg,
      'SETTLEMENT',
      '2026-08-21T12:00:00.000Z',
      '2026-08-21T12:00:01.000Z',
      'CHAIN_FINALITY_CONFIRMED',
      ids.correlation,
    ]);
    expect(values[10]).toBe(
      `[{"accountId":"${ids.debitAccount}","assetRevisionId":"${ids.asset}","side":"DEBIT","amountAtomic":"9007199254740993"},{"accountId":"${ids.creditAccount}","assetRevisionId":"${ids.asset}","side":"CREDIT","amountAtomic":"9007199254740993"}]`,
    );
  });

  it('emits exact canonical bytes even when built-in prototypes have hostile toJSON hooks', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([{ journal_id: ids.journal }]));
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

      await repository.postJournal(postCommand());
    } finally {
      if (objectDescriptor) {
        Object.defineProperty(Object.prototype, 'toJSON', objectDescriptor);
      } else {
        delete (Object.prototype as { toJSON?: unknown }).toJSON;
      }
      if (arrayDescriptor) {
        Object.defineProperty(Array.prototype, 'toJSON', arrayDescriptor);
      } else {
        delete (Array.prototype as { toJSON?: unknown }).toJSON;
      }
    }

    const values = query.mock.calls[0]?.[1] as unknown[];
    expect(values[10]).toBe(
      `[{"accountId":"${ids.debitAccount}","assetRevisionId":"${ids.asset}","side":"DEBIT","amountAtomic":"9007199254740993"},{"accountId":"${ids.creditAccount}","assetRevisionId":"${ids.asset}","side":"CREDIT","amountAtomic":"9007199254740993"}]`,
    );
    expect(objectToJson).not.toHaveBeenCalled();
    expect(arrayToJson).not.toHaveBeenCalled();
  });

  it('projects only the four approved posting fields and preserves repeated line multiplicity', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([{ journal_id: ids.journal }]));
    const base = postCommand();
    const command = normalizePostLedgerJournalCommand({
      ...base,
      postings: [
        { ...base.postings[0], amountAtomic: '4' },
        { ...base.postings[0], amountAtomic: '6' },
        { ...base.postings[1], amountAtomic: '10' },
      ],
    });

    await repository.postJournal(command);

    const values = query.mock.calls[0]?.[1] as unknown[];
    expect(JSON.parse(values[10] as string)).toEqual([
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

  it('creates an exact reversal only through the fixed reversal function', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([{ journal_id: ids.reversalJournal }]));

    await expect(repository.reverseJournal(reversalCommand())).resolves.toBe(ids.reversalJournal);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('public.reverse_ledger_journal(');
    expect(sql).toContain('$1::uuid');
    expect(sql).toContain('$4::text');
    expect(sql).toContain('$5::text');
    expect(sql).toContain('$6::timestamptz');
    expect(sql).toContain('$8::uuid');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
    expect(values).toEqual([
      ids.actor,
      ids.reversalJournal,
      ids.originalJournal,
      'RECOGNITION_INVALIDATED',
      ids.approval,
      '2026-08-21T12:01:00.000Z',
      '2026-08-21T12:01:01.000Z',
      ids.correlation,
    ]);
  });

  it.each([
    { rows: [] },
    { rows: [{ journal_id: ids.journal }, { journal_id: ids.journal }] },
    { rows: [{ journal_id: ids.reversalJournal }] },
    { rows: [{ journal_id: '00000000-0000-7000-8000-00000000000a' }] },
    { rows: [{ journal_id: ids.journal, extra: 'unsafe' }] },
  ])('fails closed on an unexpected post result row %#', async ({ rows }) => {
    const { query, repository } = setup();
    query.mockResolvedValue(result(rows));

    await expect(repository.postJournal(postCommand())).rejects.toEqual(
      new LedgerPersistenceError(),
    );
  });

  it('rejects accessor-bearing commands and rows without invoking the accessor', async () => {
    const { query, repository } = setup();
    const commandGetter = jest.fn(() => ids.actor);
    const unsafeCommand = { ...postCommand() } as Record<string, unknown>;
    Object.defineProperty(unsafeCommand, 'actorAccountId', {
      enumerable: true,
      get: commandGetter,
    });

    await expect(
      repository.postJournal(unsafeCommand as unknown as PostLedgerJournalCommand),
    ).rejects.toEqual(new LedgerPersistenceError());
    expect(commandGetter).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();

    const rowGetter = jest.fn(() => ids.journal);
    const row = {};
    Object.defineProperty(row, 'journal_id', { enumerable: true, get: rowGetter });
    query.mockResolvedValue(result([row]));
    await expect(repository.postJournal(postCommand())).rejects.toEqual(
      new LedgerPersistenceError(),
    );
    expect(rowGetter).not.toHaveBeenCalled();
  });

  it('does not propagate PostgreSQL messages, details, parameters, or causes', async () => {
    const { query, repository } = setup();
    query.mockRejectedValue(
      Object.assign(new Error('ledger canary secret-wallet-value'), {
        detail: 'amountAtomic=999999 and provider_token=secret',
        constraint: 'private_ledger_constraint',
        query: 'SELECT secret-wallet-value',
      }),
    );

    let thrown: unknown;
    try {
      await repository.postJournal(postCommand());
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
    expect(String(thrown)).not.toContain('secret-wallet-value');
    expect(String(thrown)).not.toContain('999999');
  });
});
