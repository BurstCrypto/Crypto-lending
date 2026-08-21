import {
  LedgerValidationError,
  MAX_ATOMIC_AMOUNT,
  MAX_LEDGER_POSTINGS,
  normalizePostLedgerJournalInput,
  normalizeReverseLedgerJournalInput,
  parseAtomicAmount,
  parseLedgerAccountId,
  parseLedgerAssetRevisionId,
  parseLedgerBookId,
  parseLedgerCorrelationId,
  parseLedgerJournalId,
  parseLedgerLegId,
  parseLedgerTransactionId,
} from './ledger';

const ids = {
  book: '00000000-0000-4000-8000-000000000001',
  transaction: '00000000-0000-4000-8000-000000000002',
  leg: '00000000-0000-4000-8000-000000000003',
  assetA: '00000000-0000-4000-8000-000000000004',
  assetB: '00000000-0000-4000-8000-000000000005',
  accountA: '00000000-0000-4000-8000-000000000006',
  accountB: '00000000-0000-4000-8000-000000000007',
  accountC: '00000000-0000-4000-8000-000000000008',
  accountD: '00000000-0000-4000-8000-000000000009',
  journal: '00000000-0000-4000-8000-00000000000a',
  correlation: '00000000-0000-4000-8000-00000000000b',
  approval: '00000000-0000-4000-8000-00000000000c',
} as const;

function postInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bookId: ids.book,
    transactionId: ids.transaction,
    legId: ids.leg,
    economicEventType: 'SETTLEMENT',
    effectiveAt: new Date('2026-08-21T12:00:00.000Z'),
    observedAt: new Date('2026-08-21T12:00:01.000Z'),
    reason: 'CHAIN_FINALITY_CONFIRMED',
    postings: [
      {
        accountId: ids.accountA,
        assetRevisionId: ids.assetA,
        side: 'DEBIT',
        amountAtomic: '10000000',
      },
      {
        accountId: ids.accountB,
        assetRevisionId: ids.assetA,
        side: 'CREDIT',
        amountAtomic: '10000000',
      },
    ],
    ...overrides,
  };
}

function reversalInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    originalJournalId: ids.journal,
    reason: 'RECOGNITION_INVALIDATED',
    approvalReference: ids.approval,
    effectiveAt: new Date('2026-08-21T12:01:00.000Z'),
    observedAt: new Date('2026-08-21T12:01:01.000Z'),
    ...overrides,
  };
}

function validPostings(): unknown[] {
  const value = postInput().postings;
  if (!Array.isArray(value)) throw new Error('Expected fixture postings');
  return value;
}

