import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { parseAccountId } from '../../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  IndexedBalanceCoverageStatus,
  IndexedBalanceFreshness,
  IndexedPortfolioBalanceCoverageTarget,
  IndexedPortfolioBalanceObservation,
  IndexedPortfolioBalanceSnapshot,
  PortfolioBalanceReader,
  ReadPortfolioBalancesRequest,
} from '../../../portfolio/application/ports/portfolio-balance-reader.port';
import { parseActivePortfolioWalletRegistrations } from '../../../portfolio/domain/active-portfolio-wallet-registrations';
import { normalizeBalanceSyncPosition } from '../../domain/balance-sync';

const CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const ROW_COLUMNS = Object.freeze([
  'target_wallet_id',
  'target_network_id',
  'target_status',
  'target_freshness',
  'checkpoint_revision',
  'current_observation_id',
  'source_position',
  'asset_identity',
  'amount_atomic',
  'observed_at',
] as const);

interface PortfolioBalanceRow extends QueryResultRow {
  target_wallet_id: string;
  target_network_id: string;
  target_status: string;
  target_freshness: string | null;
  checkpoint_revision: string | null;
  current_observation_id: string | null;
  source_position: string | null;
  asset_identity: string | null;
  amount_atomic: string | null;
  observed_at: Date | null;
}

export class PortfolioBalancePersistenceError extends Error {
  readonly code = 'PORTFOLIO_BALANCE_PERSISTENCE_FAILED' as const;

  constructor() {
    super('Portfolio balance persistence failed');
    this.name = 'PortfolioBalancePersistenceError';
  }
}

function fail(): never {
  throw new PortfolioBalancePersistenceError();
}

function canonicalTimestamp(value: unknown): string {
  const canonical = value instanceof Date ? value.toISOString() : value;
  if (typeof canonical !== 'string' || !CANONICAL_TIMESTAMP.test(canonical)) return fail();
  const milliseconds = Date.parse(canonical);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== canonical) {
    return fail();
  }
  return canonical;
}

function exactRow(value: unknown): PortfolioBalanceRow {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== ROW_COLUMNS.length ||
      keys.some(
        (key) => typeof key !== 'string' || !(ROW_COLUMNS as readonly string[]).includes(key),
      )
    ) {
      return fail();
    }
    for (const key of ROW_COLUMNS) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
    }
    return value as PortfolioBalanceRow;
  } catch (error) {
    if (error instanceof PortfolioBalancePersistenceError) throw error;
    return fail();
  }
}

function revision(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) return fail();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fail();
  return parsed;
}

function targetKey(value: Readonly<{ walletId: string; networkId: string }>): string {
  return `${value.walletId}\u0000${value.networkId}`;
}

function deterministicObservationUuid(observationId: string, assetIdentity: string): string {
  const hex = createHash('sha256')
    .update('crypto-lending:portfolio-balance-observation:v1\0')
    .update(observationId)
    .update('\0')
    .update(assetIdentity)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '4';
  const variant = Number.parseInt(hex[16] ?? '', 16);
  if (!Number.isInteger(variant)) return fail();
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const serialized = hex.join('');
  return `${serialized.slice(0, 8)}-${serialized.slice(8, 12)}-${serialized.slice(12, 16)}-${serialized.slice(16, 20)}-${serialized.slice(20)}`;
}

function overallCoverage(
  targets: readonly IndexedPortfolioBalanceCoverageTarget[],
): IndexedBalanceCoverageStatus {
  if (targets.length === 0 || targets.every(({ status }) => status === 'COMPLETE')) {
    return 'COMPLETE';
  }
  if (targets.every(({ status }) => status === 'UNAVAILABLE')) return 'UNAVAILABLE';
  return 'PARTIAL';
}

function snapshotId(
  accountId: string,
  evaluatedAt: string,
  targets: readonly IndexedPortfolioBalanceCoverageTarget[],
  observations: readonly IndexedPortfolioBalanceObservation[],
): string {
  return `balance-sync:${createHash('sha256')
    .update(
      JSON.stringify([
        'crypto-lending:portfolio-balance-snapshot:v1',
        accountId,
        evaluatedAt,
        targets,
        observations,
      ]),
      'utf8',
    )
    .digest('hex')}`;
}

@Injectable()
export class PostgresPortfolioBalanceReader implements PortfolioBalanceReader {
  constructor(private readonly postgres: PostgresService) {}

