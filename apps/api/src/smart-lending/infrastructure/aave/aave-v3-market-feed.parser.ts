import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import type {
  ProviderNativeLendingMarketObservation,
  ProviderNativeLendingMarketSnapshot,
} from '../../application/ports/provider-native-lending-market-reader.port';
import {
  AAVE_V3_ETHEREUM_CORE_MARKET,
  AAVE_V3_ETHEREUM_MARKET_REQUEST_FINGERPRINT_SHA256,
} from './aave-v3-market-feed.query';

export {
  AAVE_V3_ETHEREUM_CORE_MARKET,
  AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST,
  AAVE_V3_ETHEREUM_MARKET_QUERY,
  AAVE_V3_ETHEREUM_MARKET_REQUEST_FINGERPRINT_SHA256,
} from './aave-v3-market-feed.query';

export interface AaveV3EthereumLendingMarketObservation extends ProviderNativeLendingMarketObservation {
  readonly providerId: 'aave';
  readonly protocolId: 'aave-v3';
  readonly networkId: 'eip155:1';
  readonly assetSymbol: 'USDC' | 'USDT';
  /** Null means Aave reports no protocol supply cap; it is not a product capacity approval. */
  readonly protocolSupplyCapAtomic: bigint | null;
  readonly protocolSupplyCapRemainingAtomic: bigint | null;
  readonly protocolSupplyCapReached: boolean;
  /** Aave borrow-side liquidity, retained only as an exit-liquidity proxy. */
  readonly reportedAvailableLiquidityAtomic: bigint;
  /** Aave reserve factor; this is not a user entry, exit, or routing fee. */
  readonly reserveFactorBasisPoints: bigint;
  readonly isPaused: boolean;
  readonly isFrozen: boolean;
}

export interface AaveV3EthereumLendingMarketSnapshot extends Omit<
  ProviderNativeLendingMarketSnapshot,
  'sourceId' | 'providerCoverage' | 'observations'
> {
  readonly sourceId: 'AAVE_V3_GRAPHQL';
  readonly providerCoverage: readonly ['aave'];
  readonly observations: readonly AaveV3EthereumLendingMarketObservation[];
}

const ETHEREUM_MAINNET = 'eip155:1' as const;
const MAX_RESERVES = 128;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_RATE_DECIMALS = 36;
const AAVE_APY_DECIMALS = 27;
const AAVE_RESERVE_FACTOR_DECIMALS = 4;
const MAX_APY_BASIS_POINTS = 1_000_000n;
const BASIS_POINTS_SCALE = 10_000n;
const PROVIDER_SNAPSHOT_TTL_MILLISECONDS = 60_000;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const DECIMAL_VALUE = /^(?:0|[1-9][0-9]{0,77})(?:\.[0-9]{1,80})?$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const ENVELOPE_KEYS = ['data'] as const;
const DATA_KEYS = ['market'] as const;
const MARKET_KEYS = ['address', 'chain', 'reserves'] as const;
const CHAIN_KEYS = ['chainId', 'isTestnet'] as const;
const RESERVE_KEYS = [
  'underlyingToken',
  'size',
  'supplyInfo',
  'borrowInfo',
  'isFrozen',
  'isPaused',
] as const;
const TOKEN_KEYS = ['address', 'chainId', 'symbol', 'decimals'] as const;
const TOKEN_AMOUNT_KEYS = ['amount'] as const;
const DECIMAL_KEYS = ['raw', 'decimals', 'value'] as const;
const SUPPLY_INFO_KEYS = ['apy', 'supplyCap', 'supplyCapReached', 'total'] as const;
const BORROW_INFO_KEYS = ['availableLiquidity', 'reserveFactor'] as const;

interface ParsedDecimal {
  readonly raw: bigint;
  readonly rawText: string;
  readonly decimals: number;
}

interface ParsedTargetReserve {
  readonly assetId: string;
  readonly assetSymbol: 'USDC' | 'USDT';
  readonly apy: ParsedDecimal;
  readonly totalSuppliedAtomic: bigint;
  readonly totalSuppliedAtomicText: string;
  readonly protocolSupplyCapAtomic: bigint | null;
  readonly protocolSupplyCapAtomicText: string;
  readonly protocolSupplyCapRemainingAtomic: bigint | null;
  readonly protocolSupplyCapReached: boolean;
  readonly availableLiquidityAtomic: bigint;
  readonly availableLiquidityAtomicText: string;
  readonly reserveFactor: ParsedDecimal;
  readonly isPaused: boolean;
  readonly isFrozen: boolean;
}

