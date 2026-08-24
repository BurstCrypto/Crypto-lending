import {
  BALANCE_SYNC_JOB_KIND,
  BALANCE_SYNC_POLICY,
  BalanceSyncDomainError,
  BalanceSyncIndexerFailure,
  balanceSyncTierThreshold,
  createBalanceSyncObservationId,
  createBalanceSyncRetryEnvelope,
  createDeterministicBalanceSyncJobEnvelope,
  decideBalanceSyncFailureDisposition,
  normalizeBalanceSyncPosition,
  parseBalanceSyncJobEnvelope,
  type BalanceSyncJobPayload,
  type BalanceSyncPosition,
} from './balance-sync';

const ids = Object.freeze({
  job: 'balance-sync-fixture-1',
  account: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  wallet: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  correlation: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
});
const occurredAt = '2026-08-24T12:00:00.000Z';

function payload(overrides: Partial<BalanceSyncJobPayload> = {}): BalanceSyncJobPayload {
  return {
    schemaVersion: 1,
    accountId: ids.account,
    walletId: ids.wallet,
    networkId: 'eip155:1',
    requiredTier: 'PROVISIONAL',
    cause: 'SCHEDULED',
    attempt: 1,
    rescanFromPosition: null,
    ...overrides,
  };
}

function fixturePositions(): readonly BalanceSyncPosition[] {
  return Object.freeze([
    Object.freeze({
      positionId: 'a'.repeat(64),
      stablecoin: 'USDC',
      assetIdentity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amountAtomic: '12000000',
    }),
  ]);
}

