import type {
  IndexedBalanceFreshness,
  IndexedPortfolioBalanceObservation,
  IndexedPortfolioBalanceSnapshot,
} from '../application/ports/portfolio-balance-reader.port';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const EVM_NETWORK_ID = /^eip155:(?:0|[1-9][0-9]{0,19})$/u;
const SOLANA_NETWORK_ID = /^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const EVM_ASSET_IDENTITY = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_ASSET_IDENTITY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const CANONICAL_AMOUNT = /^(?:0|[1-9][0-9]{0,77})$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_BALANCE_OBSERVATIONS = 512;

export type PortfolioBalanceSnapshotValidationCode =
  'INVALID_SNAPSHOT' | 'INVALID_OBSERVATION' | 'DUPLICATE_OBSERVATION' | 'DUPLICATE_BALANCE_SOURCE';

export class PortfolioBalanceSnapshotValidationError extends Error {
  constructor(readonly code: PortfolioBalanceSnapshotValidationCode) {
    super('portfolio balance snapshot is invalid');
    this.name = 'PortfolioBalanceSnapshotValidationError';
  }
}

function fail(code: PortfolioBalanceSnapshotValidationCode): never {
  throw new PortfolioBalanceSnapshotValidationError(code);
}

function dataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('INVALID_SNAPSHOT');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(record, key)) ||
    actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    return fail('INVALID_SNAPSHOT');
  }
  return record;
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) {
    return fail('INVALID_SNAPSHOT');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return fail('INVALID_SNAPSHOT');
  }
  return value;
}

function parseObservation(value: unknown): IndexedPortfolioBalanceObservation {
  let record: Record<string, unknown>;
  try {
    record = dataRecord(value, [
      'observationId',
      'walletId',
      'networkId',
      'assetIdentity',
      'amountAtomic',
      'observedAt',
      'freshnessClass',
    ]);
  } catch {
    return fail('INVALID_OBSERVATION');
  }

  if (
    typeof record.observationId !== 'string' ||
    !UUID_V4.test(record.observationId) ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    typeof record.networkId !== 'string' ||
    (!EVM_NETWORK_ID.test(record.networkId) && !SOLANA_NETWORK_ID.test(record.networkId)) ||
    typeof record.assetIdentity !== 'string' ||
    typeof record.amountAtomic !== 'string' ||
    !CANONICAL_AMOUNT.test(record.amountAtomic) ||
    (record.freshnessClass !== 'CURRENT' && record.freshnessClass !== 'STALE')
  ) {
    return fail('INVALID_OBSERVATION');
  }
  if (
    (EVM_NETWORK_ID.test(record.networkId) && !EVM_ASSET_IDENTITY.test(record.assetIdentity)) ||
    (SOLANA_NETWORK_ID.test(record.networkId) && !SOLANA_ASSET_IDENTITY.test(record.assetIdentity))
  ) {
    return fail('INVALID_OBSERVATION');
  }

  let observedAt: string;
  try {
    observedAt = canonicalTimestamp(record.observedAt);
  } catch {
    return fail('INVALID_OBSERVATION');
  }
  const freshnessClass = record.freshnessClass as IndexedBalanceFreshness;
  return {
    observationId: record.observationId,
    walletId: record.walletId,
    networkId: record.networkId,
    assetIdentity: EVM_NETWORK_ID.test(record.networkId)
      ? record.assetIdentity.toLowerCase()
      : record.assetIdentity,
    amountAtomic: record.amountAtomic,
    observedAt,
    freshnessClass,
  };
}

export function parseIndexedPortfolioBalanceSnapshot(
  value: unknown,
  evaluatedAtInput: unknown,
): IndexedPortfolioBalanceSnapshot {
  const evaluatedAt = canonicalTimestamp(evaluatedAtInput);
  const record = dataRecord(value, ['snapshotId', 'capturedAt', 'observations']);
  if (typeof record.snapshotId !== 'string' || !SAFE_SNAPSHOT_ID.test(record.snapshotId)) {
    return fail('INVALID_SNAPSHOT');
  }
  const capturedAt = canonicalTimestamp(record.capturedAt);
  if (capturedAt > evaluatedAt) return fail('INVALID_SNAPSHOT');
  if (
    !Array.isArray(record.observations) ||
    record.observations.length > MAX_BALANCE_OBSERVATIONS
  ) {
    return fail('INVALID_SNAPSHOT');
  }

  const observations = record.observations.map(parseObservation);
  const observationIds = new Set<string>();
  const balanceSources = new Set<string>();
  for (const observation of observations) {
    if (observation.observedAt > capturedAt) return fail('INVALID_OBSERVATION');
    if (observationIds.has(observation.observationId)) {
      return fail('DUPLICATE_OBSERVATION');
    }
    observationIds.add(observation.observationId);
    const sourceKey = `${observation.walletId}\u0000${observation.networkId}\u0000${observation.assetIdentity}`;
    if (balanceSources.has(sourceKey)) return fail('DUPLICATE_BALANCE_SOURCE');
    balanceSources.add(sourceKey);
  }

  return {
    snapshotId: record.snapshotId,
    capturedAt,
    observations,
  };
}