export class AaveV3MarketFeedValidationError extends Error {
  readonly code = 'AAVE_V3_MARKET_FEED_INVALID' as const;

  constructor() {
    super('Aave V3 market feed is invalid');
    this.name = 'AaveV3MarketFeedValidationError';
  }
}

function fail(): never {
  throw new AaveV3MarketFeedValidationError();
}

function dataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }

    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof AaveV3MarketFeedValidationError) throw error;
    return fail();
  }
}

function dataArray(value: unknown, maximumLength: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
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
      return fail();
    }
    const length = lengthDescriptor.value;
    const indexKeys = Array.from({ length }, (_, index) => String(index));
    const expectedKeys = [...indexKeys, 'length'];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    return indexKeys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      return descriptor.value;
    });
  } catch (error) {
    if (error instanceof AaveV3MarketFeedValidationError) throw error;
    return fail();
  }
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function address(value: unknown): string {
  if (typeof value !== 'string' || !EVM_ADDRESS.test(value) || /^0x0{40}$/iu.test(value)) {
    return fail();
  }
  return value.toLowerCase();
}

function unsignedInteger(value: unknown): Readonly<{ raw: bigint; text: string }> {
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_INTEGER.test(value)) return fail();
  const raw = BigInt(value);
  if (raw > MAX_UINT256) return fail();
  return Object.freeze({ raw, text: value });
}

