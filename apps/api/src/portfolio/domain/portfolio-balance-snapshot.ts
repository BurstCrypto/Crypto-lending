import type {
  IndexedBalanceCoverageStatus,
  IndexedBalanceFreshness,
  IndexedPortfolioBalanceCoverage,
  IndexedPortfolioBalanceCoverageTarget,
  IndexedPortfolioBalanceObservation,
  IndexedPortfolioBalanceSnapshot,
} from '../application/ports/portfolio-balance-reader.port';
import { MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT } from '../../wallets/application/ports/wallet-registration-repository.port';
import type { ActivePortfolioWalletRegistration } from '../application/ports/portfolio-wallet-registration-reader.port';
import { parseActivePortfolioWalletRegistrations } from './active-portfolio-wallet-registrations';

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
  | 'INVALID_SNAPSHOT'
  | 'INVALID_COVERAGE'
  | 'INVALID_OBSERVATION'
  | 'DUPLICATE_OBSERVATION'
  | 'DUPLICATE_BALANCE_SOURCE';

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
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('INVALID_SNAPSHOT');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('INVALID_SNAPSHOT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail('INVALID_SNAPSHOT');
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return fail('INVALID_SNAPSHOT');
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return fail('INVALID_SNAPSHOT');
  }
}

function dataArray(
  value: unknown,
  maximumLength: number,
  code: PortfolioBalanceSnapshotValidationCode,
): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
      return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength ||
      lengthDescriptor.enumerable !== false
    ) {
      return fail(code);
    }
    const indexKeys = Array.from({ length: lengthDescriptor.value }, (_, index) => String(index));
    const expectedKeys = [...indexKeys, 'length'];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail(code);
    }
    return indexKeys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      return descriptor.value;
    });
  } catch {
    return fail(code);
  }
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

function coverageTargetKey(
  target: Pick<IndexedPortfolioBalanceCoverageTarget, 'walletId' | 'networkId'>,
): string {
  return `${target.walletId}\u0000${target.networkId}`;
}

function expectedCoverageStatus(
  targets: readonly IndexedPortfolioBalanceCoverageTarget[],
): IndexedBalanceCoverageStatus {
  if (targets.length === 0 || targets.every(({ status }) => status === 'COMPLETE')) {
    return 'COMPLETE';
  }
  if (targets.every(({ status }) => status === 'UNAVAILABLE')) return 'UNAVAILABLE';
  return 'PARTIAL';
}

function parseCoverageTarget(value: unknown): IndexedPortfolioBalanceCoverageTarget {
  let record: Record<string, unknown>;
  try {
    record = dataRecord(value, ['walletId', 'networkId', 'status']);
  } catch {
    return fail('INVALID_COVERAGE');
  }
  if (
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    typeof record.networkId !== 'string' ||
    (!EVM_NETWORK_ID.test(record.networkId) && !SOLANA_NETWORK_ID.test(record.networkId)) ||
    (record.status !== 'COMPLETE' && record.status !== 'PARTIAL' && record.status !== 'UNAVAILABLE')
  ) {
    return fail('INVALID_COVERAGE');
  }
  return Object.freeze({
    walletId: record.walletId,
    networkId: record.networkId,
    status: record.status,
  });
}

function parseCoverage(
  value: unknown,
  expectedWallets: readonly ActivePortfolioWalletRegistration[],
): IndexedPortfolioBalanceCoverage {
  let record: Record<string, unknown>;
  try {
    record = dataRecord(value, ['status', 'targets']);
  } catch {
    return fail('INVALID_COVERAGE');
  }
  const targets = dataArray(
    record.targets,
    MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT,
    'INVALID_COVERAGE',
  )
    .map(parseCoverageTarget)
    .sort((left, right) => coverageTargetKey(left).localeCompare(coverageTargetKey(right)));
  const targetKeys = targets.map(coverageTargetKey);
  const expectedKeys = expectedWallets.map(coverageTargetKey);
  if (
    new Set(targetKeys).size !== targetKeys.length ||
    targetKeys.length !== expectedKeys.length ||
    targetKeys.some((key, index) => key !== expectedKeys[index]) ||
    record.status !== expectedCoverageStatus(targets)
  ) {
    return fail('INVALID_COVERAGE');
  }
  return Object.freeze({
    status: record.status as IndexedBalanceCoverageStatus,
    targets: Object.freeze(targets),
  });
}