describe('ledger domain', () => {
  it('accepts canonical UUIDv4 identities and rejects all other UUID forms', () => {
    expect(parseLedgerBookId(ids.book)).toBe(ids.book);
    expect(parseLedgerAssetRevisionId(ids.assetA)).toBe(ids.assetA);
    expect(parseLedgerAccountId(ids.accountA)).toBe(ids.accountA);
    expect(parseLedgerTransactionId(ids.transaction)).toBe(ids.transaction);
    expect(parseLedgerLegId(ids.leg)).toBe(ids.leg);
    expect(parseLedgerJournalId(ids.journal)).toBe(ids.journal);
    expect(parseLedgerCorrelationId(ids.correlation)).toBe(ids.correlation);

    for (const value of [
      undefined,
      null,
      '',
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-7000-8000-000000000001',
      '00000000-0000-4000-7000-000000000001',
      '00000000-0000-4000-8000-00000000000A',
      ` ${ids.book}`,
    ]) {
      expect(() => parseLedgerBookId(value)).toThrow(
        new LedgerValidationError('INVALID_LEDGER_ID'),
      );
    }
  });

  it('keeps positive atomic quantities as canonical bounded strings', () => {
    expect(parseAtomicAmount('1')).toBe('1');
    expect(parseAtomicAmount(MAX_ATOMIC_AMOUNT)).toBe(MAX_ATOMIC_AMOUNT);

    for (const value of [
      undefined,
      null,
      1,
      1n,
      '',
      '0',
      '-1',
      '+1',
      '01',
      '1.0',
      '1e6',
      ' 1',
      `${MAX_ATOMIC_AMOUNT}0`,
      '9'.repeat(78),
    ]) {
      expect(() => parseAtomicAmount(value)).toThrow(
        new LedgerValidationError('INVALID_ATOMIC_AMOUNT'),
      );
    }
  });

  it('normalizes and freezes one independently balanced asset journal', () => {
    const normalized = normalizePostLedgerJournalInput(postInput());

    expect(normalized).toEqual({
      ...postInput(),
      effectiveAt: '2026-08-21T12:00:00.000Z',
      observedAt: '2026-08-21T12:00:01.000Z',
    });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.postings)).toBe(true);
    expect(normalized.postings.every(Object.isFrozen)).toBe(true);
    expect(typeof normalized.postings[0]?.amountAtomic).toBe('string');
  });

  it('balances every asset revision independently without converting through number', () => {
    const normalized = normalizePostLedgerJournalInput(
      postInput({
        postings: [
          {
            accountId: ids.accountA,
            assetRevisionId: ids.assetA,
            side: 'DEBIT',
            amountAtomic: MAX_ATOMIC_AMOUNT,
          },
          {
            accountId: ids.accountB,
            assetRevisionId: ids.assetA,
            side: 'CREDIT',
            amountAtomic: MAX_ATOMIC_AMOUNT,
          },
          {
            accountId: ids.accountC,
            assetRevisionId: ids.assetB,
            side: 'DEBIT',
            amountAtomic: '9007199254740993',
          },
          {
            accountId: ids.accountD,
            assetRevisionId: ids.assetB,
            side: 'CREDIT',
            amountAtomic: '9007199254740993',
          },
        ],
      }),
    );

    expect(normalized.postings).toHaveLength(4);
    expect(normalized.postings[2]?.amountAtomic).toBe('9007199254740993');
  });

  it('rejects cross-asset netting even when the overall debit and credit totals match', () => {
    expect(() =>
      normalizePostLedgerJournalInput(
        postInput({
          postings: [
            {
              accountId: ids.accountA,
              assetRevisionId: ids.assetA,
              side: 'DEBIT',
              amountAtomic: '10',
            },
            {
              accountId: ids.accountB,
              assetRevisionId: ids.assetB,
              side: 'CREDIT',
              amountAtomic: '10',
            },
          ],
        }),
      ),
    ).toThrow(new LedgerValidationError('UNBALANCED_LEDGER_JOURNAL'));
  });

  it('rejects an empty, single-line, or over-large journal', () => {
    for (const postings of [
      [],
      [validPostings()],
      Array.from({ length: MAX_LEDGER_POSTINGS + 1 }, () => ({
        accountId: ids.accountA,
        assetRevisionId: ids.assetA,
        side: 'DEBIT',
        amountAtomic: '1',
      })),
    ]) {
      expect(() => normalizePostLedgerJournalInput(postInput({ postings }))).toThrow(
        new LedgerValidationError('INVALID_LEDGER_JOURNAL'),
      );
    }
  });

  it('preserves repeated same-account line multiplicity while requiring two distinct accounts', () => {
    const normalized = normalizePostLedgerJournalInput(
      postInput({
        postings: [
          {
            accountId: ids.accountA,
            assetRevisionId: ids.assetA,
            side: 'DEBIT',
            amountAtomic: '4',
          },
          {
            accountId: ids.accountA,
            assetRevisionId: ids.assetA,
            side: 'DEBIT',
            amountAtomic: '6',
          },
          {
            accountId: ids.accountB,
            assetRevisionId: ids.assetA,
            side: 'CREDIT',
            amountAtomic: '10',
          },
        ],
      }),
    );
    expect(normalized.postings.map(({ amountAtomic }) => amountAtomic)).toEqual(['4', '6', '10']);

    expect(() =>
      normalizePostLedgerJournalInput(
        postInput({
          postings: [
            {
              accountId: ids.accountA,
              assetRevisionId: ids.assetA,
              side: 'DEBIT',
              amountAtomic: '1',
            },
            {
              accountId: ids.accountA,
              assetRevisionId: ids.assetA,
              side: 'CREDIT',
              amountAtomic: '1',
            },
          ],
        }),
      ),
    ).toThrow(new LedgerValidationError('UNBALANCED_LEDGER_JOURNAL'));
  });

  it('rejects malformed posting sides, shapes, and atomic quantities', () => {
    for (const posting of [
      {
        accountId: ids.accountA,
        assetRevisionId: ids.assetA,
        side: 'debit',
        amountAtomic: '1',
      },
      {
        accountId: ids.accountA,
        assetRevisionId: ids.assetA,
        side: 'DEBIT',
        amountAtomic: 1,
      },
      {
        accountId: ids.accountA,
        assetRevisionId: ids.assetA,
        side: 'DEBIT',
        amountAtomic: '1',
        memo: 'not permitted',
      },
    ]) {
      expect(() =>
        normalizePostLedgerJournalInput(postInput({ postings: [posting, validPostings()[1]] })),
      ).toThrow(LedgerValidationError);
    }
  });

  it('rejects getters, custom prototypes, sparse arrays, symbols, and extra keys without invoking them', () => {
    const getter = jest.fn(() => ids.accountA);
    const accessorPosting = {
      assetRevisionId: ids.assetA,
      side: 'DEBIT',
      amountAtomic: '1',
    };
    Object.defineProperty(accessorPosting, 'accountId', { enumerable: true, get: getter });
    expect(() =>
      normalizePostLedgerJournalInput(
        postInput({ postings: [accessorPosting, validPostings()[1]] }),
      ),
    ).toThrow(new LedgerValidationError('INVALID_LEDGER_POSTING'));
    expect(getter).not.toHaveBeenCalled();

    const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(customPrototype, validPostings()[0]);
    expect(() =>
      normalizePostLedgerJournalInput(
        postInput({ postings: [customPrototype, validPostings()[1]] }),
      ),
    ).toThrow(new LedgerValidationError('INVALID_LEDGER_POSTING'));

    const sparse = new Array(2) as unknown[];
    sparse[1] = validPostings()[1];
    expect(() => normalizePostLedgerJournalInput(postInput({ postings: sparse }))).toThrow(
      new LedgerValidationError('INVALID_LEDGER_JOURNAL'),
    );

    const symbolPostings = [...validPostings()];
    Object.defineProperty(symbolPostings, Symbol('unsafe'), { value: true });
    expect(() => normalizePostLedgerJournalInput(postInput({ postings: symbolPostings }))).toThrow(
      new LedgerValidationError('INVALID_LEDGER_JOURNAL'),
    );

    expect(() => normalizePostLedgerJournalInput({ ...postInput(), unexpected: true })).toThrow(
      new LedgerValidationError('INVALID_LEDGER_JOURNAL'),
    );
  });

  it('maps hostile proxy trap failures to a fixed validation error without inspecting the thrown value', () => {
    const thrownProxy = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('must not inspect hostile thrown proxy');
        },
      },
    );
    const inputProxy = new Proxy(postInput(), {
      ownKeys: () => {
        throw thrownProxy;
      },
    });

    expect(() => normalizePostLedgerJournalInput(inputProxy)).toThrow(
      new LedgerValidationError('INVALID_LEDGER_JOURNAL'),
    );
  });

  it('accepts only closed event and matching safe reason codes', () => {
    for (const [economicEventType, reason] of [
      ['SETTLEMENT', 'PROVIDER_SETTLEMENT_VERIFIED'],
      ['ACTUAL_FEE', 'ACTUAL_FEE_CONFIRMED'],
      ['ADJUSTMENT', 'ACCOUNTING_ADJUSTMENT_APPROVED'],
      ['COMPENSATION', 'COMPENSATION_SETTLED'],
    ]) {
      expect(
        normalizePostLedgerJournalInput(postInput({ economicEventType, reason })),
      ).toMatchObject({ economicEventType, reason });
    }

    for (const economicEventType of [
      'REVERSAL',
      'settlement',
      '',
      'OPENING_BALANCE',
      'SETTLEMENT ',
    ]) {
      expect(() => normalizePostLedgerJournalInput(postInput({ economicEventType }))).toThrow(
        new LedgerValidationError('INVALID_ECONOMIC_EVENT_TYPE'),
      );
    }
    for (const reason of [
      '',
      'Observed finalized settlement',
      'ACTUAL_FEE_CONFIRMED',
      'CHAIN_FINALITY_CONFIRMED ',
    ]) {
      expect(() => normalizePostLedgerJournalInput(postInput({ reason }))).toThrow(
        new LedgerValidationError('INVALID_REASON'),
      );
    }
  });

  it('rejects invalid timestamps or evidence observed before the effective fact', () => {
    for (const effectiveAt of [
      '2026-08-21T12:00:00.000Z',
      new Date(Number.NaN),
      Object.create(Date.prototype),
    ]) {
      expect(() => normalizePostLedgerJournalInput(postInput({ effectiveAt }))).toThrow(
        new LedgerValidationError('INVALID_LEDGER_TIMESTAMP'),
      );
    }
    expect(() =>
      normalizePostLedgerJournalInput(
        postInput({
          effectiveAt: new Date('2026-08-21T12:00:01.000Z'),
          observedAt: new Date('2026-08-21T12:00:00.000Z'),
        }),
      ),
    ).toThrow(new LedgerValidationError('INVALID_LEDGER_TIMESTAMP'));
  });

  it('normalizes an exact reversal request without accepting replacement postings', () => {
    expect(normalizeReverseLedgerJournalInput(reversalInput())).toEqual({
      originalJournalId: ids.journal,
      reason: 'RECOGNITION_INVALIDATED',
      approvalReference: ids.approval,
      effectiveAt: '2026-08-21T12:01:00.000Z',
      observedAt: '2026-08-21T12:01:01.000Z',
    });
    expect(() => normalizeReverseLedgerJournalInput({ ...reversalInput(), postings: [] })).toThrow(
      new LedgerValidationError('INVALID_LEDGER_JOURNAL'),
    );
  });

  it('rejects malformed reversal approval evidence and timestamp ordering', () => {
    for (const approvalReference of [
      '',
      'approval:KAN-41/reversal-1',
      '00000000-0000-7000-8000-00000000000c',
      ids.approval.toUpperCase(),
    ]) {
      expect(() =>
        normalizeReverseLedgerJournalInput(reversalInput({ approvalReference })),
      ).toThrow(new LedgerValidationError('INVALID_APPROVAL_REFERENCE'));
    }
    expect(() =>
      normalizeReverseLedgerJournalInput(
        reversalInput({
          effectiveAt: new Date('2026-08-21T12:01:02.000Z'),
          observedAt: new Date('2026-08-21T12:01:01.000Z'),
        }),
      ),
    ).toThrow(new LedgerValidationError('INVALID_LEDGER_TIMESTAMP'));
  });
});
