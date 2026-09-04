import type { QueryResult } from 'pg';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import type { ReadPortfolioBalancesRequest } from '../../../portfolio/application/ports/portfolio-balance-reader.port';
import {
  PortfolioBalancePersistenceError,
  PostgresPortfolioBalanceReader,
} from './postgres-portfolio-balance.reader';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const ETHEREUM = 'eip155:1' as const;
const EVALUATED_AT = '2026-09-04T12:00:05.000Z';
const OBSERVED_AT = '2026-09-04T12:00:00.000Z';

function request(): ReadPortfolioBalancesRequest {
  return {
    accountId: ACCOUNT_ID as never,
    evaluatedAt: EVALUATED_AT,
    correlationId: '33333333-3333-4333-8333-333333333333',
    expectedWallets: [{ walletId: WALLET_ID, networkId: ETHEREUM }],
  };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target_wallet_id: WALLET_ID,
    target_network_id: ETHEREUM,
    target_status: 'COMPLETE',
    target_freshness: 'CURRENT',
    checkpoint_revision: '7',
    current_observation_id: 'a'.repeat(64),
    source_position: '123',
    asset_identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    amount_atomic: '1000000',
    observed_at: new Date(OBSERVED_AT),
    ...overrides,
  };
}

function completeRows(): Record<string, unknown>[] {
  return MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets
    .filter(
      ({ networkId, activationState }) => networkId === ETHEREUM && activationState === 'ACTIVE',
    )
    .map((asset, index) =>
      row({
        asset_identity: asset.identity,
        amount_atomic: String((index + 1) * 1_000_000),
      }),
    );
}

function unavailableRow(): Record<string, unknown> {
  return row({
    target_status: 'UNAVAILABLE',
    target_freshness: null,
    checkpoint_revision: null,
    current_observation_id: null,
    source_position: null,
    asset_identity: null,
    amount_atomic: null,
    observed_at: null,
  });
}

function result(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

function harness(): { readonly query: jest.Mock; readonly reader: PostgresPortfolioBalanceReader } {
  const query = jest.fn();
  return {
    query,
    reader: new PostgresPortfolioBalanceReader({ query } as unknown as PostgresService),
  };
}

describe('Postgres portfolio balance reader', () => {
  it('returns deterministic complete observations for the exact validated roster', async () => {
    const test = harness();
    test.query.mockResolvedValue(result(completeRows()));

    const first = await test.reader.readCurrentBalances(request());
    const second = await test.reader.readCurrentBalances(request());
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      capturedAt: EVALUATED_AT,
      freshnessClass: 'CURRENT',
      coverage: {
        status: 'COMPLETE',
        targets: [{ walletId: WALLET_ID, networkId: ETHEREUM, status: 'COMPLETE' }],
      },
    });
    expect(first.observations).toHaveLength(3);
    expect(new Set(first.observations.map(({ observationId }) => observationId)).size).toBe(3);
    expect(test.query.mock.calls[0]?.[0]).toContain('read_balance_sync_portfolio');
    expect(test.query.mock.calls[0]?.[1]).toEqual([
      ACCOUNT_ID,
      JSON.stringify([{ walletId: WALLET_ID, networkId: ETHEREUM }]),
      EVALUATED_AT,
    ]);
  });

  it('keeps an unavailable checkpoint explicit and never invents a zero balance', async () => {
    const test = harness();
    test.query.mockResolvedValue(result([unavailableRow()]));

    await expect(test.reader.readCurrentBalances(request())).resolves.toMatchObject({
      freshnessClass: 'STALE',
      coverage: {
        status: 'UNAVAILABLE',
        targets: [{ walletId: WALLET_ID, networkId: ETHEREUM, status: 'UNAVAILABLE' }],
      },
      observations: [],
    });
  });

  it.each([
    [
      completeRows().map((candidate, index) =>
        index === 0 ? { ...candidate, leak: true } : candidate,
      ),
    ],
    [completeRows().map((candidate) => ({ ...candidate, asset_identity: row().asset_identity }))],
    [
      completeRows().map((candidate, index) =>
        index === 0 ? { ...candidate, amount_atomic: '01' } : candidate,
      ),
    ],
    [[row()]],
    [[{ ...unavailableRow(), checkpoint_revision: '0' }]],
  ])('fails closed on malformed or incomplete database rows', async (rows) => {
    const test = harness();
    test.query.mockResolvedValue(result(rows as Record<string, unknown>[]));
    await expect(test.reader.readCurrentBalances(request())).rejects.toBeInstanceOf(
      PortfolioBalancePersistenceError,
    );
  });

  it('rejects unsupported rosters and sanitizes database errors', async () => {
    const test = harness();
    await expect(
      test.reader.readCurrentBalances({
        ...request(),
        expectedWallets: [{ walletId: WALLET_ID, networkId: 'eip155:8453' }],
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'PORTFOLIO_BALANCE_PERSISTENCE_FAILED',
        message: 'Portfolio balance persistence failed',
      }),
    );
    expect(test.query).not.toHaveBeenCalled();

    test.query.mockRejectedValue(new Error('postgres://api:secret@example.invalid/key'));
    await expect(test.reader.readCurrentBalances(request())).rejects.toEqual(
      expect.objectContaining({
        code: 'PORTFOLIO_BALANCE_PERSISTENCE_FAILED',
        message: 'Portfolio balance persistence failed',
      }),
    );
  });
});