function normalizedDecimalText(value: string): string {
  const separator = value.indexOf('.');
  if (separator === -1) return value;
  const whole = value.slice(0, separator);
  const fraction = value.slice(separator + 1).replace(/0+$/u, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function decimalTextFromRaw(raw: string, decimals: number): string {
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, '0');
  const splitAt = padded.length - decimals;
  return normalizedDecimalText(`${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`);
}

function parsedDecimal(value: unknown, expectedDecimals?: number): ParsedDecimal {
  const record = dataRecord(value, DECIMAL_KEYS);
  const parsedRaw = unsignedInteger(record.raw);
  if (
    typeof record.decimals !== 'number' ||
    !Number.isSafeInteger(record.decimals) ||
    record.decimals < 0 ||
    record.decimals > MAX_RATE_DECIMALS ||
    (expectedDecimals !== undefined && record.decimals !== expectedDecimals) ||
    typeof record.value !== 'string' ||
    !DECIMAL_VALUE.test(record.value) ||
    normalizedDecimalText(record.value) !== decimalTextFromRaw(parsedRaw.text, record.decimals)
  ) {
    return fail();
  }
  return Object.freeze({
    raw: parsedRaw.raw,
    rawText: parsedRaw.text,
    decimals: record.decimals,
  });
}

function tokenAmount(value: unknown, decimals: number): ParsedDecimal {
  const record = dataRecord(value, TOKEN_AMOUNT_KEYS);
  return parsedDecimal(record.amount, decimals);
}

function rateBasisPoints(value: ParsedDecimal, maximum: bigint): bigint {
  const rateScale = 10n ** BigInt(value.decimals);
  const basisPoints = (value.raw * BASIS_POINTS_SCALE) / rateScale;
  if (basisPoints > maximum) return fail();
  return basisPoints;
}

function targetAsset(
  value: unknown,
): Readonly<{ assetId: string; assetSymbol: 'USDC' | 'USDT'; assetDecimals: 6 }> | null {
  const record = dataRecord(value, TOKEN_KEYS);
  const assetAddress = address(record.address);
  if (
    record.chainId !== 1 ||
    typeof record.symbol !== 'string' ||
    record.symbol.length === 0 ||
    record.symbol.length > 32 ||
    typeof record.decimals !== 'number' ||
    !Number.isSafeInteger(record.decimals) ||
    record.decimals < 0 ||
    record.decimals > MAX_RATE_DECIMALS
  ) {
    return fail();
  }

  const registryAsset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(
    ETHEREUM_MAINNET,
    assetAddress,
  );
  const hasTargetSymbol = record.symbol === 'USDC' || record.symbol === 'USDT';
  const isTargetRegistryAsset =
    registryAsset?.stablecoin === 'USDC' || registryAsset?.stablecoin === 'USDT';
  if (!hasTargetSymbol && !isTargetRegistryAsset) return null;
  if (
    !registryAsset ||
    registryAsset.activationState !== 'ACTIVE' ||
    (registryAsset.stablecoin !== 'USDC' && registryAsset.stablecoin !== 'USDT') ||
    record.symbol !== registryAsset.stablecoin ||
    record.decimals !== 6 ||
    registryAsset.decimals !== 6
  ) {
    return fail();
  }
  return Object.freeze({
    assetId: registryAsset.identity,
    assetSymbol: registryAsset.stablecoin,
    assetDecimals: 6 as const,
  });
}

function targetReserve(value: unknown): ParsedTargetReserve | null {
  const record = dataRecord(value, RESERVE_KEYS);
  const asset = targetAsset(record.underlyingToken);
  if (asset === null) return null;
  if (
    typeof record.isFrozen !== 'boolean' ||
    typeof record.isPaused !== 'boolean' ||
    record.borrowInfo === null
  ) {
    return fail();
  }

  const size = tokenAmount(record.size, asset.assetDecimals);
  const supply = dataRecord(record.supplyInfo, SUPPLY_INFO_KEYS);
  const apy = parsedDecimal(supply.apy, AAVE_APY_DECIMALS);
  const total = parsedDecimal(supply.total, asset.assetDecimals);
  const supplyCap = tokenAmount(supply.supplyCap, asset.assetDecimals);
  if (size.raw !== total.raw || typeof supply.supplyCapReached !== 'boolean') return fail();

  const borrow = dataRecord(record.borrowInfo, BORROW_INFO_KEYS);
  const availableLiquidity = tokenAmount(borrow.availableLiquidity, asset.assetDecimals);
  const reserveFactor = parsedDecimal(borrow.reserveFactor, AAVE_RESERVE_FACTOR_DECIMALS);
  rateBasisPoints(apy, MAX_APY_BASIS_POINTS);
  rateBasisPoints(reserveFactor, BASIS_POINTS_SCALE);

  let protocolSupplyCapAtomic: bigint | null;
  let protocolSupplyCapRemainingAtomic: bigint | null;
  if (supplyCap.raw === 0n) {
    if (supply.supplyCapReached) return fail();
    protocolSupplyCapAtomic = null;
    protocolSupplyCapRemainingAtomic = null;
  } else {
    const capReached = total.raw >= supplyCap.raw;
    if (supply.supplyCapReached !== capReached) return fail();
    protocolSupplyCapAtomic = supplyCap.raw;
    protocolSupplyCapRemainingAtomic = capReached ? 0n : supplyCap.raw - total.raw;
  }

  return Object.freeze({
    assetId: asset.assetId,
    assetSymbol: asset.assetSymbol,
    apy,
    totalSuppliedAtomic: total.raw,
    totalSuppliedAtomicText: total.rawText,
    protocolSupplyCapAtomic,
    protocolSupplyCapAtomicText: supplyCap.rawText,
    protocolSupplyCapRemainingAtomic,
    protocolSupplyCapReached: supply.supplyCapReached,
    availableLiquidityAtomic: availableLiquidity.raw,
    availableLiquidityAtomicText: availableLiquidity.rawText,
    reserveFactor,
    isPaused: record.isPaused,
    isFrozen: record.isFrozen,
  });
}

function fingerprint(reserves: readonly ParsedTargetReserve[], retrievedAt: string): string {
  const canonical = reserves.map((reserve) => [
    reserve.assetId,
    reserve.assetSymbol,
    reserve.apy.rawText,
    reserve.apy.decimals,
    reserve.totalSuppliedAtomicText,
    reserve.protocolSupplyCapAtomicText,
    reserve.protocolSupplyCapReached,
    reserve.availableLiquidityAtomicText,
    reserve.reserveFactor.rawText,
    reserve.reserveFactor.decimals,
    reserve.isPaused,
    reserve.isFrozen,
  ]);
  return createHash('sha256')
    .update(
      JSON.stringify([
        'crypto-lending:aave-v3-ethereum-market-feed:v1',
        AAVE_V3_ETHEREUM_MARKET_REQUEST_FINGERPRINT_SHA256,
        AAVE_V3_ETHEREUM_CORE_MARKET,
        retrievedAt,
        canonical,
      ]),
      'utf8',
    )
    .digest('hex');
}

/**
 * Parses the exact response projection selected by
 * `AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST`. Retrieval time is local evidence
 * only: Aave's response has no authenticated block anchor, so this snapshot
 * can never establish recommendation eligibility by itself.
 */
export function parseAaveV3EthereumMarketFeed(
  value: unknown,
  retrievedAtValue: unknown,
): AaveV3EthereumLendingMarketSnapshot {
  const retrievedAt = timestamp(retrievedAtValue);
  const envelope = dataRecord(value, ENVELOPE_KEYS);
  const data = dataRecord(envelope.data, DATA_KEYS);
  const market = dataRecord(data.market, MARKET_KEYS);
  if (address(market.address) !== AAVE_V3_ETHEREUM_CORE_MARKET) return fail();
  const chain = dataRecord(market.chain, CHAIN_KEYS);
  if (chain.chainId !== 1 || chain.isTestnet !== false) return fail();

  const parsedTargets = dataArray(market.reserves, MAX_RESERVES)
    .map(targetReserve)
    .filter((reserve): reserve is ParsedTargetReserve => reserve !== null)
    .sort((left, right) => left.assetSymbol.localeCompare(right.assetSymbol));
  if (
    parsedTargets.length !== 2 ||
    parsedTargets[0]?.assetSymbol !== 'USDC' ||
    parsedTargets[1]?.assetSymbol !== 'USDT'
  ) {
    return fail();
  }

  const digest = fingerprint(parsedTargets, retrievedAt);
  const observations = Object.freeze(
    parsedTargets.map((reserve): AaveV3EthereumLendingMarketObservation =>
      Object.freeze({
        providerId: 'aave',
        protocolId: 'aave-v3',
        networkId: ETHEREUM_MAINNET,
        marketId: AAVE_V3_ETHEREUM_CORE_MARKET,
        assetId: reserve.assetId,
        assetSymbol: reserve.assetSymbol,
        assetDecimals: 6,
        baseSupplyApyBasisPoints: rateBasisPoints(reserve.apy, MAX_APY_BASIS_POINTS),
        totalSuppliedAtomic: reserve.totalSuppliedAtomic,
        providerSupplyStatus:
          reserve.isPaused || reserve.isFrozen || reserve.protocolSupplyCapReached
            ? ('CLOSED' as const)
            : ('OPEN' as const),
        protocolSupplyCapAtomic: reserve.protocolSupplyCapAtomic,
        protocolSupplyCapRemainingAtomic: reserve.protocolSupplyCapRemainingAtomic,
        protocolSupplyCapReached: reserve.protocolSupplyCapReached,
        reportedAvailableLiquidityAtomic: reserve.availableLiquidityAtomic,
        reserveFactorBasisPoints: rateBasisPoints(reserve.reserveFactor, BASIS_POINTS_SCALE),
        isPaused: reserve.isPaused,
        isFrozen: reserve.isFrozen,
        evidenceReferenceId: `aave-v3-graphql:${reserve.assetSymbol.toLowerCase()}:${digest}`,
      }),
    ),
  );

  return Object.freeze({
    schemaVersion: 1 as const,
    sourceId: 'AAVE_V3_GRAPHQL' as const,
    use: 'PROVIDER_NATIVE_CORROBORATION_ONLY' as const,
    mayEstablishRecommendationEligibility: false as const,
    mayAuthorizeFinancialAction: false as const,
    snapshotId: `aave-v3-ethereum:${digest}`,
    fingerprintSha256: digest,
    sourceRequestFingerprintSha256: AAVE_V3_ETHEREUM_MARKET_REQUEST_FINGERPRINT_SHA256,
    retrievedAt,
    validUntil: new Date(
      Date.parse(retrievedAt) + PROVIDER_SNAPSHOT_TTL_MILLISECONDS,
    ).toISOString(),
    providerCoverage: Object.freeze(['aave'] as const),
    observations,
  });
}