  async readCurrentBalances(
    request: ReadPortfolioBalancesRequest,
  ): Promise<IndexedPortfolioBalanceSnapshot> {
    try {
      const accountId = parseAccountId(request.accountId);
      const evaluatedAt = canonicalTimestamp(request.evaluatedAt);
      if (!CORRELATION_ID.test(request.correlationId)) return fail();
      const expectedWallets = parseActivePortfolioWalletRegistrations(request.expectedWallets);
      const expectedJson = expectedWallets.map(({ walletId, networkId }) => ({
        walletId,
        networkId,
      }));
      const result = await this.postgres.query<PortfolioBalanceRow>(
        `SELECT balance.*
         FROM read_balance_sync_portfolio($1::uuid, $2::jsonb, $3::timestamptz) AS balance`,
        [accountId, JSON.stringify(expectedJson), evaluatedAt],
      );
      const grouped = new Map<string, PortfolioBalanceRow[]>();
      for (const candidate of result.rows) {
        const row = exactRow(candidate);
        const key = targetKey({ walletId: row.target_wallet_id, networkId: row.target_network_id });
        const rows = grouped.get(key) ?? [];
        rows.push(row);
        grouped.set(key, rows);
      }

      const targets: IndexedPortfolioBalanceCoverageTarget[] = [];
      const observations: IndexedPortfolioBalanceObservation[] = [];
      for (const expected of expectedWallets) {
        const rows = grouped.get(targetKey(expected));
        if (!rows || rows.length < 1 || rows.length > 3) return fail();
        grouped.delete(targetKey(expected));
        const first = rows[0] ?? fail();
        if (
          rows.some(
            (row) =>
              row.target_wallet_id !== expected.walletId ||
              row.target_network_id !== expected.networkId ||
              row.target_status !== first.target_status ||
              row.target_freshness !== first.target_freshness ||
              row.checkpoint_revision !== first.checkpoint_revision ||
              row.current_observation_id !== first.current_observation_id ||
              row.source_position !== first.source_position,
          )
        ) {
          return fail();
        }
        if (first.target_status === 'UNAVAILABLE') {
          if (
            rows.length !== 1 ||
            first.target_freshness !== null ||
            first.current_observation_id !== null ||
            first.source_position !== null ||
            first.asset_identity !== null ||
            first.amount_atomic !== null ||
            first.observed_at !== null
          ) {
            return fail();
          }
          revision(first.checkpoint_revision);
          targets.push(Object.freeze({ ...expected, status: 'UNAVAILABLE' }));
          continue;
        }
        if (
          first.target_status !== 'COMPLETE' ||
          (first.target_freshness !== 'CURRENT' && first.target_freshness !== 'STALE') ||
          revision(first.checkpoint_revision) === null ||
          typeof first.current_observation_id !== 'string' ||
          !SHA256.test(first.current_observation_id) ||
          first.source_position === null ||
          BigInt(normalizeBalanceSyncPosition(first.source_position)) > UINT64_MAX ||
          rows.length !== 3
        ) {
          return fail();
        }
        const seenAssets = new Set<string>();
        for (const row of rows) {
          if (
            row.asset_identity === null ||
            row.amount_atomic === null ||
            row.observed_at === null ||
            row.current_observation_id === null ||
            row.target_freshness === null
          ) {
            return fail();
          }
          const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(
            expected.networkId,
            row.asset_identity,
          );
          if (!asset || asset.identity !== row.asset_identity || seenAssets.has(asset.identity)) {
            return fail();
          }
          seenAssets.add(asset.identity);
          observations.push(
            Object.freeze({
              observationId: deterministicObservationUuid(
                row.current_observation_id,
                asset.identity,
              ),
              walletId: expected.walletId,
              networkId: expected.networkId,
              assetIdentity: asset.identity,
              amountAtomic: normalizeBalanceSyncPosition(row.amount_atomic),
              observedAt: canonicalTimestamp(row.observed_at),
              freshnessClass: row.target_freshness as IndexedBalanceFreshness,
            }),
          );
        }
        if (seenAssets.size !== 3) return fail();
        targets.push(Object.freeze({ ...expected, status: 'COMPLETE' }));
      }
      if (grouped.size !== 0) return fail();
      observations.sort((left, right) =>
        `${targetKey(left)}\u0000${left.assetIdentity}`.localeCompare(
          `${targetKey(right)}\u0000${right.assetIdentity}`,
        ),
      );
      const freshnessClass: IndexedBalanceFreshness =
        targets.some(({ status }) => status !== 'COMPLETE') ||
        observations.some(({ freshnessClass }) => freshnessClass === 'STALE')
          ? 'STALE'
          : 'CURRENT';
      return Object.freeze({
        snapshotId: snapshotId(accountId, evaluatedAt, targets, observations),
        capturedAt: evaluatedAt,
        freshnessClass,
        coverage: Object.freeze({
          status: overallCoverage(targets),
          targets: Object.freeze(targets),
        }),
        observations: Object.freeze(observations),
      });
    } catch (error) {
      if (error instanceof PortfolioBalancePersistenceError) throw error;
      return fail();
    }
  }
}
