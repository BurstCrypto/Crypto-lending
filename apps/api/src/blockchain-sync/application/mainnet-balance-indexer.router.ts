import {
  BALANCE_SYNC_POLICY,
  BalanceSyncIndexerFailure,
  type BalanceSyncSourcePoint,
} from '../domain/balance-sync';
import type {
  BalanceIndexerReadRequest,
  BalanceIndexerRescanRequest,
  BalanceSyncIndexerPort,
} from './ports/balance-sync.ports';

export const ETHEREUM_MAINNET_BALANCE_NETWORK_ID = 'eip155:1' as const;
export const SOLANA_MAINNET_BALANCE_NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;

const READ_REQUEST_KEYS = Object.freeze([
  'accountId',
  'walletId',
  'networkId',
  'tier',
  'selector',
] as const);
const RESCAN_REQUEST_KEYS = Object.freeze([
  ...READ_REQUEST_KEYS,
  'fromFinalizedSource',
  'maximumReadUnits',
] as const);
const SOURCE_POINT_KEYS = Object.freeze([
  'position',
  'hash',
  'parentHash',
  'selector',
  'retrievedAt',
] as const);
const TIERS = Object.freeze(['PROVISIONAL', 'CANONICAL', 'FINANCIAL'] as const);
const SELECTORS = Object.freeze(['latest', 'safe', 'finalized', 'processed', 'confirmed'] as const);

/**
 * Closed launch-network router. It selects exactly one injected mainnet reader
 * and owns no provider fallback, endpoint, credential, client, or retry policy.
 */
export class MainnetBalanceIndexerRouter implements BalanceSyncIndexerPort {
  constructor(
    private readonly ethereum: BalanceSyncIndexerPort,
    private readonly solana: BalanceSyncIndexerPort,
  ) {}

  async readCurrent(request: BalanceIndexerReadRequest): Promise<unknown> {
    const validated = copyReadRequest(request, READ_REQUEST_KEYS);
    return this.indexerFor(validated.networkId).readCurrent(validated);
  }

  async rescanFromCheckpoint(request: BalanceIndexerRescanRequest): Promise<unknown> {
    const record = exactDataRecord(request, RESCAN_REQUEST_KEYS);
    const validated = Object.freeze({
      ...copyReadRecord(record),
      fromFinalizedSource: copySourcePoint(record.fromFinalizedSource),
      maximumReadUnits: boundedRecoveryReadUnits(record.maximumReadUnits),
    }) satisfies BalanceIndexerRescanRequest;
    return this.indexerFor(validated.networkId).rescanFromCheckpoint(validated);
  }

  private indexerFor(networkId: string): BalanceSyncIndexerPort {
    switch (networkId) {
      case ETHEREUM_MAINNET_BALANCE_NETWORK_ID:
        return this.ethereum;
      case SOLANA_MAINNET_BALANCE_NETWORK_ID:
        return this.solana;
      default:
        return unsupportedRequest();
    }
  }
}

function copyReadRequest(request: unknown, keys: readonly string[]): BalanceIndexerReadRequest {
  return Object.freeze(copyReadRecord(exactDataRecord(request, keys)));
}

function copyReadRecord(record: Record<string, unknown>): BalanceIndexerReadRequest {
  if (
    typeof record.accountId !== 'string' ||
    typeof record.walletId !== 'string' ||
    typeof record.networkId !== 'string' ||
    !TIERS.includes(record.tier as (typeof TIERS)[number]) ||
    !SELECTORS.includes(record.selector as (typeof SELECTORS)[number])
  ) {
    return unsupportedRequest();
  }
  if (
    record.networkId !== ETHEREUM_MAINNET_BALANCE_NETWORK_ID &&
    record.networkId !== SOLANA_MAINNET_BALANCE_NETWORK_ID
  ) {
    return unsupportedRequest();
  }
  return {
    accountId: record.accountId,
    walletId: record.walletId,
    networkId: record.networkId,
    tier: record.tier as BalanceIndexerReadRequest['tier'],
    selector: record.selector as BalanceIndexerReadRequest['selector'],
  };
}

function copySourcePoint(value: unknown): BalanceSyncSourcePoint {
  const record = exactDataRecord(value, SOURCE_POINT_KEYS);
  if (
    typeof record.position !== 'string' ||
    typeof record.hash !== 'string' ||
    typeof record.parentHash !== 'string' ||
    !SELECTORS.includes(record.selector as (typeof SELECTORS)[number]) ||
    typeof record.retrievedAt !== 'string'
  ) {
    return unsupportedRequest();
  }
  return Object.freeze({
    position: record.position,
    hash: record.hash,
    parentHash: record.parentHash,
    selector: record.selector as BalanceSyncSourcePoint['selector'],
    retrievedAt: record.retrievedAt,
  });
}

function boundedRecoveryReadUnits(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > BALANCE_SYNC_POLICY.maximumRecoveryReadUnits
  ) {
    return unsupportedRequest();
  }
  return value as number;
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return unsupportedRequest();
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return unsupportedRequest();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return unsupportedRequest();
    }
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return unsupportedRequest();
      }
      copy[key] = descriptor.value;
    }
    return copy;
  } catch (error) {
    if (error instanceof BalanceSyncIndexerFailure) throw error;
    return unsupportedRequest();
  }
}

function unsupportedRequest(): never {
  throw new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE');
}