function parseCoveredSnapshot(
  value: unknown,
  evaluatedAt: string,
  expectedWallets: readonly ActivePortfolioWalletRegistration[],
): IndexedPortfolioBalanceSnapshot {
  const record = dataRecord(value, [
    'snapshotId',
    'capturedAt',
    'freshnessClass',
    'coverage',
    'observations',
  ]);
  if (typeof record.snapshotId !== 'string' || !SAFE_SNAPSHOT_ID.test(record.snapshotId)) {
    return fail('INVALID_SNAPSHOT');
  }
  const capturedAt = canonicalTimestamp(record.capturedAt);
  if (capturedAt > evaluatedAt) return fail('INVALID_SNAPSHOT');
  if (record.freshnessClass !== 'CURRENT' && record.freshnessClass !== 'STALE') {
    return fail('INVALID_SNAPSHOT');
  }
  const coverage = parseCoverage(record.coverage, expectedWallets);
  const observationValues = dataArray(
    record.observations,
    MAX_BALANCE_OBSERVATIONS,
    'INVALID_SNAPSHOT',
  );

  const observations = observationValues.map((observation) => {
    const parsed = parseObservation(observation);
    return record.freshnessClass === 'STALE' && parsed.freshnessClass === 'CURRENT'
      ? { ...parsed, freshnessClass: 'STALE' as const }
      : parsed;
  });
  const observationIds = new Set<string>();
  const balanceSources = new Set<string>();
  const coverageByTarget = new Map(
    coverage.targets.map((target) => [coverageTargetKey(target), target.status]),
  );
  for (const observation of observations) {
    if (observation.observedAt > capturedAt) return fail('INVALID_OBSERVATION');
    if (observationIds.has(observation.observationId)) {
      return fail('DUPLICATE_OBSERVATION');
    }
    observationIds.add(observation.observationId);
    const targetStatus = coverageByTarget.get(coverageTargetKey(observation));
    if (targetStatus === undefined || targetStatus === 'UNAVAILABLE') {
      return fail('INVALID_COVERAGE');
    }
    const sourceKey = `${observation.walletId}\u0000${observation.networkId}\u0000${observation.assetIdentity}`;
    if (balanceSources.has(sourceKey)) return fail('DUPLICATE_BALANCE_SOURCE');
    balanceSources.add(sourceKey);
  }

  return {
    snapshotId: record.snapshotId,
    capturedAt,
    freshnessClass: record.freshnessClass,
    coverage,
    observations: Object.freeze(observations),
  };
}

export function parseIndexedPortfolioBalanceSnapshot(
  value: unknown,
  evaluatedAtInput: unknown,
  expectedWalletsInput: unknown,
): IndexedPortfolioBalanceSnapshot {
  const evaluatedAt = canonicalTimestamp(evaluatedAtInput);
  let expectedWallets: readonly ActivePortfolioWalletRegistration[];
  try {
    expectedWallets = parseActivePortfolioWalletRegistrations(expectedWalletsInput);
  } catch {
    return fail('INVALID_COVERAGE');
  }
  return parseCoveredSnapshot(value, evaluatedAt, expectedWallets);
}

/**
 * Local-demo compatibility boundary. Production code must always supply the
 * independently read active registration set to parseIndexedPortfolioBalanceSnapshot.
 */
export function parseLocalDemoPortfolioBalanceSnapshot(
  value: unknown,
  evaluatedAtInput: unknown,
): IndexedPortfolioBalanceSnapshot {
  const evaluatedAt = canonicalTimestamp(evaluatedAtInput);
  const record = dataRecord(value, ['snapshotId', 'capturedAt', 'freshnessClass', 'observations']);
  const observations = dataArray(
    record.observations,
    MAX_BALANCE_OBSERVATIONS,
    'INVALID_SNAPSHOT',
  ).map(parseObservation);
  const targetsByKey = new Map<string, ActivePortfolioWalletRegistration>();
  for (const observation of observations) {
    const target = Object.freeze({
      walletId: observation.walletId,
      networkId: observation.networkId,
    });
    targetsByKey.set(coverageTargetKey(target), target);
  }
  const expectedWallets = [...targetsByKey.values()].sort((left, right) =>
    coverageTargetKey(left).localeCompare(coverageTargetKey(right)),
  );
  return parseCoveredSnapshot(
    {
      snapshotId: record.snapshotId,
      capturedAt: record.capturedAt,
      freshnessClass: record.freshnessClass,
      coverage: {
        status: 'COMPLETE',
        targets: expectedWallets.map((target) => ({ ...target, status: 'COMPLETE' as const })),
      },
      observations: record.observations,
    },
    evaluatedAt,
    expectedWallets,
  );
}
