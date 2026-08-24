import {
  parseIndexedPortfolioBalanceSnapshot,
  PortfolioBalanceSnapshotValidationError,
} from './portfolio-balance-snapshot';
import type { IndexedPortfolioBalanceSnapshot } from '../application/ports/portfolio-balance-reader.port';

const EVALUATED_AT = '2026-08-24T18:00:00.000Z';

function snapshot(): IndexedPortfolioBalanceSnapshot {
  return {
    snapshotId: 'idx5-snapshot-42',
    capturedAt: '2026-08-24T17:59:59.000Z',
    freshnessClass: 'CURRENT',
    observations: [
      {
        observationId: '11111111-1111-4111-8111-111111111111',
        walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        networkId: 'eip155:1',
        assetIdentity: '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amountAtomic: '5000000000',
        observedAt: '2026-08-24T17:59:58.000Z',
        freshnessClass: 'CURRENT',
      },
      {
        observationId: '22222222-2222-4222-8222-222222222222',
        walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        assetIdentity: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        amountAtomic: '2500000000',
        observedAt: '2026-08-24T17:59:57.000Z',
        freshnessClass: 'STALE',
      },
    ],
  };
}

describe('indexed portfolio balance snapshot', () => {
  it('accepts a bounded exact-key snapshot and canonicalizes EVM identity casing', () => {
    const parsed = parseIndexedPortfolioBalanceSnapshot(snapshot(), EVALUATED_AT);

    expect(parsed).toEqual({
      ...snapshot(),
      observations: [
        {
          ...snapshot().observations[0],
          assetIdentity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        },
        snapshot().observations[1],
      ],
    });
  });

  it('rejects account spoofing and all unknown snapshot or observation fields', () => {
    expect(() =>
      parseIndexedPortfolioBalanceSnapshot(
        { ...snapshot(), accountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
        EVALUATED_AT,
      ),
    ).toThrow(PortfolioBalanceSnapshotValidationError);
    expect(() =>
      parseIndexedPortfolioBalanceSnapshot(
        {
          ...snapshot(),
          observations: [{ ...snapshot().observations[0], providerPayload: 'must-not-pass' }],
        },
        EVALUATED_AT,
      ),
    ).toThrow('portfolio balance snapshot is invalid');
  });

  it('rejects duplicate observation IDs and duplicate wallet/chain/asset sources', () => {
    const first = snapshot().observations[0];
    if (!first) throw new Error('fixture missing');

    expect(() =>
      parseIndexedPortfolioBalanceSnapshot(
        { ...snapshot(), observations: [first, { ...first }] },
        EVALUATED_AT,
      ),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_OBSERVATION' }));
    expect(() =>
      parseIndexedPortfolioBalanceSnapshot(
        {
          ...snapshot(),
          observations: [
            first,
            { ...first, observationId: '33333333-3333-4333-8333-333333333333' },
          ],
        },
        EVALUATED_AT,
      ),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_BALANCE_SOURCE' }));
  });

  it('rejects non-canonical amounts, identities, timestamps, and future observations', () => {
    const first = snapshot().observations[0];
    if (!first) throw new Error('fixture missing');
    for (const observation of [
      { ...first, amountAtomic: '01' },
      { ...first, amountAtomic: '-1' },
      { ...first, assetIdentity: '0xshort' },
      { ...first, observedAt: 'not-a-date' },
      { ...first, observedAt: '2026-08-24T18:00:00.000Z' },
    ]) {
      expect(() =>
        parseIndexedPortfolioBalanceSnapshot(
          { ...snapshot(), observations: [observation] },
          EVALUATED_AT,
        ),
      ).toThrow('portfolio balance snapshot is invalid');
    }
    expect(() =>
      parseIndexedPortfolioBalanceSnapshot(
        { ...snapshot(), capturedAt: '2026-08-24T18:00:00.001Z' },
        EVALUATED_AT,
      ),
    ).toThrow('portfolio balance snapshot is invalid');
  });

  it('enforces the bounded observation cardinality', () => {
    const first = snapshot().observations[0];
    if (!first) throw new Error('fixture missing');
    const observations = Array.from({ length: 513 }, (_, index) => ({
      ...first,
      observationId: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
    }));

    expect(() =>
      parseIndexedPortfolioBalanceSnapshot({ ...snapshot(), observations }, EVALUATED_AT),
    ).toThrow('portfolio balance snapshot is invalid');
  });

  it('returns detached records instead of retaining mutable reader objects', () => {
    const input = snapshot();
    const parsed = parseIndexedPortfolioBalanceSnapshot(input, EVALUATED_AT);
    const mutable = input.observations[0] as { amountAtomic: string };
    mutable.amountAtomic = '9999999999';

    expect(parsed.observations[0]?.amountAtomic).toBe('5000000000');
  });

  it('downgrades every row when the account snapshot itself is stale', () => {
    const parsed = parseIndexedPortfolioBalanceSnapshot(
      { ...snapshot(), freshnessClass: 'STALE' },
      EVALUATED_AT,
    );

    expect(parsed.freshnessClass).toBe('STALE');
    expect(parsed.observations.every(({ freshnessClass }) => freshnessClass === 'STALE')).toBe(
      true,
    );
  });
});
