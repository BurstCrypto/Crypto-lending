import type { QueryResult } from 'pg';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import type { BalanceSyncScope } from '../../application/ports/balance-sync.ports';
import {
  createBalanceSyncObservationId,
  type BalanceSyncObservation,
  type BalanceSyncPosition,
} from '../../domain/balance-sync';
import {
  BalanceSyncCheckpointPersistenceError,
  PostgresBalanceSyncCheckpointRepository,
} from './postgres-balance-sync-checkpoint.repository';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const ETHEREUM = 'eip155:1' as const;
const AT = '2026-09-04T12:00:00.000Z';
const SCOPE: BalanceSyncScope = Object.freeze({
  accountId: ACCOUNT_ID,
  walletId: WALLET_ID,
  networkId: ETHEREUM,
});

function positions(): readonly BalanceSyncPosition[] {
  return Object.freeze(
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets
      .filter(
        ({ networkId, activationState }) => networkId === ETHEREUM && activationState === 'ACTIVE',
      )
      .map((asset, index) =>
        Object.freeze({
          positionId: String(index + 1).repeat(64),
          stablecoin: asset.stablecoin,
          assetIdentity: asset.identity,
          amountAtomic: String((index + 1) * 1_000_000),
        }),
      ),
  );
}

function observation(): BalanceSyncObservation {
  const source = Object.freeze({
    position: '100',
    hash: `0x${'a'.repeat(64)}`,
    parentHash: `0x${'b'.repeat(64)}`,
    selector: 'latest' as const,
    retrievedAt: AT,
  });
  const observedPositions = positions();
  return Object.freeze({
    observationId: createBalanceSyncObservationId({
      ...SCOPE,
      tier: 'PROVISIONAL',
      source,
      positions: observedPositions,
    }),
    ...SCOPE,
    tier: 'PROVISIONAL',
    source,
    headAdvancedAt: AT,
    positions: observedPositions,
  });
}

function result(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

function checkpointRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const current = observation();
  return {
    checkpoint_revision: '1',
    checkpoint_account_id: ACCOUNT_ID,
    checkpoint_wallet_id: WALLET_ID,
    checkpoint_network_id: ETHEREUM,
    checkpoint_current_observation_id: current.observationId,
    checkpoint_freshness: 'CURRENT',
    checkpoint_stale_since: null,
    checkpoint_last_failure_code: null,
    checkpoint_last_finalized_position: null,
    checkpoint_last_finalized_hash: null,
    checkpoint_last_finalized_parent_hash: null,
    checkpoint_last_finalized_selector: null,
    checkpoint_last_finalized_retrieved_at: null,
    observation_tier: 'PROVISIONAL',
    observation_source_position: current.source.position,
    observation_source_hash: current.source.hash,
    observation_source_parent_hash: current.source.parentHash,
    observation_selector: current.source.selector,
    observation_retrieved_at: new Date(current.source.retrievedAt),
    observation_head_advanced_at: new Date(current.headAdvancedAt),
    observation_positions: current.positions,
    ...overrides,
  };
}

function harness(): {
  readonly query: jest.Mock;
  readonly repository: PostgresBalanceSyncCheckpointRepository;
} {
  const query = jest.fn();
  return {
    query,
    repository: new PostgresBalanceSyncCheckpointRepository({
      query,
    } as unknown as PostgresService),
  };
}

describe('Postgres balance sync checkpoint repository', () => {
  it('writes only a normalized exact-mainnet observation and parses the closed outcome', async () => {
    const test = harness();
    const current = observation();
    test.query.mockResolvedValue(
      result([
        {
          write_outcome: 'APPLIED',
          checkpoint_revision: '1',
          checkpoint_event_id: 'c'.repeat(64),
        },
      ]),
    );

    await expect(
      test.repository.upsertCurrent({
        scope: SCOPE,
        expectedRevision: null,
        observation: current,
        mode: 'CREATED',
        succeededAt: AT,
      }),
    ).resolves.toBeUndefined();
    expect(test.query.mock.calls[0]?.[0]).toContain('record_balance_sync_current');
    expect(test.query.mock.calls[0]?.[1]).toEqual([
      ACCOUNT_ID,
      WALLET_ID,
      ETHEREUM,
      null,
      'CREATED',
      current.observationId,
      '100',
      current.source.hash,
      current.source.parentHash,
      'latest',
      AT,
      AT,
      JSON.stringify(current.positions),
      AT,
    ]);
  });

  it('maps a complete checkpoint and independently verifies its observation digest', async () => {
    const test = harness();
    test.query.mockResolvedValue(result([checkpointRow()]));

    await expect(test.repository.load(SCOPE)).resolves.toEqual({
      revision: 1,
      scope: SCOPE,
      currentObservation: observation(),
      lastFinalizedSource: null,
      freshness: 'CURRENT',
      staleSince: null,
      lastFailureCode: null,
    });
  });

  it.each([
    [checkpointRow({ unexpected_column: 'secret' }), 'unexpected database column'],
    [
      checkpointRow({ checkpoint_wallet_id: '33333333-3333-4333-8333-333333333333' }),
      'wrong scope',
    ],
    [checkpointRow({ observation_source_position: '18446744073709551616' }), 'uint64 overflow'],
    [checkpointRow({ observation_positions: positions().slice(0, 2) }), 'incomplete assets'],
  ])('fails closed on %s', async (row) => {
    const test = harness();
    test.query.mockResolvedValue(result([row as Record<string, unknown>]));
    await expect(test.repository.load(SCOPE)).rejects.toBeInstanceOf(
      BalanceSyncCheckpointPersistenceError,
    );
  });

  it('rejects unsupported scope and malformed output before details can escape', async () => {
    const test = harness();
    await expect(test.repository.load({ ...SCOPE, networkId: 'eip155:8453' })).rejects.toEqual(
      expect.objectContaining({
        code: 'BALANCE_SYNC_CHECKPOINT_PERSISTENCE_FAILED',
        message: 'Balance sync checkpoint persistence failed',
      }),
    );
    expect(test.query).not.toHaveBeenCalled();

    test.query.mockRejectedValue(new Error('postgres://worker:secret@example.invalid/key'));
    await expect(test.repository.load(SCOPE)).rejects.toEqual(
      expect.objectContaining({
        code: 'BALANCE_SYNC_CHECKPOINT_PERSISTENCE_FAILED',
        message: 'Balance sync checkpoint persistence failed',
      }),
    );
  });
});