describe('balance sync domain', () => {
  it('creates and parses a deterministic correlated SQS-envelope-shaped job', () => {
    const envelope = createDeterministicBalanceSyncJobEnvelope(payload(), {
      id: ids.job,
      occurredAt,
      correlation: { correlationId: ids.correlation },
    });

    expect(envelope).toEqual({
      id: ids.job,
      kind: BALANCE_SYNC_JOB_KIND,
      version: 1,
      occurredAt,
      correlation: { correlationId: ids.correlation },
      payload: payload(),
    });
    expect(parseBalanceSyncJobEnvelope(envelope)).toEqual(envelope);
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  it('derives the same bounded retry envelope from the same parent', () => {
    const parent = createDeterministicBalanceSyncJobEnvelope(payload(), {
      id: ids.job,
      occurredAt,
      correlation: { correlationId: ids.correlation },
    });
    const first = createBalanceSyncRetryEnvelope(parent, '2026-08-24T12:00:05.000Z');
    const replay = createBalanceSyncRetryEnvelope(parent, '2026-08-24T12:00:05.000Z');

    expect(first).toEqual(replay);
    expect(first.id).toMatch(/^balance-sync:[0-9a-f]{64}$/u);
    expect(first.payload).toMatchObject({ attempt: 2, cause: 'RETRY' });
    expect(first.correlation).toEqual(parent.correlation);
  });

  it.each([
    { overrides: { accountId: 'not-a-uuid' }, mutate: undefined },
    { overrides: { attempt: 2 }, mutate: undefined },
    { overrides: { cause: 'RETRY' as const }, mutate: undefined },
    { overrides: { rescanFromPosition: '99' }, mutate: undefined },
    {
      overrides: {},
      mutate: (value: Record<string, unknown>): void => {
        value.extra = true;
      },
    },
  ])('rejects malformed job input %#', ({ overrides, mutate }) => {
    const input = { ...payload(overrides) } as Record<string, unknown>;
    mutate?.(input);
    expect(() =>
      createDeterministicBalanceSyncJobEnvelope(input as never, {
        id: ids.job,
        occurredAt,
        correlation: { correlationId: ids.correlation },
      }),
    ).toThrow(new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB'));
  });

  it('uses the bounded three-attempt retry and DLQ policy', () => {
    expect(decideBalanceSyncFailureDisposition('PROVIDER_TIMEOUT', 1)).toEqual({
      action: 'RETRY',
      delaySeconds: 5,
      reason: 'TRANSIENT_FAILURE',
    });
    expect(decideBalanceSyncFailureDisposition('RATE_LIMITED', 2, 30)).toEqual({
      action: 'RETRY',
      delaySeconds: 30,
      reason: 'TRANSIENT_FAILURE',
    });
    expect(decideBalanceSyncFailureDisposition('PROVIDER_UNAVAILABLE', 3)).toEqual({
      action: 'DEAD_LETTER',
      delaySeconds: null,
      reason: 'ATTEMPTS_EXHAUSTED',
    });
    expect(decideBalanceSyncFailureDisposition('PROVIDER_INVALID_DATA', 1)).toEqual({
      action: 'DEAD_LETTER',
      delaySeconds: null,
      reason: 'NON_RETRYABLE_FAILURE',
    });
    expect(decideBalanceSyncFailureDisposition('RATE_LIMITED', 1, 61)).toEqual({
      action: 'DEAD_LETTER',
      delaySeconds: null,
      reason: 'RETRY_AFTER_EXCEEDS_BOUND',
    });
  });

  it('validates typed provider Retry-After hints', () => {
    expect(() => new BalanceSyncIndexerFailure('RATE_LIMITED', { retryAfterSeconds: -1 })).toThrow(
      TypeError,
    );
    expect(new BalanceSyncIndexerFailure('RATE_LIMITED', { retryAfterSeconds: 10 })).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 10,
    });
  });

  it.each([
    ['eip155:1', 'PROVISIONAL', 'latest', true],
    ['eip155:8453', 'CANONICAL', 'safe', false],
    ['eip155:42161', 'CANONICAL', 'safe', false],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'PROVISIONAL', 'processed', true],
    ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'FINANCIAL', 'finalized', false],
  ])(
    'binds %s %s to selector %s and local gate %s',
    (networkId, tier, selector, locallyExecutable) => {
      expect(balanceSyncTierThreshold(networkId, tier)).toMatchObject({
        selector,
        locallyExecutable,
      });
    },
  );

  it.each([
    ['0', '0'],
    [
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    ],
  ])('preserves exact chain position or atomic amount %s', (value, expected) => {
    expect(normalizeBalanceSyncPosition(value)).toBe(expected);
  });

  it.each(['-1', '01', '1.5', '1e6', 1])('rejects invalid exact position %#', (value) => {
    expect(() => normalizeBalanceSyncPosition(value)).toThrow(
      new BalanceSyncDomainError('INVALID_BALANCE_SYNC_POSITION'),
    );
  });

  it('creates one stable observation ID independent of retrieval time and position order', () => {
    const source = {
      position: '21000000',
      hash: `0x${'ab'.repeat(32)}`,
      parentHash: `0x${'cd'.repeat(32)}`,
      selector: 'latest' as const,
    };
    const positions = fixturePositions();
    const observationId = createBalanceSyncObservationId({
      accountId: ids.account,
      walletId: ids.wallet,
      networkId: 'eip155:1',
      tier: 'PROVISIONAL',
      source,
      positions,
    });

    expect(observationId).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      createBalanceSyncObservationId({
        accountId: ids.account,
        walletId: ids.wallet,
        networkId: 'eip155:1',
        tier: 'PROVISIONAL',
        source,
        positions: [...positions].reverse(),
      }),
    ).toBe(observationId);
    expect(BALANCE_SYNC_POLICY.maximumRecoveryReadUnits).toBe(2_048);
  });

  it('changes the observation ID when chain lineage changes at the same height', () => {
    const base = {
      accountId: ids.account,
      walletId: ids.wallet,
      networkId: 'eip155:1' as const,
      tier: 'PROVISIONAL' as const,
      source: {
        position: '21000000',
        hash: `0x${'ab'.repeat(32)}`,
        parentHash: `0x${'cd'.repeat(32)}`,
        selector: 'latest' as const,
      },
      positions: fixturePositions(),
    };
    expect(
      createBalanceSyncObservationId({
        ...base,
        source: { ...base.source, hash: `0x${'ef'.repeat(32)}` },
      }),
    ).not.toBe(createBalanceSyncObservationId(base));
  });
});
