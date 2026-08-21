import {
  createPostLedgerIdempotencyContext,
  createReverseLedgerIdempotencyContext,
  digestLedgerIdempotencyKey,
  LedgerIdempotencyError,
  MAX_LEDGER_IDEMPOTENCY_KEY_BYTES,
} from './idempotency';
import {
  normalizePostLedgerJournalInput,
  normalizeReverseLedgerJournalInput,
  type PostLedgerJournalInput,
  type ReverseLedgerJournalInput,
} from './ledger';

const IDS = Object.freeze({
  actor: '00000000-0000-4000-8000-000000000001',
  book: '00000000-0000-4000-8000-000000000002',
  transaction: '00000000-0000-4000-8000-000000000003',
  leg: '00000000-0000-4000-8000-000000000004',
  accountA: '00000000-0000-4000-8000-000000000005',
  accountB: '00000000-0000-4000-8000-000000000006',
  asset: '00000000-0000-4000-8000-000000000007',
  originalJournal: '00000000-0000-4000-8000-000000000008',
});

function postInput(): PostLedgerJournalInput {
  return {
    bookId: IDS.book,
    transactionId: IDS.transaction,
    legId: IDS.leg,
    economicEventType: 'SETTLEMENT',
    effectiveAt: new Date('2026-08-20T12:00:00.000Z'),
    observedAt: new Date('2026-08-20T12:01:00.000Z'),
    reason: 'CHAIN_FINALITY_CONFIRMED',
    postings: [
      {
        accountId: IDS.accountA,
        assetRevisionId: IDS.asset,
        side: 'DEBIT' as const,
        amountAtomic: '125',
      },
      {
        accountId: IDS.accountB,
        assetRevisionId: IDS.asset,
        side: 'CREDIT' as const,
        amountAtomic: '125',
      },
    ],
  };
}

function reversalInput(): ReverseLedgerJournalInput {
  return {
    originalJournalId: IDS.originalJournal,
    reason: 'RECOGNITION_INVALIDATED',
    effectiveAt: new Date('2026-08-21T12:00:00.000Z'),
    observedAt: new Date('2026-08-21T12:01:00.000Z'),
  };
}

