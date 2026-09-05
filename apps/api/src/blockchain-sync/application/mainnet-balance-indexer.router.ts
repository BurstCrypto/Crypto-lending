import {
  BALANCE_SYNC_POLICY,
  BalanceSyncIndexerFailure,
  type BalanceSyncSourcePoint,
} from '../domain/balance-sync';
import {
  reviewBalanceSyncExecutionContext,
  type BalanceIndexerReadRequest,
  type BalanceIndexerRescanRequest,
  type BalanceSyncExecutionContext,
  type BalanceSyncIndexerPort,
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
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface ReviewedBalanceIndexer {
  readonly readCurrent: (
    request: BalanceIndexerReadRequest,
    context: BalanceSyncExecutionContext,
  ) => Promise<unknown>;
  readonly rescanFromCheckpoint: (
    request: BalanceIndexerRescanRequest,
    context: BalanceSyncExecutionContext,
  ) => Promise<unknown>;
}

class MainnetBalanceIndexerRouterConfigurationError extends Error {
  readonly code = 'MAINNET_BALANCE_INDEXER_ROUTER_CONFIGURATION_INVALID' as const;

  constructor() {
    super('Mainnet balance indexer router configuration is invalid');
    this.name = 'MainnetBalanceIndexerRouterConfigurationError';
    Object.freeze(this);
  }
}

/**
 * Closed launch-network router. It selects exactly one injected mainnet reader
 * and owns no provider fallback, endpoint, credential, client, or retry policy.
 */
export class MainnetBalanceIndexerRouter implements BalanceSyncIndexerPort {
  private readonly ethereum: ReviewedBalanceIndexer;
  private readonly solana: ReviewedBalanceIndexer;

  constructor(ethereum: BalanceSyncIndexerPort, solana: BalanceSyncIndexerPort) {
    const reviewed = reviewedIndexers(ethereum, solana);
    this.ethereum = reviewed.ethereum;
    this.solana = reviewed.solana;
  }

  async readCurrent(
    request: BalanceIndexerReadRequest,
    context: BalanceSyncExecutionContext,
  ): Promise<unknown> {
    requireExecutionContext(context);
    const validated = copyReadRequest(request, READ_REQUEST_KEYS);
    return this.indexerFor(validated.networkId).readCurrent(validated, context);
  }

  async rescanFromCheckpoint(
    request: BalanceIndexerRescanRequest,
    context: BalanceSyncExecutionContext,
  ): Promise<unknown> {
    requireExecutionContext(context);
    const record = exactDataRecord(request, RESCAN_REQUEST_KEYS);
    const validated = frozenNullPrototype({
      ...copyReadRecord(record),
      fromFinalizedSource: copySourcePoint(record.fromFinalizedSource),
      maximumReadUnits: boundedRecoveryReadUnits(record.maximumReadUnits),
    }) satisfies BalanceIndexerRescanRequest;
    return this.indexerFor(validated.networkId).rescanFromCheckpoint(validated, context);
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
  return copyReadRecord(exactDataRecord(request, keys));
}

function copyReadRecord(record: Record<string, unknown>): BalanceIndexerReadRequest {
  if (
    typeof record.accountId !== 'string' ||
    !UUID_V4.test(record.accountId) ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
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
  return frozenNullPrototype({
    accountId: record.accountId,
    walletId: record.walletId,
    networkId: record.networkId,
    tier: record.tier as BalanceIndexerReadRequest['tier'],
    selector: record.selector as BalanceIndexerReadRequest['selector'],
  });
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
  return frozenNullPrototype({
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
  } catch {
    return unsupportedRequest();
  }
}

function reviewedIndexers(
  ethereum: unknown,
  solana: unknown,
): Readonly<{ ethereum: ReviewedBalanceIndexer; solana: ReviewedBalanceIndexer }> {
  try {
    if (ethereum === solana) return invalidConfiguration();
    return Object.freeze({
      ethereum: reviewedIndexer(ethereum),
      solana: reviewedIndexer(solana),
    });
  } catch {
    return invalidConfiguration();
  }
}

function reviewedIndexer(value: unknown): ReviewedBalanceIndexer {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    Array.isArray(value)
  ) {
    return invalidConfiguration();
  }
  const receiver = value as object;
  const readCurrent = capturedDataMethod(receiver, 'readCurrent');
  const rescanFromCheckpoint = capturedDataMethod(receiver, 'rescanFromCheckpoint');
  return Object.freeze({
    readCurrent: (
      request: BalanceIndexerReadRequest,
      context: BalanceSyncExecutionContext,
    ): Promise<unknown> =>
      Reflect.apply(readCurrent, receiver, [request, context]) as Promise<unknown>,
    rescanFromCheckpoint: (
      request: BalanceIndexerRescanRequest,
      context: BalanceSyncExecutionContext,
    ): Promise<unknown> =>
      Reflect.apply(rescanFromCheckpoint, receiver, [request, context]) as Promise<unknown>,
  });
}

function capturedDataMethod(receiver: object, name: string): (...arguments_: unknown[]) => unknown {
  const visited = new Set<object>();
  let owner: object | null = receiver;
  while (
    owner !== null &&
    owner !== Object.prototype &&
    owner !== Function.prototype &&
    !visited.has(owner)
  ) {
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        return invalidConfiguration();
      }
      return descriptor.value as (...arguments_: unknown[]) => unknown;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return invalidConfiguration();
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function invalidConfiguration(): never {
  throw new MainnetBalanceIndexerRouterConfigurationError();
}

function unsupportedRequest(): never {
  throw new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE');
}

function requireExecutionContext(context: unknown): void {
  if (reviewBalanceSyncExecutionContext(context) === null) {
    throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
  }
}