describe('ledger command idempotency', () => {
  it('accepts a bounded opaque printable key and returns only a domain-separated digest', () => {
    const rawKey = 'customer-command-1';
    const digest = digestLedgerIdempotencyKey(rawKey);

    expect(digest).toBe('dc6b793dbf310caa97d29e934e4b278b6df0efe251a1f9d7cdac5f0090c25b47');
    expect(digest).not.toContain(rawKey);
    expect(digestLedgerIdempotencyKey(rawKey)).toBe(digest);
    expect(digestLedgerIdempotencyKey('customer-command-2')).not.toBe(digest);
  });

  it.each([
    undefined,
    null,
    '',
    ' leading',
    'trailing ',
    'line\nbreak',
    '\u00e9',
    'x'.repeat(MAX_LEDGER_IDEMPOTENCY_KEY_BYTES + 1),
  ])('rejects an invalid raw key without reflecting it in the error: %p', (rawKey) => {
    let captured: unknown;
    try {
      digestLedgerIdempotencyKey(rawKey);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(LedgerIdempotencyError);
    expect(captured).toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' });
    if (typeof rawKey === 'string' && rawKey.length > 0) {
      expect(String(captured)).not.toContain(rawKey);
    }
  });

  it('freezes a deterministic versioned POST context without retaining the raw key', () => {
    const context = createPostLedgerIdempotencyContext(
      'post-key',
      IDS.actor,
      normalizePostLedgerJournalInput(postInput()),
    );

    expect(context).toEqual({
      actorAccountId: IDS.actor,
      operation: 'POST_JOURNAL',
      contractVersion: 1,
      keyDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      fingerprintVersion: 1,
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(JSON.stringify(context)).not.toContain('post-key');
    expect(context.requestFingerprint).toBe(
      '1612b5e022f7083772e118b31073626e379d7feb476eddf0c7f8b3ccb5efd68e',
    );
  });

  it('fingerprints every normalized POST field, posting order, actor, and operation contract', () => {
    const base = postInput();
    const baseline = createPostLedgerIdempotencyContext(
      'same-key',
      IDS.actor,
      normalizePostLedgerJournalInput(base),
    ).requestFingerprint;
    const variants = [
      { ...base, bookId: '00000000-0000-4000-8000-000000000009' },
      { ...base, transactionId: '00000000-0000-4000-8000-000000000009' },
      { ...base, legId: '00000000-0000-4000-8000-000000000009' },
      { ...base, economicEventType: 'ACTUAL_FEE', reason: 'ACTUAL_FEE_CONFIRMED' },
      { ...base, effectiveAt: new Date('2026-08-20T11:59:59.000Z') },
      { ...base, observedAt: new Date('2026-08-20T12:01:01.000Z') },
      { ...base, reason: 'PROVIDER_SETTLEMENT_VERIFIED' },
      {
        ...base,
        postings: [
          {
            ...base.postings[0],
            accountId: '00000000-0000-4000-8000-000000000009',
          },
          base.postings[1],
        ],
      },
      {
        ...base,
        postings: base.postings.map((posting) => ({
          ...posting,
          assetRevisionId: '00000000-0000-4000-8000-000000000009',
        })),
      },
      {
        ...base,
        postings: base.postings.map((posting) => ({
          ...posting,
          side: posting.side === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const),
        })),
      },
      {
        ...base,
        postings: base.postings.map((posting) => ({ ...posting, amountAtomic: '126' })),
      },
      {
        ...base,
        postings: [
          { ...base.postings[0], amountAtomic: '50' },
          { ...base.postings[0], amountAtomic: '75' },
          base.postings[1],
        ],
      },
      { ...base, postings: [...base.postings].reverse() },
    ];

    for (const variant of variants) {
      expect(
        createPostLedgerIdempotencyContext(
          'same-key',
          IDS.actor,
          normalizePostLedgerJournalInput(variant),
        ).requestFingerprint,
      ).not.toBe(baseline);
    }
    expect(
      createPostLedgerIdempotencyContext(
        'same-key',
        '00000000-0000-4000-8000-000000000009',
        normalizePostLedgerJournalInput(base),
      ).requestFingerprint,
    ).not.toBe(baseline);
    expect(
      createReverseLedgerIdempotencyContext(
        'same-key',
        IDS.actor,
        normalizeReverseLedgerJournalInput(reversalInput()),
      ).requestFingerprint,
    ).not.toBe(baseline);
  });

  it('fingerprints every normalized REVERSE field and actor deterministically', () => {
    const base = reversalInput();
    const baseline = createReverseLedgerIdempotencyContext(
      'same-key',
      IDS.actor,
      normalizeReverseLedgerJournalInput(base),
    ).requestFingerprint;
    expect(baseline).toBe('4856be878b83ab00cc972bcbaf0774f4e605e0abaafcacf4c8711aabb9ff68eb');
    const variants = [
      { ...base, originalJournalId: '00000000-0000-4000-8000-000000000009' },
      { ...base, reason: 'SOURCE_EVIDENCE_CORRECTED' },
      { ...base, effectiveAt: new Date('2026-08-21T11:59:59.000Z') },
      { ...base, observedAt: new Date('2026-08-21T12:01:01.000Z') },
    ];

    for (const variant of variants) {
      expect(
        createReverseLedgerIdempotencyContext(
          'same-key',
          IDS.actor,
          normalizeReverseLedgerJournalInput(variant),
        ).requestFingerprint,
      ).not.toBe(baseline);
    }
    expect(
      createReverseLedgerIdempotencyContext(
        'same-key',
        '00000000-0000-4000-8000-000000000009',
        normalizeReverseLedgerJournalInput(base),
      ).requestFingerprint,
    ).not.toBe(baseline);
    expect(
      createReverseLedgerIdempotencyContext(
        'same-key',
        IDS.actor,
        normalizeReverseLedgerJournalInput(base),
      ).requestFingerprint,
    ).toBe(baseline);
  });
});
